import { readFile, writeFile, mkdir } from 'node:fs/promises';
const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('./public/gallery.css', import.meta.url), 'utf8');
const period = await readFile(new URL('./public/period.mjs', import.meta.url), 'utf8');
const js = (await readFile(new URL('./public/gallery.js', import.meta.url), 'utf8')).replace('/* PERIOD_HELPERS */', () => period.replace(/^export /gm, ''));
const displayFont = await readFile(new URL('./assets/hahmlet-display.woff', import.meta.url));
const fontLicense = await readFile(new URL('./assets/Hahmlet-OFL.txt', import.meta.url), 'utf8');
const fontCSS = `/* ${fontLicense.replaceAll('*/', '* /')} */\n@font-face{font-family:Jian Display;src:url(data:font/woff;base64,${displayFont.toString('base64')}) format('woff');font-weight:700;font-style:normal;font-display:swap}`;
const page = html.replace('/* GALLERY_CSS */', () => fontCSS + '\n' + css).replace('/* GALLERY_JS */', () => js);
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
const media = await readFile(new URL('./media.mjs', import.meta.url), 'utf8');
const decoder = await readFile(new URL('./assets/vendor/heic-to-1.6.6-csp.js', import.meta.url), 'utf8');
const decoderLicense = await readFile(new URL('./assets/vendor/heic-to-LICENSE.txt', import.meta.url), 'utf8');
const gplLicense = await readFile(new URL('./assets/vendor/GPL-3.0.txt', import.meta.url), 'utf8');
const heicWorker = await readFile(new URL('./public/heic-viewer-worker.mjs', import.meta.url), 'utf8');
const assets = {
  '/assets/heic-decoder-1.6.6.js': `/* heic-to 1.6.6, unmodified CSP build. Source: https://github.com/hoppergee/heic-to\n${decoderLicense}\n${gplLicense} */\n` + decoder,
  '/assets/heic-viewer-v1.js': heicWorker,
};
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/worker.mjs', import.meta.url), worker
  .replace("import { GALLERY_HTML } from './page.mjs';", () => `const GALLERY_HTML = ${JSON.stringify(page)};`)
  .replace("import { GALLERY_ASSETS } from './assets.mjs';", () => `const GALLERY_ASSETS = ${JSON.stringify(assets)};`)
  .replace("import { isPhoto, isVideo, isMedia, mediaDate, sortMedia } from './media.mjs';", () => media.replace(/^export /gm, '')));
console.log('dist/worker.mjs — Cloudflare 편집기에 붙여 넣을 단일 Worker 파일');
