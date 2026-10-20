// 内置音乐源的自检：挑端口、等就绪、真拉起一个子进程、起不来时说得出话。
// 这里刻意跑**真的 spawn**（用 process.execPath 当 node），因为「代管启动」这件事的坑全在进程边界上 ——
// 只测纯函数等于测了个假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { neteaseEntry, pickFreePort, startNeteaseService, waitForReady } from '../../main/netease-service.ts';

const scratch = () => mkdtempSync(join(tmpdir(), 'edgerunner-netease-'));

/** true = 这个端口现在有人占着。 */
const occupied = (port) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(false)));
  });

/** 摆一个假的「内置服务」：形状和真的那一份一样，只是 app.js 只说 ok。 */
const fakePackage = (source) => {
  const dir = join(scratch(), 'netease');
  const pkg = join(dir, 'node_modules', 'NeteaseCloudMusicApi');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'app.js'), source);
  return dir;
};

const ANSWER = [
  "const http = require('node:http');",
  "http.createServer((req, res) => { res.writeHead(200); res.end('ok'); })",
  "  .listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');",
].join('\n');

const portOf = (baseUrl) => Number(new URL(baseUrl).port);

test('挑出来的端口当时是空的', async () => {
  const port = await pickFreePort();
  assert.ok(port > 0);
  assert.equal(await occupied(port), false);
});

test('入口形状钉死：<dir>/node_modules/NeteaseCloudMusicApi/app.js', () => {
  assert.equal(neteaseEntry('X'), join('X', 'node_modules', 'NeteaseCloudMusicApi', 'app.js'));
});

test('没人应答就一直等，等到超时为止', async () => {
  const port = await pickFreePort();
  const at = Date.now();
  assert.equal(await waitForReady(port, 700), false);
  assert.ok(Date.now() - at >= 600, '不许提前给结论');
});

test('真拉起一个子进程：给了地址就能用，stop() 之后端口松开', async () => {
  const dir = fakePackage(ANSWER);
  const service = await startNeteaseService({ dir, readyTimeoutMs: 15_000 });
  assert.ok(service !== null, '内置服务应该起来');
  assert.equal((await fetch(service.baseUrl + '/')).status, 200);

  service.stop();
  const port = portOf(service.baseUrl);
  // 等它松手：kill 到端口真的释放之间有一小段（这段的长度是机器的，不是契约的）。
  for (let i = 0; i < 50 && (await occupied(port)); i += 1) {
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(await occupied(port), false, 'stop() 之后不该还有东西占着端口');
});

test('子进程秒退：不干等超时，返回 null，并且把为什么说出来', async () => {
  const dir = fakePackage('process.exit(3);');
  const warned = [];
  const at = Date.now();
  const service = await startNeteaseService({ dir, readyTimeoutMs: 20_000, warn: (m) => warned.push(m) });
  assert.equal(service, null);
  assert.ok(Date.now() - at < 5_000, '它都死了，不该干等到 20s');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /没起来/);
});