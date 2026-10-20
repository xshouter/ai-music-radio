// 唯一组装点（ADR-0014）：core/ 不认识具体 SQLite 驱动、不认识 Electron，
// 谁来把它们接起来？只有这里。换驱动 / 换 Electron 版本，只动这一个文件。
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRadio, type Radio } from '../core/radio.ts';
import { createRadioServer } from '../core/server.ts';
import { SqliteStore, type SqliteDatabase } from '../core/state/sqlite-store.ts';
import { createTasteRepo } from '../core/taste.ts';
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