import { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useNotes } from '../state/notes';
import { bytesLabel, defaultOptions, ExportOptions, mediaCounts, noteTitle } from '../core/model';
import { ExportResult, OutputFile, prepareExport } from '../core/export';
import { createExportAdapter, makeZip, shareFile } from '../services/platform';
import { Button, colors, Loading, Message, s, Tag } from '../components/ui';

export default function ExportScreen() {
  const { ids } = useLocalSearchParams<{ids: string}>();
  const store = useNotes();
  const notes = (ids || '').split(',').map(id => store.notes.find(note => note.id === id)).filter(note => note !== undefined);
  const counts = mediaCounts(notes);
  const [options, setOptions] = useState<ExportOptions>(defaultOptions);
  const [result, setResult] = useState<ExportResult>();
  const [zip, setZip] = useState<OutputFile>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const autoStarted = useRef(false);
  async function prepare() {
    setBusy(true); setError(''); setProgress('기록 준비 중');
    try {
      await store.flush();
      const prepared = await prepareExport(notes, options, createExportAdapter(), setProgress);
      if (prepared.files.length > 1) { setProgress('파일을 하나로 묶는 중'); setZip(await makeZip(prepared.files, prepared.basename)); }
      setResult(prepared);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!store.loading && notes.length && counts.total === 0 && !autoStarted.current) { autoStarted.current = true; void prepare(); }
    // A text-only export skips the settings step. A frozen screen is prepared once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loading]);
  async function share(file: OutputFile) { setError(''); try { await shareFile(file); } catch (error) { setError(String(error)); } }
  if (store.loading) return <Loading/>;
  if (!notes.length) return <Message message="내보낼 기록을 찾을 수 없습니다."/>;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Tag>{notes.length === 1 ? noteTitle(notes[0]) : `${notes.length}개의 기록 · 작성 순`}</Tag>
    <Text style={[s.title, { marginTop: 20 }]}>{result ? '건넬 준비가 됐어요.' : counts.total ? '가볍게 담아 갈까요?' : '글을 파일로 담아요.'}</Text>
    <Text style={[s.muted, { marginTop: 10, marginBottom: 26 }]}>{result ? '기록의 순서와 설명을 함께 담았습니다.' : counts.total ? '원본은 그대로 두고, 내보낼 사본만 조절해요.' : '글만 있는 기록은 별도 설정 없이 MD로 내보냅니다.'}</Text>
    {error ? <View style={{ marginBottom: 18 }}><Message danger message={error}/></View> : null}
    {busy ? <Loading text={progress}/> : result ? <>
      <View style={[s.card, { gap: 16 }]}><Text style={s.heading}>{zip ? `${result.basename}.zip` : `${result.basename}.md`}</Text><Text style={s.muted}>마크다운 1개{result.visualCount ? ` · 이미지 ${result.visualCount}개` : ''} · {bytesLabel(zip?.size || result.files[0].size)}</Text><Button label={zip ? 'ZIP 저장 / 공유' : 'MD 저장 / 공유'} onPress={() => void share(zip || { ...result.files[0], path: `${result.basename}.md` })}/></View>
      {zip && <><View style={s.gap}/><Message message="ZIP 안의 첨부를 AI가 자동으로 보는지는 서비스마다 달라요. 지원하지 않으면 아래 파일들을 개별 첨부하고, 기록.md의 순서로 읽어 달라고 요청하세요."/><Text style={[s.heading, { marginTop: 26, marginBottom: 12 }]}>개별 파일로 건네기</Text>{result.files.map(file => <View key={file.path} style={[s.card, { padding: 14, marginBottom: 8 }]}><View style={s.between}><View style={{ flex: 1 }}><Text numberOfLines={2} style={[s.text, { fontSize: 13 }]}>{file.path}</Text><Text style={s.muted}>{bytesLabel(file.size)}</Text></View><Button small secondary label="저장 / 공유" onPress={() => void share(file)}/></View></View>)}</>}
      <Text style={[s.heading, { marginTop: 24, marginBottom: 12 }]}>마크다운 미리보기</Text><View style={s.card}><Text selectable style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 21, color: colors.ink }}>{result.markdown}</Text></View>
      {counts.total > 0 && <View style={{ marginTop: 20 }}><Button secondary label="설정 바꾸기" onPress={() => { setResult(undefined); setZip(undefined); }}/></View>}
    </> : counts.total > 0 ? <>
      {counts.images > 0 && <View style={[s.card, { marginBottom: 14, gap: 15 }]}><View style={s.between}><View style={{ flex: 1 }}><Text style={s.text}>사진 원본도 포함</Text><Text style={s.muted}>AI용 사진 외에 원본 파일을 추가합니다</Text></View><Switch accessibilityLabel="사진 원본도 포함" value={options.originalImages} onValueChange={originalImages => setOptions({ ...options, originalImages })} trackColor={{ true: colors.green }}/></View></View>}
      <View style={[s.row, { marginBottom: 20 }]}>{counts.images > 0 && <Tag>사진 {counts.images}</Tag>}{counts.videos > 0 && <Tag>영상 {counts.videos}</Tag>}</View>
      <View style={[s.card, { gap: 14 }]}><Text style={s.heading}>{counts.images && counts.videos ? '사진과 추출 장면의 크기' : counts.images ? '사진 크기' : '추출 장면의 크기'}</Text><Text style={s.muted}>긴 변 기준 · 작은 원본은 확대하지 않아요</Text><View style={s.row}>{([960, 1440, 2400] as const).map((edge, i) => <View style={{ flex: 1 }} key={edge}><Button secondary={options.longEdge !== edge} label={['가볍게', '균형', '선명하게'][i]} onPress={() => setOptions({ ...options, longEdge: edge })}/><Text style={[s.muted, { textAlign: 'center', marginTop: 5, fontSize: 11 }]}>{edge}px</Text></View>)}</View></View>
      {counts.videos > 0 && <View style={[s.card, { marginTop: 14, gap: 15 }]}><Text style={s.heading}>영상 한 편에서 꺼낼 장면</Text><View style={s.row}>{([3, 6, 12] as const).map(count => <View style={{ flex: 1 }} key={count}><Button label={`${count}장`} secondary={options.frameCount !== count} onPress={() => setOptions({ ...options, frameCount: count })}/></View>)}</View><Text style={s.muted}>시작부터 끝까지 일정한 간격으로 추출해요. 장면 사이의 움직임과 음성은 빠집니다.</Text><View style={s.between}><View style={{ flex: 1 }}><Text style={s.text}>영상 원본도 포함</Text><Text style={s.muted}>원본 추가 시 파일 용량이 커집니다</Text></View><Switch accessibilityLabel="영상 원본도 포함" value={options.originalVideos} onValueChange={originalVideos => setOptions({ ...options, originalVideos })} trackColor={{ true: colors.green }}/></View></View>}
      <Text style={[s.muted, { marginVertical: 20 }]}>예상 이미지 {counts.images + counts.videos * options.frameCount}개. 이미지 크기와 수를 줄이면 AI가 처리할 양을 줄이는 데 도움이 됩니다. 실제 사용량은 서비스마다 달라요.</Text>
      <Button label="내보낼 파일 만들기" onPress={() => void prepare()}/>
    </> : error ? <Button label="다시 준비하기" onPress={() => void prepare()}/> : null}
  </ScrollView>;
}
