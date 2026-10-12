// Optional integration check: install Playwright locally, or set PLAYWRIGHT_MODULE and CHROMIUM_PATH.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = await (await gallery.fetch(new Request('https://gallery.test/'), {})).text();
const base = 'https://gallery.test';
const items = Array.from({length:60}, (_, index) => ({
  id:String(index), name:'20261010_' + index + '.jpg', kind:'photo',
  date:'2026-10-10T01:00:00Z', dateSource:'filename', uploadedAt:'2026-10-11T01:00:00Z',
  thumbnail:'/preview/' + index + '?size=thumb', preview:'/preview/' + index, original:'/original/' + index,
}));
const svg = (width, index = 0) => {
  const palettes = [['#bcc7ac','#e9d3aa','#687c65'],['#d5b4a4','#f2dfba','#9d7062'],['#a4bec2','#e5dec9','#637f88']];
  const [sky, sun, hill] = palettes[index % palettes.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}"><rect width="100%" height="100%" fill="${sky}"/><circle cx="${width * .68}" cy="${width * .3}" r="${width * .15}" fill="${sun}"/><path d="M0 ${width * .75}Q${width * .25} ${width * .4} ${width * .55} ${width * .72}T${width} ${width * .6}V${width}H0" fill="${hill}"/></svg>`;
};
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  for (const saveData of [false, true]) {
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,timezoneId:'Asia/Seoul'});
    await context.addInitScript(value => Object.defineProperty(navigator,'connection',{value:{saveData:value}}), saveData);
    const page = await context.newPage(), errors = [], originals = [], previews = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    let failLarge = false, failSmall = false;
    await page.route(base + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/api/album') return route.fulfill({json:{title:'지안의 순간들',total:60,counts:{photo:60,video:0},matched:60,items:failLarge || failSmall ? items.map(item => ({...item,preview:item.preview + '?generation='+(failSmall ? 'small-failed' : 'large-failed'),thumbnail:item.thumbnail + '&generation='+(failSmall ? 'small-failed' : 'large-failed')})) : items,offset:0,nextOffset:null,revision:'fixture'}});
      if (url.pathname.startsWith('/preview/')) {
        previews.push(url.pathname + url.search);
        const small = url.searchParams.get('size') === 'thumb';
        if (failSmall && small) return route.fulfill({status:503,body:'Unavailable thumbnail'});
        if (failLarge && !small) return route.fulfill({status:503,body:'Unavailable preview'});
        return route.fulfill({contentType:'image/svg+xml',body:svg(small ? 176 : 800, Number(url.pathname.split('/').at(-1)))});
      }
      if (url.pathname.startsWith('/original/')) {
        originals.push(url.pathname); await new Promise(resolve => setTimeout(resolve, 600));
        return route.fulfill({contentType:'image/svg+xml',body:svg(2400)});
      }
      return route.fulfill({status:404,body:'Not found'});
    });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('.card img').length === 60 && [...document.querySelectorAll('.card img')].slice(0,3).every(img => img.complete && img.naturalWidth));
    assert.equal(originals.length,0, 'the grid must never download originals');
    const initialWidth = await page.locator('.card img').first().evaluate(img => img.naturalWidth);
    assert.ok(saveData ? initialWidth === 176 : [176,800].includes(initialWidth));
    for (const url of previews.filter(value => new URL(value,base).searchParams.get('size') !== 'thumb')) {
      const path = new URL(url,base).pathname;
      assert.ok(previews.findIndex(value => new URL(value,base).pathname === path && new URL(value,base).searchParams.get('size') === 'thumb') < previews.indexOf(url),'each large grid preview follows its small thumbnail');
    }
    // These assertions run in the click task itself, before any fresh image request can complete.
    const immediate = await page.evaluate(() => {
      const thumb = document.querySelector('.card img').currentSrc;
      document.querySelector('.card').click();
      const img = document.querySelector('#photo');
      return {src:img.src,thumb,hidden:img.hidden,loading:document.querySelector('#photo-loading').hidden};
    });
    assert.equal(immediate.src,immediate.thumb); assert.equal(immediate.hidden,false); assert.equal(immediate.loading,true);
    await page.evaluate(() => document.querySelector('#next').click());
    await page.waitForFunction(() => document.querySelector('#photo').dataset.quality === 'original');
    assert.deepEqual(originals,['/original/1'],'rapidly skipped photos must not start an original download');
    assert.equal(await page.locator('#photo').evaluate(img => img.naturalWidth),2400);
    await page.locator('#home').click();
    if (!saveData) {
      await page.locator('.card').nth(30).click();
      await page.evaluate(() => { for (let index = 0; index < 12; index++) document.querySelector('#next').click(); });
      await page.locator('#home').click();
      await page.waitForFunction(() => !document.querySelector('#viewer').open && document.activeElement?.dataset.photoId === '42');
      assert.equal(await page.locator('.card').nth(42).evaluate(card => {
        const rect = card.getBoundingClientRect(); return rect.top >= -1 && rect.bottom <= innerHeight + 1;
      }),true,'home returns to the last viewed photo after navigation, rather than the page top or initially opened photo');
      await page.evaluate(() => scrollTo(0,0));
      for (const width of [320,390,820,1440]) {
        await page.setViewportSize({width,height:width === 1440 ? 1000 : 844});
        for (const period of ['day','week','month','year']) {
          await page.locator('#period').selectOption(period);
          assert.equal(await page.locator('.grid').first().evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length),3);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.locator('#period').selectOption('day');
      const artifacts = process.env.GALLERY_ARTIFACTS || join(tmpdir(),'jian-profile-check');
      await mkdir(artifacts,{recursive:true});
      await page.screenshot({path:join(artifacts,'jian-profile-mobile.png')});
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:join(artifacts,'jian-profile-desktop.png')});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.locator('.card').nth(4).click();
      assert.equal(await page.locator('#photo').evaluate(img => img.getAnimations().length),0);
      await page.locator('#home').click();
      await page.evaluate(() => scrollTo(0,0));
      failSmall = true;
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelector('.card img')?.naturalWidth === 800);
      assert.equal(await page.locator('.card-error').count(),0,'small thumbnail failure falls back to a large preview');
      failSmall = false; failLarge = true;
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelector('.card img')?.naturalWidth === 176);
      assert.equal(await page.locator('.card-error').count(),0,'large preview failure falls back to the smaller thumbnail');
      await page.locator('.card').first().click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#photo').isVisible(),true);
      assert.equal(await page.locator('#quality-status').textContent().then(text => text.includes('못했')),false,'a preview failure must not report an original failure while the original is still pending');
      await page.waitForFunction(() => document.querySelector('#photo').dataset.quality === 'original');
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('PASS small thumbnails in the grid, home returns to the last viewed card, 3-column grid at 320/390/820/1440px, every period, instant decoded-image reuse, progressive original, skipped-download cancellation, reduced motion, data saving, thumbnail fallback');
} finally { await browser.close(); }
