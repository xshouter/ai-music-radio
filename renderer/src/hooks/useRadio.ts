// 电台的全部状态：取数、订阅 WS、播音频、上报播放事实。
// 组件只读这个 hook —— 数据从哪来、怎么降级，都在这一处（铁律 5）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DjMessage, TrackRef } from '../../../shared/domain.ts';
import type { NowPlaying, PlanTodayResponse, StreamEvent, TasteDoc } from '../../../shared/api-types.ts';
import { ApiFailure, audioUrl, chat, getFavorites, getNext, getNow, getPlanToday, getTaste, openStream, reportFeedback, reportPlayback } from '../api/client.ts';

export interface RadioError {
  code: string;
  message: string;
  retryable: boolean;
}

/** QUEUE 面板当前展示哪一份列表（需求 3.7）。纯 UI 概念，不进 shared/。 */
export type QueueSource = 'ai' | 'fav';

export interface Radio {
  now: NowPlaying | null;
  current: TrackRef | null;
  queue: TrackRef[];
  favorites: TrackRef[];
  source: QueueSource;
  liked: boolean;
  plan: PlanTodayResponse;
  taste: TasteDoc | null;
  feed: DjMessage[];
  live: boolean;
  error: RadioError | null;
  playing: boolean;
  volume: number;
  positionMs: number;
  durationMs: number;
  toggle: () => void;
  stop: () => void;
  setVolume: (value: number) => void;
  skip: () => void;
  back: () => void;
  play: (songId: string) => void;
  say: (text: string) => void;
  setSource: (source: QueueSource) => void;
  favorite: (track: TrackRef, on: boolean) => void;
  dismissError: () => void;
}

let messageSeq = 0;
const message = (role: DjMessage['role'], text: string, meta?: Record<string, unknown>): DjMessage => ({
  id: `m${(messageSeq += 1)}`,
  ts: new Date().toISOString(),
  role,
  text,
  ...(meta ? { meta } : {}),
});

/* 这一轮的曲目卡挂在哪：先找到「我发的那条」，再找它之后的第一条 DJ 口播。
   WS 的 say 常常比 POST 先回来（mock 第一句只等 120ms），所以两条路径都要调它；
   靠「已经有卡片就不动」保证幂等 —— 谁先到都对。 */
const withCards = (prev: DjMessage[], pending: { after: string; tracks: TrackRef[] }): DjMessage[] => {
  const from = prev.findIndex((entry) => entry.id === pending.after);
  if (from < 0) return prev;
  const at = prev.findIndex((entry, index) => index > from && entry.role === 'dj');
  const target = at < 0 ? undefined : prev[at];
  if (!target || target.meta?.tracks) return prev;
  const next = [...prev];
  next[at] = { ...target, meta: { ...target.meta, tracks: pending.tracks } };
  return next;
};

const asError = (cause: unknown): RadioError =>
  cause instanceof ApiFailure
    ? { code: cause.code, message: cause.message, retryable: cause.retryable }
    : { code: 'INTERNAL', message: cause instanceof Error ? cause.message : String(cause), retryable: true };

