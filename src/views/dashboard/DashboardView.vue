<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AgentWorkspaceCard from '@/components/AgentWorkspaceCard.vue';
import SessionMessageList from '@/components/SessionMessageList.vue';
import SessionTimelineList from '@/components/SessionTimelineList.vue';
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
  diagnoseBlockedWorkspace,
  buildWorkspaceSummary,
  buildWorkspaceTags,
  finalizeWorkspaceSummaries,
  getWorkspaceRole,
  isCollaborativeWorkspaceSession,
  WORKSPACE_ROLES,
  type BlockedDiagnosis,
  type AgentWorkspaceSummary,
  type CoordinationState,
  type WorkspaceRoleKey
} from '@/utils/architectConsole';
import { pickPreferredInstanceId, rememberPreferredInstance, sortInstancesByPreference } from '@/utils/instancePreference';

type WorkspaceLaneFilter = CoordinationState | 'all';
type WorkspaceLogCategory = 'all' | 'dispatch' | 'status' | 'close';
type GuideAction = 'dispatch' | 'summary' | 'logs' | 'source';

const router = useRouter();
const route = useRoute();
const runtimeStore = useRuntimeStore();
const instanceStore = useInstanceStore();
const sessionStore = useSessionStore();
const configStore = useConfigStore();

const selectedSessionId = ref('');
const detailTab = ref<'messages' | 'timeline' | 'workspace'>('messages');
const controlTab = ref<'dispatch' | 'summary' | 'logs'>('dispatch');
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
const summarySyncNotice = ref<{ title: string; message: string; tone: 'info' | 'warning' | 'success'; sourceSessionId?: string | null } | null>(null);
const spotlightWorkspaceId = ref('');
const workspaceCardRefs = new Map<string, HTMLElement>();
let workspaceSpotlightTimer: number | undefined;

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

const enabledInstances = computed(() => sortInstancesByPreference(instanceStore.items.filter((item) => item.enabled)));
const workspaceSummaries = computed(() => finalizeWorkspaceSummaries(
  sessionStore.items
    .filter((item) => isCollaborativeWorkspaceSession(item))
    .map((item) => buildWorkspaceSummary(item, instanceStore.items))
));
const filteredWorkspaceSummaries = computed(() => activeLaneFilter.value === 'all'
  ? workspaceSummaries.value
  : workspaceSummaries.value.filter((item) => item.coordinationState === activeLaneFilter.value));
