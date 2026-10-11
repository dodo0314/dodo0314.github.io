// Playwright integration: optional HEIC_SAMPLE points to a real, non-private HEIC fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'https://gallery.test';
const heic = process.env.HEIC_SAMPLE ? await readFile(process.env.HEIC_SAMPLE) : null;
const svg = width => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="800"><rect width="100%" height="100%" fill="#bdc4a4"/></svg>`;
const items = Array.from({length:60},(_,index) => ({id:String(index),name:'20261010_'+index+(index<2 ? '.heic' : '.jpg'),kind:'photo',date:'2026-10-10T01:00:00Z',dateSource:'filename',thumbnail:'/preview/'+index+'?size=thumb',preview:'/preview/'+index,original:'/original/'+index}));
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Seoul'});
const blocked = new Set();
try {
  await context.addInitScript(() => {
    window.fixtureHidden = false;
    Object.defineProperty(document,'hidden',{get:() => window.fixtureHidden});
    localStorage.setItem('jian-last-viewed','old-position');
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror',error => errors.push(error.message));
  let active = 0, maximum = 0, previews = 0, originals = 0, generation = 0;
  let holdPreview = false, holdOriginal = false, failOriginal = false, holdItem = false;
  await context.route(base+'/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/album') return route.fulfill({json:{title:'지안의 순간들',total:60,matched:60,counts:{photo:60,video:0},items:items.map(item => ({...item,thumbnail:item.thumbnail+'&generation='+generation,preview:item.preview+'?generation='+generation})),offset:0,nextOffset:null,revision:'fixture'}});
    if (url.pathname.startsWith('/preview/')) {
      previews++;
      if (holdPreview) { blocked.add(route); return; }
      active++; maximum=Math.max(maximum,active);
      await new Promise(resolve => setTimeout(resolve,120)); active--;
      return route.fulfill({contentType:'image/svg+xml',body:svg(800)}).catch(() => {});
    }
    if (url.pathname.startsWith('/original/')) {
      originals++;
      if (holdOriginal) { blocked.add(route); return; }
      if (failOriginal) return route.fulfill({status:503,body:'Unavailable'});
      return route.fulfill({contentType:heic ? 'application/octet-stream' : 'image/svg+xml',body:heic || svg(1200)});
    }
    if (url.pathname === '/api/item') {
      if (holdItem) { blocked.add(route); return; }
      return route.fulfill({json:items[Number(url.searchParams.get('id'))]});
    }
    const result = await gallery.fetch(new Request(url),{});
    return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});
  });
  await page.goto(base);
  await page.waitForFunction(() => [...document.querySelectorAll('.card img')].slice(0,3).every(img => img.naturalWidth));
  await page.waitForTimeout(800);
  assert.ok(maximum <= 3,'the grid limits simultaneous image requests to three');
  assert.ok(previews < 25,'offscreen images must not saturate the connection');
  assert.equal(originals,0,'the grid never downloads original HEICs');
  assert.equal(await page.locator('#resume,#resume-button,.tab-symbol,#zoom,#play,#fullscreen,#close').count(),0);
  assert.deepEqual(await page.locator('.viewer-tools button').evaluateAll(buttons => buttons.map(button => button.id)),['home','like']);
  assert.equal(await page.locator('.period-picker').evaluate(picker => {
    const label = picker.querySelector('label').getBoundingClientRect(),select = picker.querySelector('select').getBoundingClientRect();
    return label.right <= select.left && getComputedStyle(picker).borderTopWidth === '0px';
  }),true,'the period label sits outside the bordered select');

  // An interrupted grid restarts on visibility restoration.
  holdPreview = true; generation++; await page.locator('#refresh').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.card img')].some(img => img.getAttribute('src')));
  const beforeScroll = previews;
  await page.evaluate(() => scrollTo(0,1800));
  await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(card => Number(card.dataset.photoId)>15 && card.querySelector('img')?.getAttribute('src')));
  await page.waitForTimeout(100);
  assert.ok(previews > beforeScroll,'scrolling cancels blocked offscreen work and starts the newly visible photos');
  await page.evaluate(() => { window.fixtureHidden=true; document.dispatchEvent(new Event('visibilitychange')); });
  const paused = previews; await page.waitForTimeout(100); assert.equal(previews,paused);
  holdPreview = false;
  await page.evaluate(() => { scrollTo(0,0); window.fixtureHidden=false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.card img')?.naturalWidth === 800);

  // A suspended HEIC download is cancelled; resuming the page starts a fresh, bounded load.
  holdOriginal = true; await page.locator('.card').first().click();
  await page.waitForFunction(() => document.querySelector('#viewer').open);
  await page.waitForTimeout(450); assert.ok(originals >= 1);
  await page.evaluate(() => { window.fixtureHidden=true; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#quality-status').textContent(),'미리보기');
  holdOriginal = false;
  await page.evaluate(() => { window.fixtureHidden=false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => ['original','converted'].includes(document.querySelector('#photo').dataset.quality));
  assert.equal(await page.locator('#photo').evaluate(img => img.naturalWidth),heic ? 1280 : 1200);
  const afterOpen = previews;
  await page.locator('#like').click(); await page.waitForTimeout(100);
  assert.equal(previews,afterOpen,'liking a photo must not recreate and reload the grid');
  await page.locator('#home').click(); await page.waitForFunction(() => !document.querySelector('#viewer').open);

  // Model a metadata refresh that never responds. The deadline must clear "HEIC 준비 중".
  await page.clock.install(); failOriginal=true; holdItem=true;
  await page.locator('.card').nth(1).click(); await page.clock.fastForward(400);
  await page.waitForTimeout(100);
  assert.ok([...blocked].some(route => route.request().url().includes('/api/item')));
  await page.clock.fastForward(16000);
  await page.waitForFunction(() => document.querySelector('#quality-status').textContent.includes('원본 다운로드에 실패'));
  assert.equal(await page.locator('#photo').isVisible(),true,'the decoded preview remains usable');
  assert.equal(await page.locator('#photo-loading').isVisible(),false);
  failOriginal=false; holdItem=false;
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.clock.fastForward(400);
  await page.waitForFunction(() => ['original','converted'].includes(document.querySelector('#photo').dataset.quality));
  await page.locator('#home').click();
  assert.deepEqual(errors,[]);
  console.log('PASS three-request viewport queue, grid and HEIC visibility recovery, bounded metadata retry, online recovery, no grid reload on like, two toolbar buttons, external period label, removed resume');
} finally {
  for (const route of blocked) await route.abort().catch(() => {});
  await context.close(); await browser.close();
}
