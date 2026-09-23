import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
await stat(resolve(root, 'sw.js'));
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    const path = decodeURIComponent(url.pathname);
    const route = path === '/' || /^\/note\/[^/]+\/?$/.test(path) || path === '/export' || path === '/backup';
    const file = resolve(root, route ? 'index.html' : `.${path}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`PWA local test: http://localhost:${port} (iPhone installation needs HTTPS hosting)`));
