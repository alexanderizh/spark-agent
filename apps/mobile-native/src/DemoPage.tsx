import { ScrollView, Text, View } from 'react-native'
import { useUi } from './ui'

const sessions = [
  ['整理移动端发布清单', 'Spark Agent · 刚刚 · 运行中'],
  ['修复筛选浮层溢出', 'Spark Agent · 今天 11:20 · 待审查'],
  ['小程序深色模式配色校对', '官网 · 昨天 · 已完成'],
]

export function DemoPage() {
  const { colors, ui, page, r } = useUi()
  return (
    <ScrollView contentContainerStyle={[page('demo'), { gap: r(24) }]}>
      <View
        style={[
          ui.card,
          { borderRadius: r(20), borderLeftWidth: r(6), borderLeftColor: colors.accent, gap: r(8) },
        ]}
      >
        <Text style={ui.section}>界面预览 · 示例数据</Text>
        <Text style={ui.muted}>还没有电脑接入时可预览界面。示例数据仅在本机展示。</Text>
      </View>
      <Text style={ui.section}>电脑</Text>
      <View style={[ui.listRow, ui.card]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.body}>MacBook Pro（示例）</Text>
          <Text style={ui.muted}>在线 · SparkWork 0.15.22 · macOS</Text>
        </View>
      </View>
      <Text style={ui.section}>会话</Text>
      <View style={ui.card}>
        {sessions.map(([title, summary], index) => (
          <View key={title}>
            {index > 0 && <View style={ui.separator} />}
            <View style={ui.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>{title}</Text>
                <Text style={ui.muted}>{summary}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
      <Text style={ui.section}>对话 · 只读</Text>
      <View style={{ gap: 10, padding: 14, backgroundColor: colors.paper, borderRadius: 12 }}>
        <Text
          style={[
            ui.body,
            { alignSelf: 'flex-end', backgroundColor: colors.tint, padding: 10, borderRadius: 14 },
          ]}
        >
          帮我看看首页设备列表为什么一直空着
        </Text>
        <Text style={ui.body}>桌面端没连上中继。我先看一下连接状态和接口返回。</Text>
        <Text style={[ui.body, { fontFamily: 'monospace' }]}>
          GET /v1/catalog → 404{'\n'}ws /ws/bridge/client → 未握手
        </Text>
        <Text style={ui.muted}>已执行 2 个命令</Text>
      </View>
    </ScrollView>
  )
}
