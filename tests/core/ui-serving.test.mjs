// 5.1 的自检：内核顺手发 UI 这条路。
// 重点不是"能不能发文件"，而是"能不能只发该发的那一个目录"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeHttp from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRadioServer } from '../../core/server.ts';

const TOKEN = 'tok-ui';
const stubRadio = { subscribe: () => () => {} };

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'edgerunner-ui-'));
  const ui = join(root, 'ui');
  mkdirSync(join(ui, 'assets'), { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>EdgeRunner</title>');
  writeFileSync(join(ui, 'assets', 'app.js'), 'export const x = 1;\n');
  writeFileSync(join(root, 'secret.txt'), 'THIS-MUST-NOT-LEAK');
  return ui;
};

const listen = async (uiDir) => {
  const server = createRadioServer({ radio: stubRadio, token: TOKEN, ...(uiDir === undefined ? {} : { uiDir }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port };
};

const get = async (base, path, init = {}) => {
  const response = await fetch(base + path, init);
  return { status: response.status, headers: response.headers, text: await response.text() };
};

// 查越界必须发**原样**的路径：fetch 会把 '../' 规范化掉，那样测的就不是服务端了。
const raw = (base, path) =>
  new Promise((resolve) => {
    const url = new URL(base);
    const client = nodeHttp;
    const request = client.request({ host: url.hostname, port: url.port, path, method: 'GET' }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', () => resolve({ status: 0, text: '' }));
    request.end();
  });

test('uiDir 给了就是同源：/ 发 index.html、/assets 发文件，且不要令牌', async () => {
  const { server, base } = await listen(fixture());
  try {
    const index = await get(base, '/');
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(index.text, /EdgeRunner/);

    const asset = await get(base, '/assets/app.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(asset.text, /export const x/);

    const head = await get(base, '/assets/app.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '', 'HEAD 只给头，不给 body');

    // 数据面照旧要令牌：豁免的是"看得到界面"，不是"读得到数据"。
    assert.equal((await get(base, '/api/now')).status, 401);
  } finally {
    server.close();
  }
});

test('uiDir 外的东西一个字节都不给（越界与不存在的文件都落到统一错误信封）', async () => {
  const { server, base } = await listen(fixture());
  try {
    for (const path of ['/../secret.txt', '/..%2Fsecret.txt', '/assets/..%2F..%2Fsecret.txt', '/nope.html']) {
      const response = await raw(base, path);
      assert.equal(response.status, 404, path + ' 必须被挡住');
      assert.ok(!response.text.includes('THIS-MUST-NOT-LEAK'), path + ' 漏了 uiDir 外面的文件');
      assert.match(response.text, /"code":"INTERNAL"/, path + ' 也要走统一错误信封');
    }
  } finally {
    server.close();
  }
});

test('不给 uiDir 时 / 没有路由（开发期 UI 由 vite 发，不由内核发）', async () => {
  const { server, base } = await listen(undefined);
  try {
    assert.equal((await get(base, '/')).status, 401, '没有 uiDir：/ 就只是"另一个要令牌的路径"');
  } finally {
    server.close();
  }
});