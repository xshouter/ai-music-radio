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
import type { PlanBlockSpec } from '../plan.ts';
import { PLAN_PER_BLOCK } from '../plan.ts';
import { localDateKey, planPrompt, systemPrompt, userPrompt } from '../prompt.ts';

/** 一轮 tool 调用的观测点：调度器、开发时、测试都靠它看见"大脑到底做了什么"。 */
/** 一次校验的裁决。`value` 是终端工具（emit_show / emit_plan）交上来的东西。 */
type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };

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
  /** 默认 6 —— 预算按「一段」算，不是按整轮：第一段（池子）和第二段（补搜）各有 6 步。 */
  maxSteps?: number;
  temperature?: number;
  onStep?: (step: ToolStep) => void;
}

const EMIT = 'emit_show';
const EMIT_PLAN = 'emit_plan';
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
          description: 'one spoken line per track in `play`, in the same order: say[0] opens the first track. One or two sentences, under 30 words, written for that track and pitched to its genre.',
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

const byName = (name: string): LlmToolSpec => {
  const spec = TOOLS.find((tool) => tool.name === name);
  // 模块加载期就喊：TOOLS 被改名 / 删掉时，这里比"模型突然找不到工具"先发现。
  if (spec === undefined) throw new Error('brain: no such tool: ' + name);
  return spec;
};

/** 排表那一轮的终局工具（两段共用）：交三格，或者交补上的那几格。 */
const EMIT_PLAN_SPEC: LlmToolSpec = {
  name: EMIT_PLAN,
  description:
    'Emit the whole day and END your turn. One track-id list per block, in the order the blocks were given to you.',
  parameters: {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' } },
        description: 'One array of track ids per block, in block order, in play order. Only ids a tool returned in THIS turn.',
      },
      reason: { type: 'string', description: 'One private sentence, not spoken: why the day looks like this.' },
    },
    required: ['blocks'],
  },
};

/**
 * 排日表那一轮的工具集拆成两段（ADR-0031）：
 * - 第一段 `POOL_TOOLS` **没有** `search_tracks` —— 模型只能用池子填三格，池子优先是默认。
 * - 第二段 `SEARCH_TOOLS` 只补那几格没填满的，格子重新编号，搜索是例外。
 * 两段的终局都是 `emit_plan`；播歌那一轮的 `TOOLS` 一个字没动。
 */
export const POOL_TOOLS: readonly LlmToolSpec[] = [
  {
    name: 'daily_recommend',
    description:
      "This listener's own daily recommendations from the music source — the pool the day is laid out from. Returns tracks with ids you may use in emit_plan.",
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many candidates to return (1-50, default 30).' } },
      required: [],
    },
  },
  byName('recent_plays'),
  EMIT_PLAN_SPEC,
];

export const SEARCH_TOOLS: readonly LlmToolSpec[] = [byName('search_tracks'), EMIT_PLAN_SPEC];

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

