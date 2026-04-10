import type { HistorySearchResult } from '@/types/api';
import { getHttpClient } from './http';

export async function searchHistory(params?: {
  keyword?: string;
  appType?: string;
  projectPath?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionLimit?: number;
  messageLimit?: number;
}) {
  const client = await getHttpClient();
  return client.get<never, HistorySearchResult>('/history/search', { params });
}
