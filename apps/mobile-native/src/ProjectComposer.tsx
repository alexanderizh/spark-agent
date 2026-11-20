import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ComposerFile } from './ChatComposerMedia'
import { ProjectSessionIcon } from './ProjectSessionView'
import { Action, useUi } from './ui'

export function ProjectComposer({
  name,
  unassigned,
  autoFocus,
  online,
  state,
  model,
  effort,
  text,
  setText,
  files,
  setFiles,
  openSettings,
  send,
  unlock,
}: {
  name: string
  text: string
  setText(value: string): void
  files: ComposerFile[]
  setFiles: Dispatch<SetStateAction<ComposerFile[]>>
  unassigned: boolean
  autoFocus: boolean
  online: boolean
  state: 'ready' | 'sending' | 'unconfirmed'
  model: string
  effort: string
  openSettings(): void
  send(text: string, files: ComposerFile[]): void
  unlock(): void
}) {
  const [sheet, setSheet] = useState(false)
  const [focused, setFocused] = useState(false)
  const { ui, colors, r, theme } = useUi()
  const dark = theme.mode === 'dark'
  const locked = !online || state !== 'ready'
  const canSend = !locked && (!!text.trim() || files.length > 0)
  const placeholder = unassigned ? '在未归属项目中发起对话…' : `在 ${name} 发起对话…`
  const pick = async (photo: boolean) => {
    setSheet(false)
    try {
      const result = photo
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true })
      if (result.canceled) return
      const selected = result.assets.map((asset) => ({
        uri: asset.uri,
        name: 'name' in asset ? asset.name : asset.fileName || '图片.jpg',
        mimeType: asset.mimeType,
      }))
      setFiles((previous) => [...previous, ...selected].slice(0, 20))
    } catch {
      Alert.alert('选择附件失败', '请重新选择照片或文件。')
    }
  }
  const control = {
    width: Math.max(44, r(88)),
    height: Math.max(44, r(88)),
    borderRadius: 999,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.tint,
  }
  return (
    <View
      style={{
        backgroundColor: dark ? colors.entry : '#faf9f7',
        paddingHorizontal: r(24),
        paddingTop: r(12),
        paddingBottom: r(18),
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
      }}
    >
      {state === 'unconfirmed' && (
        <View style={ui.row}>
          <Text style={[ui.error, { flex: 1 }]}>新建结果未确认，请先核对电脑端的会话列表。</Text>
          <Action
            compact
            label="核对后解锁"
            onPress={() =>
              Alert.alert('确认未创建会话？', '请先检查电脑端的会话列表。', [
                { text: '取消', style: 'cancel' },
                { text: '确认未创建', onPress: unlock },
              ])
            }
          />
        </View>
      )}
      <View
        style={{
          backgroundColor: colors.paper,
          borderColor: focused ? colors.rail : colors.fieldLine,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: r(40),
          paddingTop: r(22),
          paddingBottom: r(14),
          paddingLeft: r(22),
          paddingRight: r(18),
          gap: r(16),
        }}
      >
        {files.length > 0 && (
          <View style={[ui.row, { flexWrap: 'wrap', gap: r(8) }]}>
            {files.map((file, index) => (
              <Pressable
                key={`${file.uri}:${index}`}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`移除 ${file.name}`}
                onPress={() => setFiles((previous) => previous.filter((_, i) => i !== index))}
                style={{
                  maxWidth: '100%',
                  paddingHorizontal: r(12),
                  backgroundColor: colors.tint,
                  borderRadius: r(12),
                }}
              >
                <Text numberOfLines={1} style={ui.muted}>
                  {file.name} ×
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          accessibilityLabel="发起项目对话"
          autoFocus={autoFocus && online}
          multiline
          numberOfLines={1}
          maxLength={8000}
          editable={!locked}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            color: colors.text,
            fontSize: r(32),
            lineHeight: r(44),
            minHeight: r(44),
            maxHeight: r(180),
            padding: 0,
          }}
        />
        <View style={[ui.row, { gap: r(10) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加附件"
            disabled={locked || files.length >= 20}
            onPress={() => setSheet(true)}
            style={({ pressed }) => [control, { opacity: locked || pressed ? 0.55 : 1 }]}
          >
            <ProjectSessionIcon name="plus" size={32} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`模型配置，${model}`}
            disabled={locked}
            onPress={openSettings}
            style={({ pressed }) => [
              ui.row,
              {
                minWidth: 0,
                flexShrink: 1,
                maxWidth: r(380),
                height: control.height,
                gap: r(8),
                paddingHorizontal: r(24),
                borderRadius: 999,
                backgroundColor: colors.tint,
                opacity: locked || pressed ? 0.55 : 1,
              },
            ]}
          >
            <ProjectSessionIcon name="shield" color={dark ? '#fb923c' : '#c2410c'} />
            <Text
              numberOfLines={1}
              style={{ flexShrink: 1, color: colors.text, fontWeight: '500', fontSize: r(29) }}
            >
              {model}
            </Text>
            {!!effort && (
              <Text style={{ color: colors.placeholder, fontSize: r(26) }}>{effort}</Text>
            )}
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            disabled={!canSend}
            onPress={() => send(text, files)}
            style={({ pressed }) => [
              control,
              { backgroundColor: canSend ? colors.text : colors.tint, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <ProjectSessionIcon
              name="up"
              size={32}
              color={canSend ? colors.onAction : colors.placeholder}
            />
          </Pressable>
        </View>
      </View>
      {sheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setSheet(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
            <Pressable
              accessible={false}
              onPress={() => setSheet(false)}
              style={StyleSheet.absoluteFill}
            />
            <SafeAreaView
              edges={['bottom']}
              style={{
                padding: r(24),
                borderTopLeftRadius: r(36),
                borderTopRightRadius: r(36),
                backgroundColor: colors.paper,
              }}
            >
              <Text style={ui.section}>添加附件</Text>
              <Action label="照片" onPress={() => void pick(true)} />
              <Action label="文件" onPress={() => void pick(false)} />
              <Action label="取消" onPress={() => setSheet(false)} />
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  )
}
