// Texto dos comentários com formatação mínima: apenas negrito e vermelho.
// Representação: lista de trechos (runs) [{ t: texto, b: negrito?, r: vermelho? }], com '\n' para quebra de linha.
// No PDF/FDF a formatação vai no campo padrão /RC (rich text XHTML), lido também pelo Adobe Acrobat/Reader;
// o /Contents continua com o texto puro.

export const RED = '#D00000';

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Junta trechos vizinhos com o mesmo estilo e remove vazios
export function normalizeRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    if (!r || !r.t) continue;
    const b = !!r.b, red = !!r.r;
    const last = out[out.length - 1];
    if (last && last.b === b && last.r === red) last.t += r.t;
    else out.push({ t: r.t, b, r: red });
  }
  // sem quebras de linha sobrando no fim
  while (out.length && /\n$/.test(out[out.length - 1].t)) {
    out[out.length - 1].t = out[out.length - 1].t.replace(/\n+$/, '');
    if (!out[out.length - 1].t) out.pop();
  }
  return out;
}

export const runsToPlain = (runs) => (runs || []).map((r) => r.t).join('');
export const hasFormatting = (runs) => (runs || []).some((r) => r.b || r.r);

// HTML para exibição (somente <strong>, <span class="rc-red"> e <br>)
export function runsToHtml(runs, plain = '') {
  const list = runs && runs.length ? runs : [{ t: plain || '' }];
  return list.map((r) => {
    let h = escHtml(r.t).replace(/\n/g, '<br>');
    if (r.r) h = `<span class="rc-red">${h}</span>`;
    if (r.b) h = `<strong>${h}</strong>`;
    return h;
  }).join('');
}

// Converte o conteúdo de um elemento editável (contenteditable) em trechos, ignorando
// qualquer formatação que não seja negrito ou vermelho.
export function domToRuns(root) {
  const runs = [];
  const push = (t, b, r) => runs.push({ t, b, r });
  const lastChar = () => { const l = runs[runs.length - 1]; return l ? l.t.slice(-1) : ''; };
  const walk = (node, b, r) => {
    if (node.nodeType === 3) { push(node.nodeValue.replace(/ /g, ' '), b, r); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'BR') { push('\n', b, r); return; }
    const block = tag === 'DIV' || tag === 'P' || tag === 'LI';
    if (block && runs.length && lastChar() !== '\n') push('\n', b, r);
    let nb = b, nr = r;
    if (tag === 'B' || tag === 'STRONG') nb = true;
    const st = node.style || {};
    const fw = st.fontWeight;
    if (fw === 'bold' || +fw >= 600) nb = true;
    else if (fw === 'normal' || (fw && +fw < 600)) nb = false;
    const color = node.getAttribute?.('color') || st.color;
    if (color) nr = isRed(color);
    for (const c of node.childNodes) walk(c, nb, nr);
    if (block && runs.length && lastChar() !== '\n' && node.nextSibling) push('\n', nb, nr);
  };
  for (const c of root.childNodes) walk(c, false, false);
  return normalizeRuns(runs);
}

export function isRed(color) {
  const rgb = parseColor(color);
  return !!rgb && rgb[0] >= 150 && rgb[1] <= 90 && rgb[2] <= 90;
}

function parseColor(c) {
  c = String(c).trim().toLowerCase();
  if (c === 'red') return [255, 0, 0];
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return m[1].split('').map((x) => parseInt(x + x, 16));
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(c);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

// ---- /RC (XHTML do Acrobat) ----

const BODY_STYLE = 'font-size:10.0pt;text-align:left;color:#000000;font-weight:normal;font-style:normal;font-family:Helvetica,sans-serif;font-stretch:normal';

export function runsToRC(runs) {
  const paras = [[]];
  for (const r of runs) {
    const parts = r.t.split('\n');
    parts.forEach((p, k) => {
      if (k > 0) paras.push([]);
      if (p) paras[paras.length - 1].push({ ...r, t: p });
    });
  }
  const body = paras.map((p) => '<p dir="ltr">' + (p.length ? p.map((r) => {
    const st = [r.b ? 'font-weight:bold' : '', r.r ? `color:${RED}` : ''].filter(Boolean).join(';');
    return st ? `<span style="${st}">${escHtml(r.t)}</span>` : escHtml(r.t);
  }).join('') : '<br/>') + '</p>').join('');
  return '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" ' +
    `xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2" style="${BODY_STYLE}">${body}</body>`;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEnt = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENT[e.toLowerCase()] ?? m;
});

// Lê /RC (XHTML) mantendo só negrito e vermelho. Sem depender do DOM (funciona também no Node).
export function rcToRuns(xhtml) {
  if (!xhtml) return [];
  const s = String(xhtml).replace(/<\?xml[^>]*\?>/i, '');
  const runs = [];
  const stack = [{ b: false, r: false, tag: '' }];
  let seenPara = false;
  const re = /<(\/)?([a-zA-Z][\w:.-]*)([^>]*?)(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const cur = stack[stack.length - 1];
    if (m[5] != null) {
      const t = decodeEnt(m[5]).replace(/[\r\n\t]+/g, ' ');
      if (stack.length > 1 && t) runs.push({ t, b: cur.b, r: cur.r });
      continue;
    }
    const closing = !!m[1], tag = m[2].toLowerCase().replace(/^.*:/, ''), attrs = m[3] || '', selfClose = !!m[4];
    if (tag === 'br') { runs.push({ t: '\n', b: cur.b, r: cur.r }); continue; }
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    if ((tag === 'p' || tag === 'div') && seenPara) runs.push({ t: '\n', b: cur.b, r: cur.r });
    if (tag === 'p' || tag === 'div') seenPara = true;
    let b = cur.b, r = cur.r;
    if (tag === 'b' || tag === 'strong') b = true;
    const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs);
    const css = style ? (style[1] ?? style[2]) : '';
    const fw = /font-weight\s*:\s*([\w]+)/i.exec(css);
    if (fw) b = fw[1] === 'bold' || +fw[1] >= 600;
    const col = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(css);
    if (col && tag !== 'body') r = isRed(col[1]);
    if (!selfClose) stack.push({ b, r, tag });
  }
  return normalizeRuns(runs);
}

// O /RC tem formatação além de negrito/vermelho (itálico, sublinhado, outra fonte/tamanho/cor…)?
// Estilos padrão do <body>/<p> (fonte, tamanho e cor de base que o Acrobat sempre grava) não contam.
export function rcHasOtherFormatting(xhtml) {
  if (!xhtml) return false;
  const re = /<([a-zA-Z][\w:.-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(String(xhtml)))) {
    const tag = m[1].toLowerCase().replace(/^.*:/, '');
    if (['i', 'em', 'u', 's', 'strike', 'del', 'sup', 'sub', 'font', 'a', 'big', 'small'].includes(tag)) return true;
    if (tag === 'body' || tag === 'p' || tag === 'div') continue;
    const st = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(m[2]);
    if (!st) continue;
    for (const decl of (st[1] ?? st[2]).split(';')) {
      const [k, v = ''] = decl.split(':').map((x) => x.trim().toLowerCase());
      if (!k) continue;
      if (k === 'font-weight') continue;
      if (k === 'color') { if (isRed(v) || /^(#000(000)?|black|rgb\(0,\s*0,\s*0\))$/.test(v)) continue; return true; }
      if (k === 'font-style' && v === 'normal') continue;
      if (k === 'text-decoration' && v === 'none') continue;
      return true;
    }
  }
  return false;
}
