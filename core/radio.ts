import { createHash, randomUUID } from 'node:crypto';
import type { Clock, EnvProvider, LlmProvider, PrefMap, Store, TasteRepo, TtsProvider } from '../shared/ports.ts';
import type { DayPlan, DjMessage, DjState, PlayEvent, QualityLevel, Show, SpokenLine, Track, TrackRef } from '../shared/domain.ts';
import type {
  BootStep, ErrorCode, FavoriteAction, NowPlaying, PlaybackReport, SettingsInput, SettingsView, StreamEvent, TasteDoc,
} from '../shared/api-types.ts';
import { defaultHttpFetch, getJson, HttpError, type HttpFetch } from './http.ts';
import { ToolLoopBrain, type ToolStep } from './brain/index.ts';
import { createMusicSourceChain } from './music/index.ts';
import { createNeteaseSource } from './music/netease.ts';
import { createLocalSource } from './music/local.ts';
import { createOpenAiLlm } from './providers/llm-openai.ts';
import { createAnthropicLlm } from './providers/llm-anthropic.ts';
import { createFileTts } from './providers/tts-file.ts';
import { createFishTts } from './providers/tts-fish.ts';
import { createPiperTts } from './providers/tts-piper.ts';
import { DEMO_LINE } from './demo.ts';
import { createTtsEngine, wordsFor, TtsFailure } from './tts.ts';
import { buildTasteFromLibrary } from './taste.ts';
import { DEFAULT_PREFS, PREF_KEYS } from './state/prefs.ts';
import { localDateKey } from './prompt.ts';
import { buildDayPlan, type PlanCurator } from './plan.ts';

/**
 * 电台本身（4.5 的调度部分）。server.ts 只做"把 HTTP/WS 翻译成对它的调用"。
 *
 * 它拥有三样只有一处能拥有的东西：
 * - **当前状态**：现在放的是哪首、DJ 在不在说话、队列是什么。UI 读它，不读别的。
 * - **provider 的组装**：设置一变就重建大脑 / 嗓子 / 音源（generation）。key 只在这里流进 provider。
 * - **事件扇出**：WS 的六种事件只从这里出，server 只管往 socket 上写。
 *
 * 播放权威在客户端：用户切歌由客户端自己切，再 POST /api/playback 报事实；
 * 而"一首歌自然放完"由**这里**推进（客户端不猜下一首该放什么）。
 */

/** 统一失败。code 取自封闭枚举（shared/api-types.ts）。 */
export class RadioFailure extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'RadioFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * LLM 上游 HTTP 状态 → 封闭枚举里的真话（core/http.ts:48 那句注释欠的账）：
 * 401/403 是 **key 不被接受**（用户要去做的事和"没配 key"是同一件：开 LOGIN 换一个），
 * 429 是 **被限流**（等着就行）。其余按"上游坏了"算 INTERNAL —— 词表就这么大，没有第七个码。
 */
const llmFailureCode = (status: number): ErrorCode =>
  status === 401 || status === 403 ? 'NO_LLM_KEY' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL';

/**
 * 上游自己那句话是唯一能指路的证据：同样是 401，「key 不对」和「baseUrl 指错了服务」
 * 在上游眼里是两种不同的报错，用户要改的东西也不同。但它可能是一整页 HTML，
 * 所以先压成一行再截断 —— 报错不该把整份响应灌进聊天窗口。
 */
const describeHttp = (error: HttpError): string =>
  error.detail.trim() === ''
    ? error.message
    : error.message + ' — ' + error.detail.replace(/\s+/g, ' ').trim().slice(0, 200);

export interface RadioOptions {
  store: Store;
  clock: Clock;
  taste: TasteRepo;
  env: EnvProvider;
  /** 网易云兼容服务的地址。没有它，音乐源只剩本地目录。 */
  neteaseBaseUrl: string;
  /** 本地音乐兜底目录。 */
  localDir: string;
  /** 口播缓存目录（cache/tts）。 */
  cacheDir: string;
  /** 语料目录（`taste.md` 落在这里）。与 createTasteRepo 的 dir 是同一个。 */
  tasteDir: string;
  /**
   * 本地语音运行时目录：里面有 piper.exe、espeak-ng-data/ 和 <voice>.onnx。
   * 组装层必须保证它是**纯 ASCII** —— piper 用 fopen 读自己的数据目录，非 ASCII 路径直接崩（实测）。
   */
  ttsDir: string;
  /**
   * 首次体验的两件东西：随包的那首歌的文件名，和它那段**冻结**口播的音频文件。
   * 组装层负责把歌拷进 localDir、把 wav 的绝对路径递进来 —— 内核只管讲故事。不给 = 没有首次体验。
   */
  demo?: { file: string; wav: string };
  fetch?: HttpFetch;
  warn?: (message: string) => void;
}

