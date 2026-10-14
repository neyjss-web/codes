import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  uid, normRect, groupNM, rebuildGroups, parsePageRanges, formatPageRanges, rgbToHex, hexToRgb, rgbCss,
  TYPE_LABELS, defaultColor,
} from './model.js';
import { exportFDF, importFDF } from './fdf.js';
import { loadPdfLib, readAnnotations, stripAnnotations, writeAnnotations, getTrailerId } from './pdfannots.js';
import { quadsBBox } from './annotdict.js';

// ============================================================================
// Configuração do pdf.js (worker e dados binários embutidos no HTML)
// ============================================================================

const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let ASSETS = {};
try { ASSETS = JSON.parse(document.getElementById('pdfjs-assets')?.textContent || '{}'); } catch { ASSETS = {}; }

if (ASSETS.worker) {
  const url = URL.createObjectURL(new Blob([b64ToBytes(ASSETS.worker)], { type: 'text/javascript' }));
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url);
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
}

class EmbeddedDataFactory {
  constructor() {}
  async fetch({ kind, filename }) {
    const d = ASSETS.files?.[`${kind}/${filename}`];
    if (!d) throw new Error(`Recurso não embutido: ${kind}/${filename}`);
    return b64ToBytes(d);
  }
}

const DOC_OPTIONS = {
  BinaryDataFactory: EmbeddedDataFactory,
  useWorkerFetch: false,
  standardFontDataUrl: 'embedded/',
  wasmUrl: 'embedded/',
  isEvalSupported: false,
  enableXfa: false,
};

// ============================================================================
// Estado
// ============================================================================

const ZOOMS = [60, 80, 100, 120, 145, 170, 200, 240, 290, 350, 420, 500, 600, 720, 860, 1000, 1200, 1400];
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

const S = {
  fileName: '',
  bytes: null, // bytes originais do PDF
  pdf: null,
  n: 0,
  vps: [], // viewports em escala 1 (com rotação)
  annots: [],
  groups: [],
  sel: new Set(),
  lastClicked: null,
  zoomIdx: 6,
  dirty: false,
  canWrite: false,
  trailerId: null,
  gen: 0,
  text: new Map(),
  links: new Map(),
  matches: new Set(),
  outline: [],
  olFlat: [],
  occ: [],
  occIdx: -1,
  searchTerm: '',
  undo: [],
  redo: [],
  hoverZoom: true,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const viewer = $('#viewer');
const grid = $('#grid');

const settings = (() => {
  let data = {};
  try { data = JSON.parse(localStorage.getItem('pdfnotas-settings') || '{}'); } catch { data = {}; }
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; try { localStorage.setItem('pdfnotas-settings', JSON.stringify(data)); } catch { /* sem armazenamento */ } },
  };
})();

S.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, settings.get('zoomIdx', 6)));
S.hoverZoom = settings.get('hoverZoom', true);
$('#hover-zoom').checked = S.hoverZoom;
$('#author').value = settings.get('author', '');
if (settings.get('sideHidden', false)) $('#side').classList.add('hidden');

const author = () => $('#author').value.trim();

// ============================================================================
// Utilidades de interface
// ============================================================================

function toast(msg, err = false, ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? Math.max(ms, 7000) : ms);
}

function progress(frac, text) {
  const p = $('#progress');
  if (frac == null) { p.hidden = true; return; }
  const box = $('#loading');
  // Com a caixa de carregamento aberta, o progresso aparece só nela
  p.hidden = !box.hidden;
  $('.bar', p).style.width = `${Math.round(frac * 100)}%`;
  $('span', p).textContent = text || '';
  if (!box.hidden) {
    $('.ld-step', box).textContent = text || '';
    $('.ld-bar div', box).style.width = `${Math.round(frac * 100)}%`;
  }
}

// Caixa central "Carregando arquivo PDF…"
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// Caixa central "Carregando arquivo PDF…" / "Salvando arquivo PDF…"
function loadingBox(file, title = 'Carregando arquivo PDF…') {
  const box = $('#loading');
  if (!file) { box.hidden = true; return; }
  $('.ld-title', box).textContent = title;
  $('.ld-name', box).textContent = file.size != null ? `${file.name} (${fmtSize(file.size)})` : file.name;
  $('.ld-step', box).textContent = '';
  $('.ld-bar div', box).style.width = '0';
  box.hidden = false;
}

// Dá ao navegador a chance de desenhar a tela antes de um trabalho pesado
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function choose(message, buttons) {
  const dlg = $('#choice-dialog');
  $('#choice-msg').textContent = message;
  const acts = $('#choice-actions');
  acts.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.primary ? ' primary' : '');
    btn.value = b.value;
    btn.textContent = b.label;
    acts.append(btn);
  }
  dlg.returnValue = '';
  return new Promise((res) => {
    dlg.addEventListener('close', () => res(dlg.returnValue || null), { once: true });
    dlg.showModal();
  });
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normNoSpace = (s) => norm(s).replace(/\s+/g, '');
const fmtDate = (d) => (d instanceof Date && !isNaN(d) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const textOn = (c) => {
  const [r, g, b] = c || [0, 0, 0];
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.62 ? '#111' : '#fff';
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setDirty(v = true) {
  S.dirty = v;
  document.title = (v ? '• ' : '') + (S.fileName ? `${S.fileName} — ` : '') + 'PDF Notas';
  // Destaca o botão de salvar da leitura contínua quando há alterações não salvas
  $('#ed-save')?.classList.toggle('primary', v);
}

// ---- Desfazer / refazer ----
function snapshot() {
  S.undo.push(structuredClone({ annots: S.annots, groups: S.groups }));
  if (S.undo.length > 80) S.undo.shift();
  S.redo.length = 0;
}
function restore(from, to) {
  if (!from.length) return;
  to.push(structuredClone({ annots: S.annots, groups: S.groups }));
  const st = from.pop();
  S.annots = st.annots;
  S.groups = st.groups;
  if (E.selId && !S.annots.some((a) => a.id === E.selId)) E.selId = null;
  setDirty(true);
  refreshAll();
}

// ============================================================================
// Abrir PDF
// ============================================================================

async function openPdf(file) {
  if (S.dirty) {
    const r = await choose('Há comentários não salvos. Abrir outro PDF mesmo assim?', [
      { label: 'Cancelar', value: 'no' }, { label: 'Abrir e descartar', value: 'yes', primary: true },
    ]);
    if (r !== 'yes') return;
  }
  const gen = ++S.gen;
  loadingBox(file);
  progress(0.05, 'Lendo arquivo…');
  await nextPaint();
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let annots = [], displayBytes = buf, canWrite = true, trailerId = null, warn = '';
    progress(0.15, 'Lendo comentários existentes…');
    await nextPaint();
    try {
      const doc = await loadPdfLib(buf.slice());
      annots = readAnnotations(doc);
      trailerId = getTrailerId(doc);
      if (annots.length) {
        // Remove os comentários da cópia exibida: eles passam a ser desenhados (e editados) pelo app.
        stripAnnotations(doc);
        displayBytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
      }
    } catch (e) {
      console.warn(e);
      canWrite = false;
      warn = 'Não foi possível ler a estrutura do PDF para gravar comentários (' + e.message + '). Use Exportar FDF para salvar os comentários.';
    }
    progress(0.35, 'Abrindo documento…');
    await nextPaint();
    const task = pdfjsLib.getDocument({ ...DOC_OPTIONS, data: displayBytes === buf ? buf.slice() : displayBytes });
    task.onPassword = (cb, reason) => {
      const pw = prompt(reason === 2 ? 'Senha incorreta. Digite a senha do PDF:' : 'Este PDF é protegido. Digite a senha:');
      if (pw == null) task.destroy(); else cb(pw);
    };
    const pdf = await task.promise;
    if (gen !== S.gen) return;
    if (E.open) closeEditor();
    hidePreview();
    pv.cache.clear();
    try { S.task?.destroy(); } catch { /* ignora */ }
    Object.assign(S, {
      fileName: file.name, bytes: buf, pdf, task, n: pdf.numPages, vps: [], annots: [], groups: [],
      sel: new Set(), lastClicked: null, canWrite, trailerId, text: new Map(), links: new Map(), matches: new Set(), occ: [], occIdx: -1, outline: [], olFlat: [], searchTerm: '',
      undo: [], redo: [],
    });
    if (!S.trailerId && pdf.fingerprints?.[0]) S.trailerId = [pdf.fingerprints[0].toUpperCase(), (pdf.fingerprints[1] || pdf.fingerprints[0]).toUpperCase()];
    for (let i = 1; i <= S.n; i++) {
      const page = await pdf.getPage(i);
      if (gen !== S.gen) return;
      S.vps.push(page.getViewport({ scale: 1 }));
      if (i % 25 === 0) { progress(0.35 + 0.6 * (i / S.n), `Preparando páginas… ${i}/${S.n}`); await nextPaint(); }
    }
    S.annots = annots.filter((a) => a.page < S.n);
    S.groups = rebuildGroups(S.annots, []);
    $('#search').value = '';
    $('#search-info').textContent = '';
    setDirty(false);
    S.zoomIdx = zoomIdxForPerRow(4);
    buildGrid();
    loadOutline();
    for (const b of ['#save-pdf', '#export-fdf', '#search']) $(b).disabled = false;
    $('#save-pdf').title = canWrite ? 'Salvar uma cópia do PDF com os comentários (Ctrl+S)' : 'Este PDF não permite gravação direta; use Exportar FDF';
    progress(null);
    loadingBox(null);
    const nA = S.annots.length;
    toast(`${S.fileName}: ${S.n} página(s)` + (nA ? `, ${nA} comentário(s) existente(s)` : ''));
    if (warn) toast(warn, true);
    viewer.focus();
  } catch (e) {
    console.error(e);
    progress(null);
    loadingBox(null);
    toast('Erro ao abrir o PDF: ' + e.message, true);
  }
}

// ============================================================================
// Grade contínua de páginas
// ============================================================================

const renderState = new Map(); // i -> { w, busy }
const visible = new Set();
let io = null;
let pumpScheduled = false;
let activeRenders = 0;

function pageEl(i) { return grid.children[i]; }

function buildGrid() {
  $('#empty').hidden = true;
  grid.innerHTML = '';
  renderState.clear();
  visible.clear();
  io?.disconnect();
  applyZoomVar();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < S.n; i++) {
    const vp = S.vps[i];
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.i = i;
    el.style.aspectRatio = `${vp.width} / ${vp.height}`;
    el.innerHTML = `<div class="tags"></div><span class="num">${i + 1}</span><span class="check"></span>`;
    frag.append(el);
  }
  grid.append(frag);
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = +e.target.dataset.i;
      if (e.isIntersecting) visible.add(i);
      else { visible.delete(i); releaseThumb(i); }
    }
    schedulePump();
  }, { root: viewer, rootMargin: '600px 0px' });
  for (const el of grid.children) io.observe(el);
  for (let i = 0; i < S.n; i++) refreshPage(i);
  updateSelectionUI();
  renderSide();
  viewer.scrollTop = 0;
}

// Maior tamanho de miniatura que ainda permite `n` páginas por linha
function zoomIdxForPerRow(n) {
  const avail = viewer.clientWidth - 28;
  const target = (avail + 12) / n - 12;
  let idx = 0;
  for (let k = 0; k < ZOOMS.length; k++) if (ZOOMS[k] <= target) idx = k;
  return idx;
}

