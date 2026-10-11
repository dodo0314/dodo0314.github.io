import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaDate, sortMedia, isPhoto, isVideo, isMedia } from '../media.mjs';

test('iOS filenames retain September 2025 dates instead of an October 2026 upload date', () => {
  const first = { id: 'first', ...mediaDate({ name: '20250909_083516466_iOS.jpg', createdDateTime: '2026-10-11T12:00:00Z' }) };
  const second = { id: 'second', ...mediaDate({ name: '20250911_072640236_iOS.jpg', createdDateTime: '2026-10-11T12:00:00Z' }) };
  const format = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  assert.equal(format(first.date), '2025-09-09');
  assert.equal(format(second.date), '2025-09-11');
  assert.equal(first.dateSource, 'filename');
  assert.deepEqual(sortMedia([first, second]).map(item => item.id), ['second', 'first']);
  assert.deepEqual(sortMedia([first, second], 'old').map(item => item.id), ['first', 'second']);
});
test('captured metadata, original file date and upload date have explicit fallbacks', () => {
  assert.equal(mediaDate({ name:'20250909_083516466_iOS.jpg', photo:{takenDateTime:'2026-10-11T12:00:00Z'}, createdDateTime:'2026-10-11T12:00:00Z' }).dateSource,'filename');
  assert.equal(mediaDate({ name: 'plain.jpg', photo: { takenDateTime: '2024-01-02T09:00:00' }, createdDateTime: '2026-10-11T00:00:00Z' }).date, '2024-01-02T00:00:00.000Z');
  assert.equal(mediaDate({ name: 'plain.jpg', fileSystemInfo: { createdDateTime: '2023-04-05T00:00:00Z' }, createdDateTime: '2026-10-11T00:00:00Z' }).dateSource, 'file-created');
  assert.equal(mediaDate({ name: 'plain.jpg', createdDateTime: '2026-10-11T00:00:00Z' }).dateSource, 'uploaded');
  assert.equal(mediaDate({ name: 'random_20250101.jpg', createdDateTime: '1970-01-01T00:00:00Z' }).dateSource, 'unknown');
  assert.equal(mediaDate({ name: '20250231_083516_iOS.jpg' }).dateSource, 'unknown');
});
test('undated items are last in both orders and upload sorting is independent of capture time', () => {
  const items = [{ id: 'old', sortTime: 10, uploadTime: 30 }, { id: 'unknown', sortTime: 0, uploadTime: 10 }, { id: 'new', sortTime: 20, uploadTime: 20 }];
  assert.deepEqual(sortMedia(items, 'new').map(item => item.id), ['new','old','unknown']);
  assert.deepEqual(sortMedia(items, 'old').map(item => item.id), ['old','new','unknown']);
  assert.deepEqual(sortMedia(items, 'uploaded').map(item => item.id), ['old','new','unknown']);
  assert.deepEqual(sortMedia(items, 'album').map(item => item.id), ['old','unknown','new']);
});
test('videos are included while documents and folders remain excluded', () => {
  const movie = { id: 'movie', name: '20250911_072640236_iOS.mov', file: { mimeType: 'video/quicktime' }, video: { duration: 42000 } };
  assert.equal(isPhoto(movie), false); assert.equal(isVideo(movie), true); assert.equal(isMedia(movie), true);
  assert.equal(isMedia({ id: 'folder', name: 'photos.mp4', folder: {} }), false);
  assert.equal(isMedia({ id: 'document', name: 'notes.txt', file: { mimeType: 'text/plain' } }), false);
});
