import { createContext, useContext, useMemo } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native'

import { routeGutters, rpxScale } from './visual-baseline'

const light = {
  background: '#F7F6F4',
  paper: '#FFFFFF',
  text: '#1A1A1A',
  muted: '#6B6B6B',
  line: '#ECECEC',
  fieldLine: '#E5E2DD',
  faint: '#B3B0AB',
  placeholder: '#8E8E8E',
  onAction: '#FFFFFF',
  actionDisabled: '#4D4D4D',
  entry: '#FAFAFA',
  accent: '#3B82F6',
  tabPaper: '#FFFFFF',
  tabMuted: '#8D8A86',
  bubble: '#E9E9E7',
  rail: '#C9C5BE',
  tint: '#EFEDEA',
  error: '#9F2D26',
}

const dark: typeof light = {
  background: '#171716',
  paper: '#242422',
  text: '#f2f1ef',
  muted: '#b0aea8',
  line: '#3B3936',
  fieldLine: '#3B3936',
  faint: '#79766F',
  placeholder: '#98958F',
  onAction: '#171716',
  actionDisabled: '#79766F',
  entry: '#171716',
  accent: '#60A5FA',
  tabPaper: '#1A1A1A',
  tabMuted: '#98958F',
  bubble: '#31302D',
  rail: '#625E57',
  tint: '#2A2927',
  error: '#ffaaa2',
}
export type ThemePreference = 'system' | 'light' | 'dark'
export const ThemeContext = createContext<{
  mode: 'light' | 'dark'
  preference: ThemePreference
  select(mode: ThemePreference): void
}>({ mode: 'light', preference: 'system', select: () => undefined })

function createUi(colors: typeof light, scale: number) {
  const r = (size: number) => size * scale
  const page = (route: keyof typeof routeGutters) => {
    const [side, top, bottom] = routeGutters[route]
    return { paddingHorizontal: r(side), paddingTop: r(top), paddingBottom: r(bottom) }
  }
  const ui = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    page: { ...page('all-sessions'), gap: r(24) },
    header: {
      flexDirection: 'row',
      minHeight: 44,
      paddingHorizontal: r(24),
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    headerSide: { width: Math.max(44, r(68)), alignItems: 'center' },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontWeight: '600',
      fontSize: r(32),
    },
    title: { color: colors.text, fontSize: r(56), lineHeight: r(76), fontWeight: '700' },
    section: { color: colors.text, fontSize: r(34), lineHeight: r(48), fontWeight: '600' },
    groupTitle: {
      color: colors.placeholder,
      fontSize: r(26),
      lineHeight: r(40),
      fontWeight: '500',
    },
    body: { color: colors.text, fontSize: r(30), lineHeight: r(48) },
    muted: { color: colors.muted, fontSize: r(26), lineHeight: r(42) },
    error: { color: colors.error, fontSize: r(26) },
    input: {
      minHeight: r(88),
      paddingVertical: 0,
      paddingHorizontal: r(24),
      backgroundColor: colors.paper,
      color: colors.text,
      borderColor: colors.fieldLine,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: r(20),
      fontSize: r(28),
    },
    search: { minHeight: r(76), borderColor: colors.line, borderRadius: 999, fontSize: r(27) },
    row: { flexDirection: 'row', gap: r(16), alignItems: 'center' },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: r(108),
      paddingVertical: r(20),
      gap: r(16),
    },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    card: {
      padding: r(28),
      borderRadius: r(32),
      backgroundColor: colors.paper,
    },
    button: {
      minHeight: Math.max(44, r(88)),
      minWidth: 44,
      paddingHorizontal: r(36),
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 999,
    },
    actionText: { color: colors.accent, fontWeight: '500', fontSize: r(30) },
  })
  return { colors, ui, page, r }
}
export function useUi() {
  const theme = useContext(ThemeContext)
  const { width } = useWindowDimensions()
  const scale = rpxScale(width)
  const appearance = useMemo(
    () => createUi(theme.mode === 'dark' ? dark : light, scale),
    [theme.mode, scale],
  )
  return { ...appearance, theme }
}

export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  symbol,
  compact = false,
}: {
  label: string
  onPress(): void
  disabled?: boolean
  primary?: boolean
  symbol?: string
  compact?: boolean
}) {
  const { ui, colors, r } = useUi()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        (symbol || compact) && { paddingHorizontal: symbol ? 0 : r(14) },
        primary && { backgroundColor: disabled ? colors.actionDisabled : colors.text },
        { opacity: disabled && !primary ? 0.48 : pressed ? 0.72 : 1 },
      ]}
    >
      <Text
        style={[
          ui.actionText,
          primary && { color: colors.onAction },
          compact && { fontSize: r(26) },
          symbol && { fontSize: r(40), color: primary ? colors.onAction : colors.text },
        ]}
      >
        {symbol ?? label}
      </Text>
    </Pressable>
  )
}