function applyZoomVar() {
  const pw = ZOOMS[S.zoomIdx];
  grid.style.setProperty('--pw', pw + 'px');
  const avail = viewer.clientWidth - 28;
  const perRow = Math.max(1, Math.floor((avail + 12) / (pw + 12)));
  // Links clicáveis na grade apenas quando as páginas estão grandes o bastante para leitura
  grid.classList.toggle('links-on', pw >= 300);
  $('#zoom-label').textContent = S.n ? `${perRow} por linha` : `${pw}px`;
  $('#zoom-range').value = S.zoomIdx;
  $('#zoom-in').disabled = S.zoomIdx >= ZOOMS.length - 1;
  $('#zoom-out').disabled = S.zoomIdx <= 0;
}

function setZoom(idx) {
  idx = Math.max(0, Math.min(ZOOMS.length - 1, idx));
  if (idx === S.zoomIdx) return;
  // Mantém a página do topo ancorada durante o zoom
  const anchor = topPageIndex();
  const el = anchor != null ? pageEl(anchor) : null;
  const ratio = el ? (viewer.scrollTop - el.offsetTop) / el.offsetHeight : 0;
  S.zoomIdx = idx;
  settings.set('zoomIdx', idx);
  applyZoomVar();
  if (el) viewer.scrollTop = el.offsetTop + ratio * el.offsetHeight;
  hidePreview();
  schedulePump();
}

function topPageIndex() {
  if (!S.n) return null;
  const top = viewer.scrollTop;
  let lo = 0, hi = S.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const el = pageEl(mid);
    if (el.offsetTop + el.offsetHeight < top) lo = mid + 1; else hi = mid;
  }
  // Primeiro da linha
  const rowTop = pageEl(lo).offsetTop;
  while (lo > 0 && pageEl(lo - 1).offsetTop === rowTop) lo--;
  return lo;
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  requestAnimationFrame(pump);
}

function pump() {
  pumpScheduled = false;
  if (!S.pdf) return;
  const target = Math.round(ZOOMS[S.zoomIdx] * DPR());
  const vt = viewer.scrollTop, vb = vt + viewer.clientHeight;
  const list = [...visible].sort((a, b) => {
    // Prioriza páginas realmente na tela
    const ea = pageEl(a), eb = pageEl(b);
    const ina = ea.offsetTop < vb && ea.offsetTop + ea.offsetHeight > vt;
    const inb = eb.offsetTop < vb && eb.offsetTop + eb.offsetHeight > vt;
    return ina === inb ? a - b : ina ? -1 : 1;
  });
  for (const i of list) {
    if (activeRenders >= 3) return;
    const st = renderState.get(i);
    if (st?.busy) continue;
    if (st && Math.abs(st.w - target) / target < 0.2 && st.w >= target * 0.8) continue;
    activeRenders++;
    renderThumb(i, target).finally(() => { activeRenders--; schedulePump(); });
  }
}

async function renderThumb(i, targetW) {
  const gen = S.gen;
  const st = renderState.get(i) || {};
  st.busy = true;
  renderState.set(i, st);
  try {
    const page = await S.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: targetW / S.vps[i].width });
    const canvas = document.createElement('canvas');
    canvas.className = 'pg';
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvas, viewport: vp }).promise;
    if (gen !== S.gen) return;
    const el = pageEl(i);
    if (!visible.has(i) && renderState.get(i) !== st) return;
    const old = $('canvas.pg', el);
    if (old) old.replaceWith(canvas); else el.prepend(canvas);
    st.w = targetW;
    if (!el.dataset.links) {
      el.dataset.links = '1';
      getLinks(i).then((links) => {
        if (links.length && gen === S.gen && !$('.links', el)) el.insertBefore(buildLinkLayer(i, links), $('svg.ann', el) || $('.tags', el));
      });
    }
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('Falha ao renderizar página', i + 1, e);
  } finally {
    st.busy = false;
  }
}

function releaseThumb(i) {
  // Libera memória de páginas distantes quando há muitas renderizadas
  if (renderState.size < 120) return;
  const st = renderState.get(i);
  if (!st || st.busy) return;
  const c = $('canvas.pg', pageEl(i));
  if (c) { c.width = 0; c.height = 0; c.remove(); }
  renderState.delete(i);
}

// ---- Sobreposição de anotações (SVG em coordenadas da página, escala 1) ----

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function dispRect(vp, rect) {
  const a = vp.convertToViewportPoint(rect[0], rect[1]);
  const b = vp.convertToViewportPoint(rect[2], rect[3]);
  return normRect([a[0], a[1], b[0], b[1]]);
}

function annotsOfPage(i) {
  return S.annots.filter((a) => a.page === i);
}

/**
 * Constrói o SVG das anotações da página i.
 * opts: { numbers: bool, selectedId, interactive: bool }
 */
function buildAnnotSvg(i, opts = {}) {
  const vp = S.vps[i];
  const svg = svgEl('svg', { class: 'ann', viewBox: `0 0 ${vp.width} ${vp.height}`, preserveAspectRatio: 'none' });
  const list = annotsOfPage(i);
  // Molduras e realces primeiro (ficam por baixo)
  const order = { Highlight: 0, Square: 1, Circle: 1 };
  const sorted = [...list].sort((a, b) => (b.frame ? 1 : 0) - (a.frame ? 1 : 0) || (order[a.type] ?? 2) - (order[b.type] ?? 2));
  let num = 0;
  const numbered = [];
  for (const a of sorted) {
    const g = svgEl('g', { class: 'a-shape' + (a.frame ? ' frame-g' : ''), 'data-id': a.id }, svg);
    const col = rgbCss(a.color);
    const [x1, y1, x2, y2] = dispRect(vp, a.rect);
    const w = x2 - x1, h = y2 - y1;
    const op = a.opacity ?? 1;
    switch (a.type) {
      case 'Text': {
        const s = Math.max(12, Math.min(w, h, 28));
        const t = svgEl('g', { transform: `translate(${x1} ${y1}) scale(${s / 20})`, opacity: op }, g);
        svgEl('path', { d: 'M2 2h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', fill: col, stroke: '#333', 'stroke-width': 1 }, t);
        svgEl('path', { d: 'M4.5 6h11M4.5 9h8', stroke: textOn(a.color) === '#fff' ? '#fff' : '#333', 'stroke-width': 1.2, 'stroke-linecap': 'round' }, t);
        svgEl('rect', { class: 'hit', x: x1, y: y1, width: s, height: s }, g);
        break;
      }
      case 'FreeText': {
        if (a.interiorColor) svgEl('rect', { x: x1, y: y1, width: w, height: h, fill: rgbCss(a.interiorColor), opacity: op }, g);
        if (a.borderWidth) svgEl('rect', { x: x1, y: y1, width: w, height: h, fill: 'none', stroke: col, 'stroke-width': a.borderWidth }, g);
        const fo = svgEl('foreignObject', { x: x1, y: y1, width: w, height: h }, g);
        const div = document.createElement('div');
        div.className = 'ft';
        div.style.cssText = `font-size:${a.fontSize || 12}px;color:${col};padding:2px;width:${w}px;height:${h}px;opacity:${op}`;
        div.textContent = a.contents;
        fo.append(div);
        if (!a.contents && opts.interactive) svgEl('rect', { x: x1, y: y1, width: w, height: h, fill: 'none', stroke: '#999', 'stroke-dasharray': '3 2', 'stroke-width': 0.8 }, g);
        svgEl('rect', { class: 'hit', x: x1, y: y1, width: w, height: h }, g);
        break;
      }
      case 'Highlight': case 'Underline': case 'StrikeOut': case 'Squiggly': {
        const q = a.quadPoints || [];
        for (let k = 0; k + 7 < q.length; k += 8) {
          const p = [0, 1, 2, 3].map((j) => vp.convertToViewportPoint(q[k + j * 2], q[k + j * 2 + 1]));
          // ordem: UL, UR, LL, LR
          if (a.type === 'Highlight') {
            svgEl('polygon', { points: [p[0], p[1], p[3], p[2]].map((pt) => pt.join(',')).join(' '), fill: col, opacity: Math.min(op, 0.4), style: 'mix-blend-mode:multiply' }, g);
          } else {
            const t = a.type === 'StrikeOut' ? 0.5 : 0.92;
            const lerp = (A, B) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
            const A = lerp(p[0], p[2]), B = lerp(p[1], p[3]);
            const hgt = Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1]);
            svgEl('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: col, 'stroke-width': Math.max(0.8, hgt / 12), opacity: op }, g);
          }
          svgEl('polygon', { class: 'hit', points: [p[0], p[1], p[3], p[2]].map((pt) => pt.join(',')).join(' ') }, g);
        }
        break;
      }
      case 'Square': case 'Circle': {
        const bw = a.borderWidth ?? 2;
        const attrs = { fill: a.interiorColor ? rgbCss(a.interiorColor) : 'none', stroke: col, 'stroke-width': Math.max(bw, a.frame ? 3 : 0.5), opacity: op };
        if (a.frame) attrs.class = 'frame';
        if (a.type === 'Square') svgEl('rect', { x: x1 + bw / 2, y: y1 + bw / 2, width: Math.max(0, w - bw), height: Math.max(0, h - bw), ...attrs }, g);
        else svgEl('ellipse', { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.max(0, w / 2 - bw / 2), ry: Math.max(0, h / 2 - bw / 2), ...attrs }, g);
        if (!a.frame) {
          // área de clique: só a borda (para não bloquear o conteúdo)
          svgEl(a.type === 'Square' ? 'rect' : 'ellipse', a.type === 'Square'
            ? { class: 'hit', x: x1, y: y1, width: w, height: h, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(8, bw + 6), style: 'pointer-events:stroke' }
            : { class: 'hit', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: w / 2, ry: h / 2, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(8, bw + 6), style: 'pointer-events:stroke' }, g);
        }
        break;
      }
      case 'Ink': {
        for (const path of a.inkList || []) {
          const pts = [];
          for (let k = 0; k + 1 < path.length; k += 2) pts.push(vp.convertToViewportPoint(path[k], path[k + 1]).join(','));
          svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: col, 'stroke-width': a.borderWidth ?? 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: op }, g);
          svgEl('polyline', { class: 'hit', points: pts.join(' '), fill: 'none', stroke: 'transparent', 'stroke-width': 10, style: 'pointer-events:stroke' }, g);
        }
        break;
      }
      case 'Line': {
        const L = a.line || a.rect;
        const A = vp.convertToViewportPoint(L[0], L[1]), B = vp.convertToViewportPoint(L[2], L[3]);
        svgEl('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: col, 'stroke-width': a.borderWidth ?? 2, opacity: op }, g);
        svgEl('line', { class: 'hit', x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: 'transparent', 'stroke-width': 10, style: 'pointer-events:stroke' }, g);
        break;
      }
    }
    if (opts.selectedId === a.id) {
      svgEl('rect', { class: 'sel-outline', x: x1 - 3, y: y1 - 3, width: w + 6, height: h + 6 }, svg);
      if (['Square', 'Circle', 'FreeText'].includes(a.type)) {
        const hs = 9 / (opts.scale || 1);
        svgEl('rect', { class: 'handle', 'data-handle': a.id, x: x2 - hs / 2, y: y2 - hs / 2, width: hs, height: hs }, svg);
      }
    }
    if (opts.numbers && !a.frame && (a.contents || a.type === 'Text' || a.type === 'FreeText')) numbered.push({ a, x: x1, y: y1 });
  }
  if (opts.numbers) {
    numbered.sort((p, q) => p.y - q.y || p.x - q.x);
    const r = 9 / (opts.scale || 1);
    for (const n of numbered) {
      num++;
      n.a._num = num;
      const g = svgEl('g', { class: 'nb', transform: `translate(${Math.max(r, n.x)} ${Math.max(r, n.y)}) scale(${1 / (opts.scale || 1)})` }, svg);
      svgEl('circle', { r: 9 }, g);
      svgEl('text', {}, g).textContent = num;
    }
  }
  svg._numbered = numbered.map((n) => n.a);
  return svg;
}

