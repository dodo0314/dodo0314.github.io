import { heicTo, isHeic } from '/assets/heic-decoder-1.6.6.js';

self.onmessage = async ({ data }) => {
  let bitmap, canvas;
  try {
    const original = new Blob([data.buffer], { type: data.mimeType || 'image/heic' });
    if (!await isHeic(original)) {
      const bytes = new Uint8Array(data.buffer, 0, Math.min(12, data.buffer.byteLength));
      const mime = bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes[0] === 137 && bytes[1] === 80 ? 'image/png' : '';
      if (!mime) throw new Error('unsupported');
      self.postMessage({ blob: new Blob([data.buffer], { type: mime }), converted: false });
      return;
    }
    bitmap = await heicTo({ blob: original, type: 'bitmap' });
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50000000) throw new Error('too-large');
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 });
    self.postMessage({ blob, converted: true, width: bitmap.width, height: bitmap.height });
  } catch {
    self.postMessage({ error: 'conversion-failed' });
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = canvas.height = 1; }
  }
};
