import { AccountInfo, InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';
import { OutputFile } from '../core/export';
import { uploadBackupToAppFolder } from './onedrive-upload';

const clientId = '6e71fe82-edc0-4770-9515-f2d5d31b4f6b';
const scopes = ['Files.ReadWrite.AppFolder'];
const returnKey = 'moa-onedrive-return';
const app = new PublicClientApplication({
  auth: {
    clientId,
    authority: 'https://login.microsoftonline.com/consumers',
    redirectUri: `${window.location.origin}/`,
  },
  cache: { cacheLocation: 'localStorage' },
});
let initializing: Promise<boolean> | null = null;

export function oneDriveReturnPending() { return sessionStorage.getItem(returnKey) === '1'; }
export function clearOneDriveReturn() { sessionStorage.removeItem(returnKey); }
export function initializeOneDrive(): Promise<boolean> {
  if (!initializing) initializing = (async () => {
    await app.initialize();
    const result = await app.handleRedirectPromise({ navigateToLoginRequestUrl: false });
    if (result?.account) app.setActiveAccount(result.account);
    return Boolean(result);
  })().catch(error => { initializing = null; throw error; });
  return initializing;
}
function selectedAccount(): AccountInfo | null {
  return app.getActiveAccount() || app.getAllAccounts()[0] || null;
}
export async function oneDriveAccount(): Promise<string | null> {
  await initializeOneDrive();
  return selectedAccount()?.username || null;
}
export async function connectOneDrive(switchAccount = false): Promise<string | null> {
  await initializeOneDrive();
  const account = selectedAccount();
  if (account && !switchAccount) return account.username;
  sessionStorage.setItem(returnKey, '1');
  await app.loginRedirect({ scopes, prompt: switchAccount ? 'select_account' : undefined });
  return null;
}
export async function uploadToOneDrive(
  file: OutputFile, progress: (sent: number, total: number) => void,
): Promise<{ name: string; webUrl?: string }> {
  await initializeOneDrive();
  const account = selectedAccount();
  if (!account) throw new Error('먼저 OneDrive 계정을 연결해 주세요.');
  let token: string;
  try { token = (await app.acquireTokenSilent({ scopes, account })).accessToken; }
  catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    sessionStorage.setItem(returnKey, '1');
    await app.acquireTokenRedirect({ scopes, account });
    throw new Error('Microsoft 권한 확인 후 백업을 다시 시작해 주세요.');
  }
  const response = await fetch(file.uri);
  if (!response.ok) throw new Error('만든 백업 파일을 읽지 못했습니다.');
  const blob = await response.blob();
  const item = await uploadBackupToAppFolder(token, blob, file.path, progress);
  return { name: item.name || file.path, webUrl: item.webUrl };
}
