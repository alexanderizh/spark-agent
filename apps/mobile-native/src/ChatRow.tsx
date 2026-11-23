import { memo } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { markdownPlainText } from '../../mobile/src/utils/markdown'
import { ChatImage, type LoadChatImage } from './ChatImages'
import { ChatMarkdown, copyChatText } from './ChatMarkdown'
import type { TimelineItem } from './timeline'
import { useUi } from './ui'

const toolLabels = {
  running: '运行中',
  success: '完成',
  error: '失败',
}

const gapSize = { first: 0, turn: 15, block: 7, tight: 3, section: 10 }

export const ChatRow = memo(function ChatRow(props: {
  item: TimelineItem
  expanded: boolean
  onToggle(key: string): void
  onFork?: (turnId: string) => void
  loadImage: LoadChatImage
}) {
  return (
    <View style={{ marginTop: gapSize[props.item.gap ?? 'first'] }}>
      <RowBody {...props} />
    </View>
  )
})

function RowBody({
  item,
  expanded,
  onToggle,
  onFork,
  loadImage,
}: {
  item: TimelineItem
  expanded: boolean
  onToggle(key: string): void
  onFork?: (turnId: string) => void
  loadImage: LoadChatImage
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui } = appearance
  if (item.kind === 'time')
    return <Text style={[ui.muted, styles.center, styles.day]}>{item.label}</Text>
  if (item.kind === 'divider') {
    return (
      <Pressable
        style={styles.divider}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => onToggle(item.key)}
      >
        <View style={styles.rule} />
        <Text style={[ui.muted, styles.center]}>
          {item.text} · {expanded ? '收起' : '展开'}
        </Text>
        <View style={styles.rule} />
      </Pressable>
    )
  }
  if (item.kind === 'media')
    return (
      <ScrollView horizontal contentContainerStyle={styles.attachments}>
        {item.paths.map((path, index) => (
          <ChatImage key={index} thumbnail path={path} load={loadImage} />
        ))}
      </ScrollView>
    )
  const { kind, text } = item
  if (kind === 'assistant') {
    return (
      <View>
        <ChatMarkdown text={text} loadImage={loadImage} />
        <Pressable
          style={styles.copy}
          hitSlop={8}
          accessibilityRole="button"
          onPress={() => copyChatText(markdownPlainText(text))}
          onLongPress={() =>
            Alert.alert('复制回复', undefined, [
              { text: '取消', style: 'cancel' },
              { text: '复制为纯文本', onPress: () => copyChatText(markdownPlainText(text)) },
              { text: '复制 Markdown 原文', onPress: () => copyChatText(text) },
            ])
          }
        >
          <Text style={[ui.muted, { fontSize: 11 }]}>复制</Text>
        </Pressable>
      </View>
    )
  }
  if (kind === 'user') {
    const attachments = item.attachments ?? []
    return (
      <View style={styles.userStack}>
        {attachments.length > 0 && (
          <View style={[styles.attachments, styles.userAttachments]}>
            {attachments.map((file, index) =>
              file.type === 'image' ? (
                <ChatImage
                  key={index}
                  thumbnail
                  path={file.path}
                  label={file.name}
                  load={loadImage}
                />
              ) : (
                <Text key={index} numberOfLines={1} style={styles.file}>
                  {file.name || '附件'}
                </Text>
              ),
            )}
          </View>
        )}
        {(!!text || attachments.length === 0) && (
          <Pressable
            style={styles.bubble}
            onLongPress={() => {
              const turnId = item.turnId
              Alert.alert('消息操作', undefined, [
                { text: '取消', style: 'cancel' },
                { text: '复制消息', onPress: () => copyChatText(text) },
                ...(turnId && onFork
                  ? [{ text: '从此处分支', onPress: () => onFork(turnId) }]
                  : []),
              ])
            }}
          >
            <Text selectable style={ui.body}>
              {text || '附件'}
            </Text>
          </Pressable>
        )}
      </View>
    )
  }
  if (kind === 'status') {
    return <Text style={item.tone === 'error' ? ui.error : ui.muted}>{text}</Text>
  }
  const hasDetail = !!text.trim()
  const toolStatus = kind === 'tool' ? item.toolStatus : undefined
  const title = kind === 'tool' ? item.toolName : '思考过程'
  const status = toolStatus ? toolLabels[toolStatus] : ''
  const label = (
    <>
      <View style={styles.detailMark} />
      <Text style={[ui.muted, styles.detailTitle]} numberOfLines={1}>
        {title}
      </Text>
      {!!status && <Text style={toolStatus === 'error' ? ui.error : ui.muted}>{status}</Text>}
      {hasDetail && <Text style={ui.actionText}>{expanded ? '收起' : '展开'}</Text>}
    </>
  )
  return (
    <View>
      {hasDetail ? (
        <Pressable
          style={styles.detailHeader}
          accessibilityRole="button"
          accessibilityLabel={[title, status].filter(Boolean).join('，')}
          accessibilityState={{ expanded }}
          onPress={() => onToggle(item.key)}
        >
          {label}
        </Pressable>
      ) : (
        <View style={styles.detailHeader}>{label}</View>
      )}
      {expanded && hasDetail && (
        <Text selectable style={[ui.muted, styles.detailText]}>
          {text}
        </Text>
      )}
    </View>
  )
}

function createStyles({ colors, ui, r }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    center: { textAlign: 'center', fontSize: 11 },
    day: { paddingTop: 13, paddingBottom: 7 },
    divider: { ...ui.row, minHeight: 44 },
    rule: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: colors.line },
    copy: {
      minHeight: 36,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    userStack: { gap: 8 },
    attachments: { ...ui.row, gap: 8 },
    userAttachments: { justifyContent: 'flex-end', flexWrap: 'wrap' },
    file: {
      ...ui.body,
      maxWidth: '88%',
      borderRadius: 8,
      padding: 8,
      backgroundColor: colors.background,
    },
    bubble: {
      alignSelf: 'flex-end',
      maxWidth: '78%',
      borderRadius: r(32),
      borderBottomRightRadius: r(12),
      paddingHorizontal: r(28),
      paddingVertical: r(20),
      backgroundColor: colors.bubble,
    },
    detailHeader: {
      paddingHorizontal: 3,
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    detailMark: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.rail },
    detailTitle: { flex: 1, fontWeight: '500', fontSize: 12 },
    detailText: {
      marginLeft: 10,
      marginBottom: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderLeftWidth: 1,
      borderColor: colors.line,
      fontSize: 12,
    },
  })
}
