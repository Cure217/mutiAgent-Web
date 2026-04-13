import type { HistorySearchResult } from '@/types/api';
import { getHttpClient } from './http';

export async function searchHistory(params?: {
  keyword?: string;
  appType?: string;
  projectPath?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionPageNo?: number;
  sessionPageSize?: number;
  sessionSortBy?: string;
  sessionSortDirection?: string;
  messagePageNo?: number;
  messagePageSize?: number;
  messageSortBy?: string;
  messageSortDirection?: string;
  sessionLimit?: number;
  messageLimit?: number;
}) {
  const client = await getHttpClient();
  return client.get<never, HistorySearchResult>('/history/search', { params });
}
