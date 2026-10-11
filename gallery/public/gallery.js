(() => {
  'use strict';
  /* PERIOD_HELPERS */
  const $ = id => document.getElementById(id);
  const viewer = $('viewer'), image = $('photo'), video = $('video'), stage = $('stage');
  let visible = [], current = -1, selected = null, onlyFavorites = false, zoomed = false;
  let showVersion = 0, slideshow = false, timer, lastFocused, refreshing = false, paging = false;
  let page = null, baseOffset = 0, loadVersion = 0, controller;
  let favorites = new Set(), lastViewed = '';
  let previewLoad, originalLoad, originalReady = false, zoomRequested = false;
  const originalCache = new Map();
  const heicCache = new Map(), temporaryURLs = new Set();
  let conversionController, conversionWorker, conversionTimer;
  const isHeic = item => /\.(heic|heif)$/i.test(item?.name || '');
  try { favorites = new Set(JSON.parse(localStorage.getItem('jian-favorites') || '[]')); lastViewed = localStorage.getItem('jian-last-viewed') || ''; } catch {}
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
    if (loading) { const spinner = document.createElement('span'); spinner.className = 'loader'; box.append(spinner); }
    const heading = document.createElement('h2'); heading.textContent = title;
    const text = document.createElement('p'); text.textContent = detail; box.append(heading, text);
  }
  function card(item, index) {
    const button = document.createElement('button'); button.className = 'card'; button.dataset.photoId = item.id;
    button.setAttribute('aria-label', day(displayDate(item)) + ', ' + item.name + (item.kind === 'video' ? ', 영상 보기' : ', 크게 보기'));
    if (item.thumbnail || item.kind !== 'video') {
      const thumbnail = document.createElement('img'); thumbnail.src = item.thumbnail || item.original;
      thumbnail.alt = ''; thumbnail.loading = index < 6 ? 'eager' : 'lazy'; thumbnail.decoding = 'async';
      if (index < 4) thumbnail.fetchPriority = 'high';
      let fallback = !item.thumbnail;
      thumbnail.onerror = () => {
        if (!fallback && item.kind !== 'video') { fallback = true; thumbnail.src = item.original; return; }
        thumbnail.remove();
        const error = document.createElement('span'); error.className = 'card-error'; error.textContent = item.kind === 'video' ? '영상 보기' : '사진 열기'; button.prepend(error);
      };
      button.append(thumbnail);
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
    const gallery = $('gallery'); if (!append) gallery.replaceChildren();
    gallery.dataset.period = $('period').value;
    const albumOrder = $('sort').value === 'album';
    $('period').disabled = albumOrder;
    $('period').title = albumOrder ? '촬영일 또는 업로드일 정렬에서 기간별로 볼 수 있어요.' : $('period').value === 'week' ? '월요일부터 일요일까지 묶어요.' : '';
    $('resume').hidden = !lastViewed;
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
    $('list-info').hidden = !page;
    if (page) $('list-info').textContent = '사진 ' + page.counts.photo.toLocaleString() + '장 · 영상 ' + page.counts.video.toLocaleString() + '개' + (onlyFavorites || $('media-type').value !== 'all' ? ' · 선택한 목록 ' + page.matched.toLocaleString() + '개' : '');
    $('more-area').hidden = page?.nextOffset == null;
    $('more').disabled = paging;
    $('more-state').textContent = paging ? '다음 순간들을 불러오는 중…' : '';
  }
  function cacheKey() { return 'jian-page-v3:' + $('sort').value + ':' + $('media-type').value + ':' + (onlyFavorites ? [...favorites].sort().join(',') : 'all'); }
  function cachedPage() {
    try { const cached = JSON.parse(sessionStorage.getItem(cacheKey()) || 'null'); return cached && Date.now() - cached.savedAt < 5 * 60000 ? cached.data : null; } catch { return null; }
  }
  function cachePage(data) { try { sessionStorage.setItem(cacheKey(), JSON.stringify({ savedAt: Date.now(), data })); } catch {} }
  async function requestPage(offset = 0, revision, focus, signal) {
    const query = new URLSearchParams({ sort: $('sort').value, type: $('media-type').value, offset: String(offset) });
    if (revision) query.set('revision', revision); if (focus) query.set('focus', focus);
    const init = { cache:'no-store', signal };
    if (onlyFavorites) Object.assign(init, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ favorites:[...favorites] }) });
    const response = await fetch('/api/album?' + query, init);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.items)) { const error = new Error('unavailable'); error.status = response.status; throw error; }
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
  function stop() { slideshow = false; clearTimeout(timer); $('play').textContent = '▷'; $('play').setAttribute('aria-pressed','false'); $('play').setAttribute('aria-label','슬라이드쇼 시작'); }
  function schedule() {
    clearTimeout(timer);
    if (slideshow && viewer.open && !document.hidden && selected?.kind !== 'video') timer = setTimeout(() => advance(1, false), 4000);
  }
  function setZoom(value) {
    zoomed = value; stage.classList.toggle('zoomed', value); stage.scrollTop = stage.scrollLeft = 0;
    $('zoom').textContent = value ? '−' : '＋'; $('zoom').setAttribute('aria-pressed', String(value)); $('zoom').setAttribute('aria-label', value ? '확대 해제' : '원본으로 확대');
  }
  function resetVideo() { video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load(); video.hidden = true; }
  function cancelPhotoLoads() {
    for (const pending of [previewLoad, originalLoad]) if (pending) { pending.onload = pending.onerror = null; pending.removeAttribute('src'); }
    conversionController?.abort(); conversionController = null;
    conversionWorker?.terminate(); conversionWorker = null; clearTimeout(conversionTimer);
    for (const url of temporaryURLs) URL.revokeObjectURL(url); temporaryURLs.clear();
    previewLoad = originalLoad = null; originalReady = false; zoomRequested = false;
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
    clearTimeout(timer); cancelPhotoLoads(); setZoom(false); resetVideo(); current = index; selected = visible[index];
    const item = selected, version = ++showVersion, isVideo = item.kind === 'video';
    $('photo-loading').hidden = isVideo; $('photo-loading').textContent = isVideo ? '영상을 불러오는 중…' : '사진을 불러오는 중…'; $('photo-error').hidden = true;
    image.removeAttribute('src'); image.alt = item.name; image.hidden = isVideo; $('zoom').hidden = isVideo;
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
    lastViewed = item.id; save('jian-last-viewed', item.id);
    if (isVideo) {
      video.hidden = false; video.poster = item.preview || item.thumbnail || ''; video.src = item.original;
      if (slideshow) video.play().catch(() => stop());
      return;
    }
    const active = () => version === showVersion && viewer.open;
    let displayed = false, previewFailed = false, originalFailed = false, originalFailureText = '미리보기 · 원본을 불러오지 못했어요';
    function display(src, full, converted = false) {
      if (!active() || (!full && originalReady)) return;
      image.src = src; image.dataset.quality = full ? converted ? 'converted' : 'original' : 'preview'; $('photo-loading').hidden = true; $('photo-error').hidden = true;
      if (full) {
        originalReady = true; quality(converted ? '원본 해상도 · HEIC 변환' : '원본 화질', converted ? 'converted' : 'original');
        if (!src.startsWith('blob:')) {
          originalCache.delete(item.id); originalCache.set(item.id, {url:src, savedAt:Date.now()});
          if (originalCache.size > 6) originalCache.delete(originalCache.keys().next().value);
        }
        if (zoomRequested) { zoomRequested = false; setZoom(true); }
      } else quality(originalFailed ? originalFailureText : isHeic(item) ? '미리보기 · HEIC 원본 준비 중…' : '미리보기 · 원본 화질 불러오는 중…', 'preview');
      if (!displayed) {
        displayed = true; schedule();
        for (const neighbor of [visible[index - 1], visible[index + 1]]) if (neighbor?.kind !== 'video' && neighbor?.preview) { const warm = new Image(); warm.src = neighbor.preview; }
        if (index >= visible.length - 3 && page.nextOffset != null) more();
      }
    }
    function failure() {
      if (!active()) return;
      if (displayed) { quality(originalFailureText, 'preview'); return; }
      if (previewFailed && originalFailed) {
        $('photo-loading').hidden = true; $('photo-error').hidden = false; quality('', 'error');
        $('media-error-text').textContent = '사진을 불러오지 못했어요. 원본 열기로 확인해 주세요.'; stop();
      }
    }
    const previewURL = item.preview || item.thumbnail;
    if (previewURL) {
      const preview = previewLoad = new Image(); preview.decoding = 'async';
      preview.onload = () => display(preview.src, false);
      preview.onerror = () => { previewFailed = true; failure(); }; preview.src = previewURL;
    } else previewFailed = true;
    const full = originalLoad = new Image(); full.decoding = 'async'; full.fetchPriority = 'high';
    if (isHeic(item)) {
      const cached = heicCache.get(item.id);
      if (cached) { full.onload = () => display(full.src, true, cached.converted); full.src = cached.url; return; }
      const control = conversionController = new AbortController();
      conversionTimer = setTimeout(() => control.abort(), 60000);
      (async () => {
        let phase = 'download';
        try {
          let blob;
          try { blob = await downloadHeic(item.original, control.signal); }
          catch (error) {
            if (!active() || control.signal.aborted || error.message === 'too-large') throw error;
            blob = await downloadHeic(await freshOriginal(item.id), control.signal);
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
          full.src = convertedURL;
        } catch (error) {
          if (!active()) return;
          originalFailed = true; zoomRequested = false;
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
        try { const url = await freshOriginal(item.id); if (active()) { full.src = url; return; } } catch {}
      }
      if (!active()) return;
      originalFailed = true; zoomRequested = false; failure();
    };
    const cached = originalCache.get(item.id);
    full.src = cached && Date.now() - cached.savedAt < 30 * 60000 ? cached.url : item.original;
  }
  function open(id, source) { const index = visible.findIndex(item => item.id === id); if (index < 0) return; lastFocused = source || document.activeElement; viewer.showModal(); show(index); }
  async function advance(direction, manual = true) {
    if (manual) stop();
    if (direction > 0 && current + 1 >= visible.length && page.nextOffset != null) { if (!await more()) return; }
    if (direction < 0 && current === 0 && baseOffset > 0) { if (!await more(true)) return; }
    if (current + direction >= 0 && current + direction < visible.length) show(current + direction); else stop();
  }
  async function freshOriginal(id = selected?.id) {
    if (!id) throw new Error('missing');
    const response = await fetch('/api/item?id=' + encodeURIComponent(id), { cache:'no-store' });
    if (!response.ok) throw new Error('unavailable');
    const item = await response.json(); if (selected?.id === id) selected = item;
    const index = visible.findIndex(entry => entry.id === item.id); if (index >= 0) visible[index] = item;
    return item.original;
  }
  $('original').onclick = async () => {
    const tab = window.open('about:blank','_blank'); if (tab) tab.opener = null;
    try { const url = await freshOriginal(); if (tab) tab.location.href = url; else window.location.assign(url); }
    catch { if (tab) tab.close(); $('announcement').textContent = '원본을 열지 못했습니다. 목록을 새로고침해 주세요.'; }
  };
  $('zoom').onclick = async () => {
    if (selected?.kind === 'video') return; stop();
    if (zoomed) { setZoom(false); return; }
    if (zoomRequested) { zoomRequested = false; return; }
    if (originalReady) { setZoom(true); return; }
    if ($('quality-status').dataset.quality !== 'error' && /불러오는 중|준비 중|변환 중/.test($('quality-status').textContent)) { zoomRequested = true; return; }
    if (isHeic(selected)) { show(current); zoomRequested = true; return; }
    const version = showVersion; $('photo-loading').hidden = false; $('photo-loading').textContent = '원본 화질 불러오는 중…';
    try {
      const url = await freshOriginal(), full = new Image();
      full.onload = () => { if (version !== showVersion || !viewer.open) return; originalReady = true; image.src = url; image.dataset.quality = 'original'; quality('원본 화질', 'original'); setZoom(true); $('photo-loading').hidden = true; };
      full.onerror = () => { if (version === showVersion) { $('photo-loading').hidden = true; $('announcement').textContent = '이 사진은 미리보기로 감상해 주세요.'; } };
      full.src = url;
    } catch { if (version === showVersion) $('photo-loading').hidden = true; }
  };
  $('like').onclick = async () => {
    if (!selected) return;
    const id = selected.id, oldIndex = current;
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    save('jian-favorites', JSON.stringify([...favorites]));
    if (onlyFavorites && !favorites.has(id)) {
      await load(); if (!visible.length) viewer.close(); else show(Math.min(oldIndex, visible.length - 1));
    } else {
      render(); $('like').textContent = favorites.has(id) ? '♥' : '♡'; $('like').setAttribute('aria-pressed', String(favorites.has(id)));
      $('like').setAttribute('aria-label', favorites.has(id) ? '좋아하기 취소' : '좋아하기');
    }
  };
  $('play').onclick = () => {
    if (slideshow) { stop(); video.pause(); return; }
    if (page?.matched < 2) return;
    setZoom(false); slideshow = true; $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-pressed','true'); $('play').setAttribute('aria-label','슬라이드쇼 정지');
    if (selected?.kind === 'video') video.play().catch(() => stop());
    else if (current === visible.length - 1 && page.nextOffset == null) show(0); else schedule();
  };
  video.addEventListener('waiting', () => { if (!video.hidden) $('photo-loading').hidden = false; });
  for (const event of ['loadedmetadata','canplay','playing']) video.addEventListener(event, () => { if (!video.hidden) $('photo-loading').hidden = true; });
  video.addEventListener('error', () => {
    if (video.hidden || selected?.kind !== 'video') return;
    $('photo-loading').hidden = true; $('photo-error').hidden = false;
    $('media-error-text').textContent = '이 영상은 브라우저에서 재생할 수 없거나 링크가 만료됐어요. 원본 열기로 확인해 주세요.'; stop();
  });
  video.addEventListener('ended', () => { if (slideshow) advance(1, false); });
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (viewer.requestFullscreen) await viewer.requestFullscreen(); } catch {} };
  if (!viewer.requestFullscreen) $('fullscreen').hidden = true;
  $('previous').onclick = () => advance(-1); $('next').onclick = () => advance(1); $('close').onclick = () => { video.pause(); viewer.close(); };
  viewer.addEventListener('cancel', () => video.pause());
  viewer.addEventListener('close', () => {
    ++showVersion; cancelPhotoLoads(); stop(); setZoom(false); resetVideo(); image.removeAttribute('src');
    const focus = lastFocused?.isConnected ? lastFocused : [...document.querySelectorAll('.card')].find(button => button.dataset.photoId === selected?.id) || $('all'); focus?.focus();
  });
  viewer.addEventListener('keydown', event => {
    if (event.target instanceof HTMLVideoElement || (event.target instanceof HTMLButtonElement && [' ','Enter'].includes(event.key))) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
    if (event.key === ' ') { event.preventDefault(); $('play').click(); }
  });
  let pointer;
  stage.addEventListener('pointerdown', event => { if (!zoomed && event.pointerType === 'touch' && !(event.target instanceof HTMLVideoElement)) pointer = {id:event.pointerId,x:event.clientX,y:event.clientY}; });
  stage.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId || zoomed) { pointer = null; return; }
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) advance(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { pointer = null; }); stage.style.touchAction = 'pan-y pinch-zoom';
  $('photo-retry').onclick = async () => { const version = showVersion; try { const url = await freshOriginal(); if (version !== showVersion || !viewer.open) return; if (selected?.kind === 'video') { video.src = url; video.play().catch(() => {}); $('photo-error').hidden = true; } else show(current); } catch {} };
  $('all').onclick = () => { onlyFavorites = false; load(); }; $('favorite').onclick = () => { onlyFavorites = true; load(); };
  $('sort').onchange = () => load(); $('media-type').onchange = () => load();
  $('period').onchange = () => { save('jian-period', $('period').value); render(); };
  $('refresh').onclick = () => load(); $('retry').onclick = () => load(!visible.length); $('more').onclick = () => more();
  $('resume-button').onclick = event => { lastFocused = event.target; onlyFavorites = false; $('media-type').value = 'all'; load(false, lastViewed); };
  if ('IntersectionObserver' in window) { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && page?.nextOffset != null) more(); }, {rootMargin:'700px'}); observer.observe($('more-area')); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); video.pause(); } else schedule(); });
  load(true);
})();
