import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { exportFDF, importFDF } from '../src/fdf.js';
import { buildAnnotatedPdf, loadPdfLib, readAnnotations, stripAnnotations } from '../src/pdfannots.js';
import { runsToPlain, normalizeRuns, rcToRuns, rcHasOtherFormatting } from '../src/richtext.js';
import { finalizeImported, groupNM, rebuildGroups, parsePageRanges, formatPageRanges, findNumPag } from '../src/model.js';

function sample() {
  const g = 'g1abc';
  return [
    finalizeImported({ type: 'Text', page: 0, rect: [10, 700, 30, 720], contents: 'Contestação — fls. 12 ção', author: 'Ana', subject: 'Nota' }),
    finalizeImported({ type: 'Highlight', page: 1, rect: [50, 500, 200, 515], quadPoints: [50, 515, 200, 515, 50, 500, 200, 500], contents: 'importante (ver)' }),
    finalizeImported({ type: 'FreeText', page: 1, rect: [50, 300, 250, 360], contents: 'Texto livre ç\nsegunda linha', fontSize: 11, color: [0, 0, 1] }),
    finalizeImported({ type: 'Square', page: 2, rect: [5, 5, 100, 100], color: [1, 0, 0] }),
    finalizeImported({ type: 'Ink', page: 2, rect: [0, 0, 60, 60], inkList: [[1, 1, 20, 30, 50, 50]] }),
    finalizeImported({ type: 'Text', page: 0, rect: [10, 10, 30, 30], contents: 'Documentos', subject: 'DOCS', name: groupNM(g, 0) }),
    finalizeImported({ type: 'Text', page: 2, rect: [10, 10, 30, 30], contents: 'Documentos', subject: 'DOCS', name: groupNM(g, 2) }),
    finalizeImported({ type: 'Square', page: 2, rect: [2, 2, 610, 790], contents: 'Documentos', subject: 'DOCS', name: groupNM(g, 2, true) }),
  ];
}

function same(a, b) {
  assert.equal(b.type, a.type);
  assert.equal(b.page, a.page);
  assert.equal(b.contents, a.contents);
  assert.equal(b.author, a.author);
  assert.equal(b.name, a.name);
  assert.deepEqual(b.rect.map(Math.round), a.rect.map(Math.round));
}

test('FDF round trip', () => {
  const src = sample();
  const bytes = exportFDF(src, { fileName: 'processo.pdf', idHex: ['AABB', 'CCDD'] });
  const text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /^%FDF-1\.2/);
  const { annots, fileName } = importFDF(bytes);
  assert.equal(fileName, 'processo.pdf');
  assert.equal(annots.length, src.length);
  annots.forEach((a, i) => same(src[i], a));
  assert.deepEqual(annots[1].quadPoints, src[1].quadPoints);
  assert.deepEqual(annots[4].inkList, src[4].inkList);
  assert.equal(annots[2].fontSize, 11);
  const groups = rebuildGroups(annots, []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'DOCS');
  assert.deepEqual(groups[0].pages, [0, 2]);
});

test('importa FDF no estilo Acrobat', () => {
  const fdf = `%FDF-1.2
%\xe2\xe3\xcf\xd3
1 0 obj
<</FDF<</Annots[2 0 R 3 0 R]/F(/C/docs/a.pdf)/ID[<1A2B><3C4D>]/UF(/C/docs/a.pdf)>>/Type/Catalog>>
endobj
2 0 obj
<</C[1.0 1.0 0.0]/Contents(Linha 1\\rLinha \\(2\\) \\351)/CreationDate(D:20240102030405-03'00')/F 4/M(D:20240102030405-03'00')/NM(abc-123)/Name/Comment/Page 3/Popup 3 0 R/Rect[100 200 120 220]/Subj(Note)/Subtype/Text/T(Fulano)/Type/Annot>>
endobj
3 0 obj
<</F 28/Open false/Page 3/Parent 2 0 R/Rect[120 100 300 220]/Subtype/Popup/Type/Annot>>
endobj
4 0 obj
<</Length 10>>stream
0123456789
endstream
endobj
trailer
<</Root 1 0 R>>
%%EOF
`;
  const bytes = Uint8Array.from(fdf, (c) => c.charCodeAt(0));
  const { annots, fileName } = importFDF(bytes);
  assert.equal(fileName, '/C/docs/a.pdf');
  assert.equal(annots.length, 1);
  assert.equal(annots[0].contents, 'Linha 1\rLinha (2) é');
  assert.equal(annots[0].page, 3);
  assert.equal(annots[0].author, 'Fulano');
  assert.equal(annots[0].created.toISOString(), '2024-01-02T06:04:05.000Z');
});

test('grava e relê comentários no PDF', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([612, 792]);
  const base = await doc.save();
  const src = sample();
  const out = await buildAnnotatedPdf(base, src);
  const back = readAnnotations(await loadPdfLib(out));
  assert.equal(back.length, src.length);
  back.sort((a, b) => a.page - b.page || a.name.localeCompare(b.name));
  const exp = [...src].sort((a, b) => a.page - b.page || a.name.localeCompare(b.name));
  back.forEach((a, i) => same(exp[i], a));
  // Regravar não duplica
  const again = await buildAnnotatedPdf(out, back);
  const doc2 = await loadPdfLib(again);
  assert.equal(readAnnotations(doc2).length, src.length);
  assert.equal(stripAnnotations(doc2), src.length);
  assert.equal(readAnnotations(doc2).length, 0);
});

