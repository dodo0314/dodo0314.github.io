import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Message, s } from './ui';

export function PwaStatus() {
  const [ready, setReady] = useState(false);
  const [update, setUpdate] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [storage, setStorage] = useState('');
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (__DEV__) return;
    let alive = true;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const sync = () => { if (alive) setInstalled(standalone.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone)); };
    Promise.resolve().then(sync);
    standalone.addEventListener('change', sync);
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      Promise.resolve().then(() => { if (alive) setError('오프라인 설치는 HTTPS 주소에서 지원됩니다.'); });
      return () => { alive = false; standalone.removeEventListener('change', sync); };
    }
    navigator.serviceWorker.ready.then(() => { if (alive) { setReady(true); setError(''); } }).catch(() => {});
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
      if (alive) setUpdate(Boolean(registration.waiting));
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (!alive) return;
          if (worker.state === 'installed' && registration.waiting && registration.active) setUpdate(true);
          if (worker.state === 'activated') setUpdate(false);
          if (worker.state === 'redundant' && !registration.active) setError('앱을 모두 받지 못했습니다. 연결된 상태에서 다시 열어 주세요.');
        });
      });
    }).catch(() => { if (alive && !navigator.serviceWorker.controller) setError('오프라인 준비를 완료하지 못했습니다. 연결된 상태에서 다시 열어 주세요.'); });
    return () => { alive = false; standalone.removeEventListener('change', sync); };
  }, []);
  async function keepStorage() {
    try {
      const granted = await navigator.storage?.persist?.();
      setStorage(granted ? '기기 저장 유지가 허용됐어요. 직접 앱 데이터를 삭제하면 기록도 삭제됩니다.' : '이 브라우저가 저장 유지 여부를 결정합니다. 중요한 기록은 정기적으로 내보내 주세요.');
    } catch { setStorage('저장 유지 요청을 완료하지 못했어요. 중요한 기록은 정기적으로 내보내 주세요.'); }
  }
  if (__DEV__) return null;
  return <View style={{ gap: 10, marginBottom: 24 }}>
    <View style={s.between}><Text style={s.muted}>{error ? '오프라인 준비 필요' : ready ? '● 오프라인 준비 완료' : '앱을 기기에 준비하는 중…'}</Text><Button label={installed ? '앱 안내' : '홈 화면에 설치'} secondary small onPress={() => setHelp(!help)}/></View>
    {error ? <Message message={error} danger/> : null}
    {update && <Message message="새 버전이 준비됐어요. 기록이 저장된 뒤 열려 있는 모아 창을 모두 닫고 다시 열면 적용됩니다."/>}
    {help && <View style={[s.card, { gap: 12 }]}><Text style={s.heading}>Expo Go 없이, 모아만 열어요</Text><Text style={s.muted}>아이폰 Safari에서 공유 → 홈 화면에 추가를 선택하세요. ‘웹 앱으로 열기’가 보이면 켜 주세요. 홈 화면에서 모아를 열고 ‘오프라인 준비 완료’를 확인하면 PC 없이 기록할 수 있어요.</Text><Text style={s.muted}>첫 설치와 업데이트에는 인터넷이 필요합니다. 기록은 이 기기에 저장되며, Expo Go 기록과 자동으로 합쳐지지 않아요. 앱·웹사이트 데이터를 지우기 전에 중요한 기록을 내보내 주세요.</Text><Button label="기기 저장 유지 요청" secondary small onPress={() => void keepStorage()}/>{storage ? <Text style={s.muted}>{storage}</Text> : null}</View>}
  </View>;
}
