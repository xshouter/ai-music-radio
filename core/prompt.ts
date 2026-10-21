import type { DayPlan, PlayEvent, TasteUpdate, Weather } from '../shared/domain.ts';
import type { PlanBlockSpec } from './plan.ts';
import { PLAN_PER_BLOCK } from './plan.ts';

export interface PromptContext {
  now: Date;
  trigger: 'schedule' | 'chat' | 'track_end' | 'manual';
  userText: string | undefined;
  taste: { genres: string[]; corpus: { name: string; text: string }[]; recent: TasteUpdate[] };
  recentPlays: PlayEvent[];
  plan: DayPlan | null;
  weather: Weather | null;
}

/**
 * 人设与"怎么说话"写在代码里（不是配置）：它是这个产品的一部分，不是运维参数。
 * 口播语言是**英文**（用户定的），所以这里连标点和缩写都是英文的写法 —— 交给模型"翻译"会走味。
 */
const PERSONA = [
  'You are EdgeRunner — a private DJ for exactly one listener. You cut records; you do not host a show.',
  'Your tagline, if it ever comes up: "Your mood is my prompt." You hate recommendation algorithms and you say so.',
  '',
  'Voice:',
  '- Write in English. Plain, spoken, low-key. No emoji, no hashtags, no radio hype, no "folks", no exclamation marks.',
  '- `say` is what is spoken out loud: one line per track in `play`, in the same order.',
  '- say[0] opens the set over the first track; every line after that introduces the track it plays over.',
  '- Write each line for that one track, never for the set as a whole: a sound, a tempo, an era, a mood — something you actually noticed. Two or three sentences, 40-55 words — that is 15-20 seconds spoken, which is the length a spoken intro should be.',
  '- Pitch the delivery to the genre. Ambient or downtempo: quiet, unhurried, plenty of air. Rock, punk or hip-hop: short, hard, leaning forward. Jazz or soul: warm, conversational. Electronic: precise, a little wry. Never borrow a tone from the wrong genre.',
  '- Never call yourself an AI or a model. Never mention tools, prompts, JSON, ids, or "the queue".',
  '- If the listener typed something, answer that first, then move to the music.',
  '- Do not list titles like a receipt. One name is enough, and only when it earns its place.',
  '',
  'How you work:',
  '- You have tools. The ONLY way to finish is to call `emit_show`.',
  '- Never invent track ids. Only use ids a tool returned in THIS turn.',
  '- 3-6 tracks. Contrast beats sameness. Never repeat a track the listener just skipped.',
  '- When you open the day or a block: call `today_plan` first and open with its first track. Its order is the one you chose this morning.',
  '- `reason` is one private sentence (not spoken): why this set, now.',
  '- `segue` is one optional spoken sentence for the crossfade; null when the set needs no glue.',
].join('\n');

/** 本地日历日（不是 UTC）：`Store.activePlan` 的 key 就是这个形状。 */
export const localDateKey = (at: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate());
};

const localClock = (at: Date): string =>
  String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');

const describePlay = (play: PlayEvent): string => {
  const marks: string[] = [];
  if (play.skipped) marks.push('skipped');
  if (play.endedAt !== null && !play.skipped) marks.push('finished');
  if (play.endedAt === null) marks.push('playing now');
  return '- [' + localClock(new Date(play.ts)) + '] ' + play.title + ' — ' + play.artist + (marks.length > 0 ? ' (' + marks.join(', ') + ')' : '');
};

/**
 * 给人看的语料只取前 600 字：taste.md 是"人写的"，长度不由我们控制，
 * 而这一段每一轮都要进 prompt —— 不设上限就等于让一次编辑把 token 预算吃掉。
 */
const clip = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit) + '…');

/** 「我现在知道什么」—— 两种任务共用的一段：时间 → 天气 → 口味 → 播放史 → 日表。 */
const knowledge = (ctx: PromptContext): string[] => {
  const lines: string[] = ['What you know right now:'];
  lines.push('- Local time: ' + ctx.now.toISOString() + ' (' + localClock(ctx.now) + ' local, ' + localDateKey(ctx.now) + ')');
  if (ctx.weather !== null) lines.push('- Weather: ' + ctx.weather.text + ', ' + Math.round(ctx.weather.tempC) + '°C');
  lines.push('- Taste (written by the listener; this is the source of truth):');
  for (const entry of ctx.taste.corpus) lines.push('  [' + entry.name + '] ' + clip(entry.text, 600));
  if (ctx.taste.corpus.length === 0) lines.push('  (empty — you have no corpus yet, so lean on the last few plays)');
  if (ctx.taste.genres.length > 0) lines.push('- Genres on rotation: ' + ctx.taste.genres.join(', '));
  if (ctx.recentPlays.length > 0) {
    lines.push('- Actually played, most recent first (facts, not predictions):');
    for (const play of ctx.recentPlays) lines.push('  ' + describePlay(play));
  }
  if (ctx.plan !== null && ctx.plan.blocks.length > 0) {
    lines.push('- Today\'s plan (a sketch, not a cage):');
    for (const block of ctx.plan.blocks) lines.push('  ' + block.start + '-' + block.end + ' ' + block.mood + ' [' + block.genres.join(', ') + ']');
  }
  return lines;
};

