import { File, Paths } from 'expo-file-system'
import { Asset, requestPermissionsAsync } from 'expo-media-library'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Action, useUi } from './ui'

export type LoadChatImage = (path: string) => Promise<string>

export function ChatImage({
  path,
  label,
  load,
  thumbnail = false,
}: {
  path: string
  label?: string
  load: LoadChatImage
  thumbnail?: boolean
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const [source, setSource] = useState<string>()
  const [issue, setIssue] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setSource(undefined)
    setIssue(false)
    void load(path)
      .then((uri) => {
        if (current) setSource(uri)
      })
      .catch(() => {
        if (current) setIssue(true)
      })
    return () => {
      current = false
    }
  }, [load, path, retry])
  const save = async () => {
    if (!source || saving) return
    setSaving(true)
    let temporary: File | undefined
    try {
      if (!(await requestPermissionsAsync(true, ['photo'])).granted)
        throw new Error('未授权写入相册')
      const embedded = /^data:image\/(png|jpeg|webp|gif|bmp);base64,(.+)$/i.exec(source)
      const extension =
        embedded?.[1] ?? /\.(png|jpeg|jpg|webp|gif|bmp)(?:[?#]|$)/i.exec(source)?.[1] ?? 'jpg'
      temporary = new File(
        Paths.cache,
        `sparkwork-${Date.now()}.${extension === 'jpeg' ? 'jpg' : extension}`,
      )
      if (embedded) temporary.write(embedded[2], { encoding: 'base64' })
      else await File.downloadFileAsync(source, temporary)
      await Asset.create(temporary.uri)
      Alert.alert('已保存到相册')
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : undefined)
    } finally {
      if (temporary?.exists) {
        try {
          temporary.delete()
        } catch {
          /* Cache cleanup can be retried by the OS. */
        }
      }
      setSaving(false)
    }
  }
  return (
    <View style={thumbnail ? styles.thumbnail : styles.full}>
      {source && !issue ? (
        <Pressable
          style={styles.pressable}
          accessibilityRole="button"
          accessibilityLabel={label || '预览图片'}
          onPress={() => setPreview(true)}
        >
          <Image
            source={{ uri: source }}
            style={styles.image}
            resizeMode={thumbnail ? 'cover' : 'contain'}
            onError={() => setIssue(true)}
          />
        </Pressable>
      ) : issue ? (
        <Action label="加载图片" onPress={() => setRetry((value) => value + 1)} />
      ) : (
        <ActivityIndicator accessibilityLabel="正在加载图片" />
      )}
      <Modal visible={preview} onRequestClose={() => setPreview(false)} animationType="fade">
        <View style={styles.overlay}>
          {source && <Image source={{ uri: source }} style={styles.preview} resizeMode="contain" />}
          <Action
            label={saving ? '正在保存…' : '保存到相册'}
            disabled={saving}
            onPress={() => void save()}
          />
          <Pressable
            style={styles.close}
            accessibilityRole="button"
            onPress={() => setPreview(false)}
          >
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

function createStyles({ colors, ui }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    thumbnail: {
      width: 112,
      height: 112,
      backgroundColor: colors.background,
      justifyContent: 'center',
      borderRadius: 9,
      overflow: 'hidden',
    },
    full: {
      minHeight: 160,
      aspectRatio: 1.65,
      alignSelf: 'stretch',
      backgroundColor: colors.background,
      justifyContent: 'center',
      borderRadius: 9,
      overflow: 'hidden',
    },
    pressable: { flex: 1 },
    image: { width: '100%', height: '100%' },
    preview: { flex: 1, width: '100%' },
    overlay: {
      ...ui.screen,
      backgroundColor: '#121212',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    close: { padding: 14, alignSelf: 'center' },
    closeText: { ...ui.body, color: '#FFFFFF' },
  })
}
