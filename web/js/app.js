// app.js — 入口：路由 + 游戏翻译全流程编排

import { $, $$, debounce, extOf, fmtBytes, escapeHtml, downloadBlob, saveBlobDialog, pickSaveFile, writeSaveHandle } from './utils.js';
import { store } from './store.js';
import { parseExe } from './features/game/exeParser.js';
import { pickGameFolder, scanFolder } from './features/game/dirScanner.js';
import { extractFile, TEXT_EXT } from './features/game/extractors.js';
import { readText } from './features/game/encoding.js';
import { translateUnits, clearCache } from './features/game/translator.js';
import { renderFileList, renderFileTree, renderFileContent, showProgress, hideProgress } from './features/game/bilingView.js';
import { exportZip, exportXp3 } from './features/game/exporter.js';
import { detectDocType, extractDoc, rebuildDoc, docText, exportPdfDoc, DOC_EXT } from './features/doc/docParser.js';
import { initImgWorkbench } from './features/img/imgWorkbench.js';

/* ---------------- 基础 ---------------- */

store.load();

// 图片翻译工作台
initImgWorkbench();

// 诊断钩子：页面内显示运行时错误（排查用）
window.__ut = { store, errs: [] };
function showDiag() {
  let el = document.getElementById('diagBar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'diagBar';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7a1f1f;color:#ffd9d9;padding:6px 14px;font:12px/1.5 monospace;white-space:pre-wrap;word-break:break-all;';
    document.body.prepend(el);
  }
  el.textContent = '⚠ 运行时错误: ' + window.__ut.errs.join(' | ');
}
window.addEventListener('error', e => { window.__ut.errs.push(e.message); showDiag(); });
window.addEventListener('unhandledrejection', e => { window.__ut.errs.push('REJ: ' + ((e.reason && e.reason.message) || e.reason)); showDiag(); });

// 状态诊断日志（F12 控制台可见）
function diagLog(tag) {
  console.log(`[诊断:${tag}] stage=${store.state.stage} units=${store.state.units.length}`
    + ` view=${store.state.view} filter=${store.state.filter} search=${JSON.stringify(store.state.search || '')}`
    + ` cards=${document.querySelectorAll('.ut-unit').length} errs=${window.__ut.errs.length}`);
}

function showWorkspace(name) {
  $$('.ut-workspace').forEach(ws => { ws.hidden = ws.id !== 'ws-' + name; });
  $$('.ut-nav__item').forEach(b => b.classList.toggle('is-active', b.dataset.ws === name));
  // 切换工作台时刷新引擎状态（保证各拖拽框状态行均有内容且占位一致）
  if (typeof refreshEngineStatus === 'function') refreshEngineStatus();
}

function showStage(name) {
  // 只操作游戏工作台内的 stage，避免误伤文档/图片工作台的同名 class
  $$('#ws-game .ut-stage').forEach(s => { s.hidden = s.id !== 'stage-' + name; });
  store.set('stage', name);
}

