// 从「一个文件」里取一个 key，并把这件事做成**可被断言的纯函数**。
//
// 为什么要有这个文件：百炼 token-plan 的 key 长这样 ——
//   sk-sp-<a>.<b>.<c>.<一长串>
// 旧的抽法是 `sk-[A-Za-z0-9_-]{8,}`：点不在字符集里，于是它**悄悄**返回了后半截（只剩 95 个字符），
// 冒烟脚本拿半截 key 去打接口，报回来一个看着像「key 无效」的失败 —— 排查成本全落在人身上。
// 教训：启发式抽取必须能被断言，所以它是纯函数 + 一个测试（tests/tools/key-file.test.mjs）。
export const KEY_PATTERN = /(sk-[A-Za-z0-9_.-]{8,}|[A-Za-z0-9_-]{24,})/;

/**
 * 三种输入都要认：
 *   1. 整份内容没空白 → 它本身就是 key（不管什么形状，原样用；`NAME=key` 这种单 token 写法取等号右边）
 *   2. 有空白 → 说明文字或配置文件，只能按形状找
 *   3. 找不着 → 返回空字符串，让调用方**明确地**失败，不要交出一个被切过的字符串
 */
export function keyFromText(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return '';
  if (!/\s/.test(raw)) {
    const eq = raw.lastIndexOf('=');
    return eq === -1 ? raw : raw.slice(eq + 1);
  }
  const hit = KEY_PATTERN.exec(raw);
  return hit === null ? '' : hit[0];
}