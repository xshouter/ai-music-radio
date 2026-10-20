import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmToolCall, LlmToolSpec } from '../../shared/ports.ts';
import { HttpError, defaultHttpFetch, isOk, type HttpFetch } from '../http.ts';

export interface OpenAiLlmOptions {
  baseUrl: string;
  apiKey: string;
  id?: string;
  fetch?: HttpFetch;
}

interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const toWireTool = (tool: LlmToolSpec) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

const toWireMessage = (message: LlmMessage): WireMessage => {
  if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content === '' ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        // OpenAI 的 tool_call.arguments 是 JSON **字符串**，不是对象 —— 这是两边最大的写法差异。
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    };
  }
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? '' };
  }
  return { role: message.role, content: message.content };
};

const toWireToolChoice = (choice: LlmRequest['toolChoice']) => {
  if (choice === undefined) return undefined;
  if (choice === 'auto' || choice === 'required') return choice;
  return { type: 'function' as const, function: { name: choice.name } };
};

const parseArguments = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
};

const FINISH: Record<string, LlmResponse['finishReason']> = {
  stop: 'stop',
  tool_calls: 'tool_calls',
  length: 'length',
};

/**
 * `POST {baseUrl}/chat/completions` —— OpenAI 兼容面。
 * 百炼（DashScope 的 compatible-mode）、DeepSeek、火山方舟、OpenAI 自己、以及一堆本地推理服务
 * 都是这一套；"任何模型的 apikey 都能用"落在这一个文件里。
 */
export function createOpenAiLlm(options: OpenAiLlmOptions): LlmProvider {
  const http = options.fetch ?? defaultHttpFetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  return {
    id: options.id ?? 'openai-compatible',
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const toolChoice = toWireToolChoice(req.toolChoice);
      const body = JSON.stringify({
        model: req.model,
        messages: req.messages.map(toWireMessage),
        ...(req.tools !== undefined && req.tools.length > 0 ? { tools: req.tools.map(toWireTool) } : {}),
        ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(req.maxTokens === undefined ? {} : { max_tokens: req.maxTokens }),
      });
      const response = await http({
        method: 'POST',
        url: base + '/chat/completions',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + options.apiKey },
        body,
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
      const text = await response.text();
      if (!isOk(response.status)) throw new HttpError(response.status, text);
      return parseOpenAiResponse(text);
    },
  };
}

interface OpenAiPayload {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function parseOpenAiResponse(text: string): LlmResponse {
  const payload = JSON.parse(text) as OpenAiPayload;
  const choice = payload.choices?.[0];
  if (choice === undefined) throw new Error('LLM 响应里没有 choices[0]');
  const toolCalls: LlmToolCall[] = (choice.message?.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? 'call_' + index,
    name: call.function?.name ?? '',
    args: parseArguments(call.function?.arguments ?? '{}'),
  }));
  const usage = payload.usage;
  return {
    text: choice.message?.content ?? '',
    toolCalls,
    finishReason: FINISH[choice.finish_reason ?? ''] ?? (toolCalls.length > 0 ? 'tool_calls' : 'error'),
    ...(usage?.prompt_tokens === undefined ? {} : {
      usage: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 },
    }),
  };
}