import { useEffect, useRef } from 'react';
import type { DjMessage, SpokenLine, TrackRef } from '../../../shared/domain.ts';

const WHO: Record<DjMessage['role'], string> = { dj: 'EDGERUNNER', me: 'ME', system: 'SYSTEM' };
const FACE: Record<DjMessage['role'], string> = { dj: 'E', me: 'M', system: '' };

const stamp = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });

/* 口播挂在 meta.turns 上（同样是可选字段）。入口只有一个：没听过写 PLAY，听过写 REPLAY（用户定）。 */
export const turnsOf = (entry: DjMessage): SpokenLine[] =>
  Array.isArray(entry.meta?.turns) ? (entry.meta.turns as SpokenLine[]) : [];

/* 曲目卡挂在 meta.tracks 上（可选字段，契约没动）。点一下就播（交互决策 3）。 */
const tracksOf = (entry: DjMessage): TrackRef[] =>
  Array.isArray(entry.meta?.tracks) ? (entry.meta.tracks as TrackRef[]) : [];

/** ⑥ DJ 面板。逐句浮现靠后端一句一句推 say；这里只负责长出来。 */
export function DjFeed({
  feed,
  live,
  speaking,
  currentId,
  onPlay,
  onOral,
  heard,
}: {
  feed: DjMessage[];
  live: boolean;
  speaking: boolean;
  currentId: string | null;
  onPlay: (songId: string) => void;
  heard: ReadonlySet<string>;
  onOral: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 滚到最新一条。整条比可视区还高的时候，宁可让正文从顶上开始读 —— 否则长口播会被挤成
  // 「一个空框」（用户在截图里看到的正是这个）。
  useEffect(() => {
    const list = listRef.current;
    const last = list?.querySelector<HTMLElement>('.msg:last-of-type');
    if (!list || !last) return;
    last.scrollIntoView({ block: last.offsetHeight <= list.clientHeight ? 'end' : 'start' });
  }, [feed]);

  return (
    <section className="feed">
      <div className="feed-head">
        <i className={live ? 'dot' : 'dot off'} />
        <span className="name">EdgeRunner</span>
        <span className="status" style={{ marginLeft: 'auto' }}>
          {speaking ? 'SPEAKING...' : live ? 'LIVE' : 'OFFLINE'}
        </span>
        <div className="spec" style={{ height: 13, opacity: speaking ? 1 : 0.35 }} aria-hidden="true">
          {[0.4, 0.75, 0.5, 0.9, 0.35, 0.65].map((height, index) => (
            <i key={index} style={{ height: `${height * 100}%` }} />
          ))}
        </div>
      </div>

      <div className="feed-list" ref={listRef}>
        <p className="sys">Connected to EdgeRunner server</p>
        {feed.map((entry) =>
          entry.role === 'system' ? (
            <p key={entry.id} className="sys">
              {entry.text}
            </p>
          ) : (
            <article key={entry.id} className={`msg ${entry.role}`}>
              <div className="who">{WHO[entry.role]}</div>
              <div className="line">
                <span className="avatar" aria-hidden="true">
                  {FACE[entry.role]}
                </span>
                <div className="bubble">{entry.text}</div>
              </div>
              <div className="meta">
                <span>{stamp(entry.ts)}</span>
                {entry.role === 'dj' && turnsOf(entry).length > 0 && (
                  <button className="reply" type="button" onClick={() => onOral(entry.id)}>
                    {heard.has(entry.id) ? 'REPLAY' : 'PLAY'}
                  </button>
                )}
              </div>
              {tracksOf(entry).length > 0 && (
                <div className="cards">
                  {tracksOf(entry).map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={track.id === currentId ? 'card-track is-current' : 'card-track'}
                      onClick={() => onPlay(track.id)}
                      aria-label={`Play ${track.title} by ${track.artist}`}
                    >
                      <span className="ct">
                        <span className="t">{track.title}</span>
                        <span className="a">{track.artist}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ),
        )}
      </div>
    </section>
  );
}