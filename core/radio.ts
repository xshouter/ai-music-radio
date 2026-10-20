import { createHash, randomUUID } from 'node:crypto';
import type { Clock, EnvProvider, LlmProvider, PrefMap, Store, TasteRepo, TtsProvider } from '../shared/ports.ts';
import type { DayPlan, DjMessage, DjState, PlayEvent, QualityLevel, Show, SpokenLine, Track, TrackRef } from '../shared/domain.ts';
import type {
  ErrorCode, FavoriteAction, NowPlaying, PlaybackReport, SettingsInput, SettingsView, StreamEvent, TasteDoc,
} from '../shared/api-types.ts';
import { defaultHttpFetch, type HttpFetch } from './http.ts';
import { ToolLoopBrain, type ToolStep } from './brain/index.ts';
import { createMusicSourceChain } from './music/index.ts';
import { createNeteaseSource } from './music/netease.ts';
import { createLocalSource } from './music/local.ts';
import { createOpenAiLlm } from './providers/llm-openai.ts';
import { createAnthropicLlm } from './providers/llm-anthropic.ts';
import { createFishTts } from './providers/tts-fish.ts';
import { createPiperTts } from './providers/tts-piper.ts';
import { createTtsEngine, wordsFor, TtsFailure } from './tts.ts';
import { buildTasteFromLibrary } from './taste.ts';
import { DEFAULT_PREFS, PREF_KEYS } from './state/prefs.ts';
import { localDateKey } from './prompt.ts';
import { buildDayPlan } from './plan.ts';

/**
 * 电台本身（4.5 的调度部分）。server.ts 只做"把 HTTP/WS 翻译成对它的调用"。
 *
 * 它拥有三样只有一处能拥有的东西：
 * - **当前状态**：现在放的是哪首、DJ 在不在说话、队列是什么。UI 读它，不读别的。
 * - **provider 的组装**：设置一变就重建大脑 / 嗓子 / 音源（generation）。key 只在这里流进 provider。
 * - **事件扇出**：WS 的六种事件只从这里出，server 只管往 socket 上写。
 *
 * 播放权威在客户端（ADR-0010）：用户切歌由客户端自己切，再 POST /api/playback 报事实；
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

export interface RadioOptions {
  store: Store;
  clock: Clock;
  taste: TasteRepo;
  env: EnvProvider;
  /** 网易云兼容服务的地址（ADR-0016：加密层不在内核里）。没有它，音乐源只剩本地目录。 */
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
  music: ReturnType<typeof createMusicSourceChain>;
  brain: ToolLoopBrain;
  /** 口味画像要用它写一份 md，所以它也在这里（不是给大脑用的那条路）。 */
  llm: LlmProvider;
}

/**
 * 嗓子（TTS）的选择只有这一处 —— ADR-0008 的「换厂商 = 换一个 provider 文件」。
 *
 * piper 是默认：离线、零 key、打进包里就有声音。
 * fish 走 HTTP：`baseUrl` 指托管端点，或指自己跑的 fish-speech（同一个 `POST /v1/tts`）。
 */
function ttsProviderFor(prefs: PrefMap, ttsDir: string, http: HttpFetch): TtsProvider {
  if (prefs['tts.provider'] === 'fish') {
    return createFishTts({ apiKey: prefs['tts.apiKey'], baseUrl: prefs['tts.baseUrl'], fetch: http });
  }
  return createPiperTts({ dir: ttsDir });
}

