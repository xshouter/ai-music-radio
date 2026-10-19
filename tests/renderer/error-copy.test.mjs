// 错误码是封闭枚举（抽象层第 5 节），UI 必须每个码都有一句人话。
// 新增一个码却忘了给文案，界面就会显示一句“unknown” —— 这条检查就是为了挡住它。
// 扫源码而不是渲染组件：renderer 目前没有测试运行器，为这一条断言引 vitest + jsdom 不划算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('ERROR_COPY 覆盖封闭枚举里的每一个错误码，且不多不少', () => {
  const app = read('../../renderer/src/App.tsx');
  const contract = read('../../shared/api-types.ts');

  const block = /const ERROR_COPY: Record<string, string> = \{([\s\S]*?)\n\};/.exec(app)?.[1];
  assert.ok(block, 'App.tsx 里没找到 ERROR_COPY');

  const copy = new Set([...block.matchAll(/^ {2}([A-Z_]+):/gm)].map((match) => match[1]));

  const union = /export type ErrorCode =([\s\S]*?);/.exec(contract)?.[1];
  assert.ok(union, 'api-types.ts 里没找到 ErrorCode');
  const codes = [...union.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);

  assert.ok(codes.length >= 6, `只解析到 ${codes.length} 个错误码，正则大概失效了`);
  assert.deepEqual([...copy].sort(), [...codes].sort());
});