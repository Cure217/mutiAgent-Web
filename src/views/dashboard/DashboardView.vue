<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AgentWorkspaceCard from '@/components/AgentWorkspaceCard.vue';
import SessionMessageList from '@/components/SessionMessageList.vue';
import SessionTimelineList from '@/components/SessionTimelineList.vue';
import StatisticsCards from '@/components/StatisticsCards.vue';
import StatusTag from '@/components/StatusTag.vue';
import { createOperationLog, fetchOperationLogs } from '@/api/operationLog';
import { useConfigStore } from '@/stores/configs';
import { useInstanceStore } from '@/stores/instances';
import { useRuntimeStore } from '@/stores/runtime';
import { useSessionStore } from '@/stores/sessions';
import type { OperationLogRecord } from '@/types/api';
import {
  buildCollaborationSnapshot,
  buildDispatchPrompt,
  buildWorkspaceSummary,
  buildWorkspaceTags,
  finalizeWorkspaceSummaries,
  getWorkspaceRole,
  WORKSPACE_ROLES,
  type AgentWorkspaceSummary,
  type CoordinationState,
  type WorkspaceRoleKey
} from '@/utils/architectConsole';

type WorkspaceLaneFilter = CoordinationState | 'all';
type WorkspaceLogCategory = 'all' | 'dispatch' | 'status' | 'close';

const router = useRouter();
const runtimeStore = useRuntimeStore();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const configStore = useConfigStore();

const selectedSessionId = ref('');
const detailTab = ref<'messages' | 'timeline'>('messages');
const dispatching = ref(false);
const saving = ref(false);
const logLoading = ref(false);
const logFilter = reactive({ action: '' });
const dispatchForm = reactive({ mode: 'new' as 'new' | 'existing', roleKey: 'developer' as WorkspaceRoleKey, targetSessionId: '', instanceId: '', title: '', projectPath: '', instruction: '', dependencyIds: [] as string[], includeSharedContext: true });
const workspaceForm = reactive({ roleKey: 'general' as WorkspaceRoleKey, coordinationStatus: 'assigned', progressSummary: '', blockedReason: '', dependencySessionIds: [] as string[], sharedContextSummary: '' });
const summaryForm = reactive({
  selectedSessionIds: [] as string[],
  templateKey: 'continue' as 'continue' | 'request_info' | 'unblock' | 'document',
  targetRoleKey: 'developer' as WorkspaceRoleKey,
  draft: ''
});
const operationLogs = ref<OperationLogRecord[]>([]);
const operationLogTotal = ref(0);
const activeLaneFilter = ref<WorkspaceLaneFilter>('all');
const currentWorkspaceLogOnly = ref(false);
const currentWorkspaceLogCategory = ref<WorkspaceLogCategory>('all');
const summarySyncNotice = ref<{ title: string; message: string; tone: 'info' | 'warning' | 'success' } | null>(null);

