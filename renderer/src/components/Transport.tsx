import type { DjState, TrackRef } from '../../../shared/domain.ts';
import type { LyricLine } from '../api/lrc.ts';

const WAVE_BARS = [0.4, 0.75, 0.55, 0.95, 0.35, 0.7, 0.5, 0.85, 0.45, 0.65, 0.9, 0.3, 0.6, 0.8, 0.5];

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export interface TransportProps {
  track: TrackRef | null;
  djState: DjState | undefined;
  onAir: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  lyric: LyricLine[];
  lyricIndex: number;
  volume: number;
  feedHidden: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onBack: () => void;
  onVolume: (value: number) => void;
  onToggleFeed: () => void;
}

/** 运输条（宽窗）/ 卡片（窄窗）：同一个 DOM，CSS 折两次。 */
export function Transport(props: TransportProps) {
  const percent = props.durationMs > 0 ? Math.min(100, (props.positionMs / props.durationMs) * 100) : 0;
  const active = props.lyricIndex >= 0;
  const start = active ? props.lyricIndex : 0;
  const upcoming = props.lyric.slice(start, start + 3);

  return (
    <section className="deck">
      <div className="card-head narrow-only">
        <span className="avatar" aria-hidden="true">
          E
        </span>
        <span className="wordmark">EDGERUNNER</span>
        <span className="card-status">
          <i className={props.onAir ? 'dot' : 'dot off'} />
          {props.djState === 'speaking' ? 'Speaking...' : 'On air'}
        </span>
        <div className={props.djState === 'idle' ? 'wave idle' : 'wave'} aria-hidden="true">
          {WAVE_BARS.map((height, index) => (
            <i key={index} style={{ height: `${height * 100}%`, animationDelay: `${index * 70}ms` }} />
          ))}
        </div>
      </div>
      <div className="deck-head">
        <div className="cover" aria-hidden="true">
          {props.track ? props.track.title.slice(0, 1).toUpperCase() : '·'}
        </div>
        <div className="deck-title">
          <div className="kicker">
            {props.djState === 'speaking' ? 'SPEAKING...' : props.djState === 'thinking' ? 'THINKING...' : 'NOW PLAYING'}
          </div>
          <div className="title">{props.track ? props.track.title : 'Nothing playing'}</div>
          <div className="artist">{props.track ? props.track.artist : 'Waiting for the front desk...'}</div>
        </div>
        <div className="controls wide-only">
          <button className="ctl" type="button" onClick={props.onBack} aria-label="Previous track">
            ⏮
          </button>
          <button className="ctl main" type="button" onClick={props.onToggle} aria-label={props.playing ? 'Pause' : 'Play'}>
            {props.playing ? '❚❚' : '▶'}
          </button>
          <button className="ctl" type="button" onClick={props.onSkip} aria-label="Next track">
            ⏭
          </button>
        </div>
        <button className="text-btn" type="button" onClick={props.onToggleFeed} aria-pressed={props.feedHidden}>
          {props.feedHidden ? 'SHOW' : 'HIDE'}
        </button>
        <div className="vol wide-only">
          <span>VOL.</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={props.volume}
            onChange={(event) => props.onVolume(Number(event.target.value))}
            aria-label="Volume"
          />
        </div>
      </div>

      <div className="progress">
        <span className="time">{clock(props.positionMs)}</span>
        <div className="track">
          <div className="fill" style={{ width: `${percent}%` }} />
          <div className="thumb" style={{ left: `${percent}%` }} />
        </div>
        <span className="time right">{props.durationMs > 0 ? clock(props.durationMs) : '--:--'}</span>
      </div>

      {upcoming.length > 0 && (
        <ul className="lyric">
          {upcoming.map((line, offset) => (
            <li key={line.ms} className={active && offset === 0 ? 'lyric-line on' : 'lyric-line'}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}