<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SessionMessageList from '@/components/SessionMessageList.vue';
import SessionTimelineList from '@/components/SessionTimelineList.vue';
import StatusTag from '@/components/StatusTag.vue';
import TerminalPanel from '@/components/TerminalPanel.vue';
import { useSessionStore } from '@/stores/sessions';
import type { SessionWorkspaceMeta } from '@/types/api';
import {
  buildWorkspaceSummary,
  diagnoseBlockedWorkspace,
  finalizeWorkspaceSummaries,
  getWorkspaceRole,
  isCollaborativeWorkspaceSession,
  type AgentWorkspaceSummary,
  type WorkspaceRoleKey
} from '@/utils/architectConsole';

const SESSION_LAYOUT_STORAGE_KEY = 'muti-agent:session-detail-layout:v3';

type SuggestedActionKey = 'send' | 'log' | 'back' | 'expand-terminal' | 'timeline' | 'messages' | 'none';

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();
const inputText = ref('');
const sending = ref(false);
const detailTab = ref<'messages' | 'timeline' | 'technical'>('messages');
const terminalHeight = ref(420);
const terminalCollapsed = ref(false);
let terminalHeightDragging = false;
let terminalHeightStartY = 0;
let terminalHeightStartValue = 420;

const sessionId = computed(() => String(route.params.id ?? ''));
const focusMessageId = computed(() => {
  const raw = route.query.messageId;
  return typeof raw === 'string' && raw ? raw : null;
});
const returnToDashboard = computed(() => route.query.from === 'dashboard');
const returnToSessionList = computed(() => route.query.from === 'sessions');
const dashboardReturnQuery = computed(() => ({
  dashboardSessionId: typeof route.query.dashboardSessionId === 'string' && route.query.dashboardSessionId
    ? route.query.dashboardSessionId
    : sessionId.value,
  dashboardLane: typeof route.query.dashboardLane === 'string' ? route.query.dashboardLane : 'all',
  dashboardControl: typeof route.query.dashboardControl === 'string' ? route.query.dashboardControl : 'dispatch',
  dashboardDetail: typeof route.query.dashboardDetail === 'string' ? route.query.dashboardDetail : 'messages'
}));
const dashboardReturnSummary = computed(() => {
  const laneMap: Record<string, string> = {
    all: '全部子窗口',
    assigned: '待开始子窗口',
    running: '执行中子窗口',
    blocked: '已阻塞子窗口',
    completed: '已完成子窗口',
    closed: '已关闭子窗口'
  };
  const controlMap: Record<string, string> = {
    dispatch: '统一调度',
    summary: '汇总再调度',
    logs: '操作流水'
  };
  const detailMap: Record<string, string> = {
    messages: '对话记录',
    timeline: '会话时间线',
    workspace: '协作状态'
  };
  return [
    `返回后恢复：${laneMap[dashboardReturnQuery.value.dashboardLane] || '全部子窗口'}`,
    `右侧停留在“${controlMap[dashboardReturnQuery.value.dashboardControl] || '统一调度'}”`,
    `左侧详情停留在“${detailMap[dashboardReturnQuery.value.dashboardDetail] || '对话记录'}”`
  ].join('；');
});
const sessionWorkspaceMeta = computed<SessionWorkspaceMeta>(() => {
  const raw = sessionStore.currentSession?.extraJson;
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as SessionWorkspaceMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
});
const currentSessionSummary = computed(() =>
  sessionStore.currentSession ? buildWorkspaceSummary(sessionStore.currentSession, []) : null
);
const sessionRole = computed(() => currentSessionSummary.value?.role ?? getWorkspaceRole((sessionWorkspaceMeta.value.role as WorkspaceRoleKey) || 'general'));
const sessionCoordinationState = computed(() => currentSessionSummary.value?.coordinationState ?? 'assigned');
const sessionCoordinationLabel = computed(() => `协作状态：${currentSessionSummary.value?.coordinationLabel ?? '未标注'}`);
const interactionModeLabel = computed(() => {
  switch ((sessionStore.currentSession?.interactionMode || '').toUpperCase()) {
    case 'RAW':
      return '终端协作';
    case 'STRUCTURED':
      return '结构化协作';
    case 'EMBEDDED':
      return '嵌入终端';
    case 'TEXT':
      return '文本对话';
    default:
      return sessionStore.currentSession?.interactionMode || '未知模式';
  }
});
const inferredBlockingReason = computed(() => {
  const text = sessionStore.messages.map((item) => item.contentText || item.rawChunk || '').join('\n');
  if (
    text.includes('wsl.exe [')
    || text.includes('Windows Subsystem for Linux')
    || text.includes('wsl --install')
  ) {
    return '当前会话启动失败：本机 WSL 未安装或未初始化，因此暂时无法继续发送消息。';
  }
  return sessionWorkspaceMeta.value.blockedReason?.trim()
    || sessionStore.currentSession?.exitReason
    || null;
});
const sessionSummaryText = computed(() =>
  sessionWorkspaceMeta.value.progressSummary?.trim()
  || sessionStore.currentSession?.summary?.trim()
  || '当前还没有沉淀出的任务摘要。'
);
const sharedContextModeLabel = computed(() => {
  switch (sessionWorkspaceMeta.value.sharedContextMode) {
    case 'all_active':
      return '全部活跃窗口';
    case 'related':
      return '依赖 + 关键活跃窗口';
    case 'dependencies':
      return '仅依赖窗口';
    default:
      return null;
  }
});
const workspaceSummaries = computed(() => finalizeWorkspaceSummaries(
  sessionStore.items
    .filter((item) => isCollaborativeWorkspaceSession(item))
    .map((item) => buildWorkspaceSummary(item, []))
));
const sessionWorkspaceSummary = computed(() => workspaceSummaries.value.find((item) => item.id === sessionId.value) ?? null);
const sessionDependencyItems = computed(() => {
  const dependencyIds = sessionWorkspaceSummary.value?.dependencies?.length
    ? sessionWorkspaceSummary.value.dependencies
    : (sessionWorkspaceMeta.value.dependencySessionIds?.filter(Boolean) ?? []);

  return dependencyIds.map((dependencyId) => {
    const dependency = workspaceSummaries.value.find((item) => item.id === dependencyId);
    if (dependency) {
      return {
        id: dependency.id,
        label: `${dependency.role.label}·${dependency.title}`,
        subtitle: dependency.coordinationLabel,
        muted: false
      };
    }
    return {
      id: dependencyId,
      label: `会话 ${dependencyId.slice(0, 8)}`,
      subtitle: '未在当前列表中找到',
      muted: true
    };
  });
});
const sessionDependentItems = computed(() =>
  workspaceSummaries.value
    .filter((item) => item.dependencies.includes(sessionId.value))
    .map((item) => ({
      id: item.id,
      label: `${item.role.label}·${item.title}`,
      subtitle: item.coordinationLabel,
      muted: false
    }))
);
const sessionRelationSummary = computed(() => {
  if (sessionBlockedDiagnosis.value && sessionDependentItems.value.length) {
    return {
      tone: 'danger' as const,
      title: '当前阻塞已经影响到下游协作',
      description: '建议先回总控台处理阻塞，并同步受影响子窗口，避免下游继续空等。'
    };
  }
  if (sessionBlockedDiagnosis.value) {
    return {
      tone: 'warning' as const,
      title: '当前窗口已阻塞，适合回总控台统一调度',
      description: '先确认阻塞归属与推荐模板，再决定是否改派角色或调整依赖顺序。'
    };
  }
  if (sessionDependentItems.value.length) {
    return {
      tone: 'warning' as const,
      title: '这个子窗口的进展正在影响其他窗口',
      description: '继续推进前，最好先确认下游窗口是否已经拿到所需输入，避免协作状态失真。'
    };
  }
  if (sessionDependencyItems.value.length) {
    return {
      tone: 'info' as const,
      title: '这个子窗口依赖上游结果',
      description: '继续下指令前，建议先确认依赖结果是否已经就绪，以及当前说明是否仍然有效。'
    };
  }
  return {
    tone: 'success' as const,
    title: '当前窗口可相对独立推进',
    description: '当前没有明显上下游依赖，可先聚焦本窗口执行，再按结果回总控台汇总。'
  };
});
const sessionBlockedDiagnosis = computed(() => {
  const coordinationStatus = sessionCoordinationState.value;
  if (coordinationStatus !== 'blocked' && !inferredBlockingReason.value) {
    return null;
  }
  return diagnoseBlockedWorkspace({
    blockedReason: sessionWorkspaceMeta.value.blockedReason || inferredBlockingReason.value,
    progressHint: sessionStore.currentSession?.summary || '',
    roleKey: (sessionWorkspaceMeta.value.role as WorkspaceRoleKey) || 'general',
    hasDependencies: Boolean(sessionWorkspaceMeta.value.dependencySessionIds?.length)
  });
});
const canSend = computed(() => sessionStore.currentSessionStatus === 'RUNNING' && !!inputText.value.trim() && !sending.value);
const canStop = computed(() => sessionStore.currentSessionStatus === 'RUNNING');
const sendDisabledReason = computed(() => {
  if (sending.value) {
    return '消息发送中，请稍候';
  }
  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    return inferredBlockingReason.value
      ? `当前进程状态为 ${sessionStore.currentSessionStatus}：${inferredBlockingReason.value}`
      : `当前进程状态为 ${sessionStore.currentSessionStatus}，暂不支持继续发送`;
  }
  if (!inputText.value.trim()) {
    return '输入内容后可发送，Enter 发送，Shift+Enter 换行';
  }
  return 'Enter 发送，Shift+Enter 换行';
});
const inputPlaceholder = computed(() => {
  const coordinationStatus = sessionCoordinationState.value;

  if (sessionBlockedDiagnosis.value) {
    return [
      `当前窗口已识别为“${sessionBlockedDiagnosis.value.label}”。`,
      `建议回到架构师总控台，使用“${sessionBlockedDiagnosis.value.templateKey}”模板继续推进。`,
      ...sessionBlockedDiagnosis.value.draftChecklist.map((item, index) => `${index + 1}. ${item}`)
    ].join('\n');
  }

  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    return '当前进程未运行。请先恢复执行，或回到架构师总控台继续调度。';
  }

  if (coordinationStatus === 'assigned') {
    return [
      `给${sessionRole.value.label}子窗口发送完整任务指令：`,
      '1. 说明本次要完成什么，以及不要做什么',
      '2. 补充依赖、边界、输出格式和汇报方式',
      '3. 发送后观察左侧终端是否开始执行'
    ].join('\n');
  }

  return [
    `给${sessionRole.value.label}子窗口发送完整任务指令；`,
    '左侧终端更适合实时观察与短交互。'
  ].join('\n');
});
const terminalModeText = computed(() => sessionStore.currentSessionStatus === 'RUNNING' ? '可交互' : '只读回放');
const observerSummaryText = computed(() => terminalCollapsed.value
  ? '当前默认折叠。只有在需要排障、观察原始终端态或做短交互时再展开。'
  : '当前已展开，可直接观察原始输出、短交互和终端尺寸变化；这是会话页的核心功能区之一。'
);
const technicalItems = computed(() => [
  { label: '会话 ID', value: sessionStore.currentSession?.id ?? '-' },
  { label: '实例 ID', value: sessionStore.currentSession?.appInstanceId ?? '-' },
  { label: 'PID', value: String(sessionStore.currentSession?.pid ?? '-') },
  { label: '项目目录', value: sessionStore.currentSession?.projectPath ?? '-' },
  { label: '交互模式', value: interactionModeLabel.value },
  { label: '原始日志', value: sessionStore.currentSession?.rawLogPath ?? '-' }
]);
const taskPacketSummarySections = computed(() => {
  const sharedPolicyItems = [
    sharedContextModeLabel.value ? `共享范围：${sharedContextModeLabel.value}` : null,
    sessionWorkspaceMeta.value.sharedContextLimit != null ? `窗口上限：${sessionWorkspaceMeta.value.sharedContextLimit}` : null
  ].filter((item): item is string => Boolean(item));

  return [
    {
      title: '范围约束',
      items: splitSummaryLines(sessionWorkspaceMeta.value.taskScope),
      emptyText: '当前未记录范围约束'
    },
    {
      title: '验收标准',
      items: splitSummaryLines(sessionWorkspaceMeta.value.acceptanceCriteria),
      emptyText: '当前未记录验收标准'
    },
    {
      title: '交付要求',
      items: splitSummaryLines(sessionWorkspaceMeta.value.deliverableSpec),
      emptyText: '当前未记录交付要求'
    },
    {
      title: '共享策略',
      items: sharedPolicyItems,
      emptyText: '当前未记录共享策略'
    }
  ];
});
const hasTaskPacketSummary = computed(() =>
  taskPacketSummarySections.value.some((section) => section.items.length > 0)
);
const sessionSharedContextRefs = computed(() =>
  (sessionWorkspaceMeta.value.sharedContextRefs ?? [])
    .filter((item) => item && typeof item === 'object' && (item.sessionId || item.title))
    .map((item) => {
      const linkedWorkspace = item.sessionId
        ? workspaceSummaries.value.find((workspace) => workspace.id === item.sessionId) ?? null
        : null;
      const label = `${item.roleLabel?.trim() || linkedWorkspace?.role.label || item.roleKey?.trim() || '未标注角色'} · ${item.title?.trim() || linkedWorkspace?.title || (item.sessionId ? `会话 ${item.sessionId.slice(0, 8)}` : '未知窗口')}`;
      return {
        sessionId: item.sessionId || linkedWorkspace?.id || '',
        label,
        reason: item.includedReason?.trim() || '共享上下文来源',
        status: item.coordinationLabel?.trim() || linkedWorkspace?.coordinationLabel || item.coordinationState?.trim() || '状态未知',
        progress: item.progressHint?.trim() || linkedWorkspace?.progressHint || '暂无最近进展',
        lastActiveText: item.lastActiveText?.trim() || linkedWorkspace?.lastActiveText || '暂无更新',
        actionable: Boolean(linkedWorkspace)
      };
    })
);

