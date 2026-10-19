import { useEffect, useRef } from 'react';
import type { DjMessage, TrackRef } from '../../../shared/domain.ts';

const WHO: Record<DjMessage['role'], string> = { dj: 'EDGERUNNER', me: 'ME', system: 'SYSTEM' };
const FACE: Record<DjMessage['role'], string> = { dj: 'E', me: 'M', system: '' };

const stamp = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });

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
  onReply,
}: {
  feed: DjMessage[];
  live: boolean;
  speaking: boolean;
  currentId: string | null;
  onPlay: (songId: string) => void;
  onReply: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
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

      <div className="feed-list">
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
                {entry.role === 'dj' && (
                  <button className="reply" type="button" onClick={onReply}>
                    REPLY
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
                      </span>
                      <span className="a">{track.artist}</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ),
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}