const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:18109';
const PACKAGED_BACKEND_HOST = '127.0.0.1';
const PACKAGED_BACKEND_PORT = Number.parseInt(process.env.MUTI_AGENT_DESKTOP_BACKEND_PORT || '18119', 10);
const PACKAGED_BACKEND_START_TIMEOUT_MS = 30000;
const PACKAGED_BACKEND_POLL_INTERVAL_MS = 500;
const BACKEND_BOOTSTRAP_LOG_NAME = 'desktop-backend-bootstrap.log';
const WINDOWS_APP_USER_MODEL_ID = 'com.aliano.mutiagent.console';

let mainWindow = null;
let backendBaseUrlPromise = Promise.resolve(DEFAULT_BACKEND_BASE_URL);
let managedBackendChild = null;
let managedBackendOwnedByApp = false;
let managedBackendStopRequested = false;

function resolveWindowIconPath() {
  const assetDir = path.join(__dirname, '..', 'assets');
  for (const fileName of ['app-icon.ico', 'app-icon.png']) {
    const iconPath = path.join(assetDir, fileName);
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }
  return undefined;
}

function resolveDefaultProjectPath() {
  try {
    return app.getPath('home');
  } catch {
    return process.env.USERPROFILE || process.env.HOME || process.cwd();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'mutiAgent 控制台',
    backgroundColor: '#0f172a',
    show: false,
    icon: resolveWindowIconPath(),
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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    appendBootstrapLog(`renderer failed to load: code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    appendBootstrapLog(`renderer loaded: ${mainWindow?.webContents.getURL() || 'unknown'}`);
  });

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

function resolveBundledResourcePath(...segments) {
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', '.desktop-bundle');
  return path.join(resourceRoot, ...segments);
}

function resolveBundledBackendArtifacts() {
  const javaExecutable = resolveBundledResourcePath('java-runtime', 'bin', 'java.exe');
  const backendJar = resolveBundledResourcePath('backend', 'mutiAgent.jar');
  if (!fs.existsSync(javaExecutable) || !fs.existsSync(backendJar)) {
    return null;
  }
  return {
    javaExecutable,
    backendJar
  };
}

function getPackagedBackendBaseUrl() {
  return `http://${PACKAGED_BACKEND_HOST}:${PACKAGED_BACKEND_PORT}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendBootstrapLog(message) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, BACKEND_BOOTSTRAP_LOG_NAME),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8'
    );
  } catch {
  }
}

function readJson(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: raw
        });
      });
    });

    request.on('error', () => {
      resolve({
        statusCode: 0,
        body: ''
      });
    });

    request.setTimeout(3000, () => {
      request.destroy();
      resolve({
        statusCode: 0,
        body: ''
      });
    });
  });
}

async function isBackendHealthy(baseUrl) {
  const response = await readJson(`${baseUrl}/actuator/health`);
  if (response.statusCode !== 200) {
    return false;
  }

  try {
    const payload = JSON.parse(response.body);
    return payload.status === 'UP';
  } catch {
    return false;
  }
}

async function waitForBackendHealthy(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isBackendHealthy(baseUrl)) {
      return true;
    }
    await sleep(PACKAGED_BACKEND_POLL_INTERVAL_MS);
  }
  return false;
}

function attachBackendLogStream(stream, level) {
  if (!stream) {
    return () => '';
  }

  let tail = '';
  stream.on('data', (chunk) => {
    const text = String(chunk);
    tail = `${tail}${text}`.slice(-4000);
    const message = text.trim();
    if (!message) {
      return;
    }
    if (level === 'error') {
      appendBootstrapLog(`[bundled-backend][stderr] ${message}`);
      console.error(`[bundled-backend] ${message}`);
    } else {
      appendBootstrapLog(`[bundled-backend][stdout] ${message}`);
      console.log(`[bundled-backend] ${message}`);
    }
  });
  return () => tail.trim();
}

function stopManagedBackend() {
  if (!managedBackendOwnedByApp || !managedBackendChild?.pid) {
    return;
  }

  managedBackendStopRequested = true;
  const child = managedBackendChild;
  const pid = child.pid;
  managedBackendChild = null;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    }).unref();
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
  }
}

