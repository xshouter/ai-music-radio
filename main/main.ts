// Electron 入口：起内核 → 开一个窗口，把窗口指到内核自己的端口。
// 窗口里加载的是 http://127.0.0.1:<port>/ —— 与 API 同源，所以前端不需要任何 CORS 知识。
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { startRadio, type StartedRadio } from './bootstrap.ts';
import { resolveTtsDir } from './tts-runtime.ts';
import { existsSync } from 'node:fs';
import { neteaseEntry, startNeteaseService, type NeteaseService } from './netease-service.ts';
import { createFileLog, withLogging, type Log } from './log.ts';
import { defaultHttpFetch } from '../core/http.ts';
import type { StreamEvent } from '../shared/api-types.ts';

// 设计画布 616×876：窗口怎么拉，界面都是这一张等比缩放的画布。
const STAGE = { width: 616, height: 876 };
// 1.0：窗口就是那张卡片本身（无边框 + 透明），照设计尺寸 1:1 摆。
const ZOOM = 1;
// 缩小的下限 = 画布的一半（308×438）。默认尺寸就等于画布，所以没有下限时窗口只能放大、不能缩小。
const MIN_ZOOM = 0.5;

let started: StartedRadio | null = null;
// 内置的音乐源服务。null = 这一轮没代管（给了环境变量用外部的，或者落点里没有它）。
let netease: NeteaseService | null = null;
// 现场日志：双击之后出了什么事，事后要能读出来。默认空实现 —— boot() 里才换成真文件。
let log: Log = { line: () => {} };
// 内核的事件顺手记一份：界面上只留最后一条，历史得能回头看。
const logEvent = (event: StreamEvent): void => {
  switch (event.type) {
    case 'error': log.line('error', event.payload.code + ' ' + event.payload.message); break;
    case 'progress': log.line('boot', event.payload.phase + ' ' + event.payload.steps.join(',')); break;
    case 'now': {
      const track = event.payload.track;
      log.line('music', 'now ' + (track === null ? '(nothing)' : track.source + ':' + track.id) + (event.payload.degraded ? ' degraded' : '') + ' onAir=' + event.payload.onAir);
      break;
    }
    case 'say': log.line('music', 'say ' + event.payload.kind + ' ' + event.payload.audioUrl + ' · ' + event.payload.line); break;
    case 'queue': log.line('music', 'queue ' + event.payload.length + ' tracks'); break;
    case 'plan': log.line('boot', 'plan ' + event.payload.blocks.length + ' blocks'); break;
    default: break;
  }
};

const uiDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'ui') : join(app.getAppPath(), 'renderer', 'dist');

// 内置的网易云兼容服务：打包后在 resources/netease，开发时在仓库的 vendor/netease。
// 它本身是纯 JS，没有非 ASCII 的麻烦（不像 piper 要挪窝）。
const neteaseDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'netease') : join(app.getAppPath(), 'vendor', 'netease');

// 首次体验的素材（那一首歌 + 它那段冻结的口播）：打包后在 resources/demo，开发时在仓库的 assets/demo。
const demoDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'demo') : join(app.getAppPath(), 'assets', 'demo');

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
    log = createFileLog(join(userData, 'logs', 'edgerunner.log'));
    log.line('boot', '=== EdgeRunner ' + app.getVersion() + ' · ' + new Date().toISOString() + ' ===');
    log.line('boot', 'packaged=' + String(app.isPackaged) + ' userData=' + userData);
    // 给了地址就用外部的（开发与复测靠它）；没给就把内置那一份拉起来。
    // 拉不起来不是错误：降级链会让电台退到本地源，并把原因挂到界面上。
    const override = process.env.EDGERUNNER_NETEASE_BASE_URL;
    if (override === undefined) {
      const dir = neteaseDir();
      if (existsSync(neteaseEntry(dir))) {
        netease = await startNeteaseService({
          dir,
          warn: (message) => {
            console.warn('[netease] ' + message);
            log.line('warn', 'netease: ' + message);
          },
        }).catch((cause: unknown) => {
          console.warn('[netease] 起不来：' + (cause instanceof Error ? cause.message : String(cause)));
          log.line('warn', 'netease: 起不来：' + (cause instanceof Error ? cause.message : String(cause)));
          return null;
        });
      } else {
        console.warn('[netease] 落点里没有内置服务（' + dir + '）—— 只有本地音乐可用');
        log.line('warn', 'netease: 落点里没有内置服务（' + dir + '）—— 只有本地音乐可用');
      }
    }
    started = await startRadio({
      dataDir: join(userData, 'data'),
      localDir: join(userData, 'music'),
      uiDir: uiDir(),
      ttsDir: ttsDir(),
      demoDir: demoDir(),
      neteaseBaseUrl: override ?? netease?.baseUrl,
      fetch: withLogging(defaultHttpFetch, log),
      warn: (message) => {
        console.warn('[radio] ' + message);
        log.line('warn', 'radio: ' + message);
      },
    });
    // 设置摘要（只记 set / 空，绝不记值）：第 48 条那种「它带了哪些设置」的第一现场。
    started.radio.subscribe(logEvent);
    await started.radio.settings().then((view) => {
      log.line('boot', 'llm ' + view.llm.protocol + ' ' + view.llm.model + ' @ ' + view.llm.baseUrl + ' key=' + (view.llm.apiKeySet ? 'set' : 'EMPTY'));
      log.line('boot', 'tts ' + view.tts.provider + ' ' + view.tts.voice + ' key=' + (view.tts.apiKeySet ? 'set' : 'EMPTY'));
      log.line('boot', 'music ' + view.music.provider + ' cookie=' + (view.music.cookieSet ? 'set' : 'EMPTY'));
    }).catch(() => {});
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
  // 窗口先出生，开机在后台跑：那 14–28s 的进度经 WS 推进界面。
  // 不 await：接口要先能响。开机自己的失败由 core 收成一条横幅，不从这里抛。
  radio.boot().catch((cause: unknown) => {
    console.error('[radio] 开机失败：' + (cause instanceof Error ? cause.message : String(cause)));
    log.line('error', 'boot failed: ' + (cause instanceof Error ? cause.message : String(cause)));
  });
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
    log.line('boot', 'quit');
    netease?.stop();
    void started?.close();
  });
}