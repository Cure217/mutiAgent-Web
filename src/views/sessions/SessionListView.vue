<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { searchHistory } from '@/api/history';
import StatusTag from '@/components/StatusTag.vue';
import { useConfigStore } from '@/stores/configs';
import { useInstanceStore } from '@/stores/instances';
import { useSessionStore } from '@/stores/sessions';
import type { HistorySearchResult } from '@/types/api';

const router = useRouter();
const configStore = useConfigStore();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const dialogVisible = ref(false);
const historyLoading = ref(false);
const historySearched = ref(false);
const historyResult = ref<HistorySearchResult>({
  sessions: [],
  messages: []
});

const form = reactive({
  appInstanceId: '',
  title: '',
  projectPath: 'D:\\Project\\ali\\260409',
  interactionMode: 'RAW',
  initInput: ''
});

const historyForm = reactive({
  keyword: '',
  appType: '',
  projectPath: '',
  dateRange: [] as string[]
});

const hasInstances = computed(() => instanceStore.items.length > 0);
const appTypeOptions = computed(() =>
  Array.from(new Set(instanceStore.items.map((item) => item.appType).filter(Boolean)))
);

onMounted(async () => {
  await Promise.all([instanceStore.load(), sessionStore.loadList(), configStore.load()]);
});

function openCreateDialog() {
  if (!hasInstances.value) {
    ElMessage.warning('请先创建应用实例');
    return;
  }
  form.appInstanceId = instanceStore.items[0]?.id ?? '';
  form.title = '';
  form.projectPath = configStore.defaultProjectPath || 'D:\\Project\\ali\\260409';
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

function goToDetail(sessionId: string, messageId?: string) {
  router.push({
    path: `/sessions/${sessionId}`,
    query: messageId ? { messageId } : undefined
  });
}

async function submitHistorySearch() {
  historyLoading.value = true;
  try {
    const [dateFrom, dateTo] = historyForm.dateRange;
    historyResult.value = await searchHistory({
      keyword: historyForm.keyword || undefined,
      appType: historyForm.appType || undefined,
      projectPath: historyForm.projectPath || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sessionLimit: 20,
      messageLimit: 20
    });
    historySearched.value = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    historyLoading.value = false;
  }
}

function resetHistorySearch() {
  historyForm.keyword = '';
  historyForm.appType = '';
  historyForm.projectPath = '';
  historyForm.dateRange = [];
  historyResult.value = {
    sessions: [],
    messages: []
  };
  historySearched.value = false;
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
      <template #header>
        <div class="card-header">历史检索 / 全文搜索</div>
      </template>
      <el-form label-width="90px">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="关键词">
              <el-input
                v-model="historyForm.keyword"
                placeholder="搜索会话标题、项目路径、消息内容"
                clearable
                @keyup.enter="submitHistorySearch"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="应用类型">
              <el-select v-model="historyForm.appType" clearable style="width: 100%">
                <el-option v-for="appType in appTypeOptions" :key="appType" :label="appType" :value="appType" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item label="项目路径">
              <el-input v-model="historyForm.projectPath" placeholder="按项目目录过滤" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="日期范围">
              <el-date-picker
                v-model="historyForm.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label=" ">
              <div class="page-toolbar">
                <el-button :loading="historyLoading" type="primary" @click="submitHistorySearch">开始检索</el-button>
                <el-button @click="resetHistorySearch">重置</el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card v-if="historySearched" class="page-card" v-loading="historyLoading">
      <template #header>
        <div class="card-header">
          检索结果（会话 {{ historyResult.sessions.length }} 条，消息 {{ historyResult.messages.length }} 条）
        </div>
      </template>

      <div class="result-block">
        <h3>会话命中</h3>
        <el-empty v-if="historyResult.sessions.length === 0" description="暂无会话命中" />
        <el-table v-else :data="historyResult.sessions">
          <el-table-column prop="title" label="会话标题" min-width="220" />
          <el-table-column prop="appType" label="应用类型" width="120" />
          <el-table-column prop="matchedSource" label="命中来源" width="140" />
          <el-table-column prop="matchedText" label="命中内容" min-width="260" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="goToDetail(row.sessionId)">打开会话</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="result-block">
        <h3>消息命中</h3>
        <el-empty v-if="historyResult.messages.length === 0" description="暂无消息命中" />
        <el-table v-else :data="historyResult.messages">
          <el-table-column prop="sessionTitle" label="所属会话" min-width="220" />
          <el-table-column prop="role" label="角色" width="100" />
          <el-table-column prop="messageType" label="消息类型" width="120" />
          <el-table-column prop="snippet" label="内容摘要" min-width="320" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="消息时间" min-width="180" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="goToDetail(row.sessionId, row.messageId)">打开会话</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

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

<style scoped>
.card-header {
  font-weight: 600;
}

.result-block + .result-block {
  margin-top: 24px;
}

.result-block h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
</style>