export function useRadio(): Radio {
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [queue, setQueue] = useState<TrackRef[]>([]);
  const [cursor, setCursor] = useState(0);
  const [localPick, setLocalPick] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanTodayResponse>(null);
  const [taste, setTaste] = useState<TasteDoc | null>(null);
  const [feed, setFeed] = useState<DjMessage[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<RadioError | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [mediaMs, setMediaMs] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [source, setSource] = useState<QueueSource>('ai');
  const [favorites, setFavorites] = useState<TrackRef[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pending = useRef<{ after: string; tracks: TrackRef[] } | null>(null);

  // 面板里那份列表：AI 推荐 或 FAV（需求 3.7 决策 6）。切来源只换展示，不打断正在播的这首。
  const list = source === 'fav' ? favorites : queue;

  // 优先级：本地刚跳过的 → 后端推来的 now → 列表里记住的位置。
  // 降级时后端会把 now 换成别的歌（可能根本不在队列里），这时必须以它为准，
  // 否则界面显示的当前曲和后端说的不是同一首。
  // localPick 要在两份列表里都找：否则切来源时解析不到它，currentId 一变音频就被中途重载。
  const picked = localPick
    ? queue.find((track) => track.id === localPick) ?? favorites.find((track) => track.id === localPick) ?? null
    : null;
  const current = picked ?? now?.track ?? list[cursor] ?? null;
  const currentId = current?.id ?? null;
  const liked = currentId !== null && favorites.some((track) => track.id === currentId);

  // 音频元素只建一次，事件监听只挂一次。
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;
    const onTime = () => setPositionMs(audio.currentTime * 1000);
    const onMeta = () => setMediaMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audioRef.current = null;
    };
  }, []);

  // 首屏：四个 GET + 一条 WS。WS 连上会自带快照，所以这里的 GET 只为「连不上时也有东西看」。
  useEffect(() => {
    let alive = true;
    const onEvent = (event: StreamEvent) => {
      if (!alive) return;
      switch (event.type) {
        case 'now':
          setNow(event.payload);
          setLocalPick(null); // 后端说了算
          break;
        case 'queue':
          setQueue(event.payload);
          break;
        case 'plan':
          setPlan(event.payload);
          break;
        case 'state':
          setNow((prev) => (prev ? { ...prev, ...event.payload } : prev));
          break;
        case 'say':
          setFeed((prev) => {
            const last = prev[prev.length - 1];
            const base =
              last && last.role === 'dj'
                ? [...prev.slice(0, -1), { ...last, text: `${last.text} ${event.payload.line}` }]
                : [...prev, message('dj', event.payload.line)];
            return pending.current ? withCards(base, pending.current) : base;
          });
          break;
        case 'error':
          setError(event.payload);
          break;
      }
    };

    Promise.all([getNow(), getNext(), getPlanToday(), getTaste(), getFavorites()])
      .then(([firstNow, firstQueue, firstPlan, firstTaste, firstFavorites]) => {
        if (!alive) return;
        setNow(firstNow);
        setQueue(firstQueue);
        setPlan(firstPlan);
        setTaste(firstTaste);
        setFavorites(firstFavorites);
      })
      .catch((cause: unknown) => {
        if (alive) setError(asError(cause));
      });

    const close = openStream(onEvent, setLive);
    return () => {
      alive = false;
      close();
    };
  }, []);

  // 换歌换音源。自动播放可能被浏览器拦，那就让播放按钮说真话。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPositionMs(0);
    setMediaMs(0);
    if (!currentId) {
      audio.removeAttribute('src');
      return;
    }
    audio.src = audioUrl(currentId);
    void audio.play().catch(() => undefined);
  }, [currentId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // 队列里的 TrackRef 不带时长（领域类型就是这么定的）；时长只可能来自 <audio> 或 now.track。
  const nowMatches = now?.track?.id === currentId ? (now.track.durationMs ?? 0) : 0;
  const durationMs = mediaMs || nowMatches;

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  // 播放权威在客户端（ADR-0010）：切歌就是「我切到这首了」，server 只记账。
  const play = useCallback((songId: string) => {
    setLocalPick(songId);
    void reportPlayback({ songId, event: 'started', at: new Date().toISOString() }).catch(() => undefined);
  }, []);

  // 喜欢 / 取消喜欢。这里不做乐观更新：等服务端认了这一下再改本地列表 ——
  // 这是用户数据，宁可慢一帧也不许界面和库里说的不一样；报告失败就挂到横幅上，不静默吞掉。
  const favorite = useCallback((track: TrackRef, on: boolean) => {
    void reportFeedback(track.id, on ? 'like' : 'unlike')
      .then(() => {
        setFavorites((prev) =>
          on
            ? prev.some((f) => f.id === track.id)
              ? prev
              : [...prev, track]
            : prev.filter((f) => f.id !== track.id),
        );
      })
      .catch((cause: unknown) => setError(asError(cause)));
  }, []);

  const move = useCallback(
    (step: number) => {
      const skipped = current;
      if (skipped) {
        void reportPlayback({ songId: skipped.id, event: 'skipped', at: new Date().toISOString() }).catch(() => undefined);
      }
      setCursor((prev) => {
        if (list.length === 0) return prev;
        const at = (prev + step + list.length) % list.length;
        setLocalPick(list[at]?.id ?? null);
        return at;
      });
    },
    [current, list],
  );

  const say = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const mine = message('me', trimmed);
    setFeed((prev) => [...prev, mine]);
    void chat(trimmed)
      .then((show) => {
        if (show.play.length === 0) return;
        const attach = { after: mine.id, tracks: show.play };
        pending.current = attach;
        setFeed((prev) => withCards(prev, attach));
      })
      .catch((cause: unknown) => {
        const failure = asError(cause);
        pending.current = null;
        setError(failure);
        setFeed((prev) => [...prev, message('system', `${failure.code}: ${failure.message}`)]);
      });
  }, []);

  return {
    now,
    current,
    queue,
    favorites,
    source,
    liked,
    plan,
    taste,
    feed,
    live,
    error,
    playing,
    positionMs,
    durationMs,
    toggle,
    stop,
    setVolume,
    volume,
    skip: () => move(1),
    back: () => move(-1),
    play,
    say,
    setSource,
    favorite,
    dismissError: () => setError(null),
  };
}