function setView(view) {
  document.body.dataset.view = view;
  $$('#viewSwitch .ut-seg__item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  store.set('view', view);
  // 已有内容时立即按新视图刷新当前文件
  if (store.state.units.length && !store.state.extracting && !store.state.translating) {
    renderFileContent(store.state.files, store.state.units);
  }
}

/* ---------------- 导航 ---------------- */

$('#mainNav').addEventListener('click', e => {
  const btn = e.target.closest('.ut-nav__item');
  if (btn) showWorkspace(btn.dataset.ws);
});

/* ---------------- 翻译引擎状态显示 ---------------- */

const ENGINE_INFO = {
  mymemory: { name: 'MyMemory', desc: '免费引擎，无需配置，注意每日额度', need: null },
  baidu: { name: '百度翻译', hint: '需填写 APP ID 与密钥', need: () => !!(store.state.settings.baiduAppid && store.state.settings.apiKey) },
  deepl: { name: 'DeepL', hint: '需填写 API Key', need: () => !!store.state.settings.apiKey },
  openai: { name: 'OpenAI 兼容接口', hint: '需填写接口地址与模型名', need: () => !!(store.state.settings.baseUrl && store.state.settings.model) },
};

function refreshEngineStatus() {
  const s = store.state.settings;
  const info = ENGINE_INFO[s.provider] || ENGINE_INFO.mymemory;
  const configured = info.need ? info.need() : true;
  const es = $('#engineStatus');
  const des = $('#docEngineStatus');
  const ies = $('#imgEngineStatus');
  const text = `翻译引擎：${info.name}${configured ? ' · 已配置 ✓' : ' · 待配置（右上角 ⚙ 设置）'}`;
  const color = configured ? 'var(--ok)' : 'var(--warn)';
  if (es) { es.textContent = text; es.style.color = color; }
  if (des) { des.textContent = text; des.style.color = color; }
  if (ies) { ies.textContent = text; ies.style.color = color; }
  const ps = $('#providerStatus');
  if (ps) {
    ps.textContent = info.need
      ? (configured ? '已配置 ✓，可正常翻译' : '未配置：' + info.hint)
      : info.desc;
    ps.className = 'ut-field__status' + (info.need ? (configured ? ' is-ok' : ' is-warn') : '');
  }
}

/* ---------------- 游戏：拖入文件夹 或 点击选择（一步到位） ---------------- */

const gameDropzone = $('#gameDropzone');

gameDropzone.addEventListener('click', () => pickAndScan());
gameDropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') pickAndScan();
});
['dragenter', 'dragover'].forEach(ev => gameDropzone.addEventListener(ev, e => {
  e.preventDefault();
  gameDropzone.classList.add('is-dragover');
}));
['dragleave', 'drop'].forEach(ev => gameDropzone.addEventListener(ev, e => {
  e.preventDefault();
  gameDropzone.classList.remove('is-dragover');
}));
gameDropzone.addEventListener('drop', e => {
  const flist = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
  if (!flist.length || !flist[0].webkitRelativePath) {
    alert('请拖入整个文件夹（不是单个文件）');
    return;
  }
  handleFolderDrop(flist);
});

/** 点击选择：浏览器目录授权（可写回） */
async function pickAndScan() {
  gameDropzone.classList.add('is-busy');
  try {
    const handle = await pickGameFolder();
    store.set('rootHandle', handle);
    const maxBytes = (store.state.settings.maxSizeMB || 8) * 1024 * 1024;
    const { files, exes, xp3s } = await scanFolder(handle, maxBytes);
    await handleScanResult(files, exes, xp3s);
  } catch (e) {
    if (e.name !== 'AbortError') alert('扫描失败：' + e.message);
  } finally {
    gameDropzone.classList.remove('is-busy');
  }
}

