import axios, { AxiosError, type AxiosInstance } from 'axios';
import type { ApiEnvelope } from '@/types/api';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function normalizeErrorMessage(rawMessage?: string | null) {
  const message = (rawMessage || '').trim();
  if (!message) {
    return '网络请求失败';
  }

  const normalized = message.toLowerCase();
  if (normalized.includes('sqlite_busy') || normalized.includes('database is locked')) {
    return '数据库当前正忙，请稍后重试；如果持续出现，请确认是否重复启动了后端服务。';
  }

  return message;
}

export async function resolveBackendBaseUrl(): Promise<string> {
  const envBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL;
  if (envBaseUrl) {
    return normalizeBaseUrl(envBaseUrl);
  }
  if (window.desktopBridge) {
    return normalizeBaseUrl(await window.desktopBridge.getBackendBaseUrl());
  }
  return 'http://127.0.0.1:18109';
}

let clientPromise: Promise<AxiosInstance> | null = null;

export async function getHttpClient(): Promise<AxiosInstance> {
  if (!clientPromise) {
    clientPromise = resolveBackendBaseUrl().then((baseUrl) =>
      axios.create({
        baseURL: `${baseUrl}/api/v1`,
        timeout: 15000
      })
    );
  }
  const client = await clientPromise;

  client.interceptors.response.clear();
  client.interceptors.response.use(
    (response) => {
      const payload = response.data as ApiEnvelope<unknown>;
      if (payload && typeof payload.code === 'number') {
        if (payload.code !== 0) {
          return Promise.reject(new Error(normalizeErrorMessage(payload.message || '请求失败')));
        }
        return payload.data;
      }
      return response.data;
    },
    (error: AxiosError) => {
      const message = error.response?.data && typeof error.response.data === 'object'
        ? (error.response.data as { message?: string }).message
        : error.message;
      return Promise.reject(new Error(normalizeErrorMessage(message)));
    }
  );

  return client;
}
