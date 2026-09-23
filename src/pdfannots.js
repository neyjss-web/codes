// Leitura, remoção e gravação de anotações diretamente no PDF, via pdf-lib.

import {
  PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFDict, PDFRef, PDFBool,
  StandardFonts,
} from 'pdf-lib';
import { annotEntries, annotFromAccessor } from './annotdict.js';
import { MANAGED_TYPES } from './model.js';

const MANAGED = new Set(MANAGED_TYPES);

export async function loadPdfLib(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new Error('PDF criptografado: comentários existentes não podem ser lidos/gravados.');
  return doc;
}

function toJs(ctx, v, depth = 0) {
  if (v instanceof PDFRef) v = ctx.lookup(v);
  if (v == null) return null;
  if (v instanceof PDFNumber) return v.asNumber();
  if (v instanceof PDFBool) return v.asBoolean();
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try { return v.decodeText(); } catch { return ''; }
  }
  if (v instanceof PDFName) return { name: v.decodeText() };
  if (v instanceof PDFArray) return depth > 3 ? [] : v.asArray().map((x) => toJs(ctx, x, depth + 1));
  if (v instanceof PDFDict) {
    const o = {};
    if (depth < 2) for (const [k, x] of v.entries()) o[k.decodeText()] = toJs(ctx, x, depth + 1);
    return o;
  }
  return null;
}

function annotsArray(ctx, pageNode) {
  const raw = pageNode.get(PDFName.of('Annots'));
  const arr = raw ? ctx.lookup(raw) : null;
  return arr instanceof PDFArray ? arr : null;
}

function subtypeOf(dict) {
  const st = dict.get(PDFName.of('Subtype'));
  return st instanceof PDFName ? st.decodeText() : null;
}

/** Lê as anotações gerenciadas de todas as páginas. */
export function readAnnotations(doc) {
  const ctx = doc.context;
  const out = [];
  const pages = doc.getPages();
  const refToNM = new Map();
  const pendingIRT = [];
  pages.forEach((page, pi) => {
    const arr = annotsArray(ctx, page.node);
    if (!arr) return;
    for (const item of arr.asArray()) {
      const dict = ctx.lookup(item);
      if (!(dict instanceof PDFDict)) continue;
      if (!MANAGED.has(subtypeOf(dict))) continue;
      const a = annotFromAccessor((k) => toJs(ctx, dict.get(PDFName.of(k))), pi);
      if (!a) continue;
      if (item instanceof PDFRef) refToNM.set(item.toString(), a.name);
      const irt = dict.get(PDFName.of('IRT'));
      if (irt instanceof PDFRef) pendingIRT.push([a, irt.toString()]);
      out.push(a);
    }
  });
  for (const [a, key] of pendingIRT) if (refToNM.has(key)) a.inReplyTo = refToNM.get(key);
  return out;
}

/** Remove as anotações gerenciadas (e seus pop-ups). Retorna quantas foram removidas. */
export function stripAnnotations(doc) {
  const ctx = doc.context;
  let removed = 0;
  for (const page of doc.getPages()) {
    const arr = annotsArray(ctx, page.node);
    if (!arr) continue;
    const keep = [];
    for (const item of arr.asArray()) {
      const dict = ctx.lookup(item);
      if (dict instanceof PDFDict) {
        const st = subtypeOf(dict);
        if (MANAGED.has(st)) { removed++; continue; }
        if (st === 'Popup') {
          const parent = ctx.lookup(dict.get(PDFName.of('Parent')));
          if (!(parent instanceof PDFDict) || MANAGED.has(subtypeOf(parent))) continue;
        }
      }
      keep.push(item);
    }
    if (keep.length) page.node.set(PDFName.of('Annots'), ctx.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  return removed;
}

function toPdfObj(ctx, v) {
  if (typeof v === 'number') return PDFNumber.of(Math.round(v * 1000) / 1000);
  if (typeof v === 'boolean') return v ? PDFBool.True : PDFBool.False;
  if (Array.isArray(v)) return ctx.obj(v.map((x) => toPdfObj(ctx, x)));
  if (v && typeof v === 'object') {
    if ('name' in v) return PDFName.of(v.name);
    if ('text' in v) return PDFHexString.fromText(v.text);
    if ('dict' in v) {
      const d = ctx.obj({});
      for (const [k, x] of v.dict) d.set(PDFName.of(k), toPdfObj(ctx, x));
      return d;
    }
    if ('pdf' in v) return v.pdf;
  }
  return ctx.obj(null);
}

// ---- Aparências (/AP) simples para que qualquer leitor exiba as marcações ----

const f = (n) => (Math.round(n * 1000) / 1000).toString();

function makeForm(ctx, bbox, content, resources) {
  const dict = { Type: 'XObject', Subtype: 'Form', BBox: bbox };
  if (resources) dict.Resources = resources;
  return ctx.register(ctx.stream(content, dict));
}

function gsResources(ctx, opacity, blend) {
  const gs = ctx.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, ...(blend ? { BM: blend } : {}) });
  return ctx.obj({ ExtGState: ctx.obj({ GS0: gs }) });
}