/** 拖入文件夹：直接用拖入的文件列表（无目录句柄，读取与导出不受影响） */
async function handleFolderDrop(flist) {
  gameDropzone.classList.add('is-busy');
  try {
    const maxBytes = (store.state.settings.maxSizeMB || 8) * 1024 * 1024;
    const files = [];
    const exes = [];
    const xp3s = [];
    for (const f of flist) {
      const ext = extOf(f.name);
      const path = f.webkitRelativePath || f.name;
      if (ext === 'exe') {
        exes.push({ name: f.name, path, size: f.size, file: f });
        continue;
      }
      if (ext === 'xp3') {
        xp3s.push({ name: f.name, path, size: f.size, file: f });
        continue;
      }
      if (!TEXT_EXT.has(ext)) continue;
      files.push({ name: f.name, path, ext, size: f.size, file: f, skipped: f.size > maxBytes, unitCount: 0 });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    await handleScanResult(files, exes, xp3s);
  } catch (e) {
    alert('处理失败：' + e.message);
  } finally {
    gameDropzone.classList.remove('is-busy');
  }
}

/** 扫描结果统一处理：游戏信息 + 文件列表 + 资源包提示 + 进入扫描阶段 */
async function handleScanResult(files, exes, xp3s) {
  if (!files.length && !(xp3s && xp3s.length)) {
    alert('没有发现可翻译的文本文件（支持的格式：txt/json/ini/cfg/srt/ass/rpy/ks/yaml 等）');
    return;
  }
  store.set('files', files);
  store.set('selected', new Set(files.filter(f => !f.skipped).map(f => f.path)));
  store.set('xp3s', xp3s || []);
  // 资源包提示条（吉里吉里 xp3 可解包）
  const xp3sList = xp3s || [];
  if (xp3sList.length) {
    $('#xp3BarText').textContent = '发现资源包：' + xp3sList.map(x => `${x.name}（${fmtMB(x.size)}）`).join('、') + '，文本可能打包在资源包内';
  }
  // 自动找 exe 解析游戏信息（尽力而为，找不到不影响翻译）
  const game = await resolveGame(exes);
  store.set('game', game);
  const card = $('#gameCard');
  if (game) {
    card.hidden = false;
    $('#gameName').textContent = game.product || game.name;
    $('#gameMeta').textContent = [game.company, game.version, game.description].filter(Boolean).join(' · ') || '未读取到版本信息';
    const badge = $('#gameEngineBadge');
    badge.textContent = game.engine || '引擎未知';
    badge.classList.toggle('ut-badge--accent', !!game.engine);
  } else {
    card.hidden = true;
  }
  renderFileList(files);
  bindFileList();
  $('#xp3Bar').hidden = !xp3sList.length;
  $('#unpackXp3Btn').disabled = false;
  showStage('scan');
}

function fmtMB(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

/** 解包所有检测到的 xp3 资源包：把包内文本文件加入文件列表 */
async function unpackXp3s() {
  const btn = $('#unpackXp3Btn');
  btn.disabled = true;
  try {
    const xp3s = store.state.xp3s || [];
    const newFiles = [];
    for (const xp3 of xp3s) {
      const buf = await xp3.file.arrayBuffer();
      const resp = await fetch('/api/unpack', { method: 'POST', body: buf });
      const data = await resp.json();
      if (!data.ok) { alert('解包失败（' + xp3.name + '）：' + data.error); continue; }
      const tempId = data.tempId;
      for (const f of data.files) {
        const rel = String(f.name).replace(/\\/g, '/');
        const ext = rel.includes('.') ? rel.split('.').pop().toLowerCase() : '';
        if (!TEXT_EXT.has(ext)) continue; // 只取文本文件
        const fr = await fetch(`/api/unpack-file?tempId=${tempId}&rel=${encodeURIComponent(rel)}`);
        if (!fr.ok) continue;
        const bytes = new Uint8Array(await fr.arrayBuffer());
        newFiles.push({
          name: rel.split('/').pop(),
          path: '【xp3】' + rel,
          ext, size: bytes.length,
          file: new Blob([bytes]),
          skipped: false, unitCount: 0,
          xp3Rel: rel, tempId,
        });
      }
    }
    if (!newFiles.length) { alert('资源包内未发现可翻译的文本文件'); return; }
    const files = store.state.files.concat(newFiles);
    store.set('files', files);
    const sel = store.state.selected;
    newFiles.forEach(f => sel.add(f.path));
    renderFileList(files);
    bindFileList();
    $('#xp3BarText').textContent = '✅ 已解包 ' + xp3s.length + ' 个资源包，新增 ' + newFiles.length + ' 个文本文件（以【xp3】标记）';
  } catch (e) {
    alert('解包失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
}

/** 在扫描结果中找 exe 解析游戏信息；优先根目录、较大的 exe */
async function resolveGame(exes) {
  if (!exes || !exes.length) return null;
  const sorted = exes.slice().sort((a, b) => {
    const da = a.path.includes('/') ? 1 : 0;
    const db = b.path.includes('/') ? 1 : 0;
    return da - db || b.size - a.size;
  });
  for (const exe of sorted.slice(0, 3)) {
    try {
      return await parseExe(exe.file);
    } catch (e) { /* 解析失败尝试下一个 */ }
  }
  return null;
}

$('#resetGameBtn').addEventListener('click', () => {
  showStage('import');
  $('#gameCard').hidden = true;
  $('#xp3Bar').hidden = true;
  store.set('game', null);
  store.set('files', []);
  store.set('units', []);
});

function bindFileList() {
  const files = store.state.files;
  const update = () => {
    const sel = new Set();
    $$('#fileList input[type="checkbox"]:checked').forEach(i => sel.add(i.dataset.path));
    store.set('selected', sel);
    $('#startTranslateBtn').disabled = sel.size === 0;
  };
  $('#fileList').addEventListener('change', update);
  $('#checkAll').addEventListener('change', e => {
    $$('#fileList input[type="checkbox"]:not(:disabled)').forEach(i => { i.checked = e.target.checked; });
    update();
  });
  update(); // 立即同步按钮状态（修复：扫描后按钮应立即可用）
}

/* ---------------- 游戏：提取 + 翻译 ---------------- */

let stopRef = null;

/** 翻译未完成的单元；支持中途停止与继续 */
async function runTranslation() {
  const units = store.state.units;
  const todo = units.filter(u => !u.translated);
  const stopBtn = $('#stopBtn');
  if (!todo.length) {
    hideProgress();
    stopBtn.hidden = true;
    renderFileContent(store.state.files, units);
    return;
  }
  stopRef = { stopped: false };
  stopBtn.textContent = '停止';
  stopBtn.disabled = false;
  stopBtn.hidden = false;
  store.set('translating', true);
  showProgress(0, todo.length, 0);
  try {
    await translateUnits(todo, store.state.settings, (d, t, f) => showProgress(d, t, f), stopRef);
  } catch (e) {
    alert('翻译中止：' + e.message);
  } finally {
    store.set('translating', false);
    const remaining = units.filter(u => !u.translated).length;
    if (remaining > 0) {
      const doneCount = units.length - remaining;
      showProgress(doneCount, units.length, 0);
      $('#progressText').textContent = `已停止：完成 ${doneCount} / 共 ${units.length}，剩余 ${remaining} 条`;
      stopBtn.textContent = '继续翻译';
      stopBtn.disabled = false;
      stopBtn.hidden = false;
    } else {
      // 翻译完成：保留进度条显示完成状态（不隐藏）
      const failed = units.filter(u => u.error).length;
      const track = Math.max(0, $('#progressWrap').clientWidth - 48);
      $('#progressBar').style.width = track + 'px';
      $('#progressText').textContent = failed > 0
        ? `完成 ${units.length} / ${units.length} · 失败 ${failed}（100%）`
        : `完成 ${units.length} / ${units.length}（100%）`;
      stopBtn.hidden = true;
    }
    renderFileTree(store.state.files, units);
    renderFileContent(store.state.files, units);
    diagLog('翻译结束');
  }
}

$('#stopBtn').addEventListener('click', () => {
  if (store.state.translating) {
    // 停止当前翻译
    stopRef.stopped = true;
    $('#stopBtn').disabled = true;
    $('#progressText').textContent = '正在停止，等待当前请求完成…';
  } else {
    // 继续翻译剩余
    runTranslation();
  }
});

$('#unpackXp3Btn').addEventListener('click', unpackXp3s);

$('#startTranslateBtn').addEventListener('click', async () => {
  const files = store.state.files.filter(f => store.state.selected.has(f.path));
  if (!files.length) return;
  const btn = $('#startTranslateBtn');
  btn.disabled = true;

  // 提取
  store.set('extracting', true);
  showStage('browse');
  showProgress(0, files.length, 0);
  const units = [];
  let done = 0;
  for (const f of files) {
    try {
      const { text, encoding } = await readText(f.file);
      f.encoding = encoding;
      const us = extractFile(text, f.path, encoding);
      f.unitCount = us.length;
      units.push(...us);
    } catch (e) {
      console.warn('提取失败:', f.path, e);
    }
    done++;
    showProgress(done, files.length, 0);
  }
  store.set('units', units);
  hideProgress();
  store.set('activeFile', (store.state.files.find(f => !f.skipped) || {}).path);
  renderFileTree(store.state.files, units);
  renderFileContent(store.state.files, units);
  $('#exportBtn').disabled = units.length === 0;
  $('#exportXp3Btn').hidden = !store.state.files.some(f => f.xp3Rel);
  store.set('extracting', false);
  diagLog('提取完成');

  // 翻译
  if (!units.length) { btn.disabled = false; return; }
  await runTranslation();
  btn.disabled = false;
});

/* ---------------- 游戏：返回导入阶段 ---------------- */

$('#backToImportBtn').addEventListener('click', () => {
  showStage('import');
  $('#gameCard').hidden = true;
  $('#xp3Bar').hidden = true;
});

/* ---------------- 游戏：双语浏览 ---------------- */

// 文件树：点击切换当前查看的文件
$('#fileTree').addEventListener('click', e => {
  const node = e.target.closest('.ut-file-node');
  if (!node) return;
  store.set('activeFile', node.dataset.path);
  $$('#fileTree .ut-file-node').forEach(n => n.classList.toggle('is-active', n === node));
  renderFileContent(store.state.files, store.state.units);
});

$('#viewSwitch').addEventListener('click', e => {
  const b = e.target.closest('.ut-seg__item');
  if (b) setView(b.dataset.view);
});

/*（筛选与搜索已由文件内容视图取代，相关绑定已移除）*/

/* ---------------- 游戏：导出 ---------------- */

$('#exportBtn').addEventListener('click', async () => {
  const btn = $('#exportBtn');
  btn.disabled = true;
  try {
    const game = store.state.game;
    const name = (game ? game.product || game.name : 'translated') + '_' + store.state.view;
    const { warnings } = await exportZip(store.state.files, store.state.units, store.state.view, name + '.zip');
    if (warnings && warnings.length) {
      alert('导出完成，但有以下提示：\n\n' + warnings.join('\n'));
    }
  } catch (e) {
    alert('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#exportXp3Btn').addEventListener('click', async () => {
  const btn = $('#exportXp3Btn');
  btn.disabled = true;
  try {
    const game = store.state.game;
    const name = (game ? game.product || game.name : 'translated') + '_translated';
    const { warnings } = await exportXp3(store.state.files, store.state.units, store.state.view, name + '.xp3');
    if (warnings && warnings.length) {
      alert('封包完成，但有以下提示：\n\n' + warnings.join('\n'));
    }
  } catch (e) {
    alert('封包失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- 文档翻译 ---------------- */

const docState = { files: [], units: [], view: 'bilingual', activeFile: null };

function docShowStage(name) {
  $$('#ws-document .ut-stage').forEach(s => { s.hidden = s.id !== 'doc-stage-' + name; });
}

async function docAddFiles(flist) {
  const files = [];
  for (const f of flist) {
    if (!detectDocType(f.name)) continue;
    files.push({ name: f.name, file: f, size: f.size, type: detectDocType(f.name), unitCount: 0 });
  }
  if (!files.length) { alert('不支持的文档格式（支持 md / txt / html / docx / epub / xlsx / pptx / pdf）'); return; }
  docState.files = files;
  docState.units = [];
  docRenderList();
  docShowStage('scan');
}

function docRenderList() {
  $('#docScanTitle').textContent = `共 ${docState.files.length} 个文档`;
  $('#docFileList').innerHTML = docState.files.map(f => `
    <label class="ut-file-item">
      <input type="checkbox" data-path="${escapeHtml(f.name)}" checked>
      <span class="ut-file-item__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="ut-file-item__size">${fmtBytes(f.size)}</span>
    </label>`).join('') || '<p class="ut-muted">未添加文档</p>';
}

function docRenderTree() {
  const el = $('#docFileTree');
  el.innerHTML = docState.files.map(f => {
    const n = docState.units.filter(u => u.file === f.name).length;
    const done = docState.units.filter(u => u.file === f.name && u.translated).length;
    const active = f.name === docState.activeFile;
    return `<div class="ut-file-node${active ? ' is-active' : ''}" data-doc="${escapeHtml(f.name)}" title="${escapeHtml(f.name)}">
      <span class="ut-file-node__name">${escapeHtml(f.name)}</span>
      <span class="ut-file-node__count">${n}${done ? ` / ${done}✓` : ''}</span>
    </div>`;
  }).join('') || '<p class="ut-muted">无文档</p>';
}

function docRenderContent() {
  const el = $('#docContent');
  const f = docState.files.find(x => x.name === docState.activeFile);
  if (!f) {
    el.innerHTML = '<p class="ut-empty-small">选择左侧文档查看翻译结果</p>';
    return;
  }
  const us = docState.units.filter(u => u.file === f.name);
  el.innerHTML = `<pre class="ut-file-content">${escapeHtml(docText(us, docState.view))}</pre>`;
}

const docDz = $('#docDropzone');
docDz.addEventListener('dragover', e => { e.preventDefault(); docDz.classList.add('is-dragover'); });
docDz.addEventListener('dragleave', () => docDz.classList.remove('is-dragover'));
docDz.addEventListener('drop', async e => {
  e.preventDefault();
  docDz.classList.remove('is-dragover');
  if (e.dataTransfer && e.dataTransfer.files.length) await docAddFiles(Array.from(e.dataTransfer.files));
});
docDz.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.md,.txt,.html,.htm,.docx,.epub,.xlsx,.pptx,.pdf';
  input.onchange = async () => { if (input.files && input.files.length) await docAddFiles(Array.from(input.files)); };
  input.click();
});

$('#docBackBtn').addEventListener('click', () => { docState.files = []; docState.units = []; docShowStage('import'); });
$('#docViewBackBtn').addEventListener('click', () => docShowStage('scan'));

$('#docTranslateBtn').addEventListener('click', async () => {
  const btn = $('#docTranslateBtn');
  btn.disabled = true;
  try {
    if (!docState.files.length) return;
    docShowStage('view');
    $('#docProgressWrap').hidden = false;
    const units = [];
    for (let i = 0; i < docState.files.length; i++) {
      const f = docState.files[i];
      $('#docProgressText').textContent = `提取 ${i + 1}/${docState.files.length}：${f.name}`;
      const forceOcr = (($('#docPdfMode .ut-seg__item.is-active') || {}).dataset || {}).mode === 'ocr';
      const { units: us } = await extractDoc(f.file, f.name, msg => { $('#docProgressText').textContent = msg; }, forceOcr);
      f.unitCount = us.length;
      units.push(...us);
    }
    docState.units = units;
    docState.activeFile = (docState.files[0] || {}).name;
    docRenderTree();
    docRenderContent();
    docSyncExportUi();
    $('#docExportBtn').disabled = !units.length;
    if (units.length) await docTranslateUnits();
  } catch (e) {
    alert('处理失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

let docStopRef = null;

/** 翻译文档单元；支持停止/继续，进度与游戏翻译一致 */
async function docTranslateUnits() {
  const units = docState.units;
  const todo = units.filter(u => !u.translated);
  const stopBtn = $('#docStopBtn');
  const wrap = $('#docProgressWrap');
  if (!todo.length) { wrap.hidden = true; stopBtn.hidden = true; docRenderContent(); return; }
  docStopRef = { stopped: false };
  stopBtn.textContent = '停止';
  stopBtn.disabled = false;
  stopBtn.hidden = false;
  wrap.hidden = false;
  const docTrack = () => Math.max(0, wrap.clientWidth - 48);
  $('#docProgressBar').style.width = '0px';
  $('#docProgressText').textContent = `0 / ${todo.length}（0%）`;
  try {
    await translateUnits(todo, store.state.settings, (d, t, f) => {
      const p = t ? Math.round(d / t * 100) : 100;
      $('#docProgressBar').style.width = Math.round(docTrack() * p / 100) + 'px';
      $('#docProgressText').textContent = `${d} / ${t}${f ? ` · 失败 ${f}` : ''}（${p}%）`;
    }, docStopRef);
  } catch (e) {
    alert('翻译中止：' + e.message);
  } finally {
    const remaining = units.filter(u => !u.translated).length;
    if (remaining > 0) {
      const doneCount = units.length - remaining;
      $('#docProgressBar').style.width = Math.round(docTrack() * doneCount / units.length) + 'px';
      $('#docProgressText').textContent = `已停止：完成 ${doneCount} / 共 ${units.length}，剩余 ${remaining} 条`;
      stopBtn.textContent = '继续翻译';
      stopBtn.disabled = false;
      stopBtn.hidden = false;
    } else {
      // 翻译完成：保留进度条显示完成状态（不隐藏）
      const failed = units.filter(u => u.error).length;
      $('#docProgressBar').style.width = docTrack() + 'px';
      $('#docProgressText').textContent = failed > 0
        ? `完成 ${units.length} / ${units.length} · 失败 ${failed}（100%）`
        : `完成 ${units.length} / ${units.length}（100%）`;
      stopBtn.hidden = true;
    }
    docRenderContent();
    $('#docExportBtn').disabled = !units.some(u => u.translated);
  }
}

$('#docStopBtn').addEventListener('click', () => {
  if (docStopRef && !docStopRef.stopped) {
    docStopRef.stopped = true;
    $('#docStopBtn').disabled = true;
    $('#docProgressText').textContent = '正在停止，等待当前请求完成…';
  } else {
    docTranslateUnits();
  }
});

$('#docFileTree').addEventListener('click', e => {
  const node = e.target.closest('.ut-file-node');
  if (!node) return;
  docState.activeFile = node.dataset.doc;
  docRenderTree();
  docRenderContent();
});

$('#docViewSwitch').addEventListener('click', e => {
  const b = e.target.closest('.ut-seg__item');
  if (!b) return;
  docState.view = b.dataset.view;
  $$('#docViewSwitch .ut-seg__item').forEach(x => x.classList.toggle('is-active', x === b));
  docRenderContent();
});

function docPdfFiles() {
  return docState.files.filter(f => detectDocType(f.name) === 'pdf');
}

/** 当前 PDF 文件的类型集合（text / image / empty） */
function docPdfKinds() {
  const kinds = new Set();
  for (const f of docState.files) {
    if (detectDocType(f.name) !== 'pdf') continue;
    const us = docState.units.filter(u => u.file === f.name);
    kinds.add((us[0] && us[0].raw.pdfKind) || 'text');
  }
  return kinds;
}

/** 根据是否有 PDF 文件切换导出控件（普通导出 vs PDF 格式选择） */
function docSyncExportUi() {
  const hasPdf = docPdfFiles().length > 0;
  $('#docExportBtn').hidden = hasPdf;
  $('#docPdfFmt').hidden = !hasPdf;
  const hint = $('#docPdfOcrHint');
  if (hint) hint.hidden = true;
  if (!hasPdf) return;
  const kinds = docPdfKinds();
  const hasText = kinds.has('text');
  const hasImage = kinds.has('image');
  const hasOcr = kinds.has('ocr');
  const hasEmpty = kinds.has('empty');
  // 导出格式按类型集合控制：PDF 所有类型都可用（原位嵌入），TXT 仅扫描/强制 OCR 可用
  $$('#docPdfFmt [data-fmt]').forEach(btn => {
    const fmt = btn.dataset.fmt;
    btn.hidden = (fmt === 'txt' && !hasImage && !hasOcr);
  });
  if (hasImage && hint) {
    hint.hidden = false;
    hint.textContent = hasEmpty
      ? '含扫描版 / 空白 PDF：扫描版已按图片方式嵌入译文（PDF 导出），空白版无内容可导'
      : '含扫描版 PDF：已 OCR 提取文字，PDF 导出将按图片方式嵌入译文';
  } else if (hasEmpty && hint) {
    hint.hidden = false;
    hint.textContent = '含空白 PDF：未识别到文字，无内容可导出';
  }
}

$$('#docPdfFmt [data-fmt]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const fmt = btn.dataset.fmt;
    btn.disabled = true;
    try {
      const pdfs = docPdfFiles();
      if (!pdfs.length) return;
      // 单文件：点击瞬间先弹保存框拿句柄（showSaveFilePicker 需用户激活窗口内调用）
      const single = pdfs.length === 1 ? await pickSaveFile('translated.' + fmt) : null;
      for (const f of pdfs) {
        const us = docState.units.filter(u => u.file === f.name);
        const kind = (us[0] && us[0].raw.pdfKind) || 'text';
        // 格式与类型匹配过滤：PDF 仅空白文档跳过，TXT 仅扫描/强制 OCR
        if (fmt === 'pdf' && kind === 'empty') continue;
        if (fmt === 'txt' && kind !== 'image' && kind !== 'ocr') continue;
        if (!us.length) continue;
        const tempId = (us[0] && us[0].raw.tempId) || '';
        if (!tempId) continue;
        const { blob, filename } = await exportPdfDoc(tempId, us, fmt);
        if (single && single.ok) await writeSaveHandle(single.handle, blob);
        else if (single && !single.cancelled) downloadBlob(blob, filename);   // pick 不可用：回退下载
        else if (single && single.cancelled) continue;                       // 用户取消
        else downloadBlob(blob, filename);                                   // 多文件：直接下载
      }
    } catch (e) {
      alert('PDF 导出失败：' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
});

// PDF 提取方式切换（文字层 / 图片 OCR）
$('#docPdfMode').addEventListener('click', e => {
  const b = e.target.closest('.ut-seg__item');
  if (!b) return;
  $$('#docPdfMode .ut-seg__item').forEach(x => x.classList.toggle('is-active', x === b));
});

$('#docExportBtn').addEventListener('click', async () => {
  const btn = $('#docExportBtn');
  btn.disabled = true;
  try {
    // 单文件：点击瞬间先弹保存框拿句柄
    const files = docState.files;
    const single = files.length === 1 ? await pickSaveFile('translated' + (files[0] ? files[0].name.slice(files[0].name.lastIndexOf('.')) : '.txt')) : null;
    let exported = 0;
    for (const f of docState.files) {
      if (detectDocType(f.name) === 'pdf') continue; // PDF 走 docPdfFmt 格式按钮
      const us = docState.units.filter(u => u.file === f.name);
      if (!us.length) continue;
      const rebuilt = await rebuildDoc(f.file, f.name, us, docState.view);
      let blob = rebuilt.blob;
      if (!blob && rebuilt.text) blob = new Blob([rebuilt.text], { type: 'text/plain;charset=utf-8' });
      if (!blob) continue;
      const dot = f.name.lastIndexOf('.');
      const base = dot > 0 ? f.name.slice(0, dot) : f.name;
      const outName = base + '_译文' + f.name.slice(dot);
      if (single && single.ok) await writeSaveHandle(single.handle, blob);
      else if (single && !single.cancelled) downloadBlob(blob, outName);
      else if (single && single.cancelled) continue;
      else downloadBlob(blob, outName);
      exported++;
    }
    if (!exported) alert('没有可导出的内容');
  } catch (e) {
    alert('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#clearCacheBtn').addEventListener('click', async () => {
  const btn = $('#clearCacheBtn');
  btn.disabled = true;
  const ok = await clearCache();
  btn.disabled = false;
  const st = $('#cacheStatus');
  st.textContent = ok ? '✓ 已清除' : '清除失败';
  st.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  setTimeout(() => { st.textContent = ''; }, 2500);
});

/* ---------------- 设置抽屉 ---------------- */

const drawer = $('#settingsDrawer');
const backdrop = $('#settingsBackdrop');

function openSettings() {
  const s = store.state.settings;
  $('#providerSelect').value = s.provider;
  $('#baiduAppidInput').value = s.baiduAppid || '';
  $('#apiKeyInput').value = s.apiKey || '';
  $('#baseUrlInput').value = s.baseUrl || '';
  $('#modelInput').value = s.model || '';
  $('#targetLang').value = s.targetLang;
  $('#concurrencyInput').value = s.concurrency;
  $('#maxSizeInput').value = s.maxSizeMB;
  syncProviderFields(s.provider);
  refreshEngineStatus();
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => $('#apiKeyInput').focus());
}
function closeSettings() {
  drawer.hidden = true;
  backdrop.hidden = true;
}
function syncProviderFields(provider) {
  $('#appidField').hidden = provider !== 'baidu';
  $('#apiKeyField').hidden = !(provider === 'baidu' || provider === 'deepl' || provider === 'openai');
  $('#baseUrlField').hidden = provider !== 'openai';
  $('#modelField').hidden = provider !== 'openai';
}

$('#openSettings').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
backdrop.addEventListener('click', closeSettings);

/* ---------------- 主题切换 ---------------- */

function applyThemeIcon() {
  const b = $('#themeToggle');
  if (!b) return;
  const light = store.state.theme === 'light';
  // 图标由 CSS 驱动：body[data-theme] 控制 .ico-sun/.ico-moon 显隐
  b.title = light ? '切换到深色主题' : '切换到浅色主题';
}

$('#themeToggle').addEventListener('click', () => {
  store.set('theme', store.state.theme === 'light' ? 'dark' : 'light');
  applyThemeIcon();
});
applyThemeIcon();

/* ---------------- 翻译浏览：返回上一级 ---------------- */

$('#backBtn').addEventListener('click', () => {
  // 返回扫描阶段，翻译结果保留在状态里，重新提取会走翻译缓存（IndexedDB）
  showStage('scan');
  renderFileList(store.state.files);
  bindFileList();
});
$('#providerSelect').addEventListener('change', e => {
  syncProviderFields(e.target.value);
  refreshEngineStatus();
});

drawer.addEventListener('change', e => {
  const id = e.target.id;
  const s = store.state.settings;
  if (id === 'providerSelect') s.provider = e.target.value;
  if (id === 'targetLang') s.targetLang = e.target.value;
  if (id === 'concurrencyInput') s.concurrency = Math.max(1, Math.min(10, +e.target.value || 3));
  if (id === 'maxSizeInput') s.maxSizeMB = Math.max(1, Math.min(200, +e.target.value || 8));
  store.patchSettings(s);
  refreshEngineStatus();
});
drawer.addEventListener('input', e => {
  const id = e.target.id;
  const s = store.state.settings;
  if (id === 'apiKeyInput') s.apiKey = e.target.value.trim();
  if (id === 'baiduAppidInput') s.baiduAppid = e.target.value.trim();
  if (id === 'baseUrlInput') s.baseUrl = e.target.value.trim();
  if (id === 'modelInput') s.model = e.target.value.trim();
  store.patchSettings(s);
  refreshEngineStatus();
});

/* ---------------- 主题 ---------------- */

function toggleTheme() {
  const next = store.state.theme === 'dark' ? 'light' : 'dark';
  store.state.theme = next;
  document.body.dataset.theme = next;
  try { localStorage.setItem('ut.theme', next); } catch (e) { /* ignore */ }
}

document.addEventListener('keydown', e => {
  // 快捷键：T 切换主题
  if (e.altKey && e.key.toLowerCase() === 't') toggleTheme();
});

// 初始化
showWorkspace('document');
showStage('import');
setView('bilingual');
refreshEngineStatus();
console.log('[万能翻译站] 就绪');
