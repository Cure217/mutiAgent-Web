import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { fetchRuntimeAttachments, fetchRuntimeHealth, fetchRuntimeProcesses, fetchRuntimeStatistics } from '@/api/runtime';
import { resolveBackendBaseUrl } from '@/api/http';
import type { ProcessInfo, RuntimeAttachmentInfo, RuntimeHealth, RuntimeStatistics } from '@/types/runtime';

export const useRuntimeStore = defineStore('runtime', () => {
  const backendBaseUrl = ref('http://127.0.0.1:18109');
  const health = ref<RuntimeHealth | null>(null);
  const statistics = ref<RuntimeStatistics | null>(null);
  const processes = ref<ProcessInfo[]>([]);
  const attachments = ref<RuntimeAttachmentInfo[]>([]);
  const loading = ref(false);
  const backendAvailable = ref(false);
  const lastRefreshError = ref('');

  const backendStatusText = computed(() => (backendAvailable.value ? '后端在线' : '后端离线'));

  async function initialize() {
    backendBaseUrl.value = await resolveBackendBaseUrl();
    await refreshAll();
  }

  async function refreshAll() {
    loading.value = true;
    try {
      const [healthData, statisticsData, processesData, attachmentData] = await Promise.all([
        fetchRuntimeHealth(),
        fetchRuntimeStatistics(),
        fetchRuntimeProcesses(),
        fetchRuntimeAttachments()
      ]);
      health.value = healthData;
      statistics.value = statisticsData;
      processes.value = processesData;
      attachments.value = attachmentData;
      backendAvailable.value = true;
      lastRefreshError.value = '';
    } catch (error) {
      console.error(error);
      backendAvailable.value = false;
      attachments.value = [];
      lastRefreshError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  return {
    backendBaseUrl,
    health,
    statistics,
    processes,
    attachments,
    loading,
    backendAvailable,
    lastRefreshError,
    backendStatusText,
    initialize,
    refreshAll
  };
});
