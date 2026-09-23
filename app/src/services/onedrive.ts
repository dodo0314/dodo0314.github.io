import { OutputFile } from '../core/export';
const unavailable = () => { throw new Error('OneDrive 직접 백업은 웹 버전에서 사용할 수 있습니다.'); };
export async function oneDriveAccount(): Promise<string | null> { return null; }
export async function connectOneDrive(_switchAccount = false): Promise<string | null> { return unavailable(); }
export async function uploadToOneDrive(_file: OutputFile, _progress: (sent: number, total: number) => void): Promise<{ name: string; webUrl?: string }> { return unavailable(); }
export function oneDriveReturnPending() { return false; }
export function clearOneDriveReturn() {}
export async function initializeOneDrive(): Promise<boolean> { return false; }
