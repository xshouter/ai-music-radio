import type { TrackRef } from '../../../shared/domain.ts';

/** 队列。当前行靠绿色左边条认出来 —— 参考里就是这样标的。 */
export function Queue({ queue, currentId }: { queue: TrackRef[]; currentId: string | null }) {
  return (
    <section className="panel queue-panel">
      <div className="panel-head">
        <span>QUEUE — {queue.length} TRACKS</span>
      </div>
      {queue.length === 0 ? (
        <p className="empty">Nothing queued yet.</p>
      ) : (
        queue.map((track) => (
          <div key={track.id} className={track.id === currentId ? 'queue-row is-playing' : 'queue-row'}>
            <span className="q-title">
              {track.title} — {track.artist}
            </span>
            {track.id === currentId && <span className="q-tag">PLAYING...</span>}
          </div>
        ))
      )}
    </section>
  );
}