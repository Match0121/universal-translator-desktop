// dirScanner.js — 目录授权 + 递归扫描文本文件

import { TEXT_EXT } from './extractors.js';

/**
 * 请求用户授权游戏文件夹（Chrome/Edge 的 File System Access API）
 * 浏览器安全限制：无法获取 exe 的绝对路径，因此每次授权都需要手动定位一次目录。
 */
export async function pickGameFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error('当前浏览器不支持文件夹授权，请使用最新版 Chrome 或 Edge');
  }
  return showDirectoryPicker({ mode: 'readwrite' });
}

/**
 * 递归扫描目录，收集文本候选文件 + 顺带收集 exe（用于引擎识别）和 xp3（吉里吉里资源包）
 * @param {FileSystemDirectoryHandle} root
 * @param {number} maxSizeBytes 超过该大小的文本文件标记 skipped（不读取）
 * @returns {Promise<{files: Array, exes: Array, xp3s: Array}>}
 */
export async function scanFolder(root, maxSizeBytes) {
  const files = [];
  const exes = [];
  const xp3s = [];
  async function walk(dir, rel) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        await walk(entry, rel ? rel + '/' + entry.name : entry.name);
      } else {
        const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
        if (ext === 'exe') {
          // 只记录 exe 用于引擎识别，不读取内容
          let f = null;
          try { f = await entry.getFile(); } catch (e) { continue; }
          exes.push({ name: entry.name, path: rel ? rel + '/' + entry.name : entry.name, size: f.size, file: f });
          continue;
        }
        if (ext === 'xp3') {
          // 吉里吉里资源包：记录用于解包，不直接读内容
          let f = null;
          try { f = await entry.getFile(); } catch (e) { continue; }
          xp3s.push({ name: entry.name, path: rel ? rel + '/' + entry.name : entry.name, size: f.size, file: f });
          continue;
        }
        if (!TEXT_EXT.has(ext)) continue;
        let f = null;
        try { f = await entry.getFile(); } catch (e) { continue; }
        if (!f.size) continue;
        files.push({
          handle: entry,
          name: entry.name,
          path: rel ? rel + '/' + entry.name : entry.name,
          ext,
          size: f.size,
          file: f,
          skipped: f.size > maxSizeBytes,
          unitCount: 0,
        });
      }
    }
  }
  await walk(root, '');
  files.sort((a, b) => a.path.localeCompare(b.path));
  exes.sort((a, b) => a.path.localeCompare(b.path));
  xp3s.sort((a, b) => a.path.localeCompare(b.path));
  return { files, exes, xp3s };
}
