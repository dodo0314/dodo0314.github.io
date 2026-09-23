import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadBackupToAppFolder } from '../src/services/onedrive-upload';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('small backup uses only the app folder and verifies stored size', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return json({ id: 'folder-1' });
    return json({ id: 'saved-1', name: 'moa.zip', size: 3 }, 201);
  };
  const item = await uploadBackupToAppFolder('token', new Blob(['abc']), 'moa.zip', () => {}, request as typeof fetch);
  assert.equal(item.id, 'saved-1');
  assert.match(calls[0].url, /\/me\/drive\/special\/approot$/);
  assert.match(calls[1].url, /\/me\/drive\/items\/folder-1:\/moa.zip:\/content$/);
  assert.equal(calls[1].options?.method, 'PUT');
  assert.equal((calls[1].options?.headers as Record<string, string>).Authorization, 'Bearer token');
});

test('large backup uploads sequential chunks without bearer token on preauthorized URL', async () => {
  const size = 10 * 1024 * 1024 + 5;
  const ranges: string[] = [];
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/special/approot')) return json({ id: 'folder-2' });
    if (String(url).endsWith('/createUploadSession')) return json({ uploadUrl: 'https://upload.example.test/session' });
    assert.equal(String(url), 'https://upload.example.test/session');
    const headers = options?.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
    ranges.push(headers['Content-Range']);
    return ranges.length === 1 ? json({ nextExpectedRanges: [`${10 * 1024 * 1024}-`] }, 202) : json({ id: 'saved-2', name: 'moa.zip', size }, 201);
  };
  const item = await uploadBackupToAppFolder('token', new Blob([new Uint8Array(size)]), 'moa.zip', () => {}, request as typeof fetch);
  assert.equal(item.size, size);
  assert.deepEqual(ranges, [`bytes 0-${10 * 1024 * 1024 - 1}/${size}`, `bytes ${10 * 1024 * 1024}-${size - 1}/${size}`]);
});

test('upload failures never report a completed backup', async () => {
  const request = async () => json({ error: { message: 'permission denied' } }, 403);
  await assert.rejects(uploadBackupToAppFolder('token', new Blob(['abc']), 'moa.zip', () => {}, request as typeof fetch), /403.*permission denied/);
});

test('personal AppFolder falls back to direct upload when session permission is denied', async () => {
  const size = 10 * 1024 * 1024 + 1;
  const methods: string[] = [];
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    methods.push(options?.method || 'GET');
    if (String(url).endsWith('/special/approot')) return json({ id: 'folder-3' });
    if (String(url).endsWith('/createUploadSession')) return json({ error: { message: 'scope' } }, 403);
    return json({ id: 'saved-3', size }, 201);
  };
  const item = await uploadBackupToAppFolder('token', new Blob([new Uint8Array(size)]), 'backup.zip', () => {}, request as typeof fetch);
  assert.equal(item.size, size);
  assert.deepEqual(methods, ['GET', 'POST', 'PUT']);
});
