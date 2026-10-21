// 现场日志的自检：去敏、压行、轮转，以及「包一层 fetch 之后响应还能再读」。
// 最后一条是这个功能最容易踩回去的坑：非 2xx 时读过 body 之后，core 的 HttpError.detail
// 会撞 "Body is unusable" —— 包一层就必须换一个能再读的响应回去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_MAX_BYTES, createFileLog, oneLine, redactUrl, withLogging } from '../../main/log.ts';

const scratch = () => mkdtempSync(join(tmpdir(), 'edgerunner-log-'));

/** 把写下来的行收住的假日志。 */
const collector = () => {
  const lines = [];
  return { lines, log: { line: (area, text) => lines.push(area + ' ' + text) } };
};

const answer = (status, body) => ({
  status,
  text: async () => body,
  bytes: async () => new TextEncoder().encode(body),
});

test('去敏按参数名走：已知的换掉，别的一个不动', () => {
  const safe = redactUrl('http://127.0.0.1:3000/song/url?id=17&cookie=MUSIC_U%3Dabc&api_key=zzz&level=exhigh');
  assert.ok(!safe.includes('MUSIC_U'), 'cookie 的值不该还在');
  assert.ok(!safe.includes('zzz'), 'api_key 的值不该还在');
  assert.match(safe, /id=17/);
  assert.match(safe, /level=exhigh/);
  assert.equal((safe.match(/<redacted>/g) ?? []).length, 2);
});

test('大小写与下划线都盖住', () => {
  for (const name of ['API_KEY', 'Authorization', 'Session', 'token', 'password']) {
    assert.match(redactUrl('http://x/y?' + name + '=secret'), /<redacted>/, name + ' 该被换掉');
  }
});

test('没有 query 的 URL 原样留着，超长的才截断', () => {
  assert.equal(redactUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000/');
  // 截到 300 字再补一个省略号。
  assert.equal(redactUrl('http://x/' + 'a'.repeat(500)).length, 301);
});

test('压成一行并截断', () => {
  assert.equal(oneLine('a\n b   c\n\n'), 'a b c');
  assert.equal(oneLine('   两边空白   '), '两边空白');
  assert.equal(oneLine('x'.repeat(500)), 'x'.repeat(400));
});

test('写进去就能按行读出来，目录不存在也自己建', () => {
  const file = join(scratch(), 'deep', 'logs', 'edgerunner.log');
  const log = createFileLog(file);
  log.line('boot', '第一行');
  log.line('http', 'GET /x 200 3ms');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+boot\s+第一行$/);
  assert.match(lines[1], /^[\d\-T:.Z]+\s+http\s+GET \/x 200 3ms$/);
});

test('超过上限就轮转成 .1（只留一代）', () => {
  const file = join(scratch(), 'edgerunner.log');
  writeFileSync(file, 'x'.repeat(LOG_MAX_BYTES + 1));
  createFileLog(file).line('boot', '新的');
  assert.equal(readFileSync(file + '.1', 'utf8').length, LOG_MAX_BYTES + 1);
  assert.match(readFileSync(file, 'utf8'), /新的/);
});

test('写不进去也不抛：日志失败不许拖垮电台', () => {
  // 拿一个目录当文件路径，appendFileSync 必然失败。
  assert.doesNotThrow(() => createFileLog(scratch()).line('boot', 'x'));
});

test('2xx 原样透传，且日志里没有请求头里的 key', async () => {
  const secret = 'sk-super-secret-1234567890';
  const { lines, log } = collector();
  const via = withLogging(async () => answer(200, '{"ok":true}'), log);
  const got = await via({
    method: 'POST',
    url: 'https://api.example.com/v1/chat/completions?api_key=' + secret,
    headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    body: '{"model":"m"}',
  });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), '{"ok":true}');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^http POST https:\/\/api\.example\.com\/v1\/chat\/completions\?api_key=<redacted> /);
  assert.match(lines[0], / 200 \d+ms$/);
  assert.ok(!lines[0].includes(secret), '日志行里绝不能有 key');
  assert.ok(!lines.join(' ').includes('Bearer'), '请求头一律不记');
});

test('非 2xx：状态码与上游原话都记下，而且返回的响应还能再读', async () => {
  const { lines, log } = collector();
  const via = withLogging(async () => answer(401, 'Incorrect API key provided'), log);
  const got = await via({ method: 'POST', url: 'https://api.example.com/v1/chat', headers: {}, body: '{}' });
  assert.equal(got.status, 401);
  assert.match(lines[0], / 401 \d+ms {2}Incorrect API key provided$/);
  // 防回归：core 拿到它之后还会再 text() 一次（HttpError.detail）。
  assert.equal(await got.text(), 'Incorrect API key provided');
});