/* global self, caches, fetch */
const CACHE = '__MOA_CACHE__';
const ASSETS = /* ASSET_LIST */ [];
const assetPaths = new Set(ASSETS);

self.addEventListener('install', event => {
  // A partial download must never replace a working offline version.
  event.waitUntil((async () => {
    try { const cache = await caches.open(CACHE); await cache.addAll(ASSETS); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // No skipWaiting: open editors are never interrupted by an update.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('moa-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const route = url.pathname === '/' || /^\/note\/[^/]+\/?$/.test(url.pathname) || url.pathname === '/export' || url.pathname === '/backup';
  if (request.mode === 'navigate' && route) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('/index.html')) || fetch(request);
    })());
  } else if (assetPaths.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.pathname)) || fetch(request);
    })());
  }
  // Records, attachments, API calls and other origins are never cached here.
});
