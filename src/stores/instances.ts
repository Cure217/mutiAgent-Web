import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  createInstance,
  disableInstance,
  enableInstance,
  fetchInstances,
  testLaunchInstance,
  type InstancePayload,
  updateInstance
} from '@/api/instance';
import type { AppInstance, InstanceTestLaunchResult } from '@/types/api';

const DEFAULT_CODEX_YOLO_ARG = '--dangerously-bypass-approvals-and-sandbox';

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
    const created = await createInstance(payload);
    await load();
    return created;
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

  async function testLaunch(id: string): Promise<InstanceTestLaunchResult> {
    return testLaunchInstance(id);
  }

  async function recoverUsableInstance(defaultProjectPath?: string): Promise<{
    instance: AppInstance;
    action: 'existing' | 'enabled' | 'created';
  }> {
    await load();

    const enabledInstance = items.value.find((item) => item.enabled);
    if (enabledInstance) {
      return { instance: enabledInstance, action: 'existing' };
    }

    const firstExisting = items.value[0];
    if (firstExisting) {
      await enableInstance(firstExisting.id);
      await load();
      const recovered = items.value.find((item) => item.id === firstExisting.id)
        ?? items.value.find((item) => item.enabled);
      if (!recovered) {
        throw new Error('实例已启用，但当前列表未找到该实例');
      }
      return { instance: recovered, action: 'enabled' };
    }

    const created = await createInstance({
      name: '默认 Codex',
      appType: 'codex',
      adapterType: 'codex-cli',
      runtimeEnv: 'windows',
      launchMode: 'external',
      executablePath: '',
      launchCommand: 'codex.cmd',
      args: [DEFAULT_CODEX_YOLO_ARG],
      workdir: defaultProjectPath || undefined,
      env: { TERM: 'xterm-256color' },
      enabled: true,
      autoRestart: false,
      remark: '系统根据空态入口自动创建，可在实例管理页继续调整'
    });
    await load();
    const recovered = items.value.find((item) => item.id === created.id) ?? created;
    return { instance: recovered, action: 'created' };
  }

  return {
    items,
    loading,
    load,
    create,
    update,
    toggleEnabled,
    testLaunch,
    recoverUsableInstance
  };
});
