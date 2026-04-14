import type { AiSession, AppInstance, SessionSharedContextRef, SessionWorkspaceMeta } from '@/types/api';

export type WorkspaceRoleKey = 'general' | 'developer' | 'frontend' | 'tester' | 'product' | 'document';
export type CoordinationTone = 'info' | 'primary' | 'warning' | 'success' | 'danger';
export type CoordinationState = 'assigned' | 'running' | 'blocked' | 'completed' | 'closed';
export type SharedContextMode = 'dependencies' | 'related' | 'all_active';

export interface WorkspaceRoleDefinition {
  key: WorkspaceRoleKey;
  label: string;
  emoji: string;
  description: string;
}

export interface AgentWorkspaceSummary {
  id: string;
  title: string;
  session: AiSession;
  tags: string[];
  role: WorkspaceRoleDefinition;
  workspaceMeta: SessionWorkspaceMeta;
  instanceName: string;
  appType: string;
  workspaceKindLabel: string;
  coordinationState: CoordinationState;
  coordinationLabel: string;
  coordinationTone: CoordinationTone;
  dependencies: string[];
  dependencyLabels: string[];
  projectPath: string;
  progressHint: string;
  lastActiveAt?: string | null;
  lastActiveText: string;
  canDispatch: boolean;
  canStop: boolean;
}

export interface DispatchPromptOptions {
  role: WorkspaceRoleDefinition;
  title: string;
  instruction: string;
  projectPath?: string;
  dependencyLabels?: string[];
  collaborationSnapshot?: string;
  collaborationRefs?: SessionSharedContextRef[];
  targetSessionTitle?: string;
  scopeHint?: string;
  acceptance?: string;
  deliverable?: string;
  collaborationItems?: AgentWorkspaceSummary[];
  collaborationMode?: SharedContextMode;
}

export interface CollaborationSnapshotOptions {
  currentSessionId?: string | null;
  dependencyIds?: string[];
  pinnedSessionIds?: string[];
  mode?: SharedContextMode;
  limit?: number;
}

export interface DispatchTaskPacketSection {
  title: string;
  items: string[];
  emptyText?: string;
}

export interface DispatchTaskPacket {
  sections: DispatchTaskPacketSection[];
}

export type BlockedCategoryKey =
  | 'requirement'
  | 'dependency'
  | 'environment'
  | 'implementation'
  | 'verification'
  | 'frontend'
  | 'documentation'
  | 'unknown';

export interface BlockedDiagnosis {
  key: BlockedCategoryKey;
  label: string;
  tone: 'info' | 'warning' | 'danger' | 'success';
  description: string;
  templateKey: 'continue' | 'request_info' | 'unblock' | 'document';
  targetRoleKey: WorkspaceRoleKey;
  playbook: string[];
  draftGoal: string;
  draftChecklist: string[];
}

export const WORKSPACE_ROLES: WorkspaceRoleDefinition[] = [
  {
    key: 'developer',
    label: '开发',
    emoji: '💻',
    description: '负责代码实现、方案落地和接口联调，不扩展到无关产品决策'
  },
  {
    key: 'frontend',
    label: '前端',
    emoji: '🖥️',
    description: '负责界面结构、交互体验和可视化表达，优先关注可用性与反馈闭环'
  },
  {
    key: 'tester',
    label: '测试',
    emoji: '🧪',
    description: '负责验证链路、异常场景和回归风险，及时暴露阻塞点'
  },
  {
    key: 'product',
    label: '产品',
    emoji: '🧭',
    description: '负责需求拆解、优先级判断和用户路径校准，不直接实现代码'
  },
  {
    key: 'document',
    label: '文档',
    emoji: '📝',
    description: '负责总结方案、记录决策与整理交付文档，保持术语与边界一致'
  },
  {
    key: 'general',
    label: '通用',
    emoji: '🤖',
    description: '承担通用子任务，仍需遵守架构师分配的职责边界'
  }
];

const WORKSPACE_ROLE_MAP = new Map(WORKSPACE_ROLES.map((item) => [item.key, item]));

