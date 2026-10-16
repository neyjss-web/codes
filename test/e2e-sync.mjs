// Teste no Chromium: duas janelas com o mesmo PDF sincronizam os comentários entre si
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const url = pathToFileURL(resolve('dist/YayNotes.html')).href + '?download=1';
const errors = [];
const fail = (msg) => { console.error('FALHA:', msg); process.exitCode = 1; };
async function openWin() {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto(url);
  await p.setInputFiles('#open-pdf', 'samples/exemplo.pdf');
  await p.waitForFunction(() => window.__yaynotes.S.n === 40 && document.querySelector('#loading').hidden, null, { timeout: 30000 });
  await p.waitForTimeout(1500); // revisão + procura de outra janela
  return p;
}
const count = (p) => p.evaluate(() => window.__yaynotes.S.annots.length);
const has = (p, txt) => p.evaluate((t) => window.__yaynotes.S.annots.some((a) => a.contents === t), txt);
const dirty = (p) => p.evaluate(() => window.__yaynotes.S.dirty);

const A = await openWin();
const B = await openWin();
const n0 = await count(A);
if (n0 !== (await count(B))) fail('janelas abriram com quantidades diferentes');
const sameIds = await A.evaluate(() => window.__yaynotes.S.annots.map((a) => a.id).join());
if (sameIds !== (await B.evaluate(() => window.__yaynotes.S.annots.map((a) => a.id).join()))) fail('a segunda janela não adotou os comentários da primeira');

// criar em A aparece em B
await A.evaluate(() => window.__yaynotes.newAnnot({ type: 'Text', page: 1, rect: [100, 100, 120, 120], contents: 'nota da janela A' }));
await B.waitForTimeout(500);
if (!(await has(B, 'nota da janela A'))) fail('nota criada em A não apareceu em B');
if (!(await dirty(B))) fail('B deveria indicar alteração não salva');

// excluir em B some de A
await B.evaluate(() => { const y = window.__yaynotes; y.deleteAnnot(y.S.annots.find((a) => a.contents === 'nota da janela A').id); });
await A.waitForTimeout(500);
if (await has(A, 'nota da janela A')) fail('nota excluída em B continuou em A');

// desfazer em B (que excluiu) traz a nota de volta nas duas
await B.evaluate(() => window.__yaynotes.undo());
await A.waitForTimeout(500);
if (!(await has(A, 'nota da janela A')) || !(await has(B, 'nota da janela A'))) fail('desfazer em B não restaurou a nota nas duas janelas');

// marcação de grupo em B aparece em A
await B.evaluate(() => window.__yaynotes.applyGroup({ label: 'Contestação', text: 'Contestação do réu', color: [1, 0.8, 0], frame: true }, [10, 11, 12]));
await A.waitForTimeout(500);
const gA = await A.evaluate(() => window.__yaynotes.S.groups.map((g) => g.label + ':' + g.pages.join('-')).join());
if (!gA.includes('Contestação:10-11-12')) fail('grupo criado em B não apareceu em A: ' + gA);
if ((await count(A)) !== (await count(B))) fail('quantidades diferentes após o grupo');

// salvar em A marca as duas como salvas
const dl = A.waitForEvent('download');
await A.evaluate(() => window.__yaynotes.exportFdfFile());
await dl;
await B.waitForTimeout(500);
if ((await dirty(A)) || (await dirty(B))) fail(`após salvar em A: A sujo=${await dirty(A)}, B sujo=${await dirty(B)}`);

// botão "Nova janela": abre o mesmo documento, na mesma página, já sincronizado
await A.evaluate(() => window.__yaynotes.newAnnot({ type: 'Text', page: 7, rect: [100, 100, 120, 120], contents: 'antes da nova janela' }));
await A.dblclick('.page[data-i="5"]');
await A.waitForTimeout(800);
const popupP = ctx.waitForEvent('page');
await A.click('#ed-new-window');
const N = await popupP;
N.on('pageerror', (e) => errors.push('pageerror(N): ' + e.message));
await N.waitForFunction(() => window.__yaynotes?.S.n === 40 && document.querySelector('#loading').hidden && !document.querySelector('#editor').hidden, null, { timeout: 30000 });
await N.waitForTimeout(1500);
if (!(await has(N, 'antes da nova janela'))) fail('nova janela não recebeu o comentário ainda não salvo');
if ((await count(N)) !== (await count(A))) fail('nova janela com quantidade diferente de comentários');
const pgN = await N.textContent('#ed-pageno');
if (!pgN.startsWith('6 /')) fail('nova janela não abriu na mesma página: ' + pgN);
await N.evaluate(() => window.__yaynotes.newAnnot({ type: 'Text', page: 8, rect: [100, 100, 120, 120], contents: 'feita na nova janela' }));
await A.waitForTimeout(500);
if (!(await has(A, 'feita na nova janela')) || !(await has(B, 'feita na nova janela'))) fail('comentário da nova janela não chegou às outras');
await A.keyboard.press('Escape');

// uma terceira janela com outro PDF não é afetada
const C = await ctx.newPage();
await C.goto(url);
await C.setInputFiles('#open-pdf', 'samples/exemplo-v2.pdf');
await C.waitForFunction(() => window.__yaynotes.S.n > 0 && document.querySelector('#loading').hidden, null, { timeout: 30000 });
await C.waitForTimeout(1200);
const nC = await count(C);
await A.evaluate(() => window.__yaynotes.newAnnot({ type: 'Text', page: 2, rect: [100, 100, 120, 120], contents: 'só no exemplo' }));
await C.waitForTimeout(500);
if ((await count(C)) !== nC) fail('PDF diferente recebeu comentário de outro processo');

if (errors.length) fail(errors.join('\n'));
console.log(process.exitCode ? 'Sincronização: FALHOU' : 'OK: duas janelas do mesmo processo sincronizadas');
await browser.close();
