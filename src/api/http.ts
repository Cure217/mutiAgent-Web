import axios, { AxiosError, type AxiosInstance } from 'axios';
import type { ApiEnvelope } from '@/types/api';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
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
          return Promise.reject(new Error(payload.message || '请求失败'));
        }
        return payload.data;
      }
      return response.data;
    },
    (error: AxiosError) => {
      const message = error.response?.data && typeof error.response.data === 'object'
        ? (error.response.data as { message?: string }).message
        : error.message;
      return Promise.reject(new Error(message || '网络请求失败'));
    }
  );

  return client;
}
