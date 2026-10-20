import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { SpokenLine, TrackRef } from '../../../shared/domain.ts';
import { Icon } from './Icon.tsx';

const mmss = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const BARS = 56;

/**
 * ① 口播全屏态 —— 参考源那张 616×876 卡片的 1:1 复刻。
 * 上方进度条 = 歌曲进度，最下方 = 口播进度（用户定）；✕ 在白色卡片右上角（用户定的位置）。
 * 播放权在 useRadio 的串行管道里（ADR-0029），这里只是它的**视图**：打开不重播、✕ 才停止（用户定）。
 * lines 是这一场口播说过的所有句子（一首歌一条），当前那一条永远在最后。
 * 逐词高亮的时钟就是那一条 <audio> 本身 —— 词时间戳由 TTS 给（ADR-0012）。
 * 文字一律正常对比度，不做渐隐（用户定：渐隐的字读不动）。
 */
export function OnAir({ lines, track, playing, positionMs, durationMs, oralPlaying, oralMs, onToggleSong, onToggleOral, onSeekOral, onClose }: {
  lines: SpokenLine[];
  track: TrackRef | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  oralPlaying: boolean;
  oralMs: number;
  onToggleSong: () => void;
  onToggleOral: () => void;
  onSeekOral: (ms: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const at = Math.max(0, lines.length - 1);
  const line: SpokenLine | undefined = lines[at];
  const totalMs = line?.words.at(-1)?.endMs ?? 0;
  const cut = line ? line.words.findIndex((word) => oralMs >= word.startMs && oralMs < word.endMs) : -1;

  // 正在说的那一条滚进视野。block:'nearest' —— 不用 smooth，避免自己触发滚动事件。
  useEffect(() => {
    scrollRef.current?.querySelector(`[data-turn="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at, lines.length]);

  // 波形：参考源的做法 —— 程序化柱状，说的时候相位快，停着的时候慢慢飘。
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cw = 0;
    let ch = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const rand = (i: number) => {
      const x = Math.sin(i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    let phase = 0;
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cw, ch);
      const step = 4;
      const count = Math.max(1, Math.floor(cw / step));
      phase += oralPlaying ? 0.06 : 0.008;
      for (let i = 0; i < count; i += 1) {
        const x = i * step + (cw - count * step) / 2;
        const env = 0.55 + 0.45 * Math.sin((i / count) * Math.PI);
        const n1 = Math.sin(i * 0.18 + phase * 2.2) * 0.5 + 0.5;
        const n2 = Math.sin(i * 0.42 + phase * 1.1 + rand(i) * 6) * 0.5 + 0.5;
        const n3 = Math.sin(i * 0.08 + phase * 0.8) * 0.5 + 0.5;
        const amp = n1 * 0.55 + n2 * 0.35 + n3 * 0.1;
        const h = Math.max(4, Math.min(ch - 4, amp * env * ch * 1.25 + rand(i + Math.floor(phase * 3)) * 12));
        const alpha = Math.max(0.18, Math.min(1, 0.55 + 0.4 * (1 - ((i / count - 0.5) * 2) ** 2)));
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(x, ch - h, 2, h);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [oralPlaying]);

  const bars = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        const n1 = Math.sin(i * 0.6) * 0.5 + 0.5;
        const n2 = Math.sin(i * 0.23 + 1.3) * 0.5 + 0.5;
        const env = 0.5 + 0.5 * Math.sin((i / BARS) * Math.PI);
        return 6 + (n1 * 0.6 + n2 * 0.4) * env * 18;
      }),
    [],
  );
  const playedBars = totalMs > 0 ? Math.round((oralMs / totalMs) * BARS) : 0;
  const songPct = durationMs > 0 ? Math.max(0, Math.min(100, (positionMs / durationMs) * 100)) : 0;

  // 拖口播进度条只在这一条里跳 —— 一条歌一段口播，没有跨条的进度可言。
  const seek = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (totalMs <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeekOral(ratio * totalMs);
  };

  return (
    <section className="onair" aria-label="On air — the DJ is talking">
      <header className="oa-head">
        <div className="oa-top">
          <div>
            <div className="oa-name">
              <span className="oa-face" aria-hidden="true">E</span>
              EdgeRunner
            </div>
            <div className="oa-status">
              <i className={oralPlaying ? 'dot' : 'dot off'} />
              {oralPlaying ? 'Speaking…' : 'Standing by…'}
            </div>
          </div>
          <div className="oa-clock">{mmss(oralMs)}</div>
        </div>
        <div className="oa-wave-wrap" aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
      </header>

      <div className="oa-body">
        <button className="oa-close" type="button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={12} />
        </button>

        <div className="oa-meta">
          <div className="oa-title">{track?.title ?? 'Nothing playing'}</div>
          <div className="oa-sub">{track?.artist ?? '—'}</div>
          <div className="oa-mini">
            <button className="oa-mp" type="button" onClick={onToggleSong} aria-label={playing ? 'Pause the song' : 'Play the song'}>
              <Icon name={playing ? 'pause' : 'play'} size={9} />
            </button>
            <div className="oa-line">
              <div className="oa-fill" style={{ width: `${songPct}%` }} />
            </div>
            <div className="oa-mptime">
              {mmss(positionMs)} / {durationMs > 0 ? mmss(durationMs) : '--:--'}
            </div>
          </div>
        </div>

        <div className="oa-transcript">
          <div className="oa-scroll" ref={scrollRef}>
            {lines.map((spoken, index) => (
              <div className="oa-turn" key={index} data-turn={index}>
                <div className="oa-turn-head">
                  <span className="who">EdgeRunner</span> • {mmss(index === at ? oralMs : (spoken.words.at(-1)?.endMs ?? 0))}
                </div>
                <div className="oa-turn-body">
                  {spoken.words.map((word, wordIndex) => (
                    <span key={wordIndex}>
                      <span className={index === at && wordIndex === cut ? 'oa-word is-current' : 'oa-word'}>
                        {word.text}
                      </span>{' '}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="oa-player">
          <div className="oa-ptime">{mmss(oralMs)}</div>
          <button className="oa-bars" type="button" onClick={seek} aria-label="Seek the spoken intro">
            {bars.map((height, index) => (
              <i key={index} className={index < playedBars ? 'oa-bar is-played' : 'oa-bar'} style={{ height }} />
            ))}
          </button>
          <button className="oa-play" type="button" onClick={onToggleOral} aria-label={oralPlaying ? 'Pause' : 'Play'}>
            <Icon name={oralPlaying ? 'pause' : 'play'} size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}