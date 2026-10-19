import { useEffect, useRef } from 'react';
import type { DjMessage } from '../../../shared/domain.ts';

const WHO: Record<DjMessage['role'], string> = { dj: 'EDGERUNNER', me: 'YOU', system: 'SYSTEM' };

const stamp = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });

/** 口播流水。逐句浮现靠后端一句一句推 say；这里只负责长出来。 */
export function DjFeed({ feed, hidden, live }: { feed: DjMessage[]; hidden: boolean; live: boolean }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [feed]);

  if (hidden) return null;

  return (
    <section className="panel feed-panel">
      <div className="panel-head">
        <span>DJ FEED</span>
        <span className={live ? 'live' : 'live off'}>{live ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      <div className="feed-list">
        {feed.length === 0 ? (
          <p className="empty">Say something to the DJ to get it started.</p>
        ) : (
          feed.map((entry) => (
            <article key={entry.id} className={`feed-item ${entry.role}`}>
              <div className="who">
                {WHO[entry.role]} · {stamp(entry.ts)}
              </div>
              <p>{entry.text}</p>
            </article>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}