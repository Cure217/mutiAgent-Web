const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  getBackendBaseUrl: () => ipcRenderer.invoke('desktop:get-backend-base-url'),
  pickDirectory: () => ipcRenderer.invoke('desktop:pick-directory'),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  openExternalTerminal: (options) => ipcRenderer.invoke('desktop:open-external-terminal', options)
});
