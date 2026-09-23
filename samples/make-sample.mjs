// Gera samples/exemplo.pdf: processo fictício com 40 páginas de texto e alguns comentários.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
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
}
doc.getPage(29).setRotation(degrees(90));
const base = await doc.save();
const annots = [
  finalizeImported({ type: 'Text', page: 0, rect: [520, 760, 540, 780], contents: 'Verificar valor da causa.', author: 'Revisor', color: [1, 0.83, 0] }),
  finalizeImported({ type: 'Highlight', page: 2, rect: [60, 680, 400, 700], quadPoints: [60, 700, 400, 700, 60, 686, 400, 686], contents: 'Ponto central da inicial', author: 'Revisor' }),
];
writeFileSync(new URL('./exemplo.pdf', import.meta.url), await buildAnnotatedPdf(base, annots));
console.log('samples/exemplo.pdf gerado');
