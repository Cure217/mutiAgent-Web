import type { SystemConfig } from '@/types/api';
import { getHttpClient } from './http';

export interface ConfigItemPayload {
  configGroup: string;
  configKey: string;
  valueType: string;
  valueText?: string;
  valueJson?: string;
  secretRef?: string;
  remark?: string;
}

export interface UpdateConfigsPayload {
  items: ConfigItemPayload[];
}

export async function fetchConfigs() {
  const client = await getHttpClient();
  return client.get<never, SystemConfig[]>('/configs');
}

export async function updateConfigs(payload: UpdateConfigsPayload) {
  const client = await getHttpClient();
  return client.put<never, SystemConfig[]>('/configs', payload);
}
