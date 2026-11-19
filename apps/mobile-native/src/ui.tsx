import { Pressable, StyleSheet, Text } from 'react-native'

export const colors = {
  background: '#F7F8FA',
  paper: '#FFFFFF',
  text: '#19232D',
  muted: '#53616C',
  line: '#D9E0E5',
  accent: '#11675B',
  tint: '#E0F0EB',
  error: '#9F2D26',
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  page: { paddingHorizontal: 20, paddingVertical: 18, gap: 16 },
  header: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  headerTitle: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 17 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  section: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.error, fontSize: 14 },
  input: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.paper,
    color: colors.text,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    backgroundColor: colors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  actionText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
})

export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  symbol,
}: {
  label: string
  onPress(): void
  disabled?: boolean
  primary?: boolean
  symbol?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        primary && { backgroundColor: colors.accent },
        { opacity: disabled ? 0.48 : pressed ? 0.76 : 1 },
      ]}
    >
      <Text style={[ui.actionText, primary && { color: colors.paper }, symbol && { fontSize: 23 }]}>
        {symbol ?? label}
      </Text>
    </Pressable>
  )
}
