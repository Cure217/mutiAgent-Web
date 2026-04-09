<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive } from 'vue';
import { useConfigStore } from '@/stores/configs';
import { useRuntimeStore } from '@/stores/runtime';

const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();

const form = reactive({
  defaultProjectPath: 'D:\\Project\\ali\\260409',
  defaultShell: 'powershell',
  sessionLogRetentionDays: 30,
  defaultTerminalMode: 'raw',
  autoReconnect: false
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
  form.defaultProjectPath = configStore.getValue('runtime', 'defaultProjectPath', 'D:\\Project\\ali\\260409');
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

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card class="page-card">
          <template #header>运行连接</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="后端地址">
              {{ runtimeStore.backendBaseUrl }}
            </el-descriptions-item>
            <el-descriptions-item label="运行目录">
              {{ runtimeStore.health?.baseDir ?? '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="数据库">
              {{ runtimeStore.health?.dbPath ?? '-' }}
            </el-descriptions-item>
          </el-descriptions>
          <div style="margin-top: 16px; display: flex; gap: 12px;">
            <el-button @click="openBaseDir">打开运行目录</el-button>
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
          <template #header>当前说明</template>
          <el-alert
            title="系统设置页已接入 SQLite 配置表，可维护默认项目目录、默认 Shell、终端视图与自动重连策略。"
            type="success"
            :closable="false"
          />
          <el-alert
            title="默认项目目录会直接用于打开外部终端，并同步作为新建实例的默认工作目录。"
            type="info"
            :closable="false"
            style="margin-top: 12px;"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
