import { useEffect } from 'react';
import type { TasteDoc } from '../../../shared/api-types.ts';
import { Icon } from './Icon.tsx';

const STATS = [
  { label: 'ON AIR', value: '24/7' },
  { label: 'GENRES', value: '∞' },
  { label: 'LISTENER', value: '1' },
];

/** ③ DJ 详情弹层。点顶栏头像弹出；点空白处或 Esc 关掉。
    曲风胶囊来自 TasteDoc.genres —— 是数据，不是写死的装饰（ADR-0010）。 */
export function DjCard({ taste, onClose }: { taste: TasteDoc | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="DJ profile"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dj-card">
        <div className="dj-top">
          <span className="dj-face" aria-hidden="true">
            E
          </span>
          <div>
            <div className="dj-name">EdgeRunner</div>
            <div className="dj-slogan">一开机我就打碟</div>
          </div>
        </div>

        <div className="dj-sub">
          你的私人dj，会打碟的taste.md <Icon name="headphone" size={12} />
        </div>
        <div className="dj-motto">
          Your mood is my prompt.
          <br />
          I hate algorithm. I have taste.
        </div>

        <div className="dj-stats">
          {STATS.map((stat) => (
            <div className="dj-stat" key={stat.label}>
              <div className="l">{stat.label}</div>
              <div className="v">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="dj-genres">
          {(taste?.genres ?? []).map((genre) => (
            <span className="genre" key={genre}>
              {genre}
            </span>
          ))}
        </div>

        <div className="dj-foot">EDGERUNNER × TASTE.MD</div>
      </div>
    </div>
  );
}