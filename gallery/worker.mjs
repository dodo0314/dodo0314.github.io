import { GALLERY_HTML } from './page.mjs';
import { GALLERY_ASSETS } from './assets.mjs';
import { isPhoto, isVideo, isMedia, mediaDate, sortMedia } from './media.mjs';
export { isPhoto, isVideo, isMedia, mediaDate, sortMedia };

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'https://graph.microsoft.com/Files.Read.All offline_access';
const DEFAULT_ITEM = 'D37406022CBD6DFA!s6b816f233fc9405282fc6a0143fe0687';
const DEFAULT_SHARE = 'https://1drv.ms/a/c/d37406022cbd6dfa/IgAjb4FryT9SQIL8agFD_gaHAYrLN7LPVKSv0FA72S1P7bE';
const encoder = new TextEncoder();
let tokenCache;
let refreshing;
const albumStates = new WeakMap();
const SNAPSHOT_VERSION = 3;
const PAGE_SIZE = 60;
const SNAPSHOT_REFRESH_MS = 15 * 60000;
const BUILD_ID = '2026-10-12-profile-v5';
let signingKey;

class AppError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
async function step(label, operation) {
  try { return await operation(); }
  catch (cause) {
    const error = cause instanceof AppError ? cause : new AppError('잠시 연결에 문제가 있습니다. 다시 시도해 주세요.');
    if (!error.diagnostic) {
      const name = ['TypeError', 'SyntaxError', 'RangeError', 'Error'].includes(cause?.name) ? cause.name : 'Error';
      error.diagnostic = `${label} / ${name}`;
    }
    throw error;
  }
}
async function readConnection(env, type) {
  return step('KV 연결 정보 읽기', () => env.GALLERY_KV.get('connection', type));
}
function connectionId(connection) { return connection?.connectionId || connection?.connectedAt || 'legacy'; }
function albumState(env) {
  let state = albumStates.get(env.GALLERY_KV);
  if (!state) { state = {}; albumStates.set(env.GALLERY_KV, state); }
  return state;
}
async function albumKey(env) {
  const state = albumState(env);
  const input = JSON.stringify([SNAPSHOT_VERSION, env.MS_CLIENT_ID, env.ALBUM_ITEM_ID || DEFAULT_ITEM, env.ALBUM_SHARE_URL || DEFAULT_SHARE, env.ALBUM_TITLE || '']);
  if (state.keyInput !== input) {
    state.keyInput = input;
    state.key = 'album:' + base64url(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
    state.snapshot = null; state.checkedAt = 0;
  }
  return state.key;
}
async function upstream(label, input, init, consume) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await step(label, () => fetch(input, { ...init, signal: controller.signal }));
    return await consume(response);
  } catch (cause) {
    if (timedOut) {
      const error = new AppError('OneDrive 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
      error.diagnostic = `${label} / 20초 응답 대기 초과`;
      throw error;
    }
    throw cause;
  } finally { clearTimeout(timer); }
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64(value) {
  const str = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(str, c => c.charCodeAt(0));
}
function random() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function key(env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 20) throw new AppError('관리자 연결 설정이 아직 준비되지 않았습니다.');
  if (signingKey?.password !== env.ADMIN_PASSWORD) signingKey = { password: env.ADMIN_PASSWORD,
    promise: crypto.subtle.importKey('raw', encoder.encode(env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  return signingKey.promise;
}
export async function sign(data, env) {
  const payload = base64url(encoder.encode(JSON.stringify(data)));
  return payload + '.' + base64url(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(payload)));
}
export async function verify(value, env, kind) {
  try {
    const [payload, sig, extra] = (value || '').split('.');
    if (extra || !payload || !sig || value.length > 5000) return null;
    if (!await crypto.subtle.verify('HMAC', await key(env), unbase64(sig), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(unbase64(payload)));
    return data.kind === kind && data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function cookies(request) {
  const result = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const at = part.indexOf('='); if (at < 0) continue;
    try { result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1)); } catch { /* Ignore malformed cookies. */ }
  }
  return result;
}
function cookie(name, value, seconds) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`; }
function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Gallery-Build': BUILD_ID,
    // Preserve Origin on same-origin form posts so the CSRF check can validate them.
    // Suppress referrers when navigating to Microsoft or loading external photos.
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; style-src 'unsafe-inline'; font-src data:; img-src https: data: blob:; connect-src 'self'; media-src 'self' https: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...headers,
  } });
}
function json(body, status = 200, headers = {}) { return response(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); }
function redirect(location, setCookie) { return response(null, 303, { Location: location, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) }); }
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function origin(env) {
  const url = new URL(env.PUBLIC_ORIGIN || 'https://jian.jahab.workers.dev');
  if (url.protocol !== 'https:') throw new AppError('PUBLIC_ORIGIN을 HTTPS 주소로 설정해 주세요.');
  return url.origin;
}
function requireConfig(env) {
  if (!env.GALLERY_KV || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 20) {
    throw new AppError('OneDrive 연결 설정을 준비하고 있습니다. 잠시 후 다시 방문해 주세요.');
  }
  if (!['get', 'put', 'delete'].every(method => typeof env.GALLERY_KV[method] === 'function')) {
    const error = new AppError('OneDrive 연결 설정을 확인해 주세요.');
    error.diagnostic = 'GALLERY_KV 연결 형식 오류: Overview → Add a binding → KV namespace로 연결해 주세요';
    throw error;
  }
}
async function admin(request, env) { return verify(cookies(request).jian_admin, env, 'admin'); }
function requireOrigin(request, env) {
  if (request.headers.get('Origin') !== origin(env)) throw new AppError('요청을 확인할 수 없습니다.', 403);
}
async function tokenRequest(env, params) {
  return upstream('Microsoft 토큰 서버 연결', `${LOGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: SCOPE, ...params }),
  }, async r => {
    const data = await step(`Microsoft 토큰 응답 해석 (HTTP ${r.status})`, () => r.json());
    if (!r.ok || !data.access_token) throw new AppError('OneDrive 연결을 다시 확인해 주세요. 관리자 화면에서 재연결할 수 있습니다.');
    return data;
  });
}
async function saveToken(env, data, previousRefresh, previousConnection) {
  const refresh = data.refresh_token || previousRefresh;
  if (!refresh) throw new AppError('Microsoft의 지속 연결 권한을 받지 못했습니다. 다시 연결해 주세요.');
  // Token values stay in the bound KV namespace; no token is returned to a visitor.
  const identity = previousRefresh ? connectionId(previousConnection) : random();
  await step('KV 연결 정보 저장', () => env.GALLERY_KV.put('connection', JSON.stringify({ refreshToken: refresh,
    connectedAt: previousConnection?.connectedAt || new Date().toISOString(), connectionId: identity })));
  tokenCache = { value: data.access_token, until: Date.now() + Math.max(0, (Number(data.expires_in) - 120)) * 1000, client: env.MS_CLIENT_ID, identity };
}
async function accessToken(env, providedConnection) {
  requireConfig(env);
  const connection = providedConnection || await readConnection(env, 'json');
  if (!connection?.refreshToken) throw new AppError('아직 사진 앨범이 연결되지 않았습니다.');
  if (tokenCache?.client === env.MS_CLIENT_ID && tokenCache.identity === connectionId(connection) && tokenCache.until > Date.now()) return tokenCache.value;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: connection.refreshToken });
    await saveToken(env, data, connection.refreshToken, connection);
    return data.access_token;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
