import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import type { Relay } from './relay'
import { Action, useUi } from './ui'

export interface ComposerFile {
  uri: string
  name: string
  mimeType?: string
}
const maxBase64Chars = 11 * 1024 * 1024

export async function readComposerFile(file: ComposerFile) {
  const local = new File(file.uri)
  if (local.size > maxBase64Chars * 0.75) throw new Error(`${file.name} 超出附件大小限制`)
  const dataBase64 = await local.base64()
  if (!dataBase64 || dataBase64.length > maxBase64Chars)
    throw new Error(`${file.name} 无法读取或超过大小限制`)
  return { name: file.name, mimeType: file.mimeType, dataBase64 }
}

export function ChatComposerMedia({
  relay,
  deviceId,
  disabled,
  files,
  add,
  remove,
  transcribed,
  insert,
  openSettings,
  modelLabel,
  sendControl,
  children,
}: {
  relay: Relay
  deviceId: string
  disabled: boolean
  files: ComposerFile[]
  add(rows: ComposerFile[]): void
  remove(index: number): void
  transcribed(text: string): void
  insert(prefix: '/' | '@'): void
  openSettings(): void
  modelLabel: string
  sendControl: React.ReactNode
  children: React.ReactNode
}) {
  const { ui, colors, r } = useUi()
  const [showAttachments, setShowAttachments] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const pending = useRef(false)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const act = async (task: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setIssue('')
    try {
      await task()
    } catch (error) {
      if (active.current) setIssue(error instanceof Error ? error.message : '媒体操作失败')
    } finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }
  const selectImages = (camera: boolean) =>
    void act(async () => {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw new Error('未授权使用相机')
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.8,
            allowsMultipleSelection: true,
            selectionLimit: 20 - files.length,
          })
      if (!result.canceled && active.current)
        add(
          result.assets.map((image, index) => ({
            uri: image.uri,
            name: image.fileName || `图片-${index + 1}.jpg`,
            mimeType: image.mimeType,
          })),
        )
    })
  const selectDocuments = () =>
    void act(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (!result.canceled && active.current)
        add(
          result.assets.map((item) => ({
            uri: item.uri,
            name: item.name,
            mimeType: item.mimeType,
          })),
        )
    })
  const toggleRecord = () =>
    void act(async () => {
      if (!recording) {
        if (!(await requestRecordingPermissionsAsync()).granted) throw new Error('未授权使用麦克风')
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
        setRecording(true)
        return
      }
      setRecording(false)
      try {
        await recorder.stop()
      } finally {
        await setAudioModeAsync({ allowsRecording: false })
      }
      if (!recorder.uri) throw new Error('没有可用的录音')
      const audio = await readComposerFile({ uri: recorder.uri, name: '录音' })
      const text = await relay.transcribe(deviceId, audio.dataBase64)
      if (active.current && text.trim()) transcribed(text.trim())
    })
  const locked = disabled || busy || recording
  const toolControl = {
    ...ui.button,
    ...ui.row,
    paddingHorizontal: 0,
    justifyContent: 'center' as const,
    backgroundColor: colors.tint,
  }
  return (
    <View
      style={{
        gap: r(16),
        paddingTop: r(22),
        paddingLeft: r(22),
        paddingRight: r(18),
        paddingBottom: r(14),
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: r(40),
        backgroundColor: colors.paper,
      }}
    >
      {children}
      <View style={[ui.row, { gap: r(10) }]}>
        {!recording && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加附件"
              disabled={locked}
              onPress={() => setShowAttachments(true)}
              style={({ pressed }) => [toolControl, { opacity: locked || pressed ? 0.5 : 1 }]}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" stroke={colors.text} strokeWidth={2}>
                <Path d="M5 12h14M12 5v14" />
              </Svg>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`模型配置，${modelLabel}`}
                disabled={busy}
                onPress={openSettings}
                style={({ pressed }) => [
                  toolControl,
                  {
                    maxWidth: '100%',
                    paddingHorizontal: r(20),
                    opacity: pressed || busy ? 0.5 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[ui.body, { flexShrink: 1, fontWeight: '500', fontSize: r(26) }]}
                >
                  {modelLabel}
                </Text>
              </Pressable>
            </View>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? '结束并转写' : '语音'}
          disabled={busy || (disabled && !recording)}
          onPress={toggleRecord}
          style={({ pressed }) => [
            toolControl,
            recording && { flex: 1, backgroundColor: '#DC2626' },
            { opacity: busy || (disabled && !recording) || pressed ? 0.5 : 1 },
          ]}
        >
          <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={recording ? '#FFFFFF' : colors.text}
            strokeWidth={2}
            strokeLinecap="round"
          >
            <Rect x={9} y={3} width={6} height={11} rx={3} />
            <Path d="M5 11a7 7 0 0014 0M12 18v3" />
          </Svg>
          {recording && <Text style={{ color: '#FFFFFF', fontWeight: '500' }}>结束并转写</Text>}
        </Pressable>
        {!recording && sendControl}
      </View>
      <Modal
        transparent
        visible={showAttachments}
        animationType="slide"
        onRequestClose={() => setShowAttachments(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View
            style={{
              gap: 6,
              padding: 20,
              paddingBottom: 36,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              backgroundColor: colors.paper,
            }}
          >
            <Text accessibilityRole="header" style={ui.section}>
              添加到会话
            </Text>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              <Action
                label="相册"
                disabled={locked || files.length >= 20}
                onPress={() => {
                  setShowAttachments(false)
                  selectImages(false)
                }}
              />
              <Action
                label="拍照"
                disabled={locked || files.length >= 20}
                onPress={() => {
                  setShowAttachments(false)
                  selectImages(true)
                }}
              />
              <Action
                label="文件"
                disabled={locked || files.length >= 20}
                onPress={() => {
                  setShowAttachments(false)
                  selectDocuments()
                }}
              />
              <Action
                label="技能"
                disabled={locked}
                onPress={() => {
                  setShowAttachments(false)
                  insert('@')
                }}
              />
              <Action
                label="命令"
                disabled={locked}
                onPress={() => {
                  setShowAttachments(false)
                  insert('/')
                }}
              />
            </View>
            <Action label="关闭" onPress={() => setShowAttachments(false)} />
          </View>
        </View>
      </Modal>
      {files.map((file, index) => (
        <View key={`${index}:${file.uri}`} style={ui.row}>
          <Text numberOfLines={1} style={[ui.muted, { flex: 1 }]}>
            {file.name}
          </Text>
          <Action label="移除" symbol="×" disabled={disabled} onPress={() => remove(index)} />
        </View>
      ))}
      {!!issue && (
        <Text accessibilityLiveRegion="polite" style={ui.error}>
          {issue}
        </Text>
      )}
    </View>
  )
}