export function systemPrompt(ctx: PromptContext): string {
  return [PERSONA, '', ...knowledge(ctx)].join('\n');
}

export function userPrompt(ctx: PromptContext): string {
  switch (ctx.trigger) {
    case 'chat':
      return 'The listener says: ' + JSON.stringify(ctx.userText ?? '') + '\nAnswer them, then pick the music.';
    case 'track_end':
      return 'The last track just ended. Pick what plays next.';
    case 'manual':
      return 'The listener asked for a new set right now. Regenerate it.';
    case 'schedule':
      return 'It is ' + localClock(ctx.now) + '. The block is starting. Open the set: call `today_plan` first and start with its first track.';
  }
}

/**
 * 排日表那一轮的人设。**不是**把 PERSONA 换几个字 —— 那一段讲的是「开口说话」的规矩
 * （每首歌一句、语气跟着曲风），排表时一句都不说；套上它只会让模型开始写口播。
 */
const PLAN_PERSONA = [
  'You are EdgeRunner — a private DJ for exactly one listener. Right now you are not talking: you are laying out the day.',
  'Your tagline, if it ever comes up: "Your mood is my prompt." You hate recommendation algorithms and you say so.',
  '',
  'How you work:',
  '- You have tools. The ONLY way to finish is to call `emit_plan`.',
  '- Never invent track ids. Only use ids a tool returned in THIS turn.',
  '- The listener\'s own recommendations are the pool you draw from. Search when you want something specific that is not in it.',
  '- A block may be hours away: pick what belongs in that block, not what you feel like hearing now.',
  '- Never put the same track in two blocks.',
  '- Nothing you write here is spoken. Never mention tools, prompts, JSON, ids, or "the plan" out loud.',
].join('\n');

/**
 * 每格的「氛围提示」——**不是过滤器**。曲风仍然只服务搜索兜底（`core/plan.ts` 的 `BLOCKS`），
 * 交给模型的是一句人话的调性。未知 mood 退回那一格自己的曲风，不崩。
 */
const MOOD_FLAVOUR: Record<string, string> = {
  morning: 'warm, unhurried, acoustic-leaning',
  daytime: 'bright, mid-tempo, indie-leaning',
  'late-night': 'sparse, low, after-hours',
};

const moodFlavour = (block: PlanBlockSpec): string => MOOD_FLAVOUR[block.mood] ?? block.genres.join(', ');

/** 排日表的模板变量：三格写成编号清单，`emit_plan` 的 blocks 就按这个顺序数。 */
const blockSlots = (blocks: readonly PlanBlockSpec[]): string[] =>
  blocks.map((block, index) => '  ' + (index + 1) + '. ' + block.start + '-' + block.end + ' ' + block.mood + ': ' + moodFlavour(block));

/**
 * 排表那一轮的提示词。与 `systemPrompt` 共用「我现在知道什么」，但任务段、
 * 终局工具、user 那句话都不一样 —— 所以它是另一个函数，不是 systemPrompt 的一个开关。
 *
 * `search` 是两段式的开关：第一段（false）只给池子，并明说「曲风是氛围提示，不是过滤器」；
 * 第二段（true）只补那几格没填满的，到这里才提 `search_tracks`。
 */
export function planPrompt(ctx: PromptContext, blocks: readonly PlanBlockSpec[], search = false): { system: string; user: string } {
  const user = [
    'Lay out today as ' + blocks.length + ' blocks, in this order:',
    ...blockSlots(blocks),
    search
      ? 'These blocks are still short. Search with `search_tracks` for what they are missing — at most one search per block.'
      : 'Start with `daily_recommend`: those are this listener\'s own recommendations, and they are the pool.',
    PLAN_PER_BLOCK + ' tracks per block, in play order.',
    'The moods above are a flavour, not a filter.',
    'Finish with `emit_plan`.',
  ].join('\n');
  return { system: [PLAN_PERSONA, '', ...knowledge(ctx)].join('\n'), user };
}