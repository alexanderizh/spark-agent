import { randomUUID } from 'expo-crypto'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import type { ChatDraft } from './chat-draft'
import type { Relay, Target } from './relay'
import { mergeEvents, messages } from './timeline'
import type { Message } from './timeline'
import { Action, colors, ui } from './ui'

export function Chat({
  relay,
  deviceId,
  sessionId,
  draft,
  online,
  connection,
  back,
}: Target & {
  relay: Relay
  draft: ChatDraft
  online: boolean
  connection: number
  back(): void
}) {
  const [events, setEvents] = useState<MobileBridgeEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot)
  const { text: compose, status, notice } = snapshot
  const sending = status === 'sending'
  const uncertain = status === 'unconfirmed'
  const list = useRef<FlatList<Message>>(null)
  const follow = useRef(true)
  const rows = useMemo(() => messages(events), [events])

  useEffect(
    () =>
      relay.subscribe({ deviceId, sessionId }, (incoming) => {
        if (incoming.length) setEvents((previous) => mergeEvents(previous, incoming))
      }),
    [deviceId, relay, sessionId],
  )

  useEffect(() => {
    setLoaded(false)
    if (!online) return
    let current = true
    setHistoryError('')
    void relay
      .history({ deviceId, sessionId })
      .then((result) => {
        if (!current) return
        setEvents((previous) => mergeEvents(previous, result.events))
        setLoaded(true)
      })
      .catch(() => {
        if (current) setHistoryError('历史同步失败，请重试')
      })
    return () => {
      current = false
    }
  }, [connection, deviceId, online, relay, reload, sessionId])

  const send = async () => {
    if (!online || !loaded) return
    if (await draft.send((text) => relay.submit({ deviceId, sessionId }, text, randomUUID()))) {
      follow.current = true
    }
  }

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.page}
        scrollEventThrottle={80}
        onContentSizeChange={() => {
          if (follow.current) list.current?.scrollToEnd({ animated: false })
        }}
        onScroll={({ nativeEvent: n }) => {
          follow.current =
            n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height < 120
        }}
        ListEmptyComponent={
          <Text style={ui.muted}>
            {!online
              ? '等待云中继连接'
              : historyError || (loaded ? '最近没有文字消息' : '正在同步历史…')}
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '94%',
              padding: 12,
              borderRadius: 8,
              backgroundColor: item.role === 'user' ? colors.tint : colors.paper,
            }}
          >
            <Text style={ui.muted}>
              {item.role === 'user' ? '你' : item.role === 'assistant' ? '助手' : '会话错误'}
            </Text>
            <Text selectable style={[ui.body, item.role === 'error' && { color: colors.error }]}>
              {item.text}
            </Text>
          </View>
        )}
      />
      <View
        style={{
          padding: 12,
          gap: 6,
          backgroundColor: colors.paper,
          borderTopWidth: 1,
          borderColor: colors.line,
        }}
      >
        {!!historyError && (
          <View style={ui.row}>
            <Text style={[ui.error, { flex: 1 }]}>{historyError}</Text>
            <Action
              label="同步历史"
              disabled={!online}
              onPress={() => setReload((value) => value + 1)}
            />
          </View>
        )}
        {!!notice && (
          <Text accessibilityLiveRegion="polite" style={uncertain ? ui.error : ui.muted}>
            {notice}
          </Text>
        )}
        {uncertain && (
          <Action
            label="在电脑端核对后解锁"
            onPress={() =>
              Alert.alert(
                '确认在电脑端核对过？',
                '请同时检查该会话的排队消息和对话记录。如果消息已排队或已收到，请勿重发。',
                [
                  {
                    text: '不重发，清空草稿',
                    style: 'destructive',
                    onPress: () => draft.resolveUnconfirmed(snapshot, true),
                  },
                  { text: '取消', style: 'cancel' },
                  {
                    text: '确认未收到，解锁草稿',
                    onPress: () => draft.resolveUnconfirmed(snapshot, false),
                  },
                ],
              )
            }
          />
        )}
        <View style={ui.row}>
          <TextInput
            style={[ui.input, { flex: 1, maxHeight: 120 }]}
            placeholder="输入消息"
            placeholderTextColor={colors.muted}
            accessibilityLabel="消息"
            value={compose}
            onChangeText={draft.setText}
            multiline
            editable={!sending && !uncertain}
          />
          <Action
            primary
            label={sending ? '发送中' : '发送'}
            symbol="↑"
            disabled={!online || !loaded || !compose.trim() || sending || uncertain}
            onPress={() => void send()}
          />
        </View>
        {!online && <Action label="返回电脑列表" onPress={back} />}
      </View>
    </KeyboardAvoidingView>
  )
}
