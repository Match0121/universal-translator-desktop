# 万能翻译站 · Universal Translator

**万能文本翻译工具（Windows 桌面版）**：不用在文件管理器与多种翻译软件之间挣扎，将你的文件拖入框内——不管是文件、游戏还是图片，**识别 → 提取 → 翻译 → 替换**，一个平台解决所有烦恼。

![导入界面](docs/assets/screenshot-import.png)

拖入游戏文件夹，自动扫描文本并识别引擎：

![扫描界面](docs/assets/screenshot-scan.png)

按文件查看翻译结果，原文 / 译文对照：

![翻译浏览界面](docs/assets/screenshot-browse.png)

## 核心特性

- **拖入即译**：把文件或整个游戏文件夹拖进窗口，自动扫描、自动识别引擎，无需手动挑选文件
- **编码自动识别**：UTF-8 / UTF-16 / Shift-JIS（日文）/ GBK（中文），日文游戏剧本无需手动转码
- **多格式提取**：txt / json / yaml / ini / srt / ass / rpy（Ren'Py）/ ks（吉里吉里，含日文「」引号）
- **xp3 资源包解包**：吉里吉里游戏的剧本锁在 .xp3 里？一键解包 → 翻译 → 重新封包回写（加密包暂不支持）
- **原编码写回**：导出保持文件原编码；译文超出原编码字符集时自动转存 UTF-8 并提示
- **多翻译引擎**：MyMemory（免费）/ 百度 / DeepL / OpenAI 兼容接口（本地 LLM 也可）
- **按文件查看译文**：左侧文件树切换，仅原文 / 对照 / 仅译文一键切换
- **深浅双主题**：暖灰纸感浅色 + 暖石墨深色，偏好自动记忆
- **完全本地**：所有处理在本机完成，游戏文件不出电脑

## 开发进度

| 模块 | 状态 |
| --- | --- |
| 文本文件翻译（txt/json/ini/srt/ass 等） | ✅ 已实现 |
| 游戏翻译（引擎识别 + rpy/ks 剧本 + xp3 解包封包） | ✅ 已实现 |
| 文档翻译（Word/PDF/Markdown） | 🔜 规划中 |
| 图片翻译（图片文字识别与替换） | 🔜 规划中 |

## 下载与使用

