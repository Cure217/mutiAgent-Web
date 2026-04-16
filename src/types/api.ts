export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface PageData<T> {
  items: T[];
  pageNo: number;
  pageSize: number;
  total: number;
}

export interface RuntimeHealth {
  status: string;
  timestamp: string;
  dbPath: string;
  baseDir: string;
  runningProcesses: number;
  attachedClientCount: number;
  observingSessionAttachmentCount: number;
}

export interface RuntimeStatistics {
  instanceCount: number;
  sessionCount: number;
  runningSessionCount: number;
  messageCount: number;
  runningProcessCount: number;
  attachedClientCount: number;
  observingSessionAttachmentCount: number;
}

export interface AppInstance {
  id: string;
  code: string;
  name: string;
  appType: string;
  adapterType: string;
  runtimeEnv: string;
  launchMode: string;
  executablePath?: string | null;
  launchCommand: string;
  argsJson?: string | null;
  workdir?: string | null;
  envJson?: string | null;
  enabled: boolean;
  autoRestart: boolean;
  remark?: string | null;
  lastStartAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemConfig {
  id: string;
  configGroup: string;
  configKey: string;
  valueType: string;
  valueText?: string | null;
  valueJson?: string | null;
  secretRef?: string | null;
  remark?: string | null;
  updatedAt: string;
}

export interface InstanceTestLaunchResult {
  valid: boolean;
  adapterType: string;
  command: string[];
  executable: string;
  resolvedExecutable?: string | null;
  workingDirectory?: string | null;
  environmentKeys: string[];
  warnings: string[];
}

export interface AiSession {
  id: string;
  appInstanceId: string;
  title: string;
  projectPath?: string | null;
  projectPathLinux?: string | null;
  status: string;
  interactionMode: string;
  pid?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  lastMessageAt?: string | null;
  exitCode?: number | null;
  exitReason?: string | null;
  rawLogPath?: string | null;
  summary?: string | null;
  tagsJson?: string | null;
  extraJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSharedContextRef {
  sessionId?: string | null;
  roleKey?: string | null;
  roleLabel?: string | null;
  title?: string | null;
  coordinationState?: string | null;
  coordinationLabel?: string | null;
  progressHint?: string | null;
  includedReason?: string | null;
  lastActiveAt?: string | null;
  lastActiveText?: string | null;
}

export interface SessionWorkspaceMeta {
  workspaceKind?: string | null;
  role?: string | null;
  coordinationStatus?: string | null;
  progressSummary?: string | null;
  blockedReason?: string | null;
  dependencySessionIds?: string[] | null;
  sharedContextSummary?: string | null;
  sharedContextRefs?: SessionSharedContextRef[] | null;
  taskScope?: string | null;
  acceptanceCriteria?: string | null;
  deliverableSpec?: string | null;
  sharedContextMode?: string | null;
  sharedContextLimit?: number | null;
  updatedAt?: string | null;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  seqNo: number;
  role: string;
  messageType: string;
  contentText?: string | null;
  contentJson?: string | null;
  rawChunk?: string | null;
  isStructured?: boolean;
  sourceAdapter?: string | null;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
}

export interface SessionTimelineItem {
  itemId: string;
  sessionId: string;
  messageId?: string | null;
  seqNo?: number | null;
  itemType: string;
  eventType: string;
  title: string;
  role?: string | null;
  messageType?: string | null;
  content?: string | null;
  createdAt: string;
}

export interface HistorySearchSessionHit {
  sessionId: string;
  title: string;
  appInstanceId: string;
  appType: string;
  instanceName?: string | null;
  projectPath?: string | null;
  status: string;
  interactionMode: string;
  createdAt: string;
  lastMessageAt?: string | null;
  summary?: string | null;
  matchedMessageText?: string | null;
  matchedText?: string | null;
  matchedSource?: string | null;
}

export interface HistorySearchMessageHit {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  appInstanceId: string;
  appType: string;
  instanceName?: string | null;
  projectPath?: string | null;
  seqNo?: number | null;
  role: string;
  messageType: string;
  snippet?: string | null;
  createdAt: string;
}

export interface HistorySearchResult {
  sessions: PageData<HistorySearchSessionHit>;
  messages: PageData<HistorySearchMessageHit>;
}

export interface OperationLogRecord {
  id: string;
  targetType: string;
  targetId?: string | null;
  action: string;
  result: string;
  operatorName: string;
  detailJson?: string | null;
  createdAt: string;
}

export interface SessionEventEnvelope<T = Record<string, unknown>> {
  event: string;
  sessionId: string;
  timestamp: string;
  payload: T;
}
