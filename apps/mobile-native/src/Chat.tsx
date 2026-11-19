import { randomUUID } from 'expo-crypto'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native'
import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import type { Relay, Target } from './relay'
import { mergeEvents, messages } from './timeline'
import type { Message } from './timeline'
import { Action, colors, ui } from './ui'

export function Chat({
  relay,
  deviceId,
  sessionId,
  online,
  connection,
  back,
}: Target & {
  relay: Relay
  online: boolean
  connection: number
  back(): void
}) {
  const [events, setEvents] = useState<MobileBridgeEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [compose, setCompose] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [uncertain, setUncertain] = useState(false)
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
    const text = compose.trim()
    if (!text || !online || !loaded || sending || uncertain) return
    setSending(true)
    setNotice('')
    try {
      const result = await relay.submit({ deviceId, sessionId }, text, randomUUID())
      setCompose('')
      follow.current = true
      if (result.started === false) setNotice('已加入电脑端队列')
    } catch {
      setUncertain(true)
      setNotice('未收到电脑确认。请先同步历史，确认没有发送成功后再决定是否重发。')
      setReload((value) => value + 1)
    } finally {
      setSending(false)
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
            label="保留草稿并解锁发送"
            disabled={!loaded}
            onPress={() => {
              setUncertain(false)
              setNotice('')
            }}
          />
        )}
        <View style={ui.row}>
          <TextInput
            style={[ui.input, { flex: 1, maxHeight: 120 }]}
            placeholder="输入消息"
            placeholderTextColor={colors.muted}
            accessibilityLabel="消息"
            value={compose}
            onChangeText={setCompose}
            multiline
            editable={!sending}
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