function buildAppearance(ctx, a, font) {
  const [x1, y1, x2, y2] = a.rect;
  const bbox = [x1, y1, x2, y2];
  const [r, g, b] = a.color || [1, 0.83, 0];
  const rgb = `${f(r)} ${f(g)} ${f(b)}`;
  const bw = a.borderWidth ?? 2;
  const op = a.opacity ?? 1;
  switch (a.type) {
    case 'Highlight': {
      const q = a.quadPoints;
      let s = `/GS0 gs ${rgb} rg\n`;
      for (let i = 0; i + 7 < q.length; i += 8) {
        s += `${f(q[i])} ${f(q[i + 1])} m ${f(q[i + 2])} ${f(q[i + 3])} l ${f(q[i + 6])} ${f(q[i + 7])} l ${f(q[i + 4])} ${f(q[i + 5])} l h f\n`;
      }
      return makeForm(ctx, bbox, s, gsResources(ctx, Math.min(op, 0.45), 'Multiply'));
    }
    case 'Underline': case 'StrikeOut': case 'Squiggly': {
      const q = a.quadPoints;
      let s = `${rgb} RG\n`;
      for (let i = 0; i + 7 < q.length; i += 8) {
        const h = Math.abs(q[i + 1] - q[i + 5]);
        const t = a.type === 'StrikeOut' ? 0.5 : 0.1;
        const lw = Math.max(0.6, h / 14);
        const ya = q[i + 5] + (q[i + 1] - q[i + 5]) * t, yb = q[i + 7] + (q[i + 3] - q[i + 7]) * t;
        const xa = q[i + 4] + (q[i] - q[i + 4]) * t, xb = q[i + 6] + (q[i + 2] - q[i + 6]) * t;
        s += `${f(lw)} w ${f(xa)} ${f(ya)} m ${f(xb)} ${f(yb)} l S\n`;
      }
      return makeForm(ctx, bbox, s, op < 1 ? gsResources(ctx, op) : null);
    }
    case 'Square': case 'Circle': {
      const h = bw / 2;
      const [rx1, ry1, rx2, ry2] = [x1 + h, y1 + h, x2 - h, y2 - h];
      let s = (op < 1 ? '/GS0 gs ' : '') + `${f(bw)} w ${rgb} RG\n`;
      const fill = a.interiorColor ? `${a.interiorColor.map(f).join(' ')} rg\n` : '';
      s += fill;
      if (a.type === 'Square') {
        s += `${f(rx1)} ${f(ry1)} ${f(rx2 - rx1)} ${f(ry2 - ry1)} re ${fill ? 'B' : 'S'}\n`;
      } else {
        const cx = (rx1 + rx2) / 2, cy = (ry1 + ry2) / 2, rx = (rx2 - rx1) / 2, ry = (ry2 - ry1) / 2, k = 0.5523;
        s += `${f(cx + rx)} ${f(cy)} m ` +
          `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ` +
          `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c ` +
          `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ` +
          `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c ${fill ? 'B' : 'S'}\n`;
      }
      return makeForm(ctx, bbox, s, op < 1 ? gsResources(ctx, op) : null);
    }
    case 'Ink': {
      let s = (op < 1 ? '/GS0 gs ' : '') + `${f(bw)} w 1 J 1 j ${rgb} RG\n`;
      for (const path of a.inkList || []) {
        if (path.length < 2) continue;
        s += `${f(path[0])} ${f(path[1])} m `;
        for (let i = 2; i + 1 < path.length; i += 2) s += `${f(path[i])} ${f(path[i + 1])} l `;
        if (path.length === 2) s += `${f(path[0] + 0.1)} ${f(path[1])} l `;
        s += 'S\n';
      }
      return makeForm(ctx, bbox, s, op < 1 ? gsResources(ctx, op) : null);
    }
    case 'Line': {
      const L = a.line || [x1, y1, x2, y2];
      const s = `${f(bw)} w 1 J ${rgb} RG ${f(L[0])} ${f(L[1])} m ${f(L[2])} ${f(L[3])} l S\n`;
      return makeForm(ctx, bbox, s, null);
    }
    case 'FreeText': {
      const fs = a.fontSize || 12;
      const pad = 2 + (a.borderWidth || 0);
      const width = x2 - x1 - pad * 2;
      const lines = wrapText(a.contents || '', font, fs, width);
      let s = '';
      if (a.interiorColor) s += `${a.interiorColor.map(f).join(' ')} rg ${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re f\n`;
      if (a.borderWidth) s += `${f(a.borderWidth)} w ${rgb} RG ${f(x1 + a.borderWidth / 2)} ${f(y1 + a.borderWidth / 2)} ${f(x2 - x1 - a.borderWidth)} ${f(y2 - y1 - a.borderWidth)} re S\n`;
      s += `q ${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re W n BT /Helv ${f(fs)} Tf ${rgb} rg\n`;
      let y = y2 - pad - fs * 0.9;
      s += `${f(x1 + pad)} ${f(y)} Td\n`;
      lines.forEach((ln, i) => {
        if (i) s += `0 ${f(-fs * 1.2)} Td\n`;
        s += `${font.encodeText(safeWinAnsi(ln)).toString()} Tj\n`;
      });
      s += 'ET Q\n';
      const res = ctx.obj({ Font: ctx.obj({ Helv: font.ref }) });
      return makeForm(ctx, bbox, s, res);
    }
  }
  return null;
}

