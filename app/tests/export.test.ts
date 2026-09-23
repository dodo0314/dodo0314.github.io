import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareBackup, prepareExport, ExportAdapter } from '../src/core/export';
import { defaultOptions, fitSize, frameTimes, mediaCounts, MediaBlock, moveBlock, newNote, textBlock } from '../src/core/model';
import { SaveQueue } from '../src/core/save-queue';

function adapter() {
  const calls: string[] = [];
  const file = (path: string, mime: string) => ({ path, mime, uri: path, size: 10 });
  const api: ExportAdapter = {
    async text(content, path) { calls.push('text'); return file(path, 'text/markdown'); },
    async image(id, edge, path) { calls.push(`image:${id}:${edge}`); return file(path, 'image/jpeg'); },
    async frame(id, ms, edge, path) { calls.push(`frame:${id}:${ms}`); return file(path, 'image/jpeg'); },
    async original(id, path, mime) { calls.push(`original:${id}`); return file(path, mime); },
  };
  return { calls, api };
}
const photo: MediaBlock = { id: 'photo', type: 'image', assetId: 'photo.jpg', name: '사진', mime: 'image/jpeg', caption: '저녁 산책', width: 4000, height: 3000, durationMs: 0, size: 1000, included: true };
const video: MediaBlock = { ...photo, id: 'video', type: 'video', assetId: 'clip.mov', mime: 'video/quicktime', durationMs: 6000, caption: '움직이는 장면' };
test('text-only export has exactly one MD and never invokes media conversion', async () => {
  const note = { ...newNote(), title: '나의 / 기록', blocks: [textBlock('처음\n\n두 번째 문단')] };
  const mock = adapter();
  const result = await prepareExport([note], defaultOptions, mock.api);
  assert.deepEqual(mock.calls, ['text']);
  assert.equal(result.files.length, 1);
  assert.equal(result.basename, '나의 - 기록');
  assert.match(result.markdown, /처음\n\n두 번째 문단/);
  assert.equal(mediaCounts([note]).total, 0);
});
test('mixed export preserves authored order, captions, timestamps and default omission of raw video', async () => {
  const note = { ...newNote(), blocks: [textBlock('첫 문단'), photo, textBlock('다음 문단'), video] };
  const mock = adapter();
  const result = await prepareExport([note], defaultOptions, mock.api);
  assert.equal(result.visualCount, 4);
  assert.deepEqual(result.files.map(f => f.path), ['기록.md', 'media/01-002-photo.jpg', 'media/01-004-video-000000000ms.jpg', 'media/01-004-video-000002950ms.jpg', 'media/01-004-video-000005900ms.jpg']);
  assert.ok(result.markdown.indexOf('첫 문단') < result.markdown.indexOf('저녁 산책'));
  assert.ok(result.markdown.indexOf('저녁 산책') < result.markdown.indexOf('다음 문단'));
  assert.match(result.markdown, /00:02.950/);
  assert.ok(!mock.calls.some(c => c.startsWith('original:')));
});
test('excluded media skips converters and is explicitly marked as absent', async () => {
  const note = { ...newNote(), blocks: [{ ...photo, included: false }, { ...video, included: false }] };
  const mock = adapter();
  const result = await prepareExport([note], defaultOptions, mock.api);
  assert.equal(mediaCounts([note]).total, 0);
  assert.equal(mediaCounts([note]).omitted, 2);
  assert.deepEqual(mock.calls, ['text']);
  assert.match(result.markdown, /사용자가 이번 내보내기에서 제외/);
});
test('raw video inclusion is opt-in and multiple notes have unique paths', async () => {
  const mock = adapter();
  const result = await prepareExport([{ ...newNote(), blocks: [video] }, { ...newNote(), blocks: [photo] }], { ...defaultOptions, originalVideos: true }, mock.api);
  assert.ok(result.files.some(f => f.path === 'media/01-001-original.mov'));
  assert.ok(result.files.some(f => f.path === 'media/02-001-photo.jpg'));
});
test('AI export includes original photos only when requested', async () => {
  const mock = adapter();
  const result = await prepareExport([{ ...newNote(), blocks: [photo] }], { ...defaultOptions, originalImages: true }, mock.api);
  assert.deepEqual(result.files.map(f => f.path), ['기록.md', 'media/01-001-photo.jpg', 'media/01-001-original.jpg']);
  assert.match(result.markdown, /\[사진 원본\]\(media\/01-001-original.jpg\)/);
  assert.ok(mock.calls.includes('original:photo.jpg'));
});
test('backup contains every original even when media is omitted from AI export', async () => {
  const mock = adapter();
  let manifest = '';
  mock.api.text = async (content, path) => { manifest = content; return { path, uri: path, mime: 'application/json', size: content.length }; };
  const note = { ...newNote(), blocks: [textBlock('비공개 일기'), { ...photo, included: false }, video] };
  const result = await prepareBackup([note], mock.api);
  assert.deepEqual(result.files.map(f => f.path), ['backup.json', 'media/photo.jpg', 'media/clip.mov']);
  assert.deepEqual(mock.calls, ['original:photo.jpg', 'original:clip.mov']);
  const backup = JSON.parse(manifest);
  assert.equal(backup.format, 'moa-backup');
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.notes, [note]);
  assert.deepEqual(backup.media.map((item: { path: string }) => item.path), ['media/photo.jpg', 'media/clip.mov']);
});
test('short video times stay in bounds; images never upscale; reordering preserves data', () => {
  for (const duration of [1, 50, 100, 90000]) { const times = frameTimes(duration, 12); assert.equal(new Set(times).size, times.length); assert.ok(times.every(t => t >= 0 && t < duration)); }
  assert.throws(() => frameTimes(0, 3));
  assert.deepEqual(fitSize(4000, 3000, 1440), { width: 1440, height: 1080 });
  assert.deepEqual(fitSize(640, 480, 1440), { width: 640, height: 480 });
  const note = { ...newNote(), blocks: [photo, video] };
  assert.deepEqual(moveBlock(note, 'video', -1).blocks, [video, photo]);
  assert.deepEqual(note.blocks, [photo, video]);
});
test('export failure is surfaced instead of returning an incomplete bundle', async () => {
  const mock = adapter();
  mock.api.image = async () => { throw new Error('missing photo'); };
  await assert.rejects(prepareExport([{ ...newNote(), blocks: [photo] }], defaultOptions, mock.api), /missing photo/);
});
test('failed saves retain the latest draft and retry successfully', async () => {
  let fail = true;
  const written: string[] = [];
  const queue = new SaveQueue<{id: string; text: string}>(async value => { if (fail) throw new Error('disk full'); written.push(value.text); }, () => {});
  queue.schedule({ id: 'a', text: 'old' });
  await assert.rejects(queue.flush(), /disk full/);
  queue.schedule({ id: 'a', text: 'newest' });
  fail = false;
  await queue.flush();
  assert.deepEqual(written, ['newest']);
});
test('save writes are serialized and newer edits win even during an in-flight save', async () => {
  const written: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const queue = new SaveQueue<{id: string; text: string}>(async value => { if (value.text === 'first') await blocked; written.push(value.text); }, () => {});
  queue.schedule({ id: 'a', text: 'first' });
  const pending = queue.flush();
  queue.schedule({ id: 'a', text: 'second' });
  queue.schedule({ id: 'a', text: 'third' });
  release(); await pending; await queue.flush();
  assert.deepEqual(written, ['first', 'third']);
});