const coordinationOptions = [
  { label: '已分配', value: 'assigned' },
  { label: '执行中', value: 'running' },
  { label: '已阻塞', value: 'blocked' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' }
];
const operationLogActionOptions = [
  { label: '全部动作', value: '' },
  { label: '创建子窗口', value: 'workspace.created' },
  { label: '派单到子窗口', value: 'workspace.dispatched' },
  { label: '更新协作状态', value: 'workspace.meta.updated' },
  { label: '关闭子窗口', value: 'workspace.closed' },
  { label: '生成汇总', value: 'summary.generated' },
  { label: '应用汇总', value: 'summary.applied' },
  { label: '一键再派单', value: 'summary.dispatched' }
];
const summaryTemplateOptions = [
  { label: '继续执行', value: 'continue' as const },
  { label: '补充信息', value: 'request_info' as const },
  { label: '解除阻塞', value: 'unblock' as const },
  { label: '整理文档', value: 'document' as const }
];
const workspaceLogCategoryOptions = [
  { label: '全部', value: 'all' as WorkspaceLogCategory },
  { label: '派单', value: 'dispatch' as WorkspaceLogCategory },
  { label: '状态', value: 'status' as WorkspaceLogCategory },
  { label: '关闭', value: 'close' as WorkspaceLogCategory }
];

const enabledInstances = computed(() => instanceStore.items.filter((item) => item.enabled));
const workspaceSummaries = computed(() => finalizeWorkspaceSummaries(sessionStore.items.map((item) => buildWorkspaceSummary(item, instanceStore.items))));
const filteredWorkspaceSummaries = computed(() => activeLaneFilter.value === 'all'
  ? workspaceSummaries.value
  : workspaceSummaries.value.filter((item) => item.coordinationState === activeLaneFilter.value));
const selectedWorkspace = computed(() => workspaceSummaries.value.find((item) => item.id === selectedSessionId.value) ?? null);
const selectedWorkspaceDependents = computed(() => {
  if (!selectedWorkspace.value) {
    return [] as AgentWorkspaceSummary[];
  }
  return workspaceSummaries.value.filter((item) => item.dependencies.includes(selectedWorkspace.value!.id));
});
const selectedWorkspaceLogs = computed(() => {
  if (!selectedWorkspace.value) {
    return [] as OperationLogRecord[];
  }
  return operationLogs.value
    .filter((item) => item.targetId === selectedWorkspace.value?.id)
    .slice(0, 4);
});
const displayedOperationLogs = computed(() => {
  const baseLogs = (!currentWorkspaceLogOnly.value || !selectedWorkspace.value)
    ? operationLogs.value
    : operationLogs.value.filter((item) => item.targetId === selectedWorkspace.value?.id);

  if (!currentWorkspaceLogOnly.value || currentWorkspaceLogCategory.value === 'all') {
    return baseLogs;
  }

  return baseLogs.filter((item) => matchesWorkspaceLogCategory(item, currentWorkspaceLogCategory.value));
});
const blockedWorkspaceSuggestions = computed(() => {
  if (!selectedWorkspace.value || selectedWorkspace.value.coordinationState !== 'blocked') {
    return [] as string[];
  }

  const suggestions = [] as string[];
  const blockedReason = selectedWorkspace.value.workspaceMeta.blockedReason?.trim();

  if (!blockedReason) {
    suggestions.push('先补充明确的阻塞原因，避免架构师无法判断是环境问题、依赖问题还是需求问题。');
  }
  if (selectedWorkspace.value.dependencyLabels.length) {
    suggestions.push(`优先同步上游依赖：${selectedWorkspace.value.dependencyLabels.join('、')}，确认是否已有可复用结果或待补输入。`);
  }
  if (selectedWorkspaceDependents.value.length) {
    suggestions.push(`通知受影响子窗口：${selectedWorkspaceDependents.value.map((item) => `${item.role.label}·${item.title}`).join('、')}，避免下游继续等待。`);
  }
  if (!selectedWorkspace.value.dependencyLabels.length && !selectedWorkspaceDependents.value.length) {
    suggestions.push('当前阻塞未形成明显上下游影响，可优先判断是继续重试、改派其他角色还是直接关闭窗口。');
  }
  suggestions.push('解除阻塞后，及时把协作状态改回“执行中”并回写最新进展，避免总控台状态滞后。');
  return suggestions;
});
const recommendedUnblockRoleKey = computed<WorkspaceRoleKey>(() => {
  if (!selectedWorkspace.value) {
    return 'developer';
  }
  const blockedReason = `${selectedWorkspace.value.workspaceMeta.blockedReason || ''} ${selectedWorkspace.value.progressHint || ''}`.toLowerCase();

  if (/需求|优先级|确认|方案|口径|产品/.test(blockedReason)) {
    return 'product';
  }
  if (/测试|复现|验证|回归|冒烟|case/.test(blockedReason)) {
    return 'tester';
  }
  if (/前端|页面|交互|样式|布局|ui|ux/.test(blockedReason)) {
    return 'frontend';
  }
  if (/文档|说明|记录|沉淀|交付件/.test(blockedReason)) {
    return 'document';
  }
  return selectedWorkspace.value.role.key === 'product' ? 'developer' : selectedWorkspace.value.role.key;
});
const recommendedUnblockRole = computed(() => getWorkspaceRole(recommendedUnblockRoleKey.value));
const recommendedUnblockTargetWorkspace = computed(() =>
  workspaceSummaries.value.find((item) =>
    item.role.key === recommendedUnblockRoleKey.value
    && (item.coordinationState === 'running' || item.coordinationState === 'assigned')
  ) ?? null
);
const existingTargetWorkspace = computed(() => workspaceSummaries.value.find((item) => item.id === dispatchForm.targetSessionId) ?? null);
const assignedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'assigned'));
const runningWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'running'));
const blockedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'blocked'));
const completedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'completed'));
const closedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'closed'));
const roleDefinition = computed(() => getWorkspaceRole(dispatchForm.roleKey));
const dispatchDependencyOptions = computed(() => workspaceSummaries.value.filter((item) => item.id !== (dispatchForm.mode === 'existing' ? dispatchForm.targetSessionId : '')));
const workspaceDependencyOptions = computed(() => workspaceSummaries.value.filter((item) => item.id !== selectedSessionId.value));
const summaryWorkspaces = computed(() => workspaceSummaries.value.filter((item) => summaryForm.selectedSessionIds.includes(item.id)));
const summaryTargetRole = computed(() => getWorkspaceRole(summaryForm.targetRoleKey));
const summaryTargetWorkspace = computed(() =>
  workspaceSummaries.value.find((item) =>
    item.role.key === summaryForm.targetRoleKey
    && (item.coordinationState === 'running' || item.coordinationState === 'assigned')
  ) ?? null
);
const selectedDependencyLabels = computed(() => dispatchForm.dependencyIds.map((dependencyId) => workspaceSummaries.value.find((item) => item.id === dependencyId)).filter(Boolean).map((item) => `${item!.role.label} · ${item!.title}`));
const collaborationSnapshot = computed(() => dispatchForm.includeSharedContext ? buildCollaborationSnapshot(workspaceSummaries.value, dispatchForm.mode === 'existing' ? dispatchForm.targetSessionId : null, dispatchForm.dependencyIds) : '');
const dispatchPreview = computed(() => buildDispatchPrompt({ role: roleDefinition.value, title: dispatchForm.title.trim() || (dispatchForm.mode === 'new' ? '待命任务' : '追加调度'), instruction: dispatchForm.instruction.trim() || '请先同步当前状态，再等待进一步指令。', projectPath: dispatchForm.projectPath, dependencyLabels: selectedDependencyLabels.value, collaborationSnapshot: collaborationSnapshot.value, targetSessionTitle: existingTargetWorkspace.value?.title }));
const laneCards = computed(() => [
  { label: '全部', value: workspaceSummaries.value.length, className: 'all', filterValue: 'all' as WorkspaceLaneFilter },
  { label: '待开始', value: assignedWorkspaces.value.length, className: 'assigned' },
  { label: '执行中', value: runningWorkspaces.value.length, className: 'running' },
  { label: '已阻塞', value: blockedWorkspaces.value.length, className: 'blocked' },
  { label: '已完成', value: completedWorkspaces.value.length, className: 'completed' },
  { label: '已关闭', value: closedWorkspaces.value.length, className: 'closed' }
].map((lane) => ({
  ...lane,
  filterValue: (lane.filterValue ?? lane.className) as WorkspaceLaneFilter
})));
const activeLaneLabel = computed(() => laneCards.value.find((lane) => lane.filterValue === activeLaneFilter.value)?.label ?? '全部');
const displayedOperationLogLabel = computed(() => currentWorkspaceLogOnly.value && selectedWorkspace.value ? `仅看 ${selectedWorkspace.value.role.label}` : '查看全部');
const currentWorkspaceLogCategoryLabel = computed(() => workspaceLogCategoryOptions.find((item) => item.value === currentWorkspaceLogCategory.value)?.label ?? '全部');

function syncDispatchDefaults() {
  if (!dispatchForm.instanceId && enabledInstances.value.length > 0) dispatchForm.instanceId = enabledInstances.value[0].id;
  if (!dispatchForm.projectPath) dispatchForm.projectPath = configStore.defaultProjectPath || 'D:\\Project\\ali\\260409';
  if (!dispatchForm.targetSessionId && workspaceSummaries.value.length > 0) dispatchForm.targetSessionId = runningWorkspaces.value[0]?.id || assignedWorkspaces.value[0]?.id || workspaceSummaries.value[0]?.id || '';
}

function syncWorkspaceForm() {
  if (!selectedWorkspace.value) return;
  workspaceForm.roleKey = selectedWorkspace.value.role.key;
  workspaceForm.coordinationStatus = selectedWorkspace.value.workspaceMeta.coordinationStatus || selectedWorkspace.value.coordinationState;
  workspaceForm.progressSummary = selectedWorkspace.value.workspaceMeta.progressSummary || selectedWorkspace.value.session.summary || '';
  workspaceForm.blockedReason = selectedWorkspace.value.workspaceMeta.blockedReason || '';
  workspaceForm.dependencySessionIds = [...selectedWorkspace.value.dependencies];
  workspaceForm.sharedContextSummary = selectedWorkspace.value.workspaceMeta.sharedContextSummary || '';
}

function buildTemplateSuggestion() {
  switch (summaryForm.templateKey) {
    case 'request_info':
      return `请以${summaryTargetRole.value.label}角色补齐以下缺失信息，并先列出仍需确认的问题，再给出建议。`;
    case 'unblock':
      return `请以${summaryTargetRole.value.label}角色优先处理以下阻塞项，给出解除方案、影响范围和可立即执行的下一步。`;
    case 'document':
      return `请以${summaryTargetRole.value.label}角色把以下结果整理成可交付文档，突出结论、决策和后续动作。`;
    default:
      return `请以${summaryTargetRole.value.label}角色基于以下汇总继续推进，优先形成下一阶段最小可验证闭环。`;
  }
}

function buildTemplateTitle() {
  switch (summaryForm.templateKey) {
    case 'request_info':
      return `${summaryTargetRole.value.label}｜补充关键信息`;
    case 'unblock':
      return `${summaryTargetRole.value.label}｜解除关键阻塞`;
    case 'document':
      return `${summaryTargetRole.value.label}｜整理阶段文档`;
    default:
      return `${summaryTargetRole.value.label}｜推进下一轮执行`;
  }
}

