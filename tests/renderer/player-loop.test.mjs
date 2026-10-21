// 「放不出来就换下一首」必须有一个出口：全队列试过一遍还是没响，就停手并说出来。
// 没有这条出口，一次「这一批全都解析不出来」会变成一台不停换歌的机器 —— 每个失败都换下一首、
// 绕一圈回到起点，一秒十几次地打音乐源（实测抓到的：日志几秒内被刷到轮转，开发日志第 51 条）。
// 扫源码而不是渲染组件：renderer 没有测试运行器，理由同 error-copy.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = () => readFileSync(new URL('../../renderer/src/hooks/useRadio.ts', import.meta.url), 'utf8');

test('loaderror 的跳过要有出口：全队列试过一遍就停手，并把话说出来', () => {
  const src = hook();
  const handler = /sound\.on\('loaderror', \(\) => \{([\s\S]*?)\n    \}\);/.exec(src)?.[1];
  assert.ok(handler, 'useRadio.ts 里没找到音乐那条 loaderror 的处理器');
  assert.match(handler, /deadRef\.current\.add\(/, '失败的歌要记下来，否则永远绕不出这一圈');
  assert.match(handler, /deadRef\.current\.size >= /, '试遍整个队列就该停手');
  assert.match(handler, /setError\(/, '停手之后必须把「放不出来」说出来，不许静默停住');
  assert.match(handler, /return;/, '停手之后不许再 skip');
});

test('有一首真的响了，那条记忆就清掉（否则下一批正常的歌会被误停）', () => {
  const src = hook();
  assert.match(src, /sound\.on\('play', \(\) => \{[\s\S]{0,160}deadRef\.current\.clear\(\)/);
  assert.match(src, /const play = useCallback\(\(songId: string\) => \{[\s\S]{0,160}deadRef\.current\.clear\(\)/, '用户自己点的那一首要给一次公平的重试');
});