function groupsOfPage(i) {
  const ids = new Set(S.annots.filter((a) => a.page === i && a.group).map((a) => a.group));
  return S.groups.filter((g) => ids.has(g.id));
}

function refreshPage(i) {
  const el = pageEl(i);
  if (!el) return;
  $('svg.ann', el)?.remove();
  const svg = buildAnnotSvg(i);
  const tagsEl = $('.tags', el);
  el.insertBefore(svg, tagsEl);
  tagsEl.innerHTML = '';
  for (const g of groupsOfPage(i)) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.style.background = rgbCss(g.color);
    t.style.color = textOn(g.color);
    t.textContent = g.label || 'Marcação';
    t.title = g.text;
    tagsEl.append(t);
  }
  const count = S.annots.filter((a) => a.page === i && !a.group).length;
  let badge = $('.badge', el);
  if (count) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; el.append(badge); }
    badge.textContent = `💬 ${count}`;
  } else badge?.remove();
  el.classList.toggle('match', S.matches.has(i));
}

let sideTimer = null;
function refreshAll() {
  for (let i = 0; i < S.n; i++) refreshPage(i);
  renderSideSoon();
  if (E.open) renderEditorOverlay();
}
function renderSideSoon() {
  clearTimeout(sideTimer);
  sideTimer = setTimeout(renderSide, 60);
}

// ============================================================================
// Seleção de páginas
// ============================================================================

grid.addEventListener('click', (e) => {
  const el = e.target.closest('.page');
  if (!el) return;
  const i = +el.dataset.i;
  if (e.shiftKey && S.lastClicked != null) {
    const [a, b] = [Math.min(S.lastClicked, i), Math.max(S.lastClicked, i)];
    const add = !(e.altKey);
    for (let k = a; k <= b; k++) add ? S.sel.add(k) : S.sel.delete(k);
  } else {
    S.sel.has(i) ? S.sel.delete(i) : S.sel.add(i);
  }
  S.lastClicked = i;
  updateSelectionUI();
});

grid.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.page');
  if (!el) return;
  window.getSelection()?.removeAllRanges();
  openEditor(+el.dataset.i);
});

function updateSelectionUI() {
  for (let i = 0; i < S.n; i++) pageEl(i).classList.toggle('selected', S.sel.has(i));
  const bar = $('#selbar');
  bar.hidden = !S.n;
  const n = S.sel.size;
  $('#sel-info').textContent = n
    ? `${n} página${n > 1 ? 's' : ''} selecionada${n > 1 ? 's' : ''}: ${truncate(formatPageRanges(S.sel), 60)}`
    : 'Nenhuma página selecionada — clique nas páginas ou digite um intervalo:';
  $('#mark-group').disabled = !n;
  $('#sel-clear').disabled = !n;
  $('#sel-search').hidden = !S.matches.size;
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function selectPages(pages, add = false) {
  if (!add) S.sel.clear();
  for (const p of pages) S.sel.add(p);
  updateSelectionUI();
}

$('#sel-range').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const pages = parsePageRanges(e.target.value, S.n);
    if (!pages.length) { toast('Intervalo inválido. Ex.: 1-30, 45, 50-', true); return; }
    selectPages(pages, e.shiftKey);
    scrollToPage(pages[0]);
  }
});
$('#sel-all').onclick = () => selectPages([...Array(S.n).keys()]);
$('#sel-clear').onclick = () => selectPages([]);
$('#sel-search').onclick = () => selectPages([...S.matches]);
$('#mark-group').onclick = () => openGroupDialog();

function scrollToPage(i, flash = true) {
  const el = pageEl(i);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (flash) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

// ============================================================================
// Marcação em grupo (comentário único em várias páginas)
// ============================================================================

const PRESETS = ['Petição inicial', 'Contestação', 'Réplica', 'Documentos', 'Procuração', 'Decisão', 'Sentença', 'Recurso', 'Contrarrazões', 'Laudo', 'Manifestação', 'Certidão'];
const SWATCHES = ['#d62828', '#f77f00', '#e9c46a', '#2a9d8f', '#2458d6', '#7b2cbf', '#d63384', '#495057'];

(function initGroupDialog() {
  const chips = $('#label-chips');
  const dl = $('#label-presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p;
    b.onclick = () => { $('#group-dialog [name=label]').value = p; };
    chips.append(b);
    const o = document.createElement('option');
    o.value = p;
    dl.append(o);
  }
  const sw = $('#swatches');
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = c;
    b.onclick = () => { $('#group-dialog [name=color]').value = c; };
    sw.append(b);
  }
})();

function openGroupDialog(group = null) {
  if (!S.n) return;
  const dlg = $('#group-dialog');
  const f = dlg.querySelector('form');
  const pages = group ? group.pages : [...S.sel].sort((a, b) => a - b);
  f.label.value = group?.label || '';
  f.text.value = group?.text && group.text !== group.label ? group.text : '';
  f.pages.value = formatPageRanges(pages).replace(/–/g, '-');
  f.color.value = group ? rgbToHex(group.color) : settings.get('groupColor', '#d62828');
  f.frame.checked = group ? S.annots.some((a) => a.group === group.id && a.frame) : settings.get('groupFrame', true);
  f.corner.checked = group ? !!group.corner : settings.get('groupCorner', false);
  $('#gd-title').textContent = group ? 'Editar marcação de páginas' : 'Marcar páginas com comentário único';
  $('#gd-ok').textContent = group ? 'Salvar' : 'Aplicar';
  const updHint = () => {
    const n = parsePageRanges(f.pages.value, S.n).length;
    $('#gd-hint').textContent = `${n} página(s). Cada página recebe uma nota com o rótulo e o comentário` + (f.frame.checked ? ' e uma moldura colorida.' : '.');
  };
  f.pages.oninput = updHint;
  f.frame.onchange = updHint;
  updHint();
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const pg = parsePageRanges(f.pages.value, S.n);
    const label = f.label.value.trim();
    if (!label || !pg.length) { toast('Informe um rótulo e ao menos uma página.', true); return; }
    settings.set('groupColor', f.color.value);
    settings.set('groupFrame', f.frame.checked);
    settings.set('groupCorner', f.corner.checked);
    applyGroup({
      id: group?.id, label, text: f.text.value.trim(), color: hexToRgb(f.color.value),
      frame: f.frame.checked, corner: f.corner.checked, author: group?.author || author(),
    }, pg);
    if (!group) selectPages([]);
  };
  dlg.showModal();
  setTimeout(() => f.label.focus(), 0);
}

function applyGroup(spec, pages) {
  snapshot();
  const id = spec.id || uid('g').replace(/[^A-Za-z0-9]/g, '');
  const prevPages = new Set(S.annots.filter((a) => a.group === id).map((a) => a.page));
  const old = new Map(S.annots.filter((a) => a.group === id).map((a) => [a.name, a]));
  S.annots = S.annots.filter((a) => a.group !== id);
  const now = new Date();
  const contents = spec.text || spec.label;
  for (const p of pages) {
    const vp = S.vps[p];
    const size = 22;
    const x = spec.corner ? vp.width - size - 8 : 8;
    const c1 = vp.convertToPdfPoint(x, 8), c2 = vp.convertToPdfPoint(x + size, 8 + size);
    const nm = groupNM(id, p);
    const prev = old.get(nm);
    S.annots.push({
      id: uid(), type: 'Text', page: p, rect: normRect([c1[0], c1[1], c2[0], c2[1]]), contents, subject: spec.label,
      author: spec.author, color: spec.color, opacity: 1, icon: 'Comment', name: nm, group: id,
      created: prev?.created || now, modified: now,
    });
    if (spec.frame) {
      const f1 = vp.convertToPdfPoint(2, 2), f2 = vp.convertToPdfPoint(vp.width - 2, vp.height - 2);
      const fnm = groupNM(id, p, true);
      S.annots.push({
        id: uid(), type: 'Square', page: p, rect: normRect([f1[0], f1[1], f2[0], f2[1]]), contents, subject: spec.label,
        author: spec.author, color: spec.color, opacity: 1, borderWidth: 3, name: fnm, group: id, frame: true,
        created: old.get(fnm)?.created || now, modified: now,
      });
    }
  }
  const rec = { id, label: spec.label, text: spec.text, color: spec.color, author: spec.author, corner: spec.corner };
  S.groups = rebuildGroups(S.annots, [...S.groups.filter((g) => g.id !== id), rec]);
  // rebuildGroups recria a partir das anotações; preserva os campos do registro
  const g = S.groups.find((x) => x.id === id);
  if (g) Object.assign(g, rec, { pages: g.pages });
  setDirty(true);
  for (const p of new Set([...prevPages, ...pages])) refreshPage(p);
  renderSideSoon();
  if (E.open) renderEditorOverlay();
  toast(`“${spec.label}” aplicado a ${pages.length} página(s).`);
}

function deleteGroup(g) {
  snapshot();
  const pages = new Set(S.annots.filter((a) => a.group === g.id).map((a) => a.page));
  S.annots = S.annots.filter((a) => a.group !== g.id);
  S.groups = S.groups.filter((x) => x.id !== g.id);
  setDirty(true);
  for (const p of pages) refreshPage(p);
  renderSideSoon();
  if (E.open) renderEditorOverlay();
}

// ============================================================================
// Painel lateral
// ============================================================================

$('#filter').addEventListener('input', renderSideSoon);
$('#toggle-side').onclick = () => {
  const side = $('#side');
  side.classList.toggle('hidden');
  settings.set('sideHidden', side.classList.contains('hidden'));
  applyZoomVar();
  schedulePump();
};

function renderSide() {
  const q = norm($('#filter').value.trim());
  const match = (...xs) => !q || xs.some((x) => norm(x).includes(q));
  // Grupos
  const gl = $('#groups-list');
  gl.innerHTML = '';
  const groups = S.groups.filter((g) => match(g.label, g.text, g.author));
  $('#groups-count').textContent = S.groups.length ? `(${S.groups.length})` : '';
  if (!groups.length) gl.innerHTML = `<div class="empty-note">${S.n ? 'Selecione páginas e use “Marcar seleção com comentário…”.' : '—'}</div>`;
  for (const g of groups) {
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `<span class="dot" style="background:${rgbCss(g.color)}"></span>
      <span class="t"><b>${esc(g.label || 'Marcação')}</b> · ${g.pages.length} pág. · ${esc(truncate(formatPageRanges(g.pages), 40))}</span>
      <span class="acts"><button data-act="sel" title="Selecionar estas páginas">☑</button><button data-act="edit" title="Editar">✎</button><button data-act="del" title="Excluir marcação">🗑</button></span>
      ${g.text && g.text !== g.label ? `<div class="c">${esc(g.text)}</div>` : ''}`;
    it.onclick = (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'sel') { selectPages(g.pages); scrollToPage(g.pages[0]); }
      else if (act === 'edit') openGroupDialog(g);
      else if (act === 'del') {
        choose(`Excluir a marcação “${g.label}” de ${g.pages.length} página(s)?`, [
          { label: 'Cancelar', value: 'no' }, { label: 'Excluir', value: 'yes', primary: true },
        ]).then((r) => r === 'yes' && deleteGroup(g));
      } else {
        scrollToPage(g.pages[0]);
        for (const p of g.pages) { const el = pageEl(p); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      }
    };
    gl.append(it);
  }
  // Comentários individuais
  const al = $('#annots-list');
  al.innerHTML = '';
  const list = S.annots.filter((a) => !a.group && match(a.contents, a.author, a.subject, TYPE_LABELS[a.type]))
    .sort((a, b) => a.page - b.page || b.rect[3] - a.rect[3]);
  const total = S.annots.filter((a) => !a.group).length;
  $('#annots-count').textContent = total ? `(${total})` : '';
  if (!list.length) al.innerHTML = `<div class="empty-note">${S.n ? 'Clique duplo numa página para comentar.' : '—'}</div>`;
  const LIMIT = 400;
  for (const a of list.slice(0, LIMIT)) al.append(annotItem(a, true));
  if (list.length > LIMIT) al.insertAdjacentHTML('beforeend', `<div class="empty-note">… e mais ${list.length - LIMIT}. Use o filtro.</div>`);
}