function formatLogDetail(detailJson?: string | null) {
  if (!detailJson) {
    return '';
  }
  try {
    const parsed = JSON.parse(detailJson) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('、') : String(value)}`)
      .join(' ｜ ');
  } catch {
    return detailJson;
  }
}

function parseLogDetail(detailJson?: string | null) {
  if (!detailJson) {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(detailJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function canApplyLogToDispatch(log: OperationLogRecord) {
  return ['workspace.created', 'workspace.dispatched', 'summary.applied', 'summary.dispatched'].includes(log.action);
}

function applyLogToDispatch(log: OperationLogRecord) {
  const detail = parseLogDetail(log.detailJson);
  const detailRole = typeof detail.role === 'string' ? detail.role : (typeof detail.targetRole === 'string' ? detail.targetRole : 'developer');
  const detailTitle = typeof detail.title === 'string' ? detail.title : '基于操作流水继续派单';
  const dependencyIds = Array.isArray(detail.dependencyIds)
    ? detail.dependencyIds.filter((item): item is string => typeof item === 'string')
    : (Array.isArray(detail.sourceIds) ? detail.sourceIds.filter((item): item is string => typeof item === 'string') : []);
  const instructionSnippet = typeof detail.instructionSnippet === 'string' ? detail.instructionSnippet : '';
  const template = typeof detail.template === 'string' ? detail.template : '';
  const dispatchMode = typeof detail.dispatchMode === 'string'
    ? detail.dispatchMode
    : (log.action === 'workspace.dispatched' ? 'existing' : 'new');

  dispatchForm.mode = dispatchMode === 'existing' ? 'existing' : 'new';
  dispatchForm.roleKey = detailRole as WorkspaceRoleKey;
  dispatchForm.targetSessionId = dispatchForm.mode === 'existing' ? (log.targetId || '') : '';
  dispatchForm.title = detailTitle;
  dispatchForm.dependencyIds = dependencyIds;
  dispatchForm.includeSharedContext = true;
  dispatchForm.instruction = instructionSnippet || [
    `请基于操作流水恢复本次调度。`,
    `动作：${log.action}`,
    template ? `模板：${template}` : '',
    `摘要：${detailTitle}`,
    dependencyIds.length ? `关联子窗口：${dependencyIds.join('、')}` : ''
  ].filter(Boolean).join('\n');
  syncDispatchDefaults();
  ElMessage.success('已从操作流水回填到统一调度输入');
}

function buildBoardMeta(workspace: AgentWorkspaceSummary) {
  const pieces = [
    workspace.coordinationState === 'blocked' && workspace.workspaceMeta.blockedReason?.trim()
      ? `阻塞：${workspace.workspaceMeta.blockedReason.trim()}`
      : workspace.progressHint,
    workspace.dependencyLabels.length ? `依赖 ${workspace.dependencyLabels.length} 项` : '',
    `最近活跃：${workspace.lastActiveText}`
  ].filter(Boolean);
  return pieces.slice(0, 2).join(' ｜ ');
}

function matchesWorkspaceLogCategory(log: OperationLogRecord, category: WorkspaceLogCategory) {
  switch (category) {
    case 'dispatch':
      return ['workspace.created', 'workspace.dispatched', 'summary.applied', 'summary.dispatched'].includes(log.action);
    case 'status':
      return log.action === 'workspace.meta.updated';
    case 'close':
      return log.action === 'workspace.closed';
    default:
      return true;
  }
}

function buildBlockedSourceIds(workspace: AgentWorkspaceSummary) {
  return [...new Set([
    workspace.id,
    ...workspace.dependencies,
    ...selectedWorkspaceDependents.value.map((item) => item.id)
  ])].slice(0, 8);
}

function buildBlockedDispatchDraft(workspace: AgentWorkspaceSummary) {
  const blockedReason = workspace.workspaceMeta.blockedReason?.trim() || workspace.progressHint || '尚未填写阻塞原因';
  const dependencyText = workspace.dependencyLabels.length ? workspace.dependencyLabels.join('、') : '无显式上游依赖';
  const dependentText = selectedWorkspaceDependents.value.length
    ? selectedWorkspaceDependents.value.map((item) => `${item.role.label}·${item.title}`).join('、')
    : '暂未影响其他子窗口';

  return [
    '【阻塞协调任务】',
    `阻塞子窗口：${workspace.role.label}｜${workspace.title}`,
    `当前状态：${workspace.coordinationLabel}`,
    `阻塞原因：${blockedReason}`,
    `上游依赖：${dependencyText}`,
    `影响范围：${dependentText}`,
    '',
    '【本轮目标】',
    `请以${recommendedUnblockRole.value.label}角色优先判断阻塞根因，给出解除方案，并明确哪些动作可以立即执行。`,
    '',
    '【输出要求】',
    '1. 先判断阻塞属于需求确认、依赖等待、实现问题还是验证问题',
    '2. 给出解除阻塞的最短路径，说明是否需要补充信息、转派角色或调整优先级',
    '3. 如果会影响其他子窗口，明确同步对象和同步顺序',
    '4. 最后给出架构师可以立即执行的下一步动作'
  ].join('\n');
}

function prepareBlockedUnblockFlow(applyToDispatch = false) {
  if (!selectedWorkspace.value || selectedWorkspace.value.coordinationState !== 'blocked') {
    ElMessage.warning('当前没有可处理的阻塞子窗口');
    return;
  }

  const sourceIds = buildBlockedSourceIds(selectedWorkspace.value);
  summaryForm.templateKey = 'unblock';
  summaryForm.targetRoleKey = recommendedUnblockRoleKey.value;
  summaryForm.selectedSessionIds = sourceIds;
  summaryForm.draft = buildBlockedDispatchDraft(selectedWorkspace.value);
  summarySyncNotice.value = {
    title: '已从阻塞分析同步',
    tone: 'warning',
    message: `来源子窗口：${selectedWorkspace.value.role.label}·${selectedWorkspace.value.title}；建议转派：${recommendedUnblockRole.value.label}；已自动选中 ${sourceIds.length} 个相关子窗口作为汇总来源。`
  };

  void recordArchitectAction('summary.generated', 'success', {
    origin: 'blocked-analysis',
    template: 'unblock',
    targetRole: recommendedUnblockRoleKey.value,
    sourceIds,
    blockedSessionId: selectedWorkspace.value.id
  }, selectedWorkspace.value.id);

  if (applyToDispatch) {
    applySummaryToDispatch(false);
    ElMessage.success(`已把阻塞协调草稿带入统一调度，建议派给${recommendedUnblockRole.value.label}`);
    return;
  }

  ElMessage.success(`已生成解除阻塞草稿，建议派给${recommendedUnblockRole.value.label}`);
}

function setLaneFilter(filter: WorkspaceLaneFilter) {
  activeLaneFilter.value = filter;
}

function focusWorkspace(sessionId: string, filter?: WorkspaceLaneFilter) {
  if (filter) {
    activeLaneFilter.value = filter;
  }
  void selectWorkspace(sessionId);
}

function resolveWorkspaceFromLog(log: OperationLogRecord) {
  const targetId = log.targetId?.trim();
  if (!targetId) {
    return null;
  }
  return workspaceSummaries.value.find((item) => item.id === targetId) ?? null;
}

function canFocusLogTarget(log: OperationLogRecord) {
  return Boolean(resolveWorkspaceFromLog(log));
}

function focusWorkspaceFromLog(log: OperationLogRecord) {
  const workspace = resolveWorkspaceFromLog(log);
  if (!workspace) {
    ElMessage.warning('当前总控台未找到这个目标子窗口');
    return;
  }
  focusWorkspace(workspace.id, workspace.coordinationState);
  ElMessage.success(`已定位到 ${workspace.role.label} 子窗口`);
}

function isRelatedLog(log: OperationLogRecord) {
  return Boolean(selectedWorkspace.value && log.targetId === selectedWorkspace.value.id);
}

function clearSummarySyncNotice() {
  summarySyncNotice.value = null;
}

async function loadOperationLogs() {
  logLoading.value = true;
  try {
    const page = await fetchOperationLogs({
      targetType: 'architect-console',
      action: logFilter.action || undefined,
      operatorName: 'architect-window',
      pageNo: 1,
      pageSize: 12
    });
    operationLogs.value = page.items;
    operationLogTotal.value = page.total;
  } finally {
    logLoading.value = false;
  }
}

async function recordArchitectAction(action: string, result: string, detail?: Record<string, unknown>, targetId?: string) {
  try {
    await createOperationLog({
      targetType: 'architect-console',
      targetId,
      action,
      result,
      operatorName: 'architect-window',
      detail
    });
    await loadOperationLogs();
  } catch {
  }
}

function buildArchitectSummaryDraft() {
  clearSummarySyncNotice();
  const sources = summaryWorkspaces.value.length ? summaryWorkspaces.value : [...completedWorkspaces.value, ...blockedWorkspaces.value, ...runningWorkspaces.value].slice(0, 8);
  if (!sources.length) {
    summaryForm.draft = '当前还没有可汇总的子窗口结果。请先创建子窗口并回写进展。';
    return;
  }
  summaryForm.selectedSessionIds = sources.map((item) => item.id);
  summaryForm.draft = [
    '【架构师汇总】',
    ...sources.map((item, index) => `${index + 1}. ${item.role.label}｜${item.title}｜状态：${item.coordinationLabel}｜进展：${item.progressHint}${item.dependencyLabels.length ? `｜依赖：${item.dependencyLabels.join('、')}` : ''}`),
    '',
    '【调度模板】',
    buildTemplateSuggestion(),
    '',
    '【下一步调度建议】',
    blockedWorkspaces.value.length ? `- 先解除阻塞：${blockedWorkspaces.value.map((item) => `${item.role.label}｜${item.title}`).join('；')}` : '- 暂无显式阻塞，可继续推进下一批子任务。',
    completedWorkspaces.value.length ? `- 汇总已完成结果：${completedWorkspaces.value.map((item) => `${item.role.label}｜${item.title}`).join('；')}` : '- 暂无已完成子窗口，下一步应先要求执行中子窗口回报阶段性结果。',
    runningWorkspaces.value.length ? `- 同步执行中状态：${runningWorkspaces.value.map((item) => `${item.role.label}｜${item.title}`).join('；')}` : '- 暂无执行中子窗口。'
  ].join('\n');
  void recordArchitectAction('summary.generated', 'success', {
    template: summaryForm.templateKey,
    targetRole: summaryForm.targetRoleKey,
    sourceCount: sources.length,
    sourceIds: summaryForm.selectedSessionIds
  });
}

function applySummaryToDispatch(showMessage = true) {
  if (!summaryForm.draft.trim()) {
    buildArchitectSummaryDraft();
  }
  dispatchForm.mode = summaryTargetWorkspace.value ? 'existing' : 'new';
  dispatchForm.targetSessionId = summaryTargetWorkspace.value?.id ?? '';
  dispatchForm.roleKey = summaryForm.targetRoleKey;
  dispatchForm.title = buildTemplateTitle();
  dispatchForm.instruction = summaryForm.draft;
  dispatchForm.dependencyIds = [...summaryForm.selectedSessionIds];
  dispatchForm.includeSharedContext = true;
  syncDispatchDefaults();
  void recordArchitectAction('summary.applied', 'success', {
    template: summaryForm.templateKey,
    targetRole: summaryForm.targetRoleKey,
    dispatchMode: dispatchForm.mode,
    sourceIds: summaryForm.selectedSessionIds,
    title: buildTemplateTitle(),
    instructionSnippet: summaryForm.draft.slice(0, 600)
  }, summaryTargetWorkspace.value?.id);
  if (showMessage) {
    ElMessage.success(summaryTargetWorkspace.value ? '已带入派单，并将发送到现有子窗口' : '已带入派单，并将创建新子窗口');
  }
}

async function dispatchSummaryNow() {
  applySummaryToDispatch(false);
  await handleDispatch();
  await recordArchitectAction('summary.dispatched', 'success', {
    template: summaryForm.templateKey,
    targetRole: summaryForm.targetRoleKey,
    dispatchMode: dispatchForm.mode,
    sourceIds: summaryForm.selectedSessionIds,
    title: buildTemplateTitle(),
    instructionSnippet: summaryForm.draft.slice(0, 600)
  }, dispatchForm.targetSessionId || summaryTargetWorkspace.value?.id);
}

async function selectWorkspace(sessionId: string) {
  if (!sessionId) return;
  selectedSessionId.value = sessionId;
  detailTab.value = 'messages';
  await sessionStore.loadDetail(sessionId);
}

async function ensureSelection() {
  const candidateWorkspaces = filteredWorkspaceSummaries.value.length ? filteredWorkspaceSummaries.value : workspaceSummaries.value;
  if (!candidateWorkspaces.length) return;
  const nextId = candidateWorkspaces.some((item) => item.id === selectedSessionId.value)
    ? selectedSessionId.value
    : candidateWorkspaces[0]?.id || '';
  if (nextId) await selectWorkspace(nextId);
}

async function refreshDashboard() {
  await Promise.all([runtimeStore.refreshAll(), instanceStore.load(), sessionStore.loadList(), configStore.load(), loadOperationLogs()]);
  syncDispatchDefaults();
  await ensureSelection();
}
function buildWorkspaceTitle() {
  const title = dispatchForm.title.trim();
  return title ? `${roleDefinition.value.label}｜${title}` : `${roleDefinition.value.label}｜待分配子任务`;
}

async function handleDispatch() {
  if (!dispatchForm.instruction.trim()) return ElMessage.warning('请先输入要派发的任务说明');
  dispatching.value = true;
  try {
    if (dispatchForm.mode === 'new') {
      if (!dispatchForm.instanceId) return ElMessage.warning('请先选择应用实例');
      const session = await sessionStore.create({
        appInstanceId: dispatchForm.instanceId,
        title: buildWorkspaceTitle(),
        projectPath: dispatchForm.projectPath,
        interactionMode: 'RAW',
        initInput: dispatchPreview.value,
        tags: buildWorkspaceTags(dispatchForm.roleKey, dispatchForm.dependencyIds, 'assigned'),
        workspaceMeta: { workspaceKind: 'child', role: dispatchForm.roleKey, coordinationStatus: 'assigned', progressSummary: dispatchForm.title.trim() || '架构师已派发新任务', dependencySessionIds: dispatchForm.dependencyIds, sharedContextSummary: collaborationSnapshot.value || null }
      });
      ElMessage.success('子窗口已创建');
      await recordArchitectAction('workspace.created', 'success', {
        role: dispatchForm.roleKey,
        title: buildWorkspaceTitle(),
        dependencyIds: dispatchForm.dependencyIds,
        projectPath: dispatchForm.projectPath,
        instructionSnippet: dispatchForm.instruction.slice(0, 400)
      }, session.id);
      dispatchForm.title = ''; dispatchForm.instruction = ''; dispatchForm.dependencyIds = [];
      await sessionStore.loadList();
      await selectWorkspace(session.id);
    } else {
      if (!dispatchForm.targetSessionId) return ElMessage.warning('请先选择目标子窗口');
      if (!existingTargetWorkspace.value?.canDispatch) return ElMessage.warning('目标子窗口当前不可继续派单');
      await sessionStore.sendInput(dispatchForm.targetSessionId, dispatchPreview.value);
      await sessionStore.updateWorkspaceMeta(dispatchForm.targetSessionId, { workspaceKind: 'child', role: dispatchForm.roleKey, coordinationStatus: 'running', progressSummary: dispatchForm.title.trim() || '架构师已下发新的执行指令', blockedReason: '', dependencySessionIds: dispatchForm.dependencyIds, sharedContextSummary: collaborationSnapshot.value || '' });
      ElMessage.success('调度指令已发送');
      await recordArchitectAction('workspace.dispatched', 'success', {
        role: dispatchForm.roleKey,
        title: dispatchForm.title.trim() || '架构师已下发新的执行指令',
        dependencyIds: dispatchForm.dependencyIds,
        dispatchMode: 'existing',
        instructionSnippet: dispatchForm.instruction.slice(0, 400)
      }, dispatchForm.targetSessionId);
      dispatchForm.title = ''; dispatchForm.instruction = ''; dispatchForm.dependencyIds = [];
      await selectWorkspace(dispatchForm.targetSessionId);
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    dispatching.value = false;
  }
}

async function saveWorkspaceMeta(status?: string) {
  if (!selectedWorkspace.value) return;
  if (status) workspaceForm.coordinationStatus = status;
  saving.value = true;
  try {
    await sessionStore.updateWorkspaceMeta(selectedWorkspace.value.id, {
      workspaceKind: selectedWorkspace.value.workspaceMeta.workspaceKind || 'child',
      role: workspaceForm.roleKey,
      coordinationStatus: workspaceForm.coordinationStatus,
      progressSummary: workspaceForm.progressSummary.trim(),
      blockedReason: workspaceForm.coordinationStatus === 'blocked' ? workspaceForm.blockedReason.trim() : '',
      dependencySessionIds: workspaceForm.dependencySessionIds,
      sharedContextSummary: workspaceForm.sharedContextSummary.trim()
    });
    ElMessage.success('协作状态已保存');
    await recordArchitectAction('workspace.meta.updated', 'success', {
      role: workspaceForm.roleKey,
      coordinationStatus: workspaceForm.coordinationStatus,
      dependencyIds: workspaceForm.dependencySessionIds,
      progressSummary: workspaceForm.progressSummary.trim()
    }, selectedWorkspace.value.id);
    await ensureSelection();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function handleStopWorkspace(sessionId: string) {
  try {
    await sessionStore.stop(sessionId);
    await sessionStore.updateWorkspaceMeta(sessionId, { workspaceKind: 'child', role: workspaceSummaries.value.find((item) => item.id === sessionId)?.role.key || 'general', coordinationStatus: 'closed', progressSummary: '架构师已发起关闭指令', blockedReason: '', dependencySessionIds: workspaceSummaries.value.find((item) => item.id === sessionId)?.dependencies ?? [], sharedContextSummary: '' });
    ElMessage.success('已向子窗口发送关闭指令');
    await recordArchitectAction('workspace.closed', 'success', {
      coordinationStatus: 'closed'
    }, sessionId);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function openSessionDetail(sessionId: string) { router.push(`/sessions/${sessionId}`); }
function openSessionAdmin() { router.push('/sessions'); }

watch(() => [configStore.defaultProjectPath, enabledInstances.value.length], syncDispatchDefaults, { immediate: true });
watch(() => dispatchForm.mode, (mode) => { if (mode === 'existing' && !dispatchForm.targetSessionId) syncDispatchDefaults(); if (mode === 'new') dispatchForm.targetSessionId = ''; }, { immediate: true });
watch(activeLaneFilter, async () => {
  if (!filteredWorkspaceSummaries.value.length) {
    return;
  }
  if (!filteredWorkspaceSummaries.value.some((workspace) => workspace.id === selectedSessionId.value)) {
    await ensureSelection();
  }
});
watch(selectedWorkspace, (workspace) => {
  if (!workspace) {
    currentWorkspaceLogOnly.value = false;
    currentWorkspaceLogCategory.value = 'all';
  }
}, { immediate: true });
watch(currentWorkspaceLogOnly, (enabled) => {
  if (!enabled) {
    currentWorkspaceLogCategory.value = 'all';
  }
});
watch(workspaceSummaries, async () => {
  summaryForm.selectedSessionIds = summaryForm.selectedSessionIds.filter((item) => workspaceSummaries.value.some((workspace) => workspace.id === item));
  syncDispatchDefaults();
  if (!selectedSessionId.value || (filteredWorkspaceSummaries.value.length && !filteredWorkspaceSummaries.value.some((workspace) => workspace.id === selectedSessionId.value))) {
    await ensureSelection();
  }
}, { deep: true });
watch(selectedWorkspace, syncWorkspaceForm, { immediate: true });

onMounted(async () => { await refreshDashboard(); await sessionStore.ensureSocket(); });
onBeforeUnmount(() => { sessionStore.disconnectSocket(); });
</script>

<template>
  <div class="architect-dashboard">
    <div class="page-header page-header--architect">
      <div>
        <h2>架构师总控台</h2>
        <p class="page-description">统一创建子窗口、派单、看进度、做汇总，用户始终只面对主窗口。</p>
      </div>
      <div class="page-toolbar">
        <el-button @click="openSessionAdmin">打开会话管理</el-button>
        <el-button type="primary" @click="refreshDashboard">刷新总控台</el-button>
      </div>
    </div>

    <StatisticsCards :statistics="runtimeStore.statistics" />

    <div class="hero-grid">
      <div
        v-for="lane in laneCards"
        :key="lane.label"
        class="hero-card"
        :class="[`is-${lane.className}`, { 'is-active': activeLaneFilter === lane.filterValue }]"
        @click="setLaneFilter(lane.filterValue)"
      >
        <div class="hero-label">{{ lane.label }}</div>
        <div class="hero-value">{{ lane.value }}</div>
        <div class="hero-caption">{{ activeLaneFilter === lane.filterValue ? '当前筛选' : '点击筛选' }}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <el-card class="page-card">
        <template #header>统一调度输入</template>
        <el-form label-width="86px">
          <el-form-item label="调度方式"><el-radio-group v-model="dispatchForm.mode"><el-radio-button label="new" value="new">新建</el-radio-button><el-radio-button label="existing" value="existing">派单</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="角色"><el-select v-model="dispatchForm.roleKey" style="width:100%"><el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" /></el-select></el-form-item>
          <el-form-item v-if="dispatchForm.mode === 'new'" label="实例"><el-select v-model="dispatchForm.instanceId" style="width:100%"><el-option v-for="instance in enabledInstances" :key="instance.id" :label="`${instance.name} (${instance.appType})`" :value="instance.id" /></el-select></el-form-item>
          <el-form-item v-else label="目标"><el-select v-model="dispatchForm.targetSessionId" style="width:100%"><el-option v-for="workspace in workspaceSummaries" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
          <el-form-item label="标题"><el-input v-model="dispatchForm.title" clearable /></el-form-item>
          <el-form-item label="目录"><el-input v-model="dispatchForm.projectPath" clearable /></el-form-item>
          <el-form-item label="依赖"><el-select v-model="dispatchForm.dependencyIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip><el-option v-for="workspace in dispatchDependencyOptions" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
          <el-form-item label="任务说明"><el-input v-model="dispatchForm.instruction" type="textarea" :rows="6" placeholder="说明本次要完成什么、不要做什么、如何汇报。" /></el-form-item>
          <el-form-item label="共享上下文"><div class="switch-row"><el-switch v-model="dispatchForm.includeSharedContext" /><span>自动注入其他子窗口关键进展</span></div></el-form-item>
          <div class="align-right"><el-button :loading="dispatching" type="primary" @click="handleDispatch">{{ dispatchForm.mode === 'new' ? '创建并派发' : '发送调度' }}</el-button></div>
        </el-form>
      </el-card>

      <el-card class="page-card">
        <template #header>
          <div class="card-head">
            <span>子窗口工作台</span>
            <div class="card-tools">
              <el-tag type="info">{{ filteredWorkspaceSummaries.length }} / {{ workspaceSummaries.length }} 个子窗口</el-tag>
              <el-tag :type="activeLaneFilter === 'all' ? 'info' : 'primary'">筛选：{{ activeLaneLabel }}</el-tag>
              <el-button v-if="activeLaneFilter !== 'all'" link type="primary" @click="setLaneFilter('all')">查看全部</el-button>
            </div>
          </div>
        </template>
        <el-empty v-if="filteredWorkspaceSummaries.length === 0" :description="activeLaneFilter === 'all' ? '先创建第一个子窗口' : `当前没有${activeLaneLabel}子窗口`" />
        <div v-else class="workspace-grid">
          <AgentWorkspaceCard v-for="workspace in filteredWorkspaceSummaries" :key="workspace.id" :summary="workspace" :selected="workspace.id === selectedSessionId" @select="selectWorkspace(workspace.id)" @open-detail="openSessionDetail(workspace.id)" @stop="handleStopWorkspace(workspace.id)" />
        </div>
      </el-card>

      <el-card class="page-card">
        <template #header>协作状态看板</template>
        <div class="board-group">
          <strong>待开始</strong>
          <div v-for="workspace in assignedWorkspaces" :key="workspace.id" class="board-item board-item--assigned board-item--interactive" :class="{ 'is-selected': workspace.id === selectedSessionId }" @click="focusWorkspace(workspace.id, 'assigned')">
            <div class="lane-item-title">{{ workspace.role.label }} · {{ workspace.title }}</div>
            <div class="lane-item-meta">{{ buildBoardMeta(workspace) }}</div>
          </div>
          <el-empty v-if="assignedWorkspaces.length===0" description="暂无" :image-size="56" />
        </div>
        <div class="board-group">
          <strong>执行中</strong>
          <div v-for="workspace in runningWorkspaces" :key="workspace.id" class="board-item board-item--interactive" :class="{ 'is-selected': workspace.id === selectedSessionId }" @click="focusWorkspace(workspace.id, 'running')">
            <div class="lane-item-title">{{ workspace.role.label }} · {{ workspace.title }}</div>
            <div class="lane-item-meta">{{ buildBoardMeta(workspace) }}</div>
          </div>
          <el-empty v-if="runningWorkspaces.length===0" description="暂无" :image-size="56" />
        </div>
        <div class="board-group">
          <strong>已阻塞</strong>
          <div v-for="workspace in blockedWorkspaces" :key="workspace.id" class="board-item board-item--blocked board-item--interactive" :class="{ 'is-selected': workspace.id === selectedSessionId }" @click="focusWorkspace(workspace.id, 'blocked')">
            <div class="lane-item-title">{{ workspace.role.label }} · {{ workspace.title }}</div>
            <div class="lane-item-meta">{{ buildBoardMeta(workspace) }}</div>
          </div>
          <el-empty v-if="blockedWorkspaces.length===0" description="暂无" :image-size="56" />
        </div>
        <div class="board-group">
          <strong>已完成</strong>
          <div v-for="workspace in completedWorkspaces" :key="workspace.id" class="board-item board-item--completed board-item--interactive" :class="{ 'is-selected': workspace.id === selectedSessionId }" @click="focusWorkspace(workspace.id, 'completed')">
            <div class="lane-item-title">{{ workspace.role.label }} · {{ workspace.title }}</div>
            <div class="lane-item-meta">{{ buildBoardMeta(workspace) }}</div>
          </div>
          <el-empty v-if="completedWorkspaces.length===0" description="暂无" :image-size="56" />
        </div>
        <div class="board-group">
          <strong>已关闭</strong>
          <div v-for="workspace in closedWorkspaces" :key="workspace.id" class="board-item board-item--closed board-item--interactive" :class="{ 'is-selected': workspace.id === selectedSessionId }" @click="focusWorkspace(workspace.id, 'closed')">
            <div class="lane-item-title">{{ workspace.role.label }} · {{ workspace.title }}</div>
            <div class="lane-item-meta">{{ buildBoardMeta(workspace) }}</div>
          </div>
          <el-empty v-if="closedWorkspaces.length===0" description="暂无" :image-size="56" />
        </div>
      </el-card>

      <el-card class="page-card main-span">
        <template #header><div class="card-head"><span>当前聚焦子窗口</span><el-button v-if="selectedWorkspace" @click="openSessionDetail(selectedWorkspace.id)">打开完整详情</el-button></div></template>
        <el-empty v-if="!selectedWorkspace" description="请选择一个子窗口" />
        <template v-else>
          <div class="focus-head">
            <div>
              <div class="focus-title">{{ selectedWorkspace.role.emoji }} {{ selectedWorkspace.title }}</div>
              <div class="focus-subtitle">{{ selectedWorkspace.instanceName }} · {{ selectedWorkspace.projectPath }}</div>
            </div>
            <div class="page-toolbar"><el-tag :type="selectedWorkspace.coordinationTone">{{ selectedWorkspace.coordinationLabel }}</el-tag><el-tag type="info">{{ selectedWorkspace.role.label }}</el-tag></div>
          </div>
          <div class="detail-meta">
            <div class="meta-card"><div class="meta-label">后端状态</div><div class="meta-value"><StatusTag :status="runtimeStore.health?.status ?? 'DOWN'" /></div></div>
            <div class="meta-card"><div class="meta-label">最近活跃</div><div class="meta-value">{{ selectedWorkspace.lastActiveText }}</div></div>
            <div class="meta-card"><div class="meta-label">依赖数量</div><div class="meta-value">{{ selectedWorkspace.dependencyLabels.length }}</div></div>
            <div class="meta-card"><div class="meta-label">Socket</div><div class="meta-value">{{ sessionStore.socketConnected ? '已连接' : '未连接' }}</div></div>
          </div>
          <div v-if="selectedWorkspace.coordinationState === 'blocked'" class="blocked-analysis">
            <div class="card-head">
              <strong>阻塞分析</strong>
              <div class="blocked-header-tags">
                <el-tag type="danger">优先处理</el-tag>
                <el-tag type="warning">建议转派：{{ recommendedUnblockRole.label }}</el-tag>
              </div>
            </div>
            <div class="blocked-analysis-grid">
              <div class="blocked-analysis-card">
                <div class="meta-label">阻塞原因</div>
                <div class="lane-item-meta">{{ selectedWorkspace.workspaceMeta.blockedReason || selectedWorkspace.progressHint || '尚未填写' }}</div>
              </div>
              <div class="blocked-analysis-card">
                <div class="meta-label">上游依赖</div>
                <div class="lane-item-meta">{{ selectedWorkspace.dependencyLabels.length ? selectedWorkspace.dependencyLabels.join('、') : '无显式上游依赖' }}</div>
              </div>
              <div class="blocked-analysis-card">
                <div class="meta-label">影响范围</div>
                <div class="lane-item-meta">{{ selectedWorkspaceDependents.length ? selectedWorkspaceDependents.map((item) => `${item.role.label}·${item.title}`).join('、') : '暂未影响其他子窗口' }}</div>
              </div>
            </div>
            <div class="blocked-route-hint">
              {{ recommendedUnblockTargetWorkspace
                ? `当前已有可复用的 ${recommendedUnblockRole.label} 子窗口：${recommendedUnblockTargetWorkspace.title}`
                : `当前没有可复用的 ${recommendedUnblockRole.label} 子窗口，带入统一调度后将默认创建新的阻塞协调窗口` }}
            </div>
            <div class="blocked-suggestion-list">
              <div v-for="(suggestion, index) in blockedWorkspaceSuggestions" :key="`${selectedWorkspace.id}-${index}`" class="blocked-suggestion-item">
                {{ index + 1 }}. {{ suggestion }}
              </div>
            </div>
            <div class="blocked-actions">
              <el-button @click="prepareBlockedUnblockFlow()">生成解除阻塞草稿</el-button>
              <el-button type="primary" @click="prepareBlockedUnblockFlow(true)">带入统一调度</el-button>
            </div>
          </div>
          <div class="focus-log-panel">
            <div class="card-head">
              <strong>关联调度流水</strong>
              <span class="meta-label">{{ selectedWorkspaceLogs.length }} 条最近记录</span>
            </div>
            <el-empty v-if="selectedWorkspaceLogs.length === 0" description="当前聚焦子窗口还没有最近调度流水" :image-size="48" />
            <div v-else class="focus-log-list">
              <div v-for="log in selectedWorkspaceLogs" :key="log.id" class="focus-log-item">
                <div class="card-head">
                  <strong>{{ log.action }}</strong>
                  <span class="meta-label">{{ log.createdAt }}</span>
                </div>
                <div v-if="formatLogDetail(log.detailJson)" class="lane-item-meta">{{ formatLogDetail(log.detailJson) }}</div>
                <div class="focus-log-actions">
                  <el-button v-if="canApplyLogToDispatch(log)" size="small" @click="applyLogToDispatch(log)">回填派单</el-button>
                  <el-button size="small" link @click="openSessionDetail(selectedWorkspace.id)">打开详情</el-button>
                </div>
              </div>
            </div>
          </div>
          <el-tabs v-model="detailTab"><el-tab-pane label="结构化消息" name="messages"><SessionMessageList :messages="sessionStore.messages" :highlight-message-id="sessionStore.highlightedMessageId" /></el-tab-pane><el-tab-pane label="会话时间线" name="timeline"><SessionTimelineList :items="sessionStore.timelineItems" :highlight-message-id="sessionStore.highlightedMessageId" @jump-to-message="() => { detailTab = 'messages'; }" /></el-tab-pane></el-tabs>
        </template>
      </el-card>

      <el-card class="page-card">
        <template #header>子窗口协作状态</template>
        <el-empty v-if="!selectedWorkspace" description="先选择一个子窗口" />
        <template v-else>
          <div class="quick-actions"><el-button size="small" @click="saveWorkspaceMeta('running')">标记执行中</el-button><el-button size="small" type="warning" @click="saveWorkspaceMeta('blocked')">标记阻塞</el-button><el-button size="small" type="success" @click="saveWorkspaceMeta('completed')">标记完成</el-button><el-button size="small" type="info" @click="saveWorkspaceMeta('closed')">标记关闭</el-button></div>
          <el-form label-width="74px">
            <el-form-item label="角色"><el-select v-model="workspaceForm.roleKey" style="width:100%"><el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" /></el-select></el-form-item>
            <el-form-item label="状态"><el-select v-model="workspaceForm.coordinationStatus" style="width:100%"><el-option v-for="option in coordinationOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item>
            <el-form-item label="摘要"><el-input v-model="workspaceForm.progressSummary" type="textarea" :rows="3" /></el-form-item>
            <el-form-item label="阻塞"><el-input v-model="workspaceForm.blockedReason" type="textarea" :rows="3" :disabled="workspaceForm.coordinationStatus !== 'blocked'" /></el-form-item>
            <el-form-item label="依赖"><el-select v-model="workspaceForm.dependencySessionIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip><el-option v-for="workspace in workspaceDependencyOptions" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
            <el-form-item label="共享"><el-input v-model="workspaceForm.sharedContextSummary" type="textarea" :rows="3" /></el-form-item>
            <div class="align-right"><el-button :loading="saving" type="primary" @click="saveWorkspaceMeta()">保存协作状态</el-button></div>
          </el-form>
        </template>
      </el-card>

      <el-card class="page-card">
        <template #header>架构师汇总与再调度</template>
        <el-form label-width="74px">
          <el-alert
            v-if="summarySyncNotice"
            :title="summarySyncNotice.title"
            :description="summarySyncNotice.message"
            :type="summarySyncNotice.tone"
            :closable="true"
            show-icon
            @close="clearSummarySyncNotice"
          />
          <el-form-item label="来源">
            <el-select v-model="summaryForm.selectedSessionIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip placeholder="选择要纳入汇总的子窗口">
              <el-option v-for="workspace in workspaceSummaries" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title} · ${workspace.coordinationLabel}`" :value="workspace.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="模板">
            <el-select v-model="summaryForm.templateKey" style="width:100%">
              <el-option v-for="option in summaryTemplateOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标角色">
            <el-select v-model="summaryForm.targetRoleKey" style="width:100%">
              <el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" />
            </el-select>
          </el-form-item>
          <div class="board-item board-item--assigned">
            {{ summaryTargetWorkspace ? `将优先派给现有子窗口：${summaryTargetWorkspace.role.label} · ${summaryTargetWorkspace.title}` : `当前没有可复用的 ${summaryTargetRole.label} 子窗口，将创建新的下一轮子窗口` }}
          </div>
          <el-form-item label="草稿">
            <el-input v-model="summaryForm.draft" type="textarea" :rows="9" placeholder="点击生成汇总，或手动编辑下一步调度草稿" />
          </el-form-item>
          <div class="quick-actions">
            <el-button @click="buildArchitectSummaryDraft">生成汇总</el-button>
            <el-button @click="applySummaryToDispatch">带入派单</el-button>
            <el-button type="primary" :loading="dispatching" @click="dispatchSummaryNow">一键再派单</el-button>
          </div>
        </el-form>
      </el-card>

      <el-card class="page-card">
        <template #header>共享上下文预览</template>
        <pre class="context-preview">{{ dispatchPreview }}</pre>
      </el-card>

      <el-card class="page-card">
        <template #header>
          <div class="card-head">
            <span>架构师操作流水</span>
            <div class="quick-actions">
              <el-switch
                v-model="currentWorkspaceLogOnly"
                :disabled="!selectedWorkspace"
                inline-prompt
                active-text="当前"
                inactive-text="全部"
              />
              <span class="meta-label">{{ displayedOperationLogLabel }}</span>
              <el-segmented
                v-if="currentWorkspaceLogOnly && selectedWorkspace"
                v-model="currentWorkspaceLogCategory"
                :options="workspaceLogCategoryOptions"
                size="small"
              />
              <span v-if="currentWorkspaceLogOnly && selectedWorkspace" class="meta-label">分类：{{ currentWorkspaceLogCategoryLabel }}</span>
              <el-select v-model="logFilter.action" size="small" style="width: 180px" @change="loadOperationLogs">
                <el-option v-for="option in operationLogActionOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
              <el-button size="small" :loading="logLoading" @click="loadOperationLogs">刷新日志</el-button>
            </div>
          </div>
        </template>
        <el-empty v-if="displayedOperationLogs.length === 0" :description="currentWorkspaceLogOnly && selectedWorkspace ? '当前子窗口暂无匹配日志' : '暂无调度日志'" />
        <div v-else>
          <div class="meta-label">当前显示 {{ displayedOperationLogs.length }} 条{{ currentWorkspaceLogOnly ? `（最近总计 ${operationLogs.length} 条）` : ` / 共 ${operationLogTotal} 条` }}</div>
          <div v-for="log in displayedOperationLogs" :key="log.id" class="board-item board-item--log" :class="{ 'is-related': isRelatedLog(log) }">
            <div class="card-head">
              <strong>{{ log.action }}</strong>
              <el-tag size="small" :type="log.result === 'success' ? 'success' : 'danger'">{{ log.result }}</el-tag>
            </div>
            <div class="meta-label">{{ log.operatorName }} · {{ log.createdAt }}</div>
            <div v-if="log.targetId" class="meta-label">目标：{{ log.targetId }}</div>
            <div v-if="formatLogDetail(log.detailJson)" class="lane-item-meta">{{ formatLogDetail(log.detailJson) }}</div>
            <div class="log-actions">
              <el-button v-if="canFocusLogTarget(log)" size="small" link type="primary" @click="focusWorkspaceFromLog(log)">定位子窗口</el-button>
              <el-button v-if="canApplyLogToDispatch(log)" size="small" @click="applyLogToDispatch(log)">回填派单</el-button>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page-header--architect { align-items: flex-start; }
.page-description { margin: 8px 0 0; color: #64748b; }
.hero-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.hero-card { padding: 16px; border-radius: 16px; color: #fff; box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12); cursor: pointer; transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease; }
.hero-card:hover { transform: translateY(-2px); box-shadow: 0 16px 28px rgba(15, 23, 42, 0.18); }
.hero-card.is-active { box-shadow: 0 0 0 2px rgba(255, 255, 255, .68), 0 18px 32px rgba(15, 23, 42, 0.2); }
.hero-card.is-all { background: linear-gradient(135deg, #0f172a, #334155); }
.hero-card.is-assigned { background: linear-gradient(135deg, #f59e0b, #d97706); }
.hero-card.is-running { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
.hero-card.is-blocked { background: linear-gradient(135deg, #ef4444, #dc2626); }
.hero-card.is-completed { background: linear-gradient(135deg, #059669, #047857); }
.hero-card.is-closed { background: linear-gradient(135deg, #64748b, #475569); }
.hero-label { font-size: 13px; opacity: .86; }
.hero-value { margin-top: 10px; font-size: 30px; font-weight: 700; }
.hero-caption { margin-top: 10px; font-size: 12px; opacity: .82; }
.dashboard-grid { display: grid; grid-template-columns: 340px minmax(0, 1fr) 360px; gap: 16px; margin-top: 16px; align-items: start; }
.main-span { grid-column: 2 / 3; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.switch-row, .align-right, .quick-actions, .focus-head { display: flex; gap: 12px; }
.switch-row { align-items: center; color: #475569; }
.align-right { justify-content: flex-end; }
.quick-actions { flex-wrap: wrap; margin-bottom: 12px; }
.workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.board-group + .board-group { margin-top: 16px; }
.board-item { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(37, 99, 235, .08); }
.board-item--assigned { background: rgba(245, 158, 11, .12); }
.board-item--blocked { background: rgba(239, 68, 68, .12); }
.board-item--completed { background: rgba(5, 150, 105, .12); }
.board-item--closed { background: rgba(100, 116, 139, .14); }
.board-item--interactive { cursor: pointer; transition: transform .16s ease, box-shadow .16s ease; }
.board-item--interactive:hover { transform: translateY(-1px); box-shadow: 0 12px 22px rgba(15, 23, 42, .08); }
.board-item.is-selected { box-shadow: 0 0 0 2px rgba(37, 99, 235, .18); }
.board-item--log { background: rgba(15, 23, 42, .05); }
.board-item--log.is-related { box-shadow: 0 0 0 2px rgba(37, 99, 235, .18); background: rgba(37, 99, 235, .08); }
.lane-item-title { font-weight: 600; color: #0f172a; }
.lane-item-meta { margin-top: 6px; color: #475569; font-size: 12px; line-height: 1.6; }
.focus-head { justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.focus-title { font-size: 18px; font-weight: 700; color: #111827; }
.focus-subtitle { margin-top: 6px; color: #64748b; word-break: break-all; }
.blocked-analysis { margin: 16px 0; padding: 14px; border-radius: 16px; background: rgba(239, 68, 68, .06); border: 1px solid rgba(239, 68, 68, .14); }
.blocked-header-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.blocked-analysis-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.blocked-analysis-card { padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, .92); }
.blocked-route-hint { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: rgba(245, 158, 11, .12); color: #92400e; font-size: 13px; line-height: 1.7; }
.blocked-suggestion-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.blocked-suggestion-item { padding: 10px 12px; border-radius: 12px; background: rgba(15, 23, 42, .05); color: #334155; font-size: 13px; line-height: 1.7; }
.blocked-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.focus-log-panel { margin: 16px 0; padding: 14px; border-radius: 16px; background: rgba(15, 23, 42, .04); }
.focus-log-list { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.focus-log-item { padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, .9); border: 1px solid rgba(148, 163, 184, .18); }
.focus-log-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.log-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.context-preview { margin: 0; max-height: 420px; overflow: auto; padding: 14px; border-radius: 16px; background: #0f172a; color: #e2e8f0; white-space: pre-wrap; word-break: break-word; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 1.7; }
@media (max-width: 1760px) { .hero-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1680px) { .dashboard-grid { grid-template-columns: 320px minmax(0, 1fr); } .main-span { grid-column: auto; } }
@media (max-width: 1380px) { .hero-grid, .dashboard-grid, .workspace-grid, .blocked-analysis-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
