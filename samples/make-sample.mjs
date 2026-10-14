// Gera samples/exemplo.pdf: processo fictício com 40 páginas de texto e alguns comentários.
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { buildAnnotatedPdf } from '../src/pdfannots.js';
import { finalizeImported } from '../src/model.js';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.TimesRoman);
const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
const secoes = [[1, 6, 'PETIÇÃO INICIAL'], [7, 14, 'DOCUMENTOS DO AUTOR'], [15, 24, 'CONTESTAÇÃO'], [25, 32, 'DOCUMENTOS DO RÉU'], [33, 40, 'RÉPLICA']];
for (let i = 1; i <= 40; i++) {
  const land = i === 20;
  const page = doc.addPage(land ? [842, 595] : [595, 842]);
  const { width, height } = page.getSize();
  const sec = secoes.find(([a, b]) => i >= a && i <= b)[2];
  page.drawText(sec, { x: 60, y: height - 80, size: 20, font: bold });
  page.drawText(`Processo nº 0001234-56.2025.8.26.0100 — fls. ${i}`, { x: 60, y: height - 105, size: 11, font });
  let y = height - 150;
  const par = `Trata-se de ação de cobrança em que a parte autora alega inadimplemento contratual. Página ${i}. ` +
    'Os fatos narrados demonstram a existência de relação jurídica entre as partes, cabendo a análise das provas documentais juntadas aos autos.';
  const words = par.split(' ');
  for (let r = 0; r < 3; r++) {
    let line = '';
    for (const w of words) {
      if (font.widthOfTextAtSize(line + w, 12) > width - 120) { page.drawText(line, { x: 60, y, size: 12, font }); y -= 18; line = ''; }
      line += w + ' ';
    }
    page.drawText(line, { x: 60, y, size: 12, font }); y -= 30;
  }
  page.drawRectangle({ x: 60, y: 80, width: width - 120, height: 60, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  page.drawText('Assinado digitalmente', { x: 70, y: 105, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  // Rodapé no padrão do PJe: número do documento e página dentro dele
  const docNum = 2177293500 + secoes.findIndex(([a, b]) => i >= a && i <= b);
  const ini = secoes.find(([a, b]) => i >= a && i <= b)[0];
  page.drawText(`Num. ${docNum} - Pág. ${i - ini + 1}`, { x: width - 190, y: 40, size: 9, font });
}
doc.getPage(29).setRotation(degrees(90));

// Índice com hiperlinks na página 1: links internos para as seções e um link externo
const p1 = doc.getPage(0);
const links = [];
let ly = 380;
p1.drawText('ÍNDICE', { x: 60, y: ly + 30, size: 14, font: bold });
for (const [a, , nome] of secoes) {
  const txt = `${nome} ........ fls. ${a}`;
  p1.drawText(txt, { x: 60, y: ly, size: 12, font, color: rgb(0, 0, 0.7) });
  const w = font.widthOfTextAtSize(txt, 12);
  links.push(doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [58, ly - 3, 62 + w, ly + 12], Border: [0, 0, 0],
    Dest: [doc.getPage(a - 1).ref, PDFName.of('XYZ'), null, 842, null],
  })));
  ly -= 20;
}
p1.drawText('Consulta processual: https://www.cnj.jus.br', { x: 60, y: ly - 10, size: 12, font, color: rgb(0, 0, 0.7) });
links.push(doc.context.register(doc.context.obj({
  Type: 'Annot', Subtype: 'Link', Rect: [58, ly - 13, 62 + font.widthOfTextAtSize('Consulta processual: https://www.cnj.jus.br', 12), ly + 2], Border: [0, 0, 0],
  A: { S: 'URI', URI: PDFString.of('https://www.cnj.jus.br') },
})));
p1.node.set(PDFName.of('Annots'), doc.context.obj(links));

// Marcadores (outline): uma entrada por seção; a Contestação tem subitens
const ctx = doc.context;
const outlinesRef = ctx.nextRef();
const dest = (pg) => [doc.getPage(pg - 1).ref, PDFName.of('XYZ'), null, null, null];
function addItems(parentRef, specs) {
  const refs = specs.map(() => ctx.nextRef());
  specs.forEach(([title, pg, kids], k) => {
    const d = { Title: PDFHexString.fromText(title), Parent: parentRef, Dest: dest(pg) };
    if (k > 0) d.Prev = refs[k - 1];
    if (k < specs.length - 1) d.Next = refs[k + 1];
    if (kids?.length) {
      const kr = addItems(refs[k], kids);
      d.First = kr[0]; d.Last = kr[kr.length - 1]; d.Count = -kids.length;
    }
    ctx.assign(refs[k], ctx.obj(d));
  });
  return refs;
}
const top = addItems(outlinesRef, [
  ['Petição inicial', 1], ['Documentos do autor', 7],
  ['Contestação', 15, [['Preliminares', 16], ['Mérito', 18], ['Pedidos', 23]]],
  ['Documentos do réu', 25], ['Réplica', 33],
]);
ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length }));
doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
const base = await doc.save();
const annots = [
  finalizeImported({ type: 'Text', page: 0, rect: [520, 760, 540, 780], contents: 'Verificar valor da causa.', author: 'Revisor', color: [1, 0.83, 0] }),
  finalizeImported({ type: 'Highlight', page: 2, rect: [60, 680, 400, 700], quadPoints: [60, 700, 400, 700, 60, 686, 400, 686], contents: 'Ponto central da inicial', author: 'Revisor' }),
];
writeFileSync(new URL('./exemplo.pdf', import.meta.url), await buildAnnotatedPdf(base, annots));
console.log('samples/exemplo.pdf gerado');