function annotItem(a, withPage) {
  const it = document.createElement('div');
  it.className = 'item' + (E.open && E.selId === a.id ? ' active' : '');
  const meta = [withPage ? `p. ${a.page + 1}` : null, TYPE_LABELS[a.type], a.author, fmtDate(a.modified)].filter(Boolean).map(esc).join(' · ');
  it.innerHTML = `<span class="dot" style="background:${rgbCss(a.type === 'FreeText' ? a.color : a.color)}"></span>
    <span class="t">${meta}</span><span class="acts"><button data-act="del" title="Excluir">🗑</button></span>
    ${a.contents ? `<div class="c">${esc(a.contents)}</div>` : ''}`;
  it.onclick = (e) => {
    if (e.target.closest('button')?.dataset.act === 'del') { deleteAnnot(a.id); return; }
    if (E.open) revealAnnot(a.id);
    else scrollToPage(a.page);
  };
  it.ondblclick = () => { if (!E.open) openEditor(a.page, a.id); };
  return it;
}

// ============================================================================
// Lupa: página ampliada ao passar o cursor, com comentários destacados
// ============================================================================

const pv = { el: $('#preview'), i: -1, timer: null, task: null, x: 0, cache: new Map() };

viewer.addEventListener('mousemove', (e) => { pv.x = e.clientX; });
grid.addEventListener('mouseover', (e) => {
  if (!S.hoverZoom || E.open) return;
  const el = e.target.closest('.page');
  if (!el) { schedulePreviewHide(); return; }
  const i = +el.dataset.i;
  if (i === pv.i && !pv.el.hidden) return;
  clearTimeout(pv.timer);
  pv.timer = setTimeout(() => showPreview(i), pv.el.hidden ? 220 : 40);
});
grid.addEventListener('mouseleave', schedulePreviewHide);
viewer.addEventListener('scroll', () => { if (!pv.el.hidden) schedulePreviewHide(); }, { passive: true });

function schedulePreviewHide() {
  clearTimeout(pv.timer);
  pv.timer = setTimeout(hidePreview, 80);
}

function hidePreview() {
  clearTimeout(pv.timer);
  pv.el.hidden = true;
  pv.i = -1;
  pv.task?.cancel();
}

async function showPreview(i) {
  if (!S.pdf || E.open) return;
  const vp = S.vps[i];
  const annots = annotsOfPage(i);
  const groups = groupsOfPage(i);
  // Dimensões
  const W = window.innerWidth, H = window.innerHeight;
  const headH = 26;
  const listed = annots.filter((a) => !a.frame && (a.contents || a.type === 'Text' || a.type === 'FreeText')).length;
  const listH = listed ? Math.min(listed, 6) * 20 + 4 : 0;
  let pageH = H - 24 - 16 - headH - listH - 12;
  let pageW = pageH * vp.width / vp.height;
  const maxW = W * 0.5 - 40;
  if (pageW > maxW) { pageW = maxW; pageH = pageW * vp.height / vp.width; }
  // Se a miniatura já é tão grande quanto a lupa, não há o que ampliar
  if (pageEl(i).offsetWidth >= pageW * 0.85) { hidePreview(); return; }
  pv.i = i;
  const box = pv.el;
  const onLeft = pv.x > W / 2;
  box.style.left = onLeft ? '12px' : '';
  box.style.right = onLeft ? '' : '12px';
  box.style.width = `${pageW + 16}px`;
  // Cabeçalho
  const head = $('.pv-head', box);
  head.innerHTML = `<span>Página ${i + 1}</span><span class="muted">de ${S.n}</span>`;
  for (const g of groups) head.insertAdjacentHTML('beforeend', `<span class="tag" style="background:${rgbCss(g.color)};color:${textOn(g.color)}">${esc(g.label)}</span>`);
  const nInd = annots.filter((a) => !a.group).length;
  if (nInd) head.insertAdjacentHTML('beforeend', `<span class="muted">· ${nInd} comentário(s)</span>`);
  // Página
  const holder = $('.pv-page', box);
  holder.style.width = `${pageW}px`;
  holder.style.height = `${pageH}px`;
  $('svg', holder)?.remove();
  const scale = pageW / vp.width;
  const svg = buildAnnotSvg(i, { numbers: true, scale });
  svg.classList.add('hl');
  holder.append(svg);
  // Lista numerada
  const ol = $('.pv-list', box);
  ol.innerHTML = '';
  for (const a of svg._numbered.slice(0, 6)) {
    const g = a.group ? S.groups.find((x) => x.id === a.group) : null;
    const label = g ? `[${g.label}] ` : a.subject && a.subject !== 'Nota' ? `[${a.subject}] ` : '';
    ol.insertAdjacentHTML('beforeend', `<li><b>${a._num}</b><span>${esc(label)}${esc(a.contents || TYPE_LABELS[a.type])}${a.author ? ` <i class="muted">— ${esc(a.author)}</i>` : ''}</span></li>`);
  }
  if (svg._numbered.length > 6) ol.insertAdjacentHTML('beforeend', `<li><span class="muted">… mais ${svg._numbered.length - 6}</span></li>`);
  box.hidden = false;
  // Canvas: usa a miniatura como prévia imediata e renderiza em alta resolução
  const canvas = $('canvas', holder);
  const cw = Math.round(pageW * DPR()), ch = Math.round(pageH * DPR());
  const key = `${i}:${cw}`;
  const cached = pv.cache.get(key);
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (cached) { ctx.drawImage(cached, 0, 0); return; }
  const thumb = $('canvas.pg', pageEl(i));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  if (thumb && thumb.width) ctx.drawImage(thumb, 0, 0, cw, ch);
  pv.task?.cancel();
  try {
    const page = await S.pdf.getPage(i + 1);
    if (pv.i !== i) return;
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const task = page.render({ canvas: off, viewport: page.getViewport({ scale: cw / vp.width }) });
    pv.task = task;
    await task.promise;
    pv.cache.set(key, off);
    if (pv.cache.size > 10) pv.cache.delete(pv.cache.keys().next().value);
    if (pv.i === i) ctx.drawImage(off, 0, 0);
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn(e);
  }
}

$('#hover-zoom').onchange = (e) => {
  S.hoverZoom = e.target.checked;
  settings.set('hoverZoom', S.hoverZoom);
  if (!S.hoverZoom) hidePreview();
};

// ============================================================================
// Leitura contínua: todas as páginas em rolagem sequencial, com texto
// selecionável, hiperlinks e criação/edição de comentários
// ============================================================================

const E = {
  open: false, i: 0, scale: 1.5, fit: true, tool: 'select', selId: null,
  drag: null, pendingSnap: null, pages: new Map(), io: null, gen: 0,
};
const escroll = $('#editor .ed-scroll');
const epages = $('#editor .epages');
const MARKUP = ['Highlight', 'Underline', 'StrikeOut'];
const DRAW = ['Text', 'FreeText', 'Square', 'Circle', 'Ink'];

const evp = (i) => S.vps[i].clone({ scale: E.scale });
const epageEl = (i) => epages.children[i];

function openEditor(i, selId = null) {
  hidePreview();
  E.open = true;
  E.selId = selId;
  $('#editor').hidden = false;
  setTool(E.tool);
  E.fit = true;
  buildEditorPages(i, 0);
  if (selId) revealAnnot(selId);
  escroll.focus({ preventScroll: true });
}

function closeEditor() {
  E.open = false;
  hideAnnTip();
  resetEditorPages();
  $('#editor').hidden = true;
  renderSideSoon();
  scrollToPage(E.i, false);
  viewer.focus();
}

function resetEditorPages() {
  E.gen++;
  E.io?.disconnect();
  for (const st of E.pages.values()) st.task?.cancel();
  E.pages.clear();
  epages.innerHTML = '';
}

// Cria os espaços de todas as páginas; o conteúdo é renderizado sob demanda.
function buildEditorPages(anchor, ratio = 0) {
  resetEditorPages();
  if (E.fit) {
    // Página inteira: a página cabe por completo na área visível (largura e altura)
    E.scale = fitScaleFor(anchor);
  }
  $('#ed-fit').classList.toggle('on', E.fit);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < S.n; i++) {
    const el = document.createElement('div');
    el.className = 'epage';
    el.dataset.i = i;
    el.style.width = `${Math.round(S.vps[i].width * E.scale)}px`;
    el.style.height = `${Math.round(S.vps[i].height * E.scale)}px`;
    el.innerHTML = `<span class="epno">${i + 1}</span>`;
    frag.append(el);
  }
  epages.append(frag);
  E.io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const i = +en.target.dataset.i;
      if (en.isIntersecting) renderEPage(i); else releaseEPage(i);
    }
  }, { root: escroll, rootMargin: '1200px 0px' });
  for (const el of epages.children) E.io.observe(el);
  const el = epageEl(anchor);
  escroll.scrollTop = el.offsetTop - 12 + ratio * el.offsetHeight;
  $('#ed-zoom').textContent = `${Math.round(E.scale * 100)}%`;
  setCurrentPage(anchor, true);
  updateToolUI();
  renderEditorList();
  renderProps();
}

async function renderEPage(i) {
  if (E.pages.has(i)) return;
  const gen = E.gen;
  const st = { vp: evp(i) };
  E.pages.set(i, st);
  const el = epageEl(i);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(st.vp.width * DPR());
  canvas.height = Math.round(st.vp.height * DPR());
  const tl = document.createElement('div');
  tl.className = 'textLayer';
  tl.style.setProperty('--total-scale-factor', E.scale);
  const draw = document.createElement('div');
  draw.className = 'draw';
  el.innerHTML = `<span class="epno">${i + 1}</span>`;
  el.prepend(canvas, tl);
  el.append(draw);
  renderEPageOverlay(i);
  try {
    const page = await S.pdf.getPage(i + 1);
    if (gen !== E.gen || E.pages.get(i) !== st) return;
    st.task = page.render({ canvas, viewport: page.getViewport({ scale: E.scale * DPR() }) });
    await st.task.promise;
    if (gen !== E.gen || E.pages.get(i) !== st) return;
    const links = await getLinks(i);
    if (gen !== E.gen || E.pages.get(i) !== st) return;
    if (links.length) el.insertBefore(buildLinkLayer(i, links), $('svg.ann', el));
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: st.vp });
    await textLayer.render();
    markHits(tl);
    st.textReady = true;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('Falha ao exibir página', i + 1, e);
  }
}

