# EdgeRunner · AI Music Radio

**装在你电脑上的个人 AI 电台。** 打开就在放，DJ 用英文讲两句，把歌串成一条不断的流；你随时可以对它说一句话，它当场调头。

> **一开机我就打碟。**

[![Release](https://img.shields.io/github/v/release/xshouter/edgerunner)](https://github.com/xshouter/edgerunner/releases)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6)
![Portable](https://img.shields.io/badge/portable-%E5%8D%95%E6%96%87%E4%BB%B6%20exe-lightgrey)
![TTS](https://img.shields.io/badge/TTS-offline%20voice%20included-3C3C3C)

| `DARK` | `LIGHT` |
|---|---|
| ![EdgeRunner · DARK](assets/screenshot-dark.png) | ![EdgeRunner · LIGHT](assets/screenshot-light.png) |

## ✨ 它能做什么

**放**

- **打开就是一个电台** —— 不用点播放，双击 exe 就开始出声。
- **DJ 每天排一次节目表**，按时段换 mood：清晨 / 白天 / 深夜。
- 音乐源是**网易云**：歌单、日推、搜索都能用；拿不到的歌自动换源或跳过，不会卡住整条队列。
- `%APPDATA%\edgerunner\music\` 里的本地音乐是兜底 —— 源不通也还有歌放。

**说**

- **每次换歌，DJ 用英文说一两句**：为什么放这首、接下来往哪走。
- **可以随时插话**：说一句 "something slow for focus"，DJ 当场改队列。
- 口播默认用**随包的离线音色** —— 不要钥匙、不要联网。

**听**

- **`♡` 就是"我的口味"**：点一下记一条，`FAV` 面板就地换成喜欢列表。
- **`QUEUE` / `FAVORITES` 两个面板**：一个是 DJ 排的，一个是你喜欢的，点一行就切到那首。
- 双主题（`DARK` / `LIGHT`），整块界面按固定比例等比缩放。

单用户、单机、无账号体系 —— 它只服务你一个人。

## 📦 下载

去 [Releases](https://github.com/xshouter/edgerunner/releases) 下载最新的 `EdgeRunner-x.y.z-portable.exe`，双击就跑。

- **只有便携版，没有安装包**：不写注册表、不装运行库，删掉 exe 就等于卸载。
- 系统要求：**Windows 10 / 11（64 位）**。
- 单文件约 180 MB —— 离线音色和内置音乐服务都在里面。
- 第一次启动会慢几秒：它要把内置的音乐服务拉起来。

## 🚀 第一次打开

**exe 里不含任何凭证，但第一次打开不哑**：它会放一首随包的示例曲目，并说一段出厂时就录好的口播。

界面上会有一条 `SET UP` 引导，教你把钥匙填进去。填完那一刻，它就换成一台真正属于你的电台 ——
节目表是你自己的，歌单是你自己的。

## 🔑 填上你自己的钥匙

右上角点 `LOGIN`，弹窗里填。三样东西，全部只存在你自己机器的用户数据目录里：

| 要什么 | 从哪来 | 不填会怎样 |
|---|---|---|
| **LLM**（base URL + 模型 + key） | 任何 OpenAI / Anthropic 兼容的服务。默认指向阿里云百炼的 OpenAI 兼容端点；base URL、模型名、协议都能改，模型可以从端点列出的清单里挑，也能手打 | 不排你自己的节目表：开机只放随包的示例曲目 + 出厂口播，并给一条 `SET UP` 引导 |
| **口播语音** | 默认 `PIPER`：随包自带、本机离线、不用填任何东西。想换成云端嗓子就选 `TTS (HTTP)`，填端点 + key | 不会发生 —— Piper 跟着包一起发 |
| **音乐源** | 网易云：浏览器登录 music.163.com 后，把整条 Cookie 头复制过来 | 音乐源退到本地音乐目录 |

## 🎛 怎么用

| 区域 | 是什么 |
|---|---|
| 顶栏 | `LOGIN`（填钥匙）、`DARK` / `LIGHT`（切主题） |
| 大钟 | 当前时间、日期，以及电台状态：`ON AIR` / `OFF AIR` / `DEGRADED` |
| 运输条 | 波形、正在放的曲目、上一首 / 播放·暂停 / 下一首 / 停止、`♡`、`HIDE`、`FAV`、音量 |
| 进度条 | 当前曲目放到哪儿了 |
| 队列 | `QUEUE`（DJ 排的）/ `FAVORITES`（你喜欢的）两个面板 |
| DJ 对话区 | DJ 说的话，以及你插的话 |
| 输入框 | 跟 DJ 说话的地方 |
| 页脚 | 连接状态 |

- **点队列里的一行** → 切到那首。
- **点曲目卡** → 播放 / 暂停。
- **点 `♡`** → 收进喜欢列表；在 `FAVORITES` 面板里，行尾的 `✕` 取消喜欢，3 秒内可以 `UNDO`。
- **点 DJ 的头像** → 弹出 DJ 详情。
- **`PLAY` / `REPLAY`** → 播那一条口播（口播和那首歌一起播）；口播界面点 `×` 退出。
- **`HIDE` / `LIST`** → 收起 / 展开队列面板。

## 🎵 音乐从哪来

网易云的 web 接口要过一层请求加密，这层由一个 **NeteaseCloudMusicApi 兼容服务**承担。
**那份服务跟着 exe 一起发**：启动时由 EdgeRunner 自己拉起来（挑一个空闲端口，不碰 3000），退出时收掉 ——
双击就能听，你不需要再开第二个进程。

它没起来也能用（前提是本地目录里真有歌）：降级链会退到本地音乐目录，界面上出现降级标记。

```
%APPDATA%\edgerunner\music\
```

两样都空的时候，电台会停在 `OFF AIR` 并明说：

> The music source is not answering. Only what is cached locally can play.

看到这一句，先看日志里的 `[netease]` 那几行 —— **它说的不是你的 key 有问题。**

## 🗂 你的数据

全部在本机：

```
%APPDATA%\edgerunner\
  data\edgerunner.sqlite   # 设置（钥匙 / cookie）、播放事实、历史、日表、口味结论
  data\taste\              # 语料：你自己写的 .md；系统的结论只写库，永不回写语料
  music\                   # 本地音乐目录
  tts\                     # 离线音色运行时与模型
  logs\edgerunner.log      # 现场日志：出了什么事，事后能读出来
```

- 钥匙只写在这台机器上；发布出去的 exe **不含任何凭证**。
- 想从头来一遍：关掉 EdgeRunner，删掉这个目录即可。

## ⚙️ 换成你自己的音乐服务

用环境变量覆盖内置的那份：

```powershell
$env:EDGERUNNER_NETEASE_BASE_URL = "http://127.0.0.1:3000"; & ".\EdgeRunner-x.y.z-portable.exe"
```

给了它，EdgeRunner 就不再代管内置服务。

## ❓ 常见问题

- **没有声音？** 先看系统默认输出设备和界面上的音量；再看设置里口播是不是被切成了 `TTS (HTTP)` —— 那个端点不通时，口播会被跳过，**音乐照放**。
- **某首歌放不出来？** 网易云对部分版权受限曲目不给播放地址，这是常态不是故障：电台会换源或跳过。整条队列都拿不到时，它会停下来并报 `MUSIC_NOT_RESOLVABLE`，而不是无限换歌。
- **能完全离线用吗？** 本地目录里的歌和随包的口播音色都能离线；排节目表要 LLM，网易云源要联网。
- **口播为什么是英文？** 这是刻意的 —— 这把嗓子只说英文，更接近电台 DJ 的语气。想换语言就切到 `TTS (HTTP)`，接你自己的语音端点。
- **第一次打开放的那首歌是谁的？** `assets/demo/` 里的示例曲目和它那段口播只作首次体验演示；填完钥匙就换成你自己的歌。
- **支持 macOS / Linux 吗？** 不做 —— 只做 Windows PC 单端。
- **新版本怎么更新？** 覆盖 exe 就行：没有自动更新通道，也没有安装器。用户数据在 `%APPDATA%`，换 exe 不会丢。

## 🚧 已知边界

- 只做 **PC 单端**。
- **不做歌词。**
- 口播默认是那把随包的离线音色，音质一般（好在不要钥匙、不要联网）；逐词高亮是按音频总长均分的 —— TTS 响应里没有词级时间戳。
- 音乐播放定位为**个人自用**；换成合法音源只需换掉音乐源这一环。