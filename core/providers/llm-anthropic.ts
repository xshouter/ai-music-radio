import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmToolCall, LlmToolSpec } from '../../shared/ports.ts';
import { LlmHttpError, defaultHttpFetch, type HttpFetch } from './http.ts';

export interface AnthropicLlmOptions {
  baseUrl: string;
  apiKey: string;
  id?: string;
  fetch?: HttpFetch;
  /** Anthropic 的 max_tokens 是**必填**，不像 OpenAI 可省。 */
  defaultMaxTokens?: number;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface WireMessage { role: 'user' | 'assistant'; content: Block[] }

const toWireTool = (tool: LlmToolSpec) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,
});

const toWireToolChoice = (choice: LlmRequest['toolChoice']) => {
  if (choice === undefined) return undefined;
  if (choice === 'auto') return { type: 'auto' as const };
  if (choice === 'required') return { type: 'any' as const };
  return { type: 'tool' as const, name: choice.name };
};

/**
 * Anthropic 的消息体里**只有 user / assistant 两种角色**：system 提到顶层，工具结果伪装成 user。
 * 恰好是这个形状让"连续两条 tool 结果"必须**合并进一条 user 消息** ——
 * 分开写会得到两条连续的 user 消息，上游直接 400。这一步是这里最容易写错的地方。
 */
export function toAnthropicMessages(messages: LlmMessage[]): { system: string; messages: WireMessage[] } {
  const system: string[] = [];
  const wire: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      const block: Block = { type: 'tool_result', tool_use_id: message.toolCallId ?? '', content: message.content };
      const last = wire[wire.length - 1];
      if (last !== undefined && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        wire.push({ role: 'user', content: [block] });
      }
      continue;
    }
    const blocks: Block[] = [];
    if (message.content !== '') blocks.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
    }
    wire.push({ role: message.role, content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] });
  }
  return { system: system.join('\n\n'), messages: wire };
}

/**
 * `POST {baseUrl}/v1/messages` —— Anthropic 兼容面（Claude 自己、以及一批"Anthropic 兼容"网关）。
 * 与 OpenAI 面的三处硬差异：system 在顶层、工具参数是**对象**不是 JSON 字符串、工具结果走 user 消息。
 */
export function createAnthropicLlm(options: AnthropicLlmOptions): LlmProvider {
  const http = options.fetch ?? defaultHttpFetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  return {
    id: options.id ?? 'anthropic-compatible',
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const { system, messages } = toAnthropicMessages(req.messages);
      const toolChoice = toWireToolChoice(req.toolChoice);
      const body = JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? options.defaultMaxTokens ?? 1024,
        messages,
        ...(system === '' ? {} : { system }),
        ...(req.tools !== undefined && req.tools.length > 0 ? { tools: req.tools.map(toWireTool) } : {}),
        ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      });
      const response = await http(base + '/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
        signal: req.signal,
      });
      const text = await response.text();
      if (response.status < 200 || response.status > 299) throw new LlmHttpError(response.status, text);
      return parseAnthropicResponse(text);
    },
  };
}

interface AnthropicPayload {
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const STOP: Record<string, LlmResponse['finishReason']> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  tool_use: 'tool_calls',
  max_tokens: 'length',
};

export function parseAnthropicResponse(text: string): LlmResponse {
  const payload = JSON.parse(text) as AnthropicPayload;
  const blocks = payload.content ?? [];
  const toolCalls: LlmToolCall[] = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block, index) => ({ id: block.id ?? 'call_' + index, name: block.name ?? '', args: block.input ?? {} }));
  const answer = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
  const usage = payload.usage;
  return {
    text: answer,
    toolCalls,
    finishReason: STOP[payload.stop_reason ?? ''] ?? (toolCalls.length > 0 ? 'tool_calls' : 'error'),
    ...(usage?.input_tokens === undefined ? {} : {
      usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 },
    }),
  };
}