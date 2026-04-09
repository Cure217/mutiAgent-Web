<script setup lang="ts">
import { onMounted } from 'vue';
import StatisticsCards from '@/components/StatisticsCards.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useRuntimeStore } from '@/stores/runtime';

const runtimeStore = useRuntimeStore();

onMounted(async () => {
  if (!runtimeStore.statistics) {
    await runtimeStore.refreshAll();
  }
});
</script>

<template>
  <div>
    <div class="page-header">
      <h2>总控制台</h2>
      <div class="page-toolbar">
        <el-button @click="runtimeStore.refreshAll">刷新面板</el-button>
      </div>
    </div>

    <StatisticsCards :statistics="runtimeStore.statistics" />

    <el-row :gutter="16" class="section-gap">
      <el-col :span="12">
        <el-card class="page-card">
          <template #header>运行状态</template>
          <div class="detail-meta">
            <div class="meta-card">
              <div class="meta-label">后端状态</div>
              <div class="meta-value">
                <StatusTag :status="runtimeStore.health?.status ?? 'DOWN'" />
              </div>
            </div>
            <div class="meta-card">
              <div class="meta-label">数据库路径</div>
              <div class="meta-value">{{ runtimeStore.health?.dbPath ?? '-' }}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">运行目录</div>
              <div class="meta-value">{{ runtimeStore.health?.baseDir ?? '-' }}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">最后刷新</div>
              <div class="meta-value">{{ runtimeStore.health?.timestamp ?? '-' }}</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card class="page-card">
          <template #header>受控进程</template>
          <el-table :data="runtimeStore.processes" height="300">
            <el-table-column prop="sessionId" label="会话 ID" min-width="170" />
            <el-table-column prop="pid" label="PID" width="100" />
            <el-table-column prop="startedAt" label="启动时间" min-width="180" />
            <el-table-column label="命令" min-width="220">
              <template #default="{ row }">
                <span>{{ row.command?.join(' ') }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
