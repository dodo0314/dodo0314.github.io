import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useNotes } from '../state/notes';
import { bytesLabel } from '../core/model';
import { OutputFile, prepareBackup } from '../core/export';
import { createExportAdapter, makeZip, shareFile } from '../services/platform';
import { Button, Loading, Message, s } from '../components/ui';
import { connectOneDrive, oneDriveAccount, uploadToOneDrive } from '../services/onedrive';

export default function BackupScreen() {
  const store = useNotes();
  const [file, setFile] = useState<OutputFile>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [account, setAccount] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudProgress, setCloudProgress] = useState('');
  const [uploaded, setUploaded] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    void oneDriveAccount().then(name => { if (alive) setAccount(name); }).catch(cause => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { alive = false; };
  }, []);
  async function build() {
    setBusy(true); setError(''); setUploaded(''); setFile(undefined);
    try {
      await store.flush();
      const backup = await prepareBackup(store.notes, createExportAdapter(), setProgress);
      setProgress('원본 백업 ZIP을 만드는 중');
      setFile(await makeZip(backup.files, backup.basename));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!file) return;
    try { setError(''); await shareFile(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function connect(switchAccount = false) {
    setCloudBusy(true); setError('');
    try { setAccount(await connectOneDrive(switchAccount)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCloudBusy(false); }
  }
  async function upload() {
    if (!file) return;
    setCloudBusy(true); setError(''); setUploaded('');
    try {
      const item = await uploadToOneDrive(file, (sent, total) => setCloudProgress(`OneDrive 업로드 ${Math.round(sent / total * 100)}%`));
      setUploaded(`OneDrive의 모아 앱 폴더에 ${item.name} 저장 완료`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCloudBusy(false); setCloudProgress(''); }
  }
  if (store.loading) return <Loading/>;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Text style={s.title}>내 기록을 원본 그대로</Text>
    <Text style={[s.muted, { marginTop: 12, marginBottom: 26 }]}>모든 글과 사진·영상 원본, 순서와 설명을 ZIP 하나로 묶습니다. AI용 내보내기 설정은 이 백업에 적용되지 않습니다.</Text>
    {error ? <View style={{ marginBottom: 16 }}><Message danger message={error}/></View> : null}
    {Platform.OS === 'web' && <View style={[s.card, { gap: 12, marginBottom: 18 }]}>
      <Text style={s.heading}>OneDrive 직접 백업</Text>
      <Text style={s.muted}>{account ? `연결된 계정: ${account}` : 'Microsoft 계정을 연결하면 모아 전용 폴더로 직접 저장할 수 있어요.'}</Text>
      {!account && <Button label="OneDrive 계정 연결" disabled={cloudBusy} onPress={() => void connect()}/>}
      {account && <Button label="다른 계정 선택" secondary small disabled={cloudBusy} onPress={() => void connect(true)}/>}
      <Text style={s.muted}>로그인 후 돌아오면 백업 ZIP을 만들고 업로드해 주세요.</Text>
    </View>}
    {busy ? <Loading text={progress || '원본 백업 준비 중'}/> : file ? <View style={[s.card, { gap: 14 }]}>
      <Text style={s.heading}>{file.path}</Text><Text style={s.muted}>{bytesLabel(file.size)}</Text>
      {Platform.OS === 'web' && account && <Button label="OneDrive에 원본 백업" disabled={cloudBusy} onPress={() => void upload()}/>}
      {cloudBusy && cloudProgress ? <Text style={s.muted}>{cloudProgress}</Text> : null}
      {uploaded ? <Message message={uploaded}/> : null}
      <Button label="ZIP 저장 / 공유" onPress={() => void share()}/>
      <Text style={s.muted}>직접 백업이 안 되면 공유 목록에서 OneDrive 또는 ‘파일에 저장’을 선택하세요.</Text>
      <Button label="최신 기록으로 다시 만들기" secondary onPress={() => void build()}/>
    </View> : <Button label="원본 백업 만들기" disabled={!store.notes.length} onPress={() => void build()}/>}
    <Text style={[s.muted, { marginTop: 24, fontSize: 12 }]}>백업 파일에는 개인 기록과 원본 첨부가 모두 들어 있습니다. 업로드가 끝날 때까지 이 화면을 열어 두세요.</Text>
  </ScrollView>;
}
