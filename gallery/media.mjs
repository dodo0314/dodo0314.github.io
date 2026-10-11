export function isPhoto(item) {
  return !!item?.id && !!item.file && !item.folder && !isVideo(item) &&
    (item.file.mimeType?.startsWith('image/') || !!item.image || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(item.name || ''));
}
export function isVideo(item) {
  return !!item?.id && !!item.file && !item.folder &&
    (!!item.video || item.file.mimeType?.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv|wmv|3gp|mts|m2ts)$/i.test(item.name || ''));
}
export function isMedia(item) { return isPhoto(item) || isVideo(item); }
function mediaTimestamp(value) {
  if (typeof value !== 'string' || !value) return 0;
  // EXIF timestamps without a zone and Korean camera filenames represent local time.
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? value + '+09:00' : value;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) && ms >= Date.UTC(1990, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : 0;
}
function filenameTimestamp(name) {
  // Only recognize camera-style names, avoiding arbitrary numbers in renamed files.
  const match = /^(?:(IMG|VID|PXL|PHOTO|VIDEO)[_-]?)?(20\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:[T_ -]?(\d{2})[.:_-]?(\d{2})[.:_-]?(\d{2})(?:[._]?\d{3})?)?(?=[_. -]|$)/i.exec(name || '');
  if (!match) return 0;
  const [, prefix, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const utc = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (utc.getUTCFullYear() !== +year || utc.getUTCMonth() !== +month - 1 || utc.getUTCDate() !== +day ||
      utc.getUTCHours() !== +hour || utc.getUTCMinutes() !== +minute || utc.getUTCSeconds() !== +second) return 0;
  return mediaTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}${prefix?.toUpperCase() === 'PXL' ? 'Z' : '+09:00'}`);
}
export function mediaDate(item) {
  const captured = mediaTimestamp(item.photo?.takenDateTime);
  const filename = filenameTimestamp(item.name);
  const uploadTime = mediaTimestamp(item.createdDateTime);
  // Some imports stamp the upload time into the photo facet as well. When that
  // timestamp conflicts with a camera filename, retain the filename's older date.
  const importedCapture = filename && captured && uploadTime && Math.abs(captured - uploadTime) < 86400000 && Math.abs(captured - filename) > 2 * 86400000;
  const candidates = [
    ...(importedCapture ? [['filename', filename], ['captured', captured]] : [['captured', captured], ['filename', filename]]),
    ['file-created', mediaTimestamp(item.fileSystemInfo?.createdDateTime)],
    ['uploaded', mediaTimestamp(item.createdDateTime)],
  ];
  const [dateSource, sortTime] = candidates.find(([, value]) => value) || ['unknown', 0];
  return { date: sortTime ? new Date(sortTime).toISOString() : '', sortTime, dateSource,
    uploadedAt: uploadTime ? new Date(uploadTime).toISOString() : '', uploadTime };
}
export function sortMedia(items, order = 'new') {
  if (order === 'album') return [...items];
  const key = order === 'uploaded' ? 'uploadTime' : 'sortTime';
  const direction = order === 'old' ? 1 : -1;
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const left = a.item[key] || 0, right = b.item[key] || 0;
    if (!left || !right) return left ? -1 : right ? 1 : a.index - b.index;
    return (left - right) * direction || a.index - b.index;
  }).map(entry => entry.item);
}
