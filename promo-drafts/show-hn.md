Title: Show HN: Universal Translator – drop any file in, auto-detect encoding, translate, replace. One platform for all your text translation

First comment (post immediately after submitting, then keep responding in the thread):

I got tired of juggling between file managers and a bunch of translation apps whenever I needed to translate text, especially game scripts. Japanese visual novels are a perfect example: the scripts are Shift-JIS encoded .ks files (garbled in any UTF-8 editor), and for KiriKiri-engine games they're packed inside .xp3 archives. The old workflow was: unpack → transcode → copy-paste each line into a translator. I wanted one drag-and-drop step instead.

So this is a Windows desktop tool where you drop files (or a whole game folder) into the window, and it handles detect → extract → translate → replace in one place. Text files and game text are fully supported today; document and image translation are on the roadmap.

What it does now:
- Drop a file or a whole game folder into the window; it scans text files and detects the engine (KiriKiri / Ren'Py / others)
- Encoding auto-detection: UTF-8 / UTF-16 / Shift-JIS / GBK, no manual transcoding
- KiriKiri .xp3 unpack → translate → repack in one flow (encrypted packs are detected and skipped with a clear message)
- Formats: txt / json / ini / srt / ass / rpy / ks (incl. Japanese 「」 quotes)
- Exports preserve the original file encoding, with a UTF-8 fallback + hint when the target charset can't represent the translation
- Translation engines: MyMemory (free) / Baidu / DeepL / OpenAI-compatible endpoints (local LLMs work)

Stack: Python + pywebview + PyInstaller, vanilla ES-module frontend, no build step. Ships as a single green exe, MIT licensed. Everything runs locally; your files never leave the machine.

Repo: https://github.com/Match0121/universal-translator-desktop (screenshots in the README)

Happy to answer questions about the xp3 format work or the encoding detection heuristics.
