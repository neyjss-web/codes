// Teste de ponta a ponta: comentários feitos em uma versão do PDF, salvos em FDF e carregados
// em uma versão mais nova do mesmo processo (com páginas inseridas) são reposicionados pelo Num./Pág.
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOTS || '/tmp/shots';
mkdirSync(OUT, { recursive: true });
const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 850 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const ready = (name) => page.waitForFunction((n) => window.__pdfnotas.S.fileName === n && document.querySelector('#loading').hidden && document.querySelector('#progress').hidden, name, { timeout: 30000 });
await page.goto(pathToFileURL(resolve('dist/PDFNotas.html')).href);

// Versão 1: marca a Contestação (p. 15–24) e cria uma nota na p. 17
await page.setInputFiles('#open-pdf', 'samples/exemplo.pdf');
await ready('exemplo.pdf');
await page.fill('#sel-range', '15-24');
await page.press('#sel-range', 'Enter');
await page.click('#mark-group');
await page.fill('#group-dialog [name=label]', 'Contestação');
await page.click('#gd-ok');
await page.dblclick('.page[data-i="16"]');
await page.waitForSelector('.epage[data-i="16"] canvas');
await page.keyboard.press('n');
const ep = await page.locator('.epage[data-i="16"]').boundingBox();
await page.mouse.click(ep.x + 200, ep.y + 300);
await page.keyboard.type('Nota da p. 17 (Num. 2177293502 - Pág. 3)');
await page.waitForTimeout(400);
console.log('propriedades:', await page.textContent('#props-meta'));
await page.keyboard.press('Escape');
const fdf = `${OUT}/v1.fdf`;
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ed-fdf')]);
await dl.saveAs(fdf);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

// Versão 2 (2 páginas novas após a p. 6): carrega o FDF
page.once('dialog', (d) => d.accept());
await page.evaluate(() => window.__pdfnotas.S.dirty = false);
await page.setInputFiles('#open-pdf', 'samples/exemplo-v2.pdf');
await ready('exemplo-v2.pdf');
await page.setInputFiles('#import-fdf', fdf);
await page.waitForFunction(() => window.__pdfnotas.S.annots.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(300);
const r = await page.evaluate(() => ({
  nota: window.__pdfnotas.S.annots.filter((a) => /Nota da p. 17/.test(a.contents)).map((a) => a.page + 1),
  grupo: window.__pdfnotas.S.groups.map((g) => [g.label, g.pages[0] + 1, g.pages[g.pages.length - 1] + 1, g.pages.length]),
  antigas: window.__pdfnotas.S.annots.filter((a) => !a.group && !/Nota da p. 17/.test(a.contents)).map((a) => [a.contents, a.page + 1]),
  avisos: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
}));
console.log(JSON.stringify(r, null, 1));
const ok = r.nota[0] === 19 && r.grupo[0][1] === 17 && r.grupo[0][2] === 26 && r.antigas.every(([, p]) => p === 1 || p === 3);
console.log(ok ? 'OK: comentários reposicionados pelo Num./Pág.' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
