import type { DjState, TrackRef } from '../../../shared/domain.ts';
import { Icon } from './Icon.tsx';

const BARS = [0.45, 0.8, 0.55, 1, 0.35, 0.7, 0.5];

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export interface TransportProps {
  track: TrackRef | null;
  djState: DjState | undefined;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  queueShown: boolean;
  onToggle: () => void;
  onStop: () => void;
  onSkip: () => void;
  onBack: () => void;
  onVolume: (value: number) => void;
  onToggleQueue: () => void;
}

/** ③④ 运输条 + 进度。左侧频谱点进口播界面（3.8 接上）。 */
export function Transport(props: TransportProps) {
  const percent = props.durationMs > 0 ? Math.min(100, (props.positionMs / props.durationMs) * 100) : 0;
  const kicker = props.djState === 'speaking' ? 'SPEAKING...' : props.djState === 'thinking' ? 'THINKING...' : 'PLAYING';

  return (
    <section className="transport">
      <div className="bar">
        <div className="spec" aria-hidden="true">
          {BARS.map((height, index) => (
            <i key={index} style={{ height: `${height * 100}%` }} />
          ))}
        </div>
        <div className="np">
          <div className="t">
            {props.track ? `${props.track.title}  -  ${props.track.artist}` : 'Waiting for the front desk...'}
          </div>
          <div className="k">{kicker}</div>
        </div>
        <div className="ctls">
          <button className="ctl" type="button" onClick={props.onBack} aria-label="Previous track">
            <Icon name="prev" />
          </button>
          <button className="ctl" type="button" onClick={props.onToggle} aria-label={props.playing ? 'Pause' : 'Play'}>
            <Icon name={props.playing ? 'pause' : 'play'} />
          </button>
          <button className="ctl" type="button" onClick={props.onSkip} aria-label="Next track">
            <Icon name="next" />
          </button>
          <button className="ctl" type="button" onClick={props.onStop} aria-label="Stop">
            <Icon name="stop" />
          </button>
          <button className="ctl" type="button" aria-disabled="true" aria-label="Like this track" title="Favorites arrive in 3.7">
            <Icon name="heart" />
          </button>
        </div>
        <div className="tools">
          <button className="pill" type="button" onClick={props.onToggleQueue} aria-pressed={props.queueShown}>
            {props.queueShown ? 'HIDE' : 'LIST'}
          </button>
          <button className="pill" type="button" aria-disabled="true" title="Favorites arrive in 3.7">
            FAV
          </button>
        </div>
        <div className="vol">
          <span>VOL</span>
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
        </div>
        <span className="time right">{props.durationMs > 0 ? clock(props.durationMs) : '--:--'}</span>
      </div>
    </section>
  );
}