/** 有的模型不调工具，把 JSON 直接写进正文。从一整段话里榨出那个对象 —— 认它，但不为它放宽校验。 */
const parseJson = (text: string): unknown | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
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
    const registry = new Map<string, Track>();
    return this.loop(
      [
        { role: 'system', content: systemPrompt(context) },
        { role: 'user', content: userPrompt(context) },
      ],
      registry,
      input.now,
      TOOLS,
      EMIT,
      (args) => this.readShow(args, registry),
      (text) => this.tryParseShow(text, registry),
    );
  }

  /**
   * 排今天的日表（ADR-0030 / 0031）。**同一个工具环**，分两段：
   * 第一段只有池子（日推 + 播放史），代码数出没填满的格；第二段只对那几格放开搜索。
   * 抛错 = 这一轮排不出来 —— 调用方退到逐格搜索，电台不停（ADR-0024）。
   */
  async plan(input: BrainInput, blocks: readonly PlanBlockSpec[]): Promise<TrackRef[][]> {
    const context = await this.gather(input);
    const prompt = planPrompt(context, blocks);
    const registry = new Map<string, Track>();
    const first = await this.loop(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      registry,
      input.now,
      POOL_TOOLS,
      EMIT_PLAN,
      (args) => this.readPlan(args, registry, blocks.length),
      (text) => this.tryParsePlan(text, registry, blocks.length),
    );

    // 池子把三格填满就到此为止：第二段一个 token 都不再多发。
    const short = first.map((refs, index) => (refs.length < PLAN_PER_BLOCK ? index : -1)).filter((index) => index >= 0);
    if (short.length === 0) return first;

    // 第二段：只带没填满的那几格（重新编号），放开搜索。整段失败就退回第一段（ADR-0030 的「缺哪格补哪格」）。
    const refill = planPrompt(context, short.map((index) => blocks[index]), true);
    const registry2 = new Map<string, Track>();
    const second: TrackRef[][] | null = await this.loop(
      [
        { role: 'system', content: refill.system },
        { role: 'user', content: refill.user },
      ],
      registry2,
      input.now,
      SEARCH_TOOLS,
      EMIT_PLAN,
      (args) => this.readPlan(args, registry2, short.length),
      (text) => this.tryParsePlan(text, registry2, short.length),
    ).catch(() => null);
    if (second === null) return first;

    // 只覆盖「真的更多」的格：一段给了两首、二段只找回一首时，不许退步。
    const merged = first.map((refs) => refs);
    short.forEach((slot, index) => {
      if (second[index].length > merged[slot].length) merged[slot] = second[index];
    });
    return merged;
  }

  /**
   * 工具环本体。两种任务共用：每一轮都把工具结果原样交回，并且**在模型自己说"完了"之前
   * 不接受任何结论**（ADR-0015）。差别只在终局工具、工具集、以及怎么读它的参数。
   */
  private async loop<T>(
    messages: LlmMessage[],
    registry: Map<string, Track>,
    now: Date,
    tools: readonly LlmToolSpec[],
    terminal: string,
    read: (args: unknown) => Verdict<T>,
    fromText: (text: string) => T | null,
  ): Promise<T> {
    const maxSteps = this.deps.maxSteps ?? 6;

    for (let step = 0; step < maxSteps; step += 1) {
      // 最后一步**强制**要定稿：与其在步数耗尽后抛错，不如给它一次"必须定稿"的机会。
      const lastStep = step === maxSteps - 1;
      const response = await this.deps.llm.complete({
        model: this.deps.model,
        messages,
        tools: [...tools],
        toolChoice: lastStep ? { name: terminal } : 'auto',
        ...(this.deps.temperature === undefined ? {} : { temperature: this.deps.temperature }),
      });

      let rejection: string | null = null;
      const candidate = response.toolCalls.find((call) => call.name === terminal);
      if (candidate !== undefined) {
        const verdict = read(candidate.args);
        if (verdict.ok) return verdict.value;
        rejection = verdict.reason;
        if (lastStep) throw new Error('brain: ' + terminal + ' 始终不合法 —— ' + verdict.reason);
      }

      // 不用工具的模型：有的会把 JSON 直接写进正文。认它，但不为它放宽校验 —— 走同一套 read。
      if (candidate === undefined && response.toolCalls.length === 0 && response.text.trim() !== '') {
        const parsed = fromText(response.text);
        if (parsed !== null) return parsed;
      }

      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });

      // **每个** tool_call 都要有回音，包括被驳回的终局调用：少一条，OpenAI 面直接 400。
      for (const call of response.toolCalls) {
        const result = call.name === terminal
          ? { error: terminal + ' rejected: ' + (rejection ?? 'invalid arguments') + '. Fix the arguments and call it again.' }
          : await this.runTool(call, registry, now);
        this.deps.onStep?.({ index: step, tool: call.name, args: call.args, result });
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
      }

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'user', content: 'You did not call a tool. Call one, and finish with ' + terminal + '.' });
      }
    }

    throw new Error('brain: ' + maxSteps + ' step budget exhausted without a valid ' + terminal);
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
          return { tracks: remember(registry, await this.deps.music.search(keywords, count(args.limit, 6))).map(asRef) };
        }
        case 'daily_recommend': {
          // 空场景词就是日推那一条路（netease 源：无场景词 → /recommend/songs → 退公开新歌）。
          // 交给模型的那份只留 id/title/artist：池子里的和搜来的看起来一样有料，它才肯先挑池子（ADR-0031）。
          return { tracks: remember(registry, await this.deps.music.recommend({}, count(args.limit, 30, 50))).map(asRef) };
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
    const args = parseJson(text);
    if (args === null) return null;
    const verdict = this.readShow(args, registry);
    return verdict.ok ? verdict.value : null;
  }

  private tryParsePlan(text: string, registry: Map<string, Track>, slots: number): TrackRef[][] | null {
    const args = parseJson(text);
    if (args === null) return null;
    const verdict = this.readPlan(args, registry, slots);
    return verdict.ok ? verdict.value : null;
  }

  /**
   * 校验是**硬**的：id 必须是本轮某次工具真的返回过的，`reason` 必须有，`say` 不能空。
   * 驳回时给出可操作的理由 —— 这条理由会原样回到模型手里，它是自愈的唯一入口。
   */
  private readShow(args: unknown, registry: Map<string, Track>): Verdict<Show> {
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
    return { ok: true, value: { say: say.slice(0, MAX_LINES), play: play.slice(0, MAX_TRACKS), reason, segue: segue === '' ? null : segue } };
  }

  /**
   * 日表的校验和 show **同源**：id 必须是本轮工具真的返回过的。
   * 但它**不**照搬 MIN_TRACKS —— 日表是草图，一格空着不算坏（那一格由调用方退到搜索）。
   * 只认前 `slots` 个块：三格是产品的脾气，不是模型的输入。
   */
  private readPlan(args: unknown, registry: Map<string, Track>, slots: number): Verdict<TrackRef[][]> {
    if (typeof args !== 'object' || args === null) return { ok: false, reason: '`arguments` must be an object' };
    const raw = asRecord(args);
    if (!Array.isArray(raw.blocks)) return { ok: false, reason: '`blocks` must be an array with one track-id array per block' };

    const blocks: TrackRef[][] = [];
    for (let index = 0; index < slots; index += 1) {
      const slot: unknown = raw.blocks[index];
      const ids = Array.isArray(slot) ? slot.filter((id: unknown): id is string => typeof id === 'string') : [];
      const unknown = ids.filter((id) => !registry.has(id));
      if (unknown.length > 0) {
        return { ok: false, reason: 'unknown track id(s) ' + JSON.stringify(unknown) + ' in block ' + (index + 1) + ' — only ids a tool returned in this turn are allowed' };
      }
      const refs: TrackRef[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        const track = registry.get(id);
        if (track !== undefined && !seen.has(id)) {
          seen.add(id);
          refs.push(asRef(track));
        }
      }
      blocks.push(refs);
    }
    if (blocks.every((refs) => refs.length === 0)) {
      return { ok: false, reason: 'no tracks in any block: call daily_recommend or search_tracks first' };
    }
    return { ok: true, value: blocks };
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