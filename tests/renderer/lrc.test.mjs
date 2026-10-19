// LRC 解析是手写的（需求·假设 4 不引第三方库），所以它得有检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineAt, parseLrc } from '../../renderer/src/api/lrc.ts';

test('parseLrc 认 [mm:ss.xx] 并换算成毫秒', () => {
  const lines = parseLrc('[00:12.00]the long way round\n[01:02.50]let the hour keep us\n');
  assert.deepEqual(lines, [
    { ms: 12000, text: 'the long way round' },
    { ms: 62500, text: 'let the hour keep us' },
  ]);
});

test('parseLrc 容忍缺小数位、乱序与纯文本行', () => {
  // .5 是「半秒」不是「5 毫秒」：小数位左对齐补零（.5 → 500ms）。
  const lines = parseLrc('作词：某人\n[01:00]later\n[00:30.5]earlier\n');
  assert.deepEqual(lines, [
    { ms: 30500, text: 'earlier' },
    { ms: 60000, text: 'later' },
  ]);
});

test('parseLrc 对没有时间戳的输入返回空数组（退化成纯播放，不报错）', () => {
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc('没有时间戳的歌词\n'), []);
});

test('lineAt 在第一句之前返回 -1，之后跟着时间走', () => {
  const lines = parseLrc('[00:00.00]one\n[00:12.00]two\n');
  assert.equal(lineAt(lines, 0), 0);
  assert.equal(lineAt(lines, 11999), 0);
  assert.equal(lineAt(lines, 12000), 1);
  assert.equal(lineAt(lines, 999999), 1);
  assert.equal(lineAt([], 5000), -1);
});