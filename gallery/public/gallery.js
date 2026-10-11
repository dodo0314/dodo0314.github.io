(() => {
  'use strict';
  /* PERIOD_HELPERS */
  const $ = id => document.getElementById(id);
  const viewer = $('viewer'), image = $('photo'), video = $('video'), stage = $('stage');
  let visible = [], current = -1, selected = null, onlyFavorites = false;
  let showVersion = 0, lastFocused, refreshing = false, paging = false;
  let page = null, baseOffset = 0, loadVersion = 0, controller;
  let favorites = new Set();
  let previewLoad, originalLoad, originalReady = false;
  const originalCache = new Map();
  const previewCache = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = navigator.connection?.saveData;
  function rememberPreview(id, element) {
    if (!element.complete || !element.naturalWidth) return;
    previewCache.delete(id); previewCache.set(id, {element, savedAt:Date.now()});
    if (previewCache.size > 12) previewCache.delete(previewCache.keys().next().value);
  }
  function readyPreview(id) {
    const cached = previewCache.get(id);
    if (cached && Date.now() - cached.savedAt < 5 * 60000) return cached.element;
    previewCache.delete(id);
    const element = [...document.querySelectorAll('.card')].find(card => card.dataset.photoId === id)?.querySelector('img');
    return element?.complete && element.naturalWidth ? element : null;
  }
  function warmNeighbors(index) {
    if (saveData || document.hidden) return;
    for (const neighbor of [visible[index - 1], visible[index + 1]]) {
      if (!neighbor || neighbor.kind === 'video' || !neighbor.preview || readyPreview(neighbor.id)) continue;
      const warm = new Image(); warm.decoding = 'async'; warm.fetchPriority = 'low';
      warm.onload = () => rememberPreview(neighbor.id, warm); warm.src = neighbor.preview;
    }
  }
  const heicCache = new Map(), temporaryURLs = new Set();
  let conversionController, conversionWorker, conversionTimer;
  const photoTimers = new Set();
  const thumbnailWaiters = new Map(), thumbnailActive = new Set();
  function pumpThumbnails() {
    if (document.hidden || viewer.open) return;
    for (const [element, waiting] of thumbnailWaiters) {
      if (thumbnailActive.size >= 3) break;
      if (!waiting.eligible || waiting.status !== 'queued' || !element.isConnected) continue;
      element.hidden = false;
      waiting.status = 'loading'; thumbnailActive.add(element);
      const generation = ++waiting.generation;
      const finish = () => {
        clearTimeout(waiting.timer); thumbnailActive.delete(element); element.onload = element.onerror = null;
      };
      element.onload = () => {
        if (waiting.generation !== generation) return;
        finish(); waiting.status = 'done'; waiting.button.querySelector('.card-error')?.remove();
        if (!saveData) rememberPreview(waiting.item.id,element);
        pumpThumbnails();
      };
      element.onerror = async () => {
        if (waiting.generation !== generation) return;
        finish(); element.removeAttribute('src');
        if (waiting.src !== waiting.item.thumbnail && waiting.item.thumbnail && !waiting.smallTried) {
          waiting.smallTried = true; waiting.src = waiting.item.thumbnail; waiting.status = 'queued'; pumpThumbnails(); return;
        }
        if (!waiting.refreshed && !document.hidden && !viewer.open) {
          waiting.refreshed = true; waiting.status = 'refreshing'; thumbnailActive.add(element);
          const control = waiting.control = new AbortController();
          try {
            const item = await refreshItem(waiting.item.id,control.signal);
            if (waiting.generation !== generation || !element.isConnected) return;
            waiting.item = item; waiting.src = saveData ? item.thumbnail : item.preview || item.thumbnail;
            const url = new URL(waiting.src,location.href); url.searchParams.set('fresh','1'); waiting.src = url.href;
            waiting.smallTried = false; waiting.status = 'queued';
          } catch { if (waiting.generation === generation) waiting.status = 'failed'; }
          finally { if (waiting.generation === generation) { thumbnailActive.delete(element); waiting.control = null; } }
        } else waiting.status = 'failed';
        if (waiting.generation !== generation) return;
        if (waiting.status === 'failed' && !waiting.button.querySelector('.card-error')) {
          element.hidden = true;
          const error = document.createElement('span'); error.className = 'card-error'; error.textContent = waiting.item.kind === 'video' ? '영상 보기' : '사진 열기'; waiting.button.append(error);
        }
        pumpThumbnails();
      };
      waiting.timer = setTimeout(() => element.onerror?.(),25000); element.src = waiting.src;
    }
  }
  const thumbnailObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const waiting = thumbnailWaiters.get(entry.target); if (!waiting) continue;
      waiting.eligible = entry.isIntersecting;
      if (!entry.isIntersecting) pauseThumbnail(entry.target);
    }
    pumpThumbnails();
  }, {rootMargin:'180px'}) : null;
  function pauseThumbnail(element) {
    if (!thumbnailActive.has(element)) return;
    const waiting = thumbnailWaiters.get(element);
    ++waiting.generation; clearTimeout(waiting.timer); waiting.control?.abort(); waiting.control = null;
    element.onload = element.onerror = null; element.removeAttribute('src'); waiting.status = 'queued';
    thumbnailActive.delete(element);
  }
  function pauseThumbnails() {
    for (const element of thumbnailActive) pauseThumbnail(element);
  }
  function stopThumbnailTimer(element) {
    const waiting = thumbnailWaiters.get(element);
    if (waiting) { ++waiting.generation; clearTimeout(waiting.timer); waiting.control?.abort(); }
    element.onload = element.onerror = null; if (waiting?.status !== 'done') element.removeAttribute('src');
    thumbnailActive.delete(element); thumbnailWaiters.delete(element); thumbnailObserver?.unobserve(element);
  }
  function resumeThumbnails() {
    for (const [element, waiting] of thumbnailWaiters) {
      const rect = element.getBoundingClientRect();
      waiting.eligible = rect.bottom > -180 && rect.top < innerHeight + 180;
      if (waiting.status === 'failed') { waiting.status = 'queued'; waiting.refreshed = false; waiting.smallTried = false; waiting.src = saveData ? waiting.item.thumbnail : waiting.item.preview || waiting.item.thumbnail; }
    }
    pumpThumbnails();
  }
  async function fetchJSON(url, init = {}, milliseconds = 15000) {
    const control = new AbortController(), abort = () => control.abort();
    if (init.signal?.aborted) control.abort(); else init.signal?.addEventListener('abort',abort,{once:true});
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; abort(); },milliseconds);
    try {
      const response = await fetch(url,{...init,signal:control.signal});
      const data = await response.json();
      if (!response.ok) { const error = new Error('unavailable'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (timedOut) throw new Error('timeout');
      throw error;
    } finally { clearTimeout(deadline); init.signal?.removeEventListener('abort',abort); }
  }
  const isHeic = item => /\.(heic|heif)$/i.test(item?.name || '');
  try { favorites = new Set(JSON.parse(localStorage.getItem('jian-favorites') || '[]')); } catch {}
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  try { const period = localStorage.getItem('jian-period'); if (['day','week','month','year'].includes(period)) $('period').value = period; } catch {}
  const root = document.documentElement, themePreference = matchMedia('(prefers-color-scheme: dark)');
  try { const theme = localStorage.getItem('jian-theme'); if (['light','dark'].includes(theme)) root.dataset.theme = theme; } catch {}
  function updateTheme() {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : themePreference.matches;
    $('theme').setAttribute('aria-pressed', String(dark)); $('theme').setAttribute('aria-label', dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0d1316' : '#f6f1e7';
  }
  $('theme').onclick = () => { root.dataset.theme = (root.dataset.theme ? root.dataset.theme === 'dark' : themePreference.matches) ? 'light' : 'dark'; save('jian-theme', root.dataset.theme); updateTheme(); };
  themePreference.addEventListener('change', updateTheme); updateTheme();
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
  const day = value => date(value)?.toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul', year:'numeric', month:'long', day:'numeric' }) || '날짜 없는 순간';
  const displayDate = item => $('sort').value === 'uploaded' ? item.uploadedAt : item.date;
  const duration = milliseconds => { const seconds = Math.floor((milliseconds || 0) / 1000); return seconds ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : '영상'; };
  function state(title, detail, loading = false) {
    const box = $('status'); box.replaceChildren(); box.hidden = false;
    if (loading) {
      const skeleton = document.createElement('div'); skeleton.className = 'skeleton-grid'; skeleton.setAttribute('aria-hidden','true');
      for (let index = 0; index < 9; index++) skeleton.append(document.createElement('span'));
      box.append(skeleton);
    }
    const heading = document.createElement('h2'); heading.textContent = title;
    const text = document.createElement('p'); text.textContent = detail; box.append(heading, text);
  }
  function card(item, index) {
    const button = document.createElement('button'); button.className = 'card'; button.dataset.photoId = item.id;
    button.setAttribute('aria-label', day(displayDate(item)) + ', ' + item.name + (item.kind === 'video' ? ', 영상 보기' : ', 크게 보기'));
    if (item.thumbnail || item.preview) {
      const thumbnail = document.createElement('img'); thumbnail.alt = ''; thumbnail.decoding = 'async';
      if (index < 3) thumbnail.fetchPriority = 'high';
      button.append(thumbnail);
      thumbnailWaiters.set(thumbnail,{item,button,src:saveData ? item.thumbnail : item.preview || item.thumbnail,status:'queued',generation:0,eligible:!thumbnailObserver});
      thumbnailObserver?.observe(thumbnail);
    } else {
      const error = document.createElement('span'); error.className = 'card-error'; error.textContent = item.kind === 'video' ? '영상 보기' : '사진 열기'; button.append(error);
    }
    if (item.kind === 'video') { const badge = document.createElement('span'); badge.className = 'video-badge'; badge.textContent = '▶ ' + duration(item.duration); button.append(badge); }
    if (favorites.has(item.id)) { const heart = document.createElement('span'); heart.className = 'card-heart'; heart.textContent = '♥'; button.append(heart); }
    button.onclick = () => open(item.id, button);
    return button;
  }
  function render(append = false, start = 0) {
    $('total').textContent = page?.total || '';
    if (page) { $('photo-count').textContent = page.counts.photo.toLocaleString(); $('video-count').textContent = page.counts.video.toLocaleString(); }
    $('fav-count').textContent = onlyFavorites ? page?.matched || '' : favorites.size || '';
    $('all').classList.toggle('active', !onlyFavorites); $('all').setAttribute('aria-pressed', String(!onlyFavorites));
    $('favorite').classList.toggle('active', onlyFavorites); $('favorite').setAttribute('aria-pressed', String(onlyFavorites));
    const gallery = $('gallery');
    if (!append) { for (const element of thumbnailWaiters.keys()) stopThumbnailTimer(element); gallery.replaceChildren(); }
    gallery.dataset.period = $('period').value;
    const albumOrder = $('sort').value === 'album';
    $('period').disabled = albumOrder;
    $('period').title = albumOrder ? '촬영일 또는 업로드일 정렬에서 기간별로 볼 수 있어요.' : $('period').value === 'week' ? '월요일부터 일요일까지 묶어요.' : '';
    if (!visible.length) {
      state(onlyFavorites ? '좋아하는 순간을 골라보세요' : '아직 이 목록에 순간이 없어요', onlyFavorites ? '사진이나 영상을 열고 ♡를 누르면 여기에 모여요.' : '다른 종류를 선택하거나 목록을 새로고침해 주세요.');
    } else {
      $('status').hidden = true;
      const groups = new Map([...gallery.children].map(section => [section.dataset.periodKey, section]));
      visible.slice(append ? start : 0).forEach((item, relativeIndex) => {
        const group = albumOrder ? {key:'album',label:'모든 순간'} : periodGroup(displayDate(item), $('period').value);
        let section = groups.get(group.key);
        if (!section) {
          section = document.createElement('section'); section.dataset.periodKey = group.key;
          const heading = document.createElement('h2'); heading.className = 'date-heading'; heading.textContent = group.label;
          const grid = document.createElement('div'); grid.className = 'grid'; section.append(heading, grid); gallery.append(section); groups.set(group.key, section);
        }
        section.lastElementChild.append(card(item, (append ? start : 0) + relativeIndex));
      });
    }
    $('list-info').hidden = !page || (!onlyFavorites && $('media-type').value === 'all');
    if (page) $('list-info').textContent = '사진 ' + page.counts.photo.toLocaleString() + '장 · 영상 ' + page.counts.video.toLocaleString() + '개' + (onlyFavorites || $('media-type').value !== 'all' ? ' · 선택한 목록 ' + page.matched.toLocaleString() + '개' : '');
    $('more-area').hidden = page?.nextOffset == null;
    $('more').disabled = paging;
    $('more-state').textContent = paging ? '다음 순간들을 불러오는 중…' : '';
    pumpThumbnails();
  }
  function cacheKey() { return 'jian-page-v6:' + $('sort').value + ':' + $('media-type').value + ':' + (onlyFavorites ? [...favorites].sort().join(',') : 'all'); }
  function cachedPage() {
    try { const cached = JSON.parse(sessionStorage.getItem(cacheKey()) || 'null'); return cached && Date.now() - cached.savedAt < 5 * 60000 ? cached.data : null; } catch { return null; }
  }
  function cachePage(data) { try { sessionStorage.setItem(cacheKey(), JSON.stringify({ savedAt: Date.now(), data })); } catch {} }
  async function requestPage(offset = 0, revision, focus, signal) {
    const query = new URLSearchParams({ sort: $('sort').value, type: $('media-type').value, offset: String(offset) });
    if (revision) query.set('revision', revision); if (focus) query.set('focus', focus);
    const init = { cache:'no-store', signal };
    if (onlyFavorites) Object.assign(init, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ favorites:[...favorites] }) });
    const data = await fetchJSON('/api/album?' + query,init);
    if (!Array.isArray(data.items)) throw new Error('unavailable');
    return data;
  }
  function accept(data) {
    page = data; baseOffset = data.offset || 0; visible = data.items;
    $('title').textContent = data.title; document.title = data.title; render();
  }
  async function load(initial = false, focus) {
    const version = ++loadVersion;
    controller?.abort(); controller = new AbortController(); refreshing = true; paging = false;
    $('retry').hidden = true; $('refresh').disabled = true;
    if (initial && !focus) {
      const cached = cachedPage();
      if (cached?.items?.length) accept(cached); else state('순간들을 불러오는 중이에요', '저장된 목록을 가져오고 있어요.', true);
    }
    try {
      const data = await requestPage(0, undefined, focus, controller.signal);
      if (version !== loadVersion) return false;
      accept(data); if (!focus) cachePage(data);
      if (selected) current = visible.findIndex(item => item.id === selected.id);
      if (focus && data.focusIndex != null) { if (!viewer.open) viewer.showModal(); show(data.focusIndex); }
      return true;
    } catch (error) {
      if (version !== loadVersion || error.name === 'AbortError') return false;
      if (!visible.length) state('순간들을 잠시 불러올 수 없어요', '잠시 후 다시 시도해 주세요.');
      else if (focus) $('list-info').textContent = '이 순간은 현재 선택한 목록에서 찾지 못했어요. 전체 목록에서 다시 확인해 주세요.';
      else $('list-info').textContent = '목록을 갱신하지 못했어요. 지금 보이는 순간은 계속 감상할 수 있어요.';
      $('list-info').hidden = !visible.length;
      $('retry').hidden = false; return false;
    } finally { if (version === loadVersion) { refreshing = false; $('refresh').disabled = false; } }
  }
  async function more(previous = false) {
    if (!page || paging || refreshing || (previous ? baseOffset === 0 : page.nextOffset == null)) return false;
    const version = loadVersion, offset = previous ? Math.max(0, baseOffset - 60) : page.nextOffset;
    paging = true; $('more').disabled = true; $('more-state').textContent = '다음 순간들을 불러오는 중…';
    try {
      const data = await requestPage(offset, page.revision, undefined, controller?.signal);
      if (version !== loadVersion) return false;
      const existing = new Set(visible.map(item => item.id)); const extra = data.items.filter(item => !existing.has(item.id));
      if (previous) { visible.unshift(...extra); baseOffset = data.offset; if (current >= 0) current += extra.length; render(); }
      else { const start = visible.length; visible.push(...extra); page.nextOffset = data.nextOffset; render(true, start); }
      if (selected) current = visible.findIndex(item => item.id === selected.id);
      return true;
    } catch (error) {
      if (version !== loadVersion || error.name === 'AbortError') return false;
      if (error.status === 409) { await load(false, selected?.id); return false; }
      $('more-state').textContent = '불러오지 못했어요. 더 보기를 다시 눌러 주세요.'; return false;
    } finally { if (version === loadVersion) { paging = false; $('more').disabled = false; if (!$('more-state').textContent.includes('못했')) $('more-state').textContent = ''; } }
  }
  function resetVideo() { video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load(); video.hidden = true; }
  function cancelPhotoLoads() {
    for (const timer of photoTimers) clearTimeout(timer); photoTimers.clear();
    for (const pending of [previewLoad, originalLoad]) if (pending) { pending.onload = pending.onerror = null; pending.removeAttribute('src'); }
    conversionController?.abort(); conversionController = null;
    conversionWorker?.terminate(); conversionWorker = null; clearTimeout(conversionTimer);
    for (const url of temporaryURLs) URL.revokeObjectURL(url); temporaryURLs.clear();
    previewLoad = originalLoad = null; originalReady = false;
  }
  function timedPhoto(element, src, milliseconds = 25000) {
    const onload = element.onload, onerror = element.onerror;
    let finished = false;
    const settle = (callback, event) => {
      if (finished) return; finished = true; clearTimeout(timer); photoTimers.delete(timer);
      element.onload = onload; element.onerror = onerror; callback?.call(element,event);
    };
    const timer = setTimeout(() => {
      element.onload = element.onerror = null; element.removeAttribute('src'); settle(onerror);
    }, milliseconds);
    photoTimers.add(timer);
    element.onload = event => settle(onload,event); element.onerror = event => settle(onerror,event); element.src = src;
  }
  function rememberHeic(id, url, size, converted) {
    if (size > 24 * 1024 * 1024) return;
    const old = heicCache.get(id); if (old && old.url !== url) URL.revokeObjectURL(old.url);
    heicCache.delete(id); heicCache.set(id, { url, size, converted }); temporaryURLs.delete(url);
    while (heicCache.size > 3 || [...heicCache.values()].reduce((sum, item) => sum + item.size, 0) > 24 * 1024 * 1024) {
      const key = heicCache.keys().next().value; URL.revokeObjectURL(heicCache.get(key).url); heicCache.delete(key);
    }
  }
  async function downloadHeic(url, signal) {
    const target = new URL(url, location.href); target.searchParams.set('mode', 'bytes');
    const response = await fetch(target, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('download');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('too-large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error('download');
    return new Blob(chunks, { type: response.headers.get('Content-Type') || 'image/heic' });
  }
  async function convertHeic(blob, signal) {
    const buffer = await blob.arrayBuffer();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Promise((resolve, reject) => {
      const worker = conversionWorker = new Worker('/assets/heic-viewer-v1.js', { type: 'module' });
      const abort = () => finish(null, new DOMException('Cancelled', 'AbortError'));
      function finish(data, error) {
        signal.removeEventListener('abort', abort); worker.terminate();
        if (conversionWorker === worker) conversionWorker = null;
        if (error) reject(error); else resolve(data);
      }
      worker.onmessage = event => event.data?.blob instanceof Blob ? finish(event.data) : finish(null, new Error('conversion'));
      worker.onerror = event => { event.preventDefault(); finish(null, new Error('conversion')); };
      signal.addEventListener('abort', abort, { once: true });
      worker.postMessage({ buffer, mimeType: blob.type }, [buffer]);
    });
  }
  function quality(text, value) { $('quality-status').textContent = text; $('quality-status').dataset.quality = value; }
  async function show(index) {
    if (!viewer.open || index < 0 || index >= visible.length) return;
    cancelPhotoLoads(); resetVideo(); current = index; selected = visible[index];
    const item = selected, version = ++showVersion, isVideo = item.kind === 'video';
    $('photo-loading').hidden = isVideo; $('photo-loading').textContent = isVideo ? '영상을 불러오는 중…' : '사진을 불러오는 중…'; $('photo-error').hidden = true;
    image.removeAttribute('src'); image.alt = item.name; image.hidden = true;
    image.removeAttribute('data-quality'); quality(isVideo ? '' : '원본 화질 불러오는 중…', 'loading'); $('quality-status').hidden = isVideo;
    $('counter').textContent = (baseOffset + index + 1) + ' / ' + page.matched;
    $('photo-date').textContent = day(displayDate(item)); $('photo-name').textContent = item.name;
    const sources = {captured:'촬영일', filename:'파일명에서 확인한 날짜', 'file-created':'원래 파일 생성일', uploaded:'촬영일 정보 없음 · 업로드일', unknown:'날짜 정보 없음'};
    $('date-source').textContent = $('sort').value === 'uploaded' ? '업로드일' : sources[item.dateSource] || '';
    $('previous').disabled = index === 0 && baseOffset === 0;
    $('next').disabled = index === visible.length - 1 && page.nextOffset == null;
    $('like').textContent = favorites.has(item.id) ? '♥' : '♡'; $('like').setAttribute('aria-pressed', String(favorites.has(item.id)));
    $('like').setAttribute('aria-label', favorites.has(item.id) ? '좋아하기 취소' : '좋아하기');
    $('announcement').textContent = (baseOffset + index + 1) + '번째 ' + (isVideo ? '영상' : '사진') + ', ' + day(displayDate(item));
    if (isVideo) {
      video.hidden = false; video.poster = item.preview || item.thumbnail || ''; video.src = item.original;
      return;
    }
    const active = () => version === showVersion && viewer.open;
    let displayed = false, previewFailed = false, originalFailed = false, originalFailureText = '미리보기 · 원본을 불러오지 못했어요';
    function display(src, full, converted = false) {
      if (!active() || (!full && originalReady)) return;
      image.src = src; image.hidden = false; image.dataset.quality = full ? converted ? 'converted' : 'original' : 'preview'; $('photo-loading').hidden = true; $('photo-error').hidden = true;
      if (full) {
        originalReady = true; quality(converted ? '원본 해상도 · HEIC 변환' : '원본 화질', converted ? 'converted' : 'original');
        if (!src.startsWith('blob:')) {
          originalCache.delete(item.id); originalCache.set(item.id, {url:src, savedAt:Date.now()});
          if (originalCache.size > 6) originalCache.delete(originalCache.keys().next().value);
        }
      } else quality(originalFailed ? originalFailureText : isHeic(item) ? '미리보기 · HEIC 원본 준비 중…' : '미리보기 · 원본 화질 불러오는 중…', 'preview');
      if (!displayed) {
        displayed = true;
        warmNeighbors(index);
        if (!reducedMotion.matches) image.animate([{opacity:.75,transform:'scale(.97)'},{opacity:1,transform:'scale(1)'}], {duration:200,easing:'cubic-bezier(.2,.7,.2,1)'});
        if (index >= visible.length - 3 && page.nextOffset != null) more();
      }
    }
    function failure() {
      if (!active()) return;
      if (displayed) { if (originalFailed) quality(originalFailureText, 'preview'); return; }
      if (previewFailed && originalFailed) {
        $('photo-loading').hidden = true; $('photo-error').hidden = false; quality('', 'error');
        $('media-error-text').textContent = originalFailureText.replace(/^미리보기 · /,'') + '. 다시 시도하거나 원본 열기로 확인해 주세요.';
      }
    }
    const ready = readyPreview(item.id);
    if (ready) display(ready.currentSrc || ready.src, false);
    const previewURL = item.preview || item.thumbnail;
    if (previewURL && (!ready || ready.src !== new URL(previewURL,location.href).href)) {
      const preview = previewLoad = new Image(); preview.decoding = 'async';
      preview.onload = () => { rememberPreview(item.id,preview); display(preview.src, false); };
      preview.onerror = () => { previewFailed = true; failure(); }; timedPhoto(preview,previewURL,12000);
    } else if (!previewURL && !ready) previewFailed = true;
    const loadOriginal = () => {
      if (!active()) return;
      const full = originalLoad = new Image(); full.decoding = 'async'; full.fetchPriority = 'high';
      if (isHeic(item)) {
        const cached = heicCache.get(item.id);
        if (cached) { full.onload = () => display(full.src, true, cached.converted); timedPhoto(full,cached.url,10000); return; }
        const control = conversionController = new AbortController();
        conversionTimer = setTimeout(() => control.abort(), 60000);
        (async () => {
          let phase = 'download';
          try {
            let blob;
            try { blob = await downloadHeic(item.original, control.signal); }
            catch (error) {
              if (!active() || control.signal.aborted || error.message === 'too-large') throw error;
              blob = await downloadHeic(await freshOriginal(item.id, control.signal), control.signal);
            }
            if (!active()) return;
            const nativeURL = URL.createObjectURL(blob); temporaryURLs.add(nativeURL);
            const supported = await new Promise(resolve => { full.onload = () => resolve(true); full.onerror = () => resolve(false); control.signal.addEventListener('abort', () => resolve(false), {once:true}); full.src = nativeURL; });
            if (!active()) return;
            if (control.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (supported) { rememberHeic(item.id, nativeURL, blob.size, false); display(nativeURL, true); return; }
            URL.revokeObjectURL(nativeURL); temporaryURLs.delete(nativeURL);
            phase = 'conversion'; quality(displayed ? '미리보기 · HEIC 원본 변환 중…' : 'HEIC 원본 변환 중…', 'loading');
            const result = await convertHeic(blob, control.signal);
            if (!active()) return;
            const convertedURL = URL.createObjectURL(result.blob); temporaryURLs.add(convertedURL);
            full.onload = () => { if (active()) { rememberHeic(item.id, convertedURL, result.blob.size, result.converted); display(convertedURL, true, result.converted); } };
            full.onerror = () => { if (active()) { originalFailed = true; originalFailureText = '미리보기 · HEIC 변환을 완료하지 못했어요'; failure(); } };
            timedPhoto(full,convertedURL,10000);
          } catch (error) {
            if (!active()) return;
            originalFailed = true;
            originalFailureText = error.message === 'too-large' ? '미리보기 · 큰 원본은 원본 열기로 확인해 주세요' : control.signal.aborted ? '미리보기 · 원본 준비 시간이 초과됐어요' : phase === 'download' ? '미리보기 · 원본 다운로드에 실패했어요' : '미리보기 · HEIC 변환을 완료하지 못했어요';
            failure();
          } finally { if (conversionController === control) { clearTimeout(conversionTimer); conversionController = null; } }
        })();
        return;
      }
      let retried = false;
      full.onload = () => display(full.src, true);
      full.onerror = async () => {
        if (!active()) return;
        if (!retried) {
          retried = true;
          try { const url = await freshOriginal(item.id); if (active()) { timedPhoto(full,url); return; } } catch {}
        }
        if (!active()) return;
        originalFailed = true; failure();
      };
      const cached = originalCache.get(item.id);
      timedPhoto(full,cached && Date.now() - cached.savedAt < 30 * 60000 ? cached.url : item.original);
    };
    // Wait for the opening gesture to settle so swiping past a photo never starts its HEIC download.
    if (heicCache.has(item.id) || originalCache.has(item.id)) loadOriginal();
    else {
      const delay = setTimeout(() => { photoTimers.delete(delay); loadOriginal(); },350); photoTimers.add(delay);
    }
  }
  function open(id, source) { const index = visible.findIndex(item => item.id === id); if (index < 0) return; lastFocused = source || document.activeElement; viewer.showModal(); pauseThumbnails(); show(index); }
  async function advance(direction) {
    if (direction > 0 && current + 1 >= visible.length && page.nextOffset != null) { if (!await more()) return; }
    if (direction < 0 && current === 0 && baseOffset > 0) { if (!await more(true)) return; }
    if (current + direction >= 0 && current + direction < visible.length) show(current + direction);
  }
  async function refreshItem(id, signal) {
    if (!id) throw new Error('missing');
    const item = await fetchJSON('/api/item?id=' + encodeURIComponent(id),{cache:'no-store',signal});
    if (selected?.id === id) selected = item;
    const index = visible.findIndex(entry => entry.id === item.id); if (index >= 0) visible[index] = item;
    return item;
  }
  async function freshOriginal(id = selected?.id, signal) { return (await refreshItem(id,signal)).original; }
  $('original').onclick = async () => {
    const tab = window.open('about:blank','_blank'); if (tab) tab.opener = null;
    try { const url = await freshOriginal(); if (tab) tab.location.href = url; else window.location.assign(url); }
    catch { if (tab) tab.close(); $('announcement').textContent = '원본을 열지 못했습니다. 목록을 새로고침해 주세요.'; }
  };
  $('like').onclick = async () => {
    if (!selected) return;
    const id = selected.id, oldIndex = current;
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    save('jian-favorites', JSON.stringify([...favorites]));
    if (onlyFavorites && !favorites.has(id)) {
      await load(); if (!visible.length) viewer.close(); else show(Math.min(oldIndex, visible.length - 1));
    } else {
      $('fav-count').textContent = favorites.size || '';
      const card = [...document.querySelectorAll('.card')].find(button => button.dataset.photoId === id);
      card?.querySelector('.card-heart')?.remove();
      if (card && favorites.has(id)) { const heart = document.createElement('span'); heart.className = 'card-heart'; heart.textContent = '♥'; card.append(heart); }
      $('like').textContent = favorites.has(id) ? '♥' : '♡'; $('like').setAttribute('aria-pressed', String(favorites.has(id)));
      $('like').setAttribute('aria-label', favorites.has(id) ? '좋아하기 취소' : '좋아하기');
    }
  };
  video.addEventListener('waiting', () => { if (!video.hidden) $('photo-loading').hidden = false; });
  for (const event of ['loadedmetadata','canplay','playing']) video.addEventListener(event, () => { if (!video.hidden) $('photo-loading').hidden = true; });
  video.addEventListener('error', () => {
    if (video.hidden || selected?.kind !== 'video') return;
    $('photo-loading').hidden = true; $('photo-error').hidden = false;
    $('media-error-text').textContent = '이 영상은 브라우저에서 재생할 수 없거나 링크가 만료됐어요. 원본 열기로 확인해 주세요.';
  });
  $('previous').onclick = () => advance(-1); $('next').onclick = () => advance(1);
  $('home').onclick = () => {
    const card = [...document.querySelectorAll('.card')].find(button => button.dataset.photoId === selected?.id);
    if (card) lastFocused = card;
    viewer.close();
    card?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  };
  viewer.addEventListener('cancel', () => video.pause());
  viewer.addEventListener('close', () => {
    ++showVersion; cancelPhotoLoads(); resetVideo(); image.removeAttribute('src'); resumeThumbnails();
    const focus = lastFocused?.isConnected ? lastFocused : [...document.querySelectorAll('.card')].find(button => button.dataset.photoId === selected?.id) || $('all'); focus?.focus({preventScroll:true});
  });
  viewer.addEventListener('keydown', event => {
    if (event.target instanceof HTMLVideoElement || (event.target instanceof HTMLButtonElement && [' ','Enter'].includes(event.key))) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
  });
  let pointer;
  stage.addEventListener('pointerdown', event => { if (event.pointerType === 'touch' && !(event.target instanceof HTMLVideoElement)) pointer = {id:event.pointerId,x:event.clientX,y:event.clientY}; });
  stage.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) { pointer = null; return; }
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) advance(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { pointer = null; }); stage.style.touchAction = 'pan-y pinch-zoom';
  $('photo-retry').onclick = async () => { const version = showVersion; try { const url = await freshOriginal(); if (version !== showVersion || !viewer.open) return; if (selected?.kind === 'video') { video.src = url; video.play().catch(() => {}); $('photo-error').hidden = true; } else show(current); } catch {} };
  $('all').onclick = () => { onlyFavorites = false; load(); }; $('favorite').onclick = () => { onlyFavorites = true; load(); };
  $('sort').onchange = () => load(); $('media-type').onchange = () => load();
  $('period').onchange = () => { save('jian-period', $('period').value); render(); };
  $('refresh').onclick = () => load(); $('retry').onclick = () => load(!visible.length); $('more').onclick = () => more();
  if ('IntersectionObserver' in window) { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && page?.nextOffset != null) more(); }, {rootMargin:'700px'}); observer.observe($('more-area')); }
  const recover = () => {
    if (document.hidden) return;
    if (viewer.open && selected?.kind === 'photo' && !originalReady) show(current);
    else if (!viewer.open) { if (!page && !refreshing) load(true); else resumeThumbnails(); }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseThumbnails(); if (viewer.open && !originalReady) { ++showVersion; cancelPhotoLoads(); quality(image.hidden ? '' : '미리보기','preview'); } video.pause(); }
    else recover();
  });
  window.addEventListener('online',recover);
  window.addEventListener('pageshow',event => { if (event.persisted) recover(); });
  load(true);
})();
