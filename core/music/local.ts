import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedAudio, Track } from '../../shared/domain.ts';
import type { MusicSeed, MusicSource } from '../../shared/ports.ts';

export interface LocalOptions {
  /** 本地音乐目录。空目录 / 目录不存在都只是"没有歌"，不是错误。 */
  dir: string;
  id?: string;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus', '.aac']);

interface LocalEntry { file: string; title: string; artist: string }

/**
 * 本地兜底源（抽象层第 6 节的降级链最后一环）。
 * 文件名约定 `Artist - Title.mp3`；没有 ` - ` 就整段当标题，歌手记成 `Local Files`。
 * v1 不做 ID3 解析：多一个库换一个"封面没读到就崩"的故障点不划算。
 */
export function createLocalSource(options: LocalOptions): MusicSource {
  const id = options.id ?? 'local';

  const scan = (): LocalEntry[] => {
    let names: string[];
    try {
      names = readdirSync(options.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => AUDIO_EXTENSIONS.has(extname(name).toLowerCase()))
      .sort()
      .map((name) => {
        const stem = name.slice(0, name.length - extname(name).length);
        const parts = stem.split(' - ');
        return parts.length > 1
          ? { file: name, title: parts.slice(1).join(' - ').trim(), artist: parts[0].trim() }
          : { file: name, title: stem, artist: 'Local Files' };
      });
  };

  const toTrack = (entry: LocalEntry): Track => ({ id: id + ':' + entry.file, title: entry.title, artist: entry.artist, source: id });

  return {
    id,

    async recommend(_seed: MusicSeed, limit: number): Promise<Track[]> {
      return scan().slice(0, limit).map(toTrack);
    },

    /** 本地没有「歌单」这一层：目录里所有的音频文件都算他自己的曲库。 */
    async library(limit: number): Promise<Track[]> {
      return scan().slice(0, limit).map(toTrack);
    },

    async search(keywords: string, limit: number): Promise<Track[]> {
      const needle = keywords.trim().toLowerCase();
      const all = scan();
      const hit = all.filter((entry) => (entry.title + ' ' + entry.artist).toLowerCase().includes(needle));
      // 一个字都没匹配上时给全部：兜底源的职责是"别让电台哑掉"，不是"严格匹配"。
      return (hit.length > 0 ? hit : all).slice(0, limit).map(toTrack);
    },

    async resolve(songId: string, level): Promise<ResolvedAudio | null> {
      const prefix = id + ':';
      if (!songId.startsWith(prefix)) return null;
      const file = songId.slice(prefix.length);
      if (!scan().some((entry) => entry.file === file)) return null;
      // 本地文件没有"音质档位"可言：它就是它自己。声称低一档反而会让 UI 显示错的东西。
      return { url: pathToFileURL(join(options.dir, file)).href, level };
    },
  };
}