function releaseEPage(i) {
  // Libera memória das páginas distantes
  if (E.pages.size < 16 || E.drag?.i === i) return;
  const st = E.pages.get(i);
  if (!st) return;
  st.task?.cancel();
  E.pages.delete(i);
  epageEl(i).innerHTML = `<span class="epno">${i + 1}</span>`;
}

function renderEPageOverlay(i) {
  const el = epageEl(i);
  if (!el || !E.pages.has(i)) return;
  $('svg.ann', el)?.remove();
  const svg = buildAnnotSvg(i, { interactive: true, selectedId: E.selId, scale: E.scale });
  const draw = $('.draw', el);
  if (draw) el.insertBefore(svg, draw); else el.append(svg);
}

// Atualiza as camadas de anotação, a lista lateral e o formulário
function renderEditorOverlay() {
  if (!E.open) return;
  for (const i of E.pages.keys()) renderEPageOverlay(i);
  renderEditorList();
  renderProps();
}

// Página atual = a que ocupa a parte superior da área visível
let curRaf = 0;
escroll.addEventListener('scroll', () => {
  if (curRaf) return;
  curRaf = requestAnimationFrame(() => {
    curRaf = 0;
    if (!E.open || !S.n) return;
    const y = escroll.scrollTop + escroll.clientHeight * 0.3;
    let lo = 0, hi = S.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (epageEl(mid).offsetTop <= y) lo = mid; else hi = mid - 1;
    }
    setCurrentPage(lo);
  });
}, { passive: true });

function setCurrentPage(i, force = false) {
  if (!force && i === E.i) return;
  E.i = i;
  updateOutlineCurrent(i);
  updateNumButton(i);
  $('#ed-pageno').textContent = `${i + 1} / ${S.n}`;
  $('#ed-prev').disabled = i === 0;
  $('#ed-next').disabled = i === S.n - 1;
  for (const h of $$('#ed-list .pg-h.cur')) h.classList.remove('cur');
  $(`#ed-list .pg-h[data-p="${i}"]`)?.classList.add('cur');
}

// Escala em que a página i cabe inteira na área visível
function fitScaleFor(i) {
  const vp = S.vps[i];
  return Math.max(0.2, Math.min(4, (escroll.clientWidth - 48) / vp.width, (escroll.clientHeight - 28) / vp.height));
}

// Se a área visível mudar de tamanho (janela, barra que quebra linha), refaz o ajuste de página inteira
let fitRaf = 0;
new ResizeObserver(() => {
  if (!E.open || !E.fit || fitRaf) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    if (E.open && E.fit && Math.abs(fitScaleFor(E.i) - E.scale) > 0.005) buildEditorPages(E.i, 0);
  });
}).observe(escroll);

// Navegação entre páginas: sempre mostra a página inteira (volta ao ajuste de página inteira
// se o zoom tiver sido alterado ou se a página tiver outro tamanho/orientação)
function gotoEditorPage(i, smooth = false) {
  if (i < 0 || i >= S.n) return;
  if (!E.fit || Math.abs(fitScaleFor(i) - E.scale) > 0.005) {
    E.fit = true;
    buildEditorPages(i, 0);
    return;
  }
  const el = epageEl(i);
  escroll.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  setCurrentPage(i, true);
}

function zoomEditor(f) {
  E.fit = false;
  E.scale = Math.max(0.25, Math.min(6, E.scale * f));
  rebuildEditorKeepingPosition();
}

function rebuildEditorKeepingPosition() {
  const el = epageEl(E.i);
  const ratio = el ? (escroll.scrollTop + 12 - el.offsetTop) / el.offsetHeight : 0;
  buildEditorPages(E.i, ratio);
}

// Seleciona um comentário e rola até ele
function revealAnnot(id) {
  const a = S.annots.find((x) => x.id === id);
  if (!a) return;
  E.selId = id;
  gotoEditorPage(a.page);
  renderEditorOverlay();
}

// ---- Lista de todos os comentários do arquivo ----
let edListTimer = null;
function renderEditorListSoon() {
  clearTimeout(edListTimer);
  edListTimer = setTimeout(renderEditorList, 200);
}

function renderEditorList() {
  if (!E.open) return;
  const list = $('#ed-list');
  const q = norm($('#ed-filter').value.trim());
  const match = (...xs) => !q || xs.some((x) => norm(x).includes(q));
  list.innerHTML = '';
  const groups = S.groups.filter((g) => match(g.label, g.text, g.author));
  if (groups.length) {
    list.insertAdjacentHTML('beforeend', '<div class="pg-h">Marcações de páginas</div>');
    for (const g of groups) {
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `<span class="dot" style="background:${rgbCss(g.color)}"></span>
        <span class="t"><b>${esc(g.label || 'Marcação')}</b> · ${g.pages.length} pág. · ${esc(truncate(formatPageRanges(g.pages), 40))}</span><span></span>
        ${g.text && g.text !== g.label ? `<div class="c">${esc(g.text)}</div>` : ''}`;
      // Clique: salta para a próxima página da marcação a partir da atual
      it.onclick = () => gotoEditorPage(g.pages.find((p) => p > E.i) ?? g.pages[0], true);
      list.append(it);
    }
  }
  const items = S.annots.filter((a) => !a.group && match(a.contents, a.author, a.subject, TYPE_LABELS[a.type]))
    .sort((a, b) => a.page - b.page || b.rect[3] - a.rect[3]);
  const total = S.annots.filter((a) => !a.group).length;
  $('#ed-count').textContent = total ? `(${total})` : '';
  if (!items.length) {
    list.insertAdjacentHTML('beforeend', `<div class="empty-note">${total ? 'Nenhum comentário corresponde ao filtro.' : 'Nenhum comentário no arquivo. Escolha uma ferramenta à esquerda e clique na página.'}</div>`);
  }
  const LIMIT = 800;
  let last = -1;
  for (const a of items.slice(0, LIMIT)) {
    if (a.page !== last) {
      last = a.page;
      const h = document.createElement('div');
      h.className = 'pg-h' + (a.page === E.i ? ' cur' : '');
      h.dataset.p = a.page;
      h.textContent = `Página ${a.page + 1}`;
      h.onclick = () => gotoEditorPage(a.page, true);
      list.append(h);
    }
    list.append(annotItem(a, false));
  }
  if (items.length > LIMIT) list.insertAdjacentHTML('beforeend', `<div class="empty-note">… e mais ${items.length - LIMIT}. Use o filtro.</div>`);
  $('#ed-list .item.active')?.scrollIntoView({ block: 'nearest' });
}
$('#ed-filter').addEventListener('input', renderEditorListSoon);

// ---- Hiperlinks do PDF ----
async function getLinks(i) {
  if (S.links.has(i)) return S.links.get(i);
  let links = [];
  try {
    const page = await S.pdf.getPage(i + 1);
    const anns = await page.getAnnotations({ intent: 'display' });
    links = anns.filter((a) => a.subtype === 'Link' && (a.url || a.dest || a.action))
      .map((a) => ({ rect: a.rect, url: a.url || null, dest: a.dest ?? null, action: a.action || null }));
  } catch (e) { console.warn('Links indisponíveis na página', i + 1, e); }
  S.links.set(i, links);
  return links;
}

// Camada de links em porcentagem da página (serve para qualquer tamanho de exibição)
function buildLinkLayer(i, links) {
  const vp = S.vps[i];
  const layer = document.createElement('div');
  layer.className = 'links';
  for (const l of links) {
    const [x1, y1, x2, y2] = dispRect(vp, l.rect);
    const a = document.createElement('a');
    a.className = 'lnk';
    a.style.cssText = `left:${(x1 / vp.width) * 100}%;top:${(y1 / vp.height) * 100}%;width:${((x2 - x1) / vp.width) * 100}%;height:${((y2 - y1) / vp.height) * 100}%`;
    a.href = l.url || '#';
    a.title = l.url ? l.url : 'Ir para o destino no documento';
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); followLink(l); });
    a.addEventListener('dblclick', (e) => e.stopPropagation());
    a.addEventListener('pointerdown', (e) => e.stopPropagation());
    layer.append(a);
  }
  return layer;
}

async function followLink(l) {
  if (l.url) {
    if (!/^(https?:|mailto:|ftp:)/i.test(l.url)) { toast('Link não suportado: ' + l.url, true); return; }
    window.open(l.url, '_blank', 'noopener');
    return;
  }
  if (l.dest != null) {
    const d = await resolveDest(l.dest);
    if (d) navigateTo(d.page, d.top);
    else toast('Destino do link não encontrado no documento.', true);
    return;
  }
  const named = { NextPage: E.i + 1, PrevPage: E.i - 1, FirstPage: 0, LastPage: S.n - 1 };
  if (l.action in named) navigateTo(Math.max(0, Math.min(S.n - 1, named[l.action])), null);
}

async function resolveDest(dest) {
  try {
    const d = typeof dest === 'string' ? await S.pdf.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    const page = ref && typeof ref === 'object' ? await S.pdf.getPageIndex(ref) : Number.isInteger(ref) ? ref : null;
    if (page == null || page < 0 || page >= S.n) return null;
    const kind = d[1]?.name;
    const top = kind === 'XYZ' ? d[3] : kind === 'FitH' || kind === 'FitBH' ? d[2] : kind === 'FitR' ? d[5] : null;
    return { page, top: typeof top === 'number' ? top : null };
  } catch { return null; }
}

function navigateTo(page, top) {
  if (E.open) {
    gotoEditorPage(page);
  } else {
    scrollToPage(page);
  }
}

// ---- Ferramentas ----
function setTool(t) {
  E.tool = t;
  if (t !== 'select') {
    const saved = settings.get('color-' + t, null);
    $('#tool-color').value = saved || rgbToHex(defaultColor(t));
  }
  updateToolUI();
}

function updateToolUI() {
  for (const b of $$('#editor .tool')) b.classList.toggle('active', b.dataset.tool === E.tool);
  epages.classList.toggle('tool-select', E.tool === 'select');
  epages.classList.toggle('markup-mode', MARKUP.includes(E.tool));
  epages.classList.toggle('draw-mode', DRAW.includes(E.tool));
}

$$('#editor .tool').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
$('#tool-color').oninput = (e) => { if (E.tool !== 'select') settings.set('color-' + E.tool, e.target.value); };
$('#ed-close').onclick = closeEditor;
$('#ed-save').onclick = () => savePdf();
$('#ed-prev').onclick = () => gotoEditorPage(E.i - 1);
$('#ed-next').onclick = () => gotoEditorPage(E.i + 1);
$('#ed-zoom-in').onclick = () => zoomEditor(1.2);
$('#ed-zoom-out').onclick = () => zoomEditor(1 / 1.2);
$('#ed-fit').onclick = fitWholePage;
function fitWholePage() { E.fit = true; buildEditorPages(E.i, 0); }
// Número do documento no rodapé do PJe: "Num. 2177293507 - Pág. 1"
async function getPageNum(i) {
  const t = await getPageText(i);
  let last = null;
  for (const m of t.matchAll(/\bNum\.?\s*:?\s*(\d[\d.]{5,})(?:\s*[-–—]\s*P[áa]g\.?\s*(\d+))?/gi)) last = m;
  if (!last) return null;
  // Ex.: "2177293507 - Pág. 1"
  return last[1].replace(/\D/g, '') + (last[2] ? ` - Pág. ${last[2]}` : '');
}

let numGen = 0;
async function updateNumButton(i) {
  const g = ++numGen;
  const btn = $('#ed-copy-num');
  const num = await getPageNum(i).catch(() => null);
  if (g !== numGen) return;
  btn.innerHTML = num ? `Copiar Num. <span class="num">${num}</span>` : 'Copiar Num.';
  btn.dataset.num = num || '';
}