export interface Radio {
  subscribe(send: (event: StreamEvent) => void): () => void;
  boot(): Promise<void>;
  now(): NowPlaying;
  queue(): readonly TrackRef[];
  favorites(): Promise<TrackRef[]>;
  taste(): Promise<TasteDoc>;
  stats(since?: string): Promise<{ played: number; skipped: number; replays: number; topArtists: { artist: string; count: number }[] }>;
  history(limit?: number): Promise<DjMessage[]>;
  planToday(): Promise<DayPlan | null>;
  regeneratePlan(reason?: string): Promise<DayPlan>;
  settings(): Promise<SettingsView>;
  /**
   * 那个端点认识哪些模型（OpenAI 兼容的 `GET {baseUrl}/models`）。设置界面的下拉框靠它 ——
   * 手打模型名是那一页最容易拼错的一格。`apiKey` 缺省用库里存的那把（明文只用一次，不落任何地方）。
   */
  models(input: { baseUrl: string; apiKey?: string }): Promise<string[]>;
  saveSettings(input: SettingsInput): Promise<SettingsView>;
  chat(text: string): Promise<Show>;
  playback(report: PlaybackReport): Promise<void>;
  feedback(songId: string, action: FavoriteAction): Promise<void>;
  resolveAudio(songId: string, level?: QualityLevel): Promise<string>;
  ttsAudio(key: string): Uint8Array | null;
  close(): void;
}

interface Deps {
  prefs: PrefMap;
  tts: ReturnType<typeof createTtsEngine>;
  /**
   * 首次体验那一段口播的嗓子：**读随包的音频文件**，与用户配的供应商无关。
   * 没有 demo 时是 null —— 别的路径碰不到它。
   */
  demoTts: ReturnType<typeof createTtsEngine> | null;
  music: ReturnType<typeof createMusicSourceChain>;
  brain: ToolLoopBrain;
  /** 口味画像要用它写一份 md，所以它也在这里（不是给大脑用的那条路）。 */
  llm: LlmProvider;
}

/**
 * 嗓子（TTS）的选择只有这一处 —— 「换厂商 = 换一个 provider 文件」。
 *
 * piper 是默认：离线、零 key、打进包里就有声音。
 * fish 走 HTTP：`baseUrl` 指托管端点，或指自己跑的 fish-speech（同一个 `POST /v1/tts`）。
 */
function ttsProviderFor(prefs: PrefMap, ttsDir: string, http: HttpFetch): TtsProvider {
  // fish 走 HTTP，**要一把 key 才算数**：选了 fish 却没填 key 就等于没选。
  // 这时落到 piper（离线、随包），否则用户看到的是「有字没声」——而他永远等不到远端的那一声。
  if (prefs['tts.provider'] === 'fish' && prefs['tts.apiKey'] !== '') {
    return createFishTts({ apiKey: prefs['tts.apiKey'], baseUrl: prefs['tts.baseUrl'], fetch: http });
  }
  return createPiperTts({ dir: ttsDir });
}

/**
 * 工具名 → 进度步骤。**这是一层翻译，不是契约**：契约里的 BootStep 是 UX 概念，
 * 工具改名不该动它；反过来，前端也不该认识工具名。
 */
const bootStepOf = (tool: string): BootStep | undefined => {
  switch (tool) {
    case 'daily_recommend': return 'daily-pool';
    case 'recent_plays': return 'recent-plays';
    case 'search_tracks': return 'deep-search';
    case 'emit_plan': return 'draft-plan';
    case 'emit_show': return 'opening-line';
    default: return undefined;
  }
};

const clampLimit = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw)) return 50;
  return Math.max(1, Math.min(200, Math.floor(raw)));
};

/** 找首次体验那首歌时扫曲库的上限。本地目录就一屏的体量，这个数只是别让一次 listing 失控。 */
const DEMO_SCAN = 200;