const composerGuidance = computed(() => {
  const coordinationStatus = sessionCoordinationState.value;

  if (sessionBlockedDiagnosis.value) {
    return {
      tone: sessionBlockedDiagnosis.value.tone,
      title: `当前更适合回总控台按“${sessionBlockedDiagnosis.value.label}”处理`,
      description: `这个子窗口当前不适合继续直接下指令。建议在架构师总控台使用“${sessionBlockedDiagnosis.value.templateKey}”流程继续推进。`,
      bullets: sessionBlockedDiagnosis.value.draftChecklist
    };
  }

  if (coordinationStatus === 'assigned') {
    return {
      tone: 'warning' as const,
      title: '更适合先补齐完整任务指令',
      description: '这个子窗口已经分配，但还没明确进入执行状态。建议先补齐范围、产出和汇报要求。',
      bullets: [
        '先说明目标，以及明确不需要做什么',
        '补充边界、依赖和预期输出格式',
        '发送后观察终端是否真的开始推进'
      ]
    };
  }

  if (coordinationStatus === 'closed') {
    return {
      tone: 'info' as const,
      title: '这个子窗口已经关闭',
      description: '当前不适合继续直接发送指令。更适合先回总控台判断是重新创建、重新派单，还是仅做结果归档。',
      bullets: [
        '先确认这是正常结束当前阶段，还是中途手动关闭',
        '如果还要继续推进，建议回总控台重新创建或改派子窗口',
        '如果结果已经足够，可直接回总控台做汇总或关闭'
      ]
    };
  }

  return {
    tone: 'info' as const,
    title: '右侧输入框适合发送结构化任务指令',
    description: '右侧输入框用于完整任务说明；左侧终端用于现场观察和短交互。',
    bullets: [
      '继续下发任务前，先看一下左侧终端现场',
      '任务指令尽量写清目标、边界、依赖和汇报格式',
      '发送后到消息或时间线确认结果'
    ]
  };
});

