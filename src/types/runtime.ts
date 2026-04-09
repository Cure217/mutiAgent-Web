export interface RuntimeHealth {
  status: string;
  timestamp: string;
  dbPath: string;
  baseDir: string;
  runningProcesses: number;
}

export interface RuntimeStatistics {
  instanceCount: number;
  sessionCount: number;
  runningSessionCount: number;
  messageCount: number;
  runningProcessCount: number;
}

export interface ProcessInfo {
  sessionId: string;
  pid: number;
  rawLogPath: string;
  startedAt: string;
  command: string[];
}
