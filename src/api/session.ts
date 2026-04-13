import type { AiSession, MessageRecord, PageData, SessionTimelineItem, SessionWorkspaceMeta } from '@/types/api';
import { getHttpClient } from './http';

export interface CreateSessionPayload {
  appInstanceId: string;
  title?: string;
  projectPath?: string;
  interactionMode?: string;
  initInput?: string;
  tags?: string[];
  workspaceMeta?: SessionWorkspaceMeta;
}

export async function fetchSessions(params?: {
  appInstanceId?: string;
  status?: string;
  keyword?: string;
  pageNo?: number;
  pageSize?: number;
}) {
  const client = await getHttpClient();
  return client.get<never, PageData<AiSession>>('/sessions', { params });
}

export async function fetchRunningSessions() {
  const client = await getHttpClient();
  return client.get<never, AiSession[]>('/sessions/running');
}

export async function fetchSession(id: string) {
  const client = await getHttpClient();
  return client.get<never, AiSession>(`/sessions/${id}`);
}

export async function createSession(payload: CreateSessionPayload) {
  const client = await getHttpClient();
  return client.post<never, AiSession>('/sessions', payload);
}

export async function sendSessionInput(
  id: string,
  payload: { content: string; appendNewLine?: boolean; recordInput?: boolean }
) {
  const client = await getHttpClient();
  return client.post(`/sessions/${id}/input`, payload);
}

export async function stopSession(id: string, stopMode = 'graceful') {
  const client = await getHttpClient();
  return client.post(`/sessions/${id}/stop`, { stopMode });
}

export async function fetchSessionMessages(id: string, params?: { pageNo?: number; pageSize?: number }) {
  const client = await getHttpClient();
  return client.get<never, PageData<MessageRecord>>(`/sessions/${id}/messages`, { params });
}

export async function fetchSessionMessagesAround(
  id: string,
  params: { messageId: string; before?: number; after?: number }
) {
  const client = await getHttpClient();
  return client.get<never, MessageRecord[]>(`/sessions/${id}/messages/around`, { params });
}

export async function fetchSessionRawOutput(id: string) {
  const client = await getHttpClient();
  return client.get<never, string>(`/sessions/${id}/raw-output`);
}

export async function fetchSessionTimeline(id: string, params?: { limit?: number }) {
  const client = await getHttpClient();
  return client.get<never, SessionTimelineItem[]>(`/sessions/${id}/timeline`, { params });
}

export async function resizeSessionTerminal(id: string, payload: { cols: number; rows: number }) {
  const client = await getHttpClient();
  return client.post(`/sessions/${id}/terminal/resize`, payload);
}

export async function fetchSessionWorkspaceMeta(id: string) {
  const client = await getHttpClient();
  return client.get<never, SessionWorkspaceMeta>(`/sessions/${id}/workspace-meta`);
}

export async function updateSessionWorkspaceMeta(
  id: string,
  payload: SessionWorkspaceMeta
) {
  const client = await getHttpClient();
  return client.post<never, SessionWorkspaceMeta>(`/sessions/${id}/workspace-meta`, payload);
}
