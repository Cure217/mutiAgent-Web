import type { AiSession, SessionWorkspaceMeta } from '@/types/api';
import { getHttpClient } from './http';

export interface WorkspaceDispatchCreateCommandPayload {
  appInstanceId: string;
  title?: string;
  projectPath?: string;
  interactionMode?: string;
  initInput?: string;
  tags?: string[];
  workspaceMeta?: SessionWorkspaceMeta;
  detail?: Record<string, unknown>;
}

export interface WorkspaceDispatchExistingCommandPayload {
  sessionId: string;
  content: string;
  appendNewLine?: boolean;
  recordInput?: boolean;
  workspaceMeta?: SessionWorkspaceMeta;
  detail?: Record<string, unknown>;
}

export interface WorkspaceSummaryApplyCommandPayload {
  targetSessionId?: string;
  detail?: Record<string, unknown>;
}

export async function dispatchWorkspaceCreate(payload: WorkspaceDispatchCreateCommandPayload) {
  const client = await getHttpClient();
  return client.post<never, AiSession>('/workspace-commands/dispatch/create', payload);
}

export async function dispatchWorkspaceExisting(payload: WorkspaceDispatchExistingCommandPayload) {
  const client = await getHttpClient();
  return client.post('/workspace-commands/dispatch/existing', payload);
}

export async function applyWorkspaceSummary(payload: WorkspaceSummaryApplyCommandPayload) {
  const client = await getHttpClient();
  return client.post('/workspace-commands/summary/apply', payload);
}
