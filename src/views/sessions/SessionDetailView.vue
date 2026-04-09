<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SessionMessageList from '@/components/SessionMessageList.vue';
import StatusTag from '@/components/StatusTag.vue';
import TerminalPanel from '@/components/TerminalPanel.vue';
import { useSessionStore } from '@/stores/sessions';

const route = useRoute();
const sessionStore = useSessionStore();
const inputText = ref('');

const sessionId = computed(() => String(route.params.id ?? ''));

onMounted(async () => {
  await sessionStore.loadDetail(sessionId.value);
  await sessionStore.ensureSocket();
});

onBeforeUnmount(() => {
  sessionStore.disconnectSocket();
});

async function send() {
  if (!inputText.value.trim()) {
    return;
  }
  try {
    await sessionStore.sendInput(sessionId.value, inputText.value);
    inputText.value = '';
  } catch (error) {
    ElMessage.error((error as Error).message);
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

    <div class="grid-two">
      <el-card class="page-card">
        <template #header>结构化消息</template>
        <SessionMessageList :messages="sessionStore.messages" />
      </el-card>

      <el-card class="page-card">
        <template #header>原始终端输出</template>
        <TerminalPanel
          :chunks="sessionStore.rawChunks"
          :session-id="sessionId"
          :interactive="sessionStore.currentSessionStatus === 'RUNNING'"
          @terminal-input="handleTerminalInput"
          @terminal-resize="handleTerminalResize"
        />
      </el-card>
    </div>

    <el-card class="page-card section-gap">
      <template #header>发送输入</template>
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="4"
        placeholder="输入要发送给当前会话的内容"
      />
      <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
        <el-button type="primary" @click="send">发送</el-button>
      </div>
    </el-card>
  </div>
</template>
