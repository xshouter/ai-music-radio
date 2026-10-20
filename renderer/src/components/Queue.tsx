import { useEffect, useRef, useState } from 'react';
import type { TrackRef } from '../../../shared/domain.ts';

/**
 * ⑤ QUEUE。两种来源在同一块面板里切换（需求 3.7 决策 6）：AI 推荐 ↔ FAV。
 * 点某一行 = 切到那首歌（交互决策 1）；FAV 源里行尾的歌手在悬停/聚焦时被 `✕` 替换（需求 3.7）。
 */
export function Queue({
  queue,
  favorites,
  source,
  currentId,
  onPlay,
  onFavorite,
  onSource,
}: {
  queue: TrackRef[];
  favorites: TrackRef[];
  source: 'ai' | 'fav';
  currentId: string | null;
  onPlay: (songId: string) => void;
  onFavorite: (track: TrackRef, on: boolean) => void;
  onSource: (source: 'ai' | 'fav') => void;
}) {
  const list = source === 'fav' ? favorites : queue;
  const [removed, setRemoved] = useState<TrackRef | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 删的是用户数据，所以必须留一条回头路：3 秒内表头右侧变成可点的 REMOVED — UNDO。
  const remove = (track: TrackRef) => {
    setRemoved(track);
    onFavorite(track, false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRemoved(null), 3000);
  };

  const undo = () => {
    window.clearTimeout(timer.current);
    setRemoved(null);
    if (removed) onFavorite(removed, true);
  };

  return (
    <section className="queue">
      <div className="q-head">
        <span>{source === 'fav' ? 'FAVORITES' : 'QUEUE'}</span>
        <div className="q-right">
        {removed && source === 'fav' ? (
          <button className="undo" type="button" onClick={undo}>
            REMOVED — UNDO
          </button>
        ) : (
          <span>{list.length} TRACKS</span>
        )}
          {/* 来源开关跟着列表走（需求 3.7）：它说的是「你在看哪一份」，不是播放动作。 */}
          <div className="seg q-seg">
            <button type="button" aria-pressed={source === 'ai'} onClick={() => onSource('ai')}>AI</button>
            <button type="button" aria-pressed={source === 'fav'} onClick={() => onSource('fav')}>FAV</button>
          </div>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="empty">
          {source === 'fav' ? 'No favorites yet. Hit ♡ on the player.' : 'Nothing queued yet.'}
        </p>
      ) : (
        <div className="q-list">
          {list.map((track, index) => (
            <div
              key={track.id}
              className={track.id === currentId ? 'q-row is-current' : 'q-row'}
              role="button"
              tabIndex={0}
              onClick={() => onPlay(track.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPlay(track.id);
                }
              }}
            >
              <span className="i">{index + 1}</span>
              <span className="t">{track.title}</span>
              {source === 'fav' ? (
                <span className="tail">
                  <span className="a">{track.artist}</span>
                  <button
                    className="x"
                    type="button"
                    aria-label={`Remove ${track.title} from favorites`}
                    onClick={(event) => {
                      event.stopPropagation(); // 一行上两个动作，必须互斥（需求 3.7）
                      remove(track);
                    }}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <span className="a">{track.artist}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}