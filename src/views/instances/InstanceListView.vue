<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import StatusTag from '@/components/StatusTag.vue';
import { useConfigStore } from '@/stores/configs';
import { useInstanceStore } from '@/stores/instances';
import type { AppInstance, InstanceTestLaunchResult } from '@/types/api';
import type { InstancePayload } from '@/api/instance';

const instanceStore = useInstanceStore();
const configStore = useConfigStore();
const keyword = ref('');
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);

const form = reactive({
  name: '',
  appType: 'codex',
  adapterType: 'codex-cli',
  runtimeEnv: 'windows',
  launchMode: 'external',
  executablePath: '',
  launchCommand: 'codex.cmd',
  argsText: '',
  workdir: 'D:\\Project\\ali\\260409',
  envText: 'TERM=xterm-256color',
  enabled: true,
  autoRestart: false,
  remark: ''
});

const dialogTitle = computed(() => (editingId.value ? '编辑实例' : '新建实例'));
const runtimeEnvHint = computed(() =>
  form.runtimeEnv === 'wsl'
    ? '这里表示 AI 命令实际运行在 WSL 中；即使宿主机是 Windows，也会走 WSL。'
    : '这里表示 AI 命令直接运行在 Windows 本机环境中。'
);

onMounted(async () => {
  await Promise.all([instanceStore.load(), configStore.load()]);
});

watch(
  () => form.runtimeEnv,
  (runtimeEnv) => {
    if (runtimeEnv === 'windows' && form.executablePath === 'wsl.exe') {
      form.executablePath = '';
    }
    if (runtimeEnv === 'windows' && (!form.launchCommand || form.launchCommand === 'codex')) {
      form.launchCommand = 'codex.cmd';
    }
    if (runtimeEnv === 'wsl') {
      if (!form.executablePath) {
        form.executablePath = 'wsl.exe';
      }
      if (!form.launchCommand || form.launchCommand === 'codex.cmd') {
        form.launchCommand = 'codex';
      }
    }
  }
);

function openCreateDialog() {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    appType: 'codex',
    adapterType: 'codex-cli',
    runtimeEnv: 'windows',
    launchMode: 'external',
    executablePath: '',
    launchCommand: 'codex.cmd',
    argsText: '',
    workdir: configStore.defaultProjectPath || 'D:\\Project\\ali\\260409',
    envText: 'TERM=xterm-256color',
    enabled: true,
    autoRestart: false,
    remark: ''
  });
  dialogVisible.value = true;
}

function openEditDialog(instance: AppInstance) {
  editingId.value = instance.id;
  Object.assign(form, {
    name: instance.name,
    appType: instance.appType,
    adapterType: instance.adapterType || 'generic-cli',
    runtimeEnv: instance.runtimeEnv,
    launchMode: instance.launchMode,
    executablePath: instance.executablePath || '',
    launchCommand: instance.launchCommand,
    argsText: tryFormatJsonArray(instance.argsJson),
    workdir: instance.workdir || '',
    envText: tryFormatJsonMap(instance.envJson),
    enabled: instance.enabled,
    autoRestart: instance.autoRestart,
    remark: instance.remark || ''
  });
  dialogVisible.value = true;
}