从 [Releases](https://github.com/Match0121/universal-translator-desktop/releases) 下载 `UniversalTranslator.exe`，双击运行（Windows 10/11，无需安装任何依赖）。

**首次运行提示"未知发布者"**：点「更多信息 → 仍要运行」即可（未签名软件的标准提示，属正常现象）。

使用说明与更新日志已内置在应用内：右上角 ⚙ 设置 → 使用说明 / 更新日志。

## 支持翻译的文件

- **文本文件**：`txt` / `md` / `log` / `json` / `xml` / `yaml` / `ini` / `cfg` / `srt` / `ass` 等
- **游戏剧本**：`rpy`（Ren'Py）、`ks`（吉里吉里）
- **资源包**：吉里吉里 `xp3`（解包翻译后封包回写；加密包不支持）
- **暂不支持**：图片文字、Unity/UE 等引擎的资源包、程序内嵌字符串

## 翻译引擎

| 引擎 | 说明 |
| --- | --- |
| MyMemory | 免费，无需配置，有每日额度 |
| 百度翻译 | 国内稳定，免费额度，需 APP ID + 密钥 |
| DeepL | 需 API Key |
| OpenAI 兼容接口 | 本地 LLM（Ollama / LM Studio 等） |

## 开发模式

```powershell
pip install pywebview
python desktop.py
```

内嵌窗口不可用时自动回退到系统浏览器（功能不变）。

打包：双击 `build.bat`，产物在 `dist\UniversalTranslator.exe`。

## 更新日志

### v1.1.1 (2026-08-14)
- 使用说明补充「支持翻译的文件」范围清单

### v1.1.0 (2026-08-14) · 首个正式版本
- 全新「高级简约」界面（暖灰纸感基底、墨色主按钮、雾钢蓝点缀、深浅双主题）
- 文件编码自动检测，日文游戏免转码
- 吉里吉里 xp3 资源包解包 + 封包
- 导出保持原编码写回
- 翻译 / 扫描界面返回按钮；使用说明与更新日志内置
- 版本号采用 x.x.x 三位格式

## License

[MIT](LICENSE)

---

# English Version

# Universal Translator

**A universal text translation tool for Windows desktop**: stop juggling between file managers and multiple translation apps. Just drag your files into the box — documents, games, or images — **detect → extract → translate → replace**, all in one place.

![Import screen](docs/assets/screenshot-import.png)

Drag in a game folder; text files are scanned and the engine auto-detected:

![Scan screen](docs/assets/screenshot-scan.png)

Review per-file translations, original vs translated side by side:

![Browse & translate screen](docs/assets/screenshot-browse.png)

## Highlights

- **Drag & translate**: drop a file or a whole game folder into the window; it auto-scans and auto-detects the engine
- **Encoding auto-detection**: UTF-8 / UTF-16 / Shift-JIS (Japanese) / GBK (Chinese) — no manual transcoding for Japanese game scripts
- **Multi-format extraction**: txt / json / yaml / ini / srt / ass / rpy (Ren'Py) / ks (KiriKiri, incl. Japanese 「」 quotes)
- **xp3 archive unpacking**: game scripts locked inside .xp3? Unpack → translate → repack in one click (encrypted packs not supported yet)
- **Original encoding preserved**: exports keep the source encoding; falls back to UTF-8 with a hint when the target charset can't represent the translation
- **Multiple translation engines**: MyMemory (free) / Baidu / DeepL / OpenAI-compatible endpoints (local LLMs work too)
- **Per-file review**: file tree on the left, switch between Original / Bilingual / Translated views
- **Light & dark themes**: warm paper-light and graphite-dark, preference remembered
- **100% local**: everything happens on your machine; game files never leave your computer

## Roadmap

| Module | Status |
| --- | --- |
| Text file translation (txt/json/ini/srt/ass etc.) | ✅ Done |
| Game translation (engine detection + rpy/ks scripts + xp3 unpack/repack) | ✅ Done |
| Document translation (Word/PDF/Markdown) | 🔜 Planned |
| Image translation (OCR + text replacement) | 🔜 Planned |

## Download & Usage

Grab `UniversalTranslator.exe` from the [Releases](https://github.com/Match0121/universal-translator-desktop/releases) page and double-click it (Windows 10/11, no dependencies to install).

**"Unknown publisher" warning on first run**: click "More info → Run anyway". This is the standard prompt for unsigned software.

The in-app help and changelog live in Settings (⚙ top right) → Help / Changelog.

## Supported Files

- **Text files**: `txt` / `md` / `log` / `json` / `xml` / `yaml` / `ini` / `cfg` / `srt` / `ass` etc.
- **Game scripts**: `rpy` (Ren'Py), `ks` (KiriKiri)
- **Archives**: KiriKiri `xp3` (unpack → translate → repack; encrypted packs not supported)
- **Not yet**: text in images, Unity/UE asset packs, strings embedded in binaries

## Translation Engines

| Engine | Notes |
| --- | --- |
| MyMemory | Free, no config, daily quota |
| Baidu Translate | Stable in China, free tier, requires APP ID + secret |
| DeepL | Requires API key |
| OpenAI-compatible | Local LLMs (Ollama / LM Studio etc.) |

## Development

```powershell
pip install pywebview
python desktop.py
```

Falls back to the system browser automatically if the embedded window is unavailable.

Build: run `build.bat`; output goes to `dist\UniversalTranslator.exe`.

## Changelog

### v1.1.1 (2026-08-14)
- Help section now lists the full supported-file scope

### v1.1.0 (2026-08-14) · First official release
- New minimal-premium UI (warm paper background, ink buttons, mist-steel-blue accents, light & dark themes)
- Encoding auto-detection — no manual transcoding for Japanese games
- KiriKiri xp3 unpack & repack
- Exports preserve original encoding
- Back buttons on scan/browse screens; in-app help & changelog
- Semantic versioning x.x.x

## License

[MIT](LICENSE)

