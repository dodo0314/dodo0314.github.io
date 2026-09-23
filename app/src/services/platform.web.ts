import { Zip, ZipPassThrough } from 'fflate';
import { ExportAdapter, OutputFile } from '../core/export';
import { fitSize, MediaBlock, Note, uid } from '../core/model';

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('moa-local', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('notes', { keyPath: 'id' }); request.result.createObjectStore('media'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function operation<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error || new Error('기기 저장 공간을 확인해 주세요.'));
    transaction.onabort = () => reject(transaction.error || new Error('저장이 중단되었습니다.'));
  });
}
export async function listNotes(): Promise<Note[]> { return operation('notes', 'readonly', store => store.getAll()); }
export async function saveNote(note: Note) { await operation('notes', 'readwrite', store => store.put(note)); }
export async function deleteNote(note: Note) {
  await operation('notes', 'readwrite', store => store.delete(note.id));
  for (const block of note.blocks) if (block.type !== 'text') await operation('media', 'readwrite', store => store.delete(block.assetId));
}
const urls = new Map<string, string>();
async function assetBlob(id: string): Promise<Blob> {
  const blob = await operation<Blob>('media', 'readonly', store => store.get(id));
  if (!blob) throw new Error('첨부파일을 찾을 수 없습니다.');
  return blob;
}
export async function assetUri(id: string) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(await assetBlob(id)));
  return urls.get(id)!;
}
function waitFor(element: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); element.removeEventListener(event, done); element.removeEventListener('error', fail); if (error) reject(error); else resolve(); };
    const done = () => finish();
    const fail = () => finish(new Error('이 브라우저에서 읽을 수 없는 영상입니다. 아이폰 앱에서 다시 시도해 주세요.'));
    const timer = setTimeout(() => finish(new Error('영상 처리 시간이 초과되었습니다.')), 30000);
    element.addEventListener(event, done, { once: true });
    element.addEventListener('error', fail, { once: true });
  });
}
async function loadImage(uri: string) {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('사진을 읽지 못했습니다. JPEG 또는 PNG로 첨부해 주세요.')); });
  image.src = uri;
  await loaded;
  return image;
}
async function loadVideo(uri: string) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const loaded = waitFor(video, 'loadeddata');
  video.src = uri; video.load();
  await loaded;
  return video;
}
export async function pickMedia(type: 'image' | 'video'): Promise<MediaBlock[]> {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = type === 'image' ? 'image/*' : 'video/*'; input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  const files = await new Promise<File[]>(resolve => {
    input.onchange = () => { const files = Array.from(input.files || []); input.remove(); resolve(files); };
    input.addEventListener('cancel', () => { input.remove(); resolve([]); }, { once: true });
    input.click();
  });
  const imported: MediaBlock[] = [];
  try { for (const file of files) {
    const id = `${uid()}.${file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`;
    const uri = URL.createObjectURL(file);
    try {
      let width: number, height: number, durationMs = 0;
      if (type === 'image') { const image = await loadImage(uri); width = image.naturalWidth; height = image.naturalHeight; }
      else { const video = await loadVideo(uri); width = video.videoWidth; height = video.videoHeight; durationMs = Math.round(video.duration * 1000); video.removeAttribute('src'); video.load(); }
      await operation('media', 'readwrite', store => store.put(file, id));
      imported.push({ id: uid(), type, assetId: id, name: file.name, mime: file.type, caption: '', width, height, durationMs, size: file.size, included: true });
    } finally { URL.revokeObjectURL(uri); }
  } } catch (error) {
    for (const item of imported) await operation('media', 'readwrite', store => store.delete(item.assetId));
    throw error;
  }
  return imported;
}
const outputs = new Map<string, Blob>();
function output(blob: Blob, path: string): OutputFile {
  const uri = URL.createObjectURL(blob); outputs.set(uri, blob);
  return { path, uri, mime: blob.type, size: blob.size };
}
async function canvasImage(source: CanvasImageSource, width: number, height: number, edge: number, path: string) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, fitSize(width, height, edge));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지 처리 기능을 사용할 수 없습니다.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.')), 'image/jpeg', 0.82));
  return output(blob, path);
}
export function createExportAdapter(): ExportAdapter {
  return {
    async image(id, edge, path) { const image = await loadImage(await assetUri(id)); return canvasImage(image, image.naturalWidth, image.naturalHeight, edge, path); },
    async frame(id, ms, edge, path) {
      const video = await loadVideo(await assetUri(id));
      try {
        if (ms > 0) { const seek = waitFor(video, 'seeked'); video.currentTime = ms / 1000; await seek; }
        return await canvasImage(video, video.videoWidth, video.videoHeight, edge, path);
      } finally { video.removeAttribute('src'); video.load(); }
    },
    async original(id, path) { return output(await assetBlob(id), path); },
    async text(content, path, mime = 'text/markdown') { return output(new Blob([content], { type: mime }), path); },
  };
}
export async function makeZip(files: OutputFile[], basename: string): Promise<OutputFile> {
  const chunks: BlobPart[] = [];
  const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(new Uint8Array(chunk).buffer); });
  for (const item of files) {
    const blob = outputs.get(item.uri);
    if (!blob) throw new Error('내보내기를 다시 준비해 주세요.');
    const entry = new ZipPassThrough(item.path); zip.add(entry);
    for (let offset = 0; offset < blob.size; offset += 256 * 1024) entry.push(new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer()), false);
    entry.push(new Uint8Array(), true);
  }
  zip.end();
  return output(new Blob(chunks, { type: 'application/zip' }), `${basename}.zip`);
}
export async function shareFile(file: OutputFile) {
  const blob = outputs.get(file.uri);
  if (!blob) throw new Error('내보내기를 다시 준비해 주세요.');
  const download = new File([blob], file.path.split('/').pop()!, { type: file.mime });
  if (navigator.canShare?.({ files: [download] })) {
    try { await navigator.share({ files: [download] }); return; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Embedded browsers may advertise Web Share while denying it at runtime.
      if (!(error instanceof DOMException && ['NotAllowedError', 'NotSupportedError', 'SecurityError'].includes(error.name))) throw error;
    }
  }
  const link = document.createElement('a'); link.href = file.uri; link.download = download.name; document.body.appendChild(link); link.click(); link.remove();
}
