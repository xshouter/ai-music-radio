import type { DayPlan, Show, Track, TrackRef } from '../../shared/domain.ts';
import type {
  Brain,
  BrainInput,
  EnvProvider,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  LlmToolSpec,
  MusicSource,
  Store,
  TasteRepo,
} from '../../shared/ports.ts';
import { localDateKey, systemPrompt, userPrompt } from '../prompt.ts';

/** 一轮 tool 调用的观测点：调度器、开发时、测试都靠它看见"大脑到底做了什么"。 */
export interface ToolStep {
  index: number;
  tool: string;
  args: unknown;
  result: unknown;
}

export interface ToolLoopOptions {
  llm: LlmProvider;
  music: MusicSource;
  store: Store;
  taste: TasteRepo;
  env: EnvProvider;
  model: string;
  /** 默认 6：够走完"搜一次 → 看看跳过史 → 定稿"，又不至于为了一个坏回答烧掉一整轮预算。 */
  maxSteps?: number;
  temperature?: number;
  onStep?: (step: ToolStep) => void;
}

const EMIT = 'emit_show';
const MIN_TRACKS = 3;
const MAX_TRACKS = 6;
/** 每首歌一句（ADR-0026），所以行数上限跟着曲目上限走。 */
const MAX_LINES = 6;

/**
 * 工具集合是**封闭**的（ADR-0015）：模型在这一轮里能做的事就这四件。
 * 加一个工具＝改这里 + 补一条测试，而不是让模型去"想"还能干什么。
 */
export const TOOLS: readonly LlmToolSpec[] = [
  {
    name: 'recommend_tracks',
    description:
      'Ask the music source for tracks that fit a mood or a set of genres. Returns tracks with ids you may use in emit_show.',
    parameters: {
      type: 'object',
      properties: {
        genres: { type: 'array', items: { type: 'string' }, description: 'e.g. ["ambient", "downtempo"]' },
        mood: { type: 'string', description: 'A short phrase, e.g. "low and steady, nothing fast".' },
        limit: { type: 'integer', description: 'How many candidates to return (1-10, default 6).' },
      },
      required: [],
    },
  },
  {
    name: 'search_tracks',
    description: 'Search the music source by free text: an artist, a title, a scene, an era. Returns tracks with ids.',
    parameters: {
      type: 'object',
      properties: {
        keywords: { type: 'string', description: 'What to search for.' },
        limit: { type: 'integer', description: 'How many candidates to return (1-10, default 6).' },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'recent_plays',
    description:
      'Read what was actually played recently, including what the listener skipped or replayed. Use it to avoid repeating yourself.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many recent plays (1-30, default 10).' } },
      required: [],
    },
  },
  {
    name: 'today_plan',
    description:
      'The playlist you already laid out for today, in play order (3 blocks flattened, deduped). Call it when you open the day or a block, and start with its first track.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many of its tracks (1-12, default 9).' },
      },
      required: [],
    },
  },
  {
    name: EMIT,
    description:
      'Emit the finished radio segment and END your turn. Everything you "say" comes from here, so it must sound spoken.',
    parameters: {
      type: 'object',
      properties: {
        say: {
          type: 'array',
          items: { type: 'string' },
          description: 'one short spoken line per track in `play`, in the same order: say[0] opens the first track. Each under 18 words.',
        },
        play: {
          type: 'array',
          items: { type: 'string' },
          description: '3-6 track ids, in play order. Only ids returned by a tool in THIS turn.',
        },
        reason: { type: 'string', description: 'One private sentence, not spoken: why this set, now.' },
        segue: { type: 'string', description: 'Optional single sentence for the crossfade. Omit or null when unneeded.' },
      },
      required: ['say', 'play', 'reason'],
    },
  },
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asStrings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '');
  return items.length === 0 ? undefined : items;
};

const count = (value: unknown, fallback: number, max = 10): number => {
  const raw = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(raw) ? Math.max(1, Math.min(max, Math.trunc(raw))) : fallback;
};

/**
 * 自建 tool loop（ADR-0015）。它只做三件事：
 * 拉着模型往前走、把工具结果原样交回、并且**在模型自己说"完了"之前不接受任何结论**。
 *
 * 为什么不用厂商的 function-calling 编排：两边的 `tools` / `tool_calls` / `tool_use` 写法完全不同，
 * 而"什么时候该停"是本产品的核心行为（什么时候开口播、播几首）——
 * 把这个判断交给某一家 SDK 的默认值，等于把产品的脾气外包出去。
 */
