<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
}>();

const type = computed(() => {
  const status = props.status.toUpperCase();
  if (status === 'RUNNING') return 'success';
  if (status === 'STARTING' || status === 'STOPPING') return 'warning';
  if (status === 'FAILED') return 'danger';
  return 'info';
});

const text = computed(() => {
  const status = props.status.toUpperCase();
  if (status === 'RUNNING') return '运行中';
  if (status === 'STARTING') return '启动中';
  if (status === 'STOPPING') return '停止中';
  if (status === 'STOPPED') return '已停止';
  if (status === 'COMPLETED') return '已完成';
  if (status === 'FAILED') return '失败';
  if (status === 'BLOCKED') return '已阻塞';
  if (status === 'UNKNOWN') return '未知状态';
  return props.status.replaceAll('_', ' ');
});
</script>

<template>
  <el-tag :type="type">{{ text }}</el-tag>
</template>
