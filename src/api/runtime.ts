import type { ProcessInfo, RuntimeAttachmentInfo, RuntimeHealth, RuntimeStatistics } from '@/types/runtime';
import { getHttpClient } from './http';

export async function fetchRuntimeHealth() {
  const client = await getHttpClient();
  return client.get<never, RuntimeHealth>('/runtime/health');
}

export async function fetchRuntimeStatistics() {
  const client = await getHttpClient();
  return client.get<never, RuntimeStatistics>('/runtime/statistics');
}

export async function fetchRuntimeProcesses() {
  const client = await getHttpClient();
  return client.get<never, ProcessInfo[]>('/runtime/processes');
}

export async function fetchRuntimeAttachments() {
  const client = await getHttpClient();
  return client.get<never, RuntimeAttachmentInfo[]>('/runtime/attachments');
}
