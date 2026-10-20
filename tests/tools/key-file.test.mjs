// tools/key-file.mjs 的自检。
// 真 key 用上来的第一个坑就在这里：key 里的 `.` 不在字符集里 → 悄悄拿到半截 key → 报一个假的「key 无效」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyFromText } from '../../tools/key-file.mjs';

const DOTTED = 'sk-sp-aaaa.bbbb.cccc.' + 'x'.repeat(80);

test('带点的 key 要整条拿出来（百炼 token-plan 的形状）', () => {
  assert.equal(keyFromText(DOTTED), DOTTED);
  assert.equal(keyFromText(DOTTED + '\n'), DOTTED);
  assert.equal(keyFromText('  ' + DOTTED + '  '), DOTTED, '两边有空白也要认');
});

test('单 token 的 NAME=key 取等号右边', () => {
  assert.equal(keyFromText('LLM_API_KEY=' + DOTTED), DOTTED);
});

test('说明文字里夹着的 key：按形状找出来', () => {
  const hex = 'a1b2c3d4'.repeat(5);
  assert.equal(keyFromText('把我的 key 换成 ' + hex + ' 再用'), hex);
  assert.equal(keyFromText('key: ' + DOTTED + '\n其它内容'), DOTTED);
});

test('找不到就返回空串，让调用方明确失败 —— 不许交出一个被切过的字符串', () => {
  assert.equal(keyFromText(''), '');
  assert.equal(keyFromText('   \n  '), '');
  assert.equal(keyFromText('这里没有任何像 key 的东西'), '');
});

test('回归：旧的抽法会把带点的 key 切一半', () => {
  const old = /(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{24,})/;
  const half = old.exec(DOTTED)[0];
  assert.notEqual(half, DOTTED);
  assert.ok(half.length < DOTTED.length, '旧规则确实只拿到一段');
  assert.equal(keyFromText(DOTTED), DOTTED, '新的必须拿全');
});