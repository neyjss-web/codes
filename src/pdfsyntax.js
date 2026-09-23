// Leitura e escrita mínimas da sintaxe de objetos PDF, usadas pelo módulo FDF.
// Os dados são tratados como "string binária" (cada caractere = 1 byte).

export class PdfName {
  constructor(name) { this.name = name; }
}
export class PdfRef {
  constructor(num, gen) { this.num = num; this.gen = gen; }
  get key() { return `${this.num} ${this.gen}`; }
}
export class PdfStr {
  // bytes: string binária com os bytes crus da string PDF
  constructor(bytes) { this.bytes = bytes; }
  get text() { return decodePdfText(this.bytes); }
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

// PDFDocEncoding: diferenças em relação ao Latin-1 na faixa 0x18-0x1F e 0x80-0xA0
const PDFDOC_HIGH = {
  0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
  0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
  0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
  0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
};

export function decodePdfText(bytes) {
  if (bytes.length >= 2 && bytes.charCodeAt(0) === 0xfe && bytes.charCodeAt(1) === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
    }
    return out;
  }
  if (bytes.length >= 3 && bytes.startsWith('\xef\xbb\xbf')) {
    const arr = new Uint8Array(bytes.length - 3);
    for (let i = 3; i < bytes.length; i++) arr[i - 3] = bytes.charCodeAt(i);
    return new TextDecoder('utf-8').decode(arr);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.charCodeAt(i);
    out += String.fromCharCode(PDFDOC_HIGH[c] ?? c);
  }
  return out;
}

// Codifica texto como string PDF: literal se for ASCII imprimível, senão hex UTF-16BE com BOM.
export function encodePdfText(text) {
  text = String(text ?? '');
  if (/^[\x20-\x7e\r\n\t]*$/.test(text)) {
    return '(' + text.replace(/[\\()]/g, (c) => '\\' + c).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + ')';
  }
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}

export function encodeName(name) {
  return '/' + name.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export class Lexer {
  constructor(data, pos = 0) { this.s = data; this.pos = pos; }

  skipWs() {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (WS.has(c)) { this.pos++; continue; }
      if (c === 0x25) { // % comentário
        while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
        continue;
      }
      break;
    }
  }

  // Retorna o próximo token: {t:'num'|'kw'|'name'|'str'|'punct', v}
  next() {
    this.skipWs();
    const s = this.s;
    if (this.pos >= s.length) return null;
    const ch = s[this.pos];
    if (ch === '/') {
      this.pos++;
      let name = '';
      while (this.pos < s.length) {
        const c = s.charCodeAt(this.pos);
        if (WS.has(c) || DELIM.has(c)) break;
        if (c === 0x23 && /^[0-9a-fA-F]{2}$/.test(s.substr(this.pos + 1, 2))) {
          name += String.fromCharCode(parseInt(s.substr(this.pos + 1, 2), 16));
          this.pos += 3;
        } else { name += s[this.pos++]; }
      }
      return { t: 'name', v: name };
    }
    if (ch === '(') return { t: 'str', v: this.readLiteral() };
    if (ch === '<') {
      if (s[this.pos + 1] === '<') { this.pos += 2; return { t: 'punct', v: '<<' }; }
      this.pos++;
      const end = s.indexOf('>', this.pos);
      let hex = s.slice(this.pos, end < 0 ? s.length : end).replace(/[^0-9a-fA-F]/g, '');
      this.pos = end < 0 ? s.length : end + 1;
      if (hex.length % 2) hex += '0';
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return { t: 'str', v: out };
    }
    if (ch === '>' && s[this.pos + 1] === '>') { this.pos += 2; return { t: 'punct', v: '>>' }; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '>' || ch === ')') {
      this.pos++;
      return { t: 'punct', v: ch };
    }
    let word = '';
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (WS.has(c) || DELIM.has(c)) break;
      word += s[this.pos++];
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    return { t: 'kw', v: word };
  }

  readLiteral() {
    const s = this.s;
    this.pos++; // (
    let depth = 1, out = '';
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === '\\') {
        const n = s[this.pos++];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (n in map) out += map[n];
        else if (n === '\r') { if (s[this.pos] === '\n') this.pos++; }
        else if (n === '\n') { /* continuação de linha */ }
        else if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(s[this.pos])) oct += s[this.pos++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n !== undefined) out += n;
      } else if (ch === '(') { depth++; out += ch; }
      else if (ch === ')') { if (--depth === 0) break; out += ch; }
      else out += ch;
    }
    return out;
  }
}

// Parser de objetos com suporte a "n g R", "n g obj ... endobj" e streams (ignorados).
export class Parser {
  constructor(data) {
    this.lex = new Lexer(data);
    this.buf = [];
  }
  peek(i = 0) {
    while (this.buf.length <= i) this.buf.push(this.lex.next());
    return this.buf[i];
  }
  take() { this.peek(); return this.buf.shift(); }

  parseValue() {
    const tok = this.take();
    if (!tok) return null;
    switch (tok.t) {
      case 'num': {
        const a = this.peek(0), b = this.peek(1);
        if (Number.isInteger(tok.v) && a && a.t === 'num' && Number.isInteger(a.v) && b && b.t === 'kw' && b.v === 'R') {
          this.take(); this.take();
          return new PdfRef(tok.v, a.v);
        }
        return tok.v;
      }
      case 'name': return new PdfName(tok.v);
      case 'str': return new PdfStr(tok.v);
      case 'punct':
        if (tok.v === '[') {
          const arr = [];
          while (this.peek() && !(this.peek().t === 'punct' && this.peek().v === ']')) arr.push(this.parseValue());
          this.take();
          return arr;
        }
        if (tok.v === '<<') {
          const dict = new Map();
          while (this.peek() && !(this.peek().t === 'punct' && this.peek().v === '>>')) {
            const k = this.take();
            if (!k || k.t !== 'name') continue;
            dict.set(k.v, this.parseValue());
          }
          this.take();
          return dict;
        }
        return null;
      case 'kw':
        if (tok.v === 'true') return true;
        if (tok.v === 'false') return false;
        return null;
      default: return null;
    }
  }
}

// Lê todos os objetos indiretos e o trailer de um arquivo PDF/FDF (sem depender da xref).
export function parseObjects(data) {
  const objects = new Map();
  let trailer = null;
  const re = /(\d+)\s+(\d+)\s+obj\b|trailer\b/g;
  let m;
  while ((m = re.exec(data))) {
    const p = new Parser(data);
    p.lex.pos = m.index + m[0].length;
    const value = p.parseValue();
    if (m[0].startsWith('trailer')) {
      if (value instanceof Map) trailer = value;
      continue;
    }
    objects.set(`${m[1]} ${m[2]}`, value);
    // Pula o conteúdo de streams para não interpretar dados binários como objetos.
    const after = p.buf.length ? null : p.lex.pos;
    let pos = after ?? p.lex.pos;
    const rest = data.slice(pos, pos + 32);
    const sm = /^\s*stream\r?\n/.exec(rest);
    if (sm) {
      let len = value instanceof Map ? value.get('Length') : null;
      let start = pos + sm[0].length;
      let end = typeof len === 'number' ? start + len : -1;
      if (end < 0 || data.slice(end, end + 40).indexOf('endstream') < 0) end = data.indexOf('endstream', start);
      if (end < 0) break;
      re.lastIndex = end;
    } else {
      re.lastIndex = Math.max(re.lastIndex, pos);
    }
  }
  return { objects, trailer };
}

export function bytesToBinaryString(u8) {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return out;
}

export function binaryStringToBytes(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}
