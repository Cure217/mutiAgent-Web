import { resolveBackendBaseUrl } from './http';
import type { SessionEventEnvelope } from '@/types/api';

export interface SessionSocketHandlers {
  onMessage: (message: SessionEventEnvelope) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export async function createSessionSocket(handlers: SessionSocketHandlers): Promise<WebSocket> {
  const baseUrl = await resolveBackendBaseUrl();
  const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/ws/sessions';
  const socket = new WebSocket(wsUrl);

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
