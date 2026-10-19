import type { TrackRef } from '../../../shared/domain.ts';

/** ⑤ QUEUE。点某一行 = 切到那首歌（交互决策 1）。 */
export function Queue({
  queue,
  currentId,
  onPlay,
}: {
  queue: TrackRef[];
  currentId: string | null;
  onPlay: (songId: string) => void;
}) {
  return (
    <section className="queue">
      <div className="q-head">
        <span>QUEUE</span>
        <span>{queue.length} TRACKS</span>
      </div>
      {queue.length === 0 ? (
        <p className="empty">Nothing queued yet.</p>
      ) : (
        <div className="q-list">
          {queue.map((track, index) => (
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
              <span className="a">{track.artist}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}