// bootstrap 的端到端自检：真起一台电台（真 SQLite、真 HTTP、真 UI 目录），
// 然后只从外面打它 —— 打包成 exe 之后能跑通的最小证据就是这里。
//
// 注意：main/bootstrap.ts **不 import electron**（只有 main/main.ts 和 preload.ts import）。
// 所以这一层能在纯 Node 下测：这正是"唯一组装点"这条边界的红利。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRadio } from '../../main/bootstrap.ts';

const tmp = (name) => mkdtempSync(join(tmpdir(), 'edgerunner-' + name + '-'));

test('bootstrap：一台电台起得来 —— 同源 UI 要得到，数据面要令牌（阶段 5.1）', async () => {
  const dataDir = tmp('data');
  const localDir = tmp('music');
  const uiDir = tmp('ui');
  mkdirSync(join(uiDir, 'assets'), { recursive: true });
  writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>EdgeRunner</title>hello');

  const started = await startRadio({ dataDir, localDir, uiDir, warn: () => {} });
  const base = 'http' + '://127.0.0.1:' + started.port;

  try {
    // 1. UI 同源：不带令牌也要给（初始文档没法带自定义头，ADR-0020）。
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /EdgeRunner/);

    // 2. 数据面要令牌：没令牌 401，有令牌 200 且结构是契约里的形状。
    const locked = await fetch(base + '/api/now');
    assert.equal(locked.status, 401);

    const now = await fetch(base + '/api/now', { headers: { 'x-radio-token': started.token } });
    assert.equal(now.status, 200);
    assert.ok((await now.json()).track !== undefined);

    // 3. 凭据不进响应：没配置时只回「未配置」，明文永远不回显（ADR-0011）。
    const settings = await (await fetch(base + '/api/settings', { headers: { 'x-radio-token': started.token } })).json();
    assert.equal(settings.llm.apiKeySet, false);
    assert.equal(settings.music.cookieSet, false);

    // 4. 越界路径不给：uiDir 外面的东西一个字节都不出（ADR-0020 的越界检查）。
    const escape = await fetch(base + '/..%2F..%2Fpackage.json');
    assert.equal(escape.status, 404);
  } finally {
    await started.close();
  }
});