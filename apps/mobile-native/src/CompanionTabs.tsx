import * as ImagePicker from 'expo-image-picker'
import { useEffect, useRef, useState } from 'react'
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { maskAccount } from '../../mobile/src/utils/format'
import type { AccountPage } from './AccountPages'
import { me, SERVICE_ORIGIN, updateAvatar, updateNickname } from './auth'
import { NicknameDialog, nicknameLimit } from './NicknameDialog'
import type { Device } from './relay'
import { Action, useUi } from './ui'
import { SafeAreaView } from 'react-native-safe-area-context'

export type Tab = '工作台' | '项目' | '我的'
const tabs: Tab[] = ['工作台', '项目', '我的']
const tabIcons = {
  工作台: {
    normal: require('../../mobile/src/assets/tabbar/home-normal.png'),
    active: require('../../mobile/src/assets/tabbar/home-active.png'),
  },
  项目: {
    normal: require('../../mobile/src/assets/tabbar/projects-normal.png'),
    active: require('../../mobile/src/assets/tabbar/projects-active.png'),
  },
  我的: {
    normal: require('../../mobile/src/assets/tabbar/profile-normal.png'),
    active: require('../../mobile/src/assets/tabbar/profile-active.png'),
  },
}

export function TabBar({ tab, select }: { tab: Tab; select(tab: Tab): void }) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { colors } = appearance
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.tabPaper }}>
      <View style={styles.bar}>
        {tabs.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            aria-selected={item === tab}
            style={styles.tab}
            onPress={() => select(item)}
          >
            <Image
              source={tabIcons[item][item === tab ? 'active' : 'normal']}
              style={{ width: 24, height: 24 }}
            />
            <Text style={{ color: item === tab ? colors.accent : colors.tabMuted, fontSize: 10 }}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

export function NavigationRow({
  label,
  subtitle,
  selected,
  grouped = false,
  onLongPress,
  onPress,
}: {
  label: string
  subtitle?: string
  selected?: boolean
  grouped?: boolean
  onLongPress?(): void
  onPress(): void
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui } = appearance
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected == null ? undefined : { selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        ui.listRow,
        grouped && styles.groupedRow,
        pressed && styles.pressedRow,
        selected && styles.highlight,
      ]}
    >
      <View style={styles.grow}>
        <Text numberOfLines={2} style={ui.body}>
          {label}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={2} style={ui.muted}>
            {subtitle}
          </Text>
        )}
      </View>
      <Text style={ui.muted}>›</Text>
    </Pressable>
  )
}

export function DeviceList({
  devices,
  active,
  onSelect,
  empty,
}: {
  devices: Device[]
  active?: string
  onSelect(device: Device): void
  empty: string
}) {
  const { ui } = useUi()
  return (
    <FlatList
      data={devices}
      contentContainerStyle={ui.page}
      keyExtractor={(item) => item.deviceId}
      ListHeaderComponent={<Text style={ui.section}>电脑</Text>}
      ListEmptyComponent={<Text style={ui.muted}>{empty}</Text>}
      renderItem={({ item }) => (
        <NavigationRow
          label={item.label}
          subtitle="在线"
          selected={item.deviceId === active}
          onPress={() => onSelect(item)}
        />
      )}
    />
  )
}

