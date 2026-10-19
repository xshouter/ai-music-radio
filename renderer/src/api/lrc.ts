// LRC 自解析（需求·假设 4：不引第三方库）。
// 只认 [mm:ss.xx] 一种时间戳；一行多个时间戳取第一个 —— 够用，且失败就退化成纯文本。

export interface LyricLine {
  ms: number;
  text: string;
}

const STAMP = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const stamp = STAMP.exec(raw);
    if (!stamp) continue;
    const text = raw.slice(stamp.index + stamp[0].length).trim();
    if (!text) continue;
    const fraction = (stamp[3] ?? '0').padEnd(3, '0');
    lines.push({
      ms: Number(stamp[1]) * 60_000 + Number(stamp[2]) * 1000 + Number(fraction),
      text,
    });
  }
  return lines.sort((a, b) => a.ms - b.ms);
}

/** 当前该高亮第几行；还没到第一句时返回 -1。 */
export function lineAt(lines: LyricLine[], positionMs: number): number {
  let found = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && line.ms <= positionMs) found = i;
    else break;
  }
  return found;
}