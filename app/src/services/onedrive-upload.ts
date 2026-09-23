const graph = 'https://graph.microsoft.com/v1.0';
const chunkSize = 10 * 1024 * 1024; // 32 × 320 KiB, as required by OneDrive upload sessions.

type DriveItem = { id: string; name?: string; size?: number; webUrl?: string };
type UploadSession = { uploadUrl: string; nextExpectedRanges?: string[] };

async function expectJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = body?.error?.message || ''; } catch { /* Some Graph errors have no JSON body. */ }
    throw new Error(`${action} 실패 (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function uploadBackupToAppFolder(
  token: string, blob: Blob, name: string,
  progress: (sent: number, total: number) => void = () => {},
  request: typeof fetch = fetch,
): Promise<DriveItem> {
  if (!blob.size) throw new Error('비어 있는 백업 파일은 올릴 수 없습니다.');
  if (!/^[^/\\]+\.zip$/i.test(name)) throw new Error('백업 파일 이름을 확인해 주세요.');
  const headers = { Authorization: `Bearer ${token}` };
  const folder = await expectJson<DriveItem>(
    await request(`${graph}/me/drive/special/approot`, { headers }), 'OneDrive 앱 폴더 열기',
  );
  if (!folder.id) throw new Error('OneDrive 앱 폴더 ID를 받지 못했습니다.');
  const itemPath = `${graph}/me/drive/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(name)}:`;
  let uploaded: DriveItem;
  const singleUpload = async () => {
    const result = await expectJson<DriveItem>(await request(`${itemPath}/content`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/zip' }, body: blob,
    }), 'OneDrive 백업 업로드');
    progress(blob.size, blob.size);
    return result;
  };
  if (blob.size <= 10 * 1024 * 1024) {
    uploaded = await singleUpload();
  } else {
    const sessionResponse = await request(`${itemPath}/createUploadSession`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name } }),
    });
    if (sessionResponse.status === 403 && blob.size <= 250 * 1024 * 1024) {
      // Some personal AppFolder grants allow direct content writes but not upload sessions.
      uploaded = await singleUpload();
    } else {
    const session = await expectJson<UploadSession>(sessionResponse, 'OneDrive 대용량 업로드 준비');
    if (!session.uploadUrl || new URL(session.uploadUrl).protocol !== 'https:') throw new Error('안전한 OneDrive 업로드 주소를 받지 못했습니다.');
    let offset = 0;
    while (offset < blob.size) {
      const end = Math.min(offset + chunkSize, blob.size);
      const response = await request(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` },
        body: blob.slice(offset, end),
      });
      const result = await expectJson<UploadSession & DriveItem>(response, 'OneDrive 백업 조각 업로드');
      if (response.status === 202) {
        const next = Number(result.nextExpectedRanges?.[0]?.split('-')[0]);
        offset = Number.isFinite(next) && next >= end ? next : end;
        progress(offset, blob.size);
      } else {
        uploaded = result;
        offset = blob.size;
        progress(offset, blob.size);
      }
    }
    if (!uploaded!) throw new Error('OneDrive가 업로드 완료를 확인하지 못했습니다.');
    }
  }
  if (uploaded.size !== blob.size || !uploaded.id) throw new Error('OneDrive에 저장된 파일 크기를 확인하지 못했습니다. 다시 확인해 주세요.');
  return uploaded;
}