const currentSuggestedAction = computed(() => {
  const coordinationStatus = sessionCoordinationState.value;
  const hasDraftInput = Boolean(inputText.value.trim());

  if (sending.value) {
    return {
      title: '当前建议动作：等待本次发送完成',
      description: '先不要重复发送。等返回结果后，再观察终端输出和消息回执。',
      tone: 'info' as const,
      steps: [
        '先等待当前发送请求结束。',
        '查看终端和消息列表是否有新反馈。',
        '如果没有变化，再决定是补发还是回总控台处理。'
      ],
      primaryLabel: '查看对话记录',
      primaryAction: 'messages' as SuggestedActionKey,
      secondaryLabel: '查看时间线',
      secondaryAction: 'timeline' as SuggestedActionKey
    };
  }

  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    const isClosed = coordinationStatus === 'closed';
    const isCompleted = !isClosed && (sessionStore.currentSessionStatus === 'COMPLETED' || coordinationStatus === 'completed');
    const title = isClosed
      ? '当前建议动作：回总控台决定是否重新派单'
      : (isCompleted ? '当前建议动作：回看结果并准备汇总' : '当前建议动作：先处理阻塞或恢复执行');
    const description = isClosed
      ? '这个子窗口已经关闭，当前更适合回总控台决定是否重新创建、重新派单或直接归档。'
      : (isCompleted
        ? '这个子窗口看起来已经完成了当前阶段，更适合先回看结果，再决定下一步调度。'
        : (inferredBlockingReason.value || `当前进程状态为 ${sessionStore.currentSessionStatus}。`));
    const steps = isClosed
      ? [
          '先确认当前结果是否已经足够，或者只是中途手动关闭。',
          returnToDashboard.value ? '回到架构师总控台，决定是重新开新窗口、改派现有窗口，还是直接汇总。' : '返回上一层后再决定下一步动作。',
          '如果需要技术证据，再查看对话记录、时间线或原始日志。'
        ]
      : (isCompleted
        ? [
            '先查看对话记录和时间线，确认最终输出。',
            returnToDashboard.value ? '回到架构师总控台，决定是汇总、再调度还是关闭子窗口。' : '返回上一层后再决定下一步动作。',
            '如果需要更强证据，再打开日志或技术详情。'
          ]
        : [
            '先阅读原始终端输出或日志文件。',
            returnToDashboard.value ? '回到架构师总控台，决定是解除阻塞、改派角色，还是关闭这个子窗口。' : '返回上一层后再决定是否重新调度。',
            '只有在执行恢复后再继续发送新任务。'
          ]);
    const primaryLabel = isClosed || isCompleted
      ? (returnToDashboard.value ? '返回总控台' : '查看时间线')
      : '打开日志文件';
    const primaryAction = (isClosed || isCompleted)
      ? ((returnToDashboard.value ? 'back' : 'timeline') as SuggestedActionKey)
      : ('log' as SuggestedActionKey);
    const secondaryLabel = isClosed || isCompleted
      ? '查看对话记录'
      : (returnToDashboard.value ? '返回总控台' : '查看时间线');
    const secondaryAction = (isClosed || isCompleted)
      ? ('messages' as SuggestedActionKey)
      : ((returnToDashboard.value ? 'back' : 'timeline') as SuggestedActionKey);

    return {
      title,
      description,
      tone: isClosed ? 'info' as const : (isCompleted ? 'success' as const : 'warning' as const),
      steps,
      primaryLabel,
      primaryAction,
      secondaryLabel,
      secondaryAction
    };
  }

  if (terminalCollapsed.value) {
    return {
      title: '当前建议动作：先展开终端看现场',
      description: '终端已经折叠。先恢复终端区查看现场，再决定是否继续发送任务指令。',
      tone: 'warning' as const,
      steps: [
        '展开终端面板，先看最新输出。',
        '如果子窗口状态正常，再在右侧发送完整任务说明。',
        '之后用消息和时间线确认结果。'
      ],
      primaryLabel: '展开终端',
      primaryAction: 'expand-terminal' as SuggestedActionKey,
      secondaryLabel: '查看对话记录',
      secondaryAction: 'messages' as SuggestedActionKey
    };
  }

  if (hasDraftInput) {
    return {
      title: '当前建议动作：发送这条任务指令',
      description: '输入框里已经有草稿内容，建议先发送，再观察执行情况和确认信号。',
      tone: 'success' as const,
      steps: [
        '确认这条指令写清了目标、非目标和汇报方式。',
        '发送后观察终端是否开始推进。',
        '再到消息或时间线里确认结果。'
      ],
      primaryLabel: '发送任务指令',
      primaryAction: 'send' as SuggestedActionKey,
      secondaryLabel: '查看时间线',
      secondaryAction: 'timeline' as SuggestedActionKey
    };
  }

  if (coordinationStatus === 'assigned') {
    return {
      title: '当前建议动作：补齐任务说明并启动执行',
      description: '这个子窗口已分配，但仍在等待一份清晰的任务说明。',
      tone: 'warning' as const,
      steps: [
        '先写清目标、边界、依赖和预期汇报。',
        '发送后观察终端是否真的开始工作。',
        '如果还是没有变化，再回架构师总控台调整调度方案。'
      ],
      primaryLabel: '查看对话记录',
      primaryAction: 'messages' as SuggestedActionKey,
      secondaryLabel: returnToDashboard.value ? '返回总控台' : '查看时间线',
      secondaryAction: (returnToDashboard.value ? 'back' : 'timeline') as SuggestedActionKey
    };
  }

  return {
    title: '当前建议动作：先看现场，再决定是否继续下指令',
    description: '先用终端理解当前现场，再决定是否需要继续发送任务指令。',
    tone: 'info' as const,
    steps: [
      '先查看最新终端输出，确认当前执行状态。',
      '如果确实需要继续推进，再在右侧发送完整指令。',
      '最后在消息或时间线中核对结果。'
    ],
    primaryLabel: '查看时间线',
    primaryAction: 'timeline' as SuggestedActionKey,
    secondaryLabel: '查看对话记录',
    secondaryAction: 'messages' as SuggestedActionKey
  };
});

