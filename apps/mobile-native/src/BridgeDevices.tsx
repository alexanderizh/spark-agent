import { useEffect, useRef, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { formatRelativeTime } from '../../mobile/src/utils/format'
import { accountData, revokeDesktop } from './auth'
import { useDeviceAliases } from './device-aliases'
import { object, type Device } from './relay'
import { Action, useUi } from './ui'

interface DeviceRow extends Device {
  version?: string
  lastSeenAt?: string
  trustedAt?: string
}

const readText = (value: unknown) => (typeof value === 'string' ? value : undefined)

export function BridgeDevices({
  token,
  onlineDevices,
}: {
  token: string
  onlineDevices: Device[]
}) {
  const { ui, page, colors, r, theme } = useUi()
  const dark = theme.mode === 'dark'
  const { ready, aliasFor, saveAlias } = useDeviceAliases(token)
  const [saved, setSaved] = useState<DeviceRow[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [pending, setPending] = useState<string>()
  const [revoking, setRevoking] = useState(false)
  const inFlight = useRef(false)
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<DeviceRow>()
  const [alias, setAlias] = useState('')
  const [aliasIssue, setAliasIssue] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setIssue('')
    void accountData('/mobile-bridge/devices', token)
      .then((data) => {
        const list = object(data)?.devices
        if (!Array.isArray(list)) throw new Error('设备列表格式异常')
        const devices = list.flatMap((value: unknown): DeviceRow[] => {
          const device = object(value)
          if (typeof device?.deviceId !== 'string' || !device.deviceId) return []
          return [
            {
              deviceId: device.deviceId,
              label: readText(device.name) || readText(device.label) || '桌面端',
              version: readText(device.version),
              lastSeenAt: readText(device.lastSeenAt),
              trustedAt: readText(device.trustedAt),
            },
          ]
        })
        if (active) setSaved(devices)
      })
      .catch(() => {
        if (active) setIssue('加载失败，请重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token, revision])

  const online = new Set(onlineDevices.map(({ deviceId }) => deviceId))
  const known = new Set(saved.map(({ deviceId }) => deviceId))
  const rows: DeviceRow[] = [
    ...saved,
    ...onlineDevices.filter(({ deviceId }) => !known.has(deviceId)),
  ].filter(({ deviceId }) => !revoked.has(deviceId))
  const refresh = () => {
    setPending(undefined)
    setRevision((n) => n + 1)
  }
  const confirmRevoke = async (id: string) => {
    if (inFlight.current || pending !== id || issue || loading) return
    inFlight.current = true
    setRevoking(true)
    try {
      await revokeDesktop(id, token)
      setRevoked((previous) => new Set([...previous, id]))
      refresh()
    } catch {
      setIssue('吊销结果未确认，请刷新核对')
    } finally {
      setPending(undefined)
      setRevoking(false)
      inFlight.current = false
    }
  }
  const submitAlias = async () => {
    if (!editing || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setAliasIssue('')
    try {
      await saveAlias(editing.deviceId, alias)
      setEditing(undefined)
    } catch {
      setAliasIssue('备注名保存失败，请重试')
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }
  const muted = dark ? colors.placeholder : '#8A8782'
  const secondary = dark ? colors.muted : '#A5A29C'
  const danger = dark ? colors.error : '#B91C1C'
  const neutralFill = dark ? colors.tint : '#F2F0ED'
  const caption = { fontSize: r(24), lineHeight: r(38.4), color: muted }
  const details = { fontSize: r(22), lineHeight: r(33), color: muted }
  const actionRow = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: r(12) }
  const button = (
    label: string,
    color: string,
    backgroundColor: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        backgroundColor,
        borderRadius: r(12),
        paddingHorizontal: r(24),
        paddingVertical: r(10),
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color, fontSize: r(24), lineHeight: r(36) }}>{label}</Text>
    </Pressable>
  )

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.deviceId}
        contentContainerStyle={page('bridge-devices')}
        refreshing={loading && rows.length > 0}
        onRefresh={revoking ? undefined : refresh}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: r(8), paddingTop: r(8) }}>
            <Text accessibilityRole="header" style={ui.title}>
              设备管理
            </Text>
            <Text style={[caption, { marginTop: r(12), marginBottom: r(24) }]}>
              通过云端中继访问你会话的桌面设备。电脑首次连接会自动注册接入；
              <Text style={{ color: dark ? '#FBBF74' : '#D97706' }}>吊销后立即断开且不可恢复</Text>
              ，需要恢复时在桌面端「重置设备身份」。
            </Text>
            {rows.length > 0 && (
              <Text style={[caption, { marginBottom: r(16) }]}>
                {rows.filter(({ deviceId }) => online.has(deviceId)).length} 台在线 · 共{' '}
                {rows.length} 台设备
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !issue ? (
            <View
              style={{ paddingVertical: r(48), alignItems: 'center', paddingHorizontal: r(24) }}
            >
              <Text style={ui.body}>{loading ? '加载中…' : '还没有接入的设备'}</Text>
              {!loading && (
                <Text style={[caption, { textAlign: 'center' }]}>
                  在电脑端 SparkWork 打开「设置 → 生态 → 移动端桥接 → 云端中继」，用同一 Spark
                  平台账号登录后即自动注册接入
                </Text>
              )}
            </View>
          ) : null
        }
        ListFooterComponent={issue ? <Action label={issue} onPress={refresh} /> : null}
        renderItem={({ item }) => {
          const connected = online.has(item.deviceId)
          const aliasName = aliasFor(item.deviceId)
          const id = item.deviceId.length > 12 ? `${item.deviceId.slice(0, 12)}…` : item.deviceId
          return (
            <View
              style={{
                padding: r(24),
                marginBottom: r(20),
                borderRadius: r(20),
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: dark ? colors.line : '#ECEAE6',
                backgroundColor: connected || dark ? colors.paper : '#FAF9F7',
                opacity: connected ? 1 : 0.82,
              }}
            >
              <View style={[actionRow, { justifyContent: 'space-between', marginBottom: r(6) }]}>
                <View style={[actionRow, { flex: 1, gap: r(8) }]}>
                  <View
                    style={{
                      width: r(14),
                      height: r(14),
                      borderRadius: r(7),
                      backgroundColor: connected ? '#22C55E' : dark ? colors.faint : '#D4D1CC',
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: dark ? colors.text : '#26241F',
                        fontSize: r(30),
                        lineHeight: r(40),
                        fontWeight: '600',
                      }}
                    >
                      {aliasName || item.label}
                    </Text>
                    {aliasName && aliasName !== item.label && (
                      <Text
                        numberOfLines={1}
                        style={[details, { color: secondary, marginTop: r(2) }]}
                      >
                        {item.label}
                      </Text>
                    )}
                  </View>
                </View>
                <Text
                  style={{
                    color: connected ? (dark ? '#86E8A7' : '#16A34A') : muted,
                    backgroundColor: connected ? (dark ? '#193529' : '#E8F7EE') : neutralFill,
                    fontSize: r(20),
                    lineHeight: r(20),
                    paddingVertical: r(8),
                    paddingHorizontal: r(14),
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  {connected ? '在线' : '离线'}
                </Text>
              </View>
              <Text style={[details, { color: secondary, fontFamily: 'monospace' }]}>
                {id}
                {item.version ? ` · v${item.version}` : ''}
              </Text>
              <View style={{ gap: r(4), marginTop: r(16) }}>
                <Text style={details}>最近活跃 {formatRelativeTime(item.lastSeenAt ?? null)}</Text>
                <Text style={details}>
                  首次接入 {item.trustedAt ? formatRelativeTime(item.trustedAt) : '—'}
                </Text>
              </View>
              <View
                style={[
                  actionRow,
                  {
                    justifyContent: 'flex-end',
                    marginTop: r(20),
                    paddingTop: r(20),
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: dark ? colors.line : '#F2F0EC',
                  },
                ]}
              >
                {pending === item.deviceId ? (
                  <>
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[details, { color: danger, flex: 1 }]}
                    >
                      吊销后此设备立即断开、不可恢复，确定？
                    </Text>
                    {button(
                      '取消',
                      colors.muted,
                      neutralFill,
                      () => setPending(undefined),
                      revoking,
                    )}
                    {button(
                      revoking ? '吊销中…' : '确认吊销',
                      '#FFFFFF',
                      '#B91C1C',
                      () => void confirmRevoke(item.deviceId),
                      revoking || loading || !!issue,
                    )}
                  </>
                ) : (
                  <>
                    {button(
                      '备注名',
                      colors.muted,
                      neutralFill,
                      () => {
                        setAlias(aliasName ?? '')
                        setAliasIssue('')
                        setEditing(item)
                      },
                      !ready || revoking,
                    )}
                    {button(
                      '吊销',
                      danger,
                      dark ? '#442725' : '#FDEEEE',
                      () => setPending(item.deviceId),
                      revoking || loading || !!issue,
                    )}
                  </>
                )}
              </View>
            </View>
          )
        }}
      />
      {editing && (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={() => !savingRef.current && setEditing(undefined)}
        >
          <View
            style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0006' }}
          >
            <View
              style={{ backgroundColor: colors.paper, padding: 16, borderRadius: 16, gap: r(16) }}
            >
              <Text accessibilityRole="header" style={ui.section}>
                设备备注名
              </Text>
              <TextInput
                accessibilityLabel="设备备注名"
                autoFocus
                value={alias}
                onChangeText={setAlias}
                placeholder={editing.label}
                placeholderTextColor={colors.placeholder}
                style={ui.input}
                editable={!saving}
                maxLength={160}
              />
              {!!aliasIssue && (
                <Text accessibilityLiveRegion="polite" style={ui.error}>
                  {aliasIssue}
                </Text>
              )}
              <View style={[actionRow, { justifyContent: 'flex-end' }]}>
                <Action label="取消" disabled={saving} onPress={() => setEditing(undefined)} />
                <Action
                  label={saving ? '保存中…' : '保存'}
                  primary
                  disabled={saving}
                  onPress={() => void submitAlias()}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  )
}
