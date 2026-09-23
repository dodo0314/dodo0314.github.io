import React from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
export const colors = { bg: '#F6F4EF', paper: '#FFFFFF', ink: '#253F36', muted: '#718077', line: '#E1E5DC', green: '#375E4D', soft: '#E7EDE4', orange: '#BE714B' };
export function Button({ label, onPress, secondary, disabled, small }: {label: string; onPress(): void; secondary?: boolean; disabled?: boolean; small?: boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, small && s.small, { opacity: disabled ? 0.4 : pressed ? 0.72 : 1 }]}><Text style={[s.buttonText, secondary && { color: colors.ink }]}>{label}</Text></Pressable>;
}
export function Tag({ children }: {children: React.ReactNode}) { return <Text style={s.tag}>{children}</Text>; }
export function Message({ message, danger = false }: {message: string; danger?: boolean}) { return <View style={[s.message, danger && { backgroundColor: '#FBEDE8' }]}><Text style={{ color: danger ? '#9C4732' : colors.muted, lineHeight: 22, fontSize: 13 }}>{message}</Text></View>; }
export function Loading({ text = '기록을 불러오는 중' }: {text?: string}) { return <View style={s.loading}><ActivityIndicator color={colors.green}/><Text style={s.muted}>{text}</Text></View>; }
export function confirmDelete(title: string, action: () => void) {
  if (Platform.OS === 'web') { if (window.confirm(title)) action(); }
  else Alert.alert(title, '이 작업은 되돌릴 수 없습니다.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: action }]);
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontSize: 32, fontWeight: '700', color: colors.ink, letterSpacing: -1.2, lineHeight: 42 },
  heading: { fontSize: 18, fontWeight: '600', color: colors.ink, lineHeight: 27 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  text: { color: colors.ink, fontSize: 16, lineHeight: 27 },
  button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.soft },
  small: { minHeight: 40, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  card: { backgroundColor: colors.paper, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.line },
  input: { color: colors.ink, fontSize: 16, lineHeight: 26, padding: 14, backgroundColor: colors.paper, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  tag: { color: colors.green, fontSize: 11, letterSpacing: 0.5, backgroundColor: colors.soft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, overflow: 'hidden' },
  message: { padding: 14, backgroundColor: colors.soft, borderRadius: 13 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 30 },
  gap: { height: 20 },
});
