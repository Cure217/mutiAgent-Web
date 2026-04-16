<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { searchHistory } from '@/api/history';
import StatusTag from '@/components/StatusTag.vue';
import { useConfigStore } from '@/stores/configs';
import { useInstanceStore } from '@/stores/instances';
import { useSessionStore } from '@/stores/sessions';
import type { HistorySearchResult } from '@/types/api';
import { buildWorkspaceSummary, isCollaborativeWorkspaceSession } from '@/utils/architectConsole';
import { pickPreferredInstanceId, rememberPreferredInstance, sortInstancesByPreference } from '@/utils/instancePreference';

const router = useRouter();
const route = useRoute();
const configStore = useConfigStore();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const dialogVisible = ref(false);
const historyLoading = ref(false);
const historySearched = ref(false);
const historyResult = ref<HistorySearchResult>(createEmptyHistoryResult());
const HISTORY_DRAFT_STORAGE_KEY = 'muti-agent:session-history-draft:v1';
const HISTORY_RECENT_STORAGE_KEY = 'muti-agent:session-history-recent:v1';
const MAX_RECENT_HISTORY_SEARCHES = 5;
let suppressHistoryRouteWatch = false;

type HistoryReplayItem = {
  keyword: string;
  appType: string;
  projectPath: string;
  dateRange: string[];
  sessionSortValue: string;
  messageSortValue: string;
  updatedAt: string;
};

type HistoryReplayComparable = Pick<
  HistoryReplayItem,
  'keyword' | 'appType' | 'projectPath' | 'dateRange' | 'sessionSortValue' | 'messageSortValue'
>;

const DEFAULT_HISTORY_QUERY = {
  sessionPageNo: 1,
  sessionPageSize: 10,
  sessionSortValue: 'lastMessageAt_desc',
  messagePageNo: 1,
  messagePageSize: 10,
  messageSortValue: 'relevance_asc'
};

const sessionSortOptions = [
  { label: '最近活跃优先', value: 'lastMessageAt_desc' },
  { label: '最近活跃最早', value: 'lastMessageAt_asc' },
  { label: '最新创建优先', value: 'createdAt_desc' },
  { label: '最早创建优先', value: 'createdAt_asc' },
  { label: '标题 A-Z', value: 'title_asc' },
  { label: '标题 Z-A', value: 'title_desc' }
] as const;

const messageSortOptions = [
  { label: '相关度优先', value: 'relevance_asc' },
  { label: '最新消息优先', value: 'createdAt_desc' },
  { label: '最早消息优先', value: 'createdAt_asc' },
  { label: '序号从大到小', value: 'seqNo_desc' },
  { label: '序号从小到大', value: 'seqNo_asc' }
] as const;

const allowedSessionSortValues = new Set(sessionSortOptions.map((item) => item.value));
const allowedMessageSortValues = new Set(messageSortOptions.map((item) => item.value));

const HISTORY_ROUTE_KEYS = new Set([
  'history',
  'historyKeyword',
  'historyAppType',
  'historyProjectPath',
  'historyDateFrom',
  'historyDateTo',
  'historySessionPageNo',
  'historySessionPageSize',
  'historySessionSort',
  'historyMessagePageNo',
  'historyMessagePageSize',
  'historyMessageSort'
]);

function createEmptyHistoryResult(): HistorySearchResult {
  return {
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
}

function createEmptyHistoryDraft() {
  return {
    keyword: '',
    appType: '',
    projectPath: '',
    dateRange: [] as string[]
  };
}

const form = reactive({
  appInstanceId: '',
  title: '',
  projectPath: '',
  interactionMode: 'RAW',
  initInput: ''
});

const historyForm = reactive({
  ...createEmptyHistoryDraft()
});
const historyQuery = reactive({
  ...DEFAULT_HISTORY_QUERY
});
const recentHistorySearches = ref<HistoryReplayItem[]>([]);

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
  loadRecentHistorySearches();
  try {
    await Promise.all([instanceStore.load(), sessionStore.loadList(), configStore.load()]);
  } finally {
    await sessionStore.ensureSocket();
  }
  await applyHistoryStateFromRoute();
});