$('#ed-copy-num').onclick = async () => {
  const i = E.i;
  const num = await getPageNum(i);
  if (!num) { toast(`Não encontrei “Num.” no texto da página ${i + 1}.`, true); return; }
  try { await navigator.clipboard.writeText(num); toast(`“${num}” copiado (página ${i + 1}).`); } catch { toast('Não foi possível acessar a área de transferência.', true); }
};

$('#ed-copy-text').onclick = async () => {
  const txt = await getPageText(E.i);
  try { await navigator.clipboard.writeText(txt); toast(`Texto da página ${E.i + 1} copiado.`); } catch { toast('Não foi possível acessar a área de transferência.', true); }
};

function evtPoint(e, el) {
  const r = el.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
const toPdf = (i, pt) => E.pages.get(i).vp.convertToPdfPoint(pt[0], pt[1]);
function dispRectToPdf(i, x1, y1, x2, y2) {
  const a = toPdf(i, [x1, y1]), b = toPdf(i, [x2, y2]);
  return normRect([a[0], a[1], b[0], b[1]]);
}

function newAnnot(props) {
  const now = new Date();
  const a = {
    id: uid(), contents: '', author: author(), subject: '', opacity: 1, created: now, modified: now,
    color: hexToRgb($('#tool-color').value), ...props,
  };
  a.name = a.name || a.id;
  snapshot();
  S.annots.push(a);
  setDirty(true);
  E.selId = a.id;
  refreshPage(a.page);
  renderEditorOverlay();
  renderSideSoon();
  return a;
}

// Desenho (nota, texto livre, retângulo, elipse, tinta), seleção e movimentação
epages.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const pel = e.target.closest('.epage');
  if (!pel) return;
  const i = +pel.dataset.i;
  if (!E.pages.has(i)) return;
  const draw = e.target.closest('.draw');
  const hit = e.target.closest('.hit, .handle');
  const p0 = evtPoint(e, pel);
  if (draw) {
    e.preventDefault();
    draw.setPointerCapture(e.pointerId);
    const rubber = document.createElement('div');
    rubber.className = 'rubber';
    pel.append(rubber);
    let ink = null;
    if (E.tool === 'Ink') {
      ink = svgEl('svg', { style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none' });
      const pl = svgEl('polyline', { fill: 'none', stroke: $('#tool-color').value, 'stroke-width': 2 * E.scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ink);
      ink._pl = pl;
      ink._pts = [p0];
      pel.append(ink);
      rubber.hidden = true;
    }
    E.drag = { kind: 'draw', i, el: pel, p0, p1: p0, rubber, ink };
    return;
  }
  if (hit && E.tool === 'select') {
    e.preventDefault();
    const handle = e.target.closest('.handle');
    const id = handle ? handle.dataset.handle : hit.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (E.selId !== id) { E.selId = id; renderEditorOverlay(); }
    const a = S.annots.find((x) => x.id === id);
    if (!a || a.frame) return;
    pel.setPointerCapture(e.pointerId);
    E.drag = { kind: handle ? 'resize' : 'move', i, el: pel, p0, id, orig: structuredClone(a), moved: false };
    return;
  }
  if (MARKUP.includes(E.tool)) {
    E.drag = { kind: 'markup', i, el: pel, p0, p1: p0 };
    return;
  }
  if (E.tool === 'select' && !e.target.closest('.textLayer span') && E.selId) {
    // clique no vazio: desmarca
    E.selId = null;
    renderEditorOverlay();
  }
});

// ---- Pop-up com o conteúdo do comentário ao pairar o cursor ----
const tip = $('#ann-tip');
let tipId = null;

function showAnnTip(a, x, y) {
  const g = a.group ? S.groups.find((k) => k.id === a.group) : null;
  const head = [
    `<b>${esc(g ? g.label || 'Marcação' : TYPE_LABELS[a.type])}</b>`,
    a.subject && !g && a.subject !== TYPE_LABELS[a.type] ? esc(a.subject) : null,
    a.author ? esc(a.author) : null,
    fmtDate(a.modified),
    `p. ${a.page + 1}`,
  ].filter(Boolean).join(' · ');
  $('.tip-h', tip).innerHTML = head;
  const c = $('.tip-c', tip);
  const text = g && !a.contents ? g.text : a.contents;
  c.textContent = text || '(comentário sem texto)';
  c.classList.toggle('vazio', !text);
  $('.tip-q', tip)?.remove();
  if (a._text) tip.insertAdjacentHTML('beforeend', `<div class="tip-q">“${esc(truncate(a._text, 200))}”</div>`);
  tip.style.setProperty('--tip-c', rgbCss(a.color));
  tip.hidden = false;
  tipId = a.id;
  moveAnnTip(x, y);
}

function moveAnnTip(x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 16, top = y + 18;
  if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 12);
  if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 12);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideAnnTip() {
  tip.hidden = true;
  tipId = null;
}

epages.addEventListener('pointerover', (e) => {
  if (E.drag) return;
  const hit = e.target.closest('.hit');
  if (!hit) return;
  const id = hit.closest('[data-id]')?.dataset.id;
  const a = id && S.annots.find((x) => x.id === id);
  if (a && tipId !== id) showAnnTip(a, e.clientX, e.clientY);
});
epages.addEventListener('pointerout', (e) => {
  if (!tipId) return;
  const to = e.relatedTarget?.closest?.('.hit')?.closest('[data-id]')?.dataset.id;
  if (to !== tipId) hideAnnTip();
});
epages.addEventListener('pointermove', (e) => { if (tipId && !E.drag) moveAnnTip(e.clientX, e.clientY); });
epages.addEventListener('pointerdown', hideAnnTip, true);
escroll.addEventListener('scroll', hideAnnTip, { passive: true });

epages.addEventListener('pointermove', (e) => {
  const d = E.drag;
  if (!d) return;
  const p = evtPoint(e, d.el);
  d.p1 = p;
  if (d.kind === 'draw') {
    if (d.ink) {
      d.ink._pts.push(p);
      d.ink._pl.setAttribute('points', d.ink._pts.map((q) => q.join(',')).join(' '));
    } else {
      const [x1, y1] = [Math.min(d.p0[0], p[0]), Math.min(d.p0[1], p[1])];
      Object.assign(d.rubber.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(p[0] - d.p0[0]) + 'px', height: Math.abs(p[1] - d.p0[1]) + 'px' });
    }
  } else if (d.kind === 'move' || d.kind === 'resize') {
    const a = S.annots.find((x) => x.id === d.id);
    if (!a) return;
    if (!d.moved && Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) < 3) return;
    if (!d.moved) { snapshot(); d.moved = true; }
    const A = toPdf(d.i, d.p0), B = toPdf(d.i, p);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    if (d.kind === 'move') {
      Object.assign(a, translateGeom(d.orig, dx, dy));
    } else {
      // redimensiona pelo canto inferior direito (em coordenadas de tela)
      const r = dispRect(E.pages.get(d.i).vp, d.orig.rect);
      a.rect = dispRectToPdf(d.i, r[0], r[1], Math.max(r[0] + 8, r[2] + (p[0] - d.p0[0])), Math.max(r[1] + 8, r[3] + (p[1] - d.p0[1])));
    }
    a.modified = new Date();
    renderEPageOverlay(d.i);
  }
});

function translateGeom(o, dx, dy) {
  const mv = (arr) => arr.map((v, k) => v + (k % 2 ? dy : dx));
  const out = { rect: mv(o.rect) };
  if (o.quadPoints) out.quadPoints = mv(o.quadPoints);
  if (o.inkList) out.inkList = o.inkList.map(mv);
  if (o.line) out.line = mv(o.line);
  return out;
}

epages.addEventListener('pointerup', () => {
  const d = E.drag;
  E.drag = null;
  if (!d) return;
  if (d.kind === 'draw') {
    d.rubber.remove();
    d.ink?.remove();
    finishDraw(d);
  } else if (d.kind === 'move' || d.kind === 'resize') {
    if (d.moved) { setDirty(true); refreshPage(d.i); renderEditorOverlay(); }
  } else if (d.kind === 'markup') {
    setTimeout(() => finishMarkup(d), 0);
  }
});

function finishDraw(d) {
  const [x0, y0] = d.p0, [x1, y1] = d.p1;
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const s = E.scale, i = d.i;
  const L = Math.min(x0, x1), T = Math.min(y0, y1);
  switch (E.tool) {
    case 'Text': {
      const size = 22 * s;
      newAnnot({ type: 'Text', page: i, rect: dispRectToPdf(i, x0, y0, x0 + size, y0 + size), icon: 'Comment' });
      setTool('select');
      focusContents();
      break;
    }
    case 'FreeText': {
      const r = w < 10 || h < 10 ? [x0, y0, x0 + 220 * s, y0 + 40 * s] : [L, T, L + w, T + h];
      newAnnot({ type: 'FreeText', page: i, rect: dispRectToPdf(i, ...r), fontSize: 12, borderWidth: 0, interiorColor: null });
      setTool('select');
      focusContents();
      break;
    }
    case 'Square': case 'Circle': {
      if (w < 4 || h < 4) return;
      newAnnot({ type: E.tool, page: i, rect: dispRectToPdf(i, L, T, L + w, T + h), borderWidth: 2 });
      break;
    }
    case 'Ink': {
      const pts = d.ink?._pts || [];
      if (pts.length < 2) return;
      const path = [];
      for (const p of pts) path.push(...toPdf(i, p));
      const bw = 2;
      const bb = quadsBBox(path);
      newAnnot({ type: 'Ink', page: i, inkList: [path], borderWidth: bw, rect: [bb[0] - bw, bb[1] - bw, bb[2] + bw, bb[3] + bw] });
      break;
    }
  }
}

function finishMarkup(d) {
  const sel = window.getSelection();
  const tl = $('.textLayer', d.el);
  let rects = [];
  if (sel && !sel.isCollapsed && sel.rangeCount && tl?.contains(sel.anchorNode)) {
    const base = d.el.getBoundingClientRect();
    for (let k = 0; k < sel.rangeCount; k++) {
      for (const r of sel.getRangeAt(k).getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        // apenas o trecho que está nesta página
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        if (cx < base.left || cx > base.right || cy < base.top || cy > base.bottom) continue;
        rects.push({ l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top });
      }
    }
    rects = mergeLineRects(rects);
  } else if (Math.abs(d.p1[0] - d.p0[0]) > 5 && Math.abs(d.p1[1] - d.p0[1]) > 3) {
    rects = [{ l: Math.min(d.p0[0], d.p1[0]), t: Math.min(d.p0[1], d.p1[1]), r: Math.max(d.p0[0], d.p1[0]), b: Math.max(d.p0[1], d.p1[1]) }];
  }
  if (!rects.length) return;
  const quads = [];
  for (const r of rects) {
    const UL = toPdf(d.i, [r.l, r.t]), UR = toPdf(d.i, [r.r, r.t]), LL = toPdf(d.i, [r.l, r.b]), LR = toPdf(d.i, [r.r, r.b]);
    quads.push(...UL, ...UR, ...LL, ...LR);
  }
  const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
  sel?.removeAllRanges();
  newAnnot({ type: E.tool, page: d.i, quadPoints: quads, rect: quadsBBox(quads), contents: '', _text: text });
}