export function createRadio(options: RadioOptions): Radio {

  const { store, clock, taste, env } = options;
  const http = options.fetch ?? defaultHttpFetch;
  const warn = options.warn ?? (() => {});

  // 只有这里知道"一首歌长什么样"：工具结果里带完整 Track，捡下来当小目录用。
  // 不是歌曲表（v1 没有 songs 表），是这一阵子见过的东西 —— 够给 TrackRef 补 title/artist/source。
  const catalog = new Map<string, Track>();
  const levels = new Map<string, QualityLevel>();
  const subscribers = new Set<(event: StreamEvent) => void>();

  let current: Track | null = null;
  let startedAt: string | null = null;
  let djState: DjState = 'idle';
  let onAir = false;
  let queueRefs: readonly TrackRef[] = [];
  // 预生成、压着还没说的那几句：按**曲目 id** 挂，不按下标 —— 用户点某一首跳过去时下标会错位。
  let heldSay = new Map<string, string>();
  let deps: Deps | null = null;
  let signature = '';
  // 音乐链喊过几回"源全都不可达"。**单调计数**而不是布尔：归因只问"这一段里涨没涨"，
  // 免得一次偶发失败把后面所有无关的失败都算到音乐源头上。
  let sourceFailures = 0;
  // 最近一次还没被"好的一轮"抵掉或没被用户 DISMISS 的失败。
  // 它存在的理由只有一个：**开场失败是在窗口存在之前发的**（main 先 boot 再建窗），
  // 那条事件当时一个订阅者都没有 —— 快照得把它带上，否则用户什么都听不见。
  let lastError: Extract<StreamEvent, { type: 'error' }>['payload'] | null = null;

  const emit = (event: StreamEvent): void => {
    for (const send of subscribers) {
      try {
        send(event);
      } catch {
        subscribers.delete(send);
      }
    }
  };
  const emitState = (): void => emit({ type: 'state', payload: { onAir, djState } });

  // —— 开机进度：只在 boot() 这一段里发光，别的时候一条都不发 ——
  // 载荷带的是**累积**的 steps：晚连上的窗口补一条就对齐，不用重放事件。
  let booting = false;
  let bootSteps: BootStep[] = [];
  const emitProgress = (phase: 'running' | 'done'): void => {
    emit({ type: 'progress', payload: { phase, steps: [...bootSteps] } });
  };
  const pushStep = (step: BootStep): void => {
    if (!booting || bootSteps.includes(step)) return;
    bootSteps.push(step);
    emitProgress('running');
  };
  // 只有「真的发过 running」才需要一句 done —— 当天已有日表时一个步骤都没有，
  // 那时发 done 会让界面闪一下（需求 Q1）。
  const endBoot = (): void => {
    if (!booting) return;
    booting = false;
    if (bootSteps.length > 0) emitProgress('done');
  };
  const emitError = (code: ErrorCode, message: string, retryable: boolean): void => {
    lastError = { code, message, retryable };
    emit({ type: 'error', payload: lastError });
  };

  /**
   * 给一次失败定名。三档，按"谁更该被怪"排：
   * 1. 上游 HTTP 的错说它自己的样子（key 被拒 / 被限流）；
   * 2. 这一段里音乐源喊过"不可达" → 报源不可达。链把"源不在"收拾成空结果，
   *    用户那边看到的就是"电台死了还不说话" —— UI 上那句人话就是为它写的；
   * 3. 其余才落到笼统的 INTERNAL。
   */
  const nameFailure = (cause: unknown, sourceDown: boolean): RadioFailure => {
    if (cause instanceof RadioFailure) return cause;
    if (cause instanceof HttpError) {
      const code = llmFailureCode(cause.status);
      return new RadioFailure(code, describeHttp(cause), code !== 'NO_LLM_KEY');
    }
    if (sourceDown) return new RadioFailure('MUSIC_SOURCE_UNREACHABLE', 'The music source did not answer.', true);
    return new RadioFailure('INTERNAL', cause instanceof Error ? cause.message : String(cause), true);
  };

  const nowPlaying = (): NowPlaying => ({
    track: current,
    startedAt,
    djState,
    onAir,
    // 推断而不是记一个"我降级了"的布尔（core-music 需求·假设 3）：队列里只剩本地源才算降级。
    degraded: queueRefs.length > 0 && queueRefs.every((ref) => catalog.get(ref.id)?.source === 'local'),
  });

  const readPrefs = async (): Promise<PrefMap> => {
    const out: PrefMap = { ...DEFAULT_PREFS };
    // 值的类型在 key 上是联合，逐 key 赋不进去：过一层 Record 只是让循环写得下来，
    // 真正的校验在 core/state/prefs.ts 的 parsePref（读）与 saveSettings（写）。
    const bag = out as unknown as Record<string, string>;
    for (const key of PREF_KEYS) {
      const raw = await Promise.resolve(store.getPref(key)).catch(() => null);
      if (raw !== null) bag[key] = raw;
    }
    return out;
  };

  const harvest = (step: ToolStep): void => {
    const bootStep = bootStepOf(step.tool);
    if (bootStep !== undefined) pushStep(bootStep);
    // 工具结果是 { tracks: [...] }，不是裸数组 —— 只看 tracks，不然 catalog 永远是空的。
    const tracks = (step.result as { tracks?: unknown } | null)?.tracks;
    if (!Array.isArray(tracks)) return;
    for (const item of tracks) {
      if (item !== null && typeof item === 'object') {
        const track = item as Track;
        if (typeof track.id === 'string' && typeof track.title === 'string' && typeof track.source === 'string') {
          catalog.set(track.id, track);
        }
      }
    }
  };

  // 设置一变就重建：这就是"填了 key 立刻生效"，也是 key 唯一流进 provider 的地方。
  const providers = async (): Promise<Deps> => {
    const prefs = await readPrefs();
    const key = createHash('sha1').update(JSON.stringify(PREF_KEYS.map((name) => prefs[name]))).digest('hex');
    if (deps !== null && key === signature) return deps;

    const llm = prefs['llm.protocol'] === 'anthropic'
      ? createAnthropicLlm({ baseUrl: prefs['llm.baseUrl'], apiKey: prefs['llm.apiKey'], fetch: http })
      : createOpenAiLlm({ baseUrl: prefs['llm.baseUrl'], apiKey: prefs['llm.apiKey'], fetch: http });
    const tts = createTtsEngine({ provider: ttsProviderFor(prefs, options.ttsDir, http), dir: options.cacheDir });
    // 首次体验的嗓子不打折：那一段音频是随包文件，用户换成 fish 也照读不误。
    const demoTts = options.demo === undefined
      ? null
      : createTtsEngine({ provider: createFileTts({ file: options.demo.wav }), dir: options.cacheDir });
    const music = createMusicSourceChain(
      [
        createNeteaseSource({ baseUrl: options.neteaseBaseUrl, cookie: prefs['music.cookie'], fetch: http }),
        createLocalSource({ dir: options.localDir }),
      ],
      { onUnreachable: () => { sourceFailures += 1; } },
    );
    const brain = new ToolLoopBrain({ llm, music, store, taste, env, model: prefs['llm.model'], onStep: harvest });

    deps = { prefs, tts, demoTts, music, brain, llm };
    signature = key;
    return deps;
  };

  const trackRef = async (songId: string): Promise<TrackRef | null> => {
    const seen = catalog.get(songId);
    if (seen !== undefined) return { id: seen.id, title: seen.title, artist: seen.artist };
    const favorite = (await store.favorites().catch(() => [] as TrackRef[])).find((ref) => ref.id === songId);
    if (favorite !== undefined) return favorite;
    const played = (await store.recentPlays(50).catch(() => [] as PlayEvent[])).find((event) => event.songId === songId);
    if (played !== undefined) return { id: songId, title: played.title, artist: played.artist };
    return null;
  };

  const trackFromRef = (ref: TrackRef): Track => catalog.get(ref.id) ?? { ...ref, source: 'unknown' };

  // —— 口播：逐句合、逐句推。任何一句失败都不许把电台停掉（抽象层第 6 节） ——
  // kind 由调用方给：intro = 对一首歌的介绍（要说出口），talk = 对听众的答话（只落文本）。
  // engine 只服务首次体验：那一段口播固定读随包的音频，别的调用方不传这个参数。
  const speak = async (d: Deps, lines: readonly string[], kind: SpokenLine['kind'], engine = d.tts): Promise<void> => {
    const voice = d.prefs['tts.voice'];
    onAir = true;
    djState = 'thinking';
    emitState();
    if (kind === 'talk') {
      // 答话不是口播（用户定）：整段一条文本消息，不合成、没入口、不进全屏口播。
      // 为什么不合成：没有界面承接它 —— 合了也没人听，白花钱、白等。
      const text = lines.join(' ').trim();
      if (text !== '') {
        await store.appendMessage({ id: randomUUID(), ts: clock.now().toISOString(), role: 'dj', text }).catch(() => {});
        emit({ type: 'say', payload: { kind: 'talk', index: 0, line: text, audioUrl: '', words: [] } });
      }
      djState = 'idle';
      emitState();
      emit({ type: 'now', payload: nowPlaying() });
      return;
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      let spoken: SpokenLine;
      try {
        spoken = { ...(await engine.speak(index, line, voice)), kind };
      } catch (cause: unknown) {
        // 文字照给、音频缺席： 说的是"不许把音乐停掉"，而整条口播消失比"有字没声"更糟。
        // 缺口由横幅说明（TTS_FAILED），不假装音频在。词表退化成覆盖全句的一个词。
        emitError('TTS_FAILED', cause instanceof TtsFailure ? cause.message : String(cause), true);
        spoken = { index, line, audioUrl: engine.urlOf(engine.keyOf(line, voice)), words: wordsFor(line, 0), kind };
      }
      // 「说了什么」就是历史。放在这里而不是 think()：被挂起来、还没说出口的那几句不该进历史。
      await store.appendMessage({ id: randomUUID(), ts: clock.now().toISOString(), role: 'dj', text: line }).catch(() => {});
      emit({ type: 'say', payload: spoken });
      // 开场第一句出声 = 开机的等待到此为止，进度界面交接。
      if (kind === 'intro') endBoot();
    }
    djState = 'idle';
    emitState();
    emit({ type: 'now', payload: nowPlaying() });
  };

  /**
   * 把「开场之后的那几句」按曲目挂起来：它们是随这一轮推理**预生成**的，
   * 但轮到那首歌时才说。开场那句（say[0]）立刻说，所以不在里面。
   */
  const holdIntros = (show: Show): void => {
    heldSay = new Map<string, string>();
    for (let i = 1; i < show.play.length; i += 1) {
      const ref = show.play[i];
      const line = show.say[i];
      if (ref !== undefined && line !== undefined && line !== '') heldSay.set(ref.id, line);
    }
    // 挂起来的同时**先把音频合出来**：轮到那首歌时是一次缓存命中，切歌不用等合成。
    // 尽力而为 —— 这里失败不喊也不落横幅；真说的时候 speak() 还会再试一次，那一次才算失败。
    void (async () => {
      const d = await providers();
      for (const line of heldSay.values()) {
        await d.tts.speak(0, line, d.prefs['tts.voice']).catch(() => {});
      }
    })().catch(() => {});
  };

  /** 轮到这首歌了：把一直压着的那一句推出去 —— 文本落进 feed，音频跟着响。 */
  const speakHeld = async (id: string): Promise<void> => {
    const line = heldSay.get(id);
    if (line === undefined) return;
    heldSay.delete(id);
    await speak(await providers(), [line], 'intro').catch(() => {});
  };

  const applyShow = (show: Show): void => {
    // 有一轮真的成了：上一条失败（比如"音乐源没在答话"）就是过去的事了，别让它继续挂着。
    lastError = null;
    queueRefs = show.play;
    const first = show.play[0];
    if (first !== undefined) {
      current = trackFromRef(first);
      startedAt = clock.now().toISOString();
    }
    emit({ type: 'queue', payload: [...queueRefs] });
    emit({ type: 'now', payload: nowPlaying() });
  };

  /** 队列自己往前走一格。没有大脑时的兜底：电台不至于哑掉。 */
  const stepLocally = (): void => {
    const at = queueRefs.findIndex((ref) => ref.id === current?.id);
    const next = queueRefs[at + 1] ?? queueRefs[0];
    if (next === undefined) return;
    current = trackFromRef(next);
    startedAt = clock.now().toISOString();
    djState = 'idle';
    emitState();
    emit({ type: 'now', payload: nowPlaying() });
  };

  const think = async (trigger: 'schedule' | 'chat' | 'track_end' | 'manual', userText?: string): Promise<Show> => {
    // 这一轮的失败归因只看这段区间里音乐链有没有喊过（见 nameFailure）。
    const mark = sourceFailures;
    const d = await providers();
    djState = 'thinking';
    emitState();
    try {
      const show = await d.brain.think({
        trigger,
        now: clock.now(),
        ...(userText === undefined ? {} : { userText }),
      });
      applyShow(show);
      return show;
    } catch (cause: unknown) {
      djState = 'idle';
      emitState();
      emit({ type: 'now', payload: nowPlaying() });
      throw nameFailure(cause, sourceFailures > mark);
    }
  };

  /** 大脑缺席时把原因说清楚，然后让队列自己走 —— 音乐不该因为一个 key 而停。 */
  const thinkOrStep = async (trigger: 'schedule' | 'chat' | 'track_end' | 'manual', userText?: string): Promise<void> => {
    const d = await providers();
    if (d.prefs['llm.apiKey'] === '') {
      emitError('NO_LLM_KEY', 'No LLM key configured. Open Settings and add one.', false);
      if (trigger !== 'chat') stepLocally();
      return;
    }
    const show = await think(trigger, userText);
    // 开场只说第一句；剩下的挂起来，切歌时才轮到它们。
    holdIntros(show);
    void speak(d, show.say.slice(0, 1), 'intro').catch(() => {});
  };

  /**
   * 首次体验：没填 key 的人开机也该听见一台在转的电台 —— 随包的那一首，
   * 加上出厂时冻下来的那段口播。走的是**和平时一模一样**的那条管道（队列 / now / 口播 / 缓存），
   * 所以界面上一个新组件都不用加。
   */
  const playDemo = async (d: Deps): Promise<void> => {
    const demo = options.demo;
    if (demo === undefined || d.demoTts === null) return;
    // 用曲库这层找它（不是拼 id）：id 怎么编号是本地源自己的事，这里只认文件名。
    const found = (await d.music.library(DEMO_SCAN).catch(() => [] as Track[]))
      .find((track) => track.id.endsWith(demo.file));
    if (found === undefined) {
      warn('radio: 首次体验的那首歌不在曲库里（' + demo.file + '）—— 只留引导横幅');
      return;
    }
    catalog.set(found.id, found);
    current = found;
    startedAt = clock.now().toISOString();
    queueRefs = [{ id: found.id, title: found.title, artist: found.artist }];
    emit({ type: 'now', payload: nowPlaying() });
    emit({ type: 'queue', payload: [...queueRefs] });
    await speak(d, [DEMO_LINE], 'intro', d.demoTts).catch(() => {});
  };

  const advance = async (): Promise<void> => {
    const tail = queueRefs.findIndex((ref) => ref.id === current?.id) >= queueRefs.length - 1;
    if (tail) {
      await thinkOrStep('track_end');
      return;
    }
    stepLocally();
    // 切到下一首：把早就写好、一直压着的那一句推出去。
    const arrived = current;
    if (arrived === null) return;
    await speakHeld(arrived.id);
  };

  /**
   * 排表那一轮的接线：日表交给大脑去排，它自己会叫 `daily_recommend` 去拿日推。
   * 没配 key 就不发这一轮 —— 白等一轮没有意义，直接走逐格搜索的兜底。
   */
  const planCurator: PlanCurator = async (blocks) => {
    const d = await providers();
    if (d.prefs['llm.apiKey'] === '') return null;
    return d.brain.plan({ trigger: 'schedule', now: clock.now() }, blocks);
  };
  /**
   * 今天还没有日表就排一份。**一天只排一次**：重启复用同一份，不然「今天的歌单」每开一次窗口就换一批。
   * 排不出来不是错误 —— 大脑还能自己挑歌，只是开场没有「早上定下的那首」可指。
   */
  const ensureTodayPlan = async (): Promise<DayPlan | null> => {
    const date = localDateKey(clock.now());
    const existing = await store.activePlan(date).catch(() => null);
    if (existing !== null) return existing;
    try {
      const at = clock.now();
      const d = await providers();
      const plan = await buildDayPlan({ date, createdAt: at.toISOString(), music: d.music, curate: planCurator });
      await store.savePlan(plan);
      emit({ type: 'plan', payload: plan });
      return plan;
    } catch (cause: unknown) {
      warn('radio: 今天排不出日表 —— ' + (cause instanceof Error ? cause.message : String(cause)));
      return null;
    }
  };

  /**
   * 读听众自己的歌单 → 让模型写一份口味画像 → 落到 `taste/<taste.md>`。
   *
   * 「已经有一份就不动」这件事在 `buildTasteFromLibrary` 里（它先看一眼文件名），所以这里
   * 可以被反复调用：开机一次、每次存设置一次 —— 缺哪一次就在哪一次补上。后台跑，不挡保存设置。
   */
  const learnTaste = async (): Promise<void> => {
    const d = await providers();
    if (d.prefs['llm.apiKey'] === '' || d.prefs['music.cookie'] === '') return;
    const verdict = await buildTasteFromLibrary({
      music: d.music, llm: d.llm, model: d.prefs['llm.model'], dir: options.tasteDir,
    });
    // 「已经有一份」是常态，不是一条要说的消息；只有真写了、或真出了别的事才留话。
    if (verdict.written) warn('radio: 口味画像已写入 taste.md（读了 ' + verdict.tracks + ' 首）');
    else if (verdict.reason !== 'taste.md already exists') warn('radio: 口味画像没写 —— ' + verdict.reason);
  };
  return {
    subscribe(send) {
      subscribers.add(send);
      // 连上先给一份快照，UI 不必先轮询一轮。
      send({ type: 'now', payload: nowPlaying() });
      send({ type: 'queue', payload: [...queueRefs] });
      send({ type: 'state', payload: { onAir, djState } });
      if (lastError !== null) send({ type: 'error', payload: lastError });
      // 晚连上的窗口也要看见正在跑的开机进度—— 否则窗口出生时那一段永远是空的。
      if (booting && bootSteps.length > 0) {
        send({ type: 'progress', payload: { phase: 'running', steps: [...bootSteps] } });
      }
      return () => {
        subscribers.delete(send);
      };
    },

    async boot() {
      // 一开机我就打碟 —— 但先把今天的日表排出来：它是开场的来源，
      // 也是这一档唯一能看见「早上定下的那批歌」的地方（第 26 条记下的那个缺口）。
      // 这一段是**唯一**会发进度的时候：窗口已经先出生，进度经 WS 推进界面。
      booting = true;
      bootSteps = [];
      const mark = sourceFailures;
      try {
        // 还没有口味画像就先补一份—— 开机也走这条路：旧触发（cookie 第一次填上）
        // 对早就填过 cookie 的人永远不成立，于是 taste.md 一直不存在，日表也就没有口味可参考。
        await learnTaste().catch(() => {});
        await ensureTodayPlan();
        const d = await providers();
        // 没 key = 首次体验：随包的一首歌 + 一段冻结的口播，先让人听见一台在转的电台。
        // 这不是错误路径，是一条**正常**的开机 —— 所以它不走 thinkOrStep 的降级。
        if (d.prefs['llm.apiKey'] === '') {
          emitError('NO_LLM_KEY', 'No LLM key configured. Add one to make this station yours.', false);
          await playDemo(d);
          return;
        }
        await thinkOrStep('schedule').catch((cause: unknown) => {
          const failure = nameFailure(cause, sourceFailures > mark);
          emitError(failure.code, failure.message, failure.retryable);
        });
      } finally {
        // 口播出声时进度早结束了；没出声（没 key / 出错 / 排表失败）也必须在收尾结束 —— 界面不许挂住。
        endBoot();
      }
    },

    now: nowPlaying,
    queue: () => [...queueRefs],

    favorites: () => store.favorites(),
    taste: () => taste.read(),

    async stats(since) {
      const parsed = since === undefined ? Number.NaN : Date.parse(since);
      // 不传 since = 今天零点起。别先造 Invalid Date 再 setHours —— setHours 修不好 NaN，
      // 会让 store.playStats 在 toISOString() 上抛 RangeError（真踩过，见 radio 测试）。
      const from = Number.isNaN(parsed) ? new Date(clock.now()) : new Date(parsed);
      if (Number.isNaN(parsed)) from.setHours(0, 0, 0, 0);
      return store.playStats(from);
    },

    history: (limit) => store.recentMessages(clampLimit(limit)),

    planToday: () => store.activePlan(localDateKey(clock.now())).catch(() => null),

    async regeneratePlan() {
      const at = clock.now();
      const d = await providers();
      const plan = await buildDayPlan({ date: localDateKey(at), createdAt: at.toISOString(), music: d.music, curate: planCurator });
      await store.savePlan(plan);
      emit({ type: 'plan', payload: plan });
      return plan;
    },

    async settings() {
      const prefs = await readPrefs();
      return {
        llm: { baseUrl: prefs['llm.baseUrl'], model: prefs['llm.model'], protocol: prefs['llm.protocol'], apiKeySet: prefs['llm.apiKey'] !== '' },
        tts: { provider: prefs['tts.provider'], voice: prefs['tts.voice'], baseUrl: prefs['tts.baseUrl'], apiKeySet: prefs['tts.apiKey'] !== '' },
        music: { provider: prefs['music.provider'], cookieSet: prefs['music.cookie'] !== '' },
      };
    },

    async models(input) {
      const base = input.baseUrl.replace(/\/+$/, '');
      if (base === '') throw new RadioFailure('INTERNAL', 'models needs a baseUrl', false);
      const stored = (await readPrefs())['llm.apiKey'];
      const key = input.apiKey === undefined || input.apiKey === '' ? stored : input.apiKey;
      const headers: Record<string, string> = key === '' ? {} : { authorization: 'Bearer ' + key };
      const payload = await getJson<{ data?: { id?: unknown }[] }>(http, base + '/models', headers)
        .catch((cause: unknown) => {
          if (cause instanceof HttpError) {
            const code = llmFailureCode(cause.status);
            throw new RadioFailure(code, describeHttp(cause), code !== 'NO_LLM_KEY');
          }
          throw new RadioFailure('INTERNAL', cause instanceof Error ? cause.message : String(cause), true);
        });
      const ids = (payload.data ?? [])
        .map((item) => (item === null || typeof item !== 'object' ? undefined : item.id))
        .filter((id): id is string => typeof id === 'string' && id !== '');
      return [...new Set(ids)].sort();
    },

    async saveSettings(input) {
      // 封闭 key，显式校验；**空字符串 = 不改**，所以 key / cookie 不可能被一次空提交清掉。
      if (input.llm !== undefined) {
        if (typeof input.llm.baseUrl === 'string' && input.llm.baseUrl !== '') await store.setPref('llm.baseUrl', input.llm.baseUrl);
        if (typeof input.llm.model === 'string' && input.llm.model !== '') await store.setPref('llm.model', input.llm.model);
        if (input.llm.protocol === 'openai' || input.llm.protocol === 'anthropic') await store.setPref('llm.protocol', input.llm.protocol);
        if (typeof input.llm.apiKey === 'string' && input.llm.apiKey !== '') await store.setPref('llm.apiKey', input.llm.apiKey);
      }
      if (input.tts !== undefined) {
        if (typeof input.tts.provider === 'string' && input.tts.provider !== '') await store.setPref('tts.provider', input.tts.provider);
        if (typeof input.tts.voice === 'string' && input.tts.voice !== '') await store.setPref('tts.voice', input.tts.voice);
        if (typeof input.tts.baseUrl === 'string' && input.tts.baseUrl !== '') await store.setPref('tts.baseUrl', input.tts.baseUrl);
        if (typeof input.tts.apiKey === 'string' && input.tts.apiKey !== '') await store.setPref('tts.apiKey', input.tts.apiKey);
      }
      if (input.music !== undefined) {
        if (typeof input.music.provider === 'string' && input.music.provider !== '') await store.setPref('music.provider', input.music.provider);
        if (typeof input.music.cookie === 'string' && input.music.cookie !== '') await store.setPref('music.cookie', input.music.cookie);
      }
      signature = ''; // 下一次 providers() 一定重建
      // 填上 key 的这一刻，那条「还没有 key」的横幅（首次体验的引导）就过期了；
      // 而且既然刚才就是在等它，顺手把真电台开起来：排表 → 开场口播。
      // 用 lastError 而不是另设一个状态：它**就是**「这次开机没 key」这件事本身。
      if (typeof input.llm?.apiKey === 'string' && input.llm.apiKey !== '' && lastError?.code === 'NO_LLM_KEY') {
        lastError = null;
        void this.boot().catch(() => {});
      }
      // 凑齐「key + cookie」就补一份口味画像：不 await —— 分析要等音乐源和模型，慢；
      // 设置存完就该立刻生效。已有 taste.md 时它读一眼文件名就回来了，重复调用是便宜的。
      void learnTaste().catch(() => {});
      const answer = await this.settings();
      return answer;
    },

    async chat(text) {
      const trimmed = text.trim();
      if (trimmed === '') throw new RadioFailure('INTERNAL', 'text must not be empty', false);
      await store.appendMessage({ id: randomUUID(), ts: clock.now().toISOString(), role: 'me', text: trimmed }).catch(() => {});
      const d = await providers();
      if (d.prefs['llm.apiKey'] === '') {
        throw new RadioFailure('NO_LLM_KEY', 'No LLM key configured. Open Settings and add one.', false);
      }
      const show = await think('chat', trimmed).catch((cause: unknown) => {
        throw cause instanceof RadioFailure
          ? cause
          : new RadioFailure('INTERNAL', cause instanceof Error ? cause.message : String(cause), true);
      });
      // 对话的回答要一次说完，不是「每首歌一句」：挂起来的那些必须清掉。
      heldSay.clear();
      // 逐句推是**流**的事，不是这次 POST 的事：POST 立刻回 Show，音频在后台一句句到。
      void speak(d, show.say, 'talk').catch(() => {});
      return show;
    },

    async playback(report) {
      const ref = await trackRef(report.songId);
      if (ref === null) throw new RadioFailure('INTERNAL', 'Unknown songId: ' + report.songId, false);
      const seen = catalog.get(report.songId);
      const common = {
        songId: report.songId,
        title: ref.title,
        artist: ref.artist,
        source: seen?.source ?? 'unknown',
        // 这一档是**实际**解析出来的那一档（resolveAudio 记的），不是我们希望的。
        level: levels.get(report.songId) ?? 'standard',
        reason: null,
      };
      if (report.event === 'started') {
        await store.recordPlay({ ts: report.at, ...common, startedAt: report.at, endedAt: null, skipped: false });
        if (current?.id !== report.songId) {
          current = trackFromRef(ref);
          startedAt = report.at;
          emit({ type: 'now', payload: nowPlaying() });
          // 点队列 / 点上一首跳过来，也该听见这一首的那一条（一首歌一条口播）：
          // 原来只有「自然放完」才切口播，手动切歌是哑的。
          void speakHeld(report.songId);
        }
        return;
      }
      await store.recordPlay({
        ts: report.at,
        ...common,
        startedAt: report.at,
        endedAt: report.at,
        skipped: report.event === 'skipped',
      });
      if (report.event === 'ended') await advance();
    },

    async feedback(songId, action) {
      if (action !== 'like' && action !== 'unlike') {
        // 错误码是封闭枚举，里面没有"参数不合法"：与未知路由同一个先例，用 INTERNAL。
        throw new RadioFailure('INTERNAL', 'action must be like|unlike', false);
      }
      const ref = await trackRef(songId);
      if (ref === null) throw new RadioFailure('INTERNAL', 'Unknown songId: ' + songId, false);
      await store.setFavorite(ref, action === 'like');
      // 口味闭环的第一环：♡ 是**人的动作**，记成一条结构化的「学到的」。
      // 学不会不许把动作本身弄失败 —— 喜欢已经落库了，这条只是账外的一笔。
      const learned = (action === 'like' ? 'Kept ' : 'Dropped ') + ref.title + ' — ' + ref.artist + '.';
      await taste.appendLearned(learned, {
        ts: clock.now().toISOString(), text: learned, evidence: { songId: ref.id, action },
      }).catch(() => {});
    },

    async resolveAudio(songId, level) {
      const d = await providers();
      const mark = sourceFailures;
      const resolved = await d.music.resolve(songId, level ?? 'exhigh').catch(() => null);
      if (resolved === null) {
        // 链把"源不可达"和"解析不出来"都收敛成 null（既定取舍）——
        // 但它刚喊过那一声，所以这次分得清：源不在，不该说成"这首歌没有可播的地址"。
        if (sourceFailures > mark) {
          throw new RadioFailure('MUSIC_SOURCE_UNREACHABLE', 'The music source did not answer.', true);
        }
        throw new RadioFailure('MUSIC_NOT_RESOLVABLE', 'This track cannot be resolved at any quality level.', false);
      }
      levels.set(songId, resolved.level);
      return resolved.url;
    },

    ttsAudio: (key) => (deps === null ? null : deps.tts.read(key)),

    close() {
      subscribers.clear();
      warn('radio: closed');
    },
  };
}
