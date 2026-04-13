import type { OperationLogRecord, PageData } from '@/types/api';
import { getHttpClient } from './http';

export async function fetchOperationLogs(params?: {
  targetType?: string;
  targetId?: string;
  action?: string;
  operatorName?: string;
  pageNo?: number;
  pageSize?: number;
}) {
  const client = await getHttpClient();
  return client.get<never, PageData<OperationLogRecord>>('/operation-logs', { params });
}

export async function createOperationLog(payload: {
  targetType: string;
  targetId?: string;
  action: string;
  result: string;
  operatorName?: string;
  detail?: Record<string, unknown>;
}) {
  const client = await getHttpClient();
  return client.post<never, OperationLogRecord>('/operation-logs', payload);
}
