export interface DesktopBridge {
  getBackendBaseUrl: () => Promise<string>;
  pickDirectory: () => Promise<string | null>;
  openPath: (targetPath: string) => Promise<void>;
  openExternalTerminal: (options?: { cwd?: string; command?: string }) => Promise<void>;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export {};
