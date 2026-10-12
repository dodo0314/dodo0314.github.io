import assert from 'node:assert/strict';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'https://gallery.test';
const html = await (await gallery.fetch(new Request(base),{})).text();
const items = Array.from({length:60},(_,index) => ({id:String(index),name:index+'.jpg',kind:'photo',date:'2026-10-10T01:00:00Z',dateSource:'captured',thumbnail:'/preview/'+index+'?size=thumb',preview:'/preview/'+index,original:'/original/'+index}));
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#718b75"/></svg>`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  for (const mode of ['upgrade','failed-upgrade','scroll','viewer','visibility','save-data']) {
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    await context.addInitScript(mode => {
      Object.defineProperty(navigator,'connection',{value:{saveData:mode === 'save-data'}});
      window.fixtureHidden = false; Object.defineProperty(document,'hidden',{get:() => window.fixtureHidden});
    },mode);
    const page = await context.newPage(),errors=[],requests=[],largeRequests=[];
    const activePreviews = new Set(); let maximum = 0;
    page.on('request',request => { if (new URL(request.url()).pathname.startsWith('/preview/')) { activePreviews.add(request); maximum = Math.max(maximum,activePreviews.size); } });
    for (const event of ['requestfinished','requestfailed']) page.on(event,request => activePreviews.delete(request));
    const blocked = new Map(); let hold = true;
    page.setDefaultTimeout(12000); page.on('pageerror',error => errors.push(error.message));
    await page.route(base+'/**',async route => {
      const url = new URL(route.request().url()); requests.push(url.pathname+url.search);
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/api/album') return route.fulfill({json:{title:'지안의 순간들',total:60,matched:60,counts:{photo:60,video:0},items,offset:0,nextOffset:null,revision:'fixture'}});
      if (url.pathname.startsWith('/preview/')) {
        const small = url.searchParams.get('size') === 'thumb';
        if (!small) {
          const id = url.pathname.split('/').at(-1);
          const viewport = await page.locator('.card[data-photo-id="'+id+'"]').evaluate(card => { const box=card.getBoundingClientRect(); window.largeStarted=true; return box.bottom>0 && box.top<innerHeight; }).catch(() => false);
          largeRequests.push({id,viewport});
          if (hold) { blocked.set(route,id); return; }
          if (mode === 'failed-upgrade') return route.fulfill({status:503,body:'Unavailable'}).catch(() => {});
        }
        return route.fulfill({contentType:'image/svg+xml',body:svg(small ? 176 : 800)}).catch(() => {});
      }
      if (url.pathname.startsWith('/original/')) return route.fulfill({contentType:'image/svg+xml',body:svg(2400)}).catch(() => {});
      return route.fulfill({status:404,body:'Not found'});
    });
    const release = async () => {
      const pending=[...blocked]; blocked.clear();
      for (const [route] of pending) await route.fulfill(mode === 'failed-upgrade' ? {status:503,body:'Unavailable'} : {contentType:'image/svg+xml',body:svg(800)}).catch(() => {});
    };
    try {
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => [...document.querySelectorAll('.card img')].slice(0,3).every(img => img.naturalWidth === 176));
      assert.equal(requests.some(url => url.startsWith('/original/')),false);
      if (mode === 'save-data') {
        await page.waitForTimeout(700); assert.equal(largeRequests.length,0);
      } else {
        await page.waitForFunction(() => [...document.querySelectorAll('.card img')].slice(0,3).every(img => img.complete));
        await page.waitForFunction(() => window.largeStarted);
        await page.waitForTimeout(50);
        assert.equal(largeRequests.length,1,'one upgrade runs at a time'); assert.equal(largeRequests[0].viewport,true);
        assert.equal(await page.locator('.card img').first().evaluate(img => img.naturalWidth),176,'keep the thumbnail while the large preview waits');
        if (mode === 'scroll') {
          const first=largeRequests[0].id;
          await page.evaluate(() => scrollTo(0,1800));
          await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(card => Number(card.dataset.photoId)>15 && card.querySelector('img')?.naturalWidth === 176));
          hold=false; await release();
          await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(card => Number(card.dataset.photoId)>15 && card.querySelector('img')?.naturalWidth === 800));
          assert.equal(await page.locator('.card[data-photo-id="'+first+'"] img').evaluate(img => img.naturalWidth),176,'a late result must not replace an offscreen thumbnail');
          assert.ok(largeRequests.every(request => request.viewport),'upgrades only target photos actually on screen');
        } else if (mode === 'viewer') {
          await page.locator('.card').first().click();
          await page.waitForFunction(() => document.querySelector('#photo').dataset.quality === 'original');
          assert.equal(await page.locator('#photo').evaluate(img => img.naturalWidth),2400,'the selected original must finish even when a grid upgrade is blocked');
          const before=largeRequests.length; await release(); await page.waitForTimeout(300);
          assert.equal(largeRequests.length,before,'the viewer pauses grid upgrades');
        } else if (mode === 'visibility') {
          await page.evaluate(() => { window.fixtureHidden=true; document.dispatchEvent(new Event('visibilitychange')); });
          await release(); await page.waitForTimeout(100);
          assert.equal(await page.locator('.card img').first().evaluate(img => img.naturalWidth),176);
          hold=false;
          await page.evaluate(() => { window.fixtureHidden=false; document.dispatchEvent(new Event('visibilitychange')); });
          await page.waitForFunction(() => document.querySelector('.card img').naturalWidth === 800);
        } else {
          hold=false; await release();
          if (mode === 'upgrade') { await page.waitForFunction(() => document.querySelector('.card img').naturalWidth === 800); assert.ok(maximum <= 3,'thumbnails and upgrades share the three-request limit'); }
          else { await page.waitForTimeout(700); assert.equal(await page.locator('.card img').first().evaluate(img => img.naturalWidth),176); assert.equal(await page.locator('.card-error').count(),0); }
        }
      }
      assert.deepEqual(errors,[]); console.log('PASS progressive grid: '+mode);
    } finally { for (const [route] of blocked) await route.abort().catch(() => {}); await page.unrouteAll({behavior:'ignoreErrors'}); await context.close(); }
  }
} finally { await browser.close(); }
