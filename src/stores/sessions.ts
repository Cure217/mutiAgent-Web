import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  createSession,
  fetchRunningSessions,
  fetchSession,
  fetchSessionMessages,
  fetchSessions,
  sendSessionInput,
  stopSession,
  type CreateSessionPayload
} from '@/api/session';
import { createSessionSocket } from '@/api/ws';
import type { AiSession, MessageRecord, SessionEventEnvelope } from '@/types/api';

export const useSessionStore = defineStore('sessions', () => {
  const items = ref<AiSession[]>([]);
  const runningItems = ref<AiSession[]>([]);
  const currentSession = ref<AiSession | null>(null);
  const messages = ref<MessageRecord[]>([]);
  const rawChunks = ref<string[]>([]);
  const loading = ref(false);
  const socket = ref<WebSocket | null>(null);
  const socketConnected = ref(false);

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

  async function loadDetail(sessionId: string) {
    currentSession.value = await fetchSession(sessionId);
    const pageData = await fetchSessionMessages(sessionId, { pageNo: 1, pageSize: 500 });
    messages.value = pageData.items;
    rawChunks.value = pageData.items
      .filter((item) => item.rawChunk)
      .map((item) => item.rawChunk ?? '');
  }

  async function create(payload: CreateSessionPayload) {
    const session = await createSession(payload);
    await loadList();
    return session;
  }

  async function sendInput(sessionId: string, content: string) {
    await sendSessionInput(sessionId, {
      content,
      appendNewLine: true
    });
  }

  async function stop(sessionId: string) {
    await stopSession(sessionId);
  }

  async function ensureSocket() {
    if (socket.value) {
      return;
    }
    socket.value = await createSessionSocket({
      onMessage: handleSocketEvent,
      onOpen: () => {
        socketConnected.value = true;
      },
      onClose: () => {
        socketConnected.value = false;
        socket.value = null;
      },
      onError: () => {
        socketConnected.value = false;
      }
    });
  }

  function disconnectSocket() {
    if (socket.value) {
      socket.value.close();
      socket.value = null;
    }
    socketConnected.value = false;
  }

  function handleSocketEvent(event: SessionEventEnvelope<Record<string, unknown>>) {
    if (event.event === 'session.status.changed' || event.event === 'session.closed') {
      syncSessionStatus(event.sessionId, String(event.payload.status ?? 'UNKNOWN'));
    }

    if (currentSession.value?.id !== event.sessionId) {
      return;
    }

    if (event.event === 'session.output.raw') {
      rawChunks.value.push(String(event.payload.chunk ?? ''));
    }

    if (event.event === 'session.message.created') {
      messages.value.push({
        id: String(event.payload.messageId ?? crypto.randomUUID()),
        sessionId: event.sessionId,
        seqNo: messages.value.length + 1,
        role: String(event.payload.role ?? 'assistant'),
        messageType: String(event.payload.messageType ?? 'text'),
        contentText: String(event.payload.contentText ?? ''),
        isStructured: Boolean(event.payload.isStructured),
        createdAt: String(event.payload.createdAt ?? event.timestamp)
      });
    }
  }

  function syncSessionStatus(sessionId: string, status: string) {
    items.value = items.value.map((item) => (item.id === sessionId ? { ...item, status } : item));
    runningItems.value = runningItems.value.map((item) => (item.id === sessionId ? { ...item, status } : item));
    if (currentSession.value?.id === sessionId) {
      currentSession.value = {
        ...currentSession.value,
        status
      };
    }
  }

  return {
    items,
    runningItems,
    currentSession,
    currentSessionStatus,
    messages,
    rawChunks,
    loading,
    socketConnected,
    loadList,
    loadDetail,
    create,
    sendInput,
    stop,
    ensureSocket,
    disconnectSocket
  };
});
