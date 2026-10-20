// Electron 入口：起内核 → 开一个窗口，把窗口指到内核自己的端口。
// 窗口里加载的是 http://127.0.0.1:<port>/ —— 与 API 同源（ADR-0020），所以前端不需要任何 CORS 知识。
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { startRadio, type StartedRadio } from './bootstrap.ts';

// 设计画布 616×876 的 1.5 倍：整数倍缩放最清晰，窗口怎么拉界面都等比。
const STAGE = { width: 616, height: 876 };
const ZOOM = 1.5;

let started: StartedRadio | null = null;

const uiDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'ui') : join(app.getAppPath(), 'renderer', 'dist');

async function boot(): Promise<StartedRadio> {
  if (started === null) {
    const userData = app.getPath('userData');
    started = await startRadio({
      dataDir: join(userData, 'data'),
      localDir: join(userData, 'music'),
      uiDir: uiDir(),
      neteaseBaseUrl: process.env.EDGERUNNER_NETEASE_BASE_URL,
      warn: (message) => console.warn('[radio] ' + message),
    });
  }
  return started;
}

async function openWindow(): Promise<void> {
  const radio = await boot();
  const win = new BrowserWindow({
    width: Math.round(STAGE.width * ZOOM),
    height: Math.round(STAGE.height * ZOOM),
    minWidth: STAGE.width,
    minHeight: STAGE.height,
    useContentSize: true,
    backgroundColor: '#050506',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // 令牌经启动参数递给 preload，再由 preload 写成 window.__RADIO__。
      additionalArguments: ['--radio-token=' + radio.token],
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL('http://127.0.0.1:' + radio.port + '/');
}

// 单实例：第二个进程直接唤起已有窗口，而不是再起一台电台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win !== undefined) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(openWindow).catch((error: unknown) => {
    console.error(error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    void started?.close();
  });
}