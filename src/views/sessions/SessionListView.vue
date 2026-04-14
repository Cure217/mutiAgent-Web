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
import { buildWorkspaceSummary, isCollaborativeWorkspaceSession } from '@/utils/architectConsole';
import { pickPreferredInstanceId, rememberPreferredInstance, sortInstancesByPreference } from '@/utils/instancePreference';

const router = useRouter();
const configStore = useConfigStore();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const dialogVisible = ref(false);
const historyLoading = ref(false);
const historySearched = ref(false);
const historyResult = ref<HistorySearchResult>({
  sessions: {
    items: [],
    pageNo: 1,
    pageSize: 10,
    total: 0
  },
  messages: {
    items: [],
    pageNo: 1,
    pageSize: 10,
    total: 0
  }
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
const historyQuery = reactive({
  sessionPageNo: 1,
  sessionPageSize: 10,
  sessionSortValue: 'lastMessageAt_desc',
  messagePageNo: 1,
  messagePageSize: 10,
  messageSortValue: 'relevance_asc'
});

const hasInstances = computed(() => instanceStore.items.length > 0);
const sortedInstances = computed(() => sortInstancesByPreference(instanceStore.items));
const appTypeOptions = computed(() =>
  Array.from(new Set(instanceStore.items.map((item) => item.appType).filter(Boolean)))
);
const sessionWorkspaceSummaryMap = computed(() =>
  new Map(sessionStore.items.map((item) => [item.id, buildWorkspaceSummary(item, instanceStore.items)]))
);
const interactionModeOptions = [
  { label: '终端协作（RAW，推荐）', value: 'RAW', disabled: false },
  { label: '结构化协作（暂未支持）', value: 'STRUCTURED', disabled: true }
];
const historyKeywordTokens = computed(() =>
  historyForm.keyword
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
);

onMounted(async () => {
  await Promise.all([instanceStore.load(), sessionStore.loadList(), configStore.load()]);
});

function openCreateDialog() {
  if (!hasInstances.value) {
    ElMessage.warning('请先创建应用实例');
    return;
  }
  form.appInstanceId = pickPreferredInstanceId(instanceStore.items);
  form.title = '';
  form.projectPath = configStore.defaultProjectPath || 'D:\\Project\\ali\\260409';
  form.interactionMode = 'RAW';
  form.initInput = '';
  dialogVisible.value = true;
}

function handleAppInstanceChange(value: string) {
  rememberPreferredInstance(value);
}

async function submit() {
  if (form.interactionMode === 'STRUCTURED') {
    ElMessage.warning('当前版本暂不支持 STRUCTURED 模式，请改用 RAW 终端协作模式');
    return;
  }
  try {
    rememberPreferredInstance(form.appInstanceId);
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

function formatInteractionModeLabel(interactionMode?: string) {
  switch ((interactionMode || '').toUpperCase()) {
    case 'RAW':
      return '终端协作';
    case 'STRUCTURED':
      return '结构化协作';
    case 'EMBEDDED':
      return '嵌入终端';
    case 'TEXT':
      return '文本对话';
    default:
      return interactionMode || '未知模式';
  }
}

function resolveSessionKindLabel(sessionId: string) {
  const summary = sessionWorkspaceSummaryMap.value.get(sessionId);
  return summary?.workspaceKindLabel || '普通会话';
}

function resolveSessionRoleLabel(sessionId: string) {
  const summary = sessionWorkspaceSummaryMap.value.get(sessionId);
  return summary && isCollaborativeWorkspaceSession(summary.session) ? summary.role.label : '—';
}

function resolveSessionCoordinationLabel(sessionId: string) {
  const summary = sessionWorkspaceSummaryMap.value.get(sessionId);
  return summary && isCollaborativeWorkspaceSession(summary.session) ? summary.coordinationLabel : '—';
}

function resolveSessionCoordinationTagType(sessionId: string) {
  const summary = sessionWorkspaceSummaryMap.value.get(sessionId);
  return summary && isCollaborativeWorkspaceSession(summary.session) ? summary.coordinationTone : 'info';
}

async function submitHistorySearch() {
  historyLoading.value = true;
  try {
    const [dateFrom, dateTo] = historyForm.dateRange;
    const [sessionSortBy, sessionSortDirection] = historyQuery.sessionSortValue.split('_');
    const [messageSortBy, messageSortDirection] = historyQuery.messageSortValue.split('_');
    historyResult.value = await searchHistory({
      keyword: historyForm.keyword || undefined,
      appType: historyForm.appType || undefined,
      projectPath: historyForm.projectPath || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sessionPageNo: historyQuery.sessionPageNo,
      sessionPageSize: historyQuery.sessionPageSize,
      sessionSortBy,
      sessionSortDirection,
      messagePageNo: historyQuery.messagePageNo,
      messagePageSize: historyQuery.messagePageSize,
      messageSortBy,
      messageSortDirection
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
  historyQuery.sessionPageNo = 1;
  historyQuery.sessionPageSize = 10;
  historyQuery.sessionSortValue = 'lastMessageAt_desc';
  historyQuery.messagePageNo = 1;
  historyQuery.messagePageSize = 10;
  historyQuery.messageSortValue = 'relevance_asc';
  historyResult.value = {
    sessions: {
      items: [],
      pageNo: 1,
      pageSize: 10,
      total: 0
    },
    messages: {
      items: [],
      pageNo: 1,
      pageSize: 10,
      total: 0
    }
  };
  historySearched.value = false;
}

function escapeHtml(value?: string | null) {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearchText(value?: string | null) {
  const safeText = escapeHtml(value || '-');
  if (!historyKeywordTokens.value.length || !value) {
    return safeText;
  }

  const pattern = new RegExp(`(${historyKeywordTokens.value.map(escapeRegExp).join('|')})`, 'gi');
  return safeText.replace(pattern, '<mark class="search-hit">$1</mark>');
}

async function handleHistorySearch(resetPaging = false) {
  if (resetPaging) {
    historyQuery.sessionPageNo = 1;
    historyQuery.messagePageNo = 1;
  }
  await submitHistorySearch();
}

async function handleSessionPageChange(pageNo: number) {
  historyQuery.sessionPageNo = pageNo;
  await handleHistorySearch(false);
}

async function handleSessionPageSizeChange(pageSize: number) {
  historyQuery.sessionPageSize = pageSize;
  historyQuery.sessionPageNo = 1;
  await handleHistorySearch(false);
}

async function handleMessagePageChange(pageNo: number) {
  historyQuery.messagePageNo = pageNo;
  await handleHistorySearch(false);
}

async function handleMessagePageSizeChange(pageSize: number) {
  historyQuery.messagePageSize = pageSize;
  historyQuery.messagePageNo = 1;
  await handleHistorySearch(false);
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
                @keyup.enter="handleHistorySearch(true)"
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
                <el-button :loading="historyLoading" type="primary" @click="handleHistorySearch(true)">开始检索</el-button>
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
          检索结果（会话 {{ historyResult.sessions.total }} 条，消息 {{ historyResult.messages.total }} 条）
        </div>
      </template>

      <div class="result-block">
        <div class="result-head">
          <h3>会话命中</h3>
          <div class="result-actions">
            <el-select v-model="historyQuery.sessionSortValue" style="width: 180px" @change="handleHistorySearch(false)">
              <el-option label="最近活跃优先" value="lastMessageAt_desc" />
              <el-option label="最近活跃最早" value="lastMessageAt_asc" />
              <el-option label="最新创建优先" value="createdAt_desc" />
              <el-option label="最早创建优先" value="createdAt_asc" />
              <el-option label="标题 A-Z" value="title_asc" />
              <el-option label="标题 Z-A" value="title_desc" />
            </el-select>
          </div>
        </div>
        <el-empty v-if="historyResult.sessions.total === 0" description="暂无会话命中" />
        <el-table v-else :data="historyResult.sessions.items">
          <el-table-column label="会话标题" min-width="220">
            <template #default="{ row }">
              <div class="highlight-cell" :title="row.title" v-html="highlightSearchText(row.title)" />
            </template>
          </el-table-column>
          <el-table-column prop="appType" label="应用类型" width="120" />
          <el-table-column prop="matchedSource" label="命中来源" width="140" />
          <el-table-column label="命中内容" min-width="260">
            <template #default="{ row }">
              <div class="highlight-cell" :title="row.matchedText || ''" v-html="highlightSearchText(row.matchedText)" />
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="goToDetail(row.sessionId)">打开会话</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination-bar">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next"
            :current-page="historyResult.sessions.pageNo"
            :page-size="historyResult.sessions.pageSize"
            :page-sizes="[10, 20, 50]"
            :total="historyResult.sessions.total"
            @current-change="handleSessionPageChange"
            @size-change="handleSessionPageSizeChange"
          />
        </div>
      </div>

      <div class="result-block">
        <div class="result-head">
          <h3>消息命中</h3>
          <div class="result-actions">
            <el-select v-model="historyQuery.messageSortValue" style="width: 180px" @change="handleHistorySearch(false)">
              <el-option label="相关度优先" value="relevance_asc" />
              <el-option label="最新消息优先" value="createdAt_desc" />
              <el-option label="最早消息优先" value="createdAt_asc" />
              <el-option label="序号从大到小" value="seqNo_desc" />
              <el-option label="序号从小到大" value="seqNo_asc" />
            </el-select>
          </div>
        </div>
        <el-empty v-if="historyResult.messages.total === 0" description="暂无消息命中" />
        <el-table v-else :data="historyResult.messages.items">
          <el-table-column label="所属会话" min-width="220">
            <template #default="{ row }">
              <div class="highlight-cell" :title="row.sessionTitle" v-html="highlightSearchText(row.sessionTitle)" />
            </template>
          </el-table-column>
          <el-table-column prop="role" label="角色" width="100" />
          <el-table-column prop="messageType" label="消息类型" width="120" />
          <el-table-column label="内容摘要" min-width="320">
            <template #default="{ row }">
              <div class="highlight-cell" :title="row.snippet || ''" v-html="highlightSearchText(row.snippet)" />
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="消息时间" min-width="180" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="goToDetail(row.sessionId, row.messageId)">打开会话</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination-bar">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next"
            :current-page="historyResult.messages.pageNo"
            :page-size="historyResult.messages.pageSize"
            :page-sizes="[10, 20, 50]"
            :total="historyResult.messages.total"
            @current-change="handleMessagePageChange"
            @size-change="handleMessagePageSizeChange"
          />
        </div>
      </div>
    </el-card>

    <el-card class="page-card">
      <el-table :data="sessionStore.items" v-loading="sessionStore.loading">
        <el-table-column prop="title" label="会话标题" min-width="220" />
        <el-table-column prop="appInstanceId" label="实例 ID" min-width="180" />
        <el-table-column label="窗口类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="resolveSessionKindLabel(row.id) === '协作子窗口' ? 'primary' : 'info'">
              {{ resolveSessionKindLabel(row.id) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            {{ resolveSessionRoleLabel(row.id) }}
          </template>
        </el-table-column>
        <el-table-column label="协作状态" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="resolveSessionCoordinationTagType(row.id)">
              {{ resolveSessionCoordinationLabel(row.id) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进程状态" width="130">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="交互模式" width="140">
          <template #default="{ row }">
            {{ formatInteractionModeLabel(row.interactionMode) }}
          </template>
        </el-table-column>
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
          <el-select v-model="form.appInstanceId" style="width: 100%" @change="handleAppInstanceChange">
            <el-option
              v-for="instance in sortedInstances"
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
            <el-option
              v-for="option in interactionModeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
              :disabled="option.disabled"
            />
          </el-select>
          <div class="field-tip">当前版本仅支持 RAW 终端协作，STRUCTURED 暂未开放。</div>
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

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.result-block h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.highlight-cell {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

:deep(mark.search-hit) {
  padding: 0 2px;
  border-radius: 4px;
  background: rgba(250, 204, 21, 0.35);
  color: #92400e;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.field-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}
</style>
