<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive } from 'vue';
import { useConfigStore } from '@/stores/configs';
import { useRuntimeStore } from '@/stores/runtime';
import type { RuntimeAttachmentInfo, RuntimeLifecycleEventInfo } from '@/types/runtime';

const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();

const form = reactive({
  defaultProjectPath: '',
  defaultShell: 'powershell',
  sessionLogRetentionDays: 30,
  defaultTerminalMode: 'raw',
  autoReconnect: false
});

const attachmentSummary = computed(() => ({
  total: runtimeStore.statistics?.attachedClientCount ?? runtimeStore.attachments.length,
  observing: runtimeStore.statistics?.observingSessionAttachmentCount
    ?? runtimeStore.attachments.filter((item) => item.observedTargetId).length
}));

const recentLifecycleEvents = computed(() => runtimeStore.health?.recentLifecycleEvents ?? []);
const canOpenAppLog = computed(() => Boolean(runtimeStore.health?.appLogPath && window.desktopBridge));
const backendRecoveryHint = computed(() => {
  const parts = [
    `当前无法连接 ${runtimeStore.backendBaseUrl}。`,
    '优先在项目根目录执行：powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1。',
    '如果 18109 已被非脚本托管进程占用，请先确认该进程来源，避免误杀。'
  ];
  if (runtimeStore.health?.appLogPath) {
    parts.push(`上次已知应用日志：${runtimeStore.health.appLogPath}`);
  }
  if (runtimeStore.lastRefreshError) {
    parts.push(`最近错误：${runtimeStore.lastRefreshError}`);
  }
  return parts.join(' ');
});

onMounted(async () => {
  await refreshPage();
});

