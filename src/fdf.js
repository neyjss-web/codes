// Exportação e importação de comentários no formato FDF (Forms Data Format, ISO 32000 §12.7.8).

import { annotEntries, annotFromAccessor } from './annotdict.js';
import {
  PdfName, PdfRef, PdfStr, parseObjects, encodePdfText, encodeName, fmtNum,
  bytesToBinaryString, binaryStringToBytes,
} from './pdfsyntax.js';

function serialize(v) {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(serialize).join(' ') + ']';
  if (v && typeof v === 'object') {
    if ('name' in v) return encodeName(v.name);
    if ('text' in v) return encodePdfText(v.text);
    if ('ref' in v) return `${v.ref} 0 R`;
    if ('raw' in v) return v.raw;
    if ('dict' in v) return '<< ' + v.dict.map(([k, x]) => `${encodeName(k)} ${serialize(x)}`).join(' ') + ' >>';
  }
  return 'null';
}

/**
 * Gera o conteúdo de um arquivo FDF com as anotações.
 * @param {object[]} annots anotações do modelo
 * @param {{fileName?: string, idHex?: string[]}} opts nome do PDF de origem e /ID do trailer
 * @returns {Uint8Array}
 */
export function exportFDF(annots, opts = {}) {
  const objs = [];
  const annotRefs = [];
  let next = 2;
  const nmToRef = new Map();
  const plan = annots.map((a) => {
    const ref = next++;
    const popup = a.type !== 'Popup' && ['Text'].includes(a.type) ? next++ : null;
    nmToRef.set(a.name, ref);
    return { a, ref, popup };
  });
  for (const { a, ref, popup } of plan) {
    const entries = annotEntries(a);
    entries.push(['Page', a.page]);
    if (popup) entries.push(['Popup', { ref: popup }]);
    if (a.inReplyTo && nmToRef.has(a.inReplyTo)) entries.push(['IRT', { ref: nmToRef.get(a.inReplyTo) }]);
    objs.push(`${ref} 0 obj\n<< ${entries.map(([k, v]) => `${encodeName(k)} ${serialize(v)}`).join('\n')} >>\nendobj\n`);
    annotRefs.push(ref);
    if (popup) {
      const [x1, , , y2] = a.rect;
      const pr = [x1 + 30, y2 - 120, x1 + 230, y2];
      objs.push(`${popup} 0 obj\n<< /Type /Annot /Subtype /Popup /Rect ${serialize(pr)} /Open false /Page ${a.page} /Parent ${ref} 0 R >>\nendobj\n`);
      annotRefs.push(popup);
    }
  }
  let fdfDict = `/Annots [${annotRefs.map((r) => `${r} 0 R`).join(' ')}]`;
  if (opts.fileName) fdfDict += ` /F ${encodePdfText(opts.fileName)}`;
  if (opts.idHex && opts.idHex.length === 2) fdfDict += ` /ID [<${opts.idHex[0]}> <${opts.idHex[1]}>]`;
  const head = '%FDF-1.2\n%\xe2\xe3\xcf\xd3\n';
  const root = `1 0 obj\n<< /FDF << ${fdfDict} >> /Type /Catalog >>\nendobj\n`;
  const body = head + root + objs.join('') + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  // Os textos não-ASCII já estão em hex (UTF-16BE); o restante é ASCII, exceto o cabeçalho binário.
  return binaryStringToBytes(body);
}

/**
 * Lê um arquivo FDF e devolve as anotações encontradas.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {{annots: object[], fileName: string|null, warnings: string[]}}
 */
export function importFDF(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const s = bytesToBinaryString(u8);
  const warnings = [];
  if (!/%FDF-|\/FDF\b/.test(s.slice(0, 4096)) && !/\/FDF\s*<</.test(s)) {
    if (/<\?xml|<xfdf/i.test(s.slice(0, 512))) throw new Error('Este arquivo parece ser XFDF (XML). Use um arquivo .fdf.');
    throw new Error('Arquivo não reconhecido como FDF.');
  }
  const { objects, trailer } = parseObjects(s);
  const resolve = (v, depth = 0) => (v instanceof PdfRef && depth < 32 ? resolve(objects.get(v.key), depth + 1) : v);

  // Localiza o catálogo com /FDF
  let catalog = trailer ? resolve(trailer.get('Root')) : null;
  if (!(catalog instanceof Map) || !catalog.get('FDF')) {
    catalog = [...objects.values()].find((o) => o instanceof Map && o.get('FDF'));
  }
  if (!catalog) throw new Error('Catálogo FDF não encontrado.');
  const fdf = resolve(catalog.get('FDF'));
  let fileName = null;
  const f = resolve(fdf.get('F'));
  if (f instanceof PdfStr) fileName = f.text;
  else if (f instanceof Map) {
    const uf = resolve(f.get('UF')) || resolve(f.get('F'));
    if (uf instanceof PdfStr) fileName = uf.text;
  }
  let list = resolve(fdf.get('Annots'));
  if (!Array.isArray(list)) {
    list = [];
    warnings.push('O FDF não contém comentários (/Annots).');
  }

  // Converte valor PDF para o formato esperado por annotFromAccessor
  const conv = (v, depth = 0) => {
    v = resolve(v);
    if (v instanceof PdfStr) return v.text;
    if (v instanceof PdfName) return { name: v.name };
    if (Array.isArray(v)) return depth > 3 ? [] : v.map((x) => conv(x, depth + 1));
    if (v instanceof Map) {
      const o = {};
      if (depth < 2) for (const [k, x] of v) o[k] = conv(x, depth + 1);
      return o;
    }
    return v;
  };

  const annots = [];
  const refToNM = new Map();
  const pendingIRT = [];
  for (const item of list) {
    const dict = resolve(item);
    if (!(dict instanceof Map)) continue;
    const pageVal = resolve(dict.get('Page'));
    const page = typeof pageVal === 'number' ? pageVal : 0;
    const a = annotFromAccessor((k) => conv(dict.get(k)), page);
    if (!a) {
      const st = resolve(dict.get('Subtype'));
      if (st instanceof PdfName && st.name !== 'Popup') warnings.push(`Tipo de anotação não suportado ignorado: ${st.name}`);
      continue;
    }
    if (item instanceof PdfRef) refToNM.set(item.key, a.name);
    const irt = dict.get('IRT');
    if (irt instanceof PdfRef) pendingIRT.push([a, irt.key]);
    annots.push(a);
  }
  for (const [a, key] of pendingIRT) if (refToNM.has(key)) a.inReplyTo = refToNM.get(key);
  return { annots, fileName, warnings: [...new Set(warnings)] };
}
