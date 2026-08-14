// exeParser.js — 纯 JS 解析 Windows PE 可执行文件
// 1) 读取版本信息（产品名/公司/版本）  2) 扫描特征字符串识别游戏引擎

const ENGINES = [
  { name: 'Unity', sigs: ['unityplayer', 'unityengine', 'globalgamemanagers', 'il2cpp', 'mono'] },
  { name: 'Unreal Engine', sigs: ['unrealengine', 'ue4', 'ue5'] },
  { name: "Ren'Py", sigs: ['renpy', 'librenpython'] },
  { name: '吉里吉里 (KiriKiri)', sigs: ['kirikiri', 'tvp', 'xp3'] },
  { name: 'RPG Maker MV/MZ', sigs: ['rgpmv', 'pixi', 'nwjs'] },
  { name: 'RPG Maker XP/VX/Ace', sigs: ['rgss'] },
  { name: 'Godot', sigs: ['godot', 'godotengine'] },
  { name: 'TyranoBuilder', sigs: ['tyrano'] },
  { name: 'GameMaker', sigs: ['gamemaker', 'yyg'] },
  { name: 'Electron', sigs: ['electron', 'app.asar'] },
  { name: 'Wolf RPG Editor', sigs: ['wolf rpg', 'wolflib'] },
];

const align4 = n => (n + 3) & ~3;

function readUTF16Str(dv, off) {
  let end = off;
  while (dv.getUint16(end, true) !== 0) end += 2;
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + off, end - off);
  return new TextDecoder('utf-16le').decode(bytes);
}

/** 遍历资源目录树，找到指定 type id 的第一个子目录 */
function findResDir(dv, rootOff, entryOff) {
  return rootOff + (entryOff & 0x7FFFFFFF);
}

/** 解析 VS_VERSIONINFO 块（dataOff 为文件偏移），结果写入 info */
function parseVersionInfo(dv, dataOff, info) {
  const wLength = dv.getUint16(dataOff, true);
  if (wLength < 6) return;
  const end = dataOff + wLength;
  // 根块头
  let pos = dataOff + 6;
  const rootKeyLen = (readUTF16Str(dv, pos).length + 1) * 2;
  pos = align4(pos + rootKeyLen);
  // 跳过 wValueLength / wType / value（VS_FIXEDFILEINFO）
  const vLen = dv.getUint16(pos, true);
  pos += 4 + align4(vLen);
  // 遍历子块（StringFileInfo 等）
  while (pos + 6 <= end) {
    const len = dv.getUint16(pos, true);
    if (len < 6 || pos + len > end) break;
    const key = readUTF16Str(dv, pos + 6);
    if (key === 'StringFileInfo') {
      parseStringFileInfo(dv, pos, pos + len, info);
    }
    pos += len;
  }
}

function parseStringFileInfo(dv, blockOff, blockEnd, info) {
  // blockOff 是 StringFileInfo 块的起点；其子块是 StringTable
  let pos = blockOff + 6;
  const keyLen = (readUTF16Str(dv, pos).length + 1) * 2;
  pos = align4(pos + keyLen);
  const vLen = dv.getUint16(pos, true);
  pos += 4 + align4(vLen);
  while (pos + 6 <= blockEnd) {
    const slen = dv.getUint16(pos, true);
    if (slen < 6 || pos + slen > blockEnd) break;
    const sEnd = pos + slen;
    // StringTable 内是字符串条目
    let p = pos + 6;
    const skeyLen = (readUTF16Str(dv, p).length + 1) * 2;
    p = align4(p + skeyLen);
    const svl = dv.getUint16(p, true);
    p += 4 + align4(svl);
    while (p + 6 <= sEnd) {
      const elen = dv.getUint16(p, true);
      if (elen < 6 || p + elen > sEnd) break;
      const ekey = readUTF16Str(dv, p + 6);
      let q = align4(p + 6 + (ekey.length + 1) * 2);
      const evl = dv.getUint16(q, true);
      q += 4;
      if (evl > 0) {
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset + q, evl);
        const val = new TextDecoder('utf-16le').decode(bytes).replace(/\u0000+$/, '');
        if (val) info[ekey] = val;
      }
      p += elen;
    }
    pos += slen;
  }
}

/** 扫描可打印字符串（ASCII + UTF-16LE），用于引擎识别 */
function scanStrings(dv, byteLength) {
  const maxBytes = Math.min(byteLength, 64 * 1024 * 1024);
  const out = [];
  const dec8 = new TextDecoder('latin1');
  const dec16 = new TextDecoder('utf-16le');
  // ASCII
  let start = -1;
  for (let i = 0; i < maxBytes; i++) {
    const c = dv.getUint8(i);
    const ok = c >= 32 && c <= 126;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= 6) {
        const b = new Uint8Array(dv.buffer, dv.byteOffset + start, i - start);
        out.push(dec8.decode(b));
        if (out.length >= 4000) return out;
      }
      start = -1;
    }
  }
  // UTF-16LE（步进 2，仅抽样前段）
  let s2 = -1;
  for (let i = 0; i + 1 < maxBytes; i += 2) {
    const c = dv.getUint16(i, true);
    const ok = c >= 32 && c <= 126;
    if (ok && s2 < 0) s2 = i;
    if (!ok && s2 >= 0) {
      if ((i - s2) / 2 >= 5) {
        const b = new Uint8Array(dv.buffer, dv.byteOffset + s2, i - s2);
        out.push(dec16.decode(b));
        if (out.length >= 4000) return out;
      }
      s2 = -1;
    }
  }
  return out;
}