function splitSummaryLines(value?: string | null) {
  return (value ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function restoreLayoutPreference() {
  const raw = window.localStorage.getItem(SESSION_LAYOUT_STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as { terminalHeight?: number; terminalCollapsed?: boolean };
    if (typeof parsed.terminalHeight === 'number' && parsed.terminalHeight >= 320 && parsed.terminalHeight <= 900) {
      terminalHeight.value = parsed.terminalHeight;
    }
    if (typeof parsed.terminalCollapsed === 'boolean') {
      terminalCollapsed.value = parsed.terminalCollapsed;
    }
  } catch {
  }
}

function persistLayoutPreference() {
  window.localStorage.setItem(SESSION_LAYOUT_STORAGE_KEY, JSON.stringify({
    terminalHeight: terminalHeight.value,
    terminalCollapsed: terminalCollapsed.value
  }));
}

function resetWorkspaceLayout() {
  terminalHeight.value = 420;
  terminalCollapsed.value = false;
}

function toggleTerminalCollapsed() {
  terminalCollapsed.value = !terminalCollapsed.value;
}

function clampTerminalHeight(value: number) {
  return Math.min(720, Math.max(320, value));
}

function stopTerminalHeightDragging() {
  if (!terminalHeightDragging) {
    return;
  }
  terminalHeightDragging = false;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', handleTerminalHeightDragging);
  window.removeEventListener('mouseup', stopTerminalHeightDragging);
}

function handleTerminalHeightDragging(event: MouseEvent) {
  if (!terminalHeightDragging) {
    return;
  }
  const nextHeight = clampTerminalHeight(terminalHeightStartValue + (event.clientY - terminalHeightStartY));
  terminalHeight.value = nextHeight;
}

function startTerminalHeightDragging(event: MouseEvent) {
  event.preventDefault();
  terminalHeightDragging = true;
  terminalHeightStartY = event.clientY;
  terminalHeightStartValue = terminalHeight.value;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'row-resize';
  window.addEventListener('mousemove', handleTerminalHeightDragging);
  window.addEventListener('mouseup', stopTerminalHeightDragging);
}

async function loadCurrentSession() {
  await sessionStore.loadDetail(sessionId.value, { messageId: focusMessageId.value });
}

onMounted(async () => {
  restoreLayoutPreference();
  await Promise.all([loadCurrentSession(), sessionStore.loadList()]);
  await sessionStore.ensureSocket();
});

watch(
  () => [sessionId.value, focusMessageId.value],
  async ([nextSessionId, nextMessageId], [previousSessionId, previousMessageId]) => {
    if (nextSessionId === previousSessionId && nextMessageId === previousMessageId) {
      return;
    }
    if (nextMessageId) {
      detailTab.value = 'messages';
    }
    await Promise.all([loadCurrentSession(), sessionStore.loadList()]);
  }
);

watch([terminalHeight, terminalCollapsed], persistLayoutPreference, { deep: true });

onBeforeUnmount(() => {
  stopTerminalHeightDragging();
  sessionStore.disconnectSocket();
});

async function send() {
  const content = inputText.value.replace(/\r\n/g, '\n');
  if (!content.trim() || sending.value) {
    return;
  }
  sending.value = true;
  try {
    await sessionStore.sendInput(sessionId.value, content);
    inputText.value = '';
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    sending.value = false;
  }
}

async function handleTerminalInput(data: string) {
  if (!data) {
    return;
  }
  try {
    await sessionStore.sendRawInput(sessionId.value, data);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function handleTerminalResize(size: { cols: number; rows: number }) {
  if (sessionStore.currentSessionStatus !== 'RUNNING') {
    return;
  }
  try {
    await sessionStore.resizeTerminal(sessionId.value, size.cols, size.rows);
  } catch {
  }
}

async function stop() {
  if (!canStop.value) {
    ElMessage.info('当前会话未运行，无需停止');
    return;
  }
  try {
    await sessionStore.stop(sessionId.value);
    ElMessage.success('停止命令已发送');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function openRawLog() {
  const rawLogPath = sessionStore.currentSession?.rawLogPath;
  if (!rawLogPath) {
    ElMessage.warning('当前会话还没有可打开的原始日志文件');
    return;
  }
  if (!window.desktopBridge) {
    ElMessage.warning('当前环境不支持直接打开本地日志文件');
    return;
  }
  await window.desktopBridge.openPath(rawLogPath);
}

async function jumpToMessage(messageId: string) {
  detailTab.value = 'messages';
  await router.replace({
    path: `/sessions/${sessionId.value}`,
    query: {
      ...route.query,
      messageId
    }
  });
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}

async function handleSuggestedAction(action: SuggestedActionKey) {
  switch (action) {
    case 'send':
      await send();
      break;
    case 'log':
      await openRawLog();
      break;
    case 'expand-terminal':
      if (terminalCollapsed.value) {
        toggleTerminalCollapsed();
      }
      break;
    case 'timeline':
      detailTab.value = 'timeline';
      break;
    case 'messages':
      detailTab.value = 'messages';
      break;
    case 'back':
      navigateBack();
      break;
    default:
      break;
  }
}

function openRelatedWorkspace(targetSessionId: string) {
  if (!targetSessionId || targetSessionId === sessionId.value) {
    return;
  }

  const targetSummary = workspaceSummaries.value.find((item) => item.id === targetSessionId);
  if (returnToDashboard.value) {
    router.push({
      name: 'dashboard',
      query: {
        ...dashboardReturnQuery.value,
        dashboardSessionId: targetSessionId,
        dashboardLane: targetSummary?.coordinationState ?? 'all'
      }
    });
    return;
  }

  router.push({
    name: 'session-detail',
    params: { id: targetSessionId }
  });
}

function buildSessionListReturnQuery() {
  const query: Record<string, string | string[]> = {};
  Object.entries(route.query).forEach(([key, value]) => {
    if (key === 'from' || key === 'messageId') {
      return;
    }
    if (typeof value === 'string') {
      query[key] = value;
    } else if (Array.isArray(value)) {
      query[key] = value.filter((item): item is string => typeof item === 'string');
    }
  });
  return query;
}

function navigateBack() {
  if (returnToDashboard.value) {
    router.push({
      name: 'dashboard',
      query: dashboardReturnQuery.value
    });
    return;
  }
  if (returnToSessionList.value) {
    router.push({
      name: 'sessions',
      query: buildSessionListReturnQuery()
    });
    return;
  }
  router.push({ name: 'sessions' });
}
</script>

<template>
  <div class="session-detail-page">
    <div class="page-header session-header">
      <div>
        <h2>{{ sessionStore.currentSession?.title ?? '会话详情' }}</h2>
        <p class="session-description">
          {{ sessionRole.emoji }} {{ sessionRole.label }} · {{ sessionCoordinationLabel }} · {{ interactionModeLabel }}
        </p>
      </div>
      <div class="page-toolbar">
        <el-button plain @click="navigateBack">{{ returnToDashboard ? '返回总控台' : '返回会话列表' }}</el-button>
        <div class="session-toolbar-status">
          <span class="session-toolbar-status__label">进程状态</span>
          <StatusTag :status="sessionStore.currentSessionStatus" />
        </div>
        <el-tag :type="sessionStore.socketConnected ? 'success' : 'warning'">
          {{ sessionStore.socketConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}
        </el-tag>
        <el-button @click="openRawLog">打开原始日志</el-button>
        <el-button type="danger" :disabled="!canStop" @click="stop">停止会话</el-button>
      </div>
    </div>

    <div v-if="returnToDashboard" class="session-origin-bar">
      <div>
        <div class="session-origin-title">当前来自架构师总控台</div>
        <div class="session-origin-text">{{ dashboardReturnSummary }}</div>
      </div>
      <el-button type="primary" plain @click="navigateBack">带着上下文返回总控台</el-button>
    </div>

    <div class="task-cockpit">
      <el-card class="page-card">
        <template #header>
          <div class="card-head">
            <div>
              <div class="panel-title">当前建议动作</div>
              <div class="panel-subtitle">先理解当前现场，再决定是否继续发送更多指令。</div>
            </div>
          </div>
        </template>
        <div class="context-block">
          <div class="action-summary" :class="`is-${currentSuggestedAction.tone}`">
            <div class="card-head card-head--center">
              <div>
                <div class="action-summary__title">{{ currentSuggestedAction.title }}</div>
                <div class="action-summary__desc">{{ currentSuggestedAction.description }}</div>
              </div>
              <div class="page-toolbar page-toolbar--wrap">
                <el-button type="primary" @click="handleSuggestedAction(currentSuggestedAction.primaryAction)">
                  {{ currentSuggestedAction.primaryLabel }}
                </el-button>
                <el-button
                  v-if="currentSuggestedAction.secondaryAction && currentSuggestedAction.secondaryLabel"
                  @click="handleSuggestedAction(currentSuggestedAction.secondaryAction)"
                >
                  {{ currentSuggestedAction.secondaryLabel }}
                </el-button>
              </div>
            </div>
            <div class="action-summary__steps">
              <div v-for="(step, index) in currentSuggestedAction.steps" :key="`suggested-step-${index}`" class="action-summary__step">
                <span class="action-summary__index">{{ index + 1 }}</span>
                <span>{{ step }}</span>
              </div>
            </div>
          </div>
          <el-alert
            v-if="sessionStore.lastSessionError"
            :title="sessionStore.lastSessionError"
            type="error"
            :closable="false"
            show-icon
          />
          <el-alert
            v-else-if="sessionStore.currentSessionStatus !== 'RUNNING' && inferredBlockingReason"
            :title="inferredBlockingReason"
            type="warning"
            :closable="false"
            show-icon
          />
          <div class="context-summary">
            <div class="context-label">任务摘要</div>
            <div class="context-text">{{ sessionSummaryText }}</div>
          </div>
        </div>
      </el-card>

      <el-card class="page-card composer-card">
        <template #header>
          <div class="card-head">
            <div>
              <div class="panel-title">发送任务指令</div>
              <div class="panel-subtitle">这里是主交互入口；原始终端仅作为辅助观察区。</div>
            </div>
          </div>
        </template>
        <div class="composer-box">
          <div class="composer-guidance" :class="`is-${composerGuidance.tone}`">
            <div class="composer-guidance__title">{{ composerGuidance.title }}</div>
            <div class="composer-guidance__desc">{{ composerGuidance.description }}</div>
            <div class="composer-guidance__list">
              <div v-for="(item, index) in composerGuidance.bullets" :key="`composer-guidance-${index}`" class="composer-guidance__item">
                <span class="composer-guidance__index">{{ index + 1 }}</span>
                <span>{{ item }}</span>
              </div>
            </div>
          </div>
          <el-input
            v-model="inputText"
            class="composer-input"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            :disabled="sessionStore.currentSessionStatus !== 'RUNNING' || sending"
            :placeholder="inputPlaceholder"
            @keydown="handleComposerKeydown"
          />
          <div class="composer-footer">
            <span class="composer-tip">{{ sendDisabledReason }}</span>
            <el-button
              type="primary"
              :loading="sending"
              :disabled="!canSend"
              @click="send"
            >
              发送任务指令
            </el-button>
          </div>
        </div>
      </el-card>
    </div>

    <div class="session-main-grid">
      <div class="session-primary-column">
        <el-card class="page-card section-gap">
          <el-tabs v-model="detailTab" class="detail-tabs">
            <el-tab-pane label="对话记录" name="messages">
              <SessionMessageList
                :messages="sessionStore.messages"
                :highlight-message-id="sessionStore.highlightedMessageId"
              />
            </el-tab-pane>
            <el-tab-pane label="会话时间线" name="timeline">
              <SessionTimelineList
                :items="sessionStore.timelineItems"
                :highlight-message-id="sessionStore.highlightedMessageId"
                @jump-to-message="jumpToMessage"
              />
            </el-tab-pane>
            <el-tab-pane label="技术详情" name="technical">
              <div class="technical-grid">
                <div v-for="item in technicalItems" :key="item.label" class="meta-card">
                  <div class="meta-label">{{ item.label }}</div>
                  <div class="meta-value">{{ item.value }}</div>
                </div>
              </div>
              <div class="technical-actions">
                <el-button @click="openRawLog">打开原始日志</el-button>
                <el-button type="danger" :disabled="!canStop" @click="stop">停止会话</el-button>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>

      <div class="session-secondary-column">
        <el-card class="page-card panel-card observer-card">
          <template #header>
            <div class="card-head">
              <div>
                <div class="panel-title">辅助观察区 · 原始终端</div>
                <div class="panel-subtitle">{{ observerSummaryText }}</div>
              </div>
              <div class="page-toolbar">
                <el-tag :type="sessionStore.currentSessionStatus === 'RUNNING' ? 'success' : 'info'">{{ terminalModeText }}</el-tag>
                <el-button @click="toggleTerminalCollapsed">{{ terminalCollapsed ? '展开观察区' : '折叠观察区' }}</el-button>
                <el-button link @click="resetWorkspaceLayout">恢复默认</el-button>
              </div>
            </div>
          </template>

          <div v-if="terminalCollapsed" class="collapsed-terminal-bar">
            <div>
              <div class="collapsed-terminal-title">观察区已折叠</div>
              <div class="collapsed-terminal-text">当前优先把注意力放在对话记录和任务指令上；需要排障时再展开原始终端。</div>
            </div>
            <div class="page-toolbar">
              <el-button @click="toggleTerminalCollapsed">展开终端</el-button>
              <el-button plain @click="openRawLog">打开原始日志</el-button>
            </div>
          </div>
          <template v-else>
            <div class="terminal-frame" :style="{ height: `${terminalHeight}px` }">
              <TerminalPanel
                :chunks="sessionStore.rawChunks"
                :session-id="sessionId"
                :interactive="sessionStore.currentSessionStatus === 'RUNNING'"
                @terminal-input="handleTerminalInput"
                @terminal-resize="handleTerminalResize"
              />
            </div>
            <button type="button" class="terminal-resize-handle" @mousedown="startTerminalHeightDragging">
              <span class="terminal-resize-handle__line" />
              <span>拖拽调整观察区高度</span>
            </button>
          </template>
        </el-card>

        <el-card class="page-card">
          <template #header>
            <div class="card-head">
              <div>
                <div class="panel-title">当前上下文</div>
                <div class="panel-subtitle">子窗口职责、依赖和阻塞都在这里，方便回总控台继续调度。</div>
              </div>
            </div>
          </template>
          <div class="context-block">
            <div class="relation-summary" :class="`is-${sessionRelationSummary.tone}`">
              <div class="relation-summary__title">{{ sessionRelationSummary.title }}</div>
              <div class="relation-summary__desc">{{ sessionRelationSummary.description }}</div>
              <div class="relation-grid">
                <div class="relation-card">
                  <div class="meta-label">上游依赖</div>
                  <div class="relation-chip-list">
                    <span v-if="sessionDependencyItems.length === 0" class="relation-empty">无显式上游依赖</span>
                    <button
                      v-for="item in sessionDependencyItems"
                      :key="`session-dependency-${item.id}`"
                      type="button"
                      class="relation-chip"
                      :class="{ 'is-muted': item.muted, 'is-action': !item.muted }"
                      :disabled="item.muted"
                      @click="openRelatedWorkspace(item.id)"
                    >
                      {{ item.label }}
                      <small>{{ item.subtitle }}</small>
                    </button>
                  </div>
                </div>
                <div class="relation-card">
                  <div class="meta-label">下游影响</div>
                  <div class="relation-chip-list">
                    <span v-if="sessionDependentItems.length === 0" class="relation-empty">暂未影响其他子窗口</span>
                    <button
                      v-for="item in sessionDependentItems"
                      :key="`session-dependent-${item.id}`"
                      type="button"
                      class="relation-chip is-action"
                      @click="openRelatedWorkspace(item.id)"
                    >
                      {{ item.label }}
                      <small>{{ item.subtitle }}</small>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="returnToDashboard && (sessionDependencyItems.length || sessionDependentItems.length || sessionBlockedDiagnosis)" class="relation-summary__actions">
                <el-button size="small" @click="navigateBack">回总控台查看相关窗口</el-button>
              </div>
            </div>
            <div v-if="hasTaskPacketSummary" class="task-packet-summary">
              <div class="task-packet-summary__title">任务包摘要</div>
              <div class="task-packet-summary__desc">这里保留架构师派单时写下的边界、验收和交付要求，方便当前窗口续跑。</div>
              <div class="task-packet-summary__grid">
                <section v-for="section in taskPacketSummarySections" :key="section.title" class="task-packet-summary__section">
                  <div class="task-packet-summary__section-title">{{ section.title }}</div>
                  <div v-if="!section.items.length" class="task-packet-summary__empty">{{ section.emptyText }}</div>
                  <div v-else class="task-packet-summary__list">
                    <div v-for="(item, index) in section.items" :key="`${section.title}-${index}`" class="task-packet-summary__item">
                      <span class="task-packet-summary__index">{{ index + 1 }}</span>
                      <span>{{ item }}</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div v-if="sessionSharedContextRefs.length" class="shared-context-ref-block">
              <div class="shared-context-ref-block__title">共享上下文来源</div>
              <div class="shared-context-ref-block__desc">这些窗口的阶段进展曾被带入当前任务包，方便回溯当时为什么会把它们纳入上下文。</div>
              <div class="shared-context-ref-grid">
                <button
                  v-for="item in sessionSharedContextRefs"
                  :key="item.sessionId || item.label"
                  type="button"
                  class="shared-context-ref-card"
                  :class="{ 'is-action': item.actionable }"
                  :disabled="!item.actionable"
                  @click="item.actionable ? openRelatedWorkspace(item.sessionId) : undefined"
                >
                  <div class="shared-context-ref-card__head">
                    <strong>{{ item.label }}</strong>
                    <span>{{ item.status }}</span>
                  </div>
                  <div class="shared-context-ref-card__meta">{{ item.reason }} · 最近活跃：{{ item.lastActiveText }}</div>
                  <div class="shared-context-ref-card__desc">{{ item.progress }}</div>
                </button>
              </div>
            </div>
            <div class="context-grid">
              <div class="meta-card">
                <div class="meta-label">项目目录</div>
                <div class="meta-value">{{ sessionStore.currentSession?.projectPath ?? '-' }}</div>
              </div>
              <div class="meta-card">
                <div class="meta-label">角色定位</div>
                <div class="meta-value">{{ sessionRole.label }}</div>
              </div>
              <div class="meta-card">
                <div class="meta-label">共享上下文</div>
                <div class="meta-value context-meta-value">{{ sessionWorkspaceMeta.sharedContextSummary || '暂无共享上下文摘要' }}</div>
              </div>
              <div class="meta-card">
                <div class="meta-label">阻塞原因</div>
                <div class="meta-value context-meta-value">{{ inferredBlockingReason || '当前未识别到明确阻塞' }}</div>
              </div>
            </div>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
<style scoped>
.session-header {
  align-items: flex-start;
}

.session-description {
  margin: 8px 0 0;
  color: #64748b;
}

.session-toolbar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.session-toolbar-status__label {
  font-size: 12px;
  color: #64748b;
}

.page-toolbar--wrap {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.session-origin-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.16);
}

.session-origin-title {
  font-weight: 700;
  color: #1d4ed8;
}

.session-origin-text {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.task-cockpit {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 16px;
  margin-bottom: 16px;
}

.session-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr);
  gap: 16px;
}

.session-primary-column,
.session-secondary-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-head--center {
  align-items: center;
}

.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.panel-subtitle {
  margin-top: 6px;
  color: #64748b;
  font-size: 13px;
}

.panel-card :deep(.el-card__header) {
  font-weight: 600;
}

.observer-card {
  overflow: hidden;
}

.observer-card :deep(.el-card__body) {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.terminal-frame {
  min-height: 260px;
  max-height: 720px;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: #020617;
}

.terminal-frame :deep(.terminal-wrapper) {
  height: 100%;
  min-height: 100%;
  max-height: 100%;
}

.terminal-resize-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px 2px;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: row-resize;
  font-size: 12px;
  transition: color 0.16s ease;
}

.terminal-resize-handle:hover {
  color: #2563eb;
}

.terminal-resize-handle__line {
  width: 56px;
  height: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.5);
}

.context-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-summary {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.04);
}

.action-summary.is-warning {
  background: rgba(245, 158, 11, 0.10);
  border-color: rgba(245, 158, 11, 0.2);
}

.action-summary.is-success {
  background: rgba(5, 150, 105, 0.08);
  border-color: rgba(5, 150, 105, 0.18);
}

.action-summary__title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.action-summary__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.action-summary__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.action-summary__step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.action-summary__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
}

.context-summary {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.04);
}

.relation-summary {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.04);
}

