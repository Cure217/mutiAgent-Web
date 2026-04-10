<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SessionMessageList from '@/components/SessionMessageList.vue';
import SessionTimelineList from '@/components/SessionTimelineList.vue';
import StatusTag from '@/components/StatusTag.vue';
import TerminalPanel from '@/components/TerminalPanel.vue';
import { useSessionStore } from '@/stores/sessions';

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();
const inputText = ref('');
const sending = ref(false);

const sessionId = computed(() => String(route.params.id ?? ''));
const focusMessageId = computed(() => {
  const raw = route.query.messageId;
  return typeof raw === 'string' && raw ? raw : null;
});
const inferredBlockingReason = computed(() => {
  const text = sessionStore.messages.map((item) => item.contentText || item.rawChunk || '').join('\n');
  if (
    text.includes('wsl.exe [参数]')
    || text.includes('适用于 Linux 的 Windows 子系统功能')
    || text.includes('wsl --install')
  ) {
    return '当前会话启动失败：本机 WSL 未安装或未配置默认发行版，因此无法发送新消息。请先完成 WSL 初始化，或改用 Windows 运行环境实例。';
  }
  return sessionStore.currentSession?.exitReason || null;
});
const canSend = computed(() => sessionStore.currentSessionStatus === 'RUNNING' && !!inputText.value.trim() && !sending.value);
const sendDisabledReason = computed(() => {
  if (sending.value) {
    return '消息发送中，请稍候';
  }
  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    return inferredBlockingReason.value
      ? `当前会话状态为 ${sessionStore.currentSessionStatus}：${inferredBlockingReason.value}`
      : `当前会话状态为 ${sessionStore.currentSessionStatus}，暂不支持继续发送`;
  }
  if (!inputText.value.trim()) {
    return '输入内容后可发送，Enter 发送，Shift+Enter 换行';
  }
  return 'Enter 发送，Shift+Enter 换行';
});
const inputPlaceholder = computed(() =>
  sessionStore.currentSessionStatus === 'RUNNING'
    ? '输入消息后按 Enter 发送，Shift+Enter 换行'
    : '当前会话未运行，无法发送新消息'
);

async function loadCurrentSession() {
  await sessionStore.loadDetail(sessionId.value, { messageId: focusMessageId.value });
}

onMounted(async () => {
  await loadCurrentSession();
  await sessionStore.ensureSocket();
});

watch(
  () => [sessionId.value, focusMessageId.value],
  async ([nextSessionId, nextMessageId], [previousSessionId, previousMessageId]) => {
    if (nextSessionId === previousSessionId && nextMessageId === previousMessageId) {
      return;
    }
    await loadCurrentSession();
  }
);

onBeforeUnmount(() => {
  sessionStore.disconnectSocket();
});

async function send() {
  const content = inputText.value.replace(/\r\n/g, '\n');
  if (!content.trim() || sending.value) {
    return;
  }
  sending.value = true;
  try {
    await sessionStore.sendInput(sessionId.value, content);
    inputText.value = '';
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    sending.value = false;
  }
}

async function handleTerminalInput(data: string) {
  if (!data) {
    return;
  }
  try {
    await sessionStore.sendRawInput(sessionId.value, data);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function handleTerminalResize(size: { cols: number; rows: number }) {
  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    return;
  }
  try {
    await sessionStore.resizeTerminal(sessionId.value, size.cols, size.rows);
  } catch {
  }
}

async function stop() {
  try {
    await sessionStore.stop(sessionId.value);
    ElMessage.success('停止命令已发送');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function openRawLog() {
  const rawLogPath = sessionStore.currentSession?.rawLogPath;
  if (!rawLogPath || !window.desktopBridge) {
    return;
  }
  await window.desktopBridge.openPath(rawLogPath);
}

async function jumpToMessage(messageId: string) {
  await router.replace({
    path: `/sessions/${sessionId.value}`,
    query: {
      ...route.query,
      messageId
    }
  });
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h2>{{ sessionStore.currentSession?.title ?? '会话详情' }}</h2>
      <div class="page-toolbar">
        <StatusTag :status="sessionStore.currentSessionStatus" />
        <el-tag :type="sessionStore.socketConnected ? 'success' : 'warning'">
          {{ sessionStore.socketConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}
        </el-tag>
        <el-button @click="openRawLog">打开原始日志</el-button>
        <el-button type="danger" @click="stop">停止会话</el-button>
      </div>
    </div>

    <el-card class="page-card composer-card">
      <template #header>发送输入</template>
      <div class="composer-box">
        <el-alert
          v-if="sessionStore.currentSessionStatus !== 'RUNNING'"
          :title="sendDisabledReason"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-alert
          v-else-if="sessionStore.lastSessionError"
          :title="sessionStore.lastSessionError"
          type="error"
          :closable="false"
          show-icon
        />
        <el-input
          v-model="inputText"
          class="composer-input"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          :disabled="sessionStore.currentSessionStatus !== 'RUNNING' || sending"
          :placeholder="inputPlaceholder"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-footer">
          <span class="composer-tip">{{ sendDisabledReason }}</span>
          <el-button
            type="primary"
            :loading="sending"
            :disabled="!canSend"
            @click="send"
          >
            发送
          </el-button>
        </div>
      </div>
    </el-card>

    <div class="detail-meta">
      <div class="meta-card">
        <div class="meta-label">会话 ID</div>
        <div class="meta-value">{{ sessionStore.currentSession?.id ?? '-' }}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">实例 ID</div>
        <div class="meta-value">{{ sessionStore.currentSession?.appInstanceId ?? '-' }}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">PID</div>
        <div class="meta-value">{{ sessionStore.currentSession?.pid ?? '-' }}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">项目目录</div>
        <div class="meta-value">{{ sessionStore.currentSession?.projectPath ?? '-' }}</div>
      </div>
    </div>

    <div class="session-panels">
      <el-card class="page-card panel-card panel-card--terminal">
        <template #header>原始终端输出</template>
        <TerminalPanel
          :chunks="sessionStore.rawChunks"
          :session-id="sessionId"
          :interactive="sessionStore.currentSessionStatus === 'RUNNING'"
          @terminal-input="handleTerminalInput"
          @terminal-resize="handleTerminalResize"
        />
      </el-card>

      <el-card class="page-card panel-card panel-card--messages">
        <template #header>结构化消息</template>
        <SessionMessageList
          :messages="sessionStore.messages"
          :highlight-message-id="sessionStore.highlightedMessageId"
        />
      </el-card>
    </div>

    <el-card class="page-card section-gap">
      <template #header>会话时间线</template>
      <SessionTimelineList
        :items="sessionStore.timelineItems"
        :highlight-message-id="sessionStore.highlightedMessageId"
        @jump-to-message="jumpToMessage"
      />
    </el-card>
  </div>
</template>

<style scoped>
.composer-card {
  margin-bottom: 16px;
}

.session-panels {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(360px, 0.95fr);
  gap: 16px;
}

.panel-card :deep(.el-card__header) {
  font-weight: 600;
}

.panel-card--terminal :deep(.terminal-wrapper) {
  min-height: clamp(520px, 68vh, 760px);
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.composer-input :deep(textarea) {
  line-height: 1.7;
  font-size: 14px;
}

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.composer-tip {
  color: #6b7280;
  font-size: 13px;
}

@media (max-width: 1500px) {
  .session-panels {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