function mergeLineRects(rects) {
  rects.sort((a, b) => a.t - b.t || a.l - b.l);
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last) {
      const h = Math.min(last.b - last.t, r.b - r.t);
      const overlap = Math.min(last.b, r.b) - Math.max(last.t, r.t);
      if (overlap > h * 0.5 && r.l <= last.r + h * 1.5 && r.r >= last.l - h * 1.5) {
        last.l = Math.min(last.l, r.l); last.r = Math.max(last.r, r.r);
        last.t = Math.min(last.t, r.t); last.b = Math.max(last.b, r.b);
        continue;
      }
    }
    out.push({ ...r });
  }
  return out;
}

function focusContents() {
  const ta = $('#props [name=contents]');
  ta.focus({ preventScroll: true });
  requestAnimationFrame(() => { if (document.activeElement !== ta) ta.focus({ preventScroll: true }); });
}

function deleteAnnot(id) {
  const a = S.annots.find((x) => x.id === id);
  if (!a) return;
  snapshot();
  S.annots = S.annots.filter((x) => x.id !== id);
  if (a.group) S.groups = rebuildGroups(S.annots, S.groups);
  if (E.selId === id) E.selId = null;
  setDirty(true);
  refreshPage(a.page);
  renderSideSoon();
  if (E.open) renderEditorOverlay();
}

// ---- Formulário de propriedades ----
const props = $('#props');

function renderProps() {
  const a = S.annots.find((x) => x.id === E.selId);
  props.hidden = !a;
  if (!a) return;
  const g = a.group ? S.groups.find((x) => x.id === a.group) : null;
  $('#props-title').textContent = `${TYPE_LABELS[a.type]} — p. ${a.page + 1}` + (g ? ` — marcação “${g.label}”` : '');
  if (document.activeElement?.form !== props) {
    props.contents.value = a.contents || '';
    props.author.value = a.author || '';
    props.subject.value = a.subject || '';
  }
  props.color.value = rgbToHex(a.color);
  props.fontSize.value = a.fontSize || 12;
  props.borderWidth.value = a.borderWidth ?? 2;
  props.opacity.value = a.opacity ?? 1;
  for (const l of $$('label[data-for]', props)) l.hidden = !l.dataset.for.split(' ').includes(a.type);
  $('#props-meta').textContent = [
    a.created ? `Criado: ${fmtDate(a.created)}` : '', a.modified ? `Modificado: ${fmtDate(a.modified)}` : '',
    a._text ? `Texto marcado: “${truncate(a._text, 120)}”` : '',
    g ? 'Para alterar todas as páginas da marcação, use ✎ no painel lateral da tela principal.' : '',
  ].filter(Boolean).join(' · ');
}

props.addEventListener('focusin', () => { E.pendingSnap = structuredClone({ annots: S.annots, groups: S.groups }); });
props.addEventListener('input', (e) => {
  const a = S.annots.find((x) => x.id === E.selId);
  if (!a) return;
  if (E.pendingSnap) { S.undo.push(E.pendingSnap); S.redo.length = 0; E.pendingSnap = null; }
  const f = e.target.name;
  if (f === 'contents' || f === 'author' || f === 'subject') a[f] = e.target.value;
  else if (f === 'color') a.color = hexToRgb(e.target.value);
  else if (f === 'fontSize') a.fontSize = Math.max(4, +e.target.value || 12);
  else if (f === 'borderWidth') a.borderWidth = Math.max(0, +e.target.value || 0);
  else if (f === 'opacity') a.opacity = +e.target.value;
  a.modified = new Date();
  setDirty(true);
  refreshPage(a.page);
  renderEPageOverlay(a.page);
  renderSideSoon();
  renderEditorListSoon();
});
props.addEventListener('submit', (e) => e.preventDefault());
$('#props-delete').onclick = () => E.selId && deleteAnnot(E.selId);
$('#props-close').onclick = () => { E.selId = null; renderEditorOverlay(); };

// ============================================================================
// Marcadores (sumário/outline do PDF) e abas do painel lateral
// ============================================================================

function setSideTab(tab) {
  settings.set('sideTab', tab);
  for (const b of $$('.side-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const el of $$('.pane[data-pane]')) el.hidden = el.dataset.pane !== tab;
  if (tab === 'outline') updateOutlineCurrent(E.open ? E.i : null, true);
}
for (const b of $$('.side-tabs button')) b.onclick = () => setSideTab(b.dataset.tab);
setSideTab(settings.get('sideTab', 'comments'));

async function loadOutline() {
  const pdf = S.pdf;
  let outline = [];
  try { outline = (await pdf.getOutline()) || []; } catch (e) { console.warn('Marcadores indisponíveis', e); }
  if (pdf !== S.pdf) return;
  // Numera os itens em ordem do documento
  const flat = [];
  const walk = (items, depth) => {
    for (const it of items) {
      it._k = flat.length;
      it._depth = depth;
      it._open = depth === 0 || false;
      flat.push(it);
      if (it.items?.length) walk(it.items, depth + 1);
    }
  };
  walk(outline, 0);
  // Documentos grandes: mostra só o 1º nível aberto; pequenos: tudo aberto
  if (flat.length <= 120) for (const it of flat) it._open = true;
  S.outline = outline;
  S.olFlat = flat;
  renderOutlines();
  // Descobre a página de cada marcador (em segundo plano)
  for (let k = 0; k < flat.length; k++) {
    const it = flat[k];
    if (it.dest != null) {
      const d = await resolveDest(it.dest);
      if (pdf !== S.pdf) return;
      if (d) {
        it._page = d.page;
        for (const pg of $$(`.outline .ol[data-k="${k}"] .pg`)) pg.textContent = `p. ${d.page + 1}`;
      }
    }
  }
  if (E.open) updateOutlineCurrent(E.i, true);
}

function renderOutlines() {
  for (const c of [$('#outline-list'), $('#ed-outline-list')]) {
    const q = norm(c.closest('.pane').querySelector('.ol-filter').value.trim());
    renderOutline(c, q);
  }
  $('#ed-ol-count').textContent = S.olFlat.length ? `(${S.olFlat.length})` : '';
}

function renderOutline(container, q = '') {
  container.innerHTML = '';
  if (!S.pdf) return;
  if (!S.olFlat.length) {
    container.innerHTML = '<div class="empty-note">Este PDF não tem marcadores.</div>';
    return;
  }
  const row = (it, depth) => {
    const kids = !q && it.items?.length;
    const r = document.createElement('div');
    r.className = 'ol' + (it.bold ? ' b' : '') + (it.italic ? ' i' : '') + (kids && !it._open ? ' collapsed' : '');
    r.dataset.k = it._k;
    r.style.setProperty('--d', depth);
    r.title = it.title;
    r.innerHTML = `<span class="tw">${kids ? (it._open ? '▾' : '▸') : ''}</span><span class="tl"></span><span class="pg">${it._page != null ? `p. ${it._page + 1}` : ''}</span>`;
    $('.tl', r).textContent = it.title || '(sem título)';
    r.onclick = (e) => {
      if (kids && e.target.classList.contains('tw')) {
        it._open = !it._open;
        r.classList.toggle('collapsed', !it._open);
        $('.tw', r).textContent = it._open ? '▾' : '▸';
        return;
      }
      for (const x of $$('.outline .ol.cur')) x.classList.remove('cur');
      for (const x of $$(`.outline .ol[data-k="${it._k}"]`)) x.classList.add('cur');
      followLink({ url: it.url || null, dest: it.dest ?? null, action: it.action || null });
    };
    return r;
  };
  if (q) {
    // Com filtro: lista plana dos marcadores que contêm o termo
    const hits = S.olFlat.filter((it) => norm(it.title).includes(q));
    if (!hits.length) container.innerHTML = '<div class="empty-note">Nenhum marcador corresponde ao filtro.</div>';
    for (const it of hits) container.append(row(it, 0));
    return;
  }
  const build = (items, depth, parent) => {
    for (const it of items) {
      parent.append(row(it, depth));
      if (it.items?.length) {
        const kids = document.createElement('div');
        kids.className = 'kids';
        build(it.items, depth + 1, kids);
        parent.append(kids);
      }
    }
  };
  build(S.outline, 0, container);
}

for (const f of $$('.ol-filter')) {
  f.addEventListener('input', () => renderOutline(f.closest('.pane').querySelector('.outline'), norm(f.value.trim())));
}

// Destaca o marcador correspondente à página atual da leitura contínua
function updateOutlineCurrent(i, reveal = false) {
  if (i == null || !S.olFlat.length) return;
  let best = null;
  for (const it of S.olFlat) if (it._page != null && it._page <= i && (!best || it._page >= best._page)) best = it;
  const list = $('#ed-outline-list');
  for (const x of $$('.ol.cur', list)) x.classList.remove('cur');
  if (!best) return;
  const el = $(`.ol[data-k="${best._k}"]`, list);
  if (!el) return;
  el.classList.add('cur');
  if (!list.closest('.pane').hidden && (reveal || E.open)) el.scrollIntoView({ block: 'nearest' });
}

// ============================================================================
// Busca no texto
// ============================================================================

async function getPageText(i) {
  if (S.text.has(i)) return S.text.get(i);
  const page = await S.pdf.getPage(i + 1);
  const tc = await page.getTextContent();
  const s = tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('');
  S.text.set(i, s);
  return s;
}

let searchGen = 0;

// Marca as ocorrências do termo buscado na camada de texto de uma página do editor
function markHits(tl) {
  for (const sp of tl.querySelectorAll('span.hit')) sp.classList.remove('hit', 'full', 'hit-cur');
  if (!S.searchTerm) return;
  const t = normNoSpace(S.searchTerm);
  for (const span of tl.querySelectorAll('span')) {
    const s = normNoSpace(span.textContent);
    if (!s) continue;
    if (s.includes(t)) span.classList.add('hit', 'full');
    else if (t.includes(s) && s.length > 3) span.classList.add('hit');
  }
}

function countOcc(hay, t) {
  let n = 0;
  for (let k = hay.indexOf(t); k >= 0; k = hay.indexOf(t, k + t.length)) n++;
  return n;
}

async function runSearch(term) {
  const gen = ++searchGen;
  S.searchTerm = term;
  S.matches.clear();
  S.occ = [];
  S.occIdx = -1;
  for (let i = 0; i < S.n; i++) pageEl(i).classList.remove('match', 'cur-match');
  if (E.open) for (const tl of $$('.epage .textLayer')) markHits(tl);
  const t = normNoSpace(term);
  syncSearchInputs(term);
  if (!t) { updateSearchUI(''); updateSelectionUI(); return; }
  for (let i = 0; i < S.n; i++) {
    const txt = await getPageText(i);
    if (gen !== searchGen) return;
    const c = countOcc(normNoSpace(txt), t);
    if (c) {
      S.matches.add(i);
      pageEl(i).classList.add('match');
      for (let k = 0; k < c; k++) S.occ.push({ page: i, k });
      if (S.occIdx < 0) gotoOcc(0);
    }
    if (i % 20 === 0) updateSearchUI(`buscando… ${i + 1}/${S.n}`);
  }
  updateSearchUI();
  if (!S.occ.length) { const withText = [...S.text.values()].some((x) => x.trim()); if (!withText) toast('Este PDF parece não ter texto (digitalizado sem OCR).', true); }
  updateSelectionUI();
}

function updateSearchUI(msg) {
  const n = S.occ?.length || 0;
  const text = msg ?? (!S.searchTerm ? '' : !n ? 'nada encontrado'
    : `${S.occIdx + 1} de ${n} · p. ${S.occ[S.occIdx].page + 1}` + (S.matches.size > 1 ? ` (${S.matches.size} págs.)` : ''));
  for (const id of ['#search-info', '#ed-search-info']) $(id).textContent = text;
  for (const id of ['#search-prev', '#search-next', '#ed-search-prev', '#ed-search-next']) $(id).disabled = n < 1;
}

function syncSearchInputs(term) {
  for (const id of ['#search', '#ed-search']) if ($(id).value.trim() !== term) $(id).value = term;
}

// Vai para a ocorrência idx (com volta ao início/fim)
function gotoOcc(idx) {
  const n = S.occ?.length || 0;
  if (!n) return;
  S.occIdx = ((idx % n) + n) % n;
  const o = S.occ[S.occIdx];
  updateSearchUI();
  for (const el of $$('#grid .page.cur-match')) el.classList.remove('cur-match');
  pageEl(o.page).classList.add('cur-match');
  if (E.open) focusHitInEditor(o);
  else scrollToPage(o.page);
}

// Na leitura contínua, rola até a ocorrência dentro da página e a destaca
function focusHitInEditor(o) {
  gotoEditorPage(o.page);
  const t0 = performance.now();
  const tryFocus = () => {
    if (!E.open || S.occ[S.occIdx] !== o) return;
    if (!E.pages.get(o.page)?.textReady) {
      if (performance.now() - t0 < 5000) requestAnimationFrame(tryFocus);
      return;
    }
    for (const sp of $$('.textLayer span.hit-cur', epages)) sp.classList.remove('hit-cur');
    const el = epageEl(o.page);
    const full = $$('.textLayer span.full', el);
    const hits = full.length ? full : $$('.textLayer span.hit', el);
    const span = hits[Math.min(o.k, hits.length - 1)];
    if (span) {
      span.classList.add('hit-cur');
      const r = span.getBoundingClientRect(), sr = escroll.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) escroll.scrollTop += r.top - sr.top - escroll.clientHeight / 3;
    }
  };
  tryFocus();
}

function searchKey(e) {
  const term = e.target.value.trim();
  if (e.key === 'Enter') {
    e.preventDefault();
    if (term && term === S.searchTerm && S.occ?.length) gotoOcc(S.occIdx + (e.shiftKey ? -1 : 1));
    else runSearch(term);
  }
  if (e.key === 'Escape') { e.target.value = ''; runSearch(''); (E.open ? escroll : viewer).focus(); }
}
for (const id of ['#search', '#ed-search']) {
  $(id).addEventListener('keydown', searchKey);
  $(id).addEventListener('search', (e) => { if (!e.target.value) runSearch(''); });
}
for (const [id, d] of [['#search-prev', -1], ['#search-next', 1], ['#ed-search-prev', -1], ['#ed-search-next', 1]]) {
  $(id).onclick = () => gotoOcc(S.occIdx + d);
}

// ============================================================================
// Salvar PDF, exportar/importar FDF
// ============================================================================

const baseName = () => S.fileName.replace(/\.pdf$/i, '') || 'documento';

async function savePdf() {
  if (!S.pdf) return;
  if (!S.canWrite) {
    toast('Este PDF não pode ser regravado pelo aplicativo (protegido ou danificado). Use “Exportar FDF”.', true);
    return;
  }
  const name = `${baseName()}-comentado.pdf`;
  loadingBox({ name }, 'Salvando arquivo PDF…');
  try {
    progress(0.1, 'Lendo o documento original…');
    await nextPaint();
    const doc = await loadPdfLib(S.bytes.slice());
    progress(0.4, `Gravando ${S.annots.length} comentário(s)…`);
    await nextPaint();
    stripAnnotations(doc);
    await writeAnnotations(doc, S.annots);
    progress(0.65, 'Gerando o arquivo PDF…');
    await nextPaint();
    const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    progress(1, `Concluído (${fmtSize(out.length)})`);
    await nextPaint();
    download(out, name, 'application/pdf');
    setDirty(false);
    toast(`PDF salvo com ${S.annots.length} comentário(s): ${name}`);
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar o PDF: ' + e.message, true);
  } finally {
    progress(null);
    loadingBox(null);
  }
}

function exportFdfFile() {
  if (!S.pdf) return;
  const bytes = exportFDF(S.annots, { fileName: S.fileName, idHex: S.trailerId });
  download(bytes, `${baseName()}.fdf`, 'application/vnd.fdf');
  setDirty(false);
  toast(`${S.annots.length} comentário(s) exportado(s) para ${baseName()}.fdf`);
}

async function importFdfFile(file) {
  if (!S.pdf) { toast('Abra primeiro o PDF ao qual o FDF se refere.', true); return; }
  try {
    const { annots, fileName, warnings } = importFDF(new Uint8Array(await file.arrayBuffer()));
    const ok = annots.filter((a) => a.page >= 0 && a.page < S.n);
    const skipped = annots.length - ok.length;
    if (!ok.length) { toast('Nenhum comentário aplicável encontrado no FDF.' + (skipped ? ` (${skipped} fora do intervalo de páginas)` : ''), true); return; }
    let mode = 'merge';
    if (S.annots.length) {
      mode = await choose(`O FDF contém ${ok.length} comentário(s). O que fazer com os ${S.annots.length} comentário(s) atuais?`, [
        { label: 'Cancelar', value: 'cancel' }, { label: 'Substituir todos', value: 'replace' }, { label: 'Mesclar', value: 'merge', primary: true },
      ]);
      if (!mode || mode === 'cancel') return;
    }
    snapshot();
    if (mode === 'replace') S.annots = [];
    const byName = new Map(S.annots.map((a, k) => [a.name, k]));
    let replaced = 0;
    for (const a of ok) {
      if (byName.has(a.name)) { S.annots[byName.get(a.name)] = a; replaced++; } else S.annots.push(a);
    }
    S.groups = rebuildGroups(S.annots, mode === 'replace' ? [] : S.groups);
    setDirty(true);
    refreshAll();
    let msg = `${ok.length} comentário(s) importado(s)` + (replaced ? ` (${replaced} atualizados)` : '') + '.';
    if (skipped) msg += ` ${skipped} ignorado(s): página inexistente.`;
    toast(msg);
    const pdfName = (fileName || '').split(/[\\/]/).pop();
    if (pdfName && pdfName.toLowerCase() !== S.fileName.toLowerCase()) toast(`Atenção: o FDF foi gerado para “${pdfName}”.`);
    for (const w of warnings) toast(w);
  } catch (e) {
    console.error(e);
    toast('Erro ao importar FDF: ' + e.message, true);
  }
}

$('#open-pdf').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openPdf(f); };
$('#import-fdf').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFdfFile(f); };
$('#save-pdf').onclick = savePdf;
$('#export-fdf').onclick = exportFdfFile;
$('#zoom-in').onclick = () => setZoom(S.zoomIdx + 1);
$('#zoom-out').onclick = () => setZoom(S.zoomIdx - 1);
$('#zoom-range').max = ZOOMS.length - 1;
$('#zoom-range').oninput = (e) => setZoom(+e.target.value);
$('#author').onchange = (e) => settings.set('author', e.target.value.trim());
$('#help-btn').onclick = () => $('#help-dialog').showModal();

