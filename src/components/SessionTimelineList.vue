<script setup lang="ts">
import type { SessionTimelineItem } from '@/types/api';

defineProps<{
  items: SessionTimelineItem[];
  highlightMessageId?: string | null;
}>();

const emit = defineEmits<{
  jumpToMessage: [messageId: string];
}>();

function handleJump(messageId?: string | null) {
  if (!messageId) {
    return;
  }
  emit('jumpToMessage', messageId);
}
</script>

<template>
  <div v-if="items.length === 0" class="empty-tip">暂无时间线数据</div>
  <div v-else class="timeline-list">
    <el-timeline>
      <el-timeline-item
        v-for="item in items"
        :key="item.itemId"
        :timestamp="item.createdAt"
        placement="top"
      >
        <el-card :class="{ 'is-highlighted': highlightMessageId && item.messageId === highlightMessageId }">
          <div class="status-line">
            <el-tag size="small" :type="item.itemType === 'message' ? 'primary' : 'info'">
              {{ item.itemType === 'message' ? '消息' : '会话事件' }}
            </el-tag>
            <el-tag v-if="item.role" size="small">{{ item.role }}</el-tag>
            <el-tag v-if="item.messageType" size="small" type="info">{{ item.messageType }}</el-tag>
          </div>
          <div class="timeline-title">{{ item.title }}</div>
          <div v-if="item.content" class="timeline-content">{{ item.content }}</div>
          <div v-if="item.messageId" class="timeline-actions">
            <el-button link type="primary" @click="handleJump(item.messageId)">定位到该消息</el-button>
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>

<style scoped>
.timeline-title {
  margin-top: 10px;
  font-weight: 600;
}

.timeline-content {
  margin-top: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-regular);
}

.timeline-actions {
  margin-top: 10px;
}

.is-highlighted {
  border: 1px solid var(--el-color-primary);
  box-shadow: 0 0 0 2px rgb(64 158 255 / 15%);
}
</style>
