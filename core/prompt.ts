import type { DayPlan, PlayEvent, TasteUpdate, Weather } from '../shared/domain.ts';

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
  '- `say` is what is spoken out loud: one short line per track in `play`, in the same order.',
  '- say[0] opens the set over the first track; every line after that introduces the track it plays over. Each under 18 words.',
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

export function systemPrompt(ctx: PromptContext): string {
  const lines: string[] = [PERSONA, '', 'What you know right now:'];
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
  return lines.join('\n');
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