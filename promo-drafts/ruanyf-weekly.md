Title: 【开源自荐】万能翻译站：把文件拖进窗口，自动识别、提取、翻译、替换，一个平台搞定（文本翻译工具）

万能翻译站（Universal Translator）是一个开源的 Windows 桌面文本翻译工具。它的目标是让"翻译文本"这件事不再需要你在文件管理器和多种翻译软件之间来回挣扎：不管是文件、游戏还是图片，把内容拖进窗口，剩下的自动完成。当前已实现文本文件与游戏文本的完整链路，文档与图片翻译在规划中。项目地址：https://github.com/Match0121/universal-translator-desktop（MIT 开源）

目前实际能做的，是解决一个很具体的痛点：玩日文游戏看不懂剧本，而游戏文本要么是 Shift-JIS 编码的明文，要么锁在吉里吉里 xp3 资源包里，手动转码、解包、逐句翻译非常折腾。把整个游戏文件夹拖进窗口，剩下的自动完成。

![扫描界面](https://raw.githubusercontent.com/Match0121/universal-translator-desktop/main/docs/assets/screenshot-scan.png)

![翻译对照](https://raw.githubusercontent.com/Match0121/universal-translator-desktop/main/docs/assets/screenshot-browse.png)

核心特性：

- 📁 拖入即译：文件或整个游戏文件夹拖进窗口，自动扫描文本文件并识别游戏引擎
- 🔤 编码自动检测：UTF-8 / UTF-16 / Shift-JIS（日文）/ GBK（中文），日文剧本无需手动转码
- 🎮 xp3 资源包解包：吉里吉里游戏的剧本锁在 .xp3 里也能翻，一键解包、翻译、封包回写
- 📄 多格式提取：txt / json / ini / srt / ass / rpy（Ren'Py）/ ks（吉里吉里，含日文「」引号）
- 💾 原编码写回：导出保持文件原编码，译文超出字符集时自动转存 UTF-8 并提示
- 🔒 完全本地：翻译处理都在本机完成，文件不出电脑；单文件绿色 exe，无需安装任何依赖
- 🌗 深浅双主题，使用说明内置

安装（Windows 10/11）：

```
从 Releases 下载 UniversalTranslator.exe，双击运行
```

技术栈：Python + pywebview + PyInstaller，前端原生 ES Modules 无构建依赖。开源协议：MIT。
