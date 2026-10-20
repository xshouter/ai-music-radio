// Electron 入口：起内核 → 开一个窗口，把窗口指到内核自己的端口。
// 窗口里加载的是 http://127.0.0.1:<port>/ —— 与 API 同源（ADR-0020），所以前端不需要任何 CORS 知识。
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { startRadio, type StartedRadio } from './bootstrap.ts';
import { resolveTtsDir } from './tts-runtime.ts';

// 设计画布 616×876：窗口怎么拉，界面都是这一张等比缩放的画布。
const STAGE = { width: 616, height: 876 };
// 1.0：窗口就是那张卡片本身（无边框 + 透明），照设计尺寸 1:1 摆。
const ZOOM = 1;
// 缩小的下限 = 画布的一半（308×438）。默认尺寸就等于画布，所以没有下限时窗口只能放大、不能缩小。
const MIN_ZOOM = 0.5;

let started: StartedRadio | null = null;

const uiDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'ui') : join(app.getAppPath(), 'renderer', 'dist');

// 离线嗓子：打包后在 resources/piper，开发时在仓库的 vendor/piper。非 ASCII 路径要挪窝（main/tts-runtime.ts）。
const ttsDir = (): string =>
  resolveTtsDir(
    app.isPackaged ? join(process.resourcesPath, 'piper') : join(app.getAppPath(), 'vendor', 'piper'),
    join(app.getPath('userData'), 'tts'),
    join(process.env.ProgramData ?? 'C:\\ProgramData', 'EdgeRunner', 'tts'),
  );

async function boot(): Promise<StartedRadio> {
  if (started === null) {
    const userData = app.getPath('userData');
    started = await startRadio({
      dataDir: join(userData, 'data'),
      localDir: join(userData, 'music'),
      uiDir: uiDir(),
      ttsDir: ttsDir(),
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
    minWidth: Math.round(STAGE.width * MIN_ZOOM),
    minHeight: Math.round(STAGE.height * MIN_ZOOM),
    useContentSize: true,
    // 悬浮的卡片：没有系统边框，窗口底透明 —— 圆角与描边由 .shell 自己画。
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // 令牌经启动参数递给 preload，再由 preload 写成 window.__RADIO__。
      additionalArguments: ['--radio-token=' + radio.token],
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 等比缩放：窗口怎么拉都是 616:876（需求 3.6 第 1 条）。
  win.setAspectRatio(STAGE.width / STAGE.height);
  await win.loadURL('http://127.0.0.1:' + radio.port + '/');
}

// 关窗通道（preload 里的 close）。用 sender 反查窗口，避免重复注册监听。
ipcMain.on('radio:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

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