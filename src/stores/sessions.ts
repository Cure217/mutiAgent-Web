import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  createSession,
  fetchRunningSessions,
  fetchSession,
  fetchSessionMessages,
  fetchSessionMessagesAround,
  fetchSessionRawOutput,
  fetchSessionTimeline,
  fetchSessions,
  resizeSessionTerminal,
  sendSessionInput,
  stopSession,
  updateSessionWorkspaceMeta,
  type CreateSessionPayload
} from '@/api/session';
import { createSessionSocket } from '@/api/ws';
import type { AiSession, MessageRecord, SessionEventEnvelope, SessionTimelineItem, SessionWorkspaceMeta } from '@/types/api';
import { normalizeMessageText, normalizeRawLogText, normalizeTerminalText } from '@/utils/text';

export const useSessionStore = defineStore('sessions', () => {
  const items = ref<AiSession[]>([]);
  const runningItems = ref<AiSession[]>([]);
  const currentSession = ref<AiSession | null>(null);
  const messages = ref<MessageRecord[]>([]);
  const timelineItems = ref<SessionTimelineItem[]>([]);
  const rawChunks = ref<string[]>([]);
  const loading = ref(false);
  const socket = ref<WebSocket | null>(null);
  const socketConnected = ref(false);
  const highlightedMessageId = ref<string | null>(null);
  const lastSessionError = ref<string | null>(null);
  let refreshTimer: number | null = null;
  let listRefreshTimer: number | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let manualSocketDisconnect = false;
  let socketPromise: Promise<WebSocket> | null = null;

  const currentSessionStatus = computed(() => currentSession.value?.status ?? 'UNKNOWN');

  async function loadList() {
    loading.value = true;
    try {
      const pageData = await fetchSessions({ pageNo: 1, pageSize: 100 });
      items.value = pageData.items;
      runningItems.value = await fetchRunningSessions();
    } finally {
      loading.value = false;
    }
  }

  async function loadDetail(sessionId: string, options?: { messageId?: string | null }) {
    messages.value = [];
    timelineItems.value = [];
    rawChunks.value = [];
    lastSessionError.value = null;
    currentSession.value = await fetchSession(sessionId);
    const targetMessageId = options?.messageId || null;
    const messageItems = targetMessageId
      ? await fetchSessionMessagesAround(sessionId, { messageId: targetMessageId, before: 60, after: 60 })
      : await fetchAllSessionMessages(sessionId);
    messages.value = messageItems.map(normalizeMessageRecord);
    highlightedMessageId.value = targetMessageId;
    const rawOutput = await fetchSessionRawOutput(sessionId);
    rawChunks.value = rawOutput ? [normalizeRawLogText(rawOutput)] : [];
    timelineItems.value = (await fetchSessionTimeline(sessionId, { limit: 200 })).map((item) => ({
      ...item,
      content: item.content ? normalizeMessageText(item.content) : item.content
    }));
  }

  async function create(payload: CreateSessionPayload) {
    const session = await createSession(payload);
    await loadList();
    return session;
  }

  async function sendInput(sessionId: string, content: string) {
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const optimisticMessage = appendOptimisticUserMessage(sessionId, normalizedContent);
    lastSessionError.value = null;
    try {
      await sendSessionInput(sessionId, {
        content: normalizedContent,
        appendNewLine: true,
        recordInput: true
      });
      if (!socketConnected.value) {
        scheduleRefresh(sessionId);
      }
      return optimisticMessage.id;
    } catch (error) {
      markMessageFailed(optimisticMessage.id);
      throw error;
    }
  }

  async function sendRawInput(sessionId: string, content: string) {
    await sendSessionInput(sessionId, {
      content,
      appendNewLine: false,
      recordInput: false
    });
  }

  async function stop(sessionId: string) {
    await stopSession(sessionId);
    if (!socketConnected.value) {
      scheduleStatusRefresh(sessionId);
    }
  }

  async function resizeTerminal(sessionId: string, cols: number, rows: number) {
    await resizeSessionTerminal(sessionId, { cols, rows });
  }

  async function updateWorkspaceMeta(sessionId: string, payload: SessionWorkspaceMeta) {
    await updateSessionWorkspaceMeta(sessionId, payload);
    await loadList();
    if (currentSession.value?.id === sessionId) {
      await loadDetail(sessionId, { messageId: highlightedMessageId.value });
    }
  }

  async function ensureSocket() {
    if (socket.value) {
      return;
    }
    if (socketPromise) {
      await socketPromise;
      return;
    }
    manualSocketDisconnect = false;
    clearReconnectTimer();
    socketPromise = createSessionSocket({
      onMessage: handleSocketEvent,
      onOpen: () => {
        socketConnected.value = true;
        reconnectAttempt = 0;
        void loadList();
        if (currentSession.value?.id) {
          void loadDetail(currentSession.value.id, { messageId: highlightedMessageId.value });
        }
      },
      onClose: () => {
        socketConnected.value = false;
        socket.value = null;
        if (!manualSocketDisconnect) {
          scheduleSocketReconnect();
        }
      },
      onError: () => {
        socketConnected.value = false;
        if (!manualSocketDisconnect) {
          scheduleSocketReconnect();
        }
      }
    });
    try {
      socket.value = await socketPromise;
    } finally {
      socketPromise = null;
    }
  }

  function disconnectSocket() {
    manualSocketDisconnect = true;
    clearReconnectTimer();
    clearListRefreshTimer();
    if (socket.value) {
      socket.value.close();
      socket.value = null;
    }
    socketConnected.value = false;
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearListRefreshTimer() {
    if (listRefreshTimer !== null) {
      window.clearTimeout(listRefreshTimer);
      listRefreshTimer = null;
    }
  }

  function scheduleSocketReconnect() {
    if (manualSocketDisconnect || socket.value || socketPromise || reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(5000, 500 * 2 ** Math.min(reconnectAttempt, 4));
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(async () => {
      reconnectTimer = null;
      try {
        await ensureSocket();
      } catch {
        scheduleSocketReconnect();
      }
    }, delay);
  }

  function handleSocketEvent(event: SessionEventEnvelope<Record<string, unknown>>) {
    if (event.event === 'session.status.changed' || event.event === 'session.closed') {
      syncSessionStatus(
        event.sessionId,
        String(event.payload.status ?? 'UNKNOWN'),
        typeof event.payload.exitReason === 'string' ? event.payload.exitReason : undefined,
        typeof event.payload.exitCode === 'number' ? event.payload.exitCode : undefined
      );
    }

    if (event.event === 'session.workspace.updated') {
      syncWorkspaceSnapshot(event.sessionId, {
        summary: typeof event.payload.summary === 'string' ? event.payload.summary : undefined,
        tagsJson: typeof event.payload.tagsJson === 'string' ? event.payload.tagsJson : undefined,
        extraJson: typeof event.payload.extraJson === 'string' ? event.payload.extraJson : undefined
      });
    }

    if (currentSession.value?.id !== event.sessionId) {
      return;
    }

    if (event.event === 'session.error') {
      lastSessionError.value = normalizeMessageText(String(event.payload.message ?? '会话运行异常'));
      return;
    }

    if (event.event === 'session.output.raw') {
      rawChunks.value.push(normalizeTerminalText(String(event.payload.chunk ?? '')));
    }

    if (event.event === 'session.message.created') {
      const message = normalizeMessageRecord({
        id: String(event.payload.messageId ?? crypto.randomUUID()),
        sessionId: event.sessionId,
        seqNo: Number(event.payload.seqNo ?? messages.value.length + 1),
        role: String(event.payload.role ?? 'assistant'),
        messageType: String(event.payload.messageType ?? 'text'),
        contentText: String(event.payload.contentText ?? ''),
        isStructured: Boolean(event.payload.isStructured),
        createdAt: String(event.payload.createdAt ?? event.timestamp)
      });
      upsertMessage(message);
      upsertTimelineItem({
        itemId: `message-${message.id}`,
        sessionId: event.sessionId,
        messageId: message.id,
        seqNo: message.seqNo,
        itemType: 'message',
        eventType: 'message',
        title: `消息 #${message.seqNo}`,
        role: message.role,
        messageType: message.messageType,
        content: message.contentText,
        createdAt: message.createdAt
      });
    }
  }

  function syncSessionStatus(sessionId: string, status: string, exitReason?: string, exitCode?: number) {
    const hasSessionInList = items.value.some((item) => item.id === sessionId);
    items.value = items.value.map((item) => (item.id === sessionId ? { ...item, status, exitReason, exitCode } : item));
    const nextItem = items.value.find((item) => item.id === sessionId)
      ?? (currentSession.value?.id === sessionId
        ? {
            ...currentSession.value,
            status,
            exitReason: exitReason ?? currentSession.value.exitReason,
            exitCode: exitCode ?? currentSession.value.exitCode
          }
        : null);
    if (isActiveSessionStatus(status)) {
      if (runningItems.value.some((item) => item.id === sessionId)) {
        runningItems.value = runningItems.value.map((item) =>
          item.id === sessionId ? { ...item, status, exitReason, exitCode } : item
        );
      } else if (nextItem) {
        runningItems.value = [nextItem, ...runningItems.value.filter((item) => item.id !== sessionId)];
      }
    } else {
      runningItems.value = runningItems.value.filter((item) => item.id !== sessionId);
    }
    if (currentSession.value?.id === sessionId) {
      currentSession.value = {
        ...currentSession.value,
        status,
        exitReason: exitReason ?? currentSession.value.exitReason,
        exitCode: exitCode ?? currentSession.value.exitCode
      };
    }
    if (!hasSessionInList && currentSession.value?.id !== sessionId) {
      scheduleListRefresh();
    }
  }

  function syncWorkspaceSnapshot(sessionId: string, patch: Partial<AiSession>) {
    const hasSessionInList = items.value.some((item) => item.id === sessionId);
    items.value = items.value.map((item) => (item.id === sessionId ? { ...item, ...patch } : item));
    runningItems.value = runningItems.value.map((item) => (item.id === sessionId ? { ...item, ...patch } : item));
    if (currentSession.value?.id === sessionId) {
      currentSession.value = {
        ...currentSession.value,
        ...patch
      };
    }
    if (!hasSessionInList && currentSession.value?.id !== sessionId) {
      scheduleListRefresh();
    }
  }

  function normalizeMessageRecord(message: MessageRecord): MessageRecord {
    return {
      ...message,
      contentText: message.contentText ? normalizeMessageText(message.contentText) : message.contentText,
      rawChunk: message.rawChunk ? normalizeMessageText(message.rawChunk) : message.rawChunk
    };
  }

  async function fetchAllSessionMessages(sessionId: string) {
    const firstPage = await fetchSessionMessages(sessionId, { pageNo: 1, pageSize: 500 });
    if (firstPage.total <= firstPage.items.length) {
      return firstPage.items;
    }

    const expandedPageSize = Math.min(Math.max(firstPage.total, 500), 5000);
    if (expandedPageSize === firstPage.pageSize) {
      return firstPage.items;
    }

    return (await fetchSessionMessages(sessionId, { pageNo: 1, pageSize: expandedPageSize })).items;
  }

  function appendOptimisticUserMessage(sessionId: string, content: string) {
    const optimisticMessage = normalizeMessageRecord({
      id: `local-${crypto.randomUUID()}`,
      sessionId,
      seqNo: (messages.value[messages.value.length - 1]?.seqNo ?? 0) + 1,
      role: 'user',
      messageType: 'text',
      contentText: content,
      createdAt: new Date().toISOString(),
      pending: true
    });
    messages.value.push(optimisticMessage);
    sortMessages();
    return optimisticMessage;
  }

  function upsertMessage(message: MessageRecord) {
    const existingIndex = messages.value.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
      messages.value[existingIndex] = {
        ...messages.value[existingIndex],
        ...message,
        pending: false,
        failed: false
      };
      sortMessages();
      return;
    }

    const optimisticIndex = findMatchingOptimisticMessageIndex(message);
    if (optimisticIndex >= 0) {
      messages.value[optimisticIndex] = {
        ...messages.value[optimisticIndex],
        ...message,
        pending: false,
        failed: false
      };
      sortMessages();
      return;
    }

    messages.value.push({
      ...message,
      pending: false,
      failed: false
    });
    sortMessages();
  }

  function upsertTimelineItem(item: SessionTimelineItem) {
    const existingIndex = timelineItems.value.findIndex((current) => current.itemId === item.itemId);
    const normalizedItem = {
      ...item,
      content: item.content ? normalizeMessageText(item.content) : item.content
    };
    if (existingIndex >= 0) {
      timelineItems.value[existingIndex] = normalizedItem;
      sortTimelineItems();
      return;
    }
    timelineItems.value.push(normalizedItem);
    sortTimelineItems();
  }

  function markMessageFailed(messageId: string) {
    const targetIndex = messages.value.findIndex((item) => item.id === messageId);
    if (targetIndex < 0) {
      return;
    }
    messages.value[targetIndex] = {
      ...messages.value[targetIndex],
      pending: false,
      failed: true
    };
  }

  function findMatchingOptimisticMessageIndex(message: MessageRecord) {
    let latestFailedIndex = -1;
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const item = messages.value[index];
      const isSameLogicalMessage = item.id.startsWith('local-')
        && item.role === message.role
        && item.messageType === message.messageType
        && item.contentText === message.contentText;

      if (!isSameLogicalMessage) {
        continue;
      }
      if (item.pending) {
        return index;
      }
      if (item.failed && latestFailedIndex < 0) {
        latestFailedIndex = index;
      }
    }
    return latestFailedIndex;
  }

  function sortMessages() {
    messages.value = [...messages.value].sort((left, right) => {
      if ((left.seqNo ?? 0) !== (right.seqNo ?? 0)) {
        return (left.seqNo ?? 0) - (right.seqNo ?? 0);
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  function sortTimelineItems() {
    timelineItems.value = [...timelineItems.value].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  function scheduleRefresh(sessionId: string) {
    if (currentSession.value?.id !== sessionId) {
      return;
    }
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = null;
      try {
        await loadDetail(sessionId);
      } catch {
      }
    }, 800);
  }

  function scheduleStatusRefresh(sessionId: string) {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = null;
      try {
        await loadList();
        if (currentSession.value?.id === sessionId) {
          await loadDetail(sessionId, { messageId: highlightedMessageId.value });
        }
      } catch {
      }
    }, 1800);
  }

  function scheduleListRefresh(delay = 600) {
    if (listRefreshTimer !== null) {
      window.clearTimeout(listRefreshTimer);
    }
    listRefreshTimer = window.setTimeout(async () => {
      listRefreshTimer = null;
      try {
        await loadList();
      } catch {
      }
    }, delay);
  }

  function isActiveSessionStatus(status?: string | null) {
    return ['STARTING', 'RUNNING', 'STOPPING'].includes((status || '').toUpperCase());
  }

  return {
    items,
    runningItems,
    currentSession,
    currentSessionStatus,
    messages,
    timelineItems,
    rawChunks,
    loading,
    socketConnected,
    highlightedMessageId,
    lastSessionError,
    loadList,
    loadDetail,
    create,
    sendInput,
    sendRawInput,
    updateWorkspaceMeta,
    resizeTerminal,
    stop,
    ensureSocket,
    disconnectSocket
  };
});
