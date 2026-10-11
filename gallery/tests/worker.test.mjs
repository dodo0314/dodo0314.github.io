import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { sign, verify, isPhoto, readAlbum, albumPage, mediaDate } from '../worker.mjs';

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
function environment() {
  const storage = new Map([['connection', JSON.stringify({ refreshToken: 'test-refresh-token' })]]);
  return {
    PUBLIC_ORIGIN: 'https://jian.jahab.workers.dev', MS_CLIENT_ID: 'test-client', MS_CLIENT_SECRET: 'test-client-secret',
    ADMIN_PASSWORD: 'test-admin-password-at-least-20-characters', ALBUM_ITEM_ID: 'owner-album', ALBUM_TITLE: '지안의 순간들',
    GALLERY_KV: { async get(k, type) { const v = storage.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
      async put(k, v) { storage.set(k, v); }, async delete(k) { storage.delete(k); } },
  };
}
function mockGraph(pages = 2) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes('/oauth2/v2.0/token')) return Response.json({ access_token:'test-owner-token', refresh_token:'new-test-refresh', expires_in:3600 });
    if (url.endsWith('/me/drive/items/owner-album')) return Response.json({ id:'owner-album', name:'Test album' });
    if (url.includes('children')) {
      if (url.includes('page=2')) return Response.json({ value:[{ id:'photo-two', name:'two.heic', file:{mimeType:'image/heic'}, image:{width:3000,height:4000}, thumbnails:[{ large:{url:'https://photos.example/two.jpg'} }] }] });
      return Response.json({ value:[
        { id:'photo-one', name:'one.jpg', file:{mimeType:'image/jpeg'}, image:{width:4000,height:3000}, photo:{takenDateTime:'2026-01-01T09:00:00Z'},
          thumbnails:[{medium:{url:'https://photos.example/small.jpg'},large:{url:'https://photos.example/large.jpg'}}], '@microsoft.graph.downloadUrl':'https://photos.example/original.jpg'},
        { id:'private-text', name:'notes.txt', file:{mimeType:'text/plain'} },
        { id:'other-folder', name:'Private folder', folder:{childCount:1} },
      ], ...(pages > 1 ? { '@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/items/owner-album/children?page=2' } : {}) });
    }
    if (url.endsWith('/me/drive/items/photo-one')) return Response.json({ id:'photo-one', name:'one.jpg', file:{mimeType:'image/jpeg'}, '@microsoft.graph.downloadUrl':'https://photos.example/original.jpg' });
    throw new Error('Unexpected URL: ' + url);
  };
  return calls;
}
test('expired, tampered and cross-purpose signed capabilities are rejected', async () => {
  const env = environment(); const good = await sign({ kind:'photo', id:'photo-one', exp:Date.now()+60000 },env);
  assert.equal((await verify(good,env,'photo')).id,'photo-one');
  assert.equal(await verify(good,env,'admin'),null);
  assert.equal(await verify(good.slice(0,-3)+'xyz',env,'photo'),null);
  assert.equal(await verify(await sign({ kind:'photo',exp:0 },env),env,'photo'),null);
});
test('album pagination includes photos only and never returns tokens or owner credentials', async () => {
  const env = environment(); const calls = mockGraph(); const album = await readAlbum(env);
  assert.deepEqual(album.items.map(x=>x.id),['photo-one','photo-two']);
  assert.equal(album.items[0].thumbnail,'https://photos.example/small.jpg');
  const serialized = JSON.stringify(album);
  for (const secret of ['test-owner-token','test-refresh-token','new-test-refresh','test-client-secret']) assert.equal(serialized.includes(secret),false);
  assert.equal(calls.filter(c=>c.url.includes('children')).length,2);
  assert.equal(calls.some(c=>c.url.includes('other-folder')),false);
});
test('pagination cannot send the owner token to another host', async () => {
  const env = environment(); const calls = mockGraph(); const good = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('children')) return Response.json({ value:[], '@odata.nextLink':'https://attacker.example/token' });
    return good(url, init);
  };
  await assert.rejects(()=>readAlbum(env),/사진 목록 주소/);
  assert.equal(calls.some(c=>c.url.includes('attacker.example')),false);
});
test('Graph requests use the manual redirect mode supported by Workers', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'workers-redirect-mode-test' };
  const calls = mockGraph(1);
  const nativeMock = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.microsoft.com/')) {
      if (init.redirect === 'error') throw new TypeError('Unsupported redirect mode');
      assert.equal(init.redirect, 'manual');
    }
    return nativeMock(url, init);
  };
  const album = await readAlbum(env);
  assert.equal(album.items.length, 1);
  assert.ok(calls.some(call => call.url.includes('children')));
});
test('safe redirects within Graph v1.0 are followed with authentication', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'safe-graph-redirect-test' };
  const calls = mockGraph(1);
  const nativeMock = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/me/drive/items/owner-album')) return new Response(null, { status: 302, headers: { Location: '/v1.0/me/drive/items/redirected-album' } });
    if (String(url).endsWith('/me/drive/items/redirected-album')) {
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, 'Bearer test-owner-token');
      return Response.json({ id: 'owner-album' });
    }
    return nativeMock(url, init);
  };
  assert.equal((await readAlbum(env)).items.length, 1);
  assert.ok(calls.some(call => call.url.includes('children')));
});
test('Graph redirects never send credentials outside the allowed API', async () => {
  for (const location of ['https://attacker.example/token', 'http://graph.microsoft.com/v1.0/items', 'https://graph.microsoft.com/beta/items', 'https://user:password@graph.microsoft.com/v1.0/items']) {
    const env = { ...environment(), MS_CLIENT_ID: 'unsafe-redirect-' + location };
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'test-owner-token', refresh_token: 'test-refresh-token', expires_in: 3600 });
      assert.equal(String(url), 'https://graph.microsoft.com/v1.0/me/drive/items/owner-album');
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: location } });
    };
    await assert.rejects(() => readAlbum(env), /이동 주소/);
    assert.equal(calls.filter(url => !url.includes('/oauth2/v2.0/token')).length, 1);
  }
});
test('Graph redirect loops stop after a bounded number of requests', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'graph-redirect-loop-test' };
  let graphCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'test-owner-token', refresh_token: 'test-refresh-token', expires_in: 3600 });
    graphCalls++;
    return new Response(null, { status: 307, headers: { Location: '/v1.0/me/drive/items/owner-album' } });
  };
  await assert.rejects(() => readAlbum(env), /이동 주소/);
  assert.equal(graphCalls, 4);
});
test('unconfigured public API is a controlled error and never a sample album', async () => {
  const res = await worker.fetch(new Request('https://jian.jahab.workers.dev/api/album'),{});
  assert.equal(res.status,503); assert.ok((await res.json()).error);
});
test('forged originals cannot retrieve an arbitrary item', async () => {
  const env = environment(); let called = false; globalThis.fetch = async()=>{called=true;throw Error('must not call');};
  const res = await worker.fetch(new Request('https://jian.jahab.workers.dev/api/original/forged'),env);
  assert.equal(res.status,403); assert.equal(called,false);
});
test('valid photo capability redirects to a file without sending owner tokens to its host', async () => {
  const env = environment(); const calls=mockGraph();
  const capability=await sign({kind:'photo',id:'photo-one',source:'owner',exp:Date.now()+60000},env);
  const res=await worker.fetch(new Request('https://jian.jahab.workers.dev/api/original/'+capability),env);
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'https://photos.example/original.jpg');
  assert.equal(calls.some(c=>c.url.startsWith('https://photos.example')),false);
});
test('migrated shared-album original uses only its signed download URL', async () => {
  const env=environment(); let called=false; globalThis.fetch=async()=>{called=true;throw Error('must not call');};
  const capability=await sign({kind:'photo',id:'photo-one',source:'share',url:'https://photos.example/original.jpg',exp:Date.now()+60000},env);
  const res=await worker.fetch(new Request('https://jian.jahab.workers.dev/api/original/'+capability),env);
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'https://photos.example/original.jpg'); assert.equal(called,false);
});
test('CSRF cannot change an authenticated administrator connection', async () => {
  const env=environment(); const session=await sign({kind:'admin',exp:Date.now()+60000},env);
  const res=await worker.fetch(new Request('https://jian.jahab.workers.dev/admin/disconnect',{method:'POST',headers:{Origin:'https://attacker.example',Cookie:'jian_admin='+session}}),env);
  assert.equal(res.status,403); assert.ok(await env.GALLERY_KV.get('connection'));
});
test('administrator form policy preserves same-origin POST information and valid login succeeds', async () => {
  const env = environment();
  const page = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin'), env);
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin');
  const res = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin/login', {
    method: 'POST', headers: { Origin: env.PUBLIC_ORIGIN },
    body: new URLSearchParams({ password: env.ADMIN_PASSWORD }),
  }), env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const session = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin', { headers: { Cookie: cookie } }), env);
  assert.match(await session.text(), /앨범 연결 확인·새로고침/);
});
test('login rejects foreign, missing and null origins even with the correct password', async () => {
  const env = environment();
  for (const value of ['https://attacker.example', 'null', undefined]) {
    const res = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin/login', {
      method: 'POST', headers: value ? { Origin: value } : {},
      body: new URLSearchParams({ password: env.ADMIN_PASSWORD }),
    }), env);
    assert.equal(res.status, 403);
    assert.equal(res.headers.has('set-cookie'), false);
  }
});
test('OAuth callback rejects missing or mismatched state before exchanging tokens', async () => {
  const env=environment(); let called=false; globalThis.fetch=async()=>{called=true;throw Error('must not call');};
  const res=await worker.fetch(new Request('https://jian.jahab.workers.dev/auth/callback?code=fake&state=fake'),env);
  assert.equal(res.status,403); assert.equal(called,false);
});
test('KV binding type errors tell only the authenticated administrator how to fix the binding', async () => {
  const env = { ...environment(), GALLERY_KV: 'namespace-name-is-not-a-binding' };
  const session = await sign({ kind: 'admin', exp: Date.now() + 60000 }, env);
  const request = new Request(env.PUBLIC_ORIGIN + '/admin/check', {
    method: 'POST', headers: { Origin: env.PUBLIC_ORIGIN, Cookie: 'jian_admin=' + session },
  });
  const result = await worker.fetch(request, env);
  assert.match(await result.text(), /GALLERY_KV 연결 형식 오류/);
  const publicResult = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/api/album'), env);
  assert.doesNotMatch(await publicResult.text(), /GALLERY_KV|namespace-name/);
});
test('KV read failures reveal the failed step to administrators without exposing raw errors', async () => {
  const env = environment();
  env.GALLERY_KV.get = async () => { throw new Error('raw-secret-do-not-show'); };
  const session = await sign({ kind: 'admin', exp: Date.now() + 60000 }, env);
  const result = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin/check', {
    method: 'POST', headers: { Origin: env.PUBLIC_ORIGIN, Cookie: 'jian_admin=' + session },
  }), env);
  const html = await result.text();
  assert.match(html, /실패 단계: KV 연결 정보 읽기/);
  assert.doesNotMatch(html, /raw-secret-do-not-show|test-refresh-token/);
  const publicResult = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/api/album'), env);
  assert.doesNotMatch(await publicResult.text(), /KV 연결 정보|raw-secret-do-not-show/);
});
test('non-JSON Graph responses identify the parsing stage without revealing the response', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'graph-json-diagnostic-test' };
  globalThis.fetch = async (url) => String(url).includes('/oauth2/v2.0/token')
    ? Response.json({ access_token: 'test-owner-token', refresh_token: 'new-test-refresh', expires_in: 3600 })
    : new Response('<html>raw-secret-do-not-show</html>', { status: 200 });
  const session = await sign({ kind: 'admin', exp: Date.now() + 60000 }, env);
  const result = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/admin/check', {
    method: 'POST', headers: { Origin: env.PUBLIC_ORIGIN, Cookie: 'jian_admin=' + session },
  }), env);
  const html = await result.text();
  assert.match(html, /실패 단계: OneDrive 응답 해석 \(HTTP 200\) \/ SyntaxError/);
  assert.doesNotMatch(html, /raw-secret-do-not-show|test-owner-token/);
});
test('OAuth callback stores the connection and returns to the administrator page', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'callback-flow-test' };
  globalThis.fetch = async () => Response.json({ access_token: 'oauth-access-token', refresh_token: 'oauth-refresh-token', expires_in: 3600 });
  const oauth = await sign({ kind: 'oauth', state: 'test-state', verifier: 'test-verifier', exp: Date.now() + 60000 }, env);
  const result = await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/auth/callback?code=test-code&state=test-state', {
    headers: { Cookie: 'jian_oauth=' + oauth },
  }), env);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/admin');
  assert.equal((await env.GALLERY_KV.get('connection', 'json')).refreshToken, 'oauth-refresh-token');
  assert.doesNotMatch(await result.text(), /oauth-access-token|oauth-refresh-token/);
});
test('photo filter excludes folders and unrelated file types', () => {
  assert.equal(isPhoto({id:'x',name:'x.jpg',file:{mimeType:'image/jpeg'}}),true);
  assert.equal(isPhoto({id:'x',name:'private.jpg',folder:{}}),false);
  assert.equal(isPhoto({id:'x',name:'x.txt',file:{mimeType:'text/plain'}}),false);
});
test('a saved 2,354-item snapshot serves a cold visitor without calling Microsoft', async () => {
  const env = { ...environment(), MS_CLIENT_ID: 'persistent-snapshot-test' };
  let calls = 0;
  const items = Array.from({length:2354}, (_, index) => ({ id:'bulk-' + index,
    name: index % 2 ? '20250911_072640236_iOS.jpg' : '20250909_083516466_iOS.jpg',
    file:{mimeType:'image/jpeg'}, createdDateTime:'2026-10-11T12:00:00Z',
    thumbnails:[{medium:{url:'https://photos.example/' + index + '.jpg'}}],
  }));
  globalThis.fetch = async input => {
    const url = String(input); calls++;
    if (url.includes('/oauth2/v2.0/token')) return Response.json({access_token:'bulk-token',refresh_token:'bulk-refresh',expires_in:3600});
    if (!url.includes('children')) return Response.json({id:'owner-album',name:'Bulk album'});
    const offset = Number(new URL(url).searchParams.get('skip') || 0);
    return Response.json({value:items.slice(offset,offset+200), ...(offset+200<items.length ? {'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/items/owner-album/children?skip='+(offset+200)} : {})});
  };
  const session = await sign({kind:'admin',exp:Date.now()+60000},env);
  const warm = await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/admin/check',{method:'POST',headers:{Origin:env.PUBLIC_ORIGIN,Cookie:'jian_admin='+session}}),env);
  assert.equal(warm.status,200); assert.match(await warm.text(),/사진 2354장 · 영상 0개/);
  const scanCalls = calls;
  const coldEnv = {...env,GALLERY_KV:{...env.GALLERY_KV}};
  globalThis.fetch = async()=>{ throw Error('A saved snapshot must not fetch Microsoft'); };
  const start = performance.now();
  const first = await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album'),coldEnv);
  const data = await first.json();
  assert.equal(first.status,200); assert.equal(data.total,2354); assert.equal(data.items.length,60); assert.equal(data.nextOffset,60);
  const firstPageMs = performance.now() - start;
  assert.equal(data.items[0].dateSource,'filename'); assert.equal(new Date(data.items[0].date).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),'2025-09-11');
  assert.equal(calls,scanCalls); assert.ok(data.items.every(item=>!('downloadUrl' in item) && !('driveId' in item)));
  const second = await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album?offset=60&revision='+data.revision),coldEnv);
  const next = await second.json(); assert.equal(next.items.length,60); assert.equal(next.offset,60);
  assert.equal(new Set([...data.items,...next.items].map(item=>item.id)).size,120);
  const favorite = await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorites:['bulk-2353']})}),coldEnv);
  assert.equal((await favorite.json()).items[0].id,'bulk-2353');
  console.log('Saved 2,354-item first page, local mocked storage: '+firstPageMs.toFixed(1)+' ms (zero Microsoft requests)');
  await env.GALLERY_KV.delete('connection');
  const disconnected = await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album'),coldEnv);
  assert.equal(disconnected.status,503);
});
test('page filters, resume location and revision checks preserve global sort order', async () => {
  const env=environment();
  const items=Array.from({length:150},(_,index)=>({id:'item-'+index,name:'item',kind:index%2?'video':'photo',duration:1000, ...mediaDate({name:'20250909_083516466_iOS.jpg'})}));
  const snapshot={key:'album:test',connectionId:'legacy',revision:'revision-one',title:'Test',counts:{photo:75,video:75},items,updatedAt:new Date().toISOString()};
  const videoPage=await albumPage(snapshot,env,new URLSearchParams({type:'video'}));
  assert.equal(videoPage.matched,75); assert.ok(videoPage.items.every(item=>item.kind==='video'));
  const focused=await albumPage(snapshot,env,new URLSearchParams({focus:'item-123',sort:'album'}));
  assert.equal(focused.offset,120); assert.equal(focused.items[focused.focusIndex].id,'item-123');
  await assert.rejects(()=>albumPage(snapshot,env,new URLSearchParams({offset:'60',revision:'old-revision'})),/새로 갱신/);
  await assert.rejects(()=>albumPage(snapshot,env,new URLSearchParams({offset:'-1'})),/목록 위치/);
});
test('a video capability resolves only its current album item and never proxies its contents', async () => {
  const env={...environment(),MS_CLIENT_ID:'video-capability-test'};
  let itemLookups = 0;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/oauth2/v2.0/token')) return Response.json({access_token:'video-token',refresh_token:'video-refresh',expires_in:3600});
    if(url.endsWith('/owner-album')) return Response.json({id:'owner-album'});
    if(url.includes('children')) return Response.json({value:[{id:'movie-one',name:'20250911_072640236_iOS.mp4',file:{mimeType:'video/mp4'},video:{duration:42000},'@microsoft.graph.downloadUrl':'https://photos.example/movie.mp4'}]});
    if(url.endsWith('/movie-one')) { itemLookups++; return Response.json({id:'movie-one',file:{mimeType:'video/mp4'},video:{duration:42000},'@microsoft.graph.downloadUrl':'https://photos.example/movie.mp4'}); }
    throw Error('Video bytes or unrelated items must not be fetched');
  };
  const list=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album?type=video'),env);
  const data=await list.json(); assert.equal(data.counts.video,1); assert.equal(data.items[0].duration,42000);
  const media=await worker.fetch(new Request(env.PUBLIC_ORIGIN+data.items[0].original,{headers:{Range:'bytes=0-100'}}),env);
  assert.equal(media.status,303); assert.equal(media.headers.get('location'),'https://photos.example/movie.mp4');
  assert.equal(itemLookups,0);
  assert.equal((await worker.fetch(new Request(env.PUBLIC_ORIGIN+data.items[0].original+'?mode=bytes'),env)).status,400);
  assert.equal(itemLookups,0);
  const refreshed=await worker.fetch(new Request(env.PUBLIC_ORIGIN+data.items[0].original+'?fresh=1'),env);
  assert.equal(refreshed.status,303); assert.equal(itemLookups,1);
  const wrongScope=await sign({kind:'media',id:'movie-one',scope:'album:other',connectionId:'legacy',exp:Date.now()+60000},env);
  assert.equal((await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/original/'+wrongScope),env)).status,403);
  await env.GALLERY_KV.put('connection',JSON.stringify({refreshToken:'different-owner-refresh',connectionId:'new-owner'}));
  assert.equal((await worker.fetch(new Request(env.PUBLIC_ORIGIN+data.items[0].original),env)).status,403);
});

test('selected photo bytes are streamed for browser conversion without forwarding credentials', async () => {
  const env={...environment(),MS_CLIENT_ID:'photo-bytes-test'};
  mockGraph(1); const upstream=globalThis.fetch, downloads=[];
  const bytes=new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99]);
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.startsWith('https://photos.example/')) {
      downloads.push({url,init});
      assert.equal(init.headers?.Authorization,undefined); assert.equal(init.headers?.Cookie,undefined);
      if(url.endsWith('/original.jpg')) return new Response(null,{status:302,headers:{Location:'https://photos.example/final.heic'}});
      return new Response(bytes,{headers:{'Content-Type':'image/heic'}});
    }
    return upstream(input,init);
  };
  const list=await(await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album'),env)).json();
  const media=await worker.fetch(new Request(env.PUBLIC_ORIGIN+list.items[0].original+'?mode=bytes',{headers:{Cookie:'private-cookie',Authorization:'private-visitor-token'}}),env);
  assert.equal(media.status,200); assert.equal(media.headers.get('Content-Type'),'image/heic');
  assert.equal(media.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await media.arrayBuffer()),bytes); assert.equal(downloads.length,2);
  const forged=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/original/forged?mode=bytes'),env);
  assert.equal(forged.status,403); assert.equal(downloads.length,2);
  await env.GALLERY_KV.put('connection',JSON.stringify({refreshToken:'new-refresh',connectionId:'new-identity'}));
  assert.equal((await worker.fetch(new Request(env.PUBLIC_ORIGIN+list.items[0].original+'?mode=bytes'),env)).status,403);
  assert.equal(downloads.length,2);
});

test('photo byte download rejects an unrelated redirect and excessive conversion size', async () => {
  for(const oversized of [false,true]) {
    const env={...environment(),MS_CLIENT_ID:'photo-bytes-rejection-'+oversized};
    mockGraph(1);const upstream=globalThis.fetch;let downloads=0;
    globalThis.fetch=async(input,init)=>{
      const url=String(input);
      if(url.startsWith('https://photos.example/')) {
        downloads++;
        return oversized ? new Response('oversized',{headers:{'Content-Length':String(33*1024*1024)}}) : new Response(null,{status:302,headers:{Location:'https://attacker.example/steal'}});
      }
      assert.equal(url.includes('attacker.example'),false);
      return upstream(input,init);
    };
    const list=await(await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/album'),env)).json();
    const result=await worker.fetch(new Request(env.PUBLIC_ORIGIN+list.items[0].original+'?mode=bytes'),env);
    assert.equal(result.status,oversized?413:503); assert.equal(downloads,1);
    assert.ok((await result.json()).error);
  }
});
