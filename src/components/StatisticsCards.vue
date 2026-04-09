<script setup lang="ts">
import type { RuntimeStatistics } from '@/types/runtime';

defineProps<{
  statistics: RuntimeStatistics | null;
}>();

const items = [
  { label: '应用实例', key: 'instanceCount' },
  { label: '总会话数', key: 'sessionCount' },
  { label: '运行中会话', key: 'runningSessionCount' },
  { label: '消息总量', key: 'messageCount' },
  { label: '运行中进程', key: 'runningProcessCount' }
] as const;
</script>

<template>
  <el-row :gutter="16">
    <el-col v-for="item in items" :key="item.key" :span="4">
      <el-card class="page-card">
        <div class="meta-label">{{ item.label }}</div>
        <div class="meta-value">{{ statistics?.[item.key] ?? '-' }}</div>
      </el-card>
    </el-col>
  </el-row>
</template>
