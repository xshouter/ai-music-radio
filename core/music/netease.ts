import type { ResolvedAudio, Track } from '../../shared/domain.ts';
import type { MusicSeed, MusicSource } from '../../shared/ports.ts';
import { defaultHttpFetch, getJson, type HttpFetch } from '../http.ts';

export interface NeteaseOptions {
  /** 一个 NeteaseCloudMusicApi **兼容**的地址，例如 http://127.0.0.1:3000。 */
  baseUrl: string;
  /** 整条网易云 cookie 头。只进不出：这里不发日志、不放进错误消息、不回显（ADR-0011）。 */
  cookie?: string;
  fetch?: HttpFetch;
  id?: string;
}

interface RawSong {
  id?: number | string;
  name?: string;
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
  song?: RawSong;
}

const clamp = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.min(50, Math.trunc(value))) : fallback;

const toTrack = (raw: RawSong, id: string): Track => {
  const artists = raw.ar ?? raw.artists ?? [];
  const album = raw.al ?? raw.album;
  const track: Track = {
    id: String(raw.id),
    title: raw.name ?? 'Unknown',
    artist: artists.map((a) => a.name ?? '').filter((name) => name !== '').join(', ') || 'Unknown',
    source: id,
  };
  if (album?.name !== undefined) track.album = album.name;
  if (album?.picUrl !== undefined) track.coverUrl = album.picUrl;
  const duration = raw.dt ?? raw.duration;
  if (typeof duration === 'number') track.durationMs = duration;
  return track;
};

/**
 * 网易云音乐源。**只借鉴公开实现的做法，不内联任何第三方代码**（roadmap 阶段 4 的约定）。
 *
 * 三处取舍：
 * 1. 加密那层（weapi/eapi）不住在这里 —— 它由一个兼容服务承担，本项目只做客户端。
 *    这样 `core/` 保持零加密依赖，而"换一个兼容服务"只是改一个 baseUrl。
 * 2. `recommend` 有场景词就走搜索，没有才走个性化日推：日推是**账号**级推荐，
 *    它对"今晚想听慢一点的"这种请求无话可说。
 * 3. `resolve` 只试**一个**档位。逐档下试是链的职责（端口注释就是这么写的）——
 *    源自己降级会让"到底降了几档"变得不可观测。
 */
export function createNeteaseSource(options: NeteaseOptions): MusicSource {
  const http = options.fetch ?? defaultHttpFetch;
  const id = options.id ?? 'netease';
  const base = options.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = options.cookie === undefined || options.cookie === '' ? {} : { cookie: options.cookie };

  return {
    id,

    async search(keywords: string, limit: number): Promise<Track[]> {
      const payload = await getJson<{ result?: { songs?: RawSong[] } }>(
        http,
        base + '/cloudsearch?keywords=' + encodeURIComponent(keywords) + '&limit=' + clamp(limit, 10),
        headers,
      );
      return (payload.result?.songs ?? []).map((raw) => toTrack(raw, id));
    },

    async recommend(seed: MusicSeed, limit: number): Promise<Track[]> {
      const size = clamp(limit, 6);
      const scene = [...(seed.genres ?? []), seed.mood ?? ''].map((part) => part.trim()).filter((part) => part !== '').join(' ');
      if (scene !== '') return this.search(scene, size);

      // 个性化日推要登录（cookie）。没有 cookie、或者 cookie 过期了，退到不需要登录的公开接口。
      try {
        const daily = await getJson<{ data?: { dailySongs?: RawSong[] } }>(http, base + '/recommend/songs', headers);
        const songs = daily.data?.dailySongs ?? [];
        if (songs.length > 0) return songs.slice(0, size).map((raw) => toTrack(raw, id));
      } catch {
        // 落到公开接口
      }
      const fresh = await getJson<{ result?: RawSong[] }>(http, base + '/personalized/newsong?limit=' + size, headers);
      return (fresh.result ?? []).slice(0, size).map((raw) => toTrack(raw.song ?? raw, id));
    },

    async resolve(songId: string, level): Promise<ResolvedAudio | null> {
      const payload = await getJson<{ data?: { url?: string | null; level?: string }[] }>(
        http,
        base + '/song/url/v1?id=' + encodeURIComponent(songId) + '&level=' + level,
        headers,
      );
      const first = payload.data?.[0];
      // url 为空 = 这一档拿不到（版权 / 需要更高等级账号），交给链去降级 —— 不是错误。
      if (first?.url == null || first.url === '') return null;
      return { url: first.url, level: first.level === undefined ? level : (first.level as ResolvedAudio['level']) };
    },
  };
}