function safeParseTags(tagsJson?: string | null) {
  if (!tagsJson) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeParseWorkspaceMeta(extraJson?: string | null): SessionWorkspaceMeta {
  if (!extraJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(extraJson) as SessionWorkspaceMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getTagValue(tags: string[], prefix: string) {
  return tags.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim() ?? '';
}

function getTagValues(tags: string[], prefix: string) {
  return tags
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length).trim())
    .filter(Boolean);
}

function toTimestamp(value?: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatMoment(value?: string | null) {
  if (!value) {
    return '暂无更新';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function resolveRole(tags: string[], workspaceMeta: SessionWorkspaceMeta) {
  const roleKey = (workspaceMeta.role || getTagValue(tags, 'role:')) as WorkspaceRoleKey;
  return WORKSPACE_ROLE_MAP.get(roleKey) ?? WORKSPACE_ROLE_MAP.get('general')!;
}

function mapCoordinationState(explicitState?: string | null): {
  state: CoordinationState;
  label: string;
  tone: CoordinationTone;
} | null {
  switch ((explicitState || '').toLowerCase()) {
    case 'assigned':
      return { state: 'assigned', label: '已分配', tone: 'warning' };
    case 'running':
      return { state: 'running', label: '执行中', tone: 'primary' };
    case 'blocked':
      return { state: 'blocked', label: '已阻塞', tone: 'danger' };
    case 'completed':
      return { state: 'completed', label: '已完成', tone: 'success' };
    case 'closed':
      return { state: 'closed', label: '已关闭', tone: 'info' };
    default:
      return null;
  }
}

function resolveCoordination(session: AiSession, tags: string[], workspaceMeta: SessionWorkspaceMeta) {
  const explicitState = mapCoordinationState(workspaceMeta.coordinationStatus || getTagValue(tags, 'coordination:'));
  if (session.status === 'FAILED') {
    return { state: 'blocked' as const, label: '已阻塞', tone: 'danger' as const };
  }
  if (session.status === 'STOPPING') {
    return { state: 'closed' as const, label: '关闭中', tone: 'warning' as const };
  }
  switch (session.status) {
    case 'STARTING':
      if (explicitState?.state === 'blocked') {
        return explicitState;
      }
      return { state: 'assigned' as const, label: '启动中', tone: 'warning' as const };
    case 'RUNNING':
      if (explicitState?.state === 'blocked' || explicitState?.state === 'completed' || explicitState?.state === 'closed') {
        return explicitState;
      }
      return { state: 'running' as const, label: '执行中', tone: 'primary' as const };
    case 'COMPLETED':
      if (explicitState?.state === 'blocked' || explicitState?.state === 'completed' || explicitState?.state === 'closed') {
        return explicitState;
      }
      if ((session.exitReason || '').includes('手动停止') || (session.exitReason || '').includes('强制停止')) {
        return { state: 'closed' as const, label: '已关闭', tone: 'info' as const };
      }
      return { state: 'completed' as const, label: '已完成', tone: 'success' as const };
    default:
      return explicitState ?? { state: 'assigned' as const, label: '待处理', tone: 'info' as const };
  }
}

function buildProgressHint(session: AiSession, workspaceMeta: SessionWorkspaceMeta) {
  if (session.status === 'FAILED') {
    return workspaceMeta.blockedReason?.trim()
      || session.exitReason?.trim()
      || workspaceMeta.progressSummary?.trim()
      || '子窗口执行失败，等待阻塞处理';
  }
  if (session.status === 'STOPPING') {
    return '子窗口正在关闭，等待最终状态回写';
  }
  if (session.status === 'STARTING') {
    return workspaceMeta.progressSummary?.trim()
      || session.summary?.trim()
      || '子窗口启动中，等待进入执行状态';
  }
  return workspaceMeta.progressSummary?.trim()
    || workspaceMeta.blockedReason?.trim()
    || session.summary?.trim()
    || session.exitReason?.trim()
    || session.title
    || '等待架构师分配任务';
}

function buildWorkspaceKindLabel(tags: string[], workspaceMeta: SessionWorkspaceMeta) {
  if ((workspaceMeta.workspaceKind || '').toLowerCase() === 'child' || tags.includes('workspace:child')) {
    return '协作子窗口';
  }
  return '普通会话';
}

export function isCollaborativeWorkspaceSession(session: AiSession) {
  const tags = safeParseTags(session.tagsJson);
  const workspaceMeta = safeParseWorkspaceMeta(session.extraJson);
  return (workspaceMeta.workspaceKind || '').toLowerCase() === 'child' || tags.includes('workspace:child');
}

export function buildWorkspaceSummary(session: AiSession, instances: AppInstance[]) {
  const tags = safeParseTags(session.tagsJson);
  const workspaceMeta = safeParseWorkspaceMeta(session.extraJson);
  const role = resolveRole(tags, workspaceMeta);
  const dependencies = workspaceMeta.dependencySessionIds?.filter(Boolean)?.length
    ? workspaceMeta.dependencySessionIds.filter(Boolean)
    : getTagValues(tags, 'depends:');
  const instance = instances.find((item) => item.id === session.appInstanceId);
  const coordination = resolveCoordination(session, tags, workspaceMeta);
  const lastActiveAt = session.lastMessageAt || workspaceMeta.updatedAt || session.updatedAt || session.startedAt || session.createdAt;

  return {
    id: session.id,
    title: session.title,
    session,
    tags,
    role,
    workspaceMeta,
    instanceName: instance?.name ?? session.appInstanceId,
    appType: instance?.appType ?? 'unknown',
    workspaceKindLabel: buildWorkspaceKindLabel(tags, workspaceMeta),
    coordinationState: coordination.state,
    coordinationLabel: coordination.label,
    coordinationTone: coordination.tone,
    dependencies,
    dependencyLabels: [],
    projectPath: session.projectPath || '未设置项目目录',
    progressHint: buildProgressHint(session, workspaceMeta),
    lastActiveAt,
    lastActiveText: formatMoment(lastActiveAt),
    canDispatch: session.status === 'RUNNING',
    canStop: session.status === 'STARTING' || session.status === 'RUNNING' || session.status === 'STOPPING'
  } satisfies AgentWorkspaceSummary;
}

export function finalizeWorkspaceSummaries(items: AgentWorkspaceSummary[]) {
  const titleMap = new Map(items.map((item) => [item.id, `${item.role.label} · ${item.title}`]));
  const stateWeight: Record<CoordinationState, number> = {
    running: 5,
    assigned: 4,
    blocked: 3,
    completed: 2,
    closed: 1
  };

  return items
    .map((item) => ({
      ...item,
      dependencyLabels: item.dependencies.map((dependencyId) => titleMap.get(dependencyId) ?? dependencyId)
    }))
    .sort((left, right) => {
      const leftPriority = left.workspaceKindLabel === '协作子窗口' ? 1 : 0;
      const rightPriority = right.workspaceKindLabel === '协作子窗口' ? 1 : 0;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      if (stateWeight[left.coordinationState] !== stateWeight[right.coordinationState]) {
        return stateWeight[right.coordinationState] - stateWeight[left.coordinationState];
      }

      return toTimestamp(right.lastActiveAt) - toTimestamp(left.lastActiveAt);
    });
}

export function buildWorkspaceTags(roleKey: WorkspaceRoleKey, dependencyIds: string[] = [], coordinationStatus = 'assigned') {
  const normalizedDependencyIds = Array.from(new Set(dependencyIds.filter(Boolean)));
  return [
    'workspace:child',
    'source:architect-console',
    `role:${roleKey}`,
    `coordination:${coordinationStatus}`,
    ...normalizedDependencyIds.map((item) => `depends:${item}`)
  ];
}

function clampCollaborationLimit(limit?: number) {
  return Math.min(Math.max(limit ?? 4, 1), 8);
}

function uniqueWorkspaceItems(items: AgentWorkspaceSummary[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function buildWorkspaceSnapshotLine(item: AgentWorkspaceSummary, index: number) {
  const dependencyText = item.dependencyLabels.length ? item.dependencyLabels.join('、') : '无';
  return `${index + 1}. [${item.role.label}] ${item.title}｜状态：${item.coordinationLabel}｜最近进展：${item.progressHint}｜依赖：${dependencyText}｜最后活跃：${item.lastActiveText}`;
}

function resolveSharedContextIncludedReason(item: AgentWorkspaceSummary, dependencyIds: Set<string>, pinnedIds: Set<string>) {
  if (pinnedIds.has(item.id)) {
    return '手动固定来源';
  }
  if (dependencyIds.has(item.id)) {
    return '显式依赖窗口';
  }
  switch (item.coordinationState) {
    case 'blocked':
      return '关键阻塞窗口';
    case 'running':
      return '执行中窗口';
    case 'assigned':
      return '待开始窗口';
    case 'completed':
      return '已完成窗口';
    case 'closed':
      return '关闭后参考窗口';
    default:
      return '共享上下文来源';
  }
}

function buildSharedContextReference(
  item: AgentWorkspaceSummary,
  dependencyIds: Set<string>,
  pinnedIds: Set<string>
): SessionSharedContextRef {
  return {
    sessionId: item.id,
    roleKey: item.role.key,
    roleLabel: item.role.label,
    title: item.title,
    coordinationState: item.coordinationState,
    coordinationLabel: item.coordinationLabel,
    progressHint: item.progressHint,
    includedReason: resolveSharedContextIncludedReason(item, dependencyIds, pinnedIds),
    lastActiveAt: item.lastActiveAt ?? null,
    lastActiveText: item.lastActiveText
  };
}

function buildSharedContextSnapshotLine(ref: SessionSharedContextRef, index: number) {
  const roleLabel = ref.roleLabel?.trim() || ref.roleKey?.trim() || '未标注角色';
  const title = ref.title?.trim() || ref.sessionId?.trim() || '未知窗口';
  const coordinationLabel = ref.coordinationLabel?.trim() || ref.coordinationState?.trim() || '未标注状态';
  const includedReason = ref.includedReason?.trim() || '共享上下文来源';
  const progressHint = ref.progressHint?.trim() || '暂无最近进展';
  const lastActiveText = ref.lastActiveText?.trim() || '暂无更新';
  return `${index + 1}. [${roleLabel}] ${title}｜纳入原因：${includedReason}｜状态：${coordinationLabel}｜最近进展：${progressHint}｜最后活跃：${lastActiveText}`;
}

export function buildSharedContextReferences(
  items: AgentWorkspaceSummary[],
  options: CollaborationSnapshotOptions = {}
) {
  const relevantItems = collectCollaborationItems(items, options);
  const dependencyIds = new Set((options.dependencyIds ?? []).filter(Boolean));
  const pinnedIds = new Set((options.pinnedSessionIds ?? []).filter(Boolean));
  return relevantItems.map((item) => buildSharedContextReference(item, dependencyIds, pinnedIds));
}

export function collectCollaborationItems(
  items: AgentWorkspaceSummary[],
  options: CollaborationSnapshotOptions = {}
) {
  const mode = options.mode ?? 'dependencies';
  const limit = clampCollaborationLimit(options.limit);
  const normalizedDependencyIds = new Set((options.dependencyIds ?? []).filter(Boolean));
  const normalizedPinnedIds = new Set((options.pinnedSessionIds ?? []).filter(Boolean));
  const filtered = items.filter((item) => item.id !== options.currentSessionId);
  const dependencyItems = filtered.filter((item) => normalizedDependencyIds.has(item.id));
  const pinnedItems = filtered.filter((item) => normalizedPinnedIds.has(item.id));
  const activeItems = filtered.filter((item) => item.coordinationState !== 'closed');

  if (mode === 'dependencies') {
    return uniqueWorkspaceItems([
      ...pinnedItems,
      ...dependencyItems
    ]).slice(0, limit);
  }

  if (mode === 'related') {
    return uniqueWorkspaceItems([
      ...pinnedItems,
      ...dependencyItems,
      ...activeItems.filter((item) => item.coordinationState === 'blocked'),
      ...activeItems.filter((item) => item.coordinationState === 'running'),
      ...activeItems.filter((item) => item.coordinationState === 'assigned'),
      ...activeItems.filter((item) => item.coordinationState === 'completed')
    ]).slice(0, limit);
  }

  return uniqueWorkspaceItems([
    ...pinnedItems,
    ...dependencyItems,
    ...activeItems,
    ...filtered.filter((item) => item.coordinationState === 'closed')
  ]).slice(0, limit);
}

export function buildCollaborationSnapshot(
  items: AgentWorkspaceSummary[],
  options: CollaborationSnapshotOptions = {}
) {
  const relevantItems = buildSharedContextReferences(items, options);

  if (!relevantItems.length) {
    if ((options.mode ?? 'dependencies') === 'dependencies') {
      return '当前未选择依赖窗口，因此不会自动注入额外共享上下文；如需同步其他子窗口进展，请先选择依赖窗口。';
    }
    return '当前暂无其他子窗口需要同步，你可以专注处理当前任务，但仍需及时汇报阻塞与完成状态。';
  }

  return relevantItems
    .map((item, index) => buildSharedContextSnapshotLine(item, index))
    .join('\n');
}

export function buildDispatchTaskPacket(options: DispatchPromptOptions): DispatchTaskPacket {
  const sharedContextItems = options.collaborationRefs?.length
    ? options.collaborationRefs.map((item) => {
        const roleLabel = item.roleLabel?.trim() || item.roleKey?.trim() || '未标注角色';
        const title = item.title?.trim() || item.sessionId?.trim() || '未知窗口';
        const reason = item.includedReason?.trim() || '共享上下文来源';
        const coordinationLabel = item.coordinationLabel?.trim() || item.coordinationState?.trim() || '未标注状态';
        return `引用窗口：${roleLabel} · ${title}｜纳入原因：${reason}｜当前状态：${coordinationLabel}`;
      })
    : (options.collaborationItems ?? []).map((item, index) => buildWorkspaceSnapshotLine(item, index));
  const dependencyItems = options.dependencyLabels?.length
    ? options.dependencyLabels.map((item) => `依赖窗口：${item}`)
    : ['当前没有显式依赖窗口'];
  const sharedContextModeLabel = options.collaborationMode === 'all_active'
    ? '全部活跃窗口'
    : options.collaborationMode === 'related'
      ? '依赖 + 关键活跃窗口'
      : '仅依赖窗口';

  return {
    sections: [
      {
        title: '任务目标',
        items: [
          `目标角色：${options.role.label}`,
          options.targetSessionTitle ? `目标子窗口：${options.targetSessionTitle}` : '目标子窗口：新建子窗口',
          options.title ? `子任务标题：${options.title}` : '子任务标题：待命任务',
          options.instruction?.trim() || '请先同步当前状态，再等待进一步指令。'
        ]
      },
      {
        title: '边界与约束',
        items: [
          options.projectPath ? `项目目录：${options.projectPath}` : '项目目录：沿用当前工作目录',
          options.scopeHint?.trim() || '保持最小修改，只处理当前任务包范围内的内容，不顺手重构无关模块。'
        ]
      },
      {
        title: '依赖与共享上下文',
        items: [
          ...dependencyItems,
          `共享上下文范围：${sharedContextModeLabel}`,
          ...sharedContextItems.map((item, index) => buildWorkspaceSnapshotLine(item, index))
        ],
        emptyText: '当前不注入额外共享上下文'
      },
      {
        title: '验收与交付',
        items: [
          options.acceptance?.trim() || '完成后先给出计划、当前进度、阻塞点和下一步动作，必要时补最小验证结果。',
          options.deliverable?.trim() || '最终汇报需包含任务摘要、关键修改、验证结果和剩余风险。'
        ]
      }
    ]
  };
}

export function buildDispatchPrompt(options: DispatchPromptOptions) {
  const packet = buildDispatchTaskPacket(options);
  const packetText = packet.sections
    .map((section) => {
      if (!section.items.length) {
        return `【${section.title}】\n${section.emptyText || '无'}`;
      }
      return `【${section.title}】\n${section.items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
    })
    .join('\n\n');

  return [
    '你现在是多 Agent 协作工作台中的一个子窗口，由“架构师主窗口”统一调度。',
    `当前角色职责：${options.role.description}。`,
    packetText,
    options.collaborationSnapshot ? `当前协作快照：\n${options.collaborationSnapshot}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function getWorkspaceRole(roleKey: WorkspaceRoleKey) {
  return WORKSPACE_ROLE_MAP.get(roleKey) ?? WORKSPACE_ROLE_MAP.get('general')!;
}

export function diagnoseBlockedWorkspace(options: {
  blockedReason?: string | null;
  progressHint?: string | null;
  roleKey?: WorkspaceRoleKey | null;
  hasDependencies?: boolean;
}): BlockedDiagnosis {
  const blockedReason = `${options.blockedReason || ''} ${options.progressHint || ''}`.toLowerCase();
  const roleKey = options.roleKey || 'general';

  if (/wsl|环境|权限|安装|依赖包|端口|port|路径|path|node|npm|pnpm|python|pip|sdk|登录|token|密钥/.test(blockedReason)) {
    return {
      key: 'environment',
      label: '环境 / 权限阻塞',
      tone: 'danger',
      description: '更像运行环境、依赖安装、权限或本地执行条件问题，通常先修环境比继续扩派任务更有效。',
      templateKey: 'unblock',
      targetRoleKey: 'developer',
      playbook: [
        '先确认是否是实例环境、依赖安装、权限或端口占用导致无法继续执行。',
        '判断是原地修复环境，还是改派到其他可运行实例更省时间。',
        '如果会影响其他子窗口，先同步“何时恢复可执行”。'
      ],
      draftGoal: '优先解除运行环境或权限问题，让当前任务重新回到可执行状态。',
      draftChecklist: [
        '判断问题属于缺依赖、权限不足、环境未初始化还是实例配置不一致',
        '给出最短修复路径，并说明是否需要切换实例或补充环境准备',
        '评估会影响哪些上下游子窗口，以及是否需要先同步状态'
      ]
    };
  }

  if (/需求|优先级|确认|口径|方案|范围|边界|产品|为什么|目标/.test(blockedReason)) {
    return {
      key: 'requirement',
      label: '需求待确认',
      tone: 'warning',
      description: '当前阻塞更像信息缺口或需求口径未定，先补齐输入比继续编码更重要。',
      templateKey: 'request_info',
      targetRoleKey: 'product',
      playbook: [
        '优先确认缺失的目标、范围或验收口径，避免错误推进。',
        '把必须确认的问题列成清单，而不是泛泛说“需求不清”。',
        '给出一版默认推进方案，便于架构师快速拍板。'
      ],
      draftGoal: '补齐阻塞当前执行所必需的需求信息，并形成可继续推进的统一口径。',
      draftChecklist: [
        '列出阻塞执行的关键待确认问题，避免模糊表述',
        '说明每个问题若不确认会影响什么决策',
        '给出默认假设方案，方便架构师快速选择'
      ]
    };
  }

  if (/依赖|上游|接口|联调|返回|数据源|schema|等待|同步|后端未给|还没好/.test(blockedReason) || options.hasDependencies) {
    return {
      key: 'dependency',
      label: '上游依赖等待',
      tone: 'warning',
      description: '当前更像被上游结果卡住，需要先同步依赖、确认替代输入或调整执行顺序。',
      templateKey: 'unblock',
      targetRoleKey: roleKey === 'product' ? 'developer' : roleKey,
      playbook: [
        '先确认上游依赖是否已有部分结果可复用，不要默认完全等待。',
        '如果上游继续阻塞，评估是否能用 mock、占位方案或拆分子任务先推进。',
        '同步受影响的下游窗口，避免多处重复等待。'
      ],
      draftGoal: '优先解除上游依赖等待，明确可复用结果、替代输入和下游同步顺序。',
      draftChecklist: [
        '确认当前依赖是否已有阶段性结果、接口约定或可替代输入',
        '如果依赖暂时无法完成，给出不阻塞主链路的降级推进方案',
        '明确哪些下游窗口需要同步，以及同步的优先级'
      ]
    };
  }

  if (/测试|复现|验证|回归|冒烟|case|断言|结果不一致/.test(blockedReason)) {
    return {
      key: 'verification',
      label: '验证 / 测试阻塞',
      tone: 'warning',
      description: '当前更像复现、验证口径或测试数据不足导致的阻塞，适合先转给测试视角收敛问题。',
      templateKey: 'unblock',
      targetRoleKey: 'tester',
      playbook: [
        '先确认问题能否稳定复现，避免围绕偶发现象反复派单。',
        '补齐测试步骤、环境和预期结果，再决定是否回退给开发。',
        '如果复现不稳定，优先沉淀最小复现路径。'
      ],
      draftGoal: '先让问题可复现、可验证，再决定是回归、补测试还是转回开发修复。',
      draftChecklist: [
        '确认最小复现步骤、测试环境和预期结果',
        '说明当前无法验证的具体缺口：数据、环境、步骤还是口径',
        '给出下一步是继续测试、补输入还是回交开发的判断'
      ]
    };
  }

  if (/前端|页面|交互|样式|布局|ui|ux|组件|视觉/.test(blockedReason)) {
    return {
      key: 'frontend',
      label: '前端 / 交互阻塞',
      tone: 'warning',
      description: '当前更像页面结构、交互细节或样式问题，适合转给前端角色集中处理。',
      templateKey: 'continue',
      targetRoleKey: 'frontend',
      playbook: [
        '先明确是布局冲突、交互路径不顺，还是视觉反馈缺失。',
        '尽量给出受影响区域和期望行为，而不是笼统说“页面不对”。',
        '如果涉及上下游依赖，先说明哪些接口或状态未就绪。'
      ],
      draftGoal: '优先澄清具体的前端交互问题，并推进一个最小可验证的页面闭环。',
      draftChecklist: [
        '指出受影响页面、组件或交互路径',
        '说明当前行为与期望行为的差异',
        '给出最小修复切片，并说明需要同步哪些状态或接口'
      ]
    };
  }

  if (/文档|说明|记录|沉淀|交付件|手册/.test(blockedReason)) {
    return {
      key: 'documentation',
      label: '文档 / 交付沉淀阻塞',
      tone: 'info',
      description: '当前更像结论、记录或交付材料未整理，适合直接转到文档角色收口。',
      templateKey: 'document',
      targetRoleKey: 'document',
      playbook: [
        '先确认要产出的交付物类型：说明、阶段总结、操作手册还是决策记录。',
        '把现有结论结构化，不要让文档角色重新猜测背景。',
        '沉淀完成后同步回主链路，避免知识只留在消息里。'
      ],
      draftGoal: '把当前阶段结论整理成可交付、可复用的文档材料。',
      draftChecklist: [
        '明确交付物类型和目标读者',
        '按结论、决策、风险、后续动作整理内容',
        '输出后同步给需要继续执行的子窗口'
      ]
    };
  }

  if (/报错|异常|错误|失败|bug|编译|构建|运行|代码|实现|修复|崩溃/.test(blockedReason)) {
    return {
      key: 'implementation',
      label: '实现 / 代码阻塞',
      tone: 'danger',
      description: '当前更像实现过程中的具体技术问题，需要开发视角优先收敛根因和最短修复路径。',
      templateKey: 'unblock',
      targetRoleKey: 'developer',
      playbook: [
        '先定位是实现错误、编译失败还是运行时异常，不要笼统归类为“代码问题”。',
        '优先给出根因假设和最短验证路径，而不是直接扩散更多子任务。',
        '如果影响主链路，先说明修复前能否通过降级方案继续推进。'
      ],
      draftGoal: '优先定位实现类阻塞的根因，并给出最短修复与验证路径。',
      draftChecklist: [
        '确认阻塞属于编译、运行时、逻辑错误还是第三方依赖问题',
        '给出最短验证路径和预期修复结果',
        '说明修复前后对上下游窗口的影响'
      ]
    };
  }

  return {
    key: 'unknown',
    label: '待进一步判断',
    tone: 'info',
    description: '当前阻塞描述仍然偏模糊，建议先补齐信息，再决定派给谁最合适。',
    templateKey: 'unblock',
    targetRoleKey: roleKey === 'product' ? 'developer' : roleKey,
    playbook: [
      '先补充阻塞原因、影响范围和当前尝试过的动作。',
      '如果 1 轮内仍无法判断，再转给更适合的角色收敛问题。',
      '避免在原因不明时继续扩派子任务。'
    ],
    draftGoal: '先把阻塞补充到可判断、可派单的粒度，再决定最短解除路径。',
    draftChecklist: [
      '补充阻塞现象、影响范围和已尝试动作',
      '判断这是信息缺口、依赖等待还是实现问题',
      '最后给出架构师现在可以立刻执行的下一步'
    ]
  };
}
