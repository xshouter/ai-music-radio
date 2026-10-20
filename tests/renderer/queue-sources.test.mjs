// 3.7 的机械检查：喜欢这条线必须走冻结的契约端点（铁律 5），
// 且「删除」不许把「切歌」一并带走 —— 一行上两个动作，互斥是硬要求。
// 扫源码而不是渲染组件：renderer 没有测试运行器，理由同 error-copy.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('喜欢只有一条路：GET /api/favorites + POST /api/feedback', () => {
  const client = read('../../renderer/src/api/client.ts');
  assert.match(client, /request<FavoritesResponse>\('\/api\/favorites'\)/);
  assert.match(client, /request<OkResponse>\('\/api\/feedback'/);

  const hook = read('../../renderer/src/hooks/useRadio.ts');
  assert.match(hook, /getFavorites\(\)/);
  assert.match(hook, /reportFeedback\(track\.id, on \? 'like' : 'unlike'\)/);
});

test('FAV 源里的 ✕ 是独立元素：不许把删除冒泡成切歌', () => {
  const queue = read('../../renderer/src/components/Queue.tsx');
  const handler = /className="x"[\s\S]*?onClick=\{\(event\) => \{([\s\S]*?)\}\}/.exec(queue)?.[1];
  assert.ok(handler, 'Queue.tsx 里没找到 ✕ 的 onClick');
  assert.match(handler, /event\.stopPropagation\(\)/);
});

test('行内删除给得起回头路：3 秒撤销窗口，UNDO 把那首放回去', () => {
  const queue = read('../../renderer/src/components/Queue.tsx');
  assert.match(queue, /window\.setTimeout\(\(\) => setRemoved\(null\), 3000\)/);
  assert.match(queue, /REMOVED — UNDO/);
  assert.match(queue, /onFavorite\(removed, true\)/);
});

test('表头跟着来源换名字：QUEUE / FAVORITES', () => {
  const queue = read('../../renderer/src/components/Queue.tsx');
  assert.match(queue, /source === 'fav' \? 'FAVORITES' : 'QUEUE'/);
});

test('3.6 留下的两个死按钮已经接上，不残留占位文案', () => {
  const transport = read('../../renderer/src/components/Transport.tsx');
  assert.ok(!transport.includes('Favorites arrive in 3.7'), 'Transport.tsx 里还有 3.7 的占位文案');
  assert.match(transport, /onClick=\{props\.onLike\}/);
  // 来源开关跟着列表走：它从运输条搬到了队列表头（运输条要留呼吸，参考源的运输条只有 4 个键）。
  const queue = read('../../renderer/src/components/Queue.tsx');
  assert.match(queue, /onSource\('fav'\)/);
});