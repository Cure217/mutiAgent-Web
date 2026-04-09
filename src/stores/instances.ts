import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  createInstance,
  disableInstance,
  enableInstance,
  fetchInstances,
  type InstancePayload,
  updateInstance
} from '@/api/instance';
import type { AppInstance } from '@/types/api';

export const useInstanceStore = defineStore('instances', () => {
  const items = ref<AppInstance[]>([]);
  const loading = ref(false);

  async function load(keyword?: string) {
    loading.value = true;
    try {
      items.value = await fetchInstances({ keyword });
    } finally {
      loading.value = false;
    }
  }

  async function create(payload: InstancePayload) {
    await createInstance(payload);
    await load();
  }

  async function update(id: string, payload: InstancePayload) {
    await updateInstance(id, payload);
    await load();
  }

  async function toggleEnabled(instance: AppInstance) {
    if (instance.enabled) {
      await disableInstance(instance.id);
    } else {
      await enableInstance(instance.id);
    }
    await load();
  }

  return {
    items,
    loading,
    load,
    create,
    update,
    toggleEnabled
  };
});