export class ToolLoopBrain implements Brain {
  private readonly deps: ToolLoopOptions;

  constructor(deps: ToolLoopOptions) {
    this.deps = deps;
  }

  async think(input: BrainInput): Promise<Show> {
    const context = await this.gather(input);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt(context) },
      { role: 'user', content: userPrompt(context) },
    ];
    const registry = new Map<string, Track>();
    const maxSteps = this.deps.maxSteps ?? 6;

    for (let step = 0; step < maxSteps; step += 1) {
      // 最后一步**强制**要 emit_show：与其在步数耗尽后抛错，不如给它一次"必须定稿"的机会。
      const lastStep = step === maxSteps - 1;
      const response = await this.deps.llm.complete({
        model: this.deps.model,
        messages,
        tools: [...TOOLS],
        toolChoice: lastStep ? { name: EMIT } : 'auto',
        ...(this.deps.temperature === undefined ? {} : { temperature: this.deps.temperature }),
      });

      let rejection: string | null = null;
      const candidate = response.toolCalls.find((call) => call.name === EMIT);
      if (candidate !== undefined) {
        const verdict = this.readShow(candidate.args, registry);
        if (verdict.ok) return verdict.show;
        rejection = verdict.reason;
        if (lastStep) throw new Error('brain: emit_show 始终不合法 —— ' + verdict.reason);
      }

      // 不用工具的模型：有的会把 JSON 直接写进正文。认它，但不为它放宽校验 —— 走同一套 readShow。
      if (candidate === undefined && response.toolCalls.length === 0 && response.text.trim() !== '') {
        const parsed = this.tryParseShow(response.text, registry);
        if (parsed !== null) return parsed;
      }

      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });

      // **每个** tool_call 都要有回音，包括被驳回的 emit_show：少一条，OpenAI 面直接 400。
      for (const call of response.toolCalls) {
        const result = call.name === EMIT
          ? { error: 'emit_show rejected: ' + (rejection ?? 'invalid arguments') + '. Fix the arguments and call it again.' }
          : await this.runTool(call, registry, input.now);
        this.deps.onStep?.({ index: step, tool: call.name, args: call.args, result });
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
      }

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'user', content: 'You did not call a tool. Call one, and finish with ' + EMIT + '.' });
      }
    }

    throw new Error('brain: ' + maxSteps + ' step budget exhausted without a valid ' + EMIT);
  }

  /**
   * 该有的上下文一次拿齐。四路都**各自降级**：一个坏掉的来源不该让电台开不了口
   * —— 没有天气、没有日表、甚至口味语料读不出来，DJ 也得能播。
   */
  private async gather(input: BrainInput): Promise<Parameters<typeof systemPrompt>[0]> {
    const tailless = { genres: [] as string[], corpus: [] as { name: string; text: string }[], recent: [] };
    const taste = await this.deps.taste.read().catch(() => tailless);
    const recentPlays = await this.deps.store.recentPlays(10).catch(() => []);
    const plan: DayPlan | null = await this.deps.store.activePlan(localDateKey(input.now)).catch(() => null);
    const weather = await this.deps.env.weather(input.now).catch(() => null);
    return { now: input.now, trigger: input.trigger, userText: input.userText, taste, recentPlays, plan, weather };
  }

  private async runTool(call: LlmToolCall, registry: Map<string, Track>, now: Date): Promise<unknown> {
    const args = asRecord(call.args);
    try {
      switch (call.name) {
        case 'recommend_tracks': {
          const seed = { genres: asStrings(args.genres), mood: asString(args.mood) || undefined };
          return { tracks: remember(registry, await this.deps.music.recommend(seed, count(args.limit, 6))) };
        }
        case 'search_tracks': {
          const keywords = asString(args.keywords);
          if (keywords === '') return { error: '`keywords` is required' };
          return { tracks: remember(registry, await this.deps.music.search(keywords, count(args.limit, 6))) };
        }
        case 'today_plan': {
          // 日表里存的是 TrackRef（契约如此，ADR-0006）：补上 source 才是一首完整的 Track，
          // 也才能进本轮 registry 去给 emit_show 用。source 只是记号 —— 播放时按 songId 解析，与它无关。
          const refs = planRefs(await this.deps.store.activePlan(localDateKey(now)).catch(() => null));
          const tracks = remember(registry, refs.slice(0, count(args.limit, 9, 12)));
          return tracks.length === 0
            ? { tracks: [], note: 'No plan for today yet — build the set yourself.' }
            : { tracks };
        }
        case 'recent_plays': {
          const plays = await this.deps.store.recentPlays(count(args.limit, 10, 30));
          return {
            plays: plays.map((play) => ({
              songId: play.songId, title: play.title, artist: play.artist,
              skipped: play.skipped, at: play.ts,
            })),
          };
        }
        default:
          return { error: 'no such tool: ' + call.name };
      }
    } catch (error) {
      // 工具失败是**结果**不是崩溃：交回给模型，它才有机会换个说法或换个工具。
      return { error: error instanceof Error ? error.message : 'tool failed' };
    }
  }

  private tryParseShow(text: string, registry: Map<string, Track>): Show | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const verdict = this.readShow(JSON.parse(text.slice(start, end + 1)) as unknown, registry);
      return verdict.ok ? verdict.show : null;
    } catch {
      return null;
    }
  }

  /**
   * 校验是**硬**的：id 必须是本轮某次工具真的返回过的，`reason` 必须有，`say` 不能空。
   * 驳回时给出可操作的理由 —— 这条理由会原样回到模型手里，它是自愈的唯一入口。
   */
  private readShow(args: unknown, registry: Map<string, Track>): { ok: true; show: Show } | { ok: false; reason: string } {
    if (typeof args !== 'object' || args === null) return { ok: false, reason: '`arguments` must be an object' };
    const raw = asRecord(args);

    const say = Array.isArray(raw.say)
      ? raw.say.filter((line): line is string => typeof line === 'string').map((line) => line.trim()).filter((line) => line !== '')
      : [];
    if (say.length === 0) return { ok: false, reason: '`say` must contain at least one non-empty spoken line' };

    if (!Array.isArray(raw.play)) return { ok: false, reason: '`play` must be an array of track ids' };
    const ids = raw.play.filter((id): id is string => typeof id === 'string');
    const unknown = ids.filter((id) => !registry.has(id));
    if (unknown.length > 0) {
      return { ok: false, reason: 'unknown track id(s) ' + JSON.stringify(unknown) + ' — only ids a tool returned in this turn are allowed' };
    }
    const play: TrackRef[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const track = registry.get(id);
      if (track !== undefined && !seen.has(id)) {
        seen.add(id);
        play.push(asRef(track));
      }
    }
    if (play.length === 0) {
      // 挑得太少（或者一个都没挑）：从本轮真的取到过的候选里补足，而不是凭空造一首。
      for (const track of registry.values()) {
        if (play.length >= MIN_TRACKS) break;
        if (!seen.has(track.id)) {
          seen.add(track.id);
          play.push(asRef(track));
        }
      }
    }
    if (play.length === 0) return { ok: false, reason: 'no playable tracks: call recommend_tracks or search_tracks first' };

    const reason = asString(raw.reason);
    if (reason === '') return { ok: false, reason: '`reason` must be one non-empty sentence' };

    const segue = asString(raw.segue);
    return { ok: true, show: { say: say.slice(0, MAX_LINES), play: play.slice(0, MAX_TRACKS), reason, segue: segue === '' ? null : segue } };
  }
}

/** 日表 → 曲目。三个时段摊平、按顺序去重：同一天里同一首只该出现一次。 */
function planRefs(plan: DayPlan | null): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const block of plan?.blocks ?? []) {
    for (const ref of block.tracks) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      out.push({ ...ref, source: 'plan' });
    }
  }
  return out;
}

/** 记住本轮见过的曲目：`emit_show` 的 id 只能从这里查，这是"不许编 id"的执行点。 */
function remember(registry: Map<string, Track>, tracks: Track[]): Track[] {
  for (const track of tracks) registry.set(track.id, track);
  return tracks;
}

/** 交给 UI 的只有 ref：队列契约就是 TrackRef，多一个字段都是契约变更（ADR-0006）。 */
function asRef(track: Track): TrackRef {
  return { id: track.id, title: track.title, artist: track.artist };
}