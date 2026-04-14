<script setup lang="ts">
import StatusTag from '@/components/StatusTag.vue';
import type { AgentWorkspaceSummary } from '@/utils/architectConsole';

defineProps<{
  summary: AgentWorkspaceSummary;
  selected?: boolean;
}>();

function resolveCoordinationTagType(tone: AgentWorkspaceSummary['coordinationTone']) {
  return tone;
}

const emit = defineEmits<{
  select: [];
  openDetail: [];
  stop: [];
}>();
</script>

<template>
  <article class="workspace-card" :class="{ 'is-selected': selected }" @click="emit('select')">
    <header class="workspace-header">
      <div class="window-dots" aria-hidden="true">
        <span class="window-dot window-dot--danger" />
        <span class="window-dot window-dot--warning" />
        <span class="window-dot window-dot--success" />
      </div>
      <div class="workspace-role">
        <span class="workspace-role-emoji">{{ summary.role.emoji }}</span>
        <div>
          <div class="workspace-role-label">{{ summary.role.label }}</div>
          <div class="workspace-kind">{{ summary.workspaceKindLabel }}</div>
        </div>
      </div>
      <el-tag :type="resolveCoordinationTagType(summary.coordinationTone)">{{ summary.coordinationLabel }}</el-tag>
    </header>

    <div class="workspace-body">
      <div class="workspace-title">{{ summary.title }}</div>
      <div class="workspace-subtitle">{{ summary.instanceName }} · {{ summary.appType === 'unknown' ? '未标注类型' : summary.appType }}</div>
      <div class="workspace-progress">{{ summary.progressHint }}</div>
      <div class="workspace-meta">
        <span class="workspace-meta-item">进程：<StatusTag :status="summary.session.status" /></span>
        <span>最近活跃：{{ summary.lastActiveText }}</span>
      </div>
      <div class="workspace-project">{{ summary.projectPath }}</div>
      <div class="workspace-dependencies">
        <span class="workspace-dependencies-label">依赖</span>
        <span v-if="summary.dependencyLabels.length === 0" class="workspace-dependency-empty">无</span>
        <span
          v-for="dependency in summary.dependencyLabels"
          :key="dependency"
          class="workspace-dependency-chip"
        >
          {{ dependency }}
        </span>
      </div>
    </div>

    <footer class="workspace-footer">
      <el-button link type="primary" @click.stop="emit('openDetail')">打开详情</el-button>
      <el-button
        link
        type="danger"
        :disabled="!summary.canStop"
        @click.stop="emit('stop')"
      >
        关闭子窗口
      </el-button>
    </footer>
  </article>
</template>

<style scoped>
.workspace-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 240px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(255, 255, 255, 1) 100%);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.workspace-card:hover {
  transform: translateY(-2px);
  border-color: rgba(59, 130, 246, 0.28);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.1);
}

.workspace-card.is-selected {
  border-color: rgba(59, 130, 246, 0.45);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12), 0 16px 32px rgba(59, 130, 246, 0.12);
}

.workspace-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.window-dots {
  display: flex;
  gap: 6px;
}

.window-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.window-dot--danger {
  background: #fb7185;
}

.window-dot--warning {
  background: #fbbf24;
}

.window-dot--success {
  background: #4ade80;
}

.workspace-role {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.workspace-role-emoji {
  font-size: 20px;
}

.workspace-role-label {
  font-weight: 700;
  color: #0f172a;
}

.workspace-kind {
  font-size: 12px;
  color: #64748b;
}

.workspace-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
}

.workspace-title {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.workspace-subtitle {
  font-size: 13px;
  color: #475569;
}

.workspace-progress {
  display: -webkit-box;
  overflow: hidden;
  color: #334155;
  line-height: 1.7;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.workspace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: #64748b;
}

.workspace-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.workspace-project {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.04);
  color: #334155;
  font-size: 12px;
  word-break: break-all;
}

.workspace-dependencies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.workspace-dependencies-label {
  font-size: 12px;
  font-weight: 700;
  color: #475569;
}

.workspace-dependency-chip,
.workspace-dependency-empty {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #334155;
  background: rgba(148, 163, 184, 0.14);
}

.workspace-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
