// Descrição neutra do dicionário de uma anotação, serializável tanto para FDF (texto)
// quanto para objetos pdf-lib. Valores: número, boolean, {name}, {text}, {date}, array.

import { toPdfDate, fromPdfDate, pdfColorToRgb, finalizeImported, MANAGED_TYPES, nmWithAnchor } from './model.js';

export const N = (name) => ({ name });
export const T = (text) => ({ text });

const ICONS = ['Comment', 'Key', 'Note', 'Help', 'NewParagraph', 'Paragraph', 'Insert'];

// Retorna lista de pares [chave, valor] (sem /P, /Page, /Popup, /IRT — tratados por quem serializa).
export function annotEntries(a) {
  const e = [
    ['Type', N('Annot')],
    ['Subtype', N(a.type)],
    ['Rect', a.rect.slice()],
    ['F', 4], // Print
    ['NM', T(nmWithAnchor(a))],
    ['M', T(toPdfDate(a.modified))],
    ['CreationDate', T(toPdfDate(a.created))],
    ['C', (a.color || [1, 0.83, 0]).slice()],
  ];
  if (a.contents) e.push(['Contents', T(a.contents)]);
  if (a.author) e.push(['T', T(a.author)]);
  if (a.subject) e.push(['Subj', T(a.subject)]);
  if (a.opacity != null && a.opacity < 1) e.push(['CA', a.opacity]);
  switch (a.type) {
    case 'Text':
      e.push(['Name', N(ICONS.includes(a.icon) ? a.icon : 'Comment')]);
      e.push(['Open', false]);
      break;
    case 'FreeText': {
      const fs = a.fontSize || 12;
      const [r, g, b] = a.color || [0, 0, 0];
      e.push(['DA', T(`/Helv ${fs} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)]);
      e.push(['Q', 0]);
      e.push(['BS', { dict: [['W', a.borderWidth ?? 0]] }]);
      // Em FreeText, /C é cor de fundo; mantemos transparente quando não há cor interna.
      e.splice(e.findIndex((x) => x[0] === 'C'), 1);
      if (a.interiorColor) e.push(['C', a.interiorColor.slice()]);
      break;
    }
    case 'Highlight': case 'Underline': case 'StrikeOut': case 'Squiggly':
      e.push(['QuadPoints', (a.quadPoints && a.quadPoints.length ? a.quadPoints : rectToQuad(a.rect)).slice()]);
      break;
    case 'Square': case 'Circle':
      e.push(['BS', { dict: [['W', a.borderWidth ?? 2]] }]);
      if (a.interiorColor) e.push(['IC', a.interiorColor.slice()]);
      break;
    case 'Ink':
      e.push(['InkList', (a.inkList || []).map((p) => p.slice())]);
      e.push(['BS', { dict: [['W', a.borderWidth ?? 2]] }]);
      break;
    case 'Line':
      e.push(['L', (a.line || [a.rect[0], a.rect[1], a.rect[2], a.rect[3]]).slice()]);
      e.push(['BS', { dict: [['W', a.borderWidth ?? 2]] }]);
      break;
  }
  return e;
}

export function rectToQuad(r) {
  const [x1, y1, x2, y2] = r;
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

export function quadsBBox(q) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i + 1 < q.length; i += 2) {
    x1 = Math.min(x1, q[i]); x2 = Math.max(x2, q[i]);
    y1 = Math.min(y1, q[i + 1]); y2 = Math.max(y2, q[i + 1]);
  }
  return [x1, y1, x2, y2];
}

// Constrói uma anotação do modelo a partir de um acessor genérico de dicionário.
// get(key) deve retornar: número, boolean, string (texto decodificado), {name}, array (valores já convertidos)
export function annotFromAccessor(get, page) {
  const subtype = get('Subtype')?.name;
  if (!MANAGED_TYPES.includes(subtype)) return null;
  const num = (v) => (typeof v === 'number' ? v : null);
  const nums = (v) => (Array.isArray(v) ? v.map((x) => +x || 0) : null);
  const a = {
    type: subtype,
    page,
    rect: nums(get('Rect')) || [0, 0, 20, 20],
    contents: str(get('Contents')),
    author: str(get('T')),
    subject: str(get('Subj')),
    name: str(get('NM')),
    color: pdfColorToRgb(nums(get('C'))),
    opacity: num(get('CA')) ?? 1,
    created: fromPdfDate(str(get('CreationDate'))),
    modified: fromPdfDate(str(get('M'))),
  };
  const bs = get('BS');
  const bw = Array.isArray(bs) ? null : bs && typeof bs === 'object' && 'W' in bs ? bs.W : null;
  if (typeof bw === 'number') a.borderWidth = bw;
  const ic = pdfColorToRgb(nums(get('IC')));
  if (ic) a.interiorColor = ic;
  switch (subtype) {
    case 'Text': a.icon = get('Name')?.name || 'Comment'; break;
    case 'FreeText': {
      const da = str(get('DA'));
      const fm = /([\d.]+)\s+Tf/.exec(da);
      a.fontSize = fm ? +fm[1] || 12 : 12;
      const cm = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
      const gm = /([\d.]+)\s+g\b/.exec(da);
      a.interiorColor = a.color; // /C em FreeText é o fundo
      a.color = cm ? [+cm[1], +cm[2], +cm[3]] : gm ? [+gm[1], +gm[1], +gm[1]] : [0, 0, 0];
      if (!a.interiorColor) delete a.interiorColor;
      if (a.borderWidth == null) a.borderWidth = 0;
      break;
    }
    case 'Highlight': case 'Underline': case 'StrikeOut': case 'Squiggly': {
      const q = nums(get('QuadPoints'));
      a.quadPoints = q && q.length >= 8 ? q : rectToQuad(a.rect);
      break;
    }
    case 'Ink': {
      const il = get('InkList');
      a.inkList = Array.isArray(il) ? il.filter(Array.isArray).map((p) => p.map((x) => +x || 0)) : [];
      break;
    }
    case 'Line': a.line = nums(get('L')); break;
  }
  return finalizeImported(a);
}

function str(v) {
  return typeof v === 'string' ? v : '';
}
