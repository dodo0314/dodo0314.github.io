import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useNotes } from '../state/notes';
import { mediaCounts, noteExcerpt, noteTitle } from '../core/model';
import { Button, colors, Loading, Message, s, Tag } from '../components/ui';
import { PwaStatus } from '../components/pwa-status';
import { OneDriveReturn } from '../components/onedrive-return';

export default function Home() {
  const store = useNotes();
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  async function create() { try { const note = await store.create(); router.push(`/note/${note.id}`); } catch (error) { setError(String(error)); } }
  const notes = store.notes.filter(note => `${note.title} ${noteExcerpt(note)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (store.loading) return <Loading />;
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={[s.between, { marginBottom: 42, marginTop: 12 }]}><View style={s.row}><View style={{ width: 36, height: 36, backgroundColor: colors.green, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: 'white', fontSize: 23 }}>m</Text></View><Text style={{ fontSize: 23, fontWeight: '700', color: colors.ink }}>모아</Text></View><Tag>나만의 기록 공간</Tag></View>
    <Text style={[s.muted, { letterSpacing: 2, marginBottom: 9 }]}>LITTLE MOMENTS, KEPT.</Text>
    <Text style={s.title}>흘려보내기 아쉬운{ '\n' }순간을 모아요.</Text>
    <Text style={[s.muted, { marginTop: 12, fontSize: 14 }]}>글, 사진, 영상. 떠오른 순서 그대로.{ '\n' }필요한 순간에만 AI에게 건네세요.</Text>
    <View style={[s.row, { marginTop: 25, marginBottom: 32 }]}><Button label="＋ 새 기록" onPress={create}/>{store.notes.length > 0 && <Button label={selecting ? '선택 취소' : '골라 내보내기'} secondary onPress={() => { setSelecting(!selecting); setSelected([]); }}/>}</View>
    {(error || store.error) ? <><Message danger message={error || store.error}/><Button label="다시 불러오기" secondary onPress={() => void store.reload()}/><View style={s.gap}/></> : null}
    <OneDriveReturn />
    <PwaStatus />
    {store.notes.length > 0 && <View style={{ marginBottom: 28 }}><Button label="원본 전체 백업" secondary onPress={() => router.push('/backup')}/><Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>글과 사진·영상 원본을 ZIP으로 묶어 OneDrive 등에 보관해요.</Text></View>}
    <View style={s.between}><Text style={s.heading}>내 기록 <Text style={{ color: colors.muted }}>{store.notes.length}</Text></Text><Text style={s.muted}>최근 수정 순</Text></View>
    {store.notes.length > 0 && <TextInput accessibilityLabel="기록 검색" placeholder="기록에서 찾기" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} style={[s.input, { marginTop: 14, marginBottom: 12 }]}/>}
    {notes.length === 0 && <View style={[s.card, { marginTop: 20, paddingVertical: 40, alignItems: 'center' }]}><Text style={{ fontSize: 40, color: colors.orange, marginBottom: 18 }}>✳</Text><Text style={s.heading}>{search ? '찾는 기록이 없어요' : '첫 페이지를 열어볼까요?'}</Text><Text style={[s.muted, { textAlign: 'center', marginTop: 10 }]}>{search ? '다른 단어로 찾아보세요.' : '오늘 만든 것, 눈에 들어온 풍경, 작은 생각.\n완성된 글이 아니어도 괜찮아요.'}</Text></View>}
    {notes.map(note => { const count = mediaCounts([note]); const checked = selected.includes(note.id); return <Pressable accessibilityRole="button" accessibilityLabel={`${selecting ? '선택 ' : '열기 '}${noteTitle(note)}`} key={note.id} onPress={() => selecting ? setSelected(ids => checked ? ids.filter(id => id !== note.id) : [...ids, note.id]) : router.push(`/note/${note.id}`)} style={[s.card, { marginBottom: 10 }, checked && { borderColor: colors.green, backgroundColor: '#EEF3EB' }]}><View style={s.between}><Text style={s.muted}>{new Date(note.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</Text><Text style={s.muted}>{selecting ? checked ? '●' : '○' : '↗'}</Text></View><Text numberOfLines={1} style={[s.heading, { marginTop: 10 }]}>{noteTitle(note)}</Text><Text numberOfLines={2} style={[s.muted, { marginTop: 5 }]}>{noteExcerpt(note) || '사진과 영상으로 남긴 기록'}</Text>{count.total > 0 && <View style={[s.row, { marginTop: 14 }]}>{count.images > 0 && <Tag>사진 {count.images}</Tag>}{count.videos > 0 && <Tag>영상 {count.videos}</Tag>}</View>}</Pressable>; })}
    {selecting && <Button label={`${selected.length}개 기록 내보내기`} disabled={!selected.length} onPress={() => router.push({ pathname: '/export', params: { ids: [...selected].sort((a, b) => store.notes.find(n => n.id === a)!.createdAt.localeCompare(store.notes.find(n => n.id === b)!.createdAt)).join(',') } })}/>}
    <Text style={[s.muted, { marginTop: 28, textAlign: 'center', fontSize: 11 }]}>{Platform.OS === 'web' ? '이 브라우저에 저장됩니다 · 아이폰 앱과 자동 동기화되지 않습니다' : '이 기기에 저장됩니다 · 자동 업로드 없음'}</Text>
  </ScrollView></SafeAreaView>;
}
