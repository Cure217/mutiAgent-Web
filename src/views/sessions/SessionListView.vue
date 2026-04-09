<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import StatusTag from '@/components/StatusTag.vue';
import { useInstanceStore } from '@/stores/instances';
import { useSessionStore } from '@/stores/sessions';

const router = useRouter();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const dialogVisible = ref(false);

const form = reactive({
  appInstanceId: '',
  title: '',
  projectPath: 'D:\\Project\\ali\\260409',
  interactionMode: 'RAW',
  initInput: ''
});

const hasInstances = computed(() => instanceStore.items.length > 0);

onMounted(async () => {
  await Promise.all([instanceStore.load(), sessionStore.loadList()]);
});

function openCreateDialog() {
  if (!hasInstances.value) {
    ElMessage.warning('请先创建应用实例');
    return;
  }
  form.appInstanceId = instanceStore.items[0]?.id ?? '';
  form.title = '';
  form.projectPath = 'D:\\Project\\ali\\260409';
  form.interactionMode = 'RAW';
  form.initInput = '';
  dialogVisible.value = true;
}

async function submit() {
  try {
    const session = await sessionStore.create({
      appInstanceId: form.appInstanceId,
      title: form.title,
      projectPath: form.projectPath,
      interactionMode: form.interactionMode,
      initInput: form.initInput
    });
    ElMessage.success('会话已创建');
    dialogVisible.value = false;
    await router.push(`/sessions/${session.id}`);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function chooseDirectory() {
  if (!window.desktopBridge) {
    return;
  }
  const selected = await window.desktopBridge.pickDirectory();
  if (selected) {
    form.projectPath = selected;
  }
}

function goToDetail(sessionId: string) {
  router.push(`/sessions/${sessionId}`);
}
</script>

<template>
  <div>
    <div class="page-header">
      <h2>会话管理</h2>
      <div class="page-toolbar">
        <el-button @click="sessionStore.loadList">刷新列表</el-button>
        <el-button type="primary" @click="openCreateDialog">新建会话</el-button>
      </div>
    </div>

    <el-card class="page-card">
      <el-table :data="sessionStore.items" v-loading="sessionStore.loading">
        <el-table-column prop="title" label="会话标题" min-width="220" />
        <el-table-column prop="appInstanceId" label="实例 ID" min-width="180" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column prop="interactionMode" label="交互模式" width="120" />
        <el-table-column prop="pid" label="PID" width="100" />
        <el-table-column prop="createdAt" label="创建时间" min-width="180" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goToDetail(row.id)">查看详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新建会话" width="680px">
      <el-form label-width="110px">
        <el-form-item label="应用实例">
          <el-select v-model="form.appInstanceId" style="width: 100%">
            <el-option
              v-for="instance in instanceStore.items"
              :key="instance.id"
              :label="`${instance.name} (${instance.appType})`"
              :value="instance.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="会话标题">
          <el-input v-model="form.title" placeholder="例如：Codex 修复前端问题" />
        </el-form-item>
        <el-form-item label="项目目录">
          <el-input v-model="form.projectPath">
            <template #append>
              <el-button @click="chooseDirectory">选择目录</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="交互模式">
          <el-select v-model="form.interactionMode">
            <el-option label="RAW" value="RAW" />
            <el-option label="STRUCTURED" value="STRUCTURED" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始输入">
          <el-input v-model="form.initInput" type="textarea" :rows="5" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">启动会话</el-button>
      </template>
    </el-dialog>
  </div>
</template>
