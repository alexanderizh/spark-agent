import { useEffect, useState } from 'react'
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { accountData } from './auth'
import { useDeviceAliases } from './device-aliases'
import { object, type Device } from './relay'
import { RowMenu } from './RowMenu'
import { Action, useUi } from './ui'

export function WorkbenchDevices({
  token,
  onlineDevices,
  active,
  onSelect,
  manage,
  profile,
  demo,
}: {
  token: string
  onlineDevices: Device[]
  active?: string
  onSelect(device: Device): void
  manage(): void
  profile(): void
  demo(): void
}) {
  const { ui, colors, page, r, theme } = useUi()
  const dark = theme.mode === 'dark'
  const caption = { color: colors.placeholder, fontSize: r(22), lineHeight: r(33) }
  const [saved, setSaved] = useState<Device[]>([])
  const { user, ready, aliasFor, saveAlias } = useDeviceAliases(token)
  const avatar = user?.avatarUrl
  const initial = Array.from(user?.nickname || user?.account || 'S')[0]
  const [revision, setRevision] = useState(0)
  const [load, setLoad] = useState<'loading' | 'failed' | 'done'>('loading')
  const [menu, setMenu] = useState<Device>()
  useEffect(() => {
    let current = true
    setLoad('loading')
    void accountData('/mobile-bridge/devices', token)
      .then((data) => {
        const rows = object(data)?.devices
        if (!Array.isArray(rows)) throw new Error('设备列表格式异常')
        if (current) {
          setSaved(
            rows.flatMap((raw: unknown) => {
              const item = object(raw)
              return typeof item?.deviceId === 'string'
                ? [
                    {
                      deviceId: item.deviceId,
                      label:
                        typeof item.name === 'string' && item.name
                          ? item.name
                          : typeof item.label === 'string' && item.label
                            ? item.label
                            : '桌面端',
                    },
                  ]
                : []
            }),
          )
          setLoad('done')
        }
      })
      .catch(() => {
        if (current) setLoad('failed')
      })
    return () => {
      current = false
    }
  }, [token, revision])
  const onlineIds = new Set(onlineDevices.map((device) => device.deviceId))
  const rows = [
    ...new Map(
      [...onlineDevices, ...saved.filter((row) => !onlineIds.has(row.deviceId))].map((row) => [
        row.deviceId,
        row,
      ]),
    ).values(),
  ]
  return (
    <View style={ui.screen}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.deviceId}
        contentContainerStyle={[page('home'), { gap: r(16) }]}
        ListHeaderComponent={
          <View>
            <View style={[ui.row, { justifyContent: 'space-between', minHeight: r(104) }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="我的"
                onPress={profile}
                style={{
                  width: r(84),
                  height: r(84),
                  borderRadius: r(42),
                  backgroundColor: colors.tint,
                  justifyContent: 'center',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {avatar ? (
                  <Image source={{ uri: avatar }} style={{ width: r(84), height: r(84) }} />
                ) : (
                  <Text style={ui.section}>{initial}</Text>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" onPress={manage} hitSlop={10}>
                <Text style={{ color: colors.accent, fontSize: r(24) }}>设备管理</Text>
              </Pressable>
            </View>
            <View style={{ paddingTop: r(22), paddingBottom: r(28) }}>
              <Text accessibilityRole="header" style={[ui.title, { letterSpacing: r(0.5) }]}>
                远程会话
              </Text>
              <Text
                style={{
                  marginTop: r(10),
                  fontSize: r(24),
                  lineHeight: r(36),
                  color: dark ? colors.placeholder : '#8A8782',
                }}
              >
                先选电脑，再进入它自己的项目与会话
              </Text>
            </View>
            <View
              style={[
                ui.row,
                { justifyContent: 'space-between', paddingTop: r(20), marginBottom: r(4) },
              ]}
            >
              <Text style={ui.groupTitle}>电脑</Text>
              <Text style={caption}>
                {rows.length} 台已接入
                <Text style={{ color: colors.faint }}> · 长按可设备注名</Text>
              </Text>
            </View>
            {load === 'failed' && (
              <Action
                label="电脑列表加载失败，点击重试"
                onPress={() => setRevision((n) => n + 1)}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          load === 'loading' ? (
            <Text style={ui.muted}>正在获取已接入电脑…</Text>
          ) : load === 'done' ? (
            <View>
              <Text style={ui.body}>还没有接入的电脑</Text>
              <Text style={ui.muted}>在桌面端登录同一账号并开启云端中继。</Text>
              <Action label="看看界面长什么样" onPress={demo} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const connected = onlineIds.has(item.deviceId)
          const alias = aliasFor(item.deviceId)
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active === item.deviceId }}
              accessibilityHint={ready ? '长按设置备注名' : undefined}
              onLongPress={ready ? () => setMenu(item) : undefined}
              onPress={connected ? () => onSelect(item) : undefined}
              style={({ pressed }) => ({
                padding: r(24),
                gap: r(20),
                backgroundColor: pressed ? colors.tint : colors.paper,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: r(22),
                borderColor:
                  active === item.deviceId
                    ? dark
                      ? '#36587D'
                      : '#C8D9F5'
                    : dark
                      ? '#3B3935'
                      : '#E9E7E4',
                boxShadow: `0 ${r(4)}px ${r(16)}px ${dark ? '#0000003D' : '#1A1A1A09'}`,
              })}
            >
              <View style={[ui.row, { gap: r(12) }]}>
                <View
                  style={{
                    width: r(66),
                    height: r(66),
                    borderRadius: r(18),
                    backgroundColor: dark ? colors.tint : '#F1F0ED',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Svg
                    width={r(34)}
                    height={r(34)}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.placeholder}
                    strokeWidth={2}
                    strokeLinecap="round"
                  >
                    <Rect x={3} y={4} width={18} height={13} rx={1.5} />
                    <Path d="M8 21h8M12 17v4" />
                  </Svg>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[ui.section, { fontSize: r(29), lineHeight: r(40) }]}
                  >
                    {alias || item.label}
                  </Text>
                  {!!alias && alias !== item.label && (
                    <Text
                      numberOfLines={1}
                      style={[ui.muted, { fontSize: r(21), lineHeight: r(29) }]}
                    >
                      {item.label}
                    </Text>
                  )}
                </View>
                <View style={[ui.row, { gap: r(8) }]}>
                  <View
                    style={{
                      width: r(14),
                      height: r(14),
                      borderRadius: r(7),
                      backgroundColor: connected ? '#22C55E' : dark ? '#484641' : '#D4D1CC',
                    }}
                  />
                  <Text style={{ ...caption, color: dark ? '#AAA69F' : '#77736D' }}>
                    {connected ? '在线' : '离线'}
                  </Text>
                </View>
              </View>
              <View style={[ui.row, { paddingLeft: r(82), justifyContent: 'space-between' }]}>
                <Text style={caption}>
                  {connected ? '查看这台电脑的项目' : '电脑连接中继后即可浏览'}
                </Text>
                {connected && (
                  <Svg
                    width={r(32)}
                    height={r(32)}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.faint}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <Path d="m9 5 7 7-7 7" />
                  </Svg>
                )}
              </View>
            </Pressable>
          )
        }}
      />
      {menu && (
        <RowMenu
          title={menu.label}
          online={ready}
          close={() => setMenu(undefined)}
          refresh={() => undefined}
          actions={[
            {
              label: '设置备注名',
              prompt: { initial: aliasFor(menu.deviceId) ?? '' },
              run: (value) => saveAlias(menu.deviceId, value),
            },
            ...(aliasFor(menu.deviceId)
              ? [{ label: '清除备注名', run: () => saveAlias(menu.deviceId, '') }]
              : []),
          ]}
        />
      )}
    </View>
  )
}
