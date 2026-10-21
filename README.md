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

- **打开就是一个电台** —— 双击 exe 就出声，不用点播放，一首接一首，不断线。
- **每天排一份节目表** —— `07:00` 清晨 / `12:00` 白天 / `18:00` 深夜，三段各有各的 mood，DJ 按表往下推。
- **它先看你听什么** —— 首次填完 cookie，它把你的歌单读完，写成一份 `taste.md`；之后的节目表都按这份口味排。
- 音乐来自**你自己的网易云**：日推当候选池，歌单和搜索都能用；拿不到的歌自动换源或跳过，不会卡住队列。
- **本地目录兜底** —— 音乐源不通时，本地音乐照放。

**说**

- **每首歌都有一段英文口播** —— 讲的是这首歌本身：一个音色、一段节奏、一种情绪。切歌时自动开讲，讲完就接歌。
- **口播按曲风换语气**：氛围音乐不急不躁，摇滚短促向前；一段 15–20 秒。
- **随时插一句话**：说一句 "something slow for focus"，DJ 当场改队列。
- 口播默认用**随包的离线音色** —— 不要钥匙、不要联网；想换音色，填自己的 TTS 也行。

**听**

- **`♡` 就是"我的口味"**：点一下记一条，`FAVORITES` 面板就地换成喜欢列表。
- **`QUEUE` / `FAVORITES` 两个面板**：一个是 DJ 排的，一个是你喜欢的，点一行就切到那首。
- **口播跟着歌走**：没听过的只有 `PLAY`，听过一次就变成 `REPLAY`，随时重听。
- 双主题（`DARK` / `LIGHT`），整块界面按固定比例等比缩放。

单用户、单机、无账号体系 —— 它只服务你一个人。

## 📦 下载

去 [Releases](https://github.com/xshouter/edgerunner/releases) 下载最新的 `EdgeRunner-x.y.z-portable.exe`，双击就跑。

- **只有便携版，没有安装包**：不写注册表、不装运行库，删掉 exe 就等于卸载。
- 系统要求：**Windows 10 / 11（64 位）**。
- 单文件约 180 MB —— 离线音色和内置音乐服务都在里面。
- 第一次启动会慢几秒：它要把内置的音乐服务拉起来。
- 覆盖 exe 就是升级：用户数据不在包里，更新不会丢。

## 🔑 需要

自己带两样，界面右上角 `LOGIN` 里填，只存在本机：

- **LLM apikey**（任何 OpenAI / Anthropic 兼容的服务）
- **网易云音乐 cookie**