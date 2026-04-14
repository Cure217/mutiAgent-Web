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

type MessagePresentation = {
  items: DisplayMessage[];
  hiddenRawCount: number;
};

function isPromptEcho(line: string, lastUserText: string) {
  if (!line || !lastUserText) {
    return false;
  }

  return lastUserText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .some((userLine) =>
      line === userLine
      || userLine.startsWith(line)
      || line.startsWith(userLine)
      || (line.length <= 8 && userLine.includes(line))
    );
}

function stripPromptEcho(displayText: string, lastUserText: string) {
  if (!displayText || !lastUserText) {
    return displayText;
  }

  return displayText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isPromptEcho(line, lastUserText))
    .join('\n')
    .trim();
}

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

function stripSpeakerPrefix(text: string) {
  return text.replace(/^(?:bot|assistant|回复|答复|助手)\s*[:：]\s*/i, '').trim();
}

function normalizeForComparison(text: string) {
  return stripSpeakerPrefix(normalizeMessageText(text))
    .replace(/[\s`"'“”‘’·•:：,，。.!！？?；;（）()\[\]【】<>《》、\-_/\\|]/g, '')
    .toLowerCase();
}

function isAssistantEcho(displayText: string, lastUserText: string) {
  const normalizedDisplay = normalizeForComparison(displayText);
  const normalizedUser = normalizeForComparison(lastUserText);
  if (!normalizedDisplay || !normalizedUser) {
    return false;
  }

  if (normalizedDisplay === normalizedUser) {
    return true;
  }

  if (normalizedDisplay.includes(normalizedUser) && normalizedDisplay.length <= normalizedUser.length + 20) {
    return true;
  }

  if (normalizedUser.includes(normalizedDisplay) && normalizedDisplay.length >= Math.max(4, normalizedUser.length * 0.5)) {
    return true;
  }

  return false;
}

function refineAssistantRawText(rawText: string, lastUserText: string) {
  const codexCleaned = cleanupCodexTuiMessage(rawText);
  const baseText = codexCleaned || normalizeMessageText(rawText);
  const withoutReady = baseText.replace(/(^|\n)READY\b/g, '\n').trim();
  const filteredLines = withoutReady
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^ready$/i.test(line))
    .filter((line) => !isPromptEcho(stripSpeakerPrefix(line), lastUserText));

  const refined = filteredLines.join('\n').trim();
  if (!refined) {
    return '';
  }
  if (isAssistantEcho(refined, lastUserText)) {
    return '';
  }
  return refined;
}

const presentation = computed<MessagePresentation>(() => {
  const result: DisplayMessage[] = [];
  let activeAssistantGroup: DisplayMessage | null = null;
  let lastUserText = '';
  let hiddenRawCount = 0;

  for (const message of props.messages) {
    const rawText = message.contentText || message.rawChunk || '';
    const normalizedRawText = normalizeMessageText(rawText);
    const displayText = message.role === 'assistant' && message.messageType === 'raw'
      ? refineAssistantRawText(rawText, lastUserText)
      : normalizedRawText;

    if (!displayText && !message.pending && !message.failed) {
      if (message.role === 'user') {
        lastUserText = normalizedRawText;
      }
      if (message.role === 'assistant' && message.messageType === 'raw') {
        hiddenRawCount += 1;
      }
      continue;
    }

    const nextItem: DisplayMessage = {
      ...message,
      displayText: displayText || normalizedRawText || '-',
      domId: message.id,
      mergedCount: 1
    };

    const mergeIntoAssistantGroup = message.role === 'assistant'
      && message.messageType === 'raw'
      && !message.pending
      && !message.failed;

    if (!mergeIntoAssistantGroup) {
      if (message.role === 'user') {
        lastUserText = normalizedRawText;
      }
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

  return {
    items: result.filter((item) => item.displayText || item.pending || item.failed),
    hiddenRawCount
  };
});

const visibleMessages = computed(() => presentation.value.items);
const hiddenRawCount = computed(() => presentation.value.hiddenRawCount);

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
  <div v-else class="message-board">
    <el-alert
      v-if="hiddenRawCount > 0"
      class="message-filter-tip"
      type="info"
      :closable="false"
      show-icon
      :title="`已隐藏 ${hiddenRawCount} 条明显原始回显/终端噪音；完整内容可在“辅助观察区 · 原始终端”查看。`"
    />
    <div class="message-list">
      <div
        v-for="message in visibleMessages"
        :key="message.id"
        class="message-row"
        :class="`is-${message.role}`"
      >
        <el-card
          :id="`message-${message.domId}`"
          class="message-card"
          :class="[
            `message-card--${message.role}`,
            { 'is-highlighted': highlightMessageId === message.domId }
          ]"
        >
          <div class="message-meta">
            <div class="message-meta__left">
              <span class="message-author">
                {{ message.role === 'user' ? '架构师指令' : (message.role === 'assistant' ? '子窗口输出' : '系统事件') }}
              </span>
              <el-tag size="small" type="info">{{ message.messageType }}</el-tag>
              <el-tag v-if="message.mergedCount > 1" size="small" type="success">
                合并 {{ message.mergedCount }} 条
              </el-tag>
              <el-tag v-if="message.pending" size="small" type="warning">发送中</el-tag>
              <el-tag v-if="message.failed" size="small" type="danger">发送失败</el-tag>
            </div>
            <span class="message-time">{{ message.createdAt }}</span>
          </div>
          <div class="message-content">
            {{ message.displayText }}
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-board {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-filter-tip {
  border-radius: 14px;
}

.message-list {
  max-height: clamp(520px, 68vh, 760px);
  overflow: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.message-row {
  display: flex;
}

.message-row.is-user {
  justify-content: flex-end;
}

.message-row.is-system {
  justify-content: center;
}

.message-card {
  border-radius: 14px;
  width: min(100%, 920px);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: none;
}

.message-card--assistant {
  background: rgba(96, 165, 250, 0.08);
  border-left: 3px solid #60a5fa;
}

.message-card--user {
  background: rgba(52, 211, 153, 0.08);
  border-left: 3px solid #34d399;
}

.message-card--system {
  background: rgba(148, 163, 184, 0.10);
  border-left: 3px solid #94a3b8;
}

.message-meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.message-meta__left {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.message-author {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.message-time {
  font-size: 12px;
  color: #64748b;
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

@media (max-width: 960px) {
  .message-card {
    width: 100%;
  }
}
</style>
