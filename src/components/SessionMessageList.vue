<script setup lang="ts">
import type { MessageRecord } from '@/types/api';

defineProps<{
  messages: MessageRecord[];
}>();
</script>

<template>
  <div v-if="messages.length === 0" class="empty-tip">暂无消息</div>
  <div v-else class="message-list">
    <el-timeline>
      <el-timeline-item
        v-for="message in messages"
        :key="message.id"
        :timestamp="message.createdAt"
        placement="top"
      >
        <el-card>
          <div class="status-line">
            <el-tag size="small">{{ message.role }}</el-tag>
            <el-tag size="small" type="info">{{ message.messageType }}</el-tag>
          </div>
          <div style="margin-top: 10px; white-space: pre-wrap; word-break: break-word;">
            {{ message.contentText || message.rawChunk || '-' }}
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>
