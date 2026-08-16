// docParser.js — 文档翻译解析器（P1：md/txt/html + docx + epub）
//
// 原理：
//  - txt/md 是纯文本，按行处理
//  - html/epub 是 DOM 文本节点，按节点提取与写回
//  - docx/epub 本质是 ZIP + XML（OOXML / XHTML），用 JSZip 解压、改 XML、重新打包
//
// 单元模型与游戏翻译对齐：{file, seq, original, raw, translated, error, ex, docType}
//  - txt/md 的 raw 记录 lineIndex（行级写回）
//  - html/docx/epub 的 raw 记录节点定位（seq），写回时用同一过滤规则重新定位节点
//
// 本文件无 DOM 依赖的部分可在 node 单测（DOM 部分依赖浏览器 DOMParser）。

import { readText } from '../game/encoding.js';

export const DOC_EXT = new Set(['md', 'txt', 'html', 'htm', 'docx', 'epub']);
const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function detectDocType(fileName) {
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  if (ext === 'docx') return 'docx';
  if (ext === 'epub') return 'epub';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'txt') return 'plain';
  return null;
}

function isTranslateableDoc(s) {
  if (!s) return false;
  const t = s.trim();
  if (!t || t.length > 800) return false;
  if (/^[\d\s.,%+\-*\/=<>:;|!?()[\]{}"'`~^#$@&]+$/.test(t)) return false;
  return true;
}

function unitText(u, mode) {
  if (mode === 'original') return u.original;
  if (mode === 'translated') return u.translated || u.original;
  return u.original + '（' + (u.translated || '') + '）';
}

/* ---------------- 纯文本（txt/md） ---------------- */

async function extractPlain(file, fileName) {
  const { text } = await readText(file);
  const lines = text.split(/\r?\n/);
  const units = [];
  lines.forEach((line, idx) => {
    const original = line.trim();
    if (!isTranslateableDoc(original)) return;
    units.push({ file: fileName, seq: units.length, lineIndex: idx, original, raw: line, translated: '', error: '', ex: 'plain', docType: 'plain' });
  });
  return { units, meta: { text } };
}

function rebuildPlain(meta, units, mode) {
  const lines = meta.text.split(/\r?\n/);
  for (const u of units) {
    if (u.lineIndex == null) continue;
    lines[u.lineIndex] = unitText(u, mode);
  }
  return { text: lines.join('\n') };
}

/* ---------------- HTML / EPUB（DOM 文本节点） ---------------- */

function extractHtmlDom(html, fileName, docType, containerFile) {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const units = [];
  const nodes = [];
  const walker = dom.createTreeWalker(dom.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
      return isTranslateableDoc(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n, i) => {
    units.push({
      file: fileName, seq: i, original: (n.nodeValue || '').trim(),
      raw: { dom, node: n, container: containerFile },
      translated: '', error: '', ex: 'html', docType,
    });
  });
  return units;
}

async function extractHtmlFile(file, fileName) {
  const { text } = await readText(file);
  const units = extractHtmlDom(text, fileName, 'html', null);
  return { units, meta: { text } };
}

function rebuildHtmlDom(meta, units, mode) {
  const dom = new DOMParser().parseFromString(meta.text, 'text/html');
  const nodes = [];
  const walker = dom.createTreeWalker(dom.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
      return isTranslateableDoc(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const bySeq = new Map(units.map(u => [u.seq, u]));
  nodes.forEach((n, i) => {
    const u = bySeq.get(i);
    if (u) n.nodeValue = unitText(u, mode);
  });
  return { text: new XMLSerializer().serializeToString(dom) };
}

/* ---------------- DOCX（ZIP + word/document.xml） ---------------- */

async function loadZip(blob) {
  if (!window.JSZip) throw new Error('JSZip 未加载（离线时请先连接网络加载一次）');
  return window.JSZip.loadAsync(blob);
}

function docxParagraphs(dom) {
  return Array.from(dom.getElementsByTagNameNS(DOCX_NS, 'p'));
}

function paraText(para, ns) {
  const tNodes = para.getElementsByTagNameNS(ns, 't');
  let s = '';
  for (const t of tNodes) s += t.textContent || '';
  return s.trim();
}

async function extractDocx(file, fileName) {
  const zip = await loadZip(file);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('docx 缺少 word/document.xml');
  const xml = await entry.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const units = [];
  const paras = docxParagraphs(dom);
  let seq = 0;
  for (const para of paras) {
    const original = paraText(para, DOCX_NS);
    if (!isTranslateableDoc(original)) continue;
    units.push({ file: fileName, seq: seq++, original, raw: null, translated: '', error: '', ex: 'docx', docType: 'docx' });
  }
  return { units, meta: { zip, xml, dom } };
}

function rebuildDocx(meta, units, mode) {
  const dom = new DOMParser().parseFromString(meta.xml, 'application/xml');
  const paras = docxParagraphs(dom);
  let seq = 0;
  const bySeq = new Map(units.map(u => [u.seq, u]));
  for (const para of paras) {
    const original = paraText(para, DOCX_NS);
    if (!isTranslateableDoc(original)) continue;
    const u = bySeq.get(seq);
    seq++;
    if (!u) continue;
    const tNodes = para.getElementsByTagNameNS(DOCX_NS, 't');
    if (!tNodes.length) continue;
    const text = unitText(u, mode);
    // 译文写入段落首个 w:t，其余 w:t 文本清空（保留 run 格式框架）
    tNodes[0].textContent = text;
    for (let i = 1; i < tNodes.length; i++) tNodes[i].textContent = '';
  }
  const newXml = new XMLSerializer().serializeToString(dom);
  return { text: newXml, zipEntry: 'word/document.xml' };
}

/* ---------------- EPUB（ZIP + 多个 XHTML） ---------------- */

const EPUB_HTML_RE = /\.(x?html?|xhtm)$/i;

async function extractEpub(file, fileName) {
  const zip = await loadZip(file);
  const htmlEntries = Object.keys(zip.files).filter(n => EPUB_HTML_RE.test(n));
  const units = [];
  const metas = [];
  for (const name of htmlEntries) {
    const xml = await zip.file(name).async('string');
    const us = extractHtmlDom(xml, fileName + ' › ' + name.split('/').pop(), 'epub', name);
    metas.push({ name, xml });
    units.push(...us.map(u => ({ ...u, container: name })));
  }
  return { units, meta: { zip, metas } };
}

function rebuildEpub(meta, units, mode) {
  const byContainer = new Map();
  for (const m of meta.metas) byContainer.set(m.name, { xml: m.xml, dom: new DOMParser().parseFromString(m.xml, 'text/html') });
  const changed = new Set();
  for (const u of units) {
    const c = byContainer.get(u.container);
    if (!c) continue;
    const nodes = [];
    const walker = c.dom.createTreeWalker(c.dom.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
        return isTranslateableDoc(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const node = nodes[u.seq];
    if (node) node.nodeValue = unitText(u, mode);
    changed.add(u.container);
  }
  const newXmls = {};
  for (const name of changed) {
    newXmls[name] = new XMLSerializer().serializeToString(byContainer.get(name).dom);
  }
  return { zipEntries: newXmls };
}

/* ---------------- 统一入口 ---------------- */

export async function extractDoc(file, fileName) {
  const type = detectDocType(fileName);
  switch (type) {
    case 'plain': return extractPlain(file, fileName);
    case 'html': return extractHtmlFile(file, fileName);
    case 'docx': return extractDocx(file, fileName);
    case 'epub': return extractEpub(file, fileName);
    default: throw new Error('不支持的文档格式：' + fileName);
  }
}

/** 写回：返回 { blob?, text? } 或 { zipEntries } 由调用方打包 */
export async function rebuildDoc(file, fileName, units, mode) {
  const type = detectDocType(fileName);
  switch (type) {
    case 'plain': {
      const { text } = await readText(file);
      return rebuildPlain({ text }, units, mode);
    }
    case 'html': {
      const { text } = await readText(file);
      return rebuildHtmlDom({ text }, units, mode);
    }
    case 'docx': {
      const zip = await loadZip(file);
      const xml = await zip.file('word/document.xml').async('string');
      const rebuilt = rebuildDocx({ xml }, units, mode);
      zip.file('word/document.xml', rebuilt.text);
      const blob = await zip.generateAsync({ type: 'blob' });
      return { blob };
    }
    case 'epub': {
      const zip = await loadZip(file);
      const htmlEntries = Object.keys(zip.files).filter(n => EPUB_HTML_RE.test(n));
      const metas = [];
      for (const name of htmlEntries) {
        const xml = await zip.file(name).async('string');
        metas.push({ name, xml });
      }
      const rebuilt = rebuildEpub({ metas }, units, mode);
      for (const [name, xml] of Object.entries(rebuilt.zipEntries)) {
        zip.file(name, xml);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      return { blob };
    }
    default: throw new Error('不支持的文档格式：' + fileName);
  }
}

/** 文档查看：每单元一行（原文 / 对照 / 译文） */
export function docText(units, mode) {
  return units.slice().sort((a, b) => a.seq - b.seq).map(u => unitText(u, mode)).join('\n');
}
