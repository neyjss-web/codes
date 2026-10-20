// Trabalho pesado com o pdf-lib numa linha de execução separada (Web Worker): ler e gravar os
// comentários do PDF sem travar a tela. Gerado como script à parte e embutido no YayNotes.html.
// O worker guarda a sua própria cópia do PDF aberto e, quando possível, grava o arquivo ele mesmo:
// assim a tela não precisa copiar o arquivo (dezenas de MB) a cada gravação.
import { loadPdfLib, readAnnotations, stripAnnotations, getTrailerId, buildAnnotatedPdf } from './pdfannots.js';

let cur = null; // { doc, bytes }: PDF de trabalho do documento aberto

async function writeOut(target, out) {
  if (target.kind === 'handle') {
    const w = await target.handle.createWritable();
    await w.write(out);
    await w.close();
  } else if (target.kind === 'launcher') {
    const r = await fetch(target.url, { method: 'POST', body: out });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  } else {
    throw new Error('destino não suportado');
  }
}

self.onmessage = async (e) => {
  const { id, op, doc, bytes, annots, target } = e.data;
  try {
    if (op === 'read') {
      // comentários existentes + cópia do PDF sem eles (exibida; os comentários são desenhados pelo app)
      cur = { doc, bytes };
      const pdf = await loadPdfLib(bytes.slice());
      const list = readAnnotations(pdf);
      const trailerId = getTrailerId(pdf);
      let display = null;
      if (list.length) {
        stripAnnotations(pdf);
        display = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
      }
      self.postMessage({ id, ok: true, annots: list, trailerId, display }, display ? [display.buffer] : []);
    } else if (op === 'save') {
      const src = bytes || (cur?.doc === doc ? cur.bytes : null);
      if (!src) throw new Error('nobytes');
      const out = await buildAnnotatedPdf(src.slice(), annots);
      let writeError = null;
      if (target) {
        try {
          await writeOut(target, out);
          cur = { doc, bytes: out };
          self.postMessage({ id, ok: true, written: true, size: out.length });
          return;
        } catch (err) { writeError = String(err?.message || err); }
      }
      // a tela grava (download, ou destino que o worker não conseguiu usar)
      cur = { doc, bytes: out.slice() };
      self.postMessage({ id, ok: true, written: false, writeError, out }, [out.buffer]);
    } else {
      throw new Error('operação desconhecida: ' + op);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
