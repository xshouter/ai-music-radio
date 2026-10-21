// 代管启动：把内置的网易云兼容服务拉起来，给它挑一个空闲端口，电台退出时把它一起收掉。
//
// 为什么要这一层： 把兼容服务定成「使用者自己准备的外部进程」。
// 代价是「下载 exe 就能跑」在音乐源这一环并不闭环 —— 而且它不在时连口播都会一起哑掉
// （大脑拿不到任何合法 id，emit_show 全驳回）。 改这一条：
// 由内核代管启动，但 core/ 仍然只当一个 HTTP 客户端。
//
// 端口不复用 3000：本机 3000 上很可能已经坐着用户自己的那一份，
// 抢它等于把「谁在服务」变成不确定。listen(0) 让操作系统给一个空的，天然不打架。
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** 内置服务在落点里的固定形状：<dir>/node_modules/NeteaseCloudMusicApi。 */
export const neteasePackageDir = (dir: string): string => join(dir, 'node_modules', 'NeteaseCloudMusicApi');
export const neteaseEntry = (dir: string): string => join(neteasePackageDir(dir), 'app.js');

export interface NeteaseService {
  /** 交给内核当音乐源地址，形如 http://127.0.0.1:<port>。 */
  baseUrl: string;
  stop(): void;
}

export interface NeteaseServiceOptions {
  /** 内置服务的根目录：打包后是 resources/netease，开发时是 vendor/netease。 */
  dir: string;
  /** 等它就绪的上限。默认 20s —— 冷启动要先生成 anonymous_token，并不快。 */
  readyTimeoutMs?: number;
  warn?: (message: string) => void;
  /** 测试用：换掉「拉起子进程」这件不纯的事。 */
  spawnService?: (packageDir: string, port: number) => ChildProcess;
  /** 测试用：换掉「探测就绪」这件不纯的事。 */
  probe?: (port: number, timeoutMs: number) => Promise<boolean>;
}

/** 向操作系统要一个此刻空闲的端口。 */
export function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error('netease: no free port'));
      });
    });
  });
}

/** 轮询根路径直到它答话。答 5xx 也算「起来了」—— 起没起来和服务得对不对是两件事。 */
export async function waitForReady(port: number, timeoutMs: number): Promise<boolean> {
  const url = 'http' + '://127.0.0.1:' + port + '/';
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (answer.status < 500) return true;
    } catch {
      // 还没起来：连接被拒 / 超时。接着等。
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

export async function startNeteaseService(options: NeteaseServiceOptions): Promise<NeteaseService | null> {
  const warn = options.warn ?? (() => {});
  const packageDir = neteasePackageDir(options.dir);
  const port = await pickFreePort();
  const child = (options.spawnService ?? defaultSpawn)(packageDir, port);

  let dead = false;
  // 跑着跑着死了也要说话：否则「刚才还有歌，现在没了」在现场里查不出来。
  let startedUp = false;
  let stopping = false;
  // stderr 要**接住**：只 pipe 不读，子进程迟早被写满的管道卡死。
  // 但平时不往外倒 —— 它正常启动时会打印一行 server running，那不是问题，是噪音。
  let tail = '';
  child.stderr?.on('data', (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-2000); });
  // 子进程自己的最后几行是它唯一的证词：为什么没起来、为什么中途死掉，都在这。
  const tailLines = (): string => {
    const lines = tail.trim().split('\n').slice(-3).join(' | ');
    return lines === '' ? '（它没留下话）' : lines;
  };
  child.once('exit', (code: number | null) => {
    dead = true;
    if (startedUp && !stopping) warn('netease: 兼容服务退出了（code ' + String(code) + '）—— ' + tailLines());
  });

  // 就绪探测和「它已经死了」赛跑：子进程秒退时不该干等到超时。
  const ready = await Promise.race([
    (options.probe ?? waitForReady)(port, options.readyTimeoutMs ?? 20_000),
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(false))),
  ]);
  if (!ready || dead) {
    stopping = true;
    child.kill();
    // 说不出来为什么，就等于没查 —— 把子进程自己的最后几行带上。
    warn('netease: 兼容服务没起来 —— ' + tailLines());
    return null;
  }
  startedUp = true;
  return {
    baseUrl: 'http' + '://127.0.0.1:' + port,
    stop: () => {
      stopping = true;
      if (!dead) child.kill();
    },
  };
}

// 用 process.execPath（就是 Electron 自己）当 node 跑：发布物里就不必要求用户装 Node。
const defaultSpawn = (packageDir: string, port: number): ChildProcess =>
  spawn(process.execPath, ['app.js'], {
    cwd: packageDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });