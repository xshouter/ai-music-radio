import type { CancelSignal } from '../../shared/ports.ts';

/**
 * provider 需要的**全部** HTTP 能力，就这三样：POST、拿状态码、拿文本。
 * 做成可注入的：适配器的难点是**协议翻译**（tools / tool_calls / tool_use 三套写法），
 * 而翻译的正确性不该靠联网来证明 —— 测试里换一个脚本化的 fetch，翻译就被钉死了。
 */
export interface HttpRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: CancelSignal;
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>;

const defaultHttpFetch: HttpFetch = async (url, init) => {
  // 唯一的 cast：CancelSignal 是我们自己声明的结构化取消（shared/ 没有 DOM lib），
  // 而 RequestInit.signal 要的是真 AbortSignal。运行时传进来的本来就是 AbortSignal。
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal as AbortSignal | undefined,
  });
  return { status: response.status, text: () => response.text() };
};

export { defaultHttpFetch };

/** 上游返回非 2xx 时抛这个：**带上状态码**，因为 429 与 401 要分开处理（RATE_LIMITED vs NO_LLM_KEY）。 */
export class LlmHttpError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super('LLM provider returned HTTP ' + status);
    this.name = 'LlmHttpError';
    this.status = status;
    this.detail = detail;
  }
}