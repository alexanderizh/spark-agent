import { memo, useMemo } from 'react'
import { Alert, Clipboard, ScrollView, StyleSheet, Text, View } from 'react-native'
import { parseMarkdown } from '../../mobile/src/utils/markdown'
import type {
  InlineNode,
  InlineTextNode,
  MdBlock,
  MdSegment,
} from '../../mobile/src/utils/markdown'
import { ChatImage, type LoadChatImage } from './ChatImages'
import { useUi } from './ui'

export function copyChatText(value: string) {
  try {
    Clipboard.setString(value)
    Alert.alert('已复制')
  } catch {
    Alert.alert('复制失败')
  }
}

function WebLink({ url, children }: { url: string; children: React.ReactNode }) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  if (!url) return <Text>{children}</Text>
  return (
    <Text
      style={styles.link}
      accessibilityRole="link"
      accessibilityHint="复制链接地址"
      onPress={() => copyChatText(url)}
    >
      {children}
    </Text>
  )
}

function Inline({ nodes }: { nodes: (InlineNode | InlineTextNode)[] }) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  return nodes.map((node, index) => {
    if ('type' in node) return <Text key={index}>{node.text}</Text>
    if (node.name === 'br') return '\n'
    const children = <Inline nodes={node.children ?? []} />
    const href = node.attrs?.['data-href']
    if (href)
      return (
        <WebLink key={index} url={href}>
          {children}
        </WebLink>
      )
    return (
      <Text
        key={index}
        style={[
          node.name === 'strong' && styles.bold,
          node.name === 'em' && styles.italic,
          node.name === 'code' && styles.inlineCode,
          node.attrs?.class === 'md-del' && styles.strike,
        ]}
      >
        {children}
      </Text>
    )
  })
}

function Segments({ segments }: { segments: MdSegment[] }) {
  return segments.map((segment, index) =>
    segment.kind === 'link' ? (
      <WebLink key={index} url={segment.url}>
        {segment.label}
      </WebLink>
    ) : (
      <Inline key={index} nodes={segment.nodes} />
    ),
  )
}

function Block({ block, loadImage }: { block: MdBlock; loadImage: LoadChatImage }) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui } = appearance
  switch (block.type) {
    case 'p':
      return (
        <Text selectable style={ui.body}>
          <Segments segments={block.segments} />
        </Text>
      )
    case 'h':
      return (
        <Text
          accessibilityRole="header"
          selectable
          style={[ui.body, styles.bold, block.level <= 2 && styles.heading]}
        >
          <Inline nodes={block.nodes} />
        </Text>
      )
    case 'quote':
      return (
        <View style={styles.quote}>
          {block.paragraphs.map((segments, index) => (
            <Text key={index} selectable style={[ui.body, styles.muted]}>
              <Segments segments={segments} />
            </Text>
          ))}
        </View>
      )
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listRow}>
              <Text style={[ui.body, styles.muted]}>
                {item.checked === null
                  ? block.ordered
                    ? `${index + 1}.`
                    : '•'
                  : item.checked
                    ? '☑'
                    : '☐'}
              </Text>
              <Text selectable style={[ui.body, styles.listText]}>
                <Inline nodes={item.nodes} />
              </Text>
            </View>
          ))}
        </View>
      )
    case 'code':
      return (
        <View style={styles.codeBlock}>
          <View style={ui.row}>
            <Text style={[ui.muted, { flex: 1 }]}>{block.lang}</Text>
            <Text
              style={styles.link}
              accessibilityRole="button"
              onPress={() => copyChatText(block.text)}
            >
              复制代码
            </Text>
          </View>
          <ScrollView horizontal keyboardShouldPersistTaps="handled">
            <Text selectable style={[ui.body, styles.mono]}>
              {block.text}
            </Text>
          </ScrollView>
        </View>
      )
    case 'hr':
      return <View style={styles.rule} />
    case 'image':
      return <ChatImage path={block.url} label={block.alt} load={loadImage} />
    case 'table':
      return (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.table}>
          <View>
            {[block.header, ...block.rows].map((row, index) => (
              <View key={index} style={[styles.tableRow, index % 2 === 0 && styles.shaded]}>
                {row.map((nodes, column) => (
                  <Text
                    key={column}
                    selectable
                    style={[
                      ui.body,
                      styles.cell,
                      index === 0 && styles.bold,
                      {
                        width: 100 + Math.min(100, (block.weights[column] ?? 1) * 12),
                        textAlign: block.aligns[column],
                      },
                    ]}
                  >
                    <Inline nodes={nodes} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )
  }
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  loadImage,
}: {
  text: string
  loadImage: LoadChatImage
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <View style={styles.document}>
      {blocks.map((block, index) => (
        <Block block={block} key={index} loadImage={loadImage} />
      ))}
    </View>
  )
})

function createStyles({ colors }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    document: { gap: 10 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    heading: { fontSize: 20, lineHeight: 28 },
    muted: { color: colors.muted },
    mono: { fontFamily: 'monospace', fontSize: 14 },
    inlineCode: { fontFamily: 'monospace', backgroundColor: colors.background },
    link: { color: colors.accent, textDecorationLine: 'underline' },
    quote: { borderLeftWidth: 3, borderColor: colors.line, paddingLeft: 12, gap: 6 },
    codeBlock: { backgroundColor: colors.background, borderRadius: 8, padding: 12, gap: 8 },
    list: { gap: 4 },
    listRow: { flexDirection: 'row', gap: 8 },
    listText: { flex: 1 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 8 },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    shaded: { backgroundColor: colors.background },
    cell: { padding: 8 },
  })
}
