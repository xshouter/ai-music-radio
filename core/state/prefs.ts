import type { PrefKey, PrefMap } from '../../shared/ports.ts';

/**
 * 设置项的出厂值。ADR-0005 的「解析失败回默认值」里的默认值就是这里的值。
 *
 * tts 的默认是 fish（ADR-0008）：tts.voice 留空 = 用音色库默认音色。
 * llm 的默认指向百炼的 OpenAI 兼容端点（怎么填 key 见 README「填上你自己的钥匙」），
 * 但换任何兼容 key 只是改 llm.baseUrl + llm.model，不动代码。
 */
export const DEFAULT_PREFS: PrefMap = {
  'llm.baseUrl': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'llm.model': 'qwen-plus',
  'llm.protocol': 'openai',
  'llm.apiKey': '',
  'tts.provider': 'fish',
  'tts.voice': '',
  'tts.apiKey': '',
  'music.provider': 'netease',
  'music.cookie': '',
};

/** 封闭 key 集合的运行时投影：server 的 GET/PUT /api/settings 靠它遍历。 */
export const PREF_KEYS = Object.keys(DEFAULT_PREFS) as PrefKey[];

export function isPrefKey(key: string): key is PrefKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, key);
}

/**
 * 一个 key 配一个显式 parse（ADR-0005）：解析失败回默认值并记一条警告，**不抛错** ——
 * 不能因为一个设置项坏了就让电台起不来。
 */
export function parsePref<K extends PrefKey>(key: K, raw: string | null, warn: (message: string) => void): PrefMap[K] {
  if (raw === null) return DEFAULT_PREFS[key];
  if (key === 'llm.protocol') {
    if (raw === 'openai' || raw === 'anthropic') return raw as PrefMap[K];
    warn('prefs: llm.protocol 的值 ' + JSON.stringify(raw) + ' 不合法，回落到 ' + DEFAULT_PREFS[key]);
    return DEFAULT_PREFS[key];
  }
  return raw as PrefMap[K];
}