// Desktop Chromium checks real PNG clipboard contents; mobile share sheets are mocked.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import gallery from '../dist/worker.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
function png(width,height) {
  const chunk = (type,data) => {
    const input=Buffer.concat([Buffer.from(type),data]); let crc=0xffffffff;
    for (const byte of input) { crc ^= byte; for (let bit=0; bit<8; bit++) crc=(crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const head=Buffer.alloc(4),tail=Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head,input,tail]);
  };
  const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const pixels=Buffer.alloc((width*3+1)*height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) { const i=y*(width*3+1)+1+x*3; pixels[i]=31; pixels[i+1]=127; pixels[i+2]=211; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const original=png(1600,1200);
const largeOriginal=png(4096,3072);
// The HEIC name uses PNG bytes to test native decoding independently of the optional HEIC fixture.
const items=['지안_원본.heic','next.jpg'].map((name,index) => ({id:String(index),name,kind:'photo',date:'2026-10-10T01:00:00Z',dateSource:'captured',thumbnail:'/preview/'+index+'?size=thumb',preview:'/preview/'+index,original:'/original/'+index}));
const server=createServer((request,response) => { response.writeHead(200,{'Content-Type':'image/png','Content-Disposition':"attachment; filename=original.heic; filename*=UTF-8''"+encodeURIComponent(items[0].name)}); response.end(original); });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const html=await (await gallery.fetch(new Request(base),{})).text();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  for (const mode of ['supported','delayed','unsupported','format-rejected','share-refused','cancelled','retry','navigation','too-large','timeout','copy-unsupported','copy-refused','copy-real','copy-blank','copy-corrupt','copy-repeat','copy-small','copy-small-real','copy-navigation']) {
    const sourceBytes = mode.startsWith('copy-small') ? largeOriginal : original;
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
    if (mode === 'copy-real' || mode === 'copy-small-real') await context.grantPermissions(['clipboard-read','clipboard-write']);
    await context.addInitScript(mode => {
      window.shares=[]; window.invocations=[]; window.copies=[];
      if (mode === 'copy-navigation') {
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = async function() { await new Promise(resolve => setTimeout(resolve,500)); return decode.call(this); };
      }
      if (mode === 'copy-blank' || mode === 'copy-corrupt') {
        const encode = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(callback,...args) {
          if (this.width > 1) {
            if (mode === 'copy-corrupt') { queueMicrotask(() => callback(new Blob(['corrupt-png'],{type:'image/png'}))); return; }
            const context = this.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,this.width,this.height);
          }
          return encode.call(this,callback,...args);
        };
      }
      Object.defineProperty(navigator,'canShare',{value:mode === 'unsupported' ? undefined : data => mode !== 'format-rejected' && data.files?.[0] instanceof File});
      Object.defineProperty(navigator,'share',{value:mode === 'unsupported' ? undefined : async data => {
        window.invocations.push({active:navigator.userActivation.isActive});
        if (mode === 'share-refused') throw new DOMException('Denied','NotAllowedError');
        if (mode === 'cancelled') throw new DOMException('Cancelled','AbortError');
        window.shares.push({keys:Object.keys(data),name:data.files[0].name,type:data.files[0].type,bytes:[...new Uint8Array(await data.files[0].arrayBuffer())]});
      }});
      if (mode === 'copy-unsupported') Object.defineProperty(navigator,'clipboard',{value:undefined});
      else if (mode !== 'copy-real' && mode !== 'copy-small-real') Object.defineProperty(navigator,'clipboard',{value:{write:async items => {
        const active=navigator.userActivation.isActive;
        if (mode === 'copy-refused') throw new DOMException('Denied','NotAllowedError');
        const blob=await items[0].getType('image/png'),bitmap=await createImageBitmap(blob);
        window.copies.push({types:items[0].types,active,width:bitmap.width,height:bitmap.height}); bitmap.close();
      }}});
    },mode);
    const page=await context.newPage(),errors=[],requests=[];
    page.setDefaultTimeout(12000); page.on('pageerror',error => errors.push(error.message));
    await page.route(base+'/**',async route => {
      const url=new URL(route.request().url()); requests.push(url.pathname+url.search);
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/api/album') return route.fulfill({json:{title:'지안의 순간들',total:2,matched:2,counts:{photo:2,video:0},items,offset:0,nextOffset:null,revision:'fixture'}});
      if (url.pathname === '/api/item') return route.fulfill({json:{...items[Number(url.searchParams.get('id'))],original:'/original/'+url.searchParams.get('id')+'?fresh=1'}});
      if (url.pathname.startsWith('/preview/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><rect width="176" height="176" fill="#bcc7ac"/></svg>'});
      if (url.pathname.startsWith('/original/')) {
        if (url.searchParams.get('mode') === 'download') return route.continue();
        if (mode === 'timeout') return;
        if (mode === 'too-large') return route.fulfill({status:413,body:'Too large'});
        if (mode === 'retry' && !url.searchParams.has('fresh')) return route.fulfill({status:403,body:'Expired'});
        if (mode === 'delayed' || (mode === 'navigation' && url.pathname.endsWith('/0'))) await new Promise(resolve => setTimeout(resolve,800));
        return route.fulfill({contentType:'image/png',body:sourceBytes}).catch(() => {});
      }
      return route.fulfill({status:404,body:'Not found'});
    });
    await page.goto(base);
    assert.equal(requests.some(url => url.includes('mode=bytes')),false,'the thumbnail grid must not download originals');
    if (mode === 'timeout') await page.clock.install();
    const initial=await page.evaluate(() => { document.querySelector('.card').click(); return {download:document.querySelector('#download').disabled,share:document.querySelector('#share').disabled,copy:document.querySelector('#copy').disabled}; });
    assert.equal(initial.share,true); assert.equal(initial.copy,true);
    if (mode !== 'unsupported') assert.equal(initial.download,true,'the chooser button waits for prepared source bytes');
    if (mode === 'navigation') { await page.waitForTimeout(400); await page.locator('#next').click(); }
    if (mode === 'timeout') { await page.clock.fastForward(400); await page.waitForTimeout(50); await page.clock.fastForward(61000); }
    if (mode === 'too-large' || mode === 'timeout') {
      await page.waitForFunction(() => !document.querySelector('#download').disabled && document.querySelector('#download').textContent.includes('파일 다운로드'));
      assert.equal(await page.locator('#share').isEnabled(),false); assert.equal(await page.locator('#copy').isEnabled(),false);
      assert.equal(requests.filter(url => url.startsWith('/api/item')).length,0,'oversized files must not trigger metadata retry');
    } else {
      await page.waitForFunction(() => document.querySelector('#photo').dataset.quality === 'original');
      if (mode === 'unsupported' || mode === 'format-rejected') {
        assert.match(await page.locator('#download').textContent(),/파일 다운로드/); assert.equal(await page.locator('#share').isEnabled(),false);
        const next=page.waitForEvent('download'); await page.locator('#download').click(); const download=await next;
        assert.equal(await download.failure(),null); assert.equal(download.suggestedFilename(),items[0].name); assert.deepEqual(await readFile(await download.path()),original);
      } else {
        const before=requests.filter(url => url.includes('mode=bytes') || url.startsWith('/api/item')).length;
        await page.locator('#download').click(); await page.waitForFunction(() => window.invocations.length === 1 && !document.querySelector('#download').disabled);
        assert.equal(await page.evaluate(() => window.invocations[0].active),true,'native share is called during the download tap');
        assert.equal(requests.filter(url => url.includes('mode=bytes') || url.startsWith('/api/item')).length,before,'the chooser must not fetch or refresh the original again');
        assert.equal(await page.locator('#save-options').count(),0,'no intermediary app dialog');
        if (mode === 'cancelled') assert.equal(await page.locator('#action-status').isVisible(),false);
        else if (mode === 'share-refused') assert.match(await page.locator('#download').textContent(),/파일 다운로드/);
        else {
          await page.waitForFunction(() => window.shares.length === 1); const index=mode === 'navigation' ? 1 : 0;
          assert.deepEqual(await page.evaluate(() => window.shares[0]),{keys:['files'],name:items[index].name,type:index ? 'image/jpeg' : 'image/heic',bytes:[...sourceBytes]});
        }
      }
      if (mode === 'copy-unsupported') { assert.equal(await page.locator('#copy').isEnabled(),false); assert.match(await page.locator('#copy').textContent(),/미지원/); }
      else {
        await page.locator(mode.startsWith('copy-small') ? '#copy-small' : '#copy').click();
        if (mode === 'copy-navigation') { await page.locator('#next').click(); await page.waitForTimeout(1200); }
        await page.waitForFunction(() => !document.querySelector('#copy').disabled);
        if (mode === 'copy-navigation') { assert.deepEqual(await page.evaluate(() => window.copies),[]); assert.equal(await page.locator('#photo-name').textContent(),items[1].name); }
        else if (['copy-refused','copy-blank','copy-corrupt'].includes(mode)) { assert.match(await page.locator('#action-status').textContent(),/완료하지 못/); assert.deepEqual(await page.evaluate(() => window.copies),[]); }
        else if (mode === 'copy-real' || mode === 'copy-small-real') {
          const copied=await page.evaluate(async () => {
            const [item]=await navigator.clipboard.read(),blob=await item.getType('image/png'),bitmap=await createImageBitmap(blob);
            const canvas=document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height; const context=canvas.getContext('2d'); context.drawImage(bitmap,0,0);
            const result={type:blob.type,width:bitmap.width,height:bitmap.height,pixel:[...context.getImageData(10,10,1,1).data]}; bitmap.close(); return result;
          });
          assert.deepEqual(copied,{type:'image/png',width:mode === 'copy-small-real' ? 2048 : 1600,height:mode === 'copy-small-real' ? 1536 : 1200,pixel:[31,127,211,255]});
        } else {
          assert.deepEqual(await page.evaluate(() => window.copies[0]),{types:['image/png'],active:true,width:mode === 'copy-small' ? 2048 : 1600,height:mode === 'copy-small' ? 1536 : 1200});
          if (mode === 'copy-repeat') {
            await page.locator('#copy').click(); await page.waitForFunction(() => window.copies.length === 2 && !document.querySelector('#copy').disabled);
            assert.deepEqual(await page.evaluate(() => window.copies[1]),{types:['image/png'],active:true,width:1600,height:1200});
          }
        }
      }
      if (mode === 'supported') {
        for (const [width,height] of [[320,568],[390,844],[820,1180],[1440,1000],[844,390]]) {
          await page.setViewportSize({width,height});
          assert.equal(await page.evaluate(() => {
            const stage=document.querySelector('#stage').getBoundingClientRect(),bottom=document.querySelector('.viewer-bottom').getBoundingClientRect();
            return stage.bottom <= bottom.top+1 && [...document.querySelectorAll('.original-actions button')].every(button => { const box=button.getBoundingClientRect(); return box.left>=0 && box.right<=innerWidth && box.bottom<=innerHeight; });
          }),true,'all actions and the photo fit at '+width+'px');
        }
        await page.setViewportSize({width:390,height:844}); const artifacts=process.env.GALLERY_ARTIFACTS || join(tmpdir(),'jian-original-actions'); await mkdir(artifacts,{recursive:true}); await page.screenshot({path:join(artifacts,'viewer-copy-mobile.png')});
        await page.locator('#home').click(); const before=requests.filter(url => url.includes('mode=bytes')).length; await page.locator('.card').first().click(); await page.waitForFunction(() => document.querySelector('#photo').dataset.quality === 'original');
        assert.equal(requests.filter(url => url.includes('mode=bytes')).length,before,'reopening uses the bounded original cache');
      }
    }
    assert.deepEqual(errors,[]); await context.close(); console.log('PASS original actions: '+mode);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
