import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NotesProvider } from '../state/notes';
import { Button, colors } from '../components/ui';
export default function Layout() {
  return <NotesProvider><StatusBar style="dark" /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.ink, headerShadowVisible: false, headerBackTitle: '기록', headerLeft: () => <Button label="‹ 기록" secondary small onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />, contentStyle: { backgroundColor: colors.bg } }}><Stack.Screen name="index" options={{ headerShown: false }}/><Stack.Screen name="note/[id]" options={{ title: '기록하기' }}/><Stack.Screen name="export" options={{ title: '내보내기', presentation: 'modal' }}/></Stack></NotesProvider>;
}
