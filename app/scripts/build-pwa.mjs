import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';

const root = resolve('dist');
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path)); else paths.push(path);
  }
  return paths;
}
const excluded = new Set(['sw.js', '_headers', '_redirects', 'pwa-build.json']);
const files = (await walk(root)).filter(path => !excluded.has(relative(root, path)) && !path.endsWith('.map')).sort();
const assets = files.map(path => '/' + relative(root, path).replaceAll('\\', '/'));
for (const required of ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
  if (!assets.includes(required)) throw new Error(`Missing PWA asset: ${required}`);
}
const hash = createHash('sha256');
let totalBytes = 0;
for (const file of files) {
  const bytes = await readFile(file);
  totalBytes += bytes.length;
  hash.update(relative(root, file).replaceAll('\\', '/')).update(bytes);
}
const source = await readFile('scripts/service-worker.js', 'utf8');
hash.update(source);
const version = hash.digest('hex').slice(0, 16);
const worker = source.replace('__MOA_CACHE__', `moa-shell-${version}`).replace('/* ASSET_LIST */ []', JSON.stringify(assets));
await writeFile(join(root, 'sw.js'), worker);
await writeFile(join(root, 'pwa-build.json'), JSON.stringify({ version, assets, totalBytes }, null, 2));
await writeFile(join(root, '_headers'), '/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n/index.html\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Cache-Control: no-cache\n');
await writeFile(join(root, '_redirects'), '/note/* /index.html 200\n/export /index.html 200\n/backup /index.html 200\n');
console.log(`PWA ready: ${assets.length} assets, ${(totalBytes / 1048576).toFixed(2)} MB, version ${version}`);