const clampLimit = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw)) return 50;
  return Math.max(1, Math.min(200, Math.floor(raw)));
};

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
  const emitError = (code: ErrorCode, message: string, retryable: boolean): void =>
    emit({ type: 'error', payload: { code, message, retryable } });

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
    const music = createMusicSourceChain([
      createNeteaseSource({ baseUrl: options.neteaseBaseUrl, cookie: prefs['music.cookie'], fetch: http }),
      createLocalSource({ dir: options.localDir }),
    ]);
    const brain = new ToolLoopBrain({ llm, music, store, taste, env, model: prefs['llm.model'], onStep: harvest });

    deps = { prefs, tts, music, brain, llm };
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
  const speak = async (d: Deps, lines: readonly string[]): Promise<void> => {
    const voice = d.prefs['tts.voice'];
    onAir = true;
    djState = 'thinking';
    emitState();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      let spoken: SpokenLine;
      try {
        spoken = await d.tts.speak(index, line, voice);
      } catch (cause: unknown) {
        // 文字照给、音频缺席：ADR-0008 说的是"不许把音乐停掉"，而整条口播消失比"有字没声"更糟。
        // 缺口由横幅说明（TTS_FAILED），不假装音频在。词表退化成覆盖全句的一个词（ADR-0012 允许）。
        emitError('TTS_FAILED', cause instanceof TtsFailure ? cause.message : String(cause), true);
        spoken = { index, line, audioUrl: d.tts.urlOf(d.tts.keyOf(line, voice)), words: wordsFor(line, 0) };
      }
      // 「说了什么」就是历史。放在这里而不是 think()：被挂起来、还没说出口的那几句不该进历史。
      await store.appendMessage({ id: randomUUID(), ts: clock.now().toISOString(), role: 'dj', text: line }).catch(() => {});
      emit({ type: 'say', payload: spoken });
    }
    djState = 'idle';
    emitState();
    emit({ type: 'now', payload: nowPlaying() });
  };

  /**
   * 把「开场之后的那几句」按曲目挂起来（ADR-0026）：它们是随这一轮推理**预生成**的，
   * 但轮到那首歌时才说。开场那句（say[0]）立刻说，所以不在里面。
   */
  const holdIntros = (show: Show): void => {
    heldSay = new Map<string, string>();
    for (let i = 1; i < show.play.length; i += 1) {
      const ref = show.play[i];
      const line = show.say[i];
      if (ref !== undefined && line !== undefined && line !== '') heldSay.set(ref.id, line);
    }
  };

  const applyShow = (show: Show): void => {
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
      throw cause;
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
    // 开场只说第一句；剩下的挂起来，切歌时才轮到它们（ADR-0026）。
    holdIntros(show);
    void speak(d, show.say.slice(0, 1)).catch(() => {});
  };

  const advance = async (): Promise<void> => {
    const tail = queueRefs.findIndex((ref) => ref.id === current?.id) >= queueRefs.length - 1;
    if (tail) {
      await thinkOrStep('track_end');
      return;
    }
    stepLocally();
    // 切到下一首：把早就写好、一直压着的那一句推出去 —— 文本落进 feed，音频跟着响（ADR-0026）。
    const arrived = current;
    if (arrived === null) return;
    const intro = heldSay.get(arrived.id);
    if (intro === undefined) return;
    heldSay.delete(arrived.id);
    void speak(await providers(), [intro]).catch(() => {});
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
      const plan = await buildDayPlan({ date, createdAt: at.toISOString(), music: d.music });
      await store.savePlan(plan);
      emit({ type: 'plan', payload: plan });
      return plan;
    } catch (cause: unknown) {
      warn('radio: 今天排不出日表 —— ' + (cause instanceof Error ? cause.message : String(cause)));
      return null;
    }
  };

  /**
   * 读听众自己的歌单 → 让模型写一份口味画像 → 落到 `taste/<taste.md>`（ADR-0025）。
   * 只在**第一次填 cookie** 之后跑一次；后台跑，不挡保存设置。
   */
  const learnTaste = async (): Promise<void> => {
    const d = await providers();
    if (d.prefs['llm.apiKey'] === '' || d.prefs['music.cookie'] === '') return;
    const verdict = await buildTasteFromLibrary({
      music: d.music, llm: d.llm, model: d.prefs['llm.model'], dir: options.tasteDir,
    });
    warn(verdict.written
      ? 'radio: 口味画像已写入 taste.md（读了 ' + verdict.tracks + ' 首）'
      : 'radio: 口味画像没写 —— ' + verdict.reason);
  };
  return {
    subscribe(send) {
      subscribers.add(send);
      // 连上先给一份快照，UI 不必先轮询一轮。
      send({ type: 'now', payload: nowPlaying() });
      send({ type: 'queue', payload: [...queueRefs] });
      send({ type: 'state', payload: { onAir, djState } });
      return () => {
        subscribers.delete(send);
      };
    },

    async boot() {
      // 一开机我就打碟 —— 但先把今天的日表排出来：它是开场的来源（ADR-0024），
      // 也是这一档唯一能看见「早上定下的那批歌」的地方（第 26 条记下的那个缺口）。
      await ensureTodayPlan();
      await thinkOrStep('schedule').catch((cause: unknown) => {
        emitError('INTERNAL', cause instanceof Error ? cause.message : String(cause), true);
      });
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
      const plan = await buildDayPlan({ date: localDateKey(at), createdAt: at.toISOString(), music: d.music });
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

    async saveSettings(input) {
      // 封闭 key，显式校验；**空字符串 = 不改**，所以 key / cookie 不可能被一次空提交清掉（ADR-0005 / ADR-0011）。
      const hadCookie = (await readPrefs())['music.cookie'] !== '';
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
      // cookie 从「没有」变成「有」＝第一次填：后台去读他的歌单（ADR-0025）。
      // 不 await：分析要等音乐源和模型，慢；设置存完就该立刻生效。
      if (!hadCookie && typeof input.music?.cookie === 'string' && input.music.cookie !== '') {
        void learnTaste().catch(() => {});
      }
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
      void speak(d, show.say).catch(() => {});
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
      // 口味闭环的第一环（ADR-0004）：♡ 是**人的动作**，记成一条结构化的「学到的」。
      // 学不会不许把动作本身弄失败 —— 喜欢已经落库了，这条只是账外的一笔。
      const learned = (action === 'like' ? 'Kept ' : 'Dropped ') + ref.title + ' — ' + ref.artist + '.';
      await taste.appendLearned(learned, {
        ts: clock.now().toISOString(), text: learned, evidence: { songId: ref.id, action },
      }).catch(() => {});
    },

    async resolveAudio(songId, level) {
      const d = await providers();
      const resolved = await d.music.resolve(songId, level ?? 'exhigh').catch(() => null);
      if (resolved === null) {
        // 链把"源不可达"和"解析不出来"都收敛成 null（ADR-0016 的既定取舍），所以这里只能报这一句。
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
