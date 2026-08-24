// imgWorkbench.js — 图片翻译工作台：OCR 识别 → 翻译 → 三态标注视图 → 导出
import { $, $$, extOf, downloadBlob, pickSaveFile, writeSaveHandle } from '../../utils.js';
import { store } from '../../store.js';
import { translateUnits } from '../game/translator.js';

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp']);

const state = {
  file: null,          // File
  name: '',
  base: '',
  width: 0,
  height: 0,
  boxes: [],           // [{box:[x1,y1,x2,y2], text, score, translated, error}]
  view: 'original',
  img: null,           // HTMLImageElement
};

function imgShowStage(name) {
  $$('#ws-image .ut-stage').forEach(s => { s.hidden = s.id !== 'img-stage-' + name; });
}

function imgReset() {
  state.file = null;
  state.boxes = [];
  state.img = null;
  state.width = state.height = 0;
  const c = $('#imgCanvas');
  c.width = c.height = 0;
  $('#imgProgressWrap').hidden = true;
  $('#imgMeta').textContent = '';
  imgShowStage('import');
}

async function imgOcr(file) {
  const res = await fetch('/api/img/ocr', {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!data || !data.ok) throw new Error((data && data.error) || '图片识别失败');
  state.width = data.width;
  state.height = data.height;
  state.boxes = (data.boxes || []).map(b => ({
    box: b.box, text: b.text, score: b.score, translated: '', error: '',
  }));
  return data;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { state.img = img; resolve(); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法加载图片')); };
    img.src = url;
  });
}

/* ---------------- Canvas 标注渲染 ---------------- */

/** 按当前视图取一个框要显示的行；按框宽折行，超出行数截断 */
function boxLines(b, view, maxLines, boxW) {
  const wrap = (t, ctx, maxW) => {
    const out = [];
    let cur = '';
    for (const ch of String(t || '')) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const ctx = $('#imgCanvas').getContext('2d');
  ctx.font = '14px "Microsoft YaHei", sans-serif';
  const maxW = Math.max(40, boxW - 8);
  let lines = [];
  if (view === 'original') lines = wrap(b.text, ctx, maxW);
  else if (view === 'translated') lines = wrap(b.translated || b.text, ctx, maxW);
  else lines = [...wrap(b.text, ctx, maxW), ...wrap('｜ ' + (b.translated || '…'), ctx, maxW)];
  // 行数上限 + 截断省略号
  const capped = [];
  for (let i = 0; i < lines.length && capped.length < maxLines; i++) {
    let l = lines[i];
    if (ctx.measureText(l).width > maxW) {
      while (ctx.measureText(l + '…').width > maxW && l.length > 1) l = l.slice(0, -1);
      l += '…';
    }
    capped.push(l);
  }
  return capped;
}

function imgRender() {
  const canvas = $('#imgCanvas');
  if (!state.img || !canvas) return;
  canvas.width = state.width;
  canvas.height = state.height;
  canvas.style.aspectRatio = state.width + ' / ' + state.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.drawImage(state.img, 0, 0);
  if (!state.boxes.length) return;
  for (const b of state.boxes) {
    const [x1, y1, x2, y2] = b.box;
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 2 || h < 2) continue;
    // 白底半透明衬托（深浅背景都可读）
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillRect(x1, y1, w, h);
    ctx.strokeStyle = 'rgba(66,133,244,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, w, h);
    // 文字按框宽重折行
    const maxLines = state.view === 'bilingual' ? 4 : 2;
    const lines = boxLines(b, state.view, maxLines, w);
    // 字号自适应：先按行数估字号，再按最长行宽收缩
    let fs = Math.max(9, Math.round((h - 6) / (lines.length + 0.6)));
    ctx.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
    while (fs > 8) {
      const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
      if (maxW <= w - 8) break;
      fs -= 1;
      ctx.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
    }
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const lineH = fs * 1.2;
    let y = y1 + (h - lineH * lines.length) / 2 + lineH / 2;
    for (const line of lines) {
      ctx.fillText(line, x1 + 4, y);
      y += lineH;
    }
  }
}

/* ---------------- 翻译 ---------------- */