async function refreshPage() {
  try {
    await Promise.all([runtimeStore.refreshAll(), configStore.load()]);
    hydrateForm();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function hydrateForm() {
  form.defaultProjectPath = configStore.defaultProjectPath;
  form.defaultShell = configStore.getValue('runtime', 'defaultShell', 'powershell');
  form.sessionLogRetentionDays = normalizeNumber(
    configStore.getValue('storage', 'sessionLogRetentionDays', '30'),
    30
  );
  form.defaultTerminalMode = configStore.getValue('ui', 'defaultTerminalMode', 'raw');
  form.autoReconnect = configStore.getValue('session', 'autoReconnect', 'false') === 'true';
}

async function openBaseDir() {
  const baseDir = runtimeStore.health?.baseDir;
  if (!baseDir || !window.desktopBridge) {
    return;
  }
  await window.desktopBridge.openPath(baseDir);
}

async function openAppLog() {
  const appLogPath = runtimeStore.health?.appLogPath;
  if (!appLogPath || !window.desktopBridge) {
    return;
  }
  await window.desktopBridge.openPath(appLogPath);
}

async function openExternalTerminal() {
  if (!window.desktopBridge) {
    return;
  }
  await window.desktopBridge.openExternalTerminal({
    cwd: form.defaultProjectPath,
    command: ''
  });
}

async function chooseDefaultProjectDir() {
  if (!window.desktopBridge) {
    return;
  }
  const selected = await window.desktopBridge.pickDirectory();
  if (selected) {
    form.defaultProjectPath = selected;
  }
}

async function saveConfigs() {
  try {
    await configStore.save([
      {
        configGroup: 'runtime',
        configKey: 'defaultProjectPath',
        valueType: 'string',
        valueText: form.defaultProjectPath
      },
      {
        configGroup: 'runtime',
        configKey: 'defaultShell',
        valueType: 'string',
        valueText: form.defaultShell
      },
      {
        configGroup: 'storage',
        configKey: 'sessionLogRetentionDays',
        valueType: 'number',
        valueText: String(form.sessionLogRetentionDays)
      },
      {
        configGroup: 'ui',
        configKey: 'defaultTerminalMode',
        valueType: 'string',
        valueText: form.defaultTerminalMode
      },
      {
        configGroup: 'session',
        configKey: 'autoReconnect',
        valueType: 'boolean',
        valueText: String(form.autoReconnect)
      }
    ]);
    hydrateForm();
    ElMessage.success('系统配置已保存');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function normalizeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shortId(value?: string | null) {
  if (!value) {
    return '-';
  }
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function formatTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (!Number.isFinite(ms ?? Number.NaN)) {
    return '-';
  }
  const totalSeconds = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟 ${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatLifecycleEventType(type?: string | null) {
  if (type === 'process_exit') {
    return '进程退出';
  }
  if (type === 'supervisor_error') {
    return '托管错误';
  }
  return type || '-';
}

function formatLifecycleEventSummary(event: RuntimeLifecycleEventInfo) {
  if (event.type === 'process_exit') {
    return `${event.status || '-'} / exitCode=${event.exitCode ?? '-'} / ${event.exitReason || '无退出说明'}`;
  }
  return event.message || '-';
}

function formatObservedTarget(attachment: RuntimeAttachmentInfo) {
  if (!attachment.observedTargetId) {
    return '未观察会话';
  }
  return `${attachment.observedTargetType || 'session'} / ${shortId(attachment.observedTargetId)}`;
}
</script>

<template>
  <div>
    <div class="page-header">
      <h2>系统设置</h2>
      <div class="page-toolbar">
        <el-button @click="refreshPage">刷新</el-button>
        <el-button type="primary" :loading="configStore.saving" @click="saveConfigs">保存配置</el-button>
      </div>
    </div>

    <el-alert
      v-if="!runtimeStore.backendAvailable"
      :title="backendRecoveryHint"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px;"
    />

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card class="page-card">
          <template #header>运行连接</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="后端地址">
              {{ runtimeStore.backendBaseUrl }}
            </el-descriptions-item>
            <el-descriptions-item label="启动时间">
              {{ formatTime(runtimeStore.health?.startedAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="运行时长">
              {{ formatDuration(runtimeStore.health?.uptimeMs) }}
            </el-descriptions-item>
            <el-descriptions-item label="运行目录">
              {{ runtimeStore.health?.baseDir ?? '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="运行时状态目录">
              {{ runtimeStore.health?.runtimeDir ?? '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="数据库">
              {{ runtimeStore.health?.dbPath ?? '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="应用日志">
              {{ runtimeStore.health?.appLogPath ?? '-' }}
            </el-descriptions-item>
          </el-descriptions>
          <div style="margin-top: 16px; display: flex; gap: 12px;">
            <el-button @click="openBaseDir">打开运行目录</el-button>
            <el-button :disabled="!canOpenAppLog" @click="openAppLog">
              打开应用日志
            </el-button>
            <el-button type="primary" @click="openExternalTerminal">打开外部终端</el-button>
          </div>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card class="page-card">
          <template #header>基础配置</template>
          <el-form label-width="130px" v-loading="configStore.loading">
            <el-form-item label="默认项目目录">
              <el-input v-model="form.defaultProjectPath">
                <template #append>
                  <el-button @click="chooseDefaultProjectDir">选择目录</el-button>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item label="默认 Shell">
              <el-select v-model="form.defaultShell">
                <el-option label="PowerShell" value="powershell" />
                <el-option label="WSL" value="wsl" />
                <el-option label="Git Bash" value="git-bash" />
              </el-select>
            </el-form-item>
            <el-form-item label="日志保留天数">
              <el-input-number v-model="form.sessionLogRetentionDays" :min="1" :max="365" />
            </el-form-item>
            <el-form-item label="默认终端视图">
              <el-select v-model="form.defaultTerminalMode">
                <el-option label="原始输出" value="raw" />
                <el-option label="结构化消息" value="structured" />
              </el-select>
            </el-form-item>
            <el-form-item label="自动重连会话">
              <el-switch v-model="form.autoReconnect" />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px;">
      <el-col :span="24">
        <el-card class="page-card">
          <template #header>运行时诊断摘要</template>
          <el-table
            :data="recentLifecycleEvents"
            size="small"
            border
            empty-text="暂无托管错误或进程退出记录"
            max-height="260"
          >
            <el-table-column label="时间" min-width="180">
              <template #default="{ row }">{{ formatTime(row.observedAt) }}</template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="row.type === 'supervisor_error' ? 'danger' : 'info'">
                  {{ formatLifecycleEventType(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="会话" width="150">
              <template #default="{ row }">
                <el-tooltip v-if="row.sessionId" :content="row.sessionId" placement="top">
                  <span>{{ shortId(row.sessionId) }}</span>
                </el-tooltip>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="摘要" min-width="360">
              <template #default="{ row }">{{ formatLifecycleEventSummary(row) }}</template>
            </el-table-column>
          </el-table>
          <el-alert
            title="这些诊断来自当前后端内存态，用于快速判断最近的进程退出或 supervisor 错误；完整排查仍以应用日志为准。"
            type="info"
            :closable="false"
            style="margin-top: 12px;"
          />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px;">
      <el-col :span="24">
        <el-card class="page-card">
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span>运行时客户端观测</span>
              <div style="display: flex; gap: 8px;">
                <el-tag type="info">客户端 {{ attachmentSummary.total }}</el-tag>
                <el-tag type="warning">观察会话 {{ attachmentSummary.observing }}</el-tag>
              </div>
            </div>
          </template>
          <el-table
            :data="runtimeStore.attachments"
            size="small"
            border
            empty-text="当前没有已连接客户端"
            max-height="280"
          >
            <el-table-column label="客户端" min-width="180">
              <template #default="{ row }">
                <el-tooltip :content="row.clientId" placement="top">
                  <span>{{ shortId(row.clientId) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="观察目标" min-width="180">
              <template #default="{ row }">
                <el-tag :type="row.observedTargetId ? 'success' : 'info'">
                  {{ formatObservedTarget(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="连接时间" min-width="180">
              <template #default="{ row }">{{ formatTime(row.connectedAt) }}</template>
            </el-table-column>
            <el-table-column label="最后心跳" min-width="180">
              <template #default="{ row }">{{ formatTime(row.lastHeartbeatAt) }}</template>
            </el-table-column>
            <el-table-column label="远端地址" min-width="150">
              <template #default="{ row }">{{ row.remoteAddress || '-' }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px;">
      <el-col :span="24">
        <el-card class="page-card">
          <template #header>当前说明</template>
          <el-alert
            title="系统设置页已接入 SQLite 配置表，可维护默认项目目录、默认 Shell、终端视图与自动重连策略。"
            type="success"
            :closable="false"
          />
          <el-alert
            title="运行时客户端观测来自当前后端内存态 attachment，用于判断哪些前端、桌面端或自动化客户端正连接到后端。"
            type="info"
            :closable="false"
            style="margin-top: 12px;"
          />
          <el-alert
            title="attachment 列表不是持久化审计表；后端重启后会清空，关键 attach/detach/observe 事件会进入操作流水。"
            type="info"
            :closable="false"
            style="margin-top: 12px;"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
