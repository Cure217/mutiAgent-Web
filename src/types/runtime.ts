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

export interface ProcessInfo {
  sessionId: string;
  pid: number;
  rawLogPath: string;
  startedAt: string;
  command: string[];
}
