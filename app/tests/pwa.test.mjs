import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const template = await readFile(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const version = 'moa-shell-test';
const assets = ['/index.html', '/app.js', '/icon.png'];
function harness({ failInstall = false } = {}) {
  const handlers = new Map();
  const data = new Map([['unrelated-cache', new Map([['keep', 'safe']])], ['moa-shell-old', new Map([['/index.html', 'old']])]]);
  let claims = 0, requests = 0;
  const caches = {
    async open(name) {
      if (!data.has(name)) data.set(name, new Map());
      const cache = data.get(name);
      return {
        async addAll(paths) { if (failInstall) throw new Error('network failed'); for (const path of paths) cache.set(path, `cached:${path}`); },
        async match(path) { return cache.get(path); },
      };
    },
    async keys() { return [...data.keys()]; },
    async delete(name) { return data.delete(name); },
  };
  const context = { URL, Set, caches, fetch: async () => { requests++; throw new Error('offline'); }, self: { location: { origin: 'https://moa.test' }, clients: { claim: async () => { claims++; } }, addEventListener: (name, fn) => handlers.set(name, fn) } };
  vm.runInNewContext(template.replace('__MOA_CACHE__', version).replace('/* ASSET_LIST */ []', JSON.stringify(assets)), context);
  return {
    data, claims: () => claims, requests: () => requests,
    async lifecycle(name) { let promise; handlers.get(name)({ waitUntil(value) { promise = value; } }); return promise; },
    async fetch(path, mode = 'navigate', method = 'GET') { let response; handlers.get('fetch')({ request: { url: new URL(path, 'https://moa.test').href, mode, method }, respondWith(value) { response = value; } }); return response; },
  };
}
test('offline shell and lazy assets remain available when all network requests fail', async () => {
  const sw = harness();
  await sw.lifecycle('install'); await sw.lifecycle('activate');
  for (const route of ['/', '/note/saved-note', '/export?ids=saved-note']) assert.equal(await sw.fetch(route), 'cached:/index.html');
  assert.equal(await sw.fetch('/app.js', 'cors'), 'cached:/app.js');
  assert.equal(sw.requests(), 0);
  assert.equal(sw.claims(), 1);
});
test('a failed new installation retains the old working cache', async () => {
  const sw = harness({ failInstall: true });
  await assert.rejects(sw.lifecycle('install'), /network failed/);
  assert.equal(sw.data.has(version), false);
  assert.equal(sw.data.has('moa-shell-old'), true);
});
test('activation cleans only older Moa app shells, never unrelated data', async () => {
  const sw = harness();
  await sw.lifecycle('install'); await sw.lifecycle('activate');
  assert.equal(sw.data.has('moa-shell-old'), false);
  assert.equal(sw.data.has('unrelated-cache'), true);
  assert.equal(sw.data.has(version), true);
});
test('personal files, APIs, external URLs and writes bypass the shell cache', async () => {
  const sw = harness(); await sw.lifecycle('install');
  for (const path of ['/media/private.jpg', '/api/notes', 'https://another.test/app.js']) assert.equal(await sw.fetch(path, 'cors'), undefined);
  assert.equal(await sw.fetch('/', 'navigate', 'POST'), undefined);
  assert.equal(sw.requests(), 0);
});
