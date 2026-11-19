import { randomUUID } from 'expo-crypto'
import { useEffect, useState } from 'react'
import { AppState, BackHandler, FlatList, Pressable, StatusBar, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { logout } from './auth'
import { Chat } from './Chat'
import { ChatDrafts } from './chat-draft'
import { Login } from './Login'
import { Relay } from './relay'
import type { Device, Session } from './relay'
import { Action, colors, ui } from './ui'

function DesktopSession({ token, exit }: { token: string; exit(): void }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [device, setDevice] = useState<Device>()
  const [session, setSession] = useState<Session>()
  const [connection, setConnection] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [issue, setIssue] = useState('')
  const [drafts] = useState(() => new ChatDrafts())
  const [relay] = useState(
    () =>
      new Relay(token, `rn-${randomUUID()}`, {
        presence: setDevices,
        state: setStatus,
        issue: setIssue,
        restored: () => {
          setIssue('')
          setConnection((value) => value + 1)
        },
      }),
  )

  useEffect(() => {
    if (AppState.currentState !== 'background') relay.resume()
    const handle = AppState.addEventListener('change', (state) => {
      if (state === 'active') relay.resume()
      else if (state === 'background') relay.pause()
    })
    return () => {
      handle.remove()
      relay.pause()
    }
  }, [relay])

  const desktopOnline =
    status === 'online' && devices.some((entry) => entry.deviceId === device?.deviceId)
  const back = () => {
    if (session) setSession(undefined)
    else if (device) setDevice(undefined)
  }
  useEffect(() => {
    const handle = BackHandler.addEventListener('hardwareBackPress', () => {
      if (session) {
        setSession(undefined)
        return true
      }
      if (device) {
        setDevice(undefined)
        return true
      }
      return false
    })
    return () => handle.remove()
  }, [device, session])

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        {device && <Action label="返回" symbol="‹" onPress={back} />}
        <Text accessibilityRole="header" numberOfLines={1} style={ui.headerTitle}>
          {session?.title || (device ? '已有会话' : '选择电脑')}
        </Text>
        {!device && <Action label="退出" onPress={exit} />}
      </View>
      <View style={{ paddingHorizontal: 20, paddingVertical: 10, gap: 4 }}>
        <Text numberOfLines={1} style={ui.muted}>
          {device
            ? `${device.label} · ${desktopOnline ? '在线' : '未连接'}`
            : status === 'online'
              ? '云中继已连接'
              : status === 'connecting'
                ? '正在连接云中继…'
                : '云中继未连接'}
        </Text>
        {!!issue && (
          <Text accessibilityLiveRegion="polite" style={ui.error}>
            {issue}
          </Text>
        )}
      </View>
      {session && device ? (
        <Chat
          key={JSON.stringify([device.deviceId, session.id])}
          deviceId={device.deviceId}
          sessionId={session.id}
          draft={drafts.forTarget({ deviceId: device.deviceId, sessionId: session.id })}
          relay={relay}
          online={desktopOnline}
          connection={connection}
          back={() => {
            setSession(undefined)
            setDevice(undefined)
          }}
        />
      ) : device ? (
        <SessionList
          key={JSON.stringify([device.deviceId, connection])}
          deviceId={device.deviceId}
          online={desktopOnline}
          relay={relay}
          onSelect={setSession}
        />
      ) : (
        <FlatList
          data={status === 'online' ? devices : []}
          contentContainerStyle={ui.page}
          keyExtractor={(row) => row.deviceId}
          ListEmptyComponent={
            <Text style={ui.muted}>
              {status === 'online' ? '当前没有在线电脑' : '等候云中继连接'}
            </Text>
          }
          renderItem={({ item }) => <ListRow label={item.label} onPress={() => setDevice(item)} />}
        />
      )}
    </View>
  )
}

function SessionList({
  deviceId,
  online,
  relay,
  onSelect,
}: {
  deviceId: string
  online: boolean
  relay: Relay
  onSelect(session: Session): void
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [offset, setOffset] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')

  useEffect(() => {
    if (!online) return
    let current = true
    setLoading(true)
    setIssue('')
    void relay
      .sessions(deviceId, offset)
      .then((page) => {
        if (!current) return
        setSessions((previous) => {
          const rows = new Map((offset === 0 ? [] : previous).map((row) => [row.id, row]))
          for (const row of page.sessions) rows.set(row.id, row)
          return [...rows.values()]
        })
        setNextOffset(page.nextOffset)
      })
      .catch(() => {
        if (current) setIssue(offset === 0 ? '会话列表加载失败' : '更多会话加载失败')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [deviceId, offset, online, relay, reload])

  return (
    <FlatList
      data={online ? sessions : []}
      contentContainerStyle={ui.page}
      keyExtractor={(row) => row.id}
      ListEmptyComponent={
        <Text style={ui.muted}>
          {!online
            ? '电脑不在线'
            : loading && offset === 0
              ? '正在加载会话…'
              : !issue && nextOffset === null
                ? '没有已有会话'
                : ''}
        </Text>
      }
      ListFooterComponent={
        online && issue ? (
          <View style={ui.row}>
            <Text accessibilityLiveRegion="polite" style={[ui.error, { flex: 1 }]}>
              {issue}
            </Text>
            <Action
              label="重试"
              onPress={() => {
                setLoading(true)
                setIssue('')
                setReload((value) => value + 1)
              }}
            />
          </View>
        ) : online && nextOffset !== null ? (
          <Action
            label={loading ? '正在加载…' : '加载更多'}
            disabled={loading}
            onPress={() => {
              if (nextOffset === null || loading) return
              setLoading(true)
              setOffset(nextOffset)
            }}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <ListRow label={item.title || '未命名会话'} onPress={() => onSelect(item)} />
      )}
    />
  )
}

function ListRow({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [ui.listRow, pressed && { backgroundColor: colors.tint }]}
    >
      <Text style={[ui.body, { flex: 1 }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={ui.muted}>›</Text>
    </Pressable>
  )
}

export function App() {
  const [token, setToken] = useState<string>()
  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen}>
        <StatusBar barStyle="dark-content" />
        {token ? (
          <DesktopSession
            token={token}
            exit={() => {
              setToken(undefined)
              void logout(token).catch(() => {
                /* Local sign-out is already complete. */
              })
            }}
          />
        ) : (
          <Login onLogin={setToken} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}
