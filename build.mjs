// Gera dist/YayNotes.html: um único arquivo HTML autocontido (funciona offline, abrindo direto no navegador).
// Uso: node build.mjs [--win] [--serve] [--port=8080]
//   --win  também gera dist/YayNotes.exe (Windows, portátil, sem instalação)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pdfjsDir = join(root, 'node_modules', 'pdfjs-dist');
const outFile = join(root, 'dist', 'YayNotes.html');

async function run() {
  const js = await build({
    entryPoints: [join(root, 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    target: ['chrome110', 'firefox115', 'safari16.4', 'edge110'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  // Worker do pdf-lib (leitura e gravação dos comentários em segundo plano), como script clássico
  const wk = await build({
    entryPoints: [join(root, 'src', 'pdfworker.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: ['chrome110', 'firefox115', 'safari16.4', 'edge110'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  const workerCode = wk.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');

  // Worker do pdf.js + dados binários (fontes padrão e decodificadores WASM de JBIG2/JPEG2000/cores)
  const b64 = (p) => readFileSync(p).toString('base64');
  // O worker é convertido para script clássico: workers de módulo a partir de blob: não funcionam em file://
  let worker = readFileSync(join(pdfjsDir, 'legacy', 'build', 'pdf.worker.min.mjs'), 'utf8');
  worker = worker.replace(/import\.meta\.url/g, 'self.location.href').replace(/export\s*\{\s*WorkerMessageHandler\s*\};?\s*$/, '');
  if (/\bexport\s*\{|\bimport\s*\(/.test(worker.slice(-2000))) throw new Error('Worker do pdf.js em formato inesperado');
  const assets = { worker: Buffer.from(worker).toString('base64'), files: {} };
  for (const f of readdirSync(join(pdfjsDir, 'standard_fonts'))) {
    if (/\.(pfb|ttf)$/.test(f)) assets.files[`standardFontDataUrl/${f}`] = b64(join(pdfjsDir, 'standard_fonts', f));
  }
  for (const f of ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm']) {
    try { assets.files[`wasmUrl/${f}`] = b64(join(pdfjsDir, 'wasm', f)); } catch { /* opcional */ }
  }

  let html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  // Ícone (favicon e logotipo) embutido como data URI
  const icon = 'data:image/svg+xml;base64,' + readFileSync(join(root, 'assets', 'yaynotes.svg')).toString('base64');
  html = html.replaceAll('__ICON__', icon);
  // Versão exibida na ajuda: data da geração + código do conteúdo
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
  const hash = (await import('node:crypto')).createHash('sha256').update(code + css).digest('hex').slice(0, 6);
  html = html.replaceAll('__VERSION__', `${stamp}-${hash}`);
  html = html.replace('/*__CSS__*/', () => css);
  html = html.replace('<script type="module">/*__JS__*/</script>', () =>
    `<script type="application/json" id="pdfjs-assets">${JSON.stringify(assets)}</script>\n` +
    `<script type="text/js-worker" id="pdf-worker-src">${workerCode}</script>\n<script type="module">${code}</script>`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  console.log(`Gerado ${outFile} (${(html.length / 1048576).toFixed(1)} MB)`);

  if (process.argv.includes('--win')) buildWindowsExe();
}

// Gera dist/YayNotes.exe (Windows 32 bits, portátil) com o HTML embutido.
// 32 bits roda em qualquer Windows (32 e 64 bits, e ARM por emulação). O Go 1.20 é a última
// versão que mantém compatibilidade com Windows 7/8; é obtido automaticamente via GOTOOLCHAIN.
function buildWindowsExe() {
  const launcher = join(root, 'launcher');
  copyFileSync(outFile, join(launcher, 'YayNotes.html'));
  const exe = join(root, 'dist', 'YayNotes.exe');
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', exe, '.'], {
    cwd: launcher,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'windows', GOARCH: '386', CGO_ENABLED: '0', GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'go1.20.14' },
  });
  console.log(`Gerado ${exe} (${(statSync(exe).size / 1048576).toFixed(1)} MB)`);
}

await run();

if (process.argv.includes('--serve')) {
  const port = +(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 8080);
  createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/YayNotes.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(outFile));
    } else if (req.url.startsWith('/samples/')) {
      try {
        res.writeHead(200);
        res.end(readFileSync(join(root, decodeURIComponent(req.url.split('?')[0]))));
      } catch { res.writeHead(404); res.end(); }
    } else { res.writeHead(404); res.end(); }
  }).listen(port, () => console.log(`Servindo em http://localhost:${port}/`));
}
