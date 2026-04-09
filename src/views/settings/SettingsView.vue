<script setup lang="ts">
import { useRuntimeStore } from '@/stores/runtime';

const runtimeStore = useRuntimeStore();

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
    cwd: 'D:\\Project\\ali\\260409',
    command: ''
  });
}
</script>

<template>
  <div>
    <div class="page-header">
      <h2>系统设置</h2>
      <div class="page-toolbar">
        <el-button @click="runtimeStore.refreshAll">刷新</el-button>
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
          <template #header>当前说明</template>
          <el-alert
            title="当前前端已接通实例管理、会话管理、详情页、WebSocket 输出展示。"
            type="success"
            :closable="false"
          />
          <el-alert
            title="后续建议继续补：配置管理页、实例测试启动、历史检索、页内 PTY 交互。"
            type="info"
            :closable="false"
            style="margin-top: 12px;"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
