// Optional integration check; native share APIs are mocked because desktop Chromium has no mobile share sheet.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original = Buffer.from([0,0,0,24,102,116,121,112,104,101,105,99,1,2,3]);
const items = ['지안_원본.heic','next.jpg'].map((name,index) => ({
  id:String(index),name,kind:'photo',date:'2026-10-10T01:00:00Z',dateSource:'captured',
  thumbnail:'/preview/'+index,preview:'/preview/'+index,original:'/original/'+index,
}));
// Chromium downloads need a real HTTP response: route.fulfill attachments may emit a cancelled download.
const server = createServer((request,response) => {
  response.writeHead(200,{'Content-Type':'image/heic','Content-Disposition':"attachment; filename=original.heic; filename*=UTF-8''"+encodeURIComponent(items[0].name)});
  response.end(original);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:'+server.address().port;
const html = await (await gallery.fetch(new Request(base), {})).text();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  for (const mode of ['supported','activation-expired','unsupported','format-rejected','not-allowed','cancelled','retry','navigation','download-failed','too-large','timeout']) {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
    await context.addInitScript(mode => {
      window.shares = []; window.activation = mode !== 'activation-expired'; window.shareAttempts = 0;
      Object.defineProperty(navigator,'userActivation',{value:{get isActive(){return window.activation;}}});
      Object.defineProperty(navigator,'canShare',{value:mode === 'unsupported' ? undefined : data => mode !== 'format-rejected' && data.files?.[0] instanceof File});
      Object.defineProperty(navigator,'share',{value:mode === 'unsupported' ? undefined : async data => {
        window.shareAttempts++;
        if (mode === 'not-allowed' && window.shareAttempts === 1) throw new DOMException('Activation expired','NotAllowedError');
        if (mode === 'cancelled') throw new DOMException('Cancelled','AbortError');
        window.shares.push({keys:Object.keys(data),name:data.files[0].name,type:data.files[0].type,bytes:[...new Uint8Array(await data.files[0].arrayBuffer())]});
      }});
    },mode);
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(10000); page.on('pageerror',error => errors.push(error.message));
    await page.route(base+'/**', async route => {
      const url = new URL(route.request().url()); requests.push(url.pathname+url.search);
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/api/album') return route.fulfill({json:{title:'지안의 순간들',total:2,matched:2,counts:{photo:2,video:0},items,offset:0,nextOffset:null,revision:'fixture'}});
      if (url.pathname === '/api/item') return route.fulfill(mode === 'download-failed' ? {status:503,json:{error:'unavailable'}} : {json:{...items[Number(url.searchParams.get('id'))],original:'/original/'+url.searchParams.get('id')+'?fresh=1'}});
      if (url.pathname.startsWith('/preview/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#bcc7ac"/></svg>'});
      if (url.pathname.startsWith('/original/')) {
        if (url.searchParams.get('mode') === 'download') return route.continue();
        if (url.searchParams.get('mode') === 'bytes') {
          if (mode === 'retry' && !url.searchParams.has('fresh')) return route.fulfill({status:403,body:'Expired'});
          if (mode === 'too-large') return route.fulfill({status:413,body:'Too large'});
          if (mode === 'timeout') return;
          if (mode === 'navigation') await new Promise(resolve => setTimeout(resolve,500));
          return route.fulfill({contentType:'application/octet-stream',body:original});
        }
        return route.fulfill({status:503,body:'Unavailable display original'});
      }
      return route.fulfill({status:404,body:'Not found'});
    });
    await page.goto(base); await page.locator('.card').first().click();
    if (mode === 'supported') {
      for (const [width,height] of [[320,568],[390,844],[820,1180],[1440,1000],[844,390]]) {
        await page.setViewportSize({width,height});
        assert.equal(await page.evaluate(() => {
          const stage = document.querySelector('#stage').getBoundingClientRect();
          const bottom = document.querySelector('.viewer-bottom').getBoundingClientRect();
          return stage.bottom <= bottom.top + 1 && [...document.querySelectorAll('.original-actions button')].every(button => {
            const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
          });
        }),true,'buttons stay visible and clear of the photo at '+width+'px');
      }
      await page.setViewportSize({width:390,height:844});
      const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(),items[0].name); assert.equal(await download.failure(),null);
      assert.deepEqual(await readFile(await download.path()),original);
      assert.equal(new URL(download.url()).pathname+new URL(download.url()).search,'/original/0?fresh=1&mode=download');
      assert.equal(await page.locator('#viewer').evaluate(dialog => dialog.open),true);
    }
    if (mode === 'download-failed') {
      await page.locator('#download').click(); await page.waitForFunction(() => document.querySelector('#action-status').textContent.includes('준비하지 못'));
      assert.equal(await page.locator('#download').isEnabled(),true);
    } else {
      if (mode === 'timeout') await page.clock.install();
      await page.locator('#share').click();
      if (mode === 'timeout') await page.clock.fastForward(61000);
      if (mode === 'activation-expired' || mode === 'not-allowed') {
        await page.waitForFunction(() => document.querySelector('#share').textContent === '공유하기 ↗');
        assert.deepEqual(await page.evaluate(() => window.shares),[]);
        const requestsBefore = requests.filter(url => url.includes('mode=bytes')).length;
        await page.evaluate(() => {window.activation = true;}); await page.locator('#share').click();
        await page.waitForFunction(() => window.shares.length === 1);
        assert.equal(requests.filter(url => url.includes('mode=bytes')).length,requestsBefore,'the second tap reuses the original file');
      }
      if (['supported','activation-expired','not-allowed','retry'].includes(mode)) {
        await page.waitForFunction(() => window.shares.length === 1);
        assert.deepEqual(await page.evaluate(() => window.shares[0]),{keys:['files'],name:items[0].name,type:'image/heic',bytes:[...original]});
      } else if (mode === 'unsupported' || mode === 'format-rejected') {
        await page.waitForFunction(() => document.querySelector('#action-status').textContent.includes('파일 앱'));
        assert.deepEqual(await page.evaluate(() => window.shares),[]);
        if (mode === 'unsupported') assert.equal(requests.some(url => url.includes('mode=bytes')),false);
      } else if (mode === 'cancelled') {
        await page.waitForFunction(() => window.shareAttempts === 1 && !document.querySelector('#share').disabled);
        assert.equal(await page.locator('#action-status').isVisible(),false);
      } else if (mode === 'navigation') {
        await page.locator('#next').click(); await page.waitForTimeout(650);
        assert.deepEqual(await page.evaluate(() => window.shares),[]);
        assert.equal(await page.locator('#photo-name').textContent(),items[1].name);
        assert.equal(await page.locator('#action-status').isVisible(),false);
      } else if (mode === 'too-large' || mode === 'timeout') {
        await page.waitForFunction(() => !document.querySelector('#share').disabled && document.querySelector('#action-status').textContent.includes('다운로드'));
        assert.deepEqual(await page.evaluate(() => window.shares),[]);
        if (mode === 'too-large') assert.equal(requests.filter(url => url.includes('mode=bytes')).length,1,'oversized originals should not be fetched twice');
      }
    }
    if (mode === 'supported') {
      const artifacts = process.env.GALLERY_ARTIFACTS || join(tmpdir(),'jian-original-actions'); await mkdir(artifacts,{recursive:true});
      await page.screenshot({path:join(artifacts,'viewer-mobile.png')});
      await page.locator('#next').click(); await page.locator('#share').click();
      await page.waitForFunction(() => window.shares.length === 2);
      assert.equal(await page.evaluate(() => window.shares[1].name),items[1].name,'navigation shares the newly selected original');
      assert.equal(await page.evaluate(() => window.shares[1].type),'image/jpeg');
    }
    assert.deepEqual(errors,[]); await context.close();
    console.log('PASS original actions: '+mode);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
