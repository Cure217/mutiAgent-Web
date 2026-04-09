const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULT_BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:18109';
const DEFAULT_PROJECT_PATH = 'D:\\Project\\ali\\260409';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'mutiAgent 控制台',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: '应用',
      submenu: [
        {
          label: '刷新',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload()
        },
        {
          label: '打开 DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' })
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('desktop:get-backend-base-url', async () => DEFAULT_BACKEND_BASE_URL);

  ipcMain.handle('desktop:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
    if (!targetPath) {
      return;
    }
    await shell.openPath(targetPath);
  });

  ipcMain.handle('desktop:open-external-terminal', async (_event, options = {}) => {
    const cwd = options.cwd || DEFAULT_PROJECT_PATH;
    const command = options.command || '';
    const escapedCwd = String(cwd).replace(/'/g, "''");
    const shellCommand = command
      ? `Set-Location -LiteralPath '${escapedCwd}'; ${command}`
      : `Set-Location -LiteralPath '${escapedCwd}'`;

    spawn(
      'cmd.exe',
      ['/c', 'start', 'powershell.exe', '-NoExit', '-Command', shellCommand],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      }
    ).unref();
  });
}

app.whenReady().then(() => {
  createWindow();
  createMenu();
  registerIpc();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
