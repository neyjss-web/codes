// Teste de ponta a ponta no Chromium: abre dist/YayNotes.html via file://
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOTS || '/tmp/shots';
mkdirSync(OUT, { recursive: true });
const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(pathToFileURL(resolve('dist/YayNotes.html')).href + '?download=1');
await page.setInputFiles('#open-pdf', 'samples/exemplo.pdf');
await page.waitForFunction(() => window.__yaynotes.S.n === 40 && document.querySelector('#loading').hidden, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const st = await page.evaluate(() => ({ n: window.__yaynotes.S.annots.length, canWrite: window.__yaynotes.S.canWrite }));
console.log('anotações existentes:', st);
await page.screenshot({ path: `${OUT}/1-grid.png` });

// Zoom com teclas
await page.keyboard.press('>');
await page.keyboard.press('>');
await page.waitForTimeout(800);
console.log('zoom label após >>:', await page.textContent('#zoom-label'));
await page.keyboard.press('<'); await page.keyboard.press('<'); await page.keyboard.press('<'); await page.keyboard.press('<');
await page.waitForTimeout(800);
console.log('zoom label após <<<<:', await page.textContent('#zoom-label'));
await page.screenshot({ path: `${OUT}/2-small.png` });

// Seleção de intervalo e marcação em grupo
await page.fill('#sel-range', '15-24');
await page.press('#sel-range', 'Enter');
console.log('seleção:', await page.textContent('#sel-info'));
await page.click('#mark-group');
await page.fill('#group-dialog [name=label]', 'Contestação');
await page.fill('#group-dialog [name=text]', 'Contestação do réu (fls. 15–24)');
await page.click('#gd-ok');
await page.waitForTimeout(500);
console.log('grupos:', await page.evaluate(() => window.__yaynotes.S.groups.map((g) => [g.label, g.pages.length])));

// Hover: lupa
await page.hover('.page[data-i="16"]');
await page.waitForTimeout(1200);
console.log('lupa visível:', await page.isVisible('#preview'));
await page.screenshot({ path: `${OUT}/3-hover.png` });

// Leitura contínua: realce por seleção de texto e nota na página 3
await page.mouse.move(5, 5);
await page.dblclick('.page[data-i="2"]');
await page.waitForSelector('.epage[data-i="2"] .textLayer span', { timeout: 10000 });
console.log('página atual ao abrir:', await page.textContent('#ed-pageno'));
await page.keyboard.press('h');
const span = page.locator('.epage[data-i="2"] .textLayer span').nth(3);
const box = await span.boundingBox();
await page.mouse.move(box.x + 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.press('n');
const ep = await page.locator('.epage[data-i="2"]').boundingBox();
await page.mouse.click(ep.x + ep.width - 80, ep.y + 200);
await page.keyboard.type('Nota criada no teste — ação');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/4-editor.png` });
await page.keyboard.press('Escape'); // sai do campo
await page.keyboard.press('Escape'); // desmarca

// 1) Lista com todos os comentários do arquivo; clique salta para a página
const listInfo = await page.evaluate(() => ({
  itens: document.querySelectorAll('#ed-list .item').length,
  paginas: [...document.querySelectorAll('#ed-list .pg-h[data-p]')].map((h) => h.textContent),
}));
console.log('lista do arquivo:', listInfo);
await page.locator('#ed-list .item', { hasText: 'Verificar valor da causa' }).click();
await page.waitForTimeout(400);
console.log('após clicar no comentário da p. 1:', await page.textContent('#ed-pageno'), 'selecionado:', await page.evaluate(() => !!window.__yaynotes.E.selId));

// 3) Hiperlink interno na página 1 (índice → Contestação, fls. 15)
await page.keyboard.press('Escape');
await page.waitForSelector('.epage[data-i="0"] .links .lnk');
const nLinks = await page.locator('.epage[data-i="0"] .links .lnk').count();
await page.locator('.epage[data-i="0"] .links .lnk').nth(2).click();
await page.waitForTimeout(500);
console.log('links na p. 1:', nLinks, '| após clicar no link da Contestação:', await page.textContent('#ed-pageno'));
const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }).catch(() => null), page.evaluate(() => {}).then(async () => {
  await page.locator('#ed-prev').click(); // garante que a página 1 esteja montada
  await page.evaluate(() => document.querySelector('.ed-scroll').scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('.epage[data-i="0"] .links .lnk').last().click();
})]);
console.log('link externo abriu:', popup ? popup.url() : 'não');
if (popup) await popup.close();

// 2) Rolagem sequencial
await page.evaluate(() => { const s = document.querySelector('.ed-scroll'); s.scrollTop = s.scrollHeight / 2; });
await page.waitForTimeout(600);
console.log('rolagem para o meio → página atual:', await page.textContent('#ed-pageno'),
  '| páginas montadas:', await page.evaluate(() => [...window.__yaynotes.E.pages.keys()].sort((a, b) => a - b).join(',')));
await page.screenshot({ path: `${OUT}/6-scroll.png` });
await page.keyboard.press('Escape'); // fecha
const annots = await page.evaluate(() => window.__yaynotes.S.annots.map((a) => [a.type, a.page, a.contents]));
console.log('total anotações:', annots.length, annots.filter((a) => !String(a[2]).startsWith('Contesta')));

// Link na grade (páginas grandes)
for (let k = 0; k < 5; k++) await page.keyboard.press('>');
await page.evaluate(() => document.querySelector('#viewer').scrollTo(0, 0));
await page.waitForTimeout(1200);
await page.locator('.page[data-i="0"] .links .lnk').nth(1).click();
await page.waitForTimeout(800);
console.log('grade: link da p. 1 → seleção intacta?', await page.evaluate(() => window.__yaynotes.S.sel.size), '| topo da grade na página', await page.evaluate(() => { const v = document.querySelector('#viewer'); return [...document.querySelectorAll('.page')].find((p) => p.offsetTop + p.offsetHeight > v.scrollTop + 10)?.dataset.i; }));

// Exporta FDF
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-fdf')]);
const fdfPath = `${OUT}/export.fdf`;
await dl.saveAs(fdfPath);
console.log('FDF:', readFileSync(fdfPath, 'latin1').slice(0, 120).replace(/\n/g, ' | '));

// Salva PDF
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#save-pdf')]);
const pdfPath = `${OUT}/salvo.pdf`;
await dl2.saveAs(pdfPath);

// Reabre o PDF salvo e importa o FDF (mescla)
await page.setInputFiles('#open-pdf', pdfPath);
await page.waitForFunction(() => window.__yaynotes.S.fileName === 'salvo.pdf' && document.querySelector('#progress').hidden && document.querySelector('#loading').hidden, null, { timeout: 30000 }).catch(async (e) => { console.log(await page.evaluate(() => [window.__yaynotes.S.fileName, document.querySelector("#progress").hidden, document.querySelector("#progress span").textContent])); console.log(errors); throw e; });
console.log('reaberto: anotações lidas do PDF salvo =', await page.evaluate(() => window.__yaynotes.S.annots.length), 'grupos =', await page.evaluate(() => window.__yaynotes.S.groups.map((g) => [g.label, g.pages.length])));
page.once('dialog', (d) => d.accept());
await page.setInputFiles('#import-fdf', fdfPath);
await page.waitForSelector('#choice-dialog[open]');
await page.click('#choice-actions button[value=replace]');
await page.waitForTimeout(500);
console.log('após importar FDF (substituir):', await page.evaluate(() => window.__yaynotes.S.annots.length));
await page.screenshot({ path: `${OUT}/5-reimport.png` });
console.log('erros/avisos do console:', errors.slice(0, 15));
await browser.close();