async function submit() {
  try {
    const payload: InstancePayload = {
      name: form.name,
      appType: form.appType,
      adapterType: form.adapterType,
      runtimeEnv: form.runtimeEnv,
      launchMode: form.launchMode,
      executablePath: form.executablePath,
      launchCommand: form.launchCommand,
      args: form.argsText.split('\n').map((item) => item.trim()).filter(Boolean),
      workdir: form.workdir,
      env: parseEnvLines(form.envText),
      enabled: form.enabled,
      autoRestart: form.autoRestart,
      remark: form.remark
    };

    if (editingId.value) {
      await instanceStore.update(editingId.value, payload);
      ElMessage.success('实例已更新');
    } else {
      await instanceStore.create(payload);
      ElMessage.success('实例已创建');
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function toggle(instance: AppInstance) {
  try {
    await instanceStore.toggleEnabled(instance);
    ElMessage.success('状态已更新');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function testLaunch(instance: AppInstance) {
  try {
    const result = await instanceStore.testLaunch(instance.id);
    await ElMessageBox.alert(
      `<div style="white-space: pre-wrap; word-break: break-all;">${escapeHtml(buildTestLaunchSummary(instance, result))}</div>`,
      '测试启动结果',
      {
        confirmButtonText: '知道了',
        dangerouslyUseHTMLString: true
      }
    );
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function chooseDirectory() {
  if (!window.desktopBridge) {
    return;
  }
  const selected = await window.desktopBridge.pickDirectory();
  if (selected) {
    form.workdir = selected;
  }
}

function tryFormatJsonArray(raw?: string | null) {
  if (!raw) return '';
  try {
    return JSON.parse(raw).join('\n');
  } catch {
    return raw;
  }
}

function tryFormatJsonMap(raw?: string | null) {
  if (!raw) return '';
  try {
    const record = JSON.parse(raw) as Record<string, string>;
    return Object.entries(record).map(([key, value]) => `${key}=${value}`).join('\n');
  } catch {
    return raw;
  }
}

function parseEnvLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        return acc;
      }
      const key = line.slice(0, separatorIndex).trim();
      const envValue = line.slice(separatorIndex + 1).trim();
      acc[key] = envValue;
      return acc;
    }, {});
}

function buildTestLaunchSummary(instance: AppInstance, result: InstanceTestLaunchResult) {
  const lines = [
    `实例名称：${instance.name}`,
    `适配器：${result.adapterType}`,
    `可执行程序：${result.executable}`,
    `解析路径：${result.resolvedExecutable ?? '未解析（可能依赖外部 shell / WSL）'}`,
    `工作目录：${result.workingDirectory ?? '-'}`,
    `命令预览：${result.command.join(' ')}`,
    `环境变量键：${result.environmentKeys.length ? result.environmentKeys.join(', ') : '无'}`
  ];

  if (result.warnings.length) {
    lines.push('', '提示：');
    lines.push(...result.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
</script>

<template>
  <div>
    <div class="page-header">
      <h2>应用实例管理</h2>
      <div class="page-toolbar">
        <el-input v-model="keyword" placeholder="按名称搜索" clearable style="width: 240px" />
        <el-button @click="instanceStore.load(keyword)">查询</el-button>
        <el-button type="primary" @click="openCreateDialog">新建实例</el-button>
      </div>
    </div>

    <el-card class="page-card">
      <el-table :data="instanceStore.items" v-loading="instanceStore.loading">
        <el-table-column prop="name" label="实例名称" min-width="180" />
        <el-table-column prop="appType" label="应用类型" width="120" />
        <el-table-column prop="adapterType" label="适配器" width="140" />
        <el-table-column prop="runtimeEnv" label="运行环境" width="120" />
        <el-table-column prop="launchCommand" label="启动命令" min-width="180" />
        <el-table-column label="启用状态" width="120">
          <template #default="{ row }">
            <StatusTag :status="row.enabled ? 'RUNNING' : 'FAILED'" />
          </template>
        </el-table-column>
        <el-table-column prop="lastStartAt" label="最近启动" min-width="180" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="success" @click="testLaunch(row)">测试启动</el-button>
            <el-button link @click="toggle(row)">{{ row.enabled ? '禁用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="720px">
      <el-form label-width="110px">
        <el-form-item label="实例名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="应用类型">
          <el-select v-model="form.appType">
            <el-option label="Codex" value="codex" />
            <el-option label="Claude" value="claude" />
            <el-option label="通用 CLI" value="generic" />
          </el-select>
        </el-form-item>
        <el-form-item label="适配器">
          <el-input v-model="form.adapterType" />
        </el-form-item>
        <el-form-item label="命令运行环境">
          <el-select v-model="form.runtimeEnv">
            <el-option label="Windows 直接运行" value="windows" />
            <el-option label="WSL" value="wsl" />
            <el-option label="PowerShell" value="powershell" />
            <el-option label="Git Bash" value="git-bash" />
          </el-select>
        </el-form-item>
        <el-form-item label="环境说明">
          <el-alert :title="runtimeEnvHint" type="info" :closable="false" show-icon />
        </el-form-item>
        <el-form-item label="启动模式">
          <el-select v-model="form.launchMode">
            <el-option label="外部终端" value="external" />
            <el-option label="嵌入终端" value="embedded" />
          </el-select>
        </el-form-item>
        <el-form-item label="可执行路径">
          <el-input v-model="form.executablePath" />
        </el-form-item>
        <el-form-item label="启动命令">
          <el-input v-model="form.launchCommand" />
        </el-form-item>
        <el-form-item label="工作目录">
          <el-input v-model="form.workdir">
            <template #append>
              <el-button @click="chooseDirectory">选择目录</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="参数列表">
          <el-input
            v-model="form.argsText"
            type="textarea"
            :rows="4"
            placeholder="每行一个参数"
          />
        </el-form-item>
        <el-form-item label="环境变量">
          <el-input
            v-model="form.envText"
            type="textarea"
            :rows="4"
            placeholder="每行一个 KEY=VALUE&#10;例如：TERM=xterm-256color&#10;如果终端中文乱码，可加：MUTI_AGENT_CHARSET=GB18030&#10;Windows 直跑 Codex 通常不需要配置 WSL 相关参数"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="自动重启">
          <el-switch v-model="form.autoRestart" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
