// Modelo de dados das anotações (comentários) mantidas pelo aplicativo.
//
// Anotação:
// { id, page (0-based), type, rect:[x1,y1,x2,y2] (espaço do PDF), contents, author, subject,
//   color:[r,g,b] (0-1), interiorColor?, opacity, quadPoints?, inkList?, fontSize?, icon?,
//   name (NM), created (Date), modified (Date), group? (id do grupo), frame? (moldura do grupo),
//   inReplyTo? (NM da anotação pai) }
//
// Grupo (marcação única aplicada a várias páginas):
// { id, label, text, color, author, pages: number[] (derivado das anotações) }

export const MANAGED_TYPES = ['Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Square', 'Circle', 'Ink', 'Line'];

export const TYPE_LABELS = {
  Text: 'Nota', FreeText: 'Texto livre', Highlight: 'Realce', Underline: 'Sublinhado', StrikeOut: 'Tachado',
  Squiggly: 'Ondulado', Square: 'Retângulo', Circle: 'Elipse', Ink: 'Desenho', Line: 'Linha',
};

const GROUP_RE = /^grp-([A-Za-z0-9]+)-p(\d+)(-f)?$/;

let seq = 0;
export function uid(prefix = 'a') {
  seq = (seq + 1) % 1e6;
  return prefix + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function normRect(r) {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

export function groupNM(groupId, page, frame) {
  return `grp-${groupId}-p${page + 1}${frame ? '-f' : ''}`;
}

export function parseGroupNM(nm) {
  const m = GROUP_RE.exec(nm || '');
  return m ? { groupId: m[1], page: +m[2] - 1, frame: !!m[3] } : null;
}

export function toPdfDate(d) {
  d = d instanceof Date && !isNaN(d) ? d : new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}'${p(a % 60)}'`;
}

export function fromPdfDate(s) {
  if (!s) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(s.trim());
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', tz, th = '00', tm = '00'] = m;
  let ms = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
  if (tz === '+' || tz === '-') ms -= (tz === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
  else if (!tz) return new Date(+Y, +Mo - 1, +D, +H, +Mi, +S);
  return new Date(ms);
}

// Converte cor PDF (0, 1, 3 ou 4 componentes) para RGB.
export function pdfColorToRgb(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr.map((n) => Math.max(0, Math.min(1, +n || 0)));
  if (v.length === 1) return [v[0], v[0], v[0]];
  if (v.length === 3) return v;
  if (v.length === 4) {
    const [c, m, y, k] = v;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return null;
}

export function rgbToHex(c) {
  if (!c) return '#ffd400';
  return '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 0.83, 0];
}

export function rgbCss(c, alpha = 1) {
  const [r, g, b] = (c || [1, 0.83, 0]).map((x) => Math.round(x * 255));
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

// Normaliza uma anotação vinda de PDF/FDF e reconstrói grupos pelo NM.
export function finalizeImported(annot) {
  annot.id = annot.id || uid();
  annot.rect = normRect(annot.rect || [0, 0, 20, 20]);
  annot.contents = annot.contents || '';
  annot.author = annot.author || '';
  annot.subject = annot.subject || '';
  annot.color = annot.color || defaultColor(annot.type);
  annot.opacity = annot.opacity ?? 1;
  annot.created = annot.created || new Date();
  annot.modified = annot.modified || annot.created;
  if (!annot.name) annot.name = annot.id;
  const g = parseGroupNM(annot.name);
  if (g) { annot.group = g.groupId; annot.frame = g.frame; }
  return annot;
}

export function defaultColor(type) {
  switch (type) {
    case 'Highlight': return [1, 0.87, 0];
    case 'Underline': return [0, 0.5, 0];
    case 'StrikeOut': return [0.85, 0, 0];
    case 'FreeText': return [0, 0, 0];
    case 'Text': return [1, 0.83, 0];
    default: return [0.9, 0.1, 0.1];
  }
}

// Reconstrói a tabela de grupos a partir das anotações (útil após importação).
export function rebuildGroups(annots, groups) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const a of annots) {
    if (!a.group) continue;
    let g = byId.get(a.group);
    if (!g) {
      g = { id: a.group, label: '', text: '', color: a.color, author: a.author };
      byId.set(a.group, g);
    }
    if (!a.frame) {
      if (!g.label && a.subject) g.label = a.subject;
      if (!g.text && a.contents) g.text = a.contents;
      g.color = a.color || g.color;
      g.author = g.author || a.author;
    }
  }
  const out = [];
  for (const g of byId.values()) {
    g.pages = [...new Set(annots.filter((a) => a.group === g.id).map((a) => a.page))].sort((x, y) => x - y);
    if (g.pages.length) out.push(g);
  }
  return out;
}

// "1-3, 7, 10-12" -> [0,1,2,6,9,10,11] (0-based), limitado a numPages
export function parsePageRanges(str, numPages) {
  const out = new Set();
  for (const part of String(str).split(/[,;\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)?\s*[-–]\s*(\d+)?$/.exec(part);
    if (m) {
      let a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : numPages;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(numPages, b); i++) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = +part;
      if (n >= 1 && n <= numPages) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// [0,1,2,6,9,10,11] -> "1–3, 7, 10–12"
export function formatPageRanges(pages) {
  const s = [...pages].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i] + 1}–${s[j] + 1}` : `${s[i] + 1}`);
    i = j;
  }
  return parts.join(', ');
}
