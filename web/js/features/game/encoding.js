// encoding.js — 文件编码检测与转换
//
// 读取：ArrayBuffer → BOM 检测 → UTF-8 严格校验 → Shift-JIS/GBK 试解码 + 假名投票
// 写回：浏览器 TextEncoder 只支持 UTF-8；Shift-JIS/GBK 交给本地服务 /api/encode（Python codecs）
//
// 本文件无 DOM 依赖（fetch 除外），可在 node 中直接单测。

// 只统计全角假名（0x3040-0x30FF）：日文剧本以全角假名为主；
// 中文按 SJIS 误解的“假名”几乎全是半角（0xA1-0xDF 单字节区），排除后不会干扰投票
const KANA_RE = /[\u3040-\u30ff]/g;

function kanaCount(s) {
  const m = s.match(KANA_RE);
  return m ? m.length : 0;
}

function concatBytes(head, tail) {
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

/**
 * 检测编码：'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis' | 'gbk'
 * 判定依据：
 *   1. BOM 优先
 *   2. 纯 ASCII 直接 UTF-8
 *   3. UTF-8 字节序列严格校验通过 → UTF-8
 *   4. Shift-JIS 与 GBK 都试解码，日文文本只有用正确的 Shift-JIS 解码才会出现大量假名，
 *      因此"假名多者胜"；两者假名都少（中文文本）则取 GBK
 */
export function detectEncoding(u8) {
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return 'utf-8';
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return 'utf-16le';
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return 'utf-16be';

  let ascii = true;
  for (let i = 0; i < u8.length; i++) {
    if (u8[i] > 0x7f) { ascii = false; break; }
  }
  if (ascii) return 'utf-8';

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return 'utf-8';
  } catch { /* 非 UTF-8，继续 */ }

  let sjisText = null;
  let gbkText = null;
  try { sjisText = new TextDecoder('shift_jis', { fatal: true }).decode(u8); } catch { /* ignore */ }
  try { gbkText = new TextDecoder('gbk', { fatal: true }).decode(u8); } catch { /* ignore */ }

  if (sjisText && gbkText) return kanaCount(sjisText) > kanaCount(gbkText) ? 'shift_jis' : 'gbk';
  if (sjisText) return 'shift_jis';
  if (gbkText) return 'gbk';
  return 'utf-8'; // 都无法解码，退回（显示乱码但不崩溃）
}

/** 按编码解码为 JS 字符串 */
export function decodeText(u8, encoding) {
  switch (encoding) {
    case 'utf-16le': {
      let s = new TextDecoder('utf-16le').decode(u8);
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      return s;
    }
    case 'utf-16be': {
      // WHATWG 无 'utf-16be'，交换字节序后按 utf-16le 解
      const swapped = new Uint8Array(u8.length);
      for (let i = 0; i + 1 < u8.length; i += 2) { swapped[i] = u8[i + 1]; swapped[i + 1] = u8[i]; }
      let s = new TextDecoder('utf-16le').decode(swapped);
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      return s;
    }
    default:
      return new TextDecoder(encoding).decode(u8);
  }
}

/** 读文件并检测编码：返回 { text, encoding } */
export async function readText(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const encoding = detectEncoding(u8);
  return { text: decodeText(u8, encoding), encoding };
}

function utf16Bytes(text, le) {
  const out = new Uint8Array(text.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) dv.setUint16(i * 2, text.charCodeAt(i), le);
  return out;
}

/**
 * 把字符串编码为目标编码的字节（Uint8Array）。
 * UTF-8/16 本地完成；Shift-JIS/GBK 走本地服务 /api/encode（Python codecs 原生支持）。
 */
export async function encodeText(text, encoding) {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text);
    case 'utf-16le':
      return concatBytes(new Uint8Array([0xff, 0xfe]), utf16Bytes(text, true));
    case 'utf-16be':
      return concatBytes(new Uint8Array([0xfe, 0xff]), utf16Bytes(text, false));
    default: {
      const resp = await fetch('/api/encode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encoding, text }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '编码转换失败');
      return new Uint8Array(data.bytes);
    }
  }
}
