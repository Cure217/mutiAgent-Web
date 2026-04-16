import { resolveBackendBaseUrl } from './http';
import type { SessionEventEnvelope } from '@/types/api';

export interface SessionSocketHandlers {
  onMessage: (message: SessionEventEnvelope) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export interface SessionSocketOptions {
  clientId?: string;
  targetType?: string;
  targetId?: string | null;
}

export async function createSessionSocket(
  handlers: SessionSocketHandlers,
  options: SessionSocketOptions = {}
): Promise<WebSocket> {
  const baseUrl = await resolveBackendBaseUrl();
  const wsUrl = new URL(baseUrl.replace(/^http/i, 'ws') + '/ws/sessions');
  if (options.clientId) {
    wsUrl.searchParams.set('clientId', options.clientId);
  }
  if (options.targetId) {
    wsUrl.searchParams.set('targetId', options.targetId);
    wsUrl.searchParams.set('targetType', options.targetType || 'session');
  }
  const socket = new WebSocket(wsUrl.toString());

  socket.addEventListener('open', () => handlers.onOpen?.());
  socket.addEventListener('close', () => handlers.onClose?.());
  socket.addEventListener('error', (event) => handlers.onError?.(event));
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as SessionEventEnvelope;
      handlers.onMessage(payload);
    } catch (error) {
      console.error('WebSocket 消息解析失败', error);
    }
  });

  return socket;
}
