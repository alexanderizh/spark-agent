import { randomUUID } from 'expo-crypto'
import { useEffect, useState } from 'react'
import { AppState, BackHandler, FlatList, Pressable, StatusBar, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { logout } from './auth'
import { Chat } from './Chat'
import { Login } from './Login'
import { Relay } from './relay'
import type { Device } from './relay'
import { Action, colors, ui } from './ui'

function DesktopSession({ token, exit }: { token: string; exit(): void }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [device, setDevice] = useState<Device>()
  const [session, setSession] = useState<{ id: string; title: string }>()
  const [sessions, setSessions] = useState<NonNullable<typeof session>[]>([])
  const [connection, setConnection] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [issue, setIssue] = useState('')
  const [sessionIssue, setSessionIssue] = useState('')
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
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
  useEffect(() => {
    if (!device || !desktopOnline || session) return
    let current = true
    setLoading(true)
    setSessionIssue('')
    void relay
      .sessions(device.deviceId)
      .then((rows) => {
        if (current) setSessions(rows)
      })
      .catch(() => {
        if (current) setSessionIssue('会话列表加载失败')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [connection, desktopOnline, device, relay, reload, session])

  const back = () => {
    if (session) setSession(undefined)
    else if (device) {
      setDevice(undefined)
      setSessions([])
      setSessionIssue('')
    }
  }
  useEffect(() => {
    const handle = BackHandler.addEventListener('hardwareBackPress', () => {
      if (session) {
        setSession(undefined)
        return true
      }
      if (device) {
        setDevice(undefined)
        setSessions([])
        setSessionIssue('')
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
          relay={relay}
          online={desktopOnline}
          connection={connection}
          back={() => {
            setSession(undefined)
            setDevice(undefined)
            setSessions([])
          }}
        />
      ) : device ? (
        <>
          {!!sessionIssue && (
            <View style={[ui.row, { paddingHorizontal: 20 }]}>
              <Text style={ui.error}>{sessionIssue}</Text>
              <Action
                label="重试"
                disabled={!desktopOnline}
                onPress={() => setReload((value) => value + 1)}
              />
            </View>
          )}
          <FlatList
            data={desktopOnline ? sessions : []}
            contentContainerStyle={ui.page}
            keyExtractor={(row) => row.id}
            ListEmptyComponent={
              <Text style={ui.muted}>
                {!desktopOnline
                  ? '电脑不在线'
                  : loading
                    ? '正在加载会话…'
                    : sessionIssue || '没有已有会话'}
              </Text>
            }
            renderItem={({ item }) => (
              <ListRow label={item.title || '未命名会话'} onPress={() => setSession(item)} />
            )}
          />
        </>
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