async function imgTranslate() {
  if (!state.boxes.length) return;
  const todo = state.boxes.filter(b => !b.translated && !b.error);
  if (!todo.length) return;
  const units = todo.map((b, i) => ({ id: i, original: b.text, translated: '', error: '' }));
  const stopRef = { stopped: false };
  const wrap = $('#imgProgressWrap');
  const bar = $('#imgProgressBar');
  const text = $('#imgProgressText');
  const stopBtn = $('#imgStopBtn');
  wrap.hidden = false;
  stopBtn.hidden = false;
  stopBtn.onclick = () => { stopRef.stopped = true; };
  const track = () => Math.max(0, wrap.clientWidth - 48);
  bar.style.width = '0px';
  text.textContent = `0 / ${todo.length}（0%）`;
  try {
    await translateUnits(units, store.state.settings, (d, t, f) => {
      const p = t ? Math.round(d / t * 100) : 100;
      bar.style.width = Math.round(track() * p / 100) + 'px';
      text.textContent = `${d} / ${t}${f ? ` · 失败 ${f}` : ''}（${p}%）`;
    }, stopRef);
    units.forEach((u, i) => {
      todo[i].translated = u.translated;
      todo[i].error = u.error;
    });
  } catch (e) {
    alert('翻译中止：' + e.message);
  } finally {
    stopBtn.hidden = true;
    imgRender();
  }
}

/* ---------------- 导出 ---------------- */

async function exportText(md) {
  // 点击瞬间先弹保存框（showSaveFilePicker 需用户激活窗口）
  const fname = `${state.base}_文字.${md ? 'md' : 'txt'}`;
  const pick = await pickSaveFile(fname);
  if (pick.cancelled) return;
  const rows = state.boxes
    .filter(b => b.text && !/^[\s\d.,%+\-*/=<>:;|!?()[\]{}'"`~^#$@&]*$/.test(b.text))
    .map(b => {
      const t = b.translated || b.text;
      if (state.view === 'original') return b.text;
      if (state.view === 'translated') return t;
      return md ? `- **原文**：${b.text}\n- **译文**：${t}` : `${b.text}\n${t}`;
    });
  const head = md ? `# 图片文字识别与翻译（${state.name}）\n\n` : `图片文字识别与翻译（${state.name}）\n${'='.repeat(20)}\n`;
  const body = md ? rows.join('\n\n') : rows.join('\n\n');
  const blob = new Blob([head + body + '\n'], { type: md ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
  if (pick.ok) await writeSaveHandle(pick.handle, blob);
  else downloadBlob(blob, fname);
}

async function exportImage() {
  const canvas = $('#imgCanvas');
  if (!canvas.width) return;
  const suffix = state.view === 'original' ? '原文标注' : state.view === 'translated' ? '译文标注' : '对照标注';
  const fname = `${state.base}_${suffix}.png`;
  const pick = await pickSaveFile(fname);
  if (pick.cancelled) return;
  canvas.toBlob(async blob => {
    if (!blob) return;
    if (pick.ok) await writeSaveHandle(pick.handle, blob);
    else downloadBlob(blob, fname);
  }, 'image/png');
}

/* ---------------- 工作流 ---------------- */

async function imgSelectFile(file) {
  if (!file) return;
  const ext = extOf(file.name);
  if (!IMG_EXT.has(ext)) {
    alert('不支持的图片格式（支持 png / jpg / webp / bmp）：' + file.name);
    return;
  }
  state.file = file;
  state.name = file.name;
  const dot = file.name.lastIndexOf('.');
  state.base = dot > 0 ? file.name.slice(0, dot) : file.name;
  try {
    $('#imgMeta').textContent = '正在识别图中文字…';
    imgShowStage('view');
    const data = await imgOcr(file);
    await loadImage(file);
    $('#imgMeta').textContent =
      `${file.name} · ${data.width}×${data.height} · 识别 ${data.count} 处文字`;
    imgRender();
    if (data.count > 0) await imgTranslate();
    else $('#imgMeta').textContent += '（未识别到文字）';
  } catch (e) {
    alert('识别失败：' + e.message);
    imgReset();
  }
}

export function initImgWorkbench() {
  const dropzone = $('#imgDropzone');
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'file';
  hiddenInput.accept = '.png,.jpg,.jpeg,.webp,.bmp';
  hiddenInput.multiple = false;
  hiddenInput.addEventListener('change', () => {
    if (hiddenInput.files && hiddenInput.files[0]) imgSelectFile(hiddenInput.files[0]);
    hiddenInput.value = '';
  });

  dropzone.addEventListener('click', () => hiddenInput.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hiddenInput.click(); } });
  ['dragover', 'dragenter'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('is-dragover'); }));
  dropzone.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) imgSelectFile(f);
  });

  $('#imgBackBtn').addEventListener('click', imgReset);

  $('#imgViewSwitch').addEventListener('click', e => {
    const b = e.target.closest('.ut-seg__item');
    if (!b) return;
    state.view = b.dataset.view;
    $$('#imgViewSwitch .ut-seg__item').forEach(x => x.classList.toggle('is-active', x === b));
    imgRender();
  });

  $('#imgExportTxt').addEventListener('click', () => exportText(false));
  $('#imgExportMd').addEventListener('click', () => exportText(true));
  $('#imgExportImg').addEventListener('click', exportImage);
}