function spawnManagedBackend(artifacts) {
  return new Promise((resolve, reject) => {
    const storageBaseDir = path.join(app.getPath('userData'), 'backend-data');
    fs.mkdirSync(storageBaseDir, { recursive: true });

    managedBackendStopRequested = false;

    const child = spawn(
      artifacts.javaExecutable,
      [
        '-Dfile.encoding=UTF-8',
        '-jar',
        artifacts.backendJar,
        `--server.address=${PACKAGED_BACKEND_HOST}`,
        `--server.port=${PACKAGED_BACKEND_PORT}`,
        `--muti-agent.storage.base-dir=${storageBaseDir}`
      ],
      {
        cwd: path.dirname(artifacts.backendJar),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    managedBackendChild = child;
    managedBackendOwnedByApp = true;
    appendBootstrapLog(`spawn bundled backend: java=${artifacts.javaExecutable}, jar=${artifacts.backendJar}, port=${PACKAGED_BACKEND_PORT}, userData=${app.getPath('userData')}`);

    const getStdoutTail = attachBackendLogStream(child.stdout, 'info');
    const getStderrTail = attachBackendLogStream(child.stderr, 'error');
    let settled = false;

    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      managedBackendChild = null;
      managedBackendOwnedByApp = false;
      appendBootstrapLog(`bundled backend spawn error: ${error.message}`);
      reject(error);
    });

    child.once('exit', (code) => {
      if (managedBackendChild?.pid === child.pid) {
        managedBackendChild = null;
      }

      if (settled || managedBackendStopRequested) {
        return;
      }

      settled = true;
      managedBackendOwnedByApp = false;
      const logTail = [getStdoutTail(), getStderrTail()].filter(Boolean).join('\n');
      appendBootstrapLog(`bundled backend exited early: code=${code ?? 'unknown'}${logTail ? `\n${logTail}` : ''}`);
      reject(new Error(
        `桌面版内置后端启动后提前退出，exitCode=${code ?? 'unknown'}${logTail ? `\n${logTail}` : ''}`
      ));
    });

    resolve({
      getLogTail: () => [getStdoutTail(), getStderrTail()].filter(Boolean).join('\n')
    });
  });
}

async function ensurePackagedBackend() {
  if (process.env.BACKEND_BASE_URL) {
    return DEFAULT_BACKEND_BASE_URL;
  }

  const artifacts = resolveBundledBackendArtifacts();
  if (!artifacts) {
    appendBootstrapLog(`bundled backend artifacts missing, fallback to default backend url ${DEFAULT_BACKEND_BASE_URL}`);
    return DEFAULT_BACKEND_BASE_URL;
  }

  const baseUrl = getPackagedBackendBaseUrl();
  if (await isBackendHealthy(baseUrl)) {
    appendBootstrapLog(`bundled backend health already available at ${baseUrl}`);
    return baseUrl;
  }

  const backendHandle = await spawnManagedBackend(artifacts);
  const healthy = await waitForBackendHealthy(baseUrl, PACKAGED_BACKEND_START_TIMEOUT_MS);
  if (healthy) {
    appendBootstrapLog(`bundled backend healthy at ${baseUrl}`);
    return baseUrl;
  }

  const logTail = backendHandle.getLogTail();
  appendBootstrapLog(`bundled backend start timeout at ${baseUrl}${logTail ? `\n${logTail}` : ''}`);
  stopManagedBackend();
  throw new Error(`桌面版内置后端未在 ${PACKAGED_BACKEND_START_TIMEOUT_MS}ms 内完成启动${logTail ? `\n${logTail}` : ''}`);
}

async function initializeBackendBaseUrl() {
  if (!app.isPackaged) {
    return DEFAULT_BACKEND_BASE_URL;
  }

  try {
    return await ensurePackagedBackend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendBootstrapLog(`initialize backend failed: ${message}`);
    console.error('[desktop-backend] startup failed', error);
    dialog.showErrorBox('内置后端启动失败', `${message}\n\n将回退到默认后端地址：${DEFAULT_BACKEND_BASE_URL}`);
    return DEFAULT_BACKEND_BASE_URL;
  }
}

function registerIpc() {
  ipcMain.handle('desktop:get-backend-base-url', async () => backendBaseUrlPromise);

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
    const cwd = options.cwd || resolveDefaultProjectPath();
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

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

  registerIpc();
  backendBaseUrlPromise = initializeBackendBaseUrl();
  await backendBaseUrlPromise;

  createWindow();
  createMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopManagedBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