const selectedWorkspace = computed(() => workspaceSummaries.value.find((item) => item.id === selectedSessionId.value) ?? null);
const selectedWorkspaceDependencySummaries = computed(() => {
  if (!selectedWorkspace.value) {
    return [] as AgentWorkspaceSummary[];
  }
  return selectedWorkspace.value.dependencies
    .map((dependencyId) => workspaceSummaries.value.find((item) => item.id === dependencyId))
    .filter(Boolean) as AgentWorkspaceSummary[];
});
const selectedWorkspaceMissingDependencyIds = computed(() => {
  if (!selectedWorkspace.value) {
    return [] as string[];
  }
  return selectedWorkspace.value.dependencies.filter((dependencyId) => !workspaceSummaries.value.some((item) => item.id === dependencyId));
});
const selectedWorkspaceDependents = computed(() => {
  if (!selectedWorkspace.value) {
    return [] as AgentWorkspaceSummary[];
  }
  return workspaceSummaries.value.filter((item) => item.dependencies.includes(selectedWorkspace.value!.id));
});
const selectedWorkspaceRelationSummary = computed(() => {
  if (!selectedWorkspace.value) {
    return null;
  }
  if (selectedWorkspace.value.coordinationState === 'blocked' && selectedWorkspaceDependents.value.length) {
    return {
      tone: 'danger' as const,
      title: '当前阻塞已经影响下游协作',
      description: '建议先回收阻塞根因、同步受影响窗口，再决定下一轮调度。'
    };
  }
  if (selectedWorkspace.value.coordinationState === 'blocked') {
    return {
      tone: 'warning' as const,
      title: '当前窗口已阻塞',
      description: '建议优先处理阻塞，再决定是否继续扩派或改派角色。'
    };
  }
  if (selectedWorkspaceDependents.value.length) {
    return {
      tone: 'warning' as const,
      title: '当前窗口的进展会影响其他子窗口',
      description: '先确认下游是否已经拿到所需输入，避免总控台状态看起来在推进，实际还在等待。'
    };
  }
  if (selectedWorkspaceDependencySummaries.value.length || selectedWorkspaceMissingDependencyIds.value.length) {
    return {
      tone: 'info' as const,
      title: '当前窗口依赖上游结果',
      description: '继续派单前，建议先确认上游结果是否就绪，以及现有任务说明是否仍然成立。'
    };
  }
  return {
    tone: 'success' as const,
    title: '当前窗口可相对独立推进',
    description: '当前没有明显上下游关系，适合先聚焦执行，再按结果做汇总或扩派。'
  };
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
const blockedDiagnosis = computed<BlockedDiagnosis | null>(() => {
  if (!selectedWorkspace.value || selectedWorkspace.value.coordinationState !== 'blocked') {
    return null;
  }
  return diagnoseBlockedWorkspace({
    blockedReason: selectedWorkspace.value.workspaceMeta.blockedReason,
    progressHint: selectedWorkspace.value.progressHint,
    roleKey: selectedWorkspace.value.role.key,
    hasDependencies: selectedWorkspace.value.dependencyLabels.length > 0
  });
});
const blockedTemplateLabel = computed(() => summaryTemplateOptions.find((item) => item.value === blockedDiagnosis.value?.templateKey)?.label ?? '解除阻塞');
const blockedWorkspaceSuggestions = computed(() => {
  if (!selectedWorkspace.value || selectedWorkspace.value.coordinationState !== 'blocked') {
    return [] as string[];
  }

  const suggestions = [...(blockedDiagnosis.value?.playbook ?? [])];
  const blockedReason = selectedWorkspace.value.workspaceMeta.blockedReason?.trim();

  if (!blockedReason) {
    suggestions.unshift('先补充明确的阻塞原因，避免架构师无法判断是环境问题、依赖问题还是需求问题。');
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
const recommendedUnblockRoleKey = computed<WorkspaceRoleKey>(() => blockedDiagnosis.value?.targetRoleKey ?? 'developer');
const recommendedUnblockRole = computed(() => getWorkspaceRole(recommendedUnblockRoleKey.value));
const recommendedUnblockTargetWorkspace = computed(() =>
  dispatchableWorkspaces.value.find((item) => item.role.key === recommendedUnblockRoleKey.value) ?? null
);
const existingTargetWorkspace = computed(() => workspaceSummaries.value.find((item) => item.id === dispatchForm.targetSessionId) ?? null);
const assignedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'assigned'));
const runningWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'running'));
const blockedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'blocked'));
const completedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'completed'));
const closedWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.coordinationState === 'closed'));
const dispatchableWorkspaces = computed(() => workspaceSummaries.value.filter((item) => item.canDispatch));
const roleDefinition = computed(() => getWorkspaceRole(dispatchForm.roleKey));
const dispatchDependencyOptions = computed(() => workspaceSummaries.value.filter((item) => item.id !== (dispatchForm.mode === 'existing' ? dispatchForm.targetSessionId : '')));
const workspaceDependencyOptions = computed(() => workspaceSummaries.value.filter((item) => item.id !== selectedSessionId.value));
const summaryWorkspaces = computed(() => workspaceSummaries.value.filter((item) => summaryForm.selectedSessionIds.includes(item.id)));
const summaryTargetRole = computed(() => getWorkspaceRole(summaryForm.targetRoleKey));
const summaryTargetWorkspace = computed(() =>
  dispatchableWorkspaces.value.find((item) => item.role.key === summaryForm.targetRoleKey) ?? null
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
const summarySyncSourceWorkspace = computed(() => {
  const sourceSessionId = summarySyncNotice.value?.sourceSessionId;
  if (!sourceSessionId) {
    return null;
  }
  return workspaceSummaries.value.find((item) => item.id === sourceSessionId) ?? null;
});
const summarySyncSourceDiagnosis = computed(() => {
  if (!summarySyncSourceWorkspace.value) {
    return null;
  }
  return diagnoseBlockedWorkspace({
    blockedReason: summarySyncSourceWorkspace.value.workspaceMeta.blockedReason,
    progressHint: summarySyncSourceWorkspace.value.progressHint,
    roleKey: summarySyncSourceWorkspace.value.role.key,
    hasDependencies: summarySyncSourceWorkspace.value.dependencyLabels.length > 0
  });
});
const dispatchInstructionPlaceholder = computed(() => {
  if (!summarySyncSourceDiagnosis.value) {
    return '说明本次要完成什么、不要做什么、如何汇报。';
  }
  return [
    `当前来源是“${summarySyncSourceDiagnosis.value.label}”。建议在这里写明：`,
    ...summarySyncSourceDiagnosis.value.draftChecklist.map((item, index) => `${index + 1}. ${item}`)
  ].join('\n');
});
const dispatchInstructionHint = computed(() => {
  if (!summarySyncSourceDiagnosis.value) {
    return '统一调度里建议写清目标、边界、依赖和汇报要求。';
  }
  return `当前建议使用“${summarySyncSourceDiagnosis.value.templateKey}”对应模板，并优先派给 ${getWorkspaceRole(summarySyncSourceDiagnosis.value.targetRoleKey).label}。`;
});
const summaryDraftPlaceholder = computed(() => {
  if (!summarySyncSourceDiagnosis.value) {
    return '点击生成汇总，或手动编辑下一步调度草稿';
  }
  return [
    `当前建议按“${summarySyncSourceDiagnosis.value.label}”整理草稿：`,
    ...summarySyncSourceDiagnosis.value.draftChecklist.map((item, index) => `${index + 1}. ${item}`)
  ].join('\n');
});
const architectHeadline = computed(() => {
  if (!workspaceSummaries.value.length) {
    return {
      title: '先从统一调度开始创建第一个子窗口',
      description: '当前还没有任何协作子窗口。建议先创建 1 个执行窗口，再围绕结果继续派单和汇总。',
      tone: 'info' as const,
      actionLabel: '打开统一调度',
      targetTab: 'dispatch' as const
    };
  }
  if (blockedWorkspaces.value.length) {
    return {
      title: `优先处理 ${blockedWorkspaces.value.length} 个阻塞子窗口`,
      description: blockedWorkspaces.value
        .slice(0, 2)
        .map((item) => `${item.role.label}·${item.title}`)
        .join('；'),
      tone: 'danger' as const,
      actionLabel: '查看阻塞与调度',
      targetTab: 'summary' as const
    };
  }
  if (assignedWorkspaces.value.length) {
    return {
      title: `还有 ${assignedWorkspaces.value.length} 个待开始子窗口`,
      description: '建议先确认待开始窗口的任务说明和依赖是否齐全，再统一启动下一轮执行。',
      tone: 'warning' as const,
      actionLabel: '查看统一调度',
      targetTab: 'dispatch' as const
    };
  }
  if (runningWorkspaces.value.length) {
    return {
      title: `当前有 ${runningWorkspaces.value.length} 个子窗口执行中`,
      description: '建议优先查看当前聚焦子窗口的进展与阻塞，再决定是否继续派单或汇总。',
      tone: 'primary' as const,
      actionLabel: '查看操作流水',
      targetTab: 'logs' as const
    };
  }
  return {
    title: '当前没有显式阻塞，可准备下一轮调度',
    description: completedWorkspaces.value.length
      ? `已有 ${completedWorkspaces.value.length} 个子窗口完成，可优先整理汇总并发起下一轮任务。`
      : '当前可继续整理成果、关闭无效窗口或创建新的执行任务。',
    tone: 'success' as const,
    actionLabel: '查看汇总再调度',
    targetTab: 'summary' as const
  };
});
const workspaceListTitle = computed(() => activeLaneFilter.value === 'all' ? '全部子窗口' : `${activeLaneLabel.value}子窗口`);

function parseRouteLaneFilter(raw: unknown): WorkspaceLaneFilter {
  if (raw === 'all') {
    return 'all';
  }
  return coordinationOptions.some((item) => item.value === raw) ? raw as CoordinationState : 'all';
}

function parseRouteControlTab(raw: unknown) {
  return raw === 'dispatch' || raw === 'summary' || raw === 'logs'
    ? raw
    : 'dispatch';
}

function parseRouteDetailTab(raw: unknown) {
  return raw === 'messages' || raw === 'timeline' || raw === 'workspace'
    ? raw
    : 'messages';
}

function buildDashboardContextQuery(targetSessionId: string) {
  return {
    from: 'dashboard',
    dashboardSessionId: targetSessionId,
    dashboardLane: activeLaneFilter.value,
    dashboardControl: controlTab.value,
    dashboardDetail: detailTab.value
  };
}
const focusEmptyTips = computed(() => !workspaceSummaries.value.length
  ? [
    '先在右侧统一调度栏选择角色、实例和任务说明。',
    '点击“创建并派发”生成第一个子窗口。',
    '创建完成后，回到这里查看消息、时间线和协作状态。'
  ]
  : [
    '先在下方子窗口列表选择一个执行窗口。',
    '在这里查看结构化消息、时间线和协作状态。',
    '需要继续推进时，再到右侧统一调度栏发送下一轮任务。'
  ]);
const operatorGuide = computed(() => {
  if (!workspaceSummaries.value.length) {
    return {
      title: '第一次使用建议按这 3 步走',
      description: '先创建一个执行子窗口，再围绕它做观察、汇总和再派单，会比直接看整页更容易上手。',
      tone: 'info' as const,
      steps: [
        '右侧统一调度：先选角色、实例和任务说明。',
        '点击“创建并派发”，生成第一个子窗口。',
        '回到左侧聚焦区观察状态，再决定是否继续派单。'
      ],
      actionLabel: '去统一调度',
      action: 'dispatch' as GuideAction
    };
  }

  if (summarySyncNotice.value) {
    return {
      title: summarySyncNotice.value.title,
      description: summarySyncNotice.value.message,
      tone: summarySyncNotice.value.tone,
      steps: [
        '先确认来源窗口和依赖范围是否完整。',
        controlTab.value === 'summary' ? '确认草稿后点击“带入派单”。' : '确认角色、目标窗口和任务说明。',
        controlTab.value === 'dispatch' ? '发送后回到左侧观察状态变化。' : '带入统一调度后再执行发送。'
      ],
      actionLabel: controlTab.value === 'dispatch'
        ? (summarySyncSourceWorkspace.value ? '回到来源子窗口' : '检查统一调度')
        : '去统一调度',
      action: controlTab.value === 'dispatch'
        ? (summarySyncSourceWorkspace.value ? 'source' : 'dispatch')
        : 'dispatch' as GuideAction
    };
  }

  if (selectedWorkspace.value?.coordinationState === 'blocked') {
    return {
      title: '当前聚焦窗口已阻塞',
      description: `建议先处理 ${selectedWorkspace.value.role.label}·${selectedWorkspace.value.title} 的阻塞，再决定是否继续扩散任务。`,
      tone: 'warning' as const,
      steps: [
        '先在左侧“阻塞分析”生成解除阻塞草稿。',
        '再到“汇总再调度”确认来源范围、模板和目标角色。',
        `最后带入统一调度，优先派给 ${recommendedUnblockRole.value.label}。`
      ],
      actionLabel: '打开汇总再调度',
      action: 'summary' as GuideAction
    };
  }

  if (controlTab.value === 'logs') {
    return {
      title: '操作流水适合回放和恢复调度',
      description: '如果你忘了上一轮怎么调度，可以先定位目标子窗口，再回填派单恢复上下文。',
      tone: 'info' as const,
      steps: [
        '先筛选当前子窗口或指定动作。',
        '需要恢复调度时，点击“回填派单”。',
        '然后切回统一调度，确认后再发送。'
      ],
      actionLabel: '回到统一调度',
      action: 'dispatch' as GuideAction
    };
  }

  return {
    title: '当前总控台建议',
    description: selectedWorkspace.value
      ? `当前聚焦的是 ${selectedWorkspace.value.role.label}·${selectedWorkspace.value.title}，建议先看进度，再决定是否继续派单。`
      : '先从下方列表选一个子窗口，再结合右侧控制栏做下一步调度。',
    tone: 'info' as const,
    steps: selectedWorkspace.value
      ? [
        '先确认左侧当前摘要、依赖和最近活跃状态。',
        '如果需要形成结论，先到“汇总再调度”生成草稿。',
        '如果要继续推进，再切到“统一调度”发送。'
      ]
      : [
        '先在子窗口列表选择一个执行窗口。',
        '左侧查看消息和协作状态。',
        '右侧决定是继续派单、汇总还是回看日志。'
      ],
    actionLabel: selectedWorkspace.value ? '查看操作流水' : '去统一调度',
    action: (selectedWorkspace.value ? 'logs' : 'dispatch') as GuideAction
  };
});
const workflowSteps = computed(() => {
  const hasSource = Boolean(summarySyncSourceWorkspace.value) || summaryForm.selectedSessionIds.length > 0;
  const hasDraft = Boolean(summaryForm.draft.trim());
  const hasDispatch = Boolean(dispatchForm.instruction.trim());
  const shouldShow = Boolean(summarySyncNotice.value || hasSource || hasDraft || hasDispatch);

  if (!shouldShow) {
    return [] as Array<{ key: string; label: string; status: 'todo' | 'active' | 'done' }>;
  }

  return [
    {
      key: 'source',
      label: '来源窗口',
      status: hasSource ? 'done' : 'todo'
    },
    {
      key: 'summary',
      label: '汇总草稿',
      status: hasDraft ? (controlTab.value === 'summary' ? 'active' : 'done') : 'todo'
    },
    {
      key: 'dispatch',
      label: '统一调度',
      status: hasDispatch ? (controlTab.value === 'dispatch' ? 'active' : 'done') : ((hasDraft || Boolean(summarySyncNotice.value)) && controlTab.value === 'dispatch' ? 'active' : 'todo')
    }
  ];
});

function syncDispatchDefaults() {
  const currentEnabled = enabledInstances.value.some((item) => item.id === dispatchForm.instanceId);
  if ((!dispatchForm.instanceId || !currentEnabled) && enabledInstances.value.length > 0) {
    dispatchForm.instanceId = pickPreferredInstanceId(enabledInstances.value);
  }
  if (!dispatchForm.projectPath) dispatchForm.projectPath = configStore.defaultProjectPath || 'D:\\Project\\ali\\260409';
  const canKeepCurrentTarget = dispatchableWorkspaces.value.some((item) => item.id === dispatchForm.targetSessionId);
  if (!canKeepCurrentTarget) {
    dispatchForm.targetSessionId = dispatchableWorkspaces.value[0]?.id || '';
  }
}

function handleDispatchInstanceChange(value: string) {
  rememberPreferredInstance(value);
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
  summarySyncNotice.value = {
    title: '已从操作流水回填到统一调度',
    tone: 'info',
    message: `已根据 ${log.action} 恢复调度输入。建议先确认目标窗口、角色和依赖，再发送下一轮任务。`,
    sourceSessionId: log.targetId || null
  };
  const targetWorkspace = log.targetId
    ? workspaceSummaries.value.find((item) => item.id === log.targetId) ?? null
    : null;
  if (targetWorkspace && activeLaneFilter.value !== 'all' && activeLaneFilter.value !== targetWorkspace.coordinationState) {
    activeLaneFilter.value = targetWorkspace.coordinationState;
  }
  syncDispatchDefaults();
  openControlTab('dispatch');
  void triggerWorkspaceSpotlight(log.targetId || dispatchForm.targetSessionId);
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
  const diagnosis = blockedDiagnosis.value;
  const blockedReason = workspace.workspaceMeta.blockedReason?.trim() || workspace.progressHint || '尚未填写阻塞原因';
  const dependencyText = workspace.dependencyLabels.length ? workspace.dependencyLabels.join('、') : '无显式上游依赖';
  const dependentText = selectedWorkspaceDependents.value.length
    ? selectedWorkspaceDependents.value.map((item) => `${item.role.label}·${item.title}`).join('、')
    : '暂未影响其他子窗口';

  return [
    '【阻塞协调任务】',
    diagnosis ? `阻塞类型：${diagnosis.label}` : '',
    `阻塞子窗口：${workspace.role.label}｜${workspace.title}`,
    `当前状态：${workspace.coordinationLabel}`,
    `阻塞原因：${blockedReason}`,
    `上游依赖：${dependencyText}`,
    `影响范围：${dependentText}`,
    '',
    diagnosis ? '【分类判断】' : '',
    diagnosis?.description || '',
    diagnosis ? '' : '',
    '【本轮目标】',
    diagnosis?.draftGoal || `请以${recommendedUnblockRole.value.label}角色优先判断阻塞根因，给出解除方案，并明确哪些动作可以立即执行。`,
    '',
    '【输出要求】',
    ...(diagnosis?.draftChecklist?.length
      ? diagnosis.draftChecklist.map((item, index) => `${index + 1}. ${item}`)
      : [
          '1. 先判断阻塞属于需求确认、依赖等待、实现问题还是验证问题',
          '2. 给出解除阻塞的最短路径，说明是否需要补充信息、转派角色或调整优先级',
          '3. 如果会影响其他子窗口，明确同步对象和同步顺序',
          '4. 最后给出架构师可以立即执行的下一步动作'
        ])
  ].filter(Boolean).join('\n');
}

function prepareBlockedUnblockFlow(applyToDispatch = false) {
  if (!selectedWorkspace.value || selectedWorkspace.value.coordinationState !== 'blocked') {
    ElMessage.warning('当前没有可处理的阻塞子窗口');
    return;
  }

  const sourceIds = buildBlockedSourceIds(selectedWorkspace.value);
  summaryForm.templateKey = blockedDiagnosis.value?.templateKey ?? 'unblock';
  summaryForm.targetRoleKey = recommendedUnblockRoleKey.value;
  summaryForm.selectedSessionIds = sourceIds;
  summaryForm.draft = buildBlockedDispatchDraft(selectedWorkspace.value);
  summarySyncNotice.value = {
    title: '已从阻塞分析同步',
    tone: 'warning',
    message: `来源子窗口：${selectedWorkspace.value.role.label}·${selectedWorkspace.value.title}；阻塞类型：${blockedDiagnosis.value?.label || '待判断'}；建议转派：${recommendedUnblockRole.value.label}；已自动选中 ${sourceIds.length} 个相关子窗口作为汇总来源。`,
    sourceSessionId: selectedWorkspace.value.id
  };

  void recordArchitectAction('summary.generated', 'success', {
    origin: 'blocked-analysis',
    template: blockedDiagnosis.value?.templateKey ?? 'unblock',
    targetRole: recommendedUnblockRoleKey.value,
    blockedCategory: blockedDiagnosis.value?.key ?? 'unknown',
    sourceIds,
    blockedSessionId: selectedWorkspace.value.id
  }, selectedWorkspace.value.id);

  if (applyToDispatch) {
    applySummaryToDispatch(false);
    openControlTab('dispatch');
    ElMessage.success(`已把阻塞协调草稿带入统一调度，建议派给${recommendedUnblockRole.value.label}`);
    return;
  }

  openControlTab('summary');
  ElMessage.success(`已生成解除阻塞草稿，建议派给${recommendedUnblockRole.value.label}`);
}

function setLaneFilter(filter: WorkspaceLaneFilter) {
  activeLaneFilter.value = filter;
}

function openControlTab(tab: 'dispatch' | 'summary' | 'logs') {
  controlTab.value = tab;
}

async function focusWorkspace(sessionId: string, filter?: WorkspaceLaneFilter) {
  if (filter) {
    activeLaneFilter.value = filter;
  }
  await selectWorkspace(sessionId);
  await triggerWorkspaceSpotlight(sessionId);
}

function focusWorkspaceRelation(sessionId: string) {
  const targetWorkspace = workspaceSummaries.value.find((item) => item.id === sessionId);
  if (!targetWorkspace) {
    ElMessage.warning('当前总控台未找到这个相关子窗口');
    return;
  }
  void focusWorkspace(targetWorkspace.id, targetWorkspace.coordinationState);
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
  void focusWorkspace(workspace.id, workspace.coordinationState);
  ElMessage.success(`已定位到 ${workspace.role.label} 子窗口`);
}

function isRelatedLog(log: OperationLogRecord) {
  return Boolean(selectedWorkspace.value && log.targetId === selectedWorkspace.value.id);
}

function clearSummarySyncNotice() {
  summarySyncNotice.value = null;
}

function handleGuideAction(action: GuideAction) {
  if (action === 'source') {
    focusSummarySyncSource();
    return;
  }
  openControlTab(action);
}

function focusSummarySyncSource() {
  if (!summarySyncSourceWorkspace.value) {
    ElMessage.warning('当前找不到这条草稿的来源子窗口');
    return;
  }
  void focusWorkspace(summarySyncSourceWorkspace.value.id, summarySyncSourceWorkspace.value.coordinationState);
  ElMessage.success(`已返回来源子窗口：${summarySyncSourceWorkspace.value.role.label}`);
}

function setWorkspaceCardRef(sessionId: string, element: unknown) {
  if (element instanceof HTMLElement) {
    workspaceCardRefs.set(sessionId, element);
    return;
  }
  workspaceCardRefs.delete(sessionId);
}

async function triggerWorkspaceSpotlight(sessionId?: string | null) {
  if (!sessionId) {
    return;
  }
  spotlightWorkspaceId.value = sessionId;
  await nextTick();
  const element = workspaceCardRefs.get(sessionId);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (workspaceSpotlightTimer) {
    window.clearTimeout(workspaceSpotlightTimer);
  }
  workspaceSpotlightTimer = window.setTimeout(() => {
    if (spotlightWorkspaceId.value === sessionId) {
      spotlightWorkspaceId.value = '';
    }
  }, 2200);
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
  const sources = summaryWorkspaces.value.length ? summaryWorkspaces.value : [...completedWorkspaces.value, ...blockedWorkspaces.value, ...runningWorkspaces.value].slice(0, 8);
  if (!sources.length) {
    clearSummarySyncNotice();
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
  summarySyncNotice.value = {
    title: '已生成汇总草稿',
    tone: blockedWorkspaces.value.length ? 'warning' : 'success',
    message: `已汇总 ${sources.length} 个来源子窗口。建议先检查草稿，再带入统一调度发起下一轮任务。`,
    sourceSessionId: sources[0]?.id ?? null
  };
  openControlTab('summary');
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
  summarySyncNotice.value = {
    title: '已将汇总草稿带入统一调度',
    tone: 'success',
    message: `来源窗口共 ${summaryForm.selectedSessionIds.length} 个。请确认目标角色为 ${summaryTargetRole.value.label}，然后发送下一轮任务。`,
    sourceSessionId: summaryForm.selectedSessionIds[0] ?? null
  };
  syncDispatchDefaults();
  openControlTab('dispatch');
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

async function restoreDashboardContextFromRoute() {
  const nextLaneFilter = typeof route.query.dashboardLane === 'string'
    ? parseRouteLaneFilter(route.query.dashboardLane)
    : activeLaneFilter.value;
  const nextControlTab = typeof route.query.dashboardControl === 'string'
    ? parseRouteControlTab(route.query.dashboardControl)
    : controlTab.value;
  const nextDetailTab = typeof route.query.dashboardDetail === 'string'
    ? parseRouteDetailTab(route.query.dashboardDetail)
    : detailTab.value;
  const routeSessionId = typeof route.query.dashboardSessionId === 'string'
    ? route.query.dashboardSessionId
    : '';

  activeLaneFilter.value = nextLaneFilter;
  controlTab.value = nextControlTab;

  if (!workspaceSummaries.value.length) {
    detailTab.value = nextDetailTab;
    return;
  }

  if (routeSessionId) {
    const targetWorkspace = workspaceSummaries.value.find((item) => item.id === routeSessionId) ?? null;
    if (targetWorkspace) {
      const inFilteredList = filteredWorkspaceSummaries.value.some((item) => item.id === routeSessionId);
      if (activeLaneFilter.value !== 'all' && !inFilteredList) {
        activeLaneFilter.value = 'all';
      }
      await selectWorkspace(routeSessionId);
      detailTab.value = nextDetailTab;
      await triggerWorkspaceSpotlight(routeSessionId);
      return;
    }
  }

  await ensureSelection();
  detailTab.value = nextDetailTab;
}

async function refreshDashboard() {
  await Promise.all([runtimeStore.refreshAll(), instanceStore.load(), sessionStore.loadList(), configStore.load(), loadOperationLogs()]);
  syncDispatchDefaults();
  await restoreDashboardContextFromRoute();
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
      rememberPreferredInstance(dispatchForm.instanceId);
      const session = await sessionStore.create({
        appInstanceId: dispatchForm.instanceId,
        title: buildWorkspaceTitle(),
        projectPath: dispatchForm.projectPath,
        interactionMode: 'RAW',
        initInput: dispatchPreview.value,
        tags: buildWorkspaceTags(dispatchForm.roleKey, dispatchForm.dependencyIds, 'running'),
        workspaceMeta: { workspaceKind: 'child', role: dispatchForm.roleKey, coordinationStatus: 'running', progressSummary: dispatchForm.title.trim() || '架构师已派发新任务', dependencySessionIds: dispatchForm.dependencyIds, sharedContextSummary: collaborationSnapshot.value || null }
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

function openSessionDetail(sessionId: string) {
  router.push({
    name: 'session-detail',
    params: { id: sessionId },
    query: buildDashboardContextQuery(sessionId)
  });
}
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
onBeforeUnmount(() => {
  if (workspaceSpotlightTimer) {
    window.clearTimeout(workspaceSpotlightTimer);
  }
  sessionStore.disconnectSocket();
});
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

    <div class="architect-shell">
      <div class="architect-main">
        <section class="architect-banner" :class="`is-${architectHeadline.tone}`">
          <div class="architect-banner__content">
            <div class="architect-banner__eyebrow">当前重点</div>
            <h3>{{ architectHeadline.title }}</h3>
            <p>{{ architectHeadline.description }}</p>
          </div>
          <div class="architect-banner__actions">
            <el-tag :type="architectHeadline.tone" effect="dark">{{ activeLaneLabel }}</el-tag>
            <el-button type="primary" @click="openControlTab(architectHeadline.targetTab)">
              {{ architectHeadline.actionLabel }}
            </el-button>
          </div>
          <div class="lane-strip">
            <button
              v-for="lane in laneCards"
              :key="lane.label"
              type="button"
              class="lane-pill"
              :class="[`is-${lane.className}`, { 'is-active': activeLaneFilter === lane.filterValue }]"
              @click="setLaneFilter(lane.filterValue)"
            >
              <span class="lane-pill__label">{{ lane.label }}</span>
              <strong class="lane-pill__value">{{ lane.value }}</strong>
            </button>
          </div>
        </section>

        <el-card class="page-card focus-card">
          <template #header>
            <div class="card-head">
              <div>
                <div class="section-title">当前聚焦子窗口</div>
                <div class="section-caption">在一个区域里完成查看进度、判断阻塞、编辑协作状态。</div>
              </div>
              <div class="card-tools">
                <el-tag type="info">{{ sessionStore.socketConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}</el-tag>
                <el-button v-if="selectedWorkspace" @click="openSessionDetail(selectedWorkspace.id)">打开完整详情</el-button>
              </div>
            </div>
          </template>
        <div v-if="!selectedWorkspace" class="focus-empty">
          <el-empty :description="workspaceSummaries.length ? '请选择一个子窗口' : '当前还没有可聚焦的子窗口'" />
          <div class="focus-empty-guide">
            <div class="section-title">建议按这个顺序操作</div>
            <div v-for="(tip, index) in focusEmptyTips" :key="`focus-empty-${index}`" class="guide-step-item">
              <span class="guide-step-index">{{ index + 1 }}</span>
              <span>{{ tip }}</span>
            </div>
            <div class="align-right">
              <el-button type="primary" @click="openControlTab('dispatch')">打开统一调度</el-button>
            </div>
          </div>
        </div>
        <template v-else>
          <div class="focus-head">
            <div>
              <div class="focus-title">{{ selectedWorkspace.role.emoji }} {{ selectedWorkspace.title }}</div>
              <div class="focus-subtitle">{{ selectedWorkspace.instanceName }} · {{ selectedWorkspace.projectPath }}</div>
            </div>
            <div class="page-toolbar page-toolbar--compact"><el-tag :type="selectedWorkspace.coordinationTone">{{ selectedWorkspace.coordinationLabel }}</el-tag><el-tag type="info">{{ selectedWorkspace.role.label }}</el-tag></div>
          </div>
          <div class="detail-meta">
            <div class="meta-card"><div class="meta-label">进程状态</div><div class="meta-value"><StatusTag :status="selectedWorkspace.session.status" /></div></div>
            <div class="meta-card"><div class="meta-label">最近活跃</div><div class="meta-value">{{ selectedWorkspace.lastActiveText }}</div></div>
            <div class="meta-card"><div class="meta-label">依赖数量</div><div class="meta-value">{{ selectedWorkspace.dependencyLabels.length }}</div></div>
            <div class="meta-card"><div class="meta-label">当前摘要</div><div class="meta-value meta-value--wrap">{{ selectedWorkspace.progressHint }}</div></div>
          </div>
          <div class="workspace-relation-panel" :class="`is-${selectedWorkspaceRelationSummary?.tone || 'info'}`">
            <div class="workspace-relation-panel__title">{{ selectedWorkspaceRelationSummary?.title }}</div>
            <div class="workspace-relation-panel__desc">{{ selectedWorkspaceRelationSummary?.description }}</div>
            <div class="workspace-relation-grid">
              <div class="workspace-relation-card">
                <div class="meta-label">上游依赖</div>
                <div class="workspace-relation-chip-list">
                  <span v-if="!selectedWorkspaceDependencySummaries.length && !selectedWorkspaceMissingDependencyIds.length" class="workspace-relation-empty">无显式上游依赖</span>
                  <button
                    v-for="item in selectedWorkspaceDependencySummaries"
                    :key="`dependency-${item.id}`"
                    type="button"
                    class="workspace-relation-chip is-action"
                    @click="focusWorkspaceRelation(item.id)"
                  >
                    {{ item.role.label }}·{{ item.title }}
                    <small>{{ item.coordinationLabel }}</small>
                  </button>
                  <span v-for="dependencyId in selectedWorkspaceMissingDependencyIds" :key="`dependency-missing-${dependencyId}`" class="workspace-relation-chip is-muted">
                    会话 {{ dependencyId.slice(0, 8) }}
                    <small>未在当前列表中找到</small>
                  </span>
                </div>
              </div>
              <div class="workspace-relation-card">
                <div class="meta-label">下游影响</div>
                <div class="workspace-relation-chip-list">
                  <span v-if="!selectedWorkspaceDependents.length" class="workspace-relation-empty">暂未影响其他子窗口</span>
                  <button
                    v-for="item in selectedWorkspaceDependents"
                    :key="`dependent-${item.id}`"
                    type="button"
                    class="workspace-relation-chip is-action"
                    @click="focusWorkspaceRelation(item.id)"
                  >
                    {{ item.role.label }}·{{ item.title }}
                    <small>{{ item.coordinationLabel }}</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="selectedWorkspace.coordinationState === 'blocked'" class="blocked-analysis">
            <div class="card-head">
              <strong>阻塞分析</strong>
              <div class="blocked-header-tags">
                <el-tag type="danger">优先处理</el-tag>
                <el-tag type="warning">建议转派：{{ recommendedUnblockRole.label }}</el-tag>
              </div>
            </div>
            <div v-if="blockedDiagnosis" class="blocked-diagnosis-strip">
              <div class="blocked-diagnosis-card">
                <div class="meta-label">阻塞分类</div>
                <div class="blocked-diagnosis-title">{{ blockedDiagnosis.label }}</div>
                <div class="blocked-diagnosis-text">{{ blockedDiagnosis.description }}</div>
              </div>
              <div class="blocked-diagnosis-card">
                <div class="meta-label">推荐处理模板</div>
                <div class="blocked-diagnosis-title">{{ blockedTemplateLabel }}</div>
                <div class="blocked-diagnosis-text">建议优先派给 {{ recommendedUnblockRole.label }}，先按模板收敛再决定后续扩派。</div>
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
              <el-button @click="prepareBlockedUnblockFlow()">生成推荐草稿</el-button>
              <el-button type="primary" @click="prepareBlockedUnblockFlow(true)">按推荐模板带入调度</el-button>
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
          <el-tabs v-model="detailTab" class="focus-tabs">
            <el-tab-pane label="结构化消息" name="messages">
              <SessionMessageList :messages="sessionStore.messages" :highlight-message-id="sessionStore.highlightedMessageId" />
            </el-tab-pane>
            <el-tab-pane label="会话时间线" name="timeline">
              <SessionTimelineList :items="sessionStore.timelineItems" :highlight-message-id="sessionStore.highlightedMessageId" @jump-to-message="() => { detailTab = 'messages'; }" />
            </el-tab-pane>
            <el-tab-pane label="协作状态" name="workspace">
              <div class="workspace-editor">
                <div class="workspace-editor__intro">
                  <div class="section-title">协作状态编辑</div>
                  <div class="section-caption">这里维护其他 Agent 能看到的共享状态；消息正文仍在“结构化消息”里查看。</div>
                </div>
                <div class="quick-actions quick-actions--compact">
                  <el-button size="small" @click="saveWorkspaceMeta('running')">标记执行中</el-button>
                  <el-button size="small" type="warning" @click="saveWorkspaceMeta('blocked')">标记阻塞</el-button>
                  <el-button size="small" type="success" @click="saveWorkspaceMeta('completed')">标记完成</el-button>
                  <el-button size="small" type="info" @click="saveWorkspaceMeta('closed')">标记关闭</el-button>
                </div>
                <el-form class="workspace-form-shell" label-width="84px">
                  <div class="workspace-editor-grid">
                    <el-form-item label="角色"><el-select v-model="workspaceForm.roleKey" style="width:100%"><el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" /></el-select></el-form-item>
                    <el-form-item label="状态"><el-select v-model="workspaceForm.coordinationStatus" style="width:100%"><el-option v-for="option in coordinationOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item>
                  </div>
                  <el-form-item label="进度摘要"><el-input v-model="workspaceForm.progressSummary" type="textarea" :rows="3" /></el-form-item>
                  <el-form-item label="阻塞原因"><el-input v-model="workspaceForm.blockedReason" type="textarea" :rows="3" :disabled="workspaceForm.coordinationStatus !== 'blocked'" /></el-form-item>
                  <el-form-item label="依赖窗口"><el-select v-model="workspaceForm.dependencySessionIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip><el-option v-for="workspace in workspaceDependencyOptions" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
                  <el-form-item label="共享上下文"><el-input v-model="workspaceForm.sharedContextSummary" type="textarea" :rows="4" /></el-form-item>
                  <div class="align-right"><el-button :loading="saving" type="primary" @click="saveWorkspaceMeta()">保存协作状态</el-button></div>
                </el-form>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </el-card>

      <el-card class="page-card workspace-list-card">
        <template #header>
          <div class="card-head">
            <div>
              <div class="section-title">{{ workspaceListTitle }}</div>
              <div class="section-caption">用于切换当前聚焦窗口，所有派单与汇总都围绕这里的执行窗口展开。</div>
            </div>
            <div class="card-tools">
              <el-tag type="info">{{ filteredWorkspaceSummaries.length }} / {{ workspaceSummaries.length }} 个子窗口</el-tag>
              <el-tag :type="activeLaneFilter === 'all' ? 'info' : 'primary'">筛选：{{ activeLaneLabel }}</el-tag>
              <el-button v-if="activeLaneFilter !== 'all'" link type="primary" @click="setLaneFilter('all')">查看全部</el-button>
            </div>
          </div>
        </template>
        <el-empty v-if="filteredWorkspaceSummaries.length === 0" :description="activeLaneFilter === 'all' ? '先创建第一个子窗口' : `当前没有${activeLaneLabel}子窗口`" />
        <div v-else class="workspace-grid">
          <div
            v-for="workspace in filteredWorkspaceSummaries"
            :key="workspace.id"
            :ref="(element) => setWorkspaceCardRef(workspace.id, element)"
            class="workspace-card-shell"
            :class="{ 'is-spotlight': spotlightWorkspaceId === workspace.id }"
          >
            <AgentWorkspaceCard :summary="workspace" :selected="workspace.id === selectedSessionId" @select="focusWorkspace(workspace.id)" @open-detail="openSessionDetail(workspace.id)" @stop="handleStopWorkspace(workspace.id)" />
          </div>
        </div>
      </el-card>
      </div>

      <div class="architect-sidebar">
        <el-card class="page-card sidebar-card">
          <template #header>
            <div class="card-head">
              <div>
                <div class="section-title">统一调度栏</div>
                <div class="section-caption">把派单、汇总、日志放到同一控制栏，减少总控台同级卡片干扰。</div>
              </div>
              <el-tag type="info">{{ controlTab === 'dispatch' ? '调度中枢' : controlTab === 'summary' ? '汇总中枢' : '日志回放' }}</el-tag>
            </div>
          </template>

          <div class="sidebar-guide" :class="`is-${operatorGuide.tone}`">
            <div class="card-head card-head--start">
              <div>
                <div class="sidebar-guide__title">{{ operatorGuide.title }}</div>
                <div class="sidebar-guide__desc">{{ operatorGuide.description }}</div>
              </div>
              <el-button size="small" type="primary" plain @click="handleGuideAction(operatorGuide.action)">
                {{ operatorGuide.actionLabel }}
              </el-button>
            </div>
            <div class="guide-step-list">
              <div v-for="(step, index) in operatorGuide.steps" :key="`guide-${index}`" class="guide-step-item">
                <span class="guide-step-index">{{ index + 1 }}</span>
                <span>{{ step }}</span>
              </div>
            </div>
          </div>

          <div v-if="workflowSteps.length" class="workflow-bridge">
            <div
              v-for="step in workflowSteps"
              :key="step.key"
              class="workflow-step"
              :class="`is-${step.status}`"
            >
              <span class="workflow-step__dot" />
              <span class="workflow-step__label">{{ step.label }}</span>
            </div>
          </div>

          <el-tabs v-model="controlTab" class="control-tabs" stretch>
            <el-tab-pane label="统一调度" name="dispatch">
              <div class="control-tab-body">
                <div v-if="summarySyncNotice" class="summary-origin-bar">
                  <div>
                    <div class="summary-origin-title">{{ summarySyncNotice.title }}</div>
                    <div class="summary-origin-text">{{ summarySyncNotice.message }}</div>
                  </div>
                  <div class="summary-origin-actions">
                    <el-button v-if="summarySyncSourceWorkspace" size="small" @click="focusSummarySyncSource">回到来源子窗口</el-button>
                    <el-button size="small" link @click="clearSummarySyncNotice">清除提示</el-button>
                  </div>
                </div>
                <el-form label-width="84px">
                  <el-form-item label="调度方式"><el-radio-group v-model="dispatchForm.mode"><el-radio-button label="new" value="new">新建</el-radio-button><el-radio-button label="existing" value="existing">派单</el-radio-button></el-radio-group></el-form-item>
                  <el-form-item label="角色"><el-select v-model="dispatchForm.roleKey" style="width:100%"><el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" /></el-select></el-form-item>
                  <el-form-item v-if="dispatchForm.mode === 'new'" label="实例"><el-select v-model="dispatchForm.instanceId" style="width:100%" @change="handleDispatchInstanceChange"><el-option v-for="instance in enabledInstances" :key="instance.id" :label="`${instance.name} (${instance.appType || '未标注类型'})`" :value="instance.id" /></el-select></el-form-item>
                  <el-form-item v-else label="目标窗口"><el-select v-model="dispatchForm.targetSessionId" style="width:100%" placeholder="当前没有可继续派单的子窗口"><el-option v-for="workspace in dispatchableWorkspaces" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
                  <el-form-item label="任务标题"><el-input v-model="dispatchForm.title" clearable /></el-form-item>
                  <el-form-item label="项目目录"><el-input v-model="dispatchForm.projectPath" clearable /></el-form-item>
                  <el-form-item label="依赖窗口"><el-select v-model="dispatchForm.dependencyIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip><el-option v-for="workspace in dispatchDependencyOptions" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title}`" :value="workspace.id" /></el-select></el-form-item>
                  <el-form-item label="任务说明"><el-input v-model="dispatchForm.instruction" type="textarea" :rows="7" :placeholder="dispatchInstructionPlaceholder" /></el-form-item>
                  <div class="form-help-text">{{ dispatchInstructionHint }}</div>
                  <el-form-item label="共享上下文"><div class="switch-row"><el-switch v-model="dispatchForm.includeSharedContext" /><span>自动注入其他子窗口关键进展</span></div></el-form-item>
                  <div class="align-right"><el-button :loading="dispatching" type="primary" @click="handleDispatch">{{ dispatchForm.mode === 'new' ? '创建并派发' : '发送调度' }}</el-button></div>
                </el-form>
                <div class="context-preview-card">
                  <div class="card-head card-head--start"><strong>共享上下文预览</strong><span class="meta-label">发送前可确认最终文案</span></div>
                  <pre class="context-preview">{{ dispatchPreview }}</pre>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="汇总再调度" name="summary">
              <div class="control-tab-body">
                <el-form label-width="84px">
                  <div v-if="summarySyncSourceWorkspace" class="summary-origin-inline">
                    <span class="meta-label">草稿来源：{{ summarySyncSourceWorkspace.role.label }} · {{ summarySyncSourceWorkspace.title }}</span>
                    <el-button size="small" link type="primary" @click="focusSummarySyncSource">跳回来源子窗口</el-button>
                  </div>
                  <el-form-item label="来源窗口"><el-select v-model="summaryForm.selectedSessionIds" style="width:100%" multiple collapse-tags collapse-tags-tooltip placeholder="选择要纳入汇总的子窗口"><el-option v-for="workspace in workspaceSummaries" :key="workspace.id" :label="`${workspace.role.label} · ${workspace.title} · ${workspace.coordinationLabel}`" :value="workspace.id" /></el-select></el-form-item>
                  <el-form-item label="汇总模板"><el-select v-model="summaryForm.templateKey" style="width:100%"><el-option v-for="option in summaryTemplateOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item>
                  <el-form-item label="目标角色"><el-select v-model="summaryForm.targetRoleKey" style="width:100%"><el-option v-for="role in WORKSPACE_ROLES" :key="role.key" :label="`${role.emoji} ${role.label}`" :value="role.key" /></el-select></el-form-item>
                  <div class="board-item board-item--assigned">
                    {{ summaryTargetWorkspace ? `将优先派给现有子窗口：${summaryTargetWorkspace.role.label} · ${summaryTargetWorkspace.title}` : `当前没有可复用的 ${summaryTargetRole.label} 子窗口，将创建新的下一轮子窗口` }}
                  </div>
                  <el-form-item label="汇总草稿"><el-input v-model="summaryForm.draft" type="textarea" :rows="10" :placeholder="summaryDraftPlaceholder" /></el-form-item>
                  <div class="quick-actions">
                    <el-button @click="buildArchitectSummaryDraft">生成汇总</el-button>
                    <el-button @click="applySummaryToDispatch">带入派单</el-button>
                    <el-button type="primary" :loading="dispatching" @click="dispatchSummaryNow">一键再派单</el-button>
                  </div>
                </el-form>
              </div>
            </el-tab-pane>
            <el-tab-pane label="操作流水" name="logs">
              <div class="control-tab-body">
                <div class="log-filter-toolbar">
                  <div class="quick-actions quick-actions--compact">
                    <el-switch v-model="currentWorkspaceLogOnly" :disabled="!selectedWorkspace" inline-prompt active-text="当前" inactive-text="全部" />
                    <span class="meta-label">{{ displayedOperationLogLabel }}</span>
                  </div>
                  <el-radio-group v-if="currentWorkspaceLogOnly && selectedWorkspace" v-model="currentWorkspaceLogCategory" size="small">
                    <el-radio-button v-for="option in workspaceLogCategoryOptions" :key="option.value" :label="option.value">{{ option.label }}</el-radio-button>
                  </el-radio-group>
                  <span v-if="currentWorkspaceLogOnly && selectedWorkspace" class="meta-label">分类：{{ currentWorkspaceLogCategoryLabel }}</span>
                  <el-select v-model="logFilter.action" size="small" style="width: 180px" @change="loadOperationLogs">
                    <el-option v-for="option in operationLogActionOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                  <el-button size="small" :loading="logLoading" @click="loadOperationLogs">刷新日志</el-button>
                </div>
                <el-empty v-if="displayedOperationLogs.length === 0" :description="currentWorkspaceLogOnly && selectedWorkspace ? '当前子窗口暂无匹配日志' : '暂无调度日志'" />
                <div v-else class="log-list-shell">
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
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header--architect { align-items: flex-start; }
.page-description { margin: 8px 0 0; color: #64748b; }
.architect-shell { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 16px; margin-top: 16px; align-items: start; }
.architect-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.architect-sidebar { min-width: 0; }
.architect-banner { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 20px; border-radius: 20px; background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff; box-shadow: 0 16px 36px rgba(15, 23, 42, .16); }
.architect-banner.is-danger { background: linear-gradient(135deg, #7f1d1d, #b91c1c); }
.architect-banner.is-warning { background: linear-gradient(135deg, #92400e, #d97706); }
.architect-banner.is-success { background: linear-gradient(135deg, #065f46, #059669); }
.architect-banner.is-primary { background: linear-gradient(135deg, #1d4ed8, #2563eb); }
.architect-banner__content h3 { margin: 6px 0 0; font-size: 24px; line-height: 1.35; }
.architect-banner__content p { margin: 10px 0 0; max-width: 760px; color: rgba(255, 255, 255, .86); line-height: 1.75; }
.architect-banner__eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .78; }
.architect-banner__actions { display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-end; gap: 10px; }
.lane-strip { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-top: 4px; }
.lane-pill { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 14px; background: rgba(255, 255, 255, .10); color: inherit; cursor: pointer; transition: transform .16s ease, background .16s ease, border-color .16s ease; }
.lane-pill:hover { transform: translateY(-1px); background: rgba(255, 255, 255, .16); }
.lane-pill.is-active { border-color: rgba(255, 255, 255, .72); background: rgba(255, 255, 255, .20); }
.lane-pill__label { font-size: 13px; opacity: .88; }
.lane-pill__value { font-size: 18px; }
.focus-card, .workspace-list-card, .sidebar-card { border-radius: 18px; }
.sidebar-card { position: sticky; top: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-head--start { align-items: flex-start; }
.card-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.section-title { font-size: 16px; font-weight: 700; color: #0f172a; }
.section-caption { margin-top: 6px; font-size: 13px; line-height: 1.65; color: #64748b; }
.switch-row, .align-right, .quick-actions, .focus-head { display: flex; gap: 12px; }
.switch-row { align-items: center; color: #475569; }
.align-right { justify-content: flex-end; }
.quick-actions { flex-wrap: wrap; margin-bottom: 12px; }
.quick-actions--compact { margin-bottom: 0; }
.form-help-text { margin: -4px 0 4px; color: #64748b; font-size: 12px; line-height: 1.7; }
.focus-empty { display: flex; flex-direction: column; gap: 12px; }
.focus-empty-guide { padding: 16px; border-radius: 16px; background: rgba(37, 99, 235, .06); }
.sidebar-guide { margin-bottom: 14px; padding: 16px; border-radius: 16px; border: 1px solid rgba(148, 163, 184, .18); background: rgba(15, 23, 42, .04); }
.sidebar-guide.is-warning { background: rgba(245, 158, 11, .10); border-color: rgba(245, 158, 11, .22); }
.sidebar-guide.is-success { background: rgba(5, 150, 105, .08); border-color: rgba(5, 150, 105, .18); }
.sidebar-guide__title { font-size: 15px; font-weight: 700; color: #0f172a; }
.sidebar-guide__desc { margin-top: 6px; color: #475569; font-size: 13px; line-height: 1.7; }
.guide-step-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.guide-step-item { display: flex; align-items: flex-start; gap: 10px; color: #334155; font-size: 13px; line-height: 1.7; }
.guide-step-index { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border-radius: 999px; background: rgba(37, 99, 235, .14); color: #1d4ed8; font-size: 12px; font-weight: 700; }
.workflow-bridge { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.workflow-step { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(148, 163, 184, .12); color: #64748b; font-size: 12px; }
.workflow-step.is-active { background: rgba(37, 99, 235, .12); color: #1d4ed8; }
.workflow-step.is-done { background: rgba(5, 150, 105, .12); color: #047857; }
.workflow-step__dot { width: 8px; height: 8px; border-radius: 999px; background: currentColor; opacity: .85; }
.workflow-step__label { font-weight: 600; }
.summary-origin-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(245, 158, 11, .12); border: 1px solid rgba(245, 158, 11, .18); }
.summary-origin-title { font-weight: 700; color: #92400e; }
.summary-origin-text { margin-top: 6px; color: #78350f; font-size: 13px; line-height: 1.7; }
.summary-origin-actions, .summary-origin-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.summary-origin-inline { margin-bottom: 12px; }
.workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.workspace-card-shell { border-radius: 20px; transition: box-shadow .18s ease, transform .18s ease; }
.workspace-card-shell.is-spotlight { animation: workspace-spotlight 2.2s ease; box-shadow: 0 0 0 3px rgba(37, 99, 235, .18), 0 18px 32px rgba(37, 99, 235, .14); }
.board-item { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(37, 99, 235, .08); }
.board-item--assigned { background: rgba(245, 158, 11, .12); }
.board-item--blocked { background: rgba(239, 68, 68, .12); }
.board-item--completed { background: rgba(5, 150, 105, .12); }
.board-item--closed { background: rgba(100, 116, 139, .14); }
.board-item--log { background: rgba(15, 23, 42, .05); }
.board-item--log.is-related { box-shadow: 0 0 0 2px rgba(37, 99, 235, .18); background: rgba(37, 99, 235, .08); }
.lane-item-meta { margin-top: 6px; color: #475569; font-size: 12px; line-height: 1.6; }
.focus-head { justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.page-toolbar--compact { flex-wrap: wrap; justify-content: flex-end; }
.focus-title { font-size: 18px; font-weight: 700; color: #111827; }
.focus-subtitle { margin-top: 6px; color: #64748b; word-break: break-all; }
.detail-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.meta-card { padding: 14px; border-radius: 14px; background: rgba(15, 23, 42, .04); }
.meta-label { font-size: 12px; color: #64748b; }
.meta-value { margin-top: 8px; font-size: 14px; font-weight: 600; color: #0f172a; line-height: 1.6; }
.meta-value--wrap { white-space: normal; word-break: break-word; }
.workspace-relation-panel { margin-bottom: 16px; padding: 14px; border-radius: 16px; background: rgba(15, 23, 42, .04); border: 1px solid rgba(148, 163, 184, .16); }
.workspace-relation-panel.is-warning { background: rgba(245, 158, 11, .10); border-color: rgba(245, 158, 11, .22); }
.workspace-relation-panel.is-danger { background: rgba(239, 68, 68, .08); border-color: rgba(239, 68, 68, .20); }
.workspace-relation-panel.is-success { background: rgba(5, 150, 105, .08); border-color: rgba(5, 150, 105, .18); }
.workspace-relation-panel__title { font-size: 15px; font-weight: 700; color: #111827; }
.workspace-relation-panel__desc { margin-top: 6px; color: #475569; font-size: 13px; line-height: 1.7; }
.workspace-relation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.workspace-relation-card { padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, .88); border: 1px solid rgba(148, 163, 184, .16); }
.workspace-relation-chip-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.workspace-relation-chip { display: inline-flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 12px; background: rgba(37, 99, 235, .08); color: #1e293b; font-size: 12px; line-height: 1.5; }
.workspace-relation-chip small { color: #64748b; font-size: 11px; }
.workspace-relation-chip.is-action { border: none; cursor: pointer; text-align: left; transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
.workspace-relation-chip.is-action:hover { transform: translateY(-1px); background: rgba(37, 99, 235, .14); box-shadow: 0 0 0 1px rgba(37, 99, 235, .16); }
.workspace-relation-chip.is-muted { background: rgba(148, 163, 184, .14); }
.workspace-relation-empty { color: #64748b; font-size: 12px; line-height: 1.7; }
.blocked-analysis { margin: 16px 0; padding: 14px; border-radius: 16px; background: rgba(239, 68, 68, .06); border: 1px solid rgba(239, 68, 68, .14); }
.blocked-header-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.blocked-diagnosis-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.blocked-diagnosis-card { padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, .92); border: 1px solid rgba(239, 68, 68, .10); }
.blocked-diagnosis-title { margin-top: 8px; font-size: 15px; font-weight: 700; color: #111827; }
.blocked-diagnosis-text { margin-top: 8px; color: #475569; font-size: 13px; line-height: 1.7; }
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
.focus-tabs :deep(.el-tabs__header) { margin-bottom: 14px; }
.workspace-editor { display: flex; flex-direction: column; gap: 14px; }
.workspace-editor__intro { padding: 14px; border-radius: 14px; background: rgba(37, 99, 235, .06); }
.workspace-form-shell { padding-top: 4px; }
.workspace-editor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.control-tabs :deep(.el-tabs__nav-wrap) { margin-bottom: 4px; }
.control-tab-body { display: flex; flex-direction: column; gap: 16px; }
.context-preview-card { padding: 14px; border-radius: 16px; background: rgba(15, 23, 42, .04); }
.log-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.log-filter-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.log-list-shell { display: flex; flex-direction: column; gap: 8px; }
.context-preview { margin: 0; max-height: 420px; overflow: auto; padding: 14px; border-radius: 16px; background: #0f172a; color: #e2e8f0; white-space: pre-wrap; word-break: break-word; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 1.7; }
@keyframes workspace-spotlight {
  0% { transform: translateY(0); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
  20% { transform: translateY(-2px); box-shadow: 0 0 0 3px rgba(37, 99, 235, .18), 0 18px 32px rgba(37, 99, 235, .14); }
  100% { transform: translateY(0); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
@media (max-width: 1680px) {
  .architect-shell { grid-template-columns: minmax(0, 1fr) 380px; }
  .lane-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 1380px) {
  .architect-shell, .detail-meta, .workspace-grid, .workspace-relation-grid, .blocked-diagnosis-strip, .blocked-analysis-grid, .workspace-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .architect-banner { grid-template-columns: minmax(0, 1fr); }
  .architect-banner__actions { align-items: flex-start; }
  .sidebar-card { position: static; }
}
@media (max-width: 960px) {
  .lane-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
