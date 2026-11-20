import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useUi } from './ui'

export const nicknameLimit = 20

export function NicknameDialog({
  value,
  saving,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  value: string
  saving: boolean
  error: string
  onChange(value: string): void
  onCancel(): void
  onConfirm(): void
}) {
  const { colors, ui } = useUi()
  const [focused, setFocused] = useState(false)
  const lengthError = value.trim().length > nicknameLimit ? `昵称最多 ${nicknameLimit} 个字符` : ''
  const canConfirm = !!value.trim() && !lengthError && !saving
  const issue = lengthError || error
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: colors.paper }]}>
          <Text accessibilityRole="header" style={[ui.section, styles.title]}>
            修改昵称
          </Text>
          <TextInput
            accessibilityLabel="昵称"
            autoFocus
            autoCorrect={false}
            editable={!saving}
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={canConfirm ? onConfirm : undefined}
            returnKeyType="done"
            placeholder="请输入新昵称（20 字以内）"
            placeholderTextColor={colors.placeholder}
            selectionColor={colors.accent}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.tint,
                borderColor: issue ? colors.error : focused ? colors.accent : colors.tint,
              },
            ]}
          />
          {!!issue && (
            <Text accessibilityRole="alert" style={[ui.error, styles.error]}>
              {issue}
            </Text>
          )}
          <View style={[styles.buttons, { borderColor: colors.line }]}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: pressed ? colors.tint : colors.paper,
                  opacity: saving ? 0.55 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>取消</Text>
            </Pressable>
            <View style={[styles.buttonDivider, { backgroundColor: colors.line }]} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: !canConfirm }}
              disabled={!canConfirm}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? colors.tint : colors.paper },
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: canConfirm ? colors.accent : colors.placeholder },
                ]}
              >
                {saving ? '保存中…' : '确定'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#0006',
  },
  panel: { width: '100%', maxWidth: 304, borderRadius: 12, overflow: 'hidden' },
  title: { textAlign: 'center', fontSize: 17, lineHeight: 24, marginTop: 20, marginBottom: 12 },
  input: {
    minHeight: 40,
    marginHorizontal: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 15,
    borderRadius: 6,
    borderWidth: 1,
    ...Platform.select({ web: { outlineWidth: 0 } }),
  },
  error: { marginTop: 8, marginHorizontal: 20 },
  buttons: { flexDirection: 'row', marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  button: { flex: 1, minHeight: 48, padding: 8, alignItems: 'center', justifyContent: 'center' },
  buttonDivider: { width: StyleSheet.hairlineWidth },
  buttonText: { fontSize: 16, fontWeight: '500', textAlign: 'center' },
})