export function Profile({
  token,
  status,
  desktopStatus,
  showExisting,
  selectPage,
  exit,
}: {
  token: string
  status: string
  desktopStatus: string
  showExisting(): void
  selectPage(page: AccountPage | '设备管理' | '修改密码'): void
  exit(): void
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui, theme, page, r } = appearance
  const [account, setAccount] = useState<Awaited<ReturnType<typeof me>>>()
  const [nickname, setNickname] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const saving = useRef(false)
  useEffect(() => {
    let current = true
    void me(token)
      .then((user) => {
        if (current) setAccount(user)
      })
      .catch(() => {
        if (current) setError('账号信息加载失败')
      })
    return () => {
      current = false
    }
  }, [reload, token])
  const save = async () => {
    const nextName = nickname.trim()
    if (saving.current || !nextName || nextName.length > nicknameLimit) return
    saving.current = true
    setBusy(true)
    setNicknameError('')
    try {
      await updateNickname(token, nextName)
      setAccount((current) => current && { ...current, nickname: nextName })
      setEditing(false)
    } catch {
      setNicknameError('昵称更新失败，请重试')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const chooseAvatar = async () => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const choice = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: true,
        aspect: [1, 1],
      })
      if (!choice.canceled && choice.assets[0]) {
        const item = choice.assets[0]
        const avatarUrl = await updateAvatar(
          token,
          item.uri,
          item.fileName || 'avatar.jpg',
          item.mimeType || 'image/jpeg',
        )
        setAccount((current) => current && { ...current, avatarUrl })
      }
    } catch {
      setError('头像更新失败')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <ScrollView
      contentContainerStyle={[page('profile'), { gap: r(24) }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[ui.row, ui.card]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更换头像"
          disabled={!account || busy}
          onPress={() => void chooseAvatar()}
          style={[
            styles.avatar,
            {
              backgroundColor: appearance.colors.accent,
              justifyContent: 'center',
              alignItems: 'center',
            },
          ]}
        >
          {account?.avatarUrl ? (
            <Image style={styles.avatar} source={{ uri: account.avatarUrl }} />
          ) : (
            <Text style={{ color: '#fff', fontSize: r(44), fontWeight: '600' }}>
              {Array.from(account?.nickname || account?.account || 'S')[0]}
            </Text>
          )}
        </Pressable>
        <View style={styles.grow}>
          <View style={styles.nicknameRow}>
            <Text numberOfLines={1} style={[ui.section, { flexShrink: 1 }]}>
              {account?.nickname || '未设置昵称'}
            </Text>
            {account && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                hitSlop={10}
                onPress={() => {
                  setNickname(account.nickname)
                  setNicknameError('')
                  setEditing(true)
                }}
                style={({ pressed }) => [styles.editChip, (pressed || busy) && { opacity: 0.6 }]}
              >
                <Text style={styles.editChipText}>编辑</Text>
              </Pressable>
            )}
          </View>
          {account && <Text style={ui.muted}>{maskAccount(account.account)}</Text>}
        </View>
      </View>
      {!!error && (
        <Text style={ui.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      {!account && (
        <Action
          label="刷新个人信息"
          onPress={() => {
            setError('')
            setReload((n) => n + 1)
          }}
        />
      )}
      <View style={ui.card}>
        <Text style={ui.groupTitle}>账号与安全</Text>
        <NavigationRow label="修改密码" onPress={() => selectPage('修改密码')} />
      </View>
      <View style={ui.card}>
        <Text style={[ui.groupTitle, { marginBottom: r(8) }]}>
          外观 · {theme.mode === 'dark' ? '深色' : '浅色'}
        </Text>
        <View style={styles.themeSegment}>
          {(
            [
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ] as const
          ).map(([mode, label]) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: theme.preference === mode }}
              style={[
                styles.themeOption,
                theme.preference === mode && { backgroundColor: appearance.colors.paper },
              ]}
              onPress={() => theme.select(mode)}
            >
              <Text style={theme.preference === mode ? ui.body : ui.muted}>
                {theme.preference === mode ? '✓ ' : ''}
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[ui.muted, { marginTop: r(12) }]}>主题设置保存在本机。</Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.groupTitle}>远程会话</Text>
        <View style={ui.listRow}>
          <View style={styles.grow}>
            <Text style={ui.body}>云端中继</Text>
            <Text style={ui.muted}>通过 Spark 平台连接已登录同一账号的电脑。</Text>
          </View>
        </View>
        <View style={[ui.listRow, styles.groupedRow]}>
          <Text style={[ui.body, styles.grow]}>中继连接</Text>
          <Text style={ui.muted}>{status}</Text>
        </View>
        <View style={[ui.listRow, styles.groupedRow]}>
          <Text style={[ui.body, styles.grow]}>电脑端</Text>
          <Text style={ui.muted}>{desktopStatus}</Text>
        </View>
        <NavigationRow grouped label="设备管理" onPress={() => selectPage('设备管理')} />
      </View>
      <View style={ui.card}>
        <Text style={ui.groupTitle}>会话与设备</Text>
        <NavigationRow label="远程会话" onPress={showExisting} />
        <NavigationRow grouped label="同步中心" onPress={() => selectPage('同步中心')} />
        <NavigationRow
          grouped
          label="设备与登录会话"
          onPress={() => selectPage('设备与登录会话')}
        />
      </View>
      <View style={ui.card}>
        <Text style={ui.groupTitle}>关于</Text>
        <View style={ui.listRow}>
          <Text style={ui.body}>服务端地址</Text>
          <Text numberOfLines={1} style={[ui.muted, { flex: 1, textAlign: 'right' }]}>
            {SERVICE_ORIGIN}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={exit}
        style={({ pressed }) => [
          ui.button,
          {
            backgroundColor: appearance.colors.paper,
            borderColor: appearance.colors.fieldLine,
            borderWidth: StyleSheet.hairlineWidth,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        <Text style={[ui.body, { color: appearance.colors.error }]}>退出登录</Text>
      </Pressable>
      {editing && (
        <NicknameDialog
          value={nickname}
          saving={busy}
          error={nicknameError}
          onChange={(value) => {
            setNickname(value)
            setNicknameError('')
          }}
          onCancel={() => {
            if (!saving.current) setEditing(false)
          }}
          onConfirm={() => void save()}
        />
      )}
    </ScrollView>
  )
}

function createStyles({ colors, ui, r }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    bar: {
      ...ui.row,
      gap: 0,
      minHeight: 49,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.tabPaper === '#FFFFFF' ? '#FFFFFF' : '#000000',
      backgroundColor: colors.tabPaper,
    },
    tab: { flex: 1, minHeight: 49, gap: 2, justifyContent: 'center', alignItems: 'center' },
    groupedRow: {
      borderWidth: 0,
      borderRadius: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      minHeight: 54,
      paddingHorizontal: 0,
    },
    pressedRow: { backgroundColor: colors.tint },
    highlight: { backgroundColor: colors.tint, borderColor: colors.accent },
    grow: { flex: 1 },
    nicknameRow: { flexDirection: 'row', alignItems: 'center', gap: r(12) },
    editChip: {
      borderColor: colors.fieldLine,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 999,
      paddingHorizontal: Math.max(10, r(20)),
      paddingVertical: 3,
    },
    editChipText: { color: colors.muted, fontSize: Math.max(12, r(22)) },
    avatar: { width: r(112), height: r(112), borderRadius: r(56) },
    themeSegment: {
      ...ui.row,
      padding: 3,
      gap: 6,
      backgroundColor: colors.tint,
      borderRadius: 10,
      marginBottom: 8,
    },
    themeOption: {
      flex: 1,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 8,
    },
  })
}
