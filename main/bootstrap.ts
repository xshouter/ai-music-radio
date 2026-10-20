// 唯一组装点（ADR-0014）：core/ 不认识具体 SQLite 驱动、不认识 Electron，
// 谁来把它们接起来？只有这里。换驱动 / 换 Electron 版本，只动这一个文件。
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRadio, type Radio } from '../core/radio.ts';
import { createRadioServer } from '../core/server.ts';
import { SqliteStore, type SqliteDatabase } from '../core/state/sqlite-store.ts';
import { createTasteRepo } from '../core/taste.ts';
import { DEMO_SONG_FILE, DEMO_WAV_FILE } from '../core/demo.ts';
import type { Clock, EnvProvider } from '../shared/ports.ts';

/** 网易云兼容服务的地址。v1 它由使用者自己准备（ADR-0016）—— 没有它，音乐源只剩本地目录。 */
const DEFAULT_NETEASE_BASE_URL = 'http://127.0.0.1:3000';

export interface BootstrapOptions {
  /** 用户数据目录：库 / 语料 / 口播缓存都在这下面。 */
  dataDir: string;
  /** 本地音乐兜底目录。 */
  localDir: string;
  /** 打包后的 UI 目录（给内核一起发，同源，ADR-0020）。 */
  uiDir: string;
  /** 本地语音运行时目录（含 piper.exe / espeak-ng-data / <voice>.onnx）。纯 ASCII，见 RadioOptions.ttsDir。 */
  ttsDir: string;
  /** 随包发的首次体验素材（打包后 `resources/demo`，开发时 `assets/demo`）。不给 = 没有首次体验。 */
  demoDir?: string;
  /** 覆盖网易云兼容服务地址；默认 localhost:3000。 */
  neteaseBaseUrl?: string;
  warn?: (message: string) => void;
}

export interface StartedRadio {
  radio: Radio;
  port: number;
  token: string;
  /**
   * 开机（排表 → 开场）。**故意不在这里 await**（ADR-0032）：窗口必须先出生，
   * 否则当天第一次开机那 14–28s 屏幕上什么都没有 —— 连进度界面都无从谈起。
   */
  boot(): Promise<void>;
  close(): Promise<void>;
}

export async function startRadio(options: BootstrapOptions): Promise<StartedRadio> {
  const warn = options.warn ?? (() => {});
  for (const dir of [options.dataDir, options.localDir]) mkdirSync(dir, { recursive: true });

  const clock: Clock = { now: () => new Date() };
  // 驱动由这里注入：DatabaseSync 是 node:sqlite 的实现，core/ 只认 SqliteDatabase 这个形状。
  const db = new DatabaseSync(join(options.dataDir, 'edgerunner.sqlite')) as unknown as SqliteDatabase;
  const store = new SqliteStore(db, clock, warn);
  const tasteDir = join(options.dataDir, 'taste');
  const taste = createTasteRepo({ dir: tasteDir, store, clock });
  // v1 没有日历 / 天气接入（ADR-0013）：恒空，但不写死在调度器里。
  const env: EnvProvider = { weather: async () => null, calendar: async () => [] };

  const demo = demoAssets(options.demoDir, options.localDir);

  const radio = createRadio({
    store,
    clock,
    taste,
    env,
    neteaseBaseUrl: options.neteaseBaseUrl ?? DEFAULT_NETEASE_BASE_URL,
    localDir: options.localDir,
    cacheDir: join(options.dataDir, 'cache'),
    tasteDir,
    ttsDir: options.ttsDir,
    ...(demo === undefined ? {} : { demo }),
    warn,
  });

  const token = randomBytes(24).toString('hex');
  const server = createRadioServer({ radio, uiDir: options.uiDir, token, warn });

  // 随机端口 + 只绑 127.0.0.1（ADR-0007：单端，只服务本机）。端口 0 让内核自己挑空的。
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('radio: no port'));
      else resolve(address.port);
    });
  });

  return {
    radio,
    port,
    token,
    boot: () => radio.boot(),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          radio.close();
          resolve();
        });
      }),
  };
}
/**
 * 首次体验的素材（ADR-0033）：随包的一首歌 + 它那段冻结的口播。
 * 歌在首次开机拷进他的曲库（**已存在就不动** —— 他可能自己换过那一首，别把他换的那份踩掉）；
 * 素材缺了返回 undefined：那就当没有这回事，界面回落到原来的「红横幅 + 空电台」。
 */
function demoAssets(dir: string | undefined, localDir: string): { file: string; wav: string } | undefined {
  if (dir === undefined) return undefined;
  const song = join(dir, DEMO_SONG_FILE);
  const wav = join(dir, DEMO_WAV_FILE);
  if (!existsSync(song) || !existsSync(wav)) return undefined;
  const target = join(localDir, DEMO_SONG_FILE);
  if (!existsSync(target)) copyFileSync(song, target);
  return { file: DEMO_SONG_FILE, wav };
}