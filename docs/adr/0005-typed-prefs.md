# ADR-0005 · `Store` 去掉泛型 getPref，改成封闭 key 映射

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`docs/abstraction-layer.md` 第 3.5 节；开放问题 5
- **修订**：2026-10-20 删除 `net.lanAccess`（多端取消，见 ADR-0007）

## 背景

v0.1 的 `getPref<T>(key: string): Promise<T | null>` 里，`T` 由**调用方声明**，而值是从 JSON 反序列化出来的。
于是类型在说谎时没有任何东西会发现：库里存着 `"3"`，代码以为是 `3`；库里存着 `null`，代码当成缺失。

## 决策

去掉泛型，改成封闭映射：

```ts
type PrefKey = 'llm.baseUrl' | 'llm.model' | 'llm.protocol' | 'llm.apiKey' | 'tts.voice';
type PrefMap = {
  'llm.baseUrl': string;
  'llm.model': string;
  'llm.protocol': 'openai' | 'anthropic';
  'llm.apiKey': string;
  'tts.voice': string;
};
getPref<K extends PrefKey>(key: K): Promise<PrefMap[K] | null>;
setPref<K extends PrefKey>(key: K, value: PrefMap[K]): Promise<void>;
```

key 集合是封闭的；每个 key 配一个显式 parse 函数。解析失败**用默认值并记一条警告，不抛错**——
不能因为一个设置项坏了就让电台起不来。

## 后果

- **好处**：运行时不会再出现"类型说谎"；新增设置项的代价是显式的、看得见的。
- **代价**：新增一个设置项要改三处（`PrefKey`、`PrefMap`、parse 函数）。
- **重新打开的条件**：设置项超过约 20 个、手写 parse 变成负担时，再考虑用一个 schema 库统一处理。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 引入 zod 做 schema 校验 | 为不到 10 个 key 引入一个运行时依赖，不划算 |
| 保持泛型，靠 code review 把关 | review 看不见运行时的 JSON，把关不了 |