import { useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useNotes } from '../../state/notes';
import { Block, bytesLabel, moveBlock, textBlock, timeLabel } from '../../core/model';
import { pickMedia } from '../../services/platform';
import { MediaPreview } from '../../components/media-preview';
import { Button, colors, confirmDelete, Loading, Message, s } from '../../components/ui';

export default function Editor() {
  const { id } = useLocalSearchParams<{id: string}>();
  const store = useNotes();
  const note = store.notes.find(n => n.id === id);
  const live = useRef(note);
  useLayoutEffect(() => { live.current = note; }, [note]);
  const [active, setActive] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  if (store.loading) return <Loading/>;
  if (!note) return <Message message="기록을 찾을 수 없습니다."/>;
  function edit(blockId: string, patch: Partial<Block>) { const current = live.current!; store.update({ ...current, blocks: current.blocks.map(block => block.id === blockId ? { ...block, ...patch } as Block : block) }); }
  function insert(blocks: Block[]) {
    const current = live.current!;
    const index = current.blocks.findIndex(block => block.id === active);
    const next = [...current.blocks]; next.splice(index < 0 ? next.length : index + 1, 0, ...blocks);
    store.update({ ...current, blocks: next });
    if (blocks.length) setActive(blocks[blocks.length - 1].id);
  }
  async function attach(type: 'image' | 'video') {
    setBusy(true); setError('');
    try { const blocks = await pickMedia(type); if (blocks.length) { insert([...blocks, textBlock()]); await store.flush(); } }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function exportNote() { try { await store.flush(); router.push({ pathname: '/export', params: { ids: id } }); } catch { setError('먼저 저장을 완료해 주세요. 아래에서 다시 저장할 수 있습니다.'); } }
  return <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={95}>
    <ScrollView ref={scroll} contentContainerStyle={[s.content, { paddingBottom: 35 }]} keyboardShouldPersistTaps="handled">
      <View style={s.between}><Text style={s.muted}>{new Date(note.createdAt).toLocaleDateString('ko-KR')}</Text><Text style={[s.muted, store.error ? { color: '#A94E37' } : {}]}>{store.error ? '저장하지 못함' : store.saving ? '저장 중…' : '● 기기에 저장됨'}</Text></View>
      <TextInput accessibilityLabel="기록 제목" value={note.title} onChangeText={title => store.update({ ...live.current!, title })} placeholder="어떤 순간이었나요?" placeholderTextColor="#A1AA9E" style={[s.title, { marginTop: 20, marginBottom: 25, paddingVertical: 10 }]} multiline/>
      {(error || store.error) ? <View style={{ gap: 10, marginBottom: 18 }}><Message danger message={error || store.error}/>{store.error && <Button label="다시 저장" secondary onPress={() => void store.flush().catch(() => {})}/>}</View> : null}
      {note.blocks.map((block, index) => <View key={block.id} style={[s.card, { marginBottom: 14, padding: 15 }, active === block.id && { borderColor: '#A7B6A2' }]}>
        <View style={[s.between, { marginBottom: 10 }]}><Text style={[s.muted, { fontSize: 11 }]}>{String(index + 1).padStart(2, '0')} · {block.type === 'text' ? '글' : block.type === 'image' ? '사진' : '영상'}</Text><View style={{ flexDirection: 'row', gap: 5 }}><Button small secondary label="↑" disabled={index === 0 || busy} onPress={() => store.update(moveBlock(live.current!, block.id, -1))}/><Button small secondary label="↓" disabled={index === note.blocks.length - 1 || busy} onPress={() => store.update(moveBlock(live.current!, block.id, 1))}/><Button small secondary label="삭제" disabled={busy} onPress={() => confirmDelete('이 부분을 삭제할까요?', () => store.update({ ...live.current!, blocks: live.current!.blocks.filter(b => b.id !== block.id) }))}/></View></View>
        {block.type === 'text' ? <TextInput accessibilityLabel={`본문 ${index + 1}`} value={block.text} onChangeText={text => edit(block.id, { text })} onFocus={() => setActive(block.id)} placeholder="생각을 자유롭게 적어보세요…" placeholderTextColor="#A1AA9E" multiline textAlignVertical="top" scrollEnabled={false} style={[s.text, { minHeight: 135, padding: 3 }]}/> : <>
          <MediaPreview block={block}/><TextInput accessibilityLabel={`첨부 설명 ${index + 1}`} value={block.caption} onChangeText={caption => edit(block.id, { caption })} onFocus={() => setActive(block.id)} placeholder="이 장면에 한마디 덧붙이기" placeholderTextColor={colors.muted} multiline style={[s.text, { marginTop: 10, paddingVertical: 10 }]}/>
          <View style={s.between}><Text style={[s.muted, { fontSize: 11 }]}>{bytesLabel(block.size)}{block.type === 'video' ? ` · ${timeLabel(block.durationMs)}` : ''}</Text><View style={s.row}><Text style={[s.muted, { fontSize: 12 }]}>내보내기에 포함</Text><Switch accessibilityLabel={`첨부 ${index + 1} 내보내기에 포함`} value={block.included} onValueChange={included => edit(block.id, { included })} trackColor={{ true: colors.green }}/></View></View>
        </>}
      </View>)}
      <Text style={[s.muted, { textAlign: 'center', fontSize: 12, marginTop: 5 }]}>선택한 부분 다음에 추가됩니다 · 화살표로 순서 변경</Text>
      <View style={[s.row, { justifyContent: 'center', marginTop: 15 }]}><Button label="＋ 글" secondary disabled={busy} onPress={() => insert([textBlock()])}/><Button label="＋ 사진" secondary disabled={busy} onPress={() => void attach('image')}/><Button label="＋ 영상" secondary disabled={busy} onPress={() => void attach('video')}/></View>
      {busy && <Loading text="원본을 기기에 저장하는 중…"/>}
      <View style={{ marginTop: 32 }}><Button label="내보내기" disabled={busy} onPress={exportNote}/></View>
      <View style={{ alignItems: 'center', marginTop: 25 }}><Button label="기록 삭제" secondary small disabled={busy} onPress={() => confirmDelete('이 기록을 삭제할까요?', () => { void store.remove(live.current!).then(() => router.replace('/')).catch(error => setError(String(error))); })}/></View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
