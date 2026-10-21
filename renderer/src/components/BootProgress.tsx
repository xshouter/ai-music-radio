import { useEffect, useRef, useState } from 'react';
import type { BootProgress as BootReport } from '../../../shared/api-types.ts';

/*
 * 开机这一段（排表 → 写开场稿 → 合成语音）的进度界面。
 *
 * 终端风：深底、等宽字、逐行打勾。它不是"另一个页面"，是**挡在主界面前面的一块玻璃** ——
 * 第一句口播出声时就淡出，把屏幕交还给口播卡。
 *
 * 三条纪律（需求文档「行为（冻结）」）：
 *   - 只有后端真的发过步骤才显示（后端保证：当天已有日表时一条都不发）→ 不闪。
 *   - 最短展示 800ms：排表太快也不让它像一次闪屏。
 *   - 结束由后端说了算（done），这里只负责停一下再走。
 */

/* 步骤 id → 人话。契约里是 UX 概念，不是工具名，所以文案只住在这里。 */
const STEP_COPY = {
  'daily-pool': 'reading your daily recommendations',
  'recent-plays': 'scanning your recent plays',
  'deep-search': 'digging deeper for the moods the pool missed',
  'draft-plan': 'drafting today’s schedule',
  'opening-line': 'writing your opening line',
} as const;

const MIN_SHOWN_MS = 800;
const HOLD_MS = 600;
const FADE_MS = 320;

export function BootProgress({ progress }: { progress: BootReport | null }) {
  // 三步：hidden → shown → leaving（leaving 期间交给 CSS 淡出，淡完才卸载）。
  const [stage, setStage] = useState<'hidden' | 'shown' | 'leaving'>('hidden');
  const shownAt = useRef(0);

  useEffect(() => {
    if (progress === null || progress.steps.length === 0) return;
    if (progress.phase === 'running') {
      if (shownAt.current === 0) shownAt.current = Date.now();
      setStage('shown');
      return;
    }
    if (shownAt.current === 0) return; // 没显过（当天已有日表）→ 一下都不闪
    const wait = Math.max(HOLD_MS, MIN_SHOWN_MS - (Date.now() - shownAt.current));
    const timer = setTimeout(() => setStage('leaving'), wait);
    return () => clearTimeout(timer);
  }, [progress]);

  useEffect(() => {
    if (stage !== 'leaving') return;
    const timer = setTimeout(() => setStage('hidden'), FADE_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  if (stage === 'hidden' || progress === null) return null;

  const running = progress.phase === 'running';
  return (
    <section className={stage === 'leaving' ? 'boot is-leaving' : 'boot'} aria-label="Signing on">
      <div className="boot-head">
        EDGERUNNER FM<i className="dot" /> <span>SIGNING ON</span>
      </div>
      <ul className="boot-lines">
        {progress.steps.map((step, index) => {
          const active = running && index === progress.steps.length - 1;
          return (
            <li key={step} className={active ? 'boot-line is-active' : 'boot-line'}>
              <span className="boot-bullet" aria-hidden="true">
                {active ? '>' : '·'}
              </span>
              <span className="boot-text">{STEP_COPY[step]}</span>
              <span className="boot-mark" aria-hidden="true">
                {active ? '' : '✓'}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="boot-foot">{running ? 'This takes a moment — the DJ is picking your day.' : 'Done.'}</div>
    </section>
  );
}