import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import * as Sharing from 'expo-sharing';
import { Zip, ZipPassThrough } from 'fflate';
import { ExportAdapter, OutputFile } from '../core/export';
import { fitSize, MediaBlock, Note, uid } from '../core/model';

const media = new Directory(Paths.document, 'media');
const cache = new Directory(Paths.cache, 'moa-exports');
const database = SQLite.openDatabaseAsync('moa.db').then(async db => {
  await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, json TEXT NOT NULL);');
  media.create({ idempotent: true, intermediates: true });
  cache.create({ idempotent: true, intermediates: true });
  return db;
});
export async function listNotes(): Promise<Note[]> {
  return (await (await database).getAllAsync<{json: string}>('SELECT json FROM notes')).map(row => JSON.parse(row.json));
}
export async function saveNote(note: Note) {
  await (await database).runAsync('INSERT OR REPLACE INTO notes (id,json) VALUES (?,?)', note.id, JSON.stringify(note));
}
export async function deleteNote(note: Note) {
  await (await database).runAsync('DELETE FROM notes WHERE id = ?', note.id);
  for (const block of note.blocks) if (block.type !== 'text') {
    const file = new File(media, block.assetId);
    if (file.exists) file.delete();
  }
}
export async function assetUri(id: string) { return new File(media, id).uri; }
export async function pickMedia(type: 'image' | 'video'): Promise<MediaBlock[]> {
  await database;
  if (type === 'video') {
    const permission = await Picker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error('영상 첨부를 위해 사진 보관함 접근을 허용해 주세요.');
  }
  const result = await Picker.launchImageLibraryAsync({ mediaTypes: type === 'image' ? ['images'] : ['videos'], allowsMultipleSelection: true, orderedSelection: true, quality: 1 });
  if (result.canceled) return [];
  const imported: MediaBlock[] = [];
  try {
    for (const asset of result.assets) {
      const extension = (asset.fileName || asset.uri).split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || (type === 'image' ? 'jpg' : 'mov');
      const id = `${uid()}.${extension}`;
      const dest = new File(media, id);
      new File(asset.uri).copy(dest);
      imported.push({ id: uid(), type, assetId: id, name: asset.fileName || id, mime: asset.mimeType || (type === 'image' ? 'image/jpeg' : 'video/quicktime'), caption: '', width: asset.width, height: asset.height, durationMs: asset.duration || 0, size: dest.size, included: true });
    }
    return imported;
  } catch (error) {
    for (const item of imported) new File(media, item.assetId).delete();
    throw error;
  }
}
function output(path: string, file: File, mime: string): OutputFile { return { path, uri: file.uri, mime, size: file.size }; }
export function createExportAdapter(): ExportAdapter {
  const dir = new Directory(cache, uid());
  dir.create({ intermediates: true });
  const target = (path: string) => {
    const file = new File(dir, path);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    return file;
  };
  const image: ExportAdapter['image'] = async (id, edge, path) => {
    const context = ImageManipulator.manipulate(new File(media, id).uri);
    const original = await context.renderAsync();
    const resized = ImageManipulator.manipulate(original);
    resized.resize(fitSize(original.width, original.height, edge));
    const rendered = await resized.renderAsync();
    try {
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
      const dest = target(path);
      new File(saved.uri).move(dest);
      return output(path, dest, 'image/jpeg');
    } finally { rendered.release(); resized.release(); original.release(); context.release(); }
  };
  return {
    image,
    async frame(id, ms, edge, path) {
      const player = createVideoPlayer(null);
      try {
        await player.replaceAsync(new File(media, id).uri);
        const [thumbnail] = await player.generateThumbnailsAsync(ms / 1000, { maxWidth: edge, maxHeight: edge });
        const context = ImageManipulator.manipulate(thumbnail);
        const rendered = await context.renderAsync();
        try {
          const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
          const dest = target(path);
          new File(saved.uri).move(dest);
          return output(path, dest, 'image/jpeg');
        } finally { rendered.release(); context.release(); thumbnail.release(); }
      } finally { player.release(); }
    },
    async original(id, path, mime) { const dest = target(path); new File(media, id).copy(dest); return output(path, dest, mime); },
    async text(content, path, mime = 'text/markdown') { const dest = target(path); dest.create(); dest.write(content); return output(path, dest, mime); },
  };
}
export async function makeZip(files: OutputFile[], basename: string): Promise<OutputFile> {
  const file = new File(cache, `${uid()}-${basename}.zip`);
  file.create();
  const writer = file.open();
  try {
    const zip = new Zip((error, chunk) => { if (error) throw error; writer.writeBytes(chunk); });
    for (const item of files) {
      const entry = new ZipPassThrough(item.path);
      zip.add(entry);
      const reader = new File(item.uri).open();
      try {
        let remaining = item.size;
        while (remaining > 0) {
          const chunk = reader.readBytes(Math.min(256 * 1024, remaining));
          if (!chunk.length) throw new Error('첨부파일을 끝까지 읽지 못했습니다.');
          remaining -= chunk.length;
          entry.push(chunk, false);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        entry.push(new Uint8Array(), true);
      } finally { reader.close(); }
    }
    zip.end();
  } finally { writer.close(); }
  return output(`${basename}.zip`, file, 'application/zip');
}
export async function shareFile(file: OutputFile) {
  if (!await Sharing.isAvailableAsync()) throw new Error('이 기기에서는 공유 기능을 사용할 수 없습니다.');
  await Sharing.shareAsync(file.uri, { mimeType: file.mime, UTI: file.mime === 'application/zip' ? 'public.zip-archive' : file.mime === 'text/markdown' ? 'net.daringfireball.markdown' : undefined, dialogTitle: file.path });
}