function safeWinAnsi(s) {
  // Helvetica padrão usa WinAnsi: substitui caracteres fora do conjunto.
  return s.replace(/[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

function wrapText(text, font, fs, width) {
  const out = [];
  for (const para of String(text).split(/\r\n?|\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (line && font.widthOfTextAtSize(safeWinAnsi(test.trimEnd()), fs) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = test;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Grava as anotações do modelo no documento (depois de stripAnnotations).
 */
export async function writeAnnotations(doc, annots) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const nmToRef = new Map();
  const items = [];
  for (const a of annots) {
    const page = pages[a.page];
    if (!page) continue;
    const ref = ctx.nextRef();
    nmToRef.set(a.name, ref);
    items.push({ a, page, ref });
  }
  for (const { a, page, ref } of items) {
    const dict = ctx.obj({});
    for (const [k, v] of annotEntries(a)) dict.set(PDFName.of(k), toPdfObj(ctx, v));
    dict.set(PDFName.of('P'), page.ref);
    if (a.inReplyTo && nmToRef.has(a.inReplyTo)) {
      dict.set(PDFName.of('IRT'), nmToRef.get(a.inReplyTo));
    }
    if (a.type === 'FreeText') {
      // Garante /Helv nos recursos do AcroForm para leitores que regeneram a aparência
      ensureHelv(doc, font);
    }
    try {
      const ap = buildAppearance(ctx, a, font);
      if (ap) dict.set(PDFName.of('AP'), ctx.obj({ N: ap }));
    } catch (e) {
      console.warn('Falha ao gerar aparência', e);
    }
    ctx.assign(ref, dict);
    const refs = [ref];
    if (a.type === 'Text') {
      const [x1, , , y2] = a.rect;
      const popup = ctx.register(ctx.obj({
        Type: 'Annot', Subtype: 'Popup', Rect: [x1 + 30, y2 - 120, x1 + 230, y2], Open: false, Parent: ref, P: page.ref,
      }));
      dict.set(PDFName.of('Popup'), popup);
      refs.push(popup);
    }
    let arr = annotsArray(ctx, page.node);
    if (!arr) {
      arr = ctx.obj([]);
      page.node.set(PDFName.of('Annots'), arr);
    }
    for (const r of refs) arr.push(r);
  }
}

function ensureHelv(doc, font) {
  const ctx = doc.context;
  const catalog = doc.catalog;
  let acro = catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) return; // sem formulário: não é necessário
  let dr = acro.lookup(PDFName.of('DR'));
  if (!(dr instanceof PDFDict)) { dr = ctx.obj({}); acro.set(PDFName.of('DR'), dr); }
  let fonts = dr.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) { fonts = ctx.obj({}); dr.set(PDFName.of('Font'), fonts); }
  if (!fonts.get(PDFName.of('Helv'))) fonts.set(PDFName.of('Helv'), font.ref);
}

/** Retorna o /ID do trailer em hexadecimal, se existir. */
export function getTrailerId(doc) {
  try {
    const id = doc.context.trailerInfo.ID;
    const arr = id instanceof PDFRef ? doc.context.lookup(id) : id;
    if (!(arr instanceof PDFArray)) return null;
    return arr.asArray().map((x) => {
      if (x instanceof PDFHexString) return x.asString().toUpperCase();
      if (x instanceof PDFString) return [...x.asBytes()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      return '';
    });
  } catch { return null; }
}

/** Gera os bytes do PDF final com os comentários do modelo. */
export async function buildAnnotatedPdf(originalBytes, annots) {
  const doc = await loadPdfLib(originalBytes);
  stripAnnotations(doc);
  await writeAnnotations(doc, annots);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
