import { readFileSync } from 'node:fs';
import type { TtsProvider, TtsResult } from '../../shared/ports.ts';

export interface FileTtsOptions {
  /** 要读的那一份音频（绝对路径）。 */
  file: string;
  id?: string;
}

/**
 * 文件嗓子：把**已经合成好的一份音频**当成一个 provider。
 *
 * 首次体验用它 —— 那一段口播是出厂时用出厂嗓冻下来的文件，随包发，和用户后来配了哪家嗓子无关。
 * 它**故意**忽略 `req.voice`：这一份音频就是这一个音色，参数改不动它。
 *
 * 和别的 provider 一样是叶子：不联网、不看设置；缓存、重试、词时间戳都在 core/tts.ts。
 */
export function createFileTts(options: FileTtsOptions): TtsProvider {
  const lower = options.file.toLowerCase();
  // 容器决定缓存后缀与时长解析器，认错就会算出错得离谱的词时间戳 —— 让文件名说了算。
  const format = lower.endsWith('.mp3') ? ('mp3' as const) : ('wav' as const);
  return {
    id: options.id ?? 'file',
    format,
    synthesize(): Promise<TtsResult> {
      const audio = readFileSync(options.file);
      if (audio.byteLength === 0) return Promise.reject(new Error('文件嗓子读到了空音频：' + options.file));
      return Promise.resolve({ audio, contentType: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' });
    },
  };
}