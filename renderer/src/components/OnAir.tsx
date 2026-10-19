import { useEffect, useMemo, useRef, useState } from 'react';
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
 * 逐词高亮的时钟是「这一句的 <audio>」本身 —— 真 TTS 接上后这里一行都不用改。
 * 文字一律正常对比度，不做渐隐（用户定：渐隐的字读不动）。
 */
export function OnAir({ turns, track, playing, positionMs, durationMs, onToggleSong, onClose }: {
  turns: SpokenLine[];
  track: TrackRef | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  onToggleSong: () => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seekRef = useRef(0);
  const [turn, setTurn] = useState(0);
  const [turnMs, setTurnMs] = useState(0);
  const [oralPlaying, setOralPlaying] = useState(true);

  // 每句的起点 + 口播总长：只由词时间戳推出（mock 的音频长度跟它同源）。
  const [starts, totalMs] = useMemo(() => {
    const offsets: number[] = [];
    let at = 0;
    for (const line of turns) {
      offsets.push(at);
      at += line.words.at(-1)?.endMs ?? 0;
    }
    return [offsets, at] as const;
  }, [turns]);

  const line: SpokenLine | undefined = turns[turn] ?? turns[0];
  const oralMs = (starts[turn] ?? 0) + turnMs;

  // 口播时钟：<audio> 说了算。40ms 才提交一次，免得每帧都重渲染。
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setOralPlaying(!audio.paused);
        const next = audio.currentTime * 1000;
        setTurnMs((prev) => (Math.abs(next - prev) >= 40 ? next : prev));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // 换句 → 换音频源，接着播。seekRef 只在拖动进度条时非零。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !line) return;
    audio.src = line.audioUrl;
    audio.currentTime = seekRef.current / 1000;
    seekRef.current = 0;
    setTurnMs(audio.currentTime * 1000);
    void audio.play().catch(() => undefined);
  }, [line]);

  // 正在说的那一句滚进视野。block:'nearest' —— 不用 smooth，避免自己触发滚动事件。
  useEffect(() => {
    scrollRef.current?.querySelector(`[data-turn="${turn}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [turn]);

  // 波形：参考源的做法 —— 程序化柱状，播的时候相位快、停的时候慢慢飘。
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
      const audio = audioRef.current;
      phase += audio && !audio.paused ? 0.06 : 0.008;
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
  }, []);

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

  const speakNext = () => setTurn((prev) => (prev + 1 < turns.length ? prev + 1 : prev));

  const toggleOral = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const seek = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (totalMs <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const at = ratio * totalMs;
    let index = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if ((starts[i] ?? 0) <= at) index = i;
    }
    const withinMs = at - (starts[index] ?? 0);
    const audio = audioRef.current;
    if (index === turn && audio) audio.currentTime = withinMs / 1000;
    else {
      seekRef.current = withinMs;
      setTurn(index);
    }
  };

  const cut = line ? line.words.findIndex((word) => turnMs >= word.startMs && turnMs < word.endMs) : -1;

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
              {oralPlaying ? 'Speaking…' : 'Paused'}
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
            {turns.map((spoken, index) => (
              <div className="oa-turn" key={spoken.index} data-turn={index}>
                <div className="oa-turn-head">
                  <span className="who">EdgeRunner</span> • {mmss(starts[index] ?? 0)}
                </div>
                <div className="oa-turn-body">
                  {spoken.words.map((word, wordIndex) => (
                    <span key={wordIndex}>
                      <span className={index === turn && wordIndex === cut ? 'oa-word is-current' : 'oa-word'}>
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
          <button className="oa-play" type="button" onClick={toggleOral} aria-label={oralPlaying ? 'Pause' : 'Play'}>
            <Icon name={oralPlaying ? 'pause' : 'play'} size={14} />
          </button>
        </div>

        <audio ref={audioRef} onEnded={speakNext} />
      </div>
    </section>
  );
}