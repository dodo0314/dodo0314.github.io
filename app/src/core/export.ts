import { ExportOptions, frameTimes, mediaCounts, Note, noteTitle, safeFilename, timeLabel } from './model';

export type OutputFile = { path: string; uri: string; mime: string; size: number };
export type ExportAdapter = {
  image(assetId: string, longEdge: number, path: string): Promise<OutputFile>;
  frame(assetId: string, timeMs: number, longEdge: number, path: string): Promise<OutputFile>;
  original(assetId: string, path: string, mime: string): Promise<OutputFile>;
  text(content: string, path: string, mime?: string): Promise<OutputFile>;
};
export type ExportResult = { files: OutputFile[]; markdown: string; basename: string; visualCount: number; };
const alt = (s: string) => s.replace(/[\[\]\\\r\n]/g, ' ');
const heading = (s: string) => s.replace(/[\r\n]/g, ' ');

/** Numbering belongs to the document, never to ZIP directory traversal order. */
export async function prepareExport(
  notes: Note[], options: ExportOptions, adapter: ExportAdapter,
  progress: (message: string) => void = () => {},
): Promise<ExportResult> {
  if (!notes.length) throw new Error('내보낼 기록을 선택해 주세요.');
  const files: OutputFile[] = [];
  const parts: string[] = [];
  const counts = mediaCounts(notes);
  if (counts.total) parts.push('<!-- 이 문서의 번호 순서대로 읽으세요. 이미지 링크의 실제 파일을 열어 확인하세요. 영상 장면은 일부 시점의 표본이며 움직임·음성을 모두 담지 않습니다. 열지 못한 첨부는 보았다고 가정하지 마세요. -->');
  let visualCount = 0;
  for (let n = 0; n < notes.length; n++) {
    const note = notes[n];
    parts.push(`# ${heading(noteTitle(note))}`, `작성: ${note.createdAt}\n수정: ${note.updatedAt}`);
    for (let b = 0; b < note.blocks.length; b++) {
      const block = note.blocks[b];
      const number = `${String(n + 1).padStart(2, '0')}-${String(b + 1).padStart(3, '0')}`;
      if (block.type === 'text') {
        if (block.text) parts.push(counts.total ? `## ${number} · 글\n\n${block.text}` : block.text);
        continue;
      }
      parts.push(`## ${number} · ${block.type === 'image' ? '사진' : '영상'}`);
      if (block.caption) parts.push(block.caption);
      if (!block.included) { parts.push('첨부파일은 사용자가 이번 내보내기에서 제외했습니다.'); continue; }
      if (block.type === 'image') {
        progress(`사진 ${visualCount + 1} 준비 중`);
        const path = `media/${number}-photo.jpg`;
        files.push(await adapter.image(block.assetId, options.longEdge, path));
        parts.push(`![${number} ${alt(block.caption || '사진')}](${path})`);
        if (options.originalImages) {
          const rawExt = block.assetId.split('.').pop()?.toLowerCase();
          const ext = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin';
          const rawPath = `media/${number}-original.${ext}`;
          files.push(await adapter.original(block.assetId, rawPath, block.mime));
          parts.push(`[사진 원본](${rawPath})`);
        }
        visualCount++;
      } else {
        parts.push(`영상 길이: ${timeLabel(block.durationMs)}\n아래 이미지는 같은 영상의 시간순 표본입니다. 음성은 포함하지 않았습니다.`);
        for (const ms of frameTimes(block.durationMs, options.frameCount)) {
          const label = timeLabel(ms);
          const path = `media/${number}-video-${String(ms).padStart(9, '0')}ms.jpg`;
          progress(`영상 장면 ${label} 준비 중`);
          files.push(await adapter.frame(block.assetId, ms, options.longEdge, path));
          parts.push(`### ${number} · ${label}\n\n![${number} 영상 ${label}](${path})`);
          visualCount++;
        }
        if (options.originalVideos) {
          const rawExt = block.assetId.split('.').pop()?.toLowerCase();
          const ext = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'mp4';
          const path = `media/${number}-original.${ext}`;
          files.push(await adapter.original(block.assetId, path, block.mime));
          parts.push(`[영상 원본](${path})`);
        } else parts.push('영상 원본은 이 묶음에 포함하지 않았습니다.');
      }
    }
    if (n < notes.length - 1) parts.push('---');
  }
  const markdown = parts.join('\n\n') + '\n';
  const basename = notes.length === 1 ? safeFilename(noteTitle(notes[0])) : `모아-${notes.length}개의-기록`;
  const md = await adapter.text(markdown, '기록.md');
  return { files: [md, ...files], markdown, basename, visualCount };
}

export type BackupResult = { files: OutputFile[]; basename: string; mediaCount: number };

/** Full-fidelity archive for recovery, independent of AI export settings. */
export async function prepareBackup(
  notes: Note[], adapter: ExportAdapter, progress: (message: string) => void = () => {},
): Promise<BackupResult> {
  if (!notes.length) throw new Error('백업할 기록이 없습니다.');
  const ordered = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const media = new Map<string, { mime: string; size: number }>();
  for (const note of ordered) for (const block of note.blocks) if (block.type !== 'text') {
    if (!/^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(block.assetId)) throw new Error('첨부파일 이름을 확인할 수 없습니다.');
    media.set(block.assetId, { mime: block.mime || 'application/octet-stream', size: block.size });
  }
  const manifest = {
    format: 'moa-backup', version: 1, createdAt: new Date().toISOString(),
    notes: ordered,
    media: [...media].map(([assetId, item]) => ({ assetId, path: `media/${assetId}`, ...item })),
  };
  const files = [await adapter.text(JSON.stringify(manifest, null, 2), 'backup.json', 'application/json')];
  for (const [assetId, item] of media) {
    progress(`원본 첨부 ${files.length}/${media.size} 준비 중`);
    files.push(await adapter.original(assetId, `media/${assetId}`, item.mime));
  }
  return { files, basename: `모아-원본백업-${new Date().toISOString().slice(0, 10)}`, mediaCount: media.size };
}
