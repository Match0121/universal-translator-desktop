Title: 【开发者自荐】万能翻译站：把文件拖进窗口自动翻译的 Windows 工具

## 简介

万能翻译站（Universal Translator）是一个开源的 Windows 桌面万能文本翻译工具：不用在文件管理器与多种翻译软件之间挣扎，将文件拖入框内，不管是文件、游戏还是图片，识别、提取、翻译、替换，一个平台解决所有烦恼。当前已实现文本文件与游戏文本的完整链路（文档、图片翻译规划中），例如把整个游戏文件夹拖进窗口，自动扫描文本、识别编码、提取内容，翻译后按文件查看对照译文。

## 平台

Windows 10/11，单文件绿色 exe，双击即用，无需安装任何依赖。

## 功能特点

- 拖入即译：文件或整个游戏文件夹拖进窗口，自动扫描并识别游戏引擎
- 编码自动检测：UTF-8 / UTF-16 / Shift-JIS（日文）/ GBK（中文）免转码
- xp3 资源包：吉里吉里游戏剧本锁在 .xp3 里也能翻，一键解包翻译后封包回写
- 多格式：txt / json / ini / srt / ass / rpy（Ren'Py）/ ks（吉里吉里）
- 原编码写回：导出保持原编码；译文超出字符集自动转存 UTF-8 并提示
- 完全本地：翻译处理不出本机，支持 MyMemory / 百度 / DeepL / OpenAI 兼容接口

## 是否开源

开源（MIT）：https://github.com/Match0121/universal-translator-desktop

## 截图

![扫描界面](https://raw.githubusercontent.com/Match0121/universal-translator-desktop/main/docs/assets/screenshot-scan.png)

![翻译对照](https://raw.githubusercontent.com/Match0121/universal-translator-desktop/main/docs/assets/screenshot-browse.png)
