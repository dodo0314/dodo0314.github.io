export type TextBlock = { id: string; type: 'text'; text: string };
export type MediaBlock = {
  id: string;
  type: 'image' | 'video';
  assetId: string;
  name: string;
  mime: string;
  caption: string;
  width: number;
  height: number;
  durationMs: number;
  size: number;
  included: boolean;
};
export type Block = TextBlock | MediaBlock;
export type Note = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  blocks: Block[];
};
export type ExportOptions = {
  longEdge: 960 | 1440 | 2400;
  frameCount: 3 | 6 | 12;
  originalImages: boolean;
  originalVideos: boolean;
};
export const defaultOptions: ExportOptions = { longEdge: 1440, frameCount: 3, originalImages: false, originalVideos: false };
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function textBlock(text = ''): TextBlock { return { id: uid(), type: 'text', text }; }
export function newNote(): Note {
  const now = new Date().toISOString();
  return { id: uid(), title: '', createdAt: now, updatedAt: now, blocks: [textBlock()] };
}
export function mediaCounts(notes: Note[]) {
  let images = 0, videos = 0, omitted = 0;
  for (const note of notes) for (const block of note.blocks) {
    if (block.type === 'text') continue;
    if (!block.included) { omitted++; continue; }
    if (block.type === 'image') images++; else videos++;
  }
  return { images, videos, omitted, total: images + videos };
}
export function noteTitle(note: Note) { return note.title.trim() || '제목 없는 기록'; }
export function noteExcerpt(note: Note) {
  return note.blocks.filter((b): b is TextBlock => b.type === 'text').map(b => b.text).join(' ').trim();
}
export function moveBlock(note: Note, id: string, delta: number): Note {
  const index = note.blocks.findIndex(b => b.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= note.blocks.length) return note;
  const blocks = [...note.blocks];
  [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
  return { ...note, blocks };
}
export function frameTimes(durationMs: number, count: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('영상 길이를 확인할 수 없습니다. 영상을 다시 첨부해 주세요.');
  // Stay inside the decodable range, including very short clips. Millisecond precision.
  const end = Math.max(0, durationMs - Math.min(100, durationMs / 10));
  return [...new Set(Array.from({ length: count }, (_, i) => Math.floor(end * i / Math.max(1, count - 1))))];
}
export function timeLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  return `${Math.floor(total / 60000).toString().padStart(2, '0')}:${Math.floor(total / 1000 % 60).toString().padStart(2, '0')}.${(total % 1000).toString().padStart(3, '0')}`;
}
export function safeFilename(title: string): string {
  return title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 64) || '기록';
}
export function fitSize(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width || edge, height || edge));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function bytesLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
