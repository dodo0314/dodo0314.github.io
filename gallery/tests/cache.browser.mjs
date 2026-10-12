// Playwright against the built Worker behind a local server (no request interception, so the
// browser's HTTP cache is active): invitation cookie, grid links and reuse on the next visit.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const storage = new Map([['connection',JSON.stringify({refreshToken:'cache-test-refresh'})]]);
const env = {PUBLIC_ORIGIN:'https://jian.jahab.workers.dev',MS_CLIENT_ID:'cache-test',MS_CLIENT_SECRET:'cache-test-secret',
  ADMIN_PASSWORD:'cache-test-admin-password-0123456789',VIEWER_KEY:'cache-test-invitation-key-0123456789',ALBUM_ITEM_ID:'owner-album',
  GALLERY_KV:{async get(k,type) { const v = storage.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k,v) { storage.set(k,v); }, async delete(k) { storage.delete(k); }}};
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#a3876f"/></svg>`;
const photos = Array.from({length:60},(_,index) => ({id:'photo-'+index,name:'2026101'+(index % 10)+'_120000000_iOS.jpg',file:{mimeType:'image/jpeg'},
  photo:{takenDateTime:new Date(Date.UTC(2026,9,10,12,index)).toISOString()},
  thumbnails:[{medium:{url:'https://photos.example/'+index+'-medium.svg'},large:{url:'https://photos.example/'+index+'-large.svg'}}]}));
globalThis.fetch = async input => {
  const url = String(input);
  if (url.includes('/oauth2/v2.0/token')) return Response.json({access_token:'cache-token',refresh_token:'cache-refresh',expires_in:3600});
  if (url.endsWith('/owner-album')) return Response.json({id:'owner-album'});
  if (url.includes('children')) return Response.json({value:photos});
  if (url.startsWith('https://photos.example/')) return new Response(svg(url.includes('-large') ? 800 : 176),{headers:{'Content-Type':'image/svg+xml'}});
  throw Error('Unexpected request '+url);
};
const hits = [];
const server = createServer(async (incoming,outgoing) => {
  const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
  const headers = new Headers();
  for (const [name,value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name,value);
  // The Worker expects its HTTPS origin; this local server stands in for it.
  if (headers.get('origin') === local) headers.set('origin',env.PUBLIC_ORIGIN);
  const request = new Request(env.PUBLIC_ORIGIN+incoming.url,{method:incoming.method,headers,body:['GET','HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks)});
  hits.push(new URL(incoming.url,local).pathname);
  const result = await gallery.fetch(request,env,{waitUntil() {}});
  const out = {}; result.headers.forEach((value,name) => { out[name] = value; });
  // Production is HTTPS, where img-src https: covers the site itself.
  if (out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].replace('img-src https:',"img-src 'self' https:");
  outgoing.writeHead(result.status,out); outgoing.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const local = 'http://localhost:'+server.address().port;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror',error => errors.push(error.message));
  const firstScreen = async () => {
    await page.waitForFunction(() => /선명 \d/.test(document.querySelector('#timing')?.textContent || ''));
    return page.locator('#timing').textContent();
  };
  await page.goto(local+'/?timing=1#k='+encodeURIComponent(env.VIEWER_KEY));
  const first = await firstScreen();
  const firstGrid = hits.filter(path => path.startsWith('/api/grid/')).length;
  assert.ok(firstGrid > 0); assert.equal(await page.evaluate(() => location.hash),'');
  assert.equal((await context.cookies()).find(cookie => cookie.name === 'jian_view')?.httpOnly,true);
  hits.length = 0;
  await page.goto(local+'/?timing=1');
  const second = await firstScreen();
  const secondGrid = hits.filter(path => path.startsWith('/api/grid/'));
  assert.ok(hits.includes('/api/album'),'the album list is always checked with the server');
  assert.deepEqual(secondGrid,[],'the next visit takes every first-screen grid image from the browser cache');
  assert.match(second,/브라우저 캐시 \d+/);
  const stranger = await browser.newContext();
  const locked = await stranger.newPage(); await locked.goto(local+'/');
  await locked.waitForFunction(() => document.querySelector('#status h2')?.textContent === '초대받은 분만 볼 수 있어요');
  assert.equal(await locked.locator('.card').count(),0); await stranger.close();
  assert.deepEqual(errors,[]);
  console.log('PASS browser cache: first visit '+firstGrid+' grid requests ('+first+'); next visit 0 grid requests ('+second+'); uninvited browser locked');
} finally { await browser.close(); server.close(); }
