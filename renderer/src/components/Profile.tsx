import { useEffect, useState } from 'react';
import type { TasteDoc } from '../../../shared/api-types.ts';
import type { DayPlan, DjMessage, PlayStats } from '../../../shared/domain.ts';
import { getHistory, getPlanToday, getStats, getTaste } from '../api/client.ts';
import { Icon } from './Icon.tsx';

type Data = { taste: TasteDoc | null; plan: DayPlan | null; stats: PlayStats | null; history: DjMessage[] | null };

/* 时间戳只给时分：它在消息上是辅助信息，不该占地方。 */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const two = (n: number) => String(n).padStart(2, '0');
  return two(d.getHours()) + ':' + two(d.getMinutes());
};

const ROLE: Record<string, string> = { dj: 'DJ', me: 'ME', system: 'SYS' };

/**
 * ④ Profile（3.11）。DjCard 的下一级：那边回答「你是谁」，这里回答「你听了什么、taste 长什么样」。
 * 四块数据全部来自接口，没有一个数字是写死的 —— 统计走GET /api/stats。
 */
export function Profile({ onClose, onPlay }: { onClose: () => void; onPlay: (songId: string) => void }) {
  const [data, setData] = useState<Data>({ taste: null, plan: null, stats: null, history: null });
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    // allSettled：一块坏了不该让另外三块也空着 —— 每块自己有空态，错误在页脚报一次。
    Promise.allSettled([getTaste(), getPlanToday(), getStats(), getHistory(8)]).then(([taste, plan, stats, history]) => {
      if (!live) return;
      setData({
        taste: taste.status === 'fulfilled' ? taste.value : null,
        plan: plan.status === 'fulfilled' ? plan.value : null,
        stats: stats.status === 'fulfilled' ? stats.value : null,
        history: history.status === 'fulfilled' ? history.value : null,
      });
      const broken = [taste, plan, stats, history].find((r) => r.status === 'rejected');
      setFailed(broken && broken.status === 'rejected' ? String(broken.reason?.message ?? 'Unavailable') : null);
    });
    return () => {
      live = false;
    };
  }, []);

  const { taste, plan, stats, history } = data;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="profile-card">
        <div className="pf-top">
          <span className="dj-face" aria-hidden="true">
            E
          </span>
          <div>
            <div className="dj-name">EdgeRunner</div>
            <div className="dj-slogan">一开机我就打碟</div>
          </div>
          <button className="cred-close" type="button" onClick={onClose} aria-label="Close profile">
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="pf-body">
          <section className="pf-sec">
            <div className="pf-head">Taste</div>
            {taste === null ? (
              <div className="pf-empty">—</div>
            ) : (
              <>
                {taste.corpus.length === 0 && <div className="pf-empty">Nothing written yet.</div>}
                {taste.corpus.map((doc) => (
                  <div className="pf-doc" key={doc.name}>
                    <div className="pf-doc-name">{doc.name}</div>
                    <div className="pf-doc-text">{doc.text}</div>
                  </div>
                ))}
                <div className="pf-sub">Learned</div>
                {taste.recent.length === 0 ? (
                  <div className="pf-empty">Nothing learned yet.</div>
                ) : (
                  taste.recent.map((update) => (
                    <div className="pf-learn" key={update.ts + update.text}>
                      <span className="pf-time">{hhmm(update.ts)}</span>
                      <span>{update.text}</span>
                    </div>
                  ))
                )}
              </>
            )}
          </section>

          <section className="pf-sec">
            <div className="pf-head">Today</div>
            {plan === null ? (
              <div className="pf-empty">—</div>
            ) : plan.blocks.length === 0 ? (
              <div className="pf-empty">No plan for today yet.</div>
            ) : (
              plan.blocks.map((block) => (
                <div className="pf-block" key={block.start}>
                  <div className="pf-block-top">
                    <span className="pf-time">
                      {block.start}–{block.end}
                    </span>
                    <span className="pf-mood">{block.mood}</span>
                    {block.genres.map((genre) => (
                      <span className="genre" key={genre}>{genre}</span>
                    ))}
                  </div>
                  {block.tracks.map((track) => (
                    <button className="pf-track" type="button" key={track.id} onClick={() => onPlay(track.id)}>
                      {track.title} — {track.artist}
                    </button>
                  ))}
                </div>
              ))
            )}
          </section>

          <section className="pf-sec">
            <div className="pf-head">Stats</div>
            {stats === null ? (
              <div className="pf-empty">—</div>
            ) : (
              <>
                <div className="pf-stats">
                  {([['PLAYED', stats.played], ['SKIPPED', stats.skipped], ['REPLAYS', stats.replays]] as const).map(([label, value]) => (
                    <div key={label}>
                      <div className="l">{label}</div>
                      <div className="v">{value}</div>
                    </div>
                  ))}
                </div>
                {stats.topArtists.length === 0 ? (
                  <div className="pf-empty">No plays yet today.</div>
                ) : (
                  stats.topArtists.map((row) => (
                    <div className="pf-artist" key={row.artist}>
                      <span>{row.artist}</span>
                      <span className="c">×{row.count}</span>
                    </div>
                  ))
                )}
              </>
            )}
          </section>

          <section className="pf-sec">
            <div className="pf-head">History</div>
            {history === null ? (
              <div className="pf-empty">—</div>
            ) : history.length === 0 ? (
              <div className="pf-empty">No messages yet.</div>
            ) : (
              history.map((message) => (
                <div className="pf-msg" key={message.id}>
                  <span className="pf-role">{ROLE[message.role] ?? message.role}</span>
                  <span className="pf-time">{hhmm(message.ts)}</span>
                  <span className="pf-text">{message.text}</span>
                </div>
              ))
            )}
          </section>
        </div>

        <div className="pf-foot">
          {failed && <span className="cred-msg err">{failed}</span>}
          <button className="cred-btn" type="button" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
