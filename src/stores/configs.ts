import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { fetchConfigs, updateConfigs, type ConfigItemPayload } from '@/api/config';
import type { SystemConfig } from '@/types/api';

const DEFAULT_PROJECT_PATH = '';

export const useConfigStore = defineStore('configs', () => {
  const items = ref<SystemConfig[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  function getItem(configGroup: string, configKey: string) {
    return items.value.find((item) => item.configGroup === configGroup && item.configKey === configKey) ?? null;
  }

  function getValue(configGroup: string, configKey: string, fallback = '') {
    return getItem(configGroup, configKey)?.valueText ?? fallback;
  }

  async function load() {
    loading.value = true;
    try {
      items.value = await fetchConfigs();
    } finally {
      loading.value = false;
    }
  }

  async function save(payloads: ConfigItemPayload[]) {
    saving.value = true;
    try {
      items.value = await updateConfigs({ items: payloads });
      return items.value;
    } finally {
      saving.value = false;
    }
  }

  const defaultProjectPath = computed(() => getValue('runtime', 'defaultProjectPath', DEFAULT_PROJECT_PATH));

  return {
    items,
    loading,
    saving,
    load,
    save,
    getItem,
    getValue,
    defaultProjectPath
  };
});
