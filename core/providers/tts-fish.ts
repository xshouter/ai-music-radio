import type { TtsProvider, TtsRequest, TtsResult } from '../../shared/ports.ts';
import { HttpError, defaultHttpFetch, isOk, type HttpFetch } from '../http.ts';

export interface FishTtsOptions {
  apiKey: string;
  /** Fish Audio 的 `model` 头。默认 `s2-pro`；走免费额度时填 `s2.1-pro-free`。 */
  model?: string;
  baseUrl?: string;
  id?: string;
  fetch?: HttpFetch;
}

/**
 * `POST https://api.fish.audio/v1/tts` —— 一次一句，直接回 mp3 字节。
 *
 * 音色走 body 的 `reference_id`（Fish 的 voice id）；`tts.voice` 为空就不带这个字段，
 * 用 Fish 的默认音色。鉴权是 `Authorization: Bearer <key>`。
 *
 * 它**只**负责一次调用：缓存、重试、词时间戳都在 core/tts.ts。provider 必须是叶子。
 *
 * `baseUrl` 可以指两处：Fish Audio 的托管端点，或者自己跑的 fish-speech —— 后者暴露的是
 * **同一个 `POST /v1/tts`**（上游 tools/server/views.py），所以本地自托管不用改一行代码。
 */
export function createFishTts(options: FishTtsOptions): TtsProvider {
  const http = options.fetch ?? defaultHttpFetch;
  const base = (options.baseUrl ?? 'https://api.fish.audio').replace(/\/+$/, '');
  return {
    id: options.id ?? 'fish',
    format: 'mp3' as const,
    async synthesize(req: TtsRequest): Promise<TtsResult> {
      const body = JSON.stringify({
        text: req.text,
        ...(req.voice === '' ? {} : { reference_id: req.voice }),
        ...(req.speed === undefined ? {} : { prosody: { speed: req.speed } }),
        format: 'mp3',
      });
      const response = await http({
        method: 'POST',
        url: base + '/v1/tts',
        headers: {
          authorization: 'Bearer ' + options.apiKey,
          'content-type': 'application/json',
          model: options.model ?? 's2-pro',
        },
        body,
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
      if (!isOk(response.status)) throw new HttpError(response.status, await response.text());
      // HttpResponse 只有 status/text/bytes —— 没有 headers。mp3 的内容类型是常量，直接写死。
      return { audio: await response.bytes(), contentType: 'audio/mpeg' };
    },
  };
}