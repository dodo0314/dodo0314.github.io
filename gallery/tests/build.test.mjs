import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('dashboard bundle preserves decoder source and serves it separately from the gallery page', async () => {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../build.mjs', import.meta.url))]);
  const { default: gallery } = await import('../dist/worker.mjs?build-test');
  const decoder = await gallery.fetch(new Request('https://jian.jahab.workers.dev/assets/heic-decoder-1.6.6.js'), {});
  const source = await decoder.text();
  const original = await readFile(new URL('../assets/vendor/heic-to-1.6.6-csp.js', import.meta.url), 'utf8');
  assert.equal(decoder.status, 200); assert.ok(decoder.headers.get('Content-Type').startsWith('text/javascript'));
  assert.ok(source.endsWith(original), 'third-party replacement syntax must remain literal');
  assert.ok(source.includes('GNU LESSER GENERAL PUBLIC LICENSE'));
  const converter = await gallery.fetch(new Request('https://jian.jahab.workers.dev/assets/heic-viewer-v1.js'), {});
  assert.equal(await converter.text(), await readFile(new URL('../public/heic-viewer-worker.mjs', import.meta.url), 'utf8'));
  const page = await gallery.fetch(new Request('https://jian.jahab.workers.dev/'), {});
  assert.ok((await page.text()).length < 160000, 'decoder must be loaded only when needed');
  assert.ok(page.headers.get('Content-Security-Policy').includes("worker-src 'self' blob:"));
  assert.equal(page.headers.get('Content-Security-Policy').includes('unsafe-eval'), false);
});
