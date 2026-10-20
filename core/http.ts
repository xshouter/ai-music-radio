import type { CancelSignal } from '../shared/ports.ts';

/**
 * core/ 需要的**全部**网络能力，就这三样：发请求、拿状态码、拿文本。
 *
 * 做成可注入的，不是"为了以后换 axios"，而是因为**协议翻译是本项目最需要被测的部分**：
 * 两套 LLM 写法、网易云三层降级，它们的正确性不该靠联网来证明。
 * 测试里换一个脚本化的 fetch，翻译就被钉死了。
 *
 * 位置在 `core/http.ts` 而不是 `core/providers/`：它是个工具，不是某个 provider 的私产
 * —— `core/music/` 也要用它。provider 层必须是叶子。
 */
export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: CancelSignal;
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
  /** TTS 回来的是音频字节，不是文本 —— 少这一个方法就没法接任何语音服务。 */
  bytes(): Promise<Uint8Array>;
}

export type HttpFetch = (request: HttpRequest) => Promise<HttpResponse>;

const defaultHttpFetch: HttpFetch = async (request) => {
  // 唯一的 cast：CancelSignal 是我们自己声明的结构化取消（shared/ 没有 DOM lib），
  // 而 RequestInit.signal 要的是真 AbortSignal。运行时传进来的本来就是 AbortSignal。
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: request.signal as AbortSignal | undefined,
  });
  return {
    status: response.status,
    text: () => response.text(),
    bytes: async () => new Uint8Array(await response.arrayBuffer()),
  };
};

export { defaultHttpFetch };

/** 上游返回非 2xx 时抛这个：**带上状态码**，因为 429 与 401 要分开处理（RATE_LIMITED vs NO_LLM_KEY）。 */
export class HttpError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super('upstream returned HTTP ' + status);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export const isOk = (status: number): boolean => status >= 200 && status <= 299;

/** GET 便利函数：音乐源的接口几乎全是 GET + query。 */
export const getJson = async <T>(http: HttpFetch, url: string, headers: Record<string, string> = {}): Promise<T> => {
  const response = await http({ method: 'GET', url, headers });
  const text = await response.text();
  if (!isOk(response.status)) throw new HttpError(response.status, text);
  return JSON.parse(text) as T;
};