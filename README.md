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
- **本地音乐目录是兜底** —— 音乐源不通时，`%APPDATA%\edgerunner\music\` 里的歌照放。

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
- 覆盖 exe 就是升级：用户数据不在包里，更新不会丢。

## 🔑 需要

自己带两样，界面右上角 `LOGIN` 里填，只存在本机：

- **LLM apikey**（任何 OpenAI / Anthropic 兼容的服务）
- **网易云音乐 cookie**