onBeforeUnmount(() => {
  sessionStore.disconnectSocket();
});

function openCreateDialog() {
  if (!hasInstances.value) {
    ElMessage.warning('请先创建应用实例');
    return;
  }
  form.appInstanceId = pickPreferredInstanceId(instanceStore.items);
  form.title = '';
  form.projectPath = configStore.defaultProjectPath;
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
    query: {
      ...route.query,
      ...buildHistoryRouteQuery(),
      from: 'sessions',
      ...(messageId ? { messageId } : {})
    }
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

async function submitHistorySearch(options: { syncRoute?: boolean } = {}) {
  historyLoading.value = true;
  try {
    const [dateFrom, dateTo] = historyForm.dateRange;
    const [sessionSortBy, sessionSortDirection] = historyQuery.sessionSortValue.split('_');
    const [messageSortBy, messageSortDirection] = historyQuery.messageSortValue.split('_');
    const result = await searchHistory({
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
    historyResult.value = result;
    historyQuery.sessionPageNo = result.sessions.pageNo;
    historyQuery.sessionPageSize = result.sessions.pageSize;
    historyQuery.messagePageNo = result.messages.pageNo;
    historyQuery.messagePageSize = result.messages.pageSize;
    historySearched.value = true;
    saveRecentHistorySearch();
    if (options.syncRoute !== false) {
      await syncHistoryRoute('push');
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    historyLoading.value = false;
  }
}

async function resetHistorySearch() {
  Object.assign(historyForm, createEmptyHistoryDraft());
  resetHistoryQuery();
  historyResult.value = createEmptyHistoryResult();
  historySearched.value = false;
  clearHistoryDraft();
  await syncHistoryRoute('push', omitHistoryRouteQuery(route.query));
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

function resetHistoryQuery() {
  Object.assign(historyQuery, DEFAULT_HISTORY_QUERY);
}

function getQueryStringValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeHistorySortValue(
  value: string,
  allowedValues: Set<string>,
  fallback: string
) {
  return allowedValues.has(value) ? value : fallback;
}

function buildHistoryDraft() {
  return {
    keyword: historyForm.keyword.trim(),
    appType: historyForm.appType,
    projectPath: historyForm.projectPath.trim(),
    dateRange: [...historyForm.dateRange]
  };
}

function hasHistoryDraftValue(draft: ReturnType<typeof buildHistoryDraft>) {
  return Boolean(draft.keyword || draft.appType || draft.projectPath || draft.dateRange.length);
}

function persistHistoryDraft() {
  const draft = buildHistoryDraft();
  if (!hasHistoryDraftValue(draft)) {
    clearHistoryDraft();
    return;
  }
  window.localStorage.setItem(HISTORY_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function clearHistoryDraft() {
  window.localStorage.removeItem(HISTORY_DRAFT_STORAGE_KEY);
}

function restoreHistoryDraftFromStorage() {
  const raw = window.localStorage.getItem(HISTORY_DRAFT_STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReturnType<typeof buildHistoryDraft>>;
    historyForm.keyword = typeof parsed.keyword === 'string' ? parsed.keyword : '';
    historyForm.appType = typeof parsed.appType === 'string' ? parsed.appType : '';
    historyForm.projectPath = typeof parsed.projectPath === 'string' ? parsed.projectPath : '';
    historyForm.dateRange = Array.isArray(parsed.dateRange)
      ? parsed.dateRange.filter((item): item is string => typeof item === 'string').slice(0, 2)
      : [];
  } catch {
    clearHistoryDraft();
  }
}

function buildHistoryReplayItem(): HistoryReplayItem {
  return {
    ...buildHistoryDraft(),
    sessionSortValue: sanitizeHistorySortValue(
      historyQuery.sessionSortValue,
      allowedSessionSortValues,
      DEFAULT_HISTORY_QUERY.sessionSortValue
    ),
    messageSortValue: sanitizeHistorySortValue(
      historyQuery.messageSortValue,
      allowedMessageSortValues,
      DEFAULT_HISTORY_QUERY.messageSortValue
    ),
    updatedAt: new Date().toISOString()
  };
}

function normalizeHistoryReplayItem(value: Partial<HistoryReplayItem> | null | undefined): HistoryReplayItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item: HistoryReplayItem = {
    keyword: typeof value.keyword === 'string' ? value.keyword.trim() : '',
    appType: typeof value.appType === 'string' ? value.appType : '',
    projectPath: typeof value.projectPath === 'string' ? value.projectPath.trim() : '',
    dateRange: Array.isArray(value.dateRange)
      ? value.dateRange.filter((date): date is string => typeof date === 'string').slice(0, 2)
      : [],
    sessionSortValue: sanitizeHistorySortValue(
      typeof value.sessionSortValue === 'string' ? value.sessionSortValue : '',
      allowedSessionSortValues,
      DEFAULT_HISTORY_QUERY.sessionSortValue
    ),
    messageSortValue: sanitizeHistorySortValue(
      typeof value.messageSortValue === 'string' ? value.messageSortValue : '',
      allowedMessageSortValues,
      DEFAULT_HISTORY_QUERY.messageSortValue
    ),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
  return hasHistoryDraftValue(item) ? item : null;
}

function historyReplayKey(item: Pick<HistoryReplayItem, 'keyword' | 'appType' | 'projectPath' | 'dateRange' | 'sessionSortValue' | 'messageSortValue'>) {
  return JSON.stringify({
    keyword: item.keyword,
    appType: item.appType,
    projectPath: item.projectPath,
    dateRange: item.dateRange,
    sessionSortValue: item.sessionSortValue,
    messageSortValue: item.messageSortValue
  });
}

function persistRecentHistorySearches() {
  if (!recentHistorySearches.value.length) {
    window.localStorage.removeItem(HISTORY_RECENT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(HISTORY_RECENT_STORAGE_KEY, JSON.stringify(recentHistorySearches.value));
}

function loadRecentHistorySearches() {
  const raw = window.localStorage.getItem(HISTORY_RECENT_STORAGE_KEY);
  if (!raw) {
    recentHistorySearches.value = [];
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    recentHistorySearches.value = Array.isArray(parsed)
      ? parsed
          .map((item) => normalizeHistoryReplayItem(item as Partial<HistoryReplayItem>))
          .filter((item): item is HistoryReplayItem => Boolean(item))
          .slice(0, MAX_RECENT_HISTORY_SEARCHES)
      : [];
  } catch {
    recentHistorySearches.value = [];
    window.localStorage.removeItem(HISTORY_RECENT_STORAGE_KEY);
  }
}

function saveRecentHistorySearch() {
  const nextItem = normalizeHistoryReplayItem(buildHistoryReplayItem());
  if (!nextItem) {
    return;
  }
  const nextKey = historyReplayKey(nextItem);
  recentHistorySearches.value = [
    nextItem,
    ...recentHistorySearches.value.filter((item) => historyReplayKey(item) !== nextKey)
  ].slice(0, MAX_RECENT_HISTORY_SEARCHES);
  persistRecentHistorySearches();
}

function clearRecentHistorySearches() {
  recentHistorySearches.value = [];
  persistRecentHistorySearches();
}

function buildHistoryReplayComparableFromRouteQuery(query: typeof route.query): HistoryReplayComparable | null {
  const hasHistoryState = getQueryStringValue(query.history) === '1'
    || Array.from(HISTORY_ROUTE_KEYS).some((key) => Boolean(getQueryStringValue(query[key])));
  if (!hasHistoryState) {
    return null;
  }

  const dateFrom = getQueryStringValue(query.historyDateFrom);
  const dateTo = getQueryStringValue(query.historyDateTo);
  return {
    keyword: getQueryStringValue(query.historyKeyword).trim(),
    appType: getQueryStringValue(query.historyAppType),
    projectPath: getQueryStringValue(query.historyProjectPath).trim(),
    dateRange: dateFrom || dateTo ? [dateFrom, dateTo].filter(Boolean) : [],
    sessionSortValue: sanitizeHistorySortValue(
      getQueryStringValue(query.historySessionSort),
      allowedSessionSortValues,
      DEFAULT_HISTORY_QUERY.sessionSortValue
    ),
    messageSortValue: sanitizeHistorySortValue(
      getQueryStringValue(query.historyMessageSort),
      allowedMessageSortValues,
      DEFAULT_HISTORY_QUERY.messageSortValue
    )
  };
}

function removeRecentHistorySearch(targetItem: HistoryReplayItem) {
  const targetKey = historyReplayKey(targetItem);
  recentHistorySearches.value = recentHistorySearches.value.filter(
    (item) => historyReplayKey(item) !== targetKey
  );
  persistRecentHistorySearches();
}

function formatHistoryReplayPrimary(item: HistoryReplayItem) {
  return item.keyword || '未填写关键词';
}

function formatHistoryReplayMeta(item: HistoryReplayItem) {
  const parts = [
    item.appType ? `类型：${item.appType}` : '类型：全部',
    item.dateRange.length ? `日期：${item.dateRange.join(' ~ ')}` : '日期：全部'
  ];
  return parts.join(' · ');
}

function formatHistoryReplayUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function resolveSortLabel(
  value: string,
  options: ReadonlyArray<{ label: string; value: string }>
) {
  return options.find((item) => item.value === value)?.label || value;
}

function formatHistoryReplayTitle(item: HistoryReplayItem) {
  return [
    `关键词：${item.keyword || '未填写'}`,
    `类型：${item.appType || '全部'}`,
    `目录：${item.projectPath || '全部'}`,
    `日期：${item.dateRange.length ? item.dateRange.join(' ~ ') : '全部'}`,
    `会话排序：${resolveSortLabel(item.sessionSortValue, sessionSortOptions)}`,
    `消息排序：${resolveSortLabel(item.messageSortValue, messageSortOptions)}`,
    `最近执行：${formatHistoryReplayUpdatedAt(item.updatedAt)}`
  ].join('\n');
}

function isRecentHistorySearchActive(item: HistoryReplayItem) {
  const activeReplay = buildHistoryReplayComparableFromRouteQuery(route.query);
  return Boolean(activeReplay) && historyReplayKey(activeReplay) === historyReplayKey(item);
}

async function applyRecentHistorySearch(item: HistoryReplayItem) {
  historyForm.keyword = item.keyword;
  historyForm.appType = item.appType;
  historyForm.projectPath = item.projectPath;
  historyForm.dateRange = [...item.dateRange];
  historyQuery.sessionPageNo = 1;
  historyQuery.sessionPageSize = DEFAULT_HISTORY_QUERY.sessionPageSize;
  historyQuery.sessionSortValue = item.sessionSortValue;
  historyQuery.messagePageNo = 1;
  historyQuery.messagePageSize = DEFAULT_HISTORY_QUERY.messagePageSize;
  historyQuery.messageSortValue = item.messageSortValue;
  await submitHistorySearch();
}

function omitHistoryRouteQuery(query: typeof route.query) {
  const nextQuery: Record<string, string | string[]> = {};
  Object.entries(query).forEach(([key, value]) => {
    if (HISTORY_ROUTE_KEYS.has(key) || key === 'from' || key === 'messageId') {
      return;
    }
    if (typeof value === 'string') {
      nextQuery[key] = value;
    } else if (Array.isArray(value)) {
      nextQuery[key] = value.filter((item): item is string => typeof item === 'string');
    }
  });
  return nextQuery;
}

function buildHistoryRouteQuery() {
  const query: Record<string, string> = {};
  if (!historySearched.value) {
    return query;
  }
  const sessionPageNo = historyResult.value.sessions.pageNo || historyQuery.sessionPageNo;
  const sessionPageSize = historyResult.value.sessions.pageSize || historyQuery.sessionPageSize;
  const messagePageNo = historyResult.value.messages.pageNo || historyQuery.messagePageNo;
  const messagePageSize = historyResult.value.messages.pageSize || historyQuery.messagePageSize;

  query.history = '1';
  if (historyForm.keyword.trim()) {
    query.historyKeyword = historyForm.keyword.trim();
  }
  if (historyForm.appType) {
    query.historyAppType = historyForm.appType;
  }
  if (historyForm.projectPath.trim()) {
    query.historyProjectPath = historyForm.projectPath.trim();
  }
  if (historyForm.dateRange[0]) {
    query.historyDateFrom = historyForm.dateRange[0];
  }
  if (historyForm.dateRange[1]) {
    query.historyDateTo = historyForm.dateRange[1];
  }
  if (sessionPageNo !== DEFAULT_HISTORY_QUERY.sessionPageNo) {
    query.historySessionPageNo = String(sessionPageNo);
  }
  if (sessionPageSize !== DEFAULT_HISTORY_QUERY.sessionPageSize) {
    query.historySessionPageSize = String(sessionPageSize);
  }
  if (historyQuery.sessionSortValue !== DEFAULT_HISTORY_QUERY.sessionSortValue) {
    query.historySessionSort = historyQuery.sessionSortValue;
  }
  if (messagePageNo !== DEFAULT_HISTORY_QUERY.messagePageNo) {
    query.historyMessagePageNo = String(messagePageNo);
  }
  if (messagePageSize !== DEFAULT_HISTORY_QUERY.messagePageSize) {
    query.historyMessagePageSize = String(messagePageSize);
  }
  if (historyQuery.messageSortValue !== DEFAULT_HISTORY_QUERY.messageSortValue) {
    query.historyMessageSort = historyQuery.messageSortValue;
  }
  return query;
}

function hasHistoryRouteState() {
  return getQueryStringValue(route.query.history) === '1'
    || Array.from(HISTORY_ROUTE_KEYS).some((key) => Boolean(getQueryStringValue(route.query[key])));
}

function normalizeQueryForCompare(query: Record<string, string | string[]>) {
  return JSON.stringify(
    Object.keys(query)
      .sort()
      .map((key) => [key, query[key]])
  );
}

async function syncHistoryRoute(
  mode: 'push' | 'replace',
  baseQuery = omitHistoryRouteQuery(route.query)
) {
  const nextQuery = {
    ...baseQuery,
    ...buildHistoryRouteQuery()
  };
  const targetRoute = router.resolve({
    name: 'sessions',
    query: nextQuery
  });
  const currentQuery = omitHistoryRouteQuery(route.query);
  Object.entries(route.query).forEach(([key, value]) => {
    if (HISTORY_ROUTE_KEYS.has(key)) {
      if (typeof value === 'string') {
        currentQuery[key] = value;
      } else if (Array.isArray(value)) {
        currentQuery[key] = value.filter((item): item is string => typeof item === 'string');
      }
    }
  });
  if (normalizeQueryForCompare(nextQuery) === normalizeQueryForCompare(currentQuery)) {
    return;
  }

  suppressHistoryRouteWatch = true;
  try {
    if (mode === 'push') {
      window.history.pushState(window.history.state, '', targetRoute.href);
    }
    await router.replace(targetRoute);
  } finally {
    suppressHistoryRouteWatch = false;
  }
}

async function restoreHistorySearchFromRoute() {
  if (!hasHistoryRouteState()) {
    return;
  }

  const dateFrom = getQueryStringValue(route.query.historyDateFrom);
  const dateTo = getQueryStringValue(route.query.historyDateTo);
  historyForm.keyword = getQueryStringValue(route.query.historyKeyword);
  historyForm.appType = getQueryStringValue(route.query.historyAppType);
  historyForm.projectPath = getQueryStringValue(route.query.historyProjectPath);
  historyForm.dateRange = dateFrom || dateTo ? [dateFrom, dateTo] : [];
  historyQuery.sessionPageNo = parsePositiveInt(
    getQueryStringValue(route.query.historySessionPageNo),
    DEFAULT_HISTORY_QUERY.sessionPageNo
  );
  historyQuery.sessionPageSize = parsePositiveInt(
    getQueryStringValue(route.query.historySessionPageSize),
    DEFAULT_HISTORY_QUERY.sessionPageSize
  );
  historyQuery.sessionSortValue = sanitizeHistorySortValue(
    getQueryStringValue(route.query.historySessionSort),
    allowedSessionSortValues,
    DEFAULT_HISTORY_QUERY.sessionSortValue
  );
  historyQuery.messagePageNo = parsePositiveInt(
    getQueryStringValue(route.query.historyMessagePageNo),
    DEFAULT_HISTORY_QUERY.messagePageNo
  );
  historyQuery.messagePageSize = parsePositiveInt(
    getQueryStringValue(route.query.historyMessagePageSize),
    DEFAULT_HISTORY_QUERY.messagePageSize
  );
  historyQuery.messageSortValue = sanitizeHistorySortValue(
    getQueryStringValue(route.query.historyMessageSort),
    allowedMessageSortValues,
    DEFAULT_HISTORY_QUERY.messageSortValue
  );

  await submitHistorySearch({ syncRoute: false });
  await syncHistoryRoute('replace');
}

async function applyHistoryStateFromRoute() {
  if (hasHistoryRouteState()) {
    await restoreHistorySearchFromRoute();
    return;
  }

  historySearched.value = false;
  historyResult.value = createEmptyHistoryResult();
  resetHistoryQuery();
  Object.assign(historyForm, createEmptyHistoryDraft());
  restoreHistoryDraftFromStorage();
}

watch(
  () => [historyForm.keyword, historyForm.appType, historyForm.projectPath, ...historyForm.dateRange],
  () => {
    if (suppressHistoryRouteWatch) {
      return;
    }
    persistHistoryDraft();
  }
);

watch(
  () => route.fullPath,
  async () => {
    if (suppressHistoryRouteWatch) {
      return;
    }
    await applyHistoryStateFromRoute();
  }
);
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
      <div v-if="recentHistorySearches.length" class="history-replay-panel">
        <div class="history-replay-head">
          <span>最近检索</span>
          <el-button link type="primary" @click="clearRecentHistorySearches">清空</el-button>
        </div>
        <div class="history-replay-list">
          <div
            v-for="item in recentHistorySearches"
            :key="historyReplayKey(item)"
            class="history-replay-item"
            :class="{ 'history-replay-item--active': isRecentHistorySearchActive(item) }"
          >
            <button
              type="button"
              class="history-replay-item__main"
              :title="formatHistoryReplayTitle(item)"
              :aria-pressed="isRecentHistorySearchActive(item)"
              @click="applyRecentHistorySearch(item)"
            >
              <div class="history-replay-item__title-row">
                <span class="history-replay-item__title">{{ formatHistoryReplayPrimary(item) }}</span>
                <div class="history-replay-item__title-actions">
                  <span
                    v-if="isRecentHistorySearchActive(item)"
                    class="history-replay-item__status"
                  >
                    当前
                  </span>
                  <span class="history-replay-item__time">{{ formatHistoryReplayUpdatedAt(item.updatedAt) }}</span>
                </div>
              </div>
              <div
                v-if="item.projectPath"
                class="history-replay-item__path"
                :title="item.projectPath"
              >
                {{ item.projectPath }}
              </div>
              <div class="history-replay-item__meta" :title="formatHistoryReplayMeta(item)">
                {{ formatHistoryReplayMeta(item) }}
              </div>
            </button>
            <el-button
              link
              type="danger"
              class="history-replay-item__remove"
              @click="removeRecentHistorySearch(item)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>
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
              <el-option v-for="option in sessionSortOptions" :key="option.value" :label="option.label" :value="option.value" />
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
              <el-option v-for="option in messageSortOptions" :key="option.value" :label="option.label" :value="option.value" />
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

.history-replay-panel {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.history-replay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.history-replay-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 8px;
}

.history-replay-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.history-replay-item:hover {
  border-color: rgba(59, 130, 246, 0.35);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
}

.history-replay-item--active {
  border-color: rgba(59, 130, 246, 0.48);
  background: linear-gradient(180deg, rgba(239, 246, 255, 0.9), #fff);
  box-shadow: 0 10px 22px rgba(59, 130, 246, 0.12);
}

.history-replay-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.history-replay-item__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.history-replay-item__title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-replay-item__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: #1e293b;
}

.history-replay-item__time {
  flex-shrink: 0;
  font-size: 12px;
  color: #64748b;
}

.history-replay-item__status {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.history-replay-item__path,
.history-replay-item__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.history-replay-item__path {
  color: #475569;
}

.history-replay-item__meta {
  color: #94a3b8;
}

.history-replay-item__remove {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 0;
}
</style>
