import type { AppInstance } from '@/types/api';
import { getHttpClient } from './http';

export interface InstancePayload {
  name: string;
  appType: string;
  adapterType?: string;
  runtimeEnv: string;
  launchMode: string;
  executablePath?: string;
  launchCommand: string;
  args?: string[];
  workdir?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  autoRestart?: boolean;
  remark?: string;
}

export async function fetchInstances(params?: {
  appType?: string;
  enabled?: boolean;
  keyword?: string;
}) {
  const client = await getHttpClient();
  return client.get<never, AppInstance[]>('/instances', { params });
}

export async function createInstance(payload: InstancePayload) {
  const client = await getHttpClient();
  return client.post<never, AppInstance>('/instances', payload);
}

export async function updateInstance(id: string, payload: InstancePayload) {
  const client = await getHttpClient();
  return client.put<never, AppInstance>(`/instances/${id}`, payload);
}

export async function enableInstance(id: string) {
  const client = await getHttpClient();
  return client.post(`/instances/${id}/enable`);
}

export async function disableInstance(id: string) {
  const client = await getHttpClient();
  return client.post(`/instances/${id}/disable`);
}