async function graph(path, env, providedToken) {
  let url = path.startsWith('https://') ? new URL(path) : new URL(GRAPH + path);
  // Never send owner credentials to an arbitrary pagination or redirect URL.
  const allowed = target => target.origin === 'https://graph.microsoft.com' && target.pathname.startsWith('/v1.0/') && !target.username && !target.password;
  if (!allowed(url)) throw new AppError('사진 목록 주소를 확인할 수 없습니다.');
  const token = providedToken || await accessToken(env);
  // Workers rejects redirect: 'error'. Use manual and validate each destination
  // before issuing another authenticated request.
  for (let redirects = 0; redirects <= 3; redirects++) {
    const result = await upstream('OneDrive API 서버 연결', url.href, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' }, async r => {
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const location = r.headers.get('Location');
        let target;
        try { target = location ? new URL(location, url) : null; } catch { /* Reject invalid locations. */ }
        if (!target || !allowed(target) || redirects === 3) {
          const error = new AppError('OneDrive API의 이동 주소를 안전하게 확인할 수 없습니다. 관리자 화면에서 연결을 확인해 주세요.');
          error.diagnostic = `OneDrive API 리디렉션 확인 (HTTP ${r.status})`;
          throw error;
        }
        await r.body?.cancel();
        return { target };
      }
      if (!r.ok) {
        const error = new AppError(`앨범을 불러오지 못했습니다 (${r.status}). 관리자 화면에서 연결을 확인해 주세요.`);
        error.upstreamStatus = r.status;
        throw error;
      }
      return { data: await step(`OneDrive 응답 해석 (HTTP ${r.status})`, () => r.json()) };
    });
    if (result.target) { url = result.target; continue; }
    return result.data;
  }
}
function shareToken(env) { return 'u!' + base64url(encoder.encode(env.ALBUM_SHARE_URL || DEFAULT_SHARE)); }
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}
async function deliverOriginal(target, request, record) {
  if (new URL(request.url).searchParams.get('mode') !== 'bytes') return redirect(target);
  if (record?.kind !== 'photo') throw new AppError('이 항목은 사진 원본이 아닙니다.', 400);
  return streamImage(target);
}
async function streamImage(target, preview = false) {
  // Only an authenticated Graph result / album snapshot supplies this URL.
  // Never forward the visitor's headers or the owner's Microsoft access token.
  const initial = new URL(target);
  const microsoftFileHost = host => ['1drv.com','1drvusercontent.com','onedrive.com','storage.live.com','sharepoint.com','microsoftpersonalcontent.com','usercontent.microsoft.com','blob.core.windows.net']
    .some(domain => host === domain || host.endsWith('.' + domain));
  const allowed = url => url.protocol === 'https:' && !url.username && !url.password && (url.origin === initial.origin || microsoftFileHost(url.hostname));
  let url = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowed(url)) throw new AppError('사진 원본 주소를 확인할 수 없습니다.');
    const result = await upstream('OneDrive 원본 서버 연결', url.href, { redirect: 'manual' }, async remote => {
      if ([301,302,303,307,308].includes(remote.status)) {
        const location = remote.headers.get('Location');
        let next;
        try { next = location ? new URL(location, url) : null; } catch {}
        await remote.body?.cancel();
        if (!next || !allowed(next) || redirects === 3) throw new AppError('사진 원본의 이동 주소를 확인할 수 없습니다.');
        return { next };
      }
      if (!remote.ok) {
        await remote.body?.cancel();
        const error = new AppError('사진 원본 링크가 만료됐거나 다운로드하지 못했습니다. 다시 시도해 주세요.');
        error.originalStatus = remote.status;
        throw error;
      }
      if (Number(remote.headers.get('Content-Length')) > (preview ? 8 : 32) * 1024 * 1024) {
        await remote.body?.cancel(); throw new AppError('이 사진은 브라우저 변환 용량을 초과합니다. 원본 열기를 사용해 주세요.', 413);
      }
      if (preview && !remote.headers.get('Content-Type')?.toLowerCase().startsWith('image/')) {
        await remote.body?.cancel(); throw new AppError('미리보기 이미지 응답을 확인할 수 없습니다.');
      }
      return { response: response(remote.body, 200, {
        'Content-Type': remote.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': preview ? 'private, max-age=300' : 'private, no-store', 'Content-Disposition': 'inline',
      }) };
    });
    if (result.next) { url = result.next; continue; }
    return result.response;
  }
}
async function getRoot(env, token) {
  const configured = env.ALBUM_ITEM_ID || DEFAULT_ITEM;
  try { return await graph(`/me/drive/items/${encodeURIComponent(configured)}`, env, token); }
  catch (e) { if (![400, 404].includes(e.upstreamStatus)) throw e; }
  // Migrated personal albums may resolve only through their sharing URL.
  return graph(`/shares/${shareToken(env)}/driveItem`, env, token);
}
export async function readAlbum(env, connection) {
  const token = await accessToken(env, connection);
  const root = await getRoot(env, token);
  if (!root || typeof root.id !== 'string') throw new AppError('OneDrive에서 앨범 ID를 받지 못했습니다. 앨범 연결을 확인해 주세요.');
  const id = encodeURIComponent(root.id);
  let next = `/me/drive/items/${id}/children?$expand=thumbnails&$top=200`;
  let source = 'owner';
  let pages = 0;
  const items = [];
  const seen = new Set();
  while (next) {
    if (++pages > 40) throw new AppError('앨범이 너무 큽니다. 작은 앨범으로 나눠 주세요.');
    let data;
    try { data = await graph(next, env, token); }
    catch (e) {
      if (pages !== 1 || ![400, 404].includes(e.upstreamStatus)) throw e;
      source = 'share';
      next = `/shares/${shareToken(env)}/driveItem/children?$expand=thumbnails&$top=200`;
      data = await graph(next, env, token);
    }
    if (!Array.isArray(data?.value)) throw new AppError('OneDrive에서 사진 목록 형식의 응답을 받지 못했습니다. 이 앨범의 API 지원 여부를 확인해야 합니다.');
    for (const item of data.value) {
      if (!isMedia(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      const thumbs = item.thumbnails?.[0] || {};
      const original = httpsUrl(item['@microsoft.graph.downloadUrl']);
      const kind = isVideo(item) ? 'video' : 'photo';
      const small = httpsUrl(thumbs.medium?.url || thumbs.small?.url || thumbs.large?.url);
      const large = httpsUrl(thumbs.large?.url || thumbs.medium?.url) || small;
      // Persist metadata, not a short-lived capability for every item. Capabilities
      // are issued only for the small page currently requested by a visitor.
      items.push({ id: item.id, name: item.name || '', kind, width: item.image?.width || item.video?.width || 0,
        height: item.image?.height || item.video?.height || 0, duration: Number(item.video?.duration) || 0,
        ...mediaDate(item), thumbnail: small, preview: large, source,
        driveId: item.parentReference?.driveId || root.parentReference?.driveId || '', downloadUrl: original, listingPath: next });
    }
    next = data['@odata.nextLink'] || null;
  }
  return { title: env.ALBUM_TITLE || root.name || '지안의 순간들', items,
    counts: { photo: items.filter(item => item.kind === 'photo').length, video: items.filter(item => item.kind === 'video').length },
    updatedAt: new Date().toISOString(), revision: random() };
}
async function album(env, force = false, ctx) {
  requireConfig(env);
  const connection = await readConnection(env, 'json');
  if (!connection?.refreshToken) throw new AppError('아직 사진 앨범이 연결되지 않았습니다.');
  const key = await albumKey(env), state = albumState(env), identity = connectionId(connection);
  const valid = snapshot => snapshot?.version === SNAPSHOT_VERSION && snapshot.key === key && snapshot.connectionId === identity && Array.isArray(snapshot.items);
  if (!force && valid(state.snapshot) && Date.now() - state.checkedAt < 60000) {
    if (Date.now() - Date.parse(state.snapshot.updatedAt) >= SNAPSHOT_REFRESH_MS && ctx?.waitUntil) ctx.waitUntil(refresh().catch(() => {}));
    return state.snapshot;
  }
  if (!force) {
    const stored = await step('저장된 앨범 목록 읽기', () => env.GALLERY_KV.get(key, 'json'));
    if (valid(stored)) {
      state.snapshot = stored; state.checkedAt = Date.now();
      if (Date.now() - Date.parse(stored.updatedAt) >= SNAPSHOT_REFRESH_MS && ctx?.waitUntil) ctx.waitUntil(refresh().catch(() => {}));
      return stored;
    }
  }
  return refresh();
  function refresh() {
    const loadingKey = key + ':' + identity;
    if (state.loadingKey === loadingKey && state.loading) return state.loading;
    const promise = (async () => {
      const data = await step('사진·영상 목록 구성', () => readAlbum(env, connection));
      const snapshot = { ...data, version: SNAPSHOT_VERSION, key, connectionId: identity };
      await step('앨범 목록 KV 저장', () => env.GALLERY_KV.put(key, JSON.stringify(snapshot)));
      state.snapshot = snapshot; state.checkedAt = Date.now();
      return snapshot;
    })();
    state.loadingKey = loadingKey; state.loading = promise;
    promise.finally(() => { if (state.loading === promise) state.loading = null; }).catch(() => {});
    return promise;
  }
}
function mediaLinks(item, listingPath) {
  const thumbs = item.thumbnails?.[0] || {};
  return { id:item.id, downloadUrl:httpsUrl(item['@microsoft.graph.downloadUrl']),
    thumbnail:httpsUrl(thumbs.medium?.url || thumbs.small?.url || thumbs.large?.url),
    preview:httpsUrl(thumbs.large?.url || thumbs.medium?.url || thumbs.small?.url), listingPath };
}
async function checkLinkOwner(env, snapshot) {
  const connection = await readConnection(env, 'json');
  if (!connection?.refreshToken || connectionId(connection) !== snapshot.connectionId || await albumKey(env) !== snapshot.key) {
    throw new AppError('이 사진·영상 링크가 만료되었습니다.', 403);
  }
}
function linksState(env, snapshot) {
  const state = albumState(env), scope = snapshot.key + ':' + snapshot.connectionId;
  if (state.links?.scope !== scope || state.links.revision !== snapshot.revision || Date.now() - state.links.startedAt >= SNAPSHOT_REFRESH_MS) {
    state.links = {scope,revision:snapshot.revision,startedAt:Date.now(),records:new Map(),allowed:new Set(snapshot.items.map(item => item.id)),pages:new Map(),next:null,initialized:false,count:0};
  }
  return state.links;
}
async function renewLinks(env, snapshot, record, force = false) {
  await checkLinkOwner(env, snapshot);
  const state = linksState(env, snapshot);
  const hint = record.listingPath || state.records.get(record.id)?.listingPath;
  if (force) {
    const previous = state.records.get(record.id);
    if (previous && state.pages.get(previous.listingPath)?.settled) state.pages.delete(previous.listingPath);
    state.records.delete(record.id);
  }
  if (state.records.has(record.id)) return state.records.get(record.id);
  const readPage = path => {
    if (!state.pages.has(path)) {
      const pending = (async () => {
        const data = await graph(path, env);
        if (!Array.isArray(data?.value)) throw new AppError('앨범 미리보기 목록을 확인할 수 없습니다.');
        await checkLinkOwner(env, snapshot);
        for (const item of data.value) if (isMedia(item) && state.allowed.has(item.id)) {
          state.records.set(item.id, mediaLinks(item, path));
        }
        return data['@odata.nextLink'] || null;
      })();
      const entry = {pending,settled:false}; state.pages.set(path, entry);
      pending.then(() => { entry.settled = true; }, () => { if (state.pages.get(path) === entry) state.pages.delete(path); });
    }
    return state.pages.get(path).pending;
  };
  // Synchronization records the exact collection page for each item. Subsequent
  // renewals read that page, instead of walking all 2,000+ album entries again.
  if (hint) {
    if (force && state.pages.get(hint)?.settled) state.pages.delete(hint);
    try { await readPage(hint); }
    catch (error) { if (![400,404].includes(error.upstreamStatus)) throw error; }
    if (state.records.has(record.id)) return state.records.get(record.id);
  }
  // Old snapshots lack page hints. Try newest filenames first; unsupported
  // ordering falls back to the album's normal collection, still stopping early.
  while (!state.records.has(record.id)) {
    if (!state.walking) {
      const pending = (async () => {
        if (!state.initialized) {
          const root = await getRoot(env);
          state.base = `/me/drive/items/${encodeURIComponent(root.id)}/children?$expand=thumbnails&$top=200`;
          state.next = state.base + '&$orderby=name%20desc'; state.initialized = true;
        }
        if (!state.next) throw new AppError('이 순간은 현재 앨범에 없습니다.', 404);
        if (++state.count > 40) throw new AppError('앨범 링크 조회가 너무 오래 걸립니다. 관리자 화면에서 목록을 새로고침해 주세요.');
        const path = state.next;
        try { state.next = await readPage(path); }
        catch (error) {
          if (state.count !== 1 || ![400,404].includes(error.upstreamStatus)) throw error;
          try { state.next = await readPage(state.base); }
          catch (fallback) {
            if (![400,404].includes(fallback.upstreamStatus)) throw fallback;
            state.next = await readPage(`/shares/${shareToken(env)}/driveItem/children?$expand=thumbnails&$top=200`);
          }
        }
      })();
      state.walking = pending;
      pending.finally(() => { if (state.walking === pending) state.walking = null; }).catch(() => {});
    }
    await state.walking;
  }
  return state.records.get(record.id);
}
export async function albumPage(snapshot, env, search, favoriteIds) {
  const order = ['new', 'old', 'album', 'uploaded'].includes(search.get('sort')) ? search.get('sort') : 'new';
  const type = ['photo', 'video'].includes(search.get('type')) ? search.get('type') : 'all';
  const rawOffset = search.get('offset') || '0';
  if (!/^\d{1,6}$/.test(rawOffset)) throw new AppError('목록 위치를 확인할 수 없습니다.', 400);
  let offset = Number(rawOffset);
  if (offset && search.get('revision') !== snapshot.revision) throw new AppError('목록이 새로 갱신되었습니다. 다시 불러와 주세요.', 409);
  const favorites = favoriteIds ? new Set(favoriteIds) : null;
  const filtered = snapshot.items.filter(item => (type === 'all' || item.kind === type) && (!favorites || favorites.has(item.id)));
  const ordered = sortMedia(filtered, order);
  const focus = search.get('focus');
  const focusPosition = focus ? ordered.findIndex(item => item.id === focus) : -1;
  if (focus && focusPosition < 0) throw new AppError('이 순간은 현재 선택한 목록에 없습니다.', 404);
  if (focusPosition >= 0) offset = Math.floor(focusPosition / PAGE_SIZE) * PAGE_SIZE;
  const items = await Promise.all(ordered.slice(offset, offset + PAGE_SIZE).map(async item => {
    const capability = await sign({ kind: 'media', id: item.id, scope: snapshot.key, connectionId: snapshot.connectionId, exp: Date.now() + 60 * 60000 }, env);
    return { id: item.id, name: item.name, kind: item.kind, width: item.width, height: item.height, duration: item.duration,
      date: item.date, dateSource: item.dateSource, uploadedAt: item.uploadedAt,
      thumbnail: '/api/preview/' + capability + '?size=thumb', preview: '/api/preview/' + capability,
      original: '/api/original/' + capability };
  }));
  return { title: snapshot.title, total: snapshot.items.length, counts: snapshot.counts, matched: ordered.length,
    items, offset, focusIndex: focusPosition >= 0 ? focusPosition - offset : null,
    nextOffset: offset + PAGE_SIZE < ordered.length ? offset + PAGE_SIZE : null,
    revision: snapshot.revision, updatedAt: snapshot.updatedAt, sort: order, type };
}
function adminPage(env, loggedIn, status = '', connected = false) {
  const missing = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'ADMIN_PASSWORD', 'GALLERY_KV'].filter(name => !env[name]);
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>갤러리 관리</title>
    <style>body{font:16px system-ui;background:#f6f1e7;color:#13212a;margin:0;padding:40px 20px}main{max-width:540px;margin:auto}h1{font-family:'Noto Serif KR','AppleMyungjo','Batang',serif;letter-spacing:-.04em}input,button{font:inherit;padding:14px;border:1px solid #c7d2ce;border-radius:4px}input{box-sizing:border-box;width:100%;margin:12px 0;background:#f7faf8;color:#13212a}button{background:#8c1d3c;color:white;cursor:pointer}p{line-height:1.7}a{color:#0f6e68}form{margin:24px 0}.status{padding:16px;background:#f7faf8;border:1px solid #c7d2ce;border-radius:4px}</style><main><a href="/">← 갤러리</a><h1>갤러리 관리</h1>
    ${status ? `<p class="status">${esc(status)}</p>` : ''}
    ${missing.length ? `<p>Cloudflare 설정이 필요합니다: ${esc(missing.join(', '))}</p>` : ''}
    ${loggedIn ? `<p>${connected === null ? '이 화면에서는 OneDrive 연결 상태를 확인하지 못했습니다.' : connected ? 'OneDrive가 연결되어 있습니다.' : 'OneDrive를 연결해 주세요.'} 앨범을 소유한 Microsoft 계정으로 로그인하세요.</p>
      <form action="/admin/connect" method="post"><button>OneDrive ${connected ? '다시 ' : ''}연결</button></form>
      <form action="/admin/check" method="post"><button>앨범 연결 확인·새로고침</button></form>
      <form action="/admin/disconnect" method="post"><button>연결 해제</button></form><form action="/admin/logout" method="post"><button>관리자 로그아웃</button></form>` :
      `<form action="/admin/login" method="post"><label for="password">관리자 비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>로그인</button></form>`}
    <p>보기 권한으로 연결합니다. 방문자에게는 지정된 앨범의 사진만 표시됩니다. 사진 변경은 OneDrive에서 하세요.</p></main></html>`;
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' && request.method === 'GET') return response(GALLERY_HTML);
      if (request.method === 'GET' && Object.hasOwn(GALLERY_ASSETS, url.pathname)) return response(GALLERY_ASSETS[url.pathname], 200, {
        'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable',
      });
      if (url.pathname === '/api/album' && ['GET', 'POST'].includes(request.method)) {
        let favoriteIds;
        if (request.method === 'POST') {
          if (Number(request.headers.get('Content-Length')) > 262144) throw new AppError('선택한 목록이 너무 큽니다.', 413);
          const body = await request.text();
          if (body.length > 262144) throw new AppError('선택한 목록이 너무 큽니다.', 413);
          let data;
          try { data = JSON.parse(body); } catch { throw new AppError('선택한 목록을 확인할 수 없습니다.', 400); }
          if (!data || !Array.isArray(data.favorites) || data.favorites.length > 8000 || data.favorites.some(id => typeof id !== 'string' || id.length > 200)) throw new AppError('선택한 목록을 확인할 수 없습니다.', 400);
          favoriteIds = data.favorites;
        }
        const snapshot = await album(env, false, ctx);
        return json(await albumPage(snapshot, env, url.searchParams, favoriteIds));
      }
      if (url.pathname === '/api/item' && request.method === 'GET') {
        const snapshot = await album(env, false, ctx);
        const data = await albumPage(snapshot, env, new URLSearchParams(), [url.searchParams.get('id') || '']);
        if (!data.items.length) throw new AppError('이 순간은 현재 앨범에 없습니다.', 404);
        data.items[0].original += '?fresh=1';
        return json(data.items[0]);
      }
      if ((url.pathname.startsWith('/api/original/') || url.pathname.startsWith('/api/preview/')) && request.method === 'GET') {
        requireConfig(env);
        const isPreview = url.pathname.startsWith('/api/preview/');
        if (isPreview && url.searchParams.has('size') && url.searchParams.get('size') !== 'thumb') throw new AppError('미리보기 크기를 확인해 주세요.', 400);
        const capability = url.pathname.slice(isPreview ? '/api/preview/'.length : '/api/original/'.length);
        const media = await verify(capability, env, 'media');
        const photo = media || await verify(capability, env, 'photo');
        if (!photo || typeof photo.id !== 'string') throw new AppError('사진 링크가 만료되었습니다. 갤러리를 새로고침해 주세요.', 403);
        const connection = await readConnection(env, 'json');
        if (!connection?.refreshToken) throw new AppError('아직 사진 앨범이 연결되지 않았습니다.');
        if (media) {
          if (media.scope !== await albumKey(env) || media.connectionId !== connectionId(connection)) throw new AppError('이 사진·영상 링크가 만료되었습니다.', 403);
          const snapshot = await album(env);
          const record = snapshot.items.find(item => item.id === media.id);
          if (!record) throw new AppError('이 순간은 현재 앨범에 없습니다.', 404);
          const snapshotAge = Date.now() - Date.parse(snapshot.updatedAt);
          const targetOf = links => isPreview ? url.searchParams.get('size') === 'thumb' ? links.thumbnail || links.preview : links.preview || links.thumbnail : links.downloadUrl;
          const resolve = async (force = false) => {
            const cached = linksState(env,snapshot).records.get(record.id);
            if (!force && targetOf(cached || {})) return targetOf(cached);
            if (!force && url.searchParams.get('fresh') !== '1' && snapshotAge >= 0 && snapshotAge < SNAPSHOT_REFRESH_MS && targetOf(record)) return targetOf(record);
            if (!isPreview) {
              const path = record.driveId ? `/drives/${encodeURIComponent(record.driveId)}/items/${encodeURIComponent(record.id)}` : record.source === 'share'
                ? `/shares/${shareToken(env)}/items/${encodeURIComponent(record.id)}` : `/me/drive/items/${encodeURIComponent(record.id)}`;
              try {
                const item = await graph(path, env);
                if (isMedia(item) && targetOf(mediaLinks(item))) return targetOf(mediaLinks(item));
              } catch (error) { if (![400,403,404].includes(error.upstreamStatus)) throw error; }
            }
            const links = await renewLinks(env,snapshot,record,force);
            const target = targetOf(links);
            if (!target) throw new AppError(isPreview ? '이 사진·영상의 미리보기를 받지 못했습니다.' : '이 사진·영상의 원본 링크를 받지 못했습니다.', 404);
            return target;
          };
          const deliver = target => isPreview ? streamImage(target,true) : deliverOriginal(target,request,record);
          try { return await deliver(await resolve()); }
          catch (error) {
            if (![401,403,404,410].includes(error.originalStatus)) throw error;
            return await deliver(await resolve(true));
          }
        }
        // Some migrated albums do not expose direct child-item metadata paths.
        // The album listing already supplied a short-lived download URL for this specific photo.
        if (isPreview || url.searchParams.get('mode') === 'bytes') throw new AppError('사진 링크를 갱신해 주세요.', 403);
        if (photo.source === 'share' && httpsUrl(photo.url)) return redirect(httpsUrl(photo.url));
        const path = photo.source === 'share' ? `/shares/${shareToken(env)}/items/${encodeURIComponent(photo.id)}` : `/me/drive/items/${encodeURIComponent(photo.id)}`;
        const item = await graph(path, env);
        const target = httpsUrl(item['@microsoft.graph.downloadUrl']);
        if (!target || !isPhoto(item)) throw new AppError('이 사진의 원본을 불러올 수 없습니다.');
        return redirect(target);
      }
      if (url.pathname === '/admin' && request.method === 'GET') {
        const authenticated = !!await admin(request, env);
        const connected = authenticated && !!await readConnection(env);
        return response(adminPage(env, authenticated, '', connected));
      }
      if (url.pathname === '/admin/login' && request.method === 'POST') {
        requireOrigin(request, env); requireConfig(env);
        if (Number(request.headers.get('Content-Length')) > 4096) throw new AppError('요청이 너무 큽니다.', 413);
        const form = await request.formData();
        const input = String(form.get('password') || '');
        if (input.length > 500) throw new AppError('비밀번호를 확인해 주세요.', 401);
        const digest = async v => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(v)));
        const [a, b] = await Promise.all([digest(input), digest(env.ADMIN_PASSWORD)]);
        let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
        if (difference) return response(adminPage(env, false, '비밀번호를 확인해 주세요.'), 401);
        return redirect('/admin', cookie('jian_admin', await sign({ kind: 'admin', exp: Date.now() + 3600000 }, env), 3600));
      }
      if (url.pathname.startsWith('/admin/') && request.method === 'POST') {
        requireOrigin(request, env); requireConfig(env);
        if (!await admin(request, env)) return redirect('/admin');
        if (url.pathname === '/admin/connect') {
          const state = random(); const verifier = random();
          const challenge = base64url(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
          const oauth = await sign({ kind: 'oauth', state, verifier, exp: Date.now() + 600000 }, env);
          const authorize = new URL(`${LOGIN}/authorize`);
          authorize.search = new URLSearchParams({ client_id: env.MS_CLIENT_ID, response_type: 'code', response_mode: 'query',
            redirect_uri: origin(env) + '/auth/callback', scope: SCOPE, state, code_challenge: challenge,
            code_challenge_method: 'S256', prompt: 'select_account' }).toString();
          return redirect(authorize.href, cookie('jian_oauth', oauth, 600));
        }
        if (url.pathname === '/admin/check') {
          const data = await album(env, true);
          return response(adminPage(env, true, `앨범 연결 확인: 사진 ${data.counts.photo}장 · 영상 ${data.counts.video}개. 빠른 조회용 목록을 저장했습니다.`, true));
        }
        if (url.pathname === '/admin/disconnect') {
          await step('KV 연결 정보 삭제', () => env.GALLERY_KV.delete('connection'));
          await step('앨범 목록 삭제', async () => env.GALLERY_KV.delete(await albumKey(env)));
          tokenCache = null; albumStates.delete(env.GALLERY_KV);
          return response(adminPage(env, true, '연결을 해제했습니다. 이미 방문자가 받은 사진은 회수되지 않습니다.'));
        }
        if (url.pathname === '/admin/logout') return redirect('/admin', cookie('jian_admin', '', 0));
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        requireConfig(env);
        const oauth = await verify(cookies(request).jian_oauth, env, 'oauth');
        if (!oauth || oauth.state !== url.searchParams.get('state')) throw new AppError('연결 요청이 만료되었습니다. 관리자 화면에서 다시 시작해 주세요.', 403);
        if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new AppError('Microsoft 연결이 완료되지 않았습니다. 다시 시도해 주세요.');
        const data = await tokenRequest(env, { grant_type: 'authorization_code', code: url.searchParams.get('code'),
          redirect_uri: origin(env) + '/auth/callback', code_verifier: oauth.verifier });
        await saveToken(env, data); albumStates.delete(env.GALLERY_KV);
        return redirect('/admin', cookie('jian_oauth', '', 0));
      }
      return json({ error: '페이지를 찾을 수 없습니다.' }, 404);
    } catch (e) {
      // Never expose upstream bodies, raw exceptions or credentials. Only an authenticated
      // administrator can see controlled operation labels and error type names.
      const message = e instanceof AppError ? e.message : '잠시 연결에 문제가 있습니다. 다시 시도해 주세요.';
      if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/auth')) {
        const authenticated = !!await admin(request, env);
        const diagnostic = authenticated && e.diagnostic ? ` [실패 단계: ${e.diagnostic}]` : '';
        return response(adminPage(env, authenticated, message + diagnostic, null), e.status || 503);
      }
      return json({ error: message }, e.status || 503);
    }
  },
};
