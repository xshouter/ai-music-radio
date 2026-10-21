// 现场日志：双击之后出了什么事，事后要能读出来（ADR-0035）。
//
// 为什么落在 main/ 而不是 core/：它要写文件（core/ 不许碰 node:fs），而且「日志放哪、留多久」
// 是宿主的决定 —— core/ 只需要继续用它的 warn 说话，一个字都不用改。
//
// 为什么不能靠 console：便携版是双击启动的，stderr 通向没有人看的地方。
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HttpFetch } from '../core/http.ts';

export interface Log {
  /** 一行一条：<ISO 时间>  <区域>  <正文>。 */
  line(area: string, text: string): void;
}

/** 单文件上限。超了就改名成 .1（只留一代）再开新的 —— 这个量级够覆盖最近若干次开机。 */
export const LOG_MAX_BYTES = 1024 * 1024;

/** 压成一行并截断：日志一行一条，上游那一整页 HTML 报错不能把文件撑爆。 */
export const oneLine = (text: string, max = 400): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** URL 里已知的敏感 query 名。请求头**根本不进日志**，所以 key / cookie 没有第二条漏出去的路。 */
const SENSITIVE = /^(cookie|token|api_?key|key|sign|session|password|authorization)$/i;

const short = (value: string): string => (value.length > 300 ? value.slice(0, 300) + '…' : value);

/**
 * 去敏 + 截断：查的是「发了哪个地址」，不是参数的原文。
 * 规则是**结构性的**（已知名字的 query、超长截断），不靠猜 key 长什么样 —— 猜形状的过滤总有漏的。
 */
export const redactUrl = (url: string): string => {
  const cut = url.indexOf('?');
  if (cut < 0) return short(url);
  const params = new URLSearchParams(url.slice(cut + 1));
  for (const name of [...params.keys()]) if (SENSITIVE.test(name)) params.set(name, '<redacted>');
  // URLSearchParams 会把尖括号编码掉 —— 换回来，让去敏后的值一眼能读。
  return short(url.slice(0, cut) + '?' + params.toString().replace(/%3Credacted%3E/g, '<redacted>'));
};

const sizeOf = (file: string): number => statSync(file, { throwIfNoEntry: false })?.size ?? 0;

export function createFileLog(file: string): Log {
  mkdirSync(dirname(file), { recursive: true });
  return {
    line(area, text) {
      try {
        if (sizeOf(file) > LOG_MAX_BYTES) renameSync(file, file + '.1');
        // 同步写、一行一条：崩了也不丢最后一行 —— 而「崩了」正是最需要日志的时候。
        appendFileSync(file, new Date().toISOString() + '  ' + area.padEnd(7) + ' ' + oneLine(text) + '\n', 'utf8');
      } catch {
        // 记不下来不是电台的事：绝不因为日志写失败把应用弄挂。
      }
    },
  };
}

/**
 * 包一层 fetch，记下每一次对外请求。
 *
 * 为什么包在这里：core/ 所有的出网都走 HttpFetch（大脑 / 音乐源 / TTS），包一处就等于全记上，
 * 而 core/ 一个字都不用改。
 *
 * 非 2xx 要读一次响应体才记得下来，但读过之后原对象就不能再读了 —— 所以**换一个能读的回去**。
 * 少了这一步，core/ 的 HttpError.detail 会撞上 "Body is unusable"，把干净的上游错误变成一个 TypeError。
 */
export function withLogging(fetchImpl: HttpFetch, log: Log): HttpFetch {
  return async (request) => {
    const began = Date.now();
    const response = await fetchImpl(request);
    const head =
      request.method + ' ' + redactUrl(request.url) + ' → ' + response.status + ' ' + (Date.now() - began) + 'ms';
    if (response.status >= 200 && response.status <= 299) {
      log.line('http', head);
      return response;
    }
    const body = await response.text().catch(() => '');
    log.line('http', head + (body === '' ? '' : '  ' + oneLine(body, 300)));
    return { status: response.status, text: async () => body, bytes: response.bytes };
  };
}
