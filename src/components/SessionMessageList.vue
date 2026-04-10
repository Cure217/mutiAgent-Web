<script setup lang="ts">
import { computed, nextTick, watch } from 'vue';
import type { MessageRecord } from '@/types/api';
import { cleanupCodexTuiMessage, normalizeMessageText } from '@/utils/text';

const props = defineProps<{
  messages: MessageRecord[];
  highlightMessageId?: string | null;
}>();

type DisplayMessage = MessageRecord & {
  displayText: string;
  domId: string;
  mergedCount: number;
};

function mergeDisplayText(currentText: string, nextText: string) {
  if (!nextText) {
    return currentText;
  }
  if (!currentText || currentText === nextText) {
    return nextText;
  }
  if (currentText.includes(nextText)) {
    return currentText;
  }

  const currentLines = currentText.split('\n');
  const nextLines = nextText.split('\n');
  if (currentLines[currentLines.length - 1] === nextLines[0]) {
    return [...currentLines, ...nextLines.slice(1)].join('\n').trim();
  }

  return `${currentText}\n${nextText}`.replace(/\n{3,}/g, '\n\n').trim();
}

const visibleMessages = computed<DisplayMessage[]>(() => {
  const result: DisplayMessage[] = [];
  let activeAssistantGroup: DisplayMessage | null = null;

  for (const message of props.messages) {
    const rawText = message.contentText || message.rawChunk || '';
    const displayText = message.role === 'assistant' && message.messageType === 'raw'
      ? cleanupCodexTuiMessage(rawText)
      : normalizeMessageText(rawText);

    if (!displayText && !message.pending && !message.failed) {
      continue;
    }

    const nextItem: DisplayMessage = {
      ...message,
      displayText: displayText || normalizeMessageText(rawText) || '-',
      domId: message.id,
      mergedCount: 1
    };

    const mergeIntoAssistantGroup = message.role === 'assistant'
      && message.messageType === 'raw'
      && !message.pending
      && !message.failed;

    if (!mergeIntoAssistantGroup) {
      activeAssistantGroup = null;
      result.push(nextItem);
      continue;
    }

    if (!activeAssistantGroup) {
      activeAssistantGroup = nextItem;
      result.push(nextItem);
      continue;
    }

    activeAssistantGroup.displayText = mergeDisplayText(activeAssistantGroup.displayText, nextItem.displayText);
    activeAssistantGroup.mergedCount += 1;
    activeAssistantGroup.seqNo = nextItem.seqNo;
    if (props.highlightMessageId && props.highlightMessageId === message.id) {
      activeAssistantGroup.domId = message.id;
    }
  }

  return result.filter((item) => item.displayText || item.pending || item.failed);
});

function scrollToLatestMessage() {
  nextTick(() => {
    const messageElements = document.querySelectorAll('.message-card');
    const lastElement = messageElements.item(messageElements.length - 1) as HTMLElement | null;
    lastElement?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

function scrollToHighlightedMessage() {
  if (!props.highlightMessageId) {
    scrollToLatestMessage();
    return;
  }
  nextTick(() => {
    const element = document.getElementById(`message-${props.highlightMessageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

watch(
  () => [props.highlightMessageId, visibleMessages.value.length],
  () => {
    scrollToHighlightedMessage();
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="visibleMessages.length === 0" class="empty-tip">暂无可展示消息</div>
  <div v-else class="message-list">
    <el-timeline>
      <el-timeline-item
        v-for="message in visibleMessages"
        :key="message.id"
        :timestamp="message.createdAt"
        placement="top"
      >
        <el-card
          :id="`message-${message.domId}`"
          class="message-card"
          :class="[
            `message-card--${message.role}`,
            { 'is-highlighted': highlightMessageId === message.domId }
          ]"
        >
          <div class="status-line">
            <el-tag size="small">{{ message.role }}</el-tag>
            <el-tag size="small" type="info">{{ message.messageType }}</el-tag>
            <el-tag v-if="message.mergedCount > 1" size="small" type="success">
              合并 {{ message.mergedCount }} 条
            </el-tag>
            <el-tag v-if="message.pending" size="small" type="warning">发送中</el-tag>
            <el-tag v-if="message.failed" size="small" type="danger">发送失败</el-tag>
          </div>
          <div class="message-content">
            {{ message.displayText }}
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>

<style scoped>
.message-list {
  max-height: clamp(520px, 68vh, 760px);
  overflow: auto;
  padding-right: 4px;
}

.message-card {
  border-radius: 14px;
}

.message-card--assistant {
  border-left: 3px solid #60a5fa;
}

.message-card--user {
  border-left: 3px solid #34d399;
}

.status-line {
  flex-wrap: wrap;
  row-gap: 8px;
}

.message-content {
  margin-top: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

.is-highlighted {
  border: 1px solid var(--el-color-primary);
  box-shadow: 0 0 0 2px rgb(64 158 255 / 15%);
}
</style>
