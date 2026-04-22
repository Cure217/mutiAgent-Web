export interface RuntimeHealth {
  status: string;
  timestamp: string;
  startedAt?: string | null;
  readyAt?: string | null;
  uptimeMs?: number | null;
  dbPath: string;
  baseDir: string;
  runtimeDir?: string | null;
  appLogPath?: string | null;
  runningProcesses: number;
  attachedClientCount: number;
  observingSessionAttachmentCount: number;
  recentLifecycleEvents?: RuntimeLifecycleEventInfo[];
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

export interface RuntimeAttachmentInfo {
  transportSessionId: string;
  clientId: string;
  connectedAt: string;
  lastHeartbeatAt: string;
  observedTargetType?: string | null;
  observedTargetId?: string | null;
  userAgent?: string | null;
  remoteAddress?: string | null;
}

export interface RuntimeLifecycleEventInfo {
  type: string;
  observedAt: string;
  sessionId?: string | null;
  status?: string | null;
  exitCode?: number | null;
  exitReason?: string | null;
  message?: string | null;
}

export interface ProcessInfo {
  sessionId: string;
  pid: number;
  rawLogPath: string;
  startedAt: string;
  command: string[];
}
