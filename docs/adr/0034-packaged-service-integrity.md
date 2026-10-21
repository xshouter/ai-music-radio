# ADR-0034 · 内置服务必须真的进包：extraResources 会静默吃掉源目录顶层的 node_modules

- **状态**：已接受
- **日期**：2026-10-21
- **关联**：`electron-builder.yml`、`.github/workflows/release.yml`、`core/radio.ts`、`core/http.ts`、
  `main/netease-service.ts`；ADR-0016、ADR-0027、ADR-0028
- **需求**：`docs/requirements/bundled-service.md`

## 背景

`v0.1.5` 的便携版双击之后是这样：界面正常、时钟在走、引导横幅在，但 **`0 TRACKS` / Nothing queued yet.**，
聊天区两条 `NO_LLM_KEY: upstream returned HTTP 401`。用户的报告是一句话：「我打开是这样」。

查下来是**两个互不相干的毛病叠在一起**，而且第二个把第一个盖住了。

**① 包里根本没有内置的音乐源。** `win-unpacked\resources\netease\` 里只有 `package.json` 与
`package-lock.json` 两个文件（源目录 `vendor/netease` 是 2849 个文件 / 27 MB）。`main/main.ts:49`
问「落点里有 `node_modules/NeteaseCloudMusicApi/app.js` 吗」→ 没有 → 内置服务不拉起 →
`neteaseBaseUrl` 是 `undefined` → `main/bootstrap.ts:65` 的默认值把它带到
`DEFAULT_NETEASE_BASE_URL = http://127.0.0.1:3000`（ADR-0016 留给「用户自己起一个」的那条路）。
本机 3000 上没有东西，所以「没有音乐」在界面上只表现为「队列就是空的」。

**② 那条 401 是大脑报的，不是音乐源报的。** 音乐链会把源的错误收成空结果
（`core/music/index.ts` 的 `firstNonEmpty`），所以能走到 `nameFailure` 的 `HttpError` 只能来自 LLM
那一路。实测两条，一次说清：同一把 key 打到 DashScope 的**默认**域名是
`401 Incorrect API key provided`（上游原话），打到 prefs 里那一个 `token-plan.cn-beijing.maas.aliyuncs.com`
是 **200**。用户那把 `sk-sp-…` 是 token-plan 的形状，只认后者。

于是症状被读错了：`llmFailureCode` 把 401/403 一律翻成 `NO_LLM_KEY`（ADR-0027 定的：401 是「key 不被接受」），
而界面给 `NO_LLM_KEY` 画的是「点这里补 key」的引导横幅 —— **「包里没有音乐」看起来像「你没填 key」。**

## 决策

**① node_modules 拆成第二条映射，而不是改目录布局。**

```yaml
- from: vendor/netease
  to: netease
- from: vendor/netease/node_modules   # ← 必须单独一条
  to: netease/node_modules
```

原因是 electron-builder 一条**没写在文档里**的行为：`app-builder-lib/out/util/filter.js` 的
`createFilter` 里，`relative === 'node_modules'` 直接 `return false`，而且这个判断**早于用户写的
`filter` 生效** —— 也就是写什么 filter 都救不回来。它只作用于**顶层**（同一处注释自己写着
"filter the root node_modules, but not a subnode_modules"），所以把源换成 `vendor/netease/node_modules`、
落点写成 `netease/node_modules` 就绕开了它，而 `core/` 期望的形状
（`<dir>/node_modules/NeteaseCloudMusicApi/app.js`）一个字都不用动。

没选的另外三条，理由记下来：

- **把服务挪进子目录**（`vendor/netease/app/node_modules`）：要同时改 `main/netease-service.ts` 的
  `neteasePackageDir` 和本地开发路径 —— 为了绕打包器的脾气去动 core 的形状，方向反了。
- **用 `afterPack` 钩子自己拷**：多一个钩子脚本要维护，且 CI 与本地各跑一份容易分岔。
- **放进 `files`（asar 内）**：它是**要被 spawn 的进程**，asar 里跑不起来 —— 与 ADR-0028 拒绝 asar 是同一条理由。

**② CI 加一条落点自检，让「能出包但是坏的」发不出去。**

```bash
test -f release/win-unpacked/resources/netease/node_modules/NeteaseCloudMusicApi/app.js || exit 1
```

这一路的失败模式是**静默**的：exe 打得出来、CI 从边界检查到测试全绿、界面正常渲染，只是双击之后
一台电台没有音乐。三行断言换掉一整类「发布完才知道」。守卫放在打包那一侧，因为它守的是**打包约定**，
不是 `core/` 的逻辑。

**③ 上游那句话跟着错误一起走（`core/radio.ts` 的 `describeHttp`）。**

第 ② 个毛病查得慢，是因为界面上只有 `upstream returned HTTP 401`，上游自己那句
`Incorrect API key provided` 被丢掉了 —— 而那正是用户唯一能顺着改的东西。现在 `HttpError.detail`
被压成一行、截断 200 字，跟在状态码后面。**只带响应体，不带请求**（请求里有 key）。

## 后果

- 便携版每次打包多拷 27 MB。本来就该拷，之前只是没拷成。
- 落点与 `vendor/` 是**同一份字节**：`app.js` 的 sha256 可对（`476716a876daaf85`），谁被换过一眼能看出来。
- 如果 electron-builder 以后改了 `filter` 这块行为，CI 那条自检会**报警**，不会静默降级成「包里没有服务」。
- 界面仍然把 401 画成「补 key」的引导横幅。上游原话现在可见了，措辞那一层留作待办（`docs/roadmap.md`）。
