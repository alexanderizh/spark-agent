import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { formatRelativeTime } from '../../mobile/src/utils/format'
import type { SessionFilterState } from '../../mobile/src/utils/session-filters'
import { getSessionLabelMeta } from '../../mobile/src/utils/sidebar-order'
import { SessionFilters } from './ListFilters'
import { ProjectSessionIcon } from './ProjectSessionView'
import type { Session } from './relay'
import { useUi } from './ui'

export function AllSessionsHeading({
  device,
  online,
  back,
  manage,
}: {
  device: string
  online: boolean
  back(): void
  manage(): void
}) {
  const { colors, r } = useUi()
  return (
    <View style={{ paddingHorizontal: r(32), paddingTop: r(18), paddingBottom: r(20) }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: r(16), marginBottom: r(24) }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: r(56),
              lineHeight: r(76),
              fontWeight: '700',
              letterSpacing: r(0.5),
            }}
            accessibilityRole="header"
          >
            全部会话
          </Text>
          <Text
            style={{
              color: colors.placeholder,
              fontSize: r(24),
              lineHeight: r(36),
              marginTop: r(8),
            }}
          >
            跨项目看这台电脑的会话
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={manage} hitSlop={8}>
          <Text style={{ color: colors.accent, fontSize: r(23), lineHeight: r(34) }}>设备管理</Text>
        </Pressable>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: r(14),
          minHeight: r(72),
          paddingHorizontal: r(20),
          paddingVertical: r(12),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line,
          borderRadius: r(16),
          backgroundColor: colors.paper,
        }}
      >
        <View
          accessibilityLabel={online ? '在线' : '离线'}
          style={{
            width: r(14),
            height: r(14),
            borderRadius: r(7),
            backgroundColor: online ? '#22c55e' : colors.rail,
          }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: r(25), lineHeight: r(34), fontWeight: '600' }}
          >
            {device}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回项目"
          onPress={back}
          hitSlop={8}
        >
          <Text style={{ color: colors.accent, fontSize: r(22), lineHeight: r(32) }}>
            返回项目 ›
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

export function AllSessionsControls({
  search,
  setSearch,
  filter,
  setFilter,
  count,
}: {
  search: string
  setSearch(value: string): void
  filter: SessionFilterState
  setFilter(value: SessionFilterState): void
  count: number
}) {
  const { colors, r } = useUi()
  return (
    <View style={{ backgroundColor: colors.background, paddingTop: r(10), paddingBottom: r(12) }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: r(12),
          marginHorizontal: r(32),
          marginBottom: r(14),
          paddingHorizontal: r(24),
          minHeight: r(72),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line,
          borderRadius: 999,
          backgroundColor: colors.paper,
        }}
      >
        <ProjectSessionIcon name="search" size={28} color={colors.placeholder} />
        <TextInput
          accessibilityLabel="搜索会话标题或内容"
          placeholder="搜索会话标题或内容"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: r(60),
            paddingVertical: 0,
            color: colors.text,
            fontSize: r(27),
          }}
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginHorizontal: r(32),
        }}
      >
        <SessionFilters filter={filter} change={setFilter} />
        <Text style={{ color: colors.placeholder, fontSize: r(22), lineHeight: r(32) }}>
          {count} 条
        </Text>
      </View>
    </View>
  )
}

export function AllSessionRow({
  row,
  projectName,
  open,
  menu,
}: {
  row: Session
  projectName?: string
  open(): void
  menu?(): void
}) {
  const { colors, r, ui, theme } = useUi()
  const label = getSessionLabelMeta(row.sessionLabel)
  const labelColors =
    label &&
    {
      suspended: ['#b45309', '#fef3c7'],
      'not-started': ['#2563eb', '#eef4fe'],
      'pending-review': ['#7c3aed', '#ede9fe'],
      'pending-advance': ['#0e7490', '#cffafe'],
      undelivered: ['#be123c', '#ffe4e6'],
    }[label.key]
  const status =
    row.status === 'running'
      ? '进行中'
      : row.status === 'error'
        ? '异常'
        : row.status === 'completed'
          ? '已完成'
          : row.status === 'cancelled'
            ? '已取消'
            : '空闲'
  const dot =
    row.status === 'running'
      ? colors.accent
      : row.status === 'error'
        ? '#ef4444'
        : row.status === 'completed'
          ? '#22c55e'
          : row.status === 'cancelled'
            ? '#d97706'
            : colors.rail
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title || '未命名会话'}
      onPress={open}
      onLongPress={menu}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: r(96),
        gap: r(16),
        marginHorizontal: r(32),
        paddingVertical: r(14),
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.tint : colors.background,
      })}
    >
      <View style={{ width: r(14), height: r(14), borderRadius: r(7), backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0, gap: r(6) }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.text, fontSize: r(28), lineHeight: r(38), fontWeight: '500' }}
        >
          {row.title || '未命名会话'}
        </Text>
        <View style={[ui.row, { gap: r(10), minWidth: 0 }]}>
          {!!projectName && (
            <Text
              numberOfLines={1}
              style={{
                maxWidth: r(210),
                flexShrink: 1,
                paddingHorizontal: r(12),
                borderRadius: r(8),
                overflow: 'hidden',
                color: colors.muted,
                backgroundColor: colors.tint,
                fontSize: r(20),
                lineHeight: r(28),
              }}
            >
              {projectName}
            </Text>
          )}
          <Text
            numberOfLines={1}
            style={{ color: colors.placeholder, fontSize: r(20), lineHeight: r(28) }}
          >
            {status}
          </Text>
          {label && labelColors && (
            <Text
              style={{
                color: theme.mode === 'dark' ? colors.text : labelColors[0],
                backgroundColor: theme.mode === 'dark' ? colors.tint : labelColors[1],
                paddingHorizontal: r(10),
                borderRadius: r(8),
                fontSize: r(20),
                lineHeight: r(28),
              }}
            >
              {label.label}
            </Text>
          )}
        </View>
      </View>
      <Text style={{ flexShrink: 0, color: colors.muted, fontSize: r(21), lineHeight: r(30) }}>
        {row.updatedAt ? formatRelativeTime(row.updatedAt) : ''}
      </Text>
    </Pressable>
  )
}