// Arrastar e soltar
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  for (const f of e.dataTransfer?.files || []) {
    if (/\.fdf$/i.test(f.name)) importFdfFile(f);
    else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { openPdf(f); break; }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { applyZoomVar(); schedulePump(); }, 150);
});

// ============================================================================
// Teclado
// ============================================================================

const TOOL_KEYS = { v: 'select', n: 'Text', t: 'FreeText', h: 'Highlight', u: 'Underline', k: 'StrikeOut', r: 'Square', e: 'Circle', d: 'Ink' };

document.addEventListener('keydown', (e) => {
  const tgt = e.target;
  const typing = tgt instanceof HTMLElement && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) && tgt.type !== 'checkbox';
  const mod = e.ctrlKey || e.metaKey;
  if (document.querySelector('dialog[open]')) return;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); savePdf(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#open-pdf').click(); return; }
  if (e.key === 'Escape') {
    if (typing) { tgt.blur(); return; }
    if (!pv.el.hidden) { hidePreview(); return; }
    if (E.open) { if (E.selId) { E.selId = null; renderEditorOverlay(); } else closeEditor(); return; }
    if (S.sel.size) selectPages([]);
    return;
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? restore(S.redo, S.undo) : restore(S.undo, S.redo); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(S.redo, S.undo); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); const f = $(E.open ? '#ed-search' : '#search'); f.focus(); f.select(); return; }
  if (e.key === 'F3') { e.preventDefault(); gotoOcc(S.occIdx + (e.shiftKey ? -1 : 1)); return; }
  if (e.key === 'F1' || e.key === '?') { e.preventDefault(); $('#help-dialog').showModal(); return; }
  if (!S.pdf) return;
  // Tamanho das páginas: < menor (cabem mais), > maior (cabem menos)
  const smaller = ['<', ',', '-', '_'].includes(e.key);
  const bigger = ['>', '.', '+', '='].includes(e.key);
  if ((smaller || bigger) && !mod) {
    e.preventDefault();
    if (E.open) zoomEditor(bigger ? 1.2 : 1 / 1.2);
    else setZoom(S.zoomIdx + (bigger ? 1 : -1));
    return;
  }
  if (E.open) {
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !mod)) { e.preventDefault(); gotoEditorPage(E.i + 1); return; }
    if (e.key === '0' && !mod) { e.preventDefault(); fitWholePage(); return; }
    if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !mod)) { e.preventDefault(); gotoEditorPage(E.i - 1); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && E.selId) { e.preventDefault(); deleteAnnot(E.selId); return; }
    if (!mod && TOOL_KEYS[e.key.toLowerCase()]) { setTool(TOOL_KEYS[e.key.toLowerCase()]); return; }
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectPages([...Array(S.n).keys()]); return; }
  if (!mod && e.key.toLowerCase() === 'm' && S.sel.size) { e.preventDefault(); openGroupDialog(); return; }
  if (!mod && e.key.toLowerCase() === 'l') {
    S.hoverZoom = !S.hoverZoom;
    $('#hover-zoom').checked = S.hoverZoom;
    settings.set('hoverZoom', S.hoverZoom);
    if (!S.hoverZoom) hidePreview();
    toast(S.hoverZoom ? 'Lupa ligada' : 'Lupa desligada', false, 1200);
  }
});

applyZoomVar();
setDirty(false);

// Quando aberto pelo PDFNotas.exe (servidor local): sinal de vida e PDF recebido na linha de comando
(async function launcherIntegration() {
  const token = new URLSearchParams(location.search).get('t');
  if (!/^https?:$/.test(location.protocol) || !token) return;
  const ping = () => fetch('/ping', { method: 'POST', keepalive: true }).catch(() => {});
  ping();
  setInterval(ping, 20000);
  document.addEventListener('visibilitychange', ping);
  try {
    const r = await fetch('/initial?t=' + encodeURIComponent(token));
    if (r.status !== 200) return;
    const name = decodeURIComponent(r.headers.get('X-File-Name') || 'documento.pdf');
    const file = new File([await r.arrayBuffer()], name, { type: 'application/pdf' });
    if (/\.fdf$/i.test(name)) toast('Abra o PDF e depois importe o FDF.', true);
    else openPdf(file);
  } catch (e) { console.warn(e); }
})();

// Exposto para testes automatizados
window.__pdfnotas = { pdfjsLib, DOC_OPTIONS, S, E, openPdf, importFdfFile, exportFdfFile, savePdf, applyGroup, setZoom };
