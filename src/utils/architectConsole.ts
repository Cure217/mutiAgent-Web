import type { AiSession, AppInstance, SessionWorkspaceMeta } from '@/types/api';

export type WorkspaceRoleKey = 'general' | 'developer' | 'frontend' | 'tester' | 'product' | 'document';
export type CoordinationTone = 'info' | 'primary' | 'warning' | 'success' | 'danger';
export type CoordinationState = 'assigned' | 'running' | 'blocked' | 'completed' | 'closed';

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
  targetSessionTitle?: string;
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
  if (session.status === 'COMPLETED' && explicitState?.state !== 'completed') {
    return { state: 'closed' as const, label: '已关闭', tone: 'info' as const };
  }
  if (explicitState) {
    return explicitState;
  }
  switch (session.status) {
    case 'STARTING':
      return { state: 'assigned' as const, label: '启动中', tone: 'warning' as const };
    case 'RUNNING':
      return { state: 'running' as const, label: '执行中', tone: 'primary' as const };
    case 'COMPLETED':
      return { state: 'completed' as const, label: '已完成', tone: 'success' as const };
    default:
      return { state: 'assigned' as const, label: '待处理', tone: 'info' as const };
  }
}

function buildProgressHint(session: AiSession, workspaceMeta: SessionWorkspaceMeta) {
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

export function buildCollaborationSnapshot(
  items: AgentWorkspaceSummary[],
  currentSessionId?: string | null,
  dependencyIds: string[] = []
) {
  const normalizedDependencyIds = new Set(dependencyIds.filter(Boolean));
  const filtered = items.filter((item) => item.id !== currentSessionId);
  const relevantItems = normalizedDependencyIds.size > 0
    ? filtered.filter((item) => normalizedDependencyIds.has(item.id))
    : filtered;

  if (!relevantItems.length) {
    return '当前暂无其他子窗口需要同步，你可以专注处理当前任务，但仍需及时汇报阻塞与完成状态。';
  }

  return relevantItems
    .slice(0, 8)
    .map((item, index) => {
      const dependencyText = item.dependencyLabels.length ? item.dependencyLabels.join('、') : '无';
      return `${index + 1}. [${item.role.label}] ${item.title}｜状态：${item.coordinationLabel}｜最近进展：${item.progressHint}｜依赖：${dependencyText}｜最后活跃：${item.lastActiveText}`;
    })
    .join('\n');
}

export function buildDispatchPrompt(options: DispatchPromptOptions) {
  const dependencyText = options.dependencyLabels?.length
    ? options.dependencyLabels.join('、')
    : '当前没有显式依赖，但需要持续感知其他 Agent 的关键进度';

  return [
    '你现在是多 Agent 协作工作台中的一个子窗口，由“架构师主窗口”统一调度。',
    `当前角色：${options.role.label}。职责边界：${options.role.description}。`,
    options.targetSessionTitle ? `目标子窗口：${options.targetSessionTitle}` : '',
    options.title ? `当前子任务：${options.title}` : '',
    options.projectPath ? `项目路径：${options.projectPath}` : '',
    `上下游依赖：${dependencyText}。`,
    '执行要求：先确认你理解的目标与边界，再给出计划、当前进度、阻塞点和下一步动作。',
    options.instruction ? `本次架构师指令：\n${options.instruction.trim()}` : '',
    options.collaborationSnapshot ? `当前协作快照：\n${options.collaborationSnapshot}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function getWorkspaceRole(roleKey: WorkspaceRoleKey) {
  return WORKSPACE_ROLE_MAP.get(roleKey) ?? WORKSPACE_ROLE_MAP.get('general')!;
}
