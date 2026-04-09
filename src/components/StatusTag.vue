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

const text = computed(() => props.status.replaceAll('_', ' '));
</script>

<template>
  <el-tag :type="type">{{ text }}</el-tag>
</template>
