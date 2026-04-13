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
const activeMenu = computed(() => route.path);

onMounted(async () => {
  await runtimeStore.initialize();
});

function navigate(path: string) {
  router.push(path);
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
          <el-button size="small" @click="runtimeStore.refreshAll">刷新状态</el-button>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