export function detectEngine(strings, info) {
  const joined = strings.join('\n').toLowerCase() + '\n' + JSON.stringify(info || {}).toLowerCase();
  const hits = [];
  for (const e of ENGINES) {
    let score = 0;
    for (const s of e.sigs) if (joined.includes(s)) score++;
    if (score > 0) hits.push({ ...e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.length ? hits[0].name : null;
}

/**
 * 解析 exe 文件（File 对象或 { name, arrayBuffer }）
 * @returns {Promise<{name, product, company, version, description, engine}>}
 */
export async function parseExe(file) {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  const byteLength = buf.byteLength;

  if (byteLength < 0x40 || dv.getUint16(0, true) !== 0x5A4D) {
    throw new Error('不是有效的 Windows 可执行文件（exe）');
  }
  const peOff = dv.getUint32(0x3C, true);
  if (peOff + 24 > byteLength || dv.getUint32(peOff, true) !== 0x00004550) {
    throw new Error('PE 头损坏或缺失');
  }
  const coff = peOff + 4;
  const numSec = dv.getUint16(coff + 2, true);
  const optOff = coff + 20;
  const magic = dv.getUint16(optOff, true);
  const is64 = magic === 0x20B;
  if (magic !== 0x10B && magic !== 0x20B) throw new Error('不支持的 PE 格式（非 PE32/PE32+）');
  const sizeOpt = is64 ? 240 : 224;
  const secOff = optOff + sizeOpt;

  // 节表：RVA → 文件偏移
  const sections = [];
  for (let i = 0; i < numSec; i++) {
    const o = secOff + i * 40;
    sections.push({ va: dv.getUint32(o + 12, true), rawPtr: dv.getUint32(o + 20, true), rawSize: dv.getUint32(o + 16, true) });
  }
  const rvaToOff = rva => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + s.rawSize) return s.rawPtr + (rva - s.va);
    }
    return -1;
  };

  // 资源目录（数据目录索引 2）
  const info = {};
  try {
    const ddOff = optOff + (is64 ? 112 : 96);
    const resRva = dv.getUint32(ddOff + 2 * 8, true);
    if (resRva > 0 && rvaToOff(resRva) >= 0) {
      const rootOff = rvaToOff(resRva);
      // 资源目录：type → name → lang
      const readDirEntries = dirOff => {
        const numNamed = dv.getUint16(dirOff + 12, true);
        const numId = dv.getUint16(dirOff + 14, true);
        return { dirOff, count: numNamed + numId, entriesBase: dirOff + 16 };
      };
      const findById = (dirOff, id) => {
        const { count, entriesBase } = readDirEntries(dirOff);
        for (let i = 0; i < count; i++) {
          const e = entriesBase + i * 8;
          const nameField = dv.getUint32(e, true);
          const offField = dv.getUint32(e + 4, true);
          if ((nameField & 0x80000000) === 0 && nameField === id) return offField;
        }
        return -1;
      };
      const firstEntry = dirOff => {
        const { count, entriesBase } = readDirEntries(dirOff);
        if (count === 0) return -1;
        return dv.getUint32(entriesBase + 4, true);
      };
      // type 16 = RT_VERSION
      const verEntry = findById(rootOff, 16);
      if (verEntry >= 0) {
        const nameDir = findResDir(dv, rootOff, verEntry);
        const langEntry = firstEntry(nameDir);
        if (langEntry >= 0) {
          const langDir = findResDir(dv, rootOff, langEntry);
          const dataEntry = firstEntry(langDir);
          if (dataEntry >= 0) {
            const dataRva = dv.getUint32(findResDir(dv, rootOff, dataEntry), true);
            const dataOff = rvaToOff(dataRva);
            if (dataOff >= 0) parseVersionInfo(dv, dataOff, info);
          }
        }
      }
    }
  } catch (e) {
    console.warn('版本信息解析失败（不影响使用）:', e.message);
  }

  // 引擎识别
  const strings = scanStrings(dv, byteLength);
  const engine = detectEngine(strings, info);

  return {
    name: file.name.replace(/\.exe$/i, ''),
    product: info.ProductName || '',
    company: info.CompanyName || '',
    version: info.FileVersion || info.ProductVersion || '',
    description: info.FileDescription || '',
    engine,
  };
}