.relation-summary.is-warning {
  background: rgba(245, 158, 11, 0.10);
  border-color: rgba(245, 158, 11, 0.22);
}

.relation-summary.is-danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.relation-summary.is-success {
  background: rgba(5, 150, 105, 0.08);
  border-color: rgba(5, 150, 105, 0.18);
}

.relation-summary__title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.relation-summary__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.relation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.relation-card {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.relation-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.relation-chip {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(37, 99, 235, 0.08);
  color: #1e293b;
  font-size: 12px;
  line-height: 1.5;
}

.relation-chip.is-action {
  border: none;
  cursor: pointer;
  text-align: left;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.relation-chip.is-action:hover {
  transform: translateY(-1px);
  background: rgba(37, 99, 235, 0.14);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.16);
}

.relation-chip small {
  color: #64748b;
  font-size: 11px;
}

.relation-chip.is-muted {
  background: rgba(148, 163, 184, 0.14);
  cursor: default;
}

.relation-empty {
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.relation-summary__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.task-packet-summary {
  padding: 14px;
  border-radius: 16px;
  background: rgba(37, 99, 235, 0.06);
  border: 1px solid rgba(37, 99, 235, 0.12);
}

.task-packet-summary__title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.task-packet-summary__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.task-packet-summary__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.task-packet-summary__section {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.task-packet-summary__section-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.task-packet-summary__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.task-packet-summary__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.task-packet-summary__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 700;
}

.task-packet-summary__empty {
  margin-top: 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.shared-context-ref-block {
  padding: 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.shared-context-ref-block__title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.shared-context-ref-block__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.shared-context-ref-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.shared-context-ref-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.9);
  color: #334155;
  text-align: left;
}

.shared-context-ref-card.is-action {
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.shared-context-ref-card.is-action:hover {
  transform: translateY(-1px);
  background: rgba(37, 99, 235, 0.06);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.12);
}

.shared-context-ref-card:disabled {
  opacity: 1;
}

.shared-context-ref-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  color: #0f172a;
}

.shared-context-ref-card__head strong {
  font-size: 13px;
  line-height: 1.6;
}

.shared-context-ref-card__head span {
  flex-shrink: 0;
  color: #64748b;
  font-size: 12px;
}

.shared-context-ref-card__meta {
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.shared-context-ref-card__desc {
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.context-label {
  font-size: 12px;
  color: #64748b;
}

.context-text {
  margin-top: 8px;
  color: #334155;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.context-grid,
.technical-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.context-meta-value {
  white-space: pre-wrap;
  word-break: break-word;
}

.composer-card {
  min-height: 0;
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.composer-guidance {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.composer-guidance.is-warning {
  background: rgba(245, 158, 11, 0.10);
  border-color: rgba(245, 158, 11, 0.22);
}

.composer-guidance.is-danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.composer-guidance__title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.composer-guidance__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.composer-guidance__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.composer-guidance__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.composer-guidance__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
}

.composer-input :deep(textarea) {
  line-height: 1.7;
  font-size: 14px;
}

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.composer-tip {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

.collapsed-terminal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.06);
  border: 1px dashed rgba(148, 163, 184, 0.6);
}

.collapsed-terminal-title {
  font-weight: 700;
  color: #0f172a;
}

.collapsed-terminal-text {
  margin-top: 6px;
  color: #64748b;
  font-size: 13px;
}

.detail-tabs :deep(.el-tabs__content) {
  padding-top: 8px;
}

.technical-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 1680px) {
  .task-cockpit,
  .session-main-grid,
  .relation-grid,
  .task-packet-summary__grid,
  .shared-context-ref-grid,
  .context-grid,
  .technical-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1380px) {
  .session-origin-bar,
  .collapsed-terminal-bar,
  .composer-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-toolbar--wrap {
    flex-wrap: wrap;
  }
}
</style>
