// Teste: "Salvar PDF" grava os comentários DENTRO do arquivo aberto e "Salvar FDF" usa a janela
// "Salvar como", sem nenhum download do navegador (o painel de downloads tem opção de excluir o arquivo).
// A File System Access API é simulada em memória (o Chromium de teste não mostra janelas).
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { loadPdfLib, readAnnotations } from '../src/pdfannots.js';

const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
let downloads = 0;
page.on('download', () => downloads++);
await page.addInitScript(() => {
  window.__files = {};
  window.__pickerLog = [];
  const handle = (name) => ({
    kind: 'file', name,
    async getFile() { return new File([window.__files[name] || new Uint8Array()], name); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async createWritable() {
      const parts = [];
      return { async write(d) { parts.push(new Uint8Array(await new Blob([d]).arrayBuffer())); }, async close() { window.__files[name] = new Uint8Array(await new Blob(parts).arrayBuffer()); } };
    },
  });
  window.showOpenFilePicker = async () => [handle('exemplo.pdf')];
  window.showSaveFilePicker = async (o) => { window.__pickerLog.push({ suggestedName: o.suggestedName, startIn: o.startIn?.name || null }); return handle(o.suggestedName); };
});
await page.goto(pathToFileURL(resolve('dist/YayNotes.html')).href);
const pdf = readFileSync('samples/exemplo.pdf');
await page.evaluate((b64) => { window.__files['exemplo.pdf'] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }, pdf.toString('base64'));
await page.click('#open-pdf-btn');
await page.waitForFunction(() => window.__yaynotes.S.n === 40 && document.querySelector('#loading').hidden);
// cria uma nota na p. 5
await page.dblclick('.page[data-i="4"]');
await page.waitForSelector('.epage[data-i="4"] canvas');
await page.keyboard.press('n');
const ep = await page.locator('.epage[data-i="4"]').boundingBox();
await page.mouse.click(ep.x + 150, ep.y + 200);
await page.keyboard.type('Gravada no próprio arquivo');
await page.keyboard.press('Escape');
// Salvar PDF (visão de página)
await page.click('#ed-save');
await page.waitForFunction(() => document.querySelector('#loading').hidden && !window.__yaynotes.S.dirty, null, { timeout: 30000 });
const saved = Buffer.from(await page.evaluate(() => Array.from(window.__files['exemplo.pdf'])));
const annots = readAnnotations(await loadPdfLib(saved));
const nota = annots.find((a) => a.contents === 'Gravada no próprio arquivo');
console.log('PDF regravado no mesmo arquivo:', saved.length !== pdf.length, '| comentários dentro dele:', annots.length, '| nota na p.', nota && nota.page + 1);
// Salvar FDF
await page.click('#ed-fdf');
await page.waitForFunction(() => window.__files['exemplo.fdf']);
const fdf = Buffer.from(await page.evaluate(() => Array.from(window.__files['exemplo.fdf']))).toString('latin1');
console.log('FDF pela janela Salvar como:', JSON.stringify(await page.evaluate(() => window.__pickerLog)), '| começa com', fdf.slice(0, 8));
// Salvar como… (tela inicial)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
await page.click('#save-pdf-as');
await page.waitForFunction(() => window.__files['exemplo-comentado.pdf'], null, { timeout: 30000 });
console.log('Salvar como…:', JSON.stringify((await page.evaluate(() => window.__pickerLog)).at(-1)), '| título:', await page.title());
console.log('downloads do navegador:', downloads);
const ok = annots.length === 3 && nota?.page === 4 && fdf.startsWith('%FDF') && downloads === 0;
console.log(ok ? 'OK: gravação direta, sem downloads' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
