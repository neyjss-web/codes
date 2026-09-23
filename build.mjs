// Gera dist/PDFNotas.html: um único arquivo HTML autocontido (funciona offline, abrindo direto no navegador).
// Uso: node build.mjs [--win] [--serve] [--port=8080]
//   --win  também gera dist/PDFNotas.exe (Windows, portátil, sem instalação)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pdfjsDir = join(root, 'node_modules', 'pdfjs-dist');
const outFile = join(root, 'dist', 'PDFNotas.html');

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
  html = html.replace('/*__CSS__*/', () => css);
  html = html.replace('<script type="module">/*__JS__*/</script>', () =>
    `<script type="application/json" id="pdfjs-assets">${JSON.stringify(assets)}</script>\n<script type="module">${code}</script>`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  console.log(`Gerado ${outFile} (${(html.length / 1048576).toFixed(1)} MB)`);

  if (process.argv.includes('--win')) buildWindowsExe();
}

// Gera dist/PDFNotas.exe (Windows 64 bits, portátil) com o HTML embutido. Requer Go >= 1.21.
function buildWindowsExe() {
  const launcher = join(root, 'launcher');
  copyFileSync(outFile, join(launcher, 'PDFNotas.html'));
  const exe = join(root, 'dist', 'PDFNotas.exe');
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', exe, '.'], {
    cwd: launcher,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
  });
  console.log(`Gerado ${exe} (${(statSync(exe).size / 1048576).toFixed(1)} MB)`);
}

await run();

if (process.argv.includes('--serve')) {
  const port = +(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 8080);
  createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/PDFNotas.html')) {
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