test('intervalos de páginas', () => {
  assert.deepEqual(parsePageRanges('1-3, 7; 10-', 12), [0, 1, 2, 6, 9, 10, 11]);
  assert.equal(formatPageRanges([0, 1, 2, 6, 9, 10, 11]), '1–3, 7, 10–12');
});

test('vínculo Num./Pág. viaja no /NM (FDF e PDF) e não quebra grupos', async () => {
  const src = [
    finalizeImported({ type: 'Text', page: 16, rect: [10, 10, 30, 30], contents: 'nota', name: 'abc123', anchor: { num: '2177293502', pag: 3 } }),
    finalizeImported({ type: 'Square', page: 16, rect: [2, 2, 500, 700], contents: 'g', name: groupNM('g1', 16, true), anchor: { num: '2177293502', pag: 3 } }),
    finalizeImported({ type: 'Text', page: 1, rect: [10, 10, 30, 30], contents: 'sem vínculo', name: 'semvinc' }),
  ];
  const fdfText = new TextDecoder('latin1').decode(exportFDF(src));
  assert.match(fdfText, /\/NM \(abc123;num=2177293502;pag=3\)/);
  const { annots } = importFDF(exportFDF(src));
  assert.deepEqual(annots[0].anchor, { num: '2177293502', pag: 3 });
  assert.equal(annots[0].name, 'abc123');
  assert.equal(annots[1].group, 'g1');
  assert.equal(annots[1].frame, true);
  assert.deepEqual(annots[1].anchor, { num: '2177293502', pag: 3 });
  assert.equal(annots[2].anchor, undefined);
  // PDF
  const doc = await PDFDocument.create();
  for (let i = 0; i < 20; i++) doc.addPage([612, 792]);
  const back = readAnnotations(await loadPdfLib(await buildAnnotatedPdf(await doc.save(), src)));
  const n = back.find((a) => a.name === 'abc123');
  assert.deepEqual(n.anchor, { num: '2177293502', pag: 3 });
});

test('findNumPag lê o rodapé do PJe', () => {
  assert.deepEqual(findNumPag('blá Num. 2177293507 - Pág. 12 fim'), { num: '2177293507', pag: 12 });
  assert.deepEqual(findNumPag('Num. 834877049 – Pag. 1'), { num: '834877049', pag: 1 });
  assert.equal(findNumPag('sem rodapé'), null);
});

test('texto rico: negrito e vermelho no /RC (FDF e PDF) e leitura do RC do Acrobat', async () => {
  const runs = [{ t: 'Despacho de ', b: false, r: false }, { t: 'intimação', b: true, r: false }, { t: ' das executadas\nprazo ', b: false, r: false }, { t: '15 dias', b: true, r: true }];
  const a = finalizeImported({ type: 'Text', page: 0, rect: [10, 10, 30, 30], contents: runsToPlain(runs), runs, name: 'rc1' });
  const fdfText = new TextDecoder('latin1').decode(exportFDF([a]));
  assert.match(fdfText, /\/RC /);
  const back = importFDF(exportFDF([a])).annots[0];
  assert.equal(back.contents, 'Despacho de intimação das executadas\nprazo 15 dias');
  assert.deepEqual(back.runs, normalizeRuns(runs));
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const fromPdf = readAnnotations(await loadPdfLib(await buildAnnotatedPdf(await doc.save(), [a])))[0];
  assert.deepEqual(fromPdf.runs, normalizeRuns(runs));
  // RC no estilo do Acrobat: itálico e fonte são descartados; negrito e vermelho mantidos
  const acro = '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" style="font-size:12pt;color:#000000"><p dir="ltr"><span style="font-style:italic;font-family:Times">Olá </span><span style="font-weight:bold">mundo</span></p><p><span style="color:#FF0000">vermelho &amp; fim</span></p></body>';
  assert.deepEqual(rcToRuns(acro), [{ t: 'Olá ', b: false, r: false }, { t: 'mundo', b: true, r: false }, { t: '\n', b: false, r: false }, { t: 'vermelho & fim', b: false, r: true }]);
  // sem formatação útil: não grava /RC
  const plain = finalizeImported({ type: 'Text', page: 0, rect: [0, 0, 20, 20], contents: 'simples', name: 'p1' });
  assert.doesNotMatch(new TextDecoder('latin1').decode(exportFDF([plain])), /\/RC /);
});

test('detecta formatação além de negrito/vermelho no /RC', () => {
  const base = (inner) => `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" style="font-size:10.0pt;font-family:Helvetica;color:#000000"><p dir="ltr">${inner}</p></body>`;
  assert.equal(rcHasOtherFormatting(base('<span style="font-weight:bold">a</span><span style="color:#FF0000">b</span>')), false);
  assert.equal(rcHasOtherFormatting(base('<span style="font-style:italic">a</span>')), true);
  assert.equal(rcHasOtherFormatting(base('<i>a</i>')), true);
  assert.equal(rcHasOtherFormatting(base('<span style="font-family:Times">a</span>')), true);
  assert.equal(rcHasOtherFormatting(base('<span style="color:#0000FF">a</span>')), true);
});
