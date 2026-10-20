# 词汇表（GLOSSARY）

本项目里这些词是**有定义的**。写文档、写 issue、写测试名都用这里的词，不要换同义词。

## 项目

- **EdgeRunner** —— 这个项目的名字。仓库名、包名、以后的 exe 与 UI wordmark 统一用它；
  「AI 音乐电台」是品类，不是名字，不要再拿它当代号。

## 电台本身

- **Brain / DJ** —— 排节目、写口播、决定下一首的那个 agent。它的输出叫 `Show`。
- **Show** —— 一次推理的产物：`{ say[], play[], reason, segue }`，代表一段完整的电台时段。
- **排表那一轮（plan round）** —— 同一个工具环的第二个终局：`emit_plan` 交三格日表。
  工具集是 `PLAN_TOOLS`，不碰播歌那一轮的 `TOOLS`（ADR-0030）。
- **say** —— DJ 要说出口的话，**逐句**的英文。不是一整段：因为口播要一句一句浮现、一句一句合成。
- **play** —— 本次 Show 要放的歌（`TrackRef[]`）。一次给一批，由调度器逐首消费。
- **reason** —— DJ 为什么这么排。给"我"看的，Profile 页可展示。
- **segue** —— 衔接语，可为空。
- **ON AIR** —— 电台正在播。它的反面不是"关机"，而是 `DEGRADED`。
- **DEGRADED** —— 降级态：链路断了，但音乐没停。
- **DayPlan / PlanBlock** —— 当天的节目表，切成若干时段，每个时段有 mood / genres / tracks。
  每天开机排一次（`buildDayPlan`）；**这三格由谁挑**是可插拔的（`PlanCurator`，ADR-0030）：
  有线就问他（从日推候选池里挑），没有就按场景词逐格搜。

## 系统的"缝"

- **Port（端口）** —— `shared/ports.ts` 里的 interface，描述一项外部能力。换实现不动调用方。
- **Provider** —— 端口的一个具体实现，住在 `core/providers/`。
- **唯一组装点** —— `main/bootstrap.ts`。全仓库唯一允许 `new` 具体实现的地方。
- **降级链（`MusicSourceChain`）** —— 依次尝试多个音乐源。这一层吸收全部"取不到"的失败，调用方只看到成功或 `null`。
  但**"源不在"和"没这首"是两件事**：全空手而归、且至少一个源是抛错走的，它会喊一次 `onUnreachable`（ADR-0027）。
- **错误码（`ErrorCode`）** —— `shared/api-types.ts` 里的**封闭枚举**（六个），每个码在 UI 上一句人话。
  上游怎么坏，就必须翻译成这六个里的哪一个 —— 不许一律报 `INTERNAL`（ADR-0027）。
- **Clock / EnvProvider** —— 被注入的"现在几点"和外部世界（天气、日历）。禁止直接 `new Date()`。
- **日推（daily）** —— 他自己那批推荐。在端口上它没有专门的名字，就是「场景词为空」的那次 `recommend`；
  排表那一轮靠 `daily_recommend` 拿它当候选池（ADR-0030）。

## 数据与状态

- **Track / TrackRef** —— 前者是完整歌曲信息；后者只带队列需要的字段（id / title / artist）。
- **TasteDoc** —— 口味语料：人写的几份 md，加上系统学到的更新（`TasteUpdate`）。
- **PlayEvent** —— 一首歌的播放事实（含实际音质档位、是否被跳过）。统计和 taste 闭环都靠它。
- **Prefs** —— 设置项（key、模型、base URL、TTS 音色）。key 只回显"是否已配置"，**永不回显明文**。

## 流程

- **铁律（Iron rule）** —— `AGENTS.md` 里那 5 条不可违反的规则。说"铁律 3"就是指那一条。
- **grill** —— 动手前把需求逐轮追问到没有隐含假设；产出落 `docs/requirements/<feature>.md`。
- **四段** —— PR 正文的强制结构：背景 / 遇到的困难 / 决策与取舍 / 验证证据。
- **ADR** —— 架构决策记录，落在 `docs/adr/NNNN-<slug>.md`。
- **契约** —— `shared/api-types.ts` 里的前后端唯一真相；改它等于 ADR 级改动。