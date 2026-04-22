<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRuntimeStore } from '@/stores/runtime';

const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();

const menuItems = [
  { index: '/dashboard', label: '架构师总控台' },
  { index: '/instances', label: '应用实例' },
  { index: '/sessions', label: '会话管理' },
  { index: '/settings', label: '系统设置' }
];

const backendStatusType = computed(() => (runtimeStore.backendAvailable ? 'success' : 'danger'));
const diagnosticsButtonType = computed(() => (runtimeStore.backendAvailable ? '' : 'warning'));
const activeMenu = computed(() => route.path);
const attachedClientCountText = computed(() => runtimeStore.statistics?.attachedClientCount ?? '-');
const observingSessionAttachmentCountText = computed(() => runtimeStore.statistics?.observingSessionAttachmentCount ?? '-');
const canOpenAppLog = computed(() => Boolean(runtimeStore.health?.appLogPath && window.desktopBridge));
const runtimeDiagnosticsTip = computed(() => {
  if (runtimeStore.backendAvailable) {
    const uptime = formatDuration(runtimeStore.health?.uptimeMs);
    return `后端运行中${uptime === '-' ? '' : `，已运行 ${uptime}`}。点击查看运行时诊断。`;
  }
  return runtimeStore.lastRefreshError
    ? `后端不可用：${runtimeStore.lastRefreshError}。点击查看恢复指引。`
    : '后端不可用。点击查看恢复指引。';
});

onMounted(async () => {
  await runtimeStore.initialize();
});

function navigate(path: string) {
  router.push(path);
}

function openRuntimeDiagnostics() {
  router.push('/settings');
}

async function openAppLog() {
  const appLogPath = runtimeStore.health?.appLogPath;
  if (!appLogPath || !window.desktopBridge) {
    return;
  }
  await window.desktopBridge.openPath(appLogPath);
}

function formatDuration(ms?: number | null) {
  if (!Number.isFinite(ms ?? Number.NaN)) {
    return '-';
  }
  const totalSeconds = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${totalSeconds}秒`;
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="220px" class="app-sidebar">
      <div class="brand-block">
        <div class="brand-title">mutiAgent</div>
        <div class="brand-subtitle">架构师多 Agent 总控台</div>
      </div>

      <el-menu :default-active="activeMenu" class="side-menu" @select="navigate">
        <el-menu-item
          v-for="item in menuItems"
          :key="item.index"
          :index="item.index"
        >
          {{ item.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="app-header">
        <div class="header-title">{{ route.meta.title ?? '控制台' }}</div>
        <div class="header-actions">
          <el-tag :type="backendStatusType">{{ runtimeStore.backendStatusText }}</el-tag>
          <el-tag v-if="runtimeStore.backendAvailable" type="info">客户端 {{ attachedClientCountText }}</el-tag>
          <el-tag v-if="runtimeStore.backendAvailable" type="warning">观察会话 {{ observingSessionAttachmentCountText }}</el-tag>
          <el-tooltip :content="runtimeDiagnosticsTip" placement="bottom">
            <el-button size="small" :type="diagnosticsButtonType" @click="openRuntimeDiagnostics">
              诊断
            </el-button>
          </el-tooltip>
          <el-button v-if="canOpenAppLog" size="small" @click="openAppLog">打开日志</el-button>
          <el-button size="small" @click="runtimeStore.refreshAll">刷新状态</el-button>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
