import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpokenLine, SpokenWord } from '../shared/domain.ts';
import type { CancelSignal, TtsProvider } from '../shared/ports.ts';

/**
 * 口播合成（4.4）。这一层只做两件事：**合一句**、**把它存下来**。
 *
 * 它不认识 Fish Audio —— 它认的是 TtsProvider 端口（ADR-0008）。换厂商 = 换一个 provider 文件，
 * 这个文件与 UI 一行都不动。
 *
 * 缓存是**内容寻址**的：键 = sha1(providerId + 音色 + 文本)，落 `cache/tts/<hash>.mp3`。
 * 同一句话 + 同一把嗓子 = 同一份文件，重复口播零远端调用。键里带 providerId，
 * 换 provider 不会串到旧缓存（shared/ports.ts 的 TtsProvider 注释）。
 */

/** 合成失败。**可失败的一环**（抽象层第 6 节）：调用方拿到它应当跳掉这句、继续放歌，不许停台。 */
export class TtsFailure extends Error {
  readonly code = 'TTS_FAILED' as const;
  constructor(reason: string) {
    super('TTS 合成失败：' + reason);
    this.name = 'TtsFailure';
  }
}

export interface TtsEngineOptions {
  provider: TtsProvider;
  /** 缓存目录（约定 `cache/tts`）。不存在会自动建。 */
  dir: string;
  /** 口播音频对外的路径前缀，默认 `/tts`。 */
  routePrefix?: string;
  /** 失败重试的间隔（毫秒）。默认 400。测试里调成 0。 */
  retryDelayMs?: number;
}

export interface TtsEngine {
  /** 合一句口播。命中缓存时**不打远端**。失败抛 TtsFailure（已经重试过一次）。 */
  speak(index: number, line: string, voice?: string, signal?: CancelSignal): Promise<SpokenLine>;
  /** server 的 `GET /tts/<hash>.mp3` 用它取字节；key 不合法或没缓存一律给 null。 */
  read(key: string): Uint8Array | null;
  /** 一句口播缓存键（确定性，供 server 之外的地方复用同一个映射）。 */
  keyOf(line: string, voice?: string): string;
  /** 对外路径（`/tts/<key>.mp3`）。 */
  urlOf(key: string): string;
}

const HASH_HEX = 40;
const KEY_RE = /^[0-9a-f]{40}$/;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 逐词时间戳。
 *
 * 音频**总长是真的**（mp3DurationMs 从帧头算出来的），逐词边界**按文本长度比例分配**。
 * 总长与音频同源，所以进度条不会骗人；边界是估算 —— 为什么这么取，见 ADR-0017。
 * 时长未知（<= 0）时退化成「一个覆盖全句的词」（ADR-0012 的兜底形状），UI 自动变成整句高亮。
 */
export function wordsFor(line: string, durationMs: number): SpokenWord[] {
  const words = line.split(' ').filter((word) => word !== '');
  if (words.length === 0) return [];
  if (durationMs <= 0) {
    return [{ text: line, startMs: 0, endMs: Math.max(600, words.length * 220) }];
  }
  // 权重和 mock 同一套：短词至少 0.6，长词封顶 2.4。两边数量级一致，换后端不跳字。
  const weights = words.map((word) => {
    const bare = word.replace(/[^A-Za-z0-9']/g, '').length;
    return Math.max(0.6, Math.min(2.4, bare / 5));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const out: SpokenWord[] = [];
  let acc = 0;
  let at = 0;
  for (let index = 0; index < words.length; index += 1) {
    acc += weights[index] ?? 0;
    const startMs = at;
    // 末词一定收在真实总长上：不能因为四舍五入让音频尾部没有词覆盖。
    at = index === words.length - 1 ? durationMs : Math.round((acc / total) * durationMs);
    out.push({ text: words[index] ?? '', startMs, endMs: at });
  }
  return out;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = [
  [11025, 12000, 8000, 0], // MPEG 2.5
  [0, 0, 0, 0], // 保留
  [22050, 24000, 16000, 0], // MPEG 2
  [44100, 48000, 32000, 0], // MPEG 1
];

const syncsafe = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) & 0x7f) * 0x200000 + ((bytes[at + 1] ?? 0) & 0x7f) * 0x4000 + ((bytes[at + 2] ?? 0) & 0x7f) * 0x80 + ((bytes[at + 3] ?? 0) & 0x7f);

/**
 * mp3 时长（毫秒）。只走帧头，不解码 —— 我们只要一个总长，不要让内核背上解码器。
 * 支持 ID3v2 前缀；认 MPEG1/2/2.5 的 Layer III（TTS 返回的就是这个）。认不出来给 0，由调用方退化。
 */
export function mp3DurationMs(audio: Uint8Array): number {
  let at = 0;
  if (audio.length > 10 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    at = 10 + syncsafe(audio, 6); // 'ID3'：10 字节头 + syncsafe 长度
  }
  let ms = 0;
  while (at + 4 <= audio.length) {
    const b1 = audio[at + 1] ?? 0;
    const b2 = audio[at + 2] ?? 0;
    if (audio[at] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      at += 1; // 同步丢失，逐字节重找
      continue;
    }
    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[(b2 >> 4) & 0x0f] ?? 0;
    const sampleRate = SAMPLE_RATES[version]?.[(b2 >> 2) & 0x03] ?? 0;
    if (layer !== 1 || bitrate === 0 || sampleRate === 0) {
      at += 1;
      continue;
    }
    const padding = (b2 >> 1) & 0x01;
    const frameLength = Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding;
    if (frameLength <= 4) {
      at += 1;
      continue;
    }
    ms += ((version === 3 ? 1152 : 576) / sampleRate) * 1000;
    at += frameLength;
  }
  return Math.round(ms);
}

export function createTtsEngine(options: TtsEngineOptions): TtsEngine {
  const provider = options.provider;
  const dir = options.dir;
  const prefix = (options.routePrefix ?? '/tts').replace(/\/+$/, '');
  const retryDelayMs = options.retryDelayMs ?? 400;

  const keyOf = (line: string, voice = ''): string =>
    createHash('sha1').update(provider.id + '\u0000' + voice + '\u0000' + line).digest('hex').slice(0, HASH_HEX);

  const urlOf = (key: string): string => prefix + '/' + key + '.mp3';

  const synthesize = async (text: string, voice: string, signal?: CancelSignal): Promise<Uint8Array> => {
    let last = '未知错误';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await wait(retryDelayMs);
      try {
        const result = await provider.synthesize({
          text,
          voice,
          format: 'mp3',
          ...(signal === undefined ? {} : { signal }),
        });
        if (result.audio.byteLength > 0) return result.audio;
        last = '远端返回了空音频';
      } catch (cause: unknown) {
        last = cause instanceof Error ? cause.message : String(cause);
      }
    }
    throw new TtsFailure(last);
  };

  return {
    keyOf,
    urlOf,
    async speak(index, line, voice = '', signal) {
      const key = keyOf(line, voice);
      const file = join(dir, key + '.mp3');
      let audio: Uint8Array;
      if (existsSync(file)) {
        audio = readFileSync(file);
      } else {
        audio = await synthesize(line, voice, signal);
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, audio);
      }
      return { index, line, audioUrl: urlOf(key), words: wordsFor(line, mp3DurationMs(audio)) };
    },
    read(key) {
      if (!KEY_RE.test(key)) return null;
      const file = join(dir, key + '.mp3');
      return existsSync(file) ? readFileSync(file) : null;
    },
  };
}