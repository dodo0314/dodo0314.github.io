// Playwright: invitation entry, the locked screen and the ?timing=1 first-screen display.
import assert from 'node:assert/strict';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'https://gallery.test';
const html = await (await gallery.fetch(new Request(base),{})).text();
const items = Array.from({length:30},(_,index) => ({id:String(index),name:index+'.jpg',kind:'photo',date:'2026-10-10T01:00:00Z',dateSource:'captured',thumbnail:'/grid/'+index+'?size=thumb',preview:'/grid/'+index,original:'/original/'+index}));
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#8c9a7c"/></svg>`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  for (const mode of ['no-invitation','wrong-invitation','invitation','timing']) {
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    const page = await context.newPage(), errors = [], requests = [];
    let joined = mode === 'timing';
    page.setDefaultTimeout(12000); page.on('pageerror',error => errors.push(error.message));
    await page.route(base+'/**',async route => {
      const request = route.request(), url = new URL(request.url()); requests.push(url.pathname);
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/api/join') {
        assert.equal(request.method(),'POST');
        const right = JSON.parse(request.postData()).key === 'right-invitation-key-0123456789';
        joined ||= right;
        return route.fulfill(right ? {json:{ok:true}} : {status:403,json:{error:'초대 링크가 맞지 않아요.'}});
      }
      if (url.pathname === '/api/album') return route.fulfill(joined ? {json:{title:'지안의 순간들',total:30,matched:30,counts:{photo:30,video:0},items,offset:0,nextOffset:null,revision:'fixture'}} : {status:401,json:{error:'초대받은 분만 볼 수 있어요.'}});
      if (url.pathname.startsWith('/grid/')) {
        const small = url.searchParams.get('size') === 'thumb';
        return route.fulfill({contentType:'image/svg+xml',body:svg(small ? 176 : 800)}).catch(() => {});
      }
      return route.fulfill({status:404,body:'Not found'});
    });
    try {
      const hash = mode === 'invitation' ? '#k=right-invitation-key-0123456789' : mode === 'wrong-invitation' ? '#k=a-stale-invitation-key' : '';
      await page.goto(base + (mode === 'timing' ? '/?timing=1' : '/') + hash);
      if (mode === 'no-invitation' || mode === 'wrong-invitation') {
        await page.waitForFunction(() => document.querySelector('#status h2')?.textContent === '초대받은 분만 볼 수 있어요');
        const detail = await page.locator('#status p').textContent();
        assert.match(detail,mode === 'wrong-invitation' ? /새 초대 링크/ : /받은 초대 링크로 열어/);
        assert.equal(await page.locator('.card').count(),0); assert.equal(await page.locator('#retry').isVisible(),false);
        assert.equal(requests.includes('/api/join'),mode === 'wrong-invitation');
      } else if (mode === 'invitation') {
        await page.waitForFunction(() => document.querySelectorAll('.card img').length === 30);
        assert.ok(requests.indexOf('/api/join') >= 0 && requests.indexOf('/api/join') < requests.indexOf('/api/album'),'join completes before the album is requested');
      } else {
        await page.waitForFunction(() => /선명/.test(document.querySelector('#timing')?.textContent || ''),null,{timeout:20000});
        const text = await page.locator('#timing').textContent();
        assert.match(text,/^첫 화면 \d+칸 · 다 뜸 \d+\.\d초 · 선명 \d+\.\d초/);
        await page.locator('#timing').click(); assert.equal(await page.locator('#timing').count(),0);
      }
      assert.equal(await page.evaluate(() => location.hash),'','the invitation key leaves the address bar');
      assert.deepEqual(errors,[]); console.log('PASS invitation: '+mode);
    } finally { await page.unrouteAll({behavior:'ignoreErrors'}); await context.close(); }
  }
} finally { await browser.close(); }
