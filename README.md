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

打开它，今天的节目表已经排好了。`07:00` 清晨、`12:00` 白天、`18:00` 深夜，各是各的 mood —— 这张表是它早上照你的口味排的：你第一次填完 cookie 之后，它把你的歌单读完，写成一份 `taste.md`。

每一首歌前面，它都会说两句英文：什么音色，什么节奏，为什么是现在。十几秒，说完就接歌 —— 切歌的时候它自动开讲。氛围音乐它说得慢，摇滚它说得短。

你也可以随时插一句。说一句 "something slow for focus"，它当场把队列改成慢的。按过一次 `♡` 的歌会进你那张单子；`QUEUE` 和 `FAVORITES` 是同一件事的两个视角 —— 一个是它排的，一个是你喜欢的，点一行就切过去。

歌从你自己的网易云来：日推当候选池，歌单和搜索都能用。

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