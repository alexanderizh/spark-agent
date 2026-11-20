import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { formatRelativeTime } from '../../mobile/src/utils/format'
import {
  SESSION_ACTIVITY_OPTIONS,
  startOfToday,
  type SessionFilterState,
} from '../../mobile/src/utils/session-filters'
import { getSessionLabelMeta, SESSION_LABELS } from '../../mobile/src/utils/sidebar-order'
import type { Session } from './relay'
import { Action, useUi } from './ui'

const paths = {
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-4-4',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  down: 'M6 9l6 6 6-6',
  up: 'M12 20V4m-7 7 7-7 7 7',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM12 8v4m0 3h.01',
}

export function ProjectSessionIcon({
  name,
  color,
  size = 30,
}: {
  name: keyof typeof paths
  color?: string
  size?: number
}) {
  const { colors, r } = useUi()
  return (
    <Svg accessible={false} width={r(size)} height={r(size)} viewBox="0 0 24 24">
      <Path
        d={paths[name]}
        fill="none"
        stroke={color ?? colors.text}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function ProjectSessionHeading({
  title,
  device,
  online,
  back,
  manage,
}: {
  title: string
  device: string
  online: boolean
  back(): void
  manage(): void
}) {
  const { ui, colors, r, theme } = useUi()
  return (
    <View style={{ paddingHorizontal: r(32), paddingTop: r(16), paddingBottom: r(8) }}>
      <View style={[ui.row, { marginBottom: r(8) }]}>
        <Text style={[ui.title, { flex: 1 }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={manage}
          style={{
            backgroundColor: theme.mode === 'dark' ? '#1e2b3d' : '#eef4fe',
            borderRadius: 999,
            paddingVertical: r(8),
            paddingHorizontal: r(20),
          }}
        >
          <Text style={{ fontSize: r(24), color: colors.accent }}>设备管理</Text>
        </Pressable>
      </View>
      <View
        style={[
          ui.row,
          {
            gap: r(12),
            minHeight: r(76),
            paddingHorizontal: r(16),
            backgroundColor: colors.paper,
            borderColor: colors.line,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: r(12),
          },
        ]}
      >
        <View
          accessibilityLabel={online ? '在线' : '离线'}
          style={{
            width: r(14),
            height: r(14),
            borderRadius: r(7),
            backgroundColor: online ? '#22c55e' : '#d97706',
          }}
        />
        <Text style={{ fontSize: r(22), color: colors.placeholder }}>电脑</Text>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: colors.text, fontSize: r(25), fontWeight: '500' }}
        >
          {device}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回项目"
          onPress={back}
          style={{ paddingVertical: r(12) }}
        >
          <Text style={{ fontSize: r(22), color: colors.accent }}>返回项目 ›</Text>
        </Pressable>
      </View>
    </View>
  )
}

const labelOptions = [
  { value: '', label: '全部标记' },
  { value: 'labeled', label: '已标记' },
  { value: 'unlabeled', label: '未标记' },
  ...SESSION_LABELS.map(({ key, label }) => ({ value: key, label })),
] as const
export type ProjectLabelFilter = (typeof labelOptions)[number]['value']

export function ProjectSessionControls({
  search,
  setSearch,
  filter,
  setFilter,
  label,
  setLabel,
  searchFailed,
}: {
  search: string
  setSearch(value: string): void
  filter: SessionFilterState
  setFilter(value: SessionFilterState): void
  label: ProjectLabelFilter
  setLabel(value: ProjectLabelFilter): void
  searchFailed: boolean
}) {
  const { colors, r, theme, ui } = useUi()
  const [panel, setPanel] = useState<'label' | 'time'>()
  const dark = theme.mode === 'dark'
  const chip = (text: string, selected: boolean, onPress: () => void, accent = false) => (
    <Pressable
      key={text}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected
          ? accent
            ? dark
              ? '#422c1b'
              : '#fdf3e3'
            : colors.text
          : colors.tint,
        borderRadius: 999,
        paddingHorizontal: r(26),
        paddingVertical: r(10),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: selected
            ? accent
              ? dark
                ? '#fbbf79'
                : '#b45309'
              : colors.onAction
            : colors.muted,
          fontSize: r(24),
          lineHeight: r(38),
          fontWeight: selected ? '500' : '400',
        }}
      >
        {text}
      </Text>
    </Pressable>
  )
  const close = () => setPanel(undefined)
  const option = (value: string, text: string, selected: boolean, select: () => void) => (
    <Pressable
      key={value}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        select()
        close()
      }}
      style={[ui.row, { minHeight: 44, paddingHorizontal: r(20), justifyContent: 'space-between' }]}
    >
      <Text style={ui.body}>{text}</Text>
      {selected && <Text style={ui.actionText}>✓</Text>}
    </Pressable>
  )
  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingHorizontal: r(32),
        paddingTop: r(16),
        paddingBottom: r(8),
        gap: r(16),
      }}
    >
      <View style={[ui.row, { gap: r(12), flexWrap: 'wrap' }]}>
        {chip('全部', filter.statuses.length === 0, () => setFilter({ ...filter, statuses: [] }))}
        {chip('进行中', filter.statuses[0] === 'running', () =>
          setFilter({ ...filter, statuses: ['running'] }),
        )}
        {chip('异常', filter.statuses[0] === 'error', () =>
          setFilter({ ...filter, statuses: ['error'] }),
        )}
        {chip(
          label ? (labelOptions.find(({ value }) => value === label)?.label ?? '标记') : '标记',
          !!label,
          () => setPanel('label'),
          true,
        )}
        {chip(
          filter.activity === 'all'
            ? '时间'
            : (SESSION_ACTIVITY_OPTIONS.find(({ value }) => value === filter.activity)?.label ??
                '时间'),
          filter.activity !== 'all',
          () => setPanel('time'),
          true,
        )}
      </View>
      <View
        style={[
          ui.row,
          {
            gap: r(12),
            backgroundColor: colors.paper,
            borderColor: colors.line,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 999,
            paddingHorizontal: r(24),
            minHeight: r(72),
          },
        ]}
      >
        <ProjectSessionIcon name="search" />
        <TextInput
          accessibilityLabel="搜索会话"
          placeholder="搜索会话"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: r(64),
            paddingVertical: 0,
            color: colors.text,
            fontSize: r(28),
          }}
        />
      </View>
      {searchFailed && <Text style={ui.muted}>仅搜索已加载的会话标题</Text>}
      {!!panel && (
        <Modal transparent animationType="slide" onRequestClose={close}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
            <Pressable accessible={false} onPress={close} style={StyleSheet.absoluteFill} />
            <SafeAreaView
              edges={['bottom']}
              style={{
                maxHeight: '78%',
                backgroundColor: colors.paper,
                padding: r(24),
                borderTopLeftRadius: r(36),
                borderTopRightRadius: r(36),
              }}
            >
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.section}>{panel === 'label' ? '按标记筛选' : '按时间筛选'}</Text>
                <Action label="完成" compact onPress={close} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {panel === 'label'
                  ? labelOptions.map(({ value, label: text }) =>
                      option(value, text, value === label, () => setLabel(value)),
                    )
                  : SESSION_ACTIVITY_OPTIONS.map(({ value, label: text }) =>
                      option(value, text, value === filter.activity, () =>
                        setFilter({ ...filter, activity: value }),
                      ),
                    )}
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  )
}

const groupTitles = ['置顶', '进行中', '今天', '昨天', '7 天内', '更早', '内容匹配'] as const
export function projectSessionGroups(pinned: Session[], normal: Session[], matches: Session[]) {
  const today = startOfToday()
  const buckets = [pinned, [], [], [], [], [], matches] as Session[][]
  for (const row of normal) {
    const time = Date.parse(row.updatedAt ?? '')
    const index =
      row.status === 'running'
        ? 1
        : time >= today
          ? 2
          : time >= today - 86_400_000
            ? 3
            : time >= today - 7 * 86_400_000
              ? 4
              : 5
    buckets[index].push(row)
  }
  return buckets.flatMap((rows, index) =>
    rows.length ? [{ key: index, title: groupTitles[index], rows }] : [],
  )
}

export function ProjectSessionRow({
  row,
  separator,
  match,
  snippet,
  open,
  menu,
}: {
  row: Session
  separator: boolean
  match: boolean
  snippet?: string
  open(): void
  menu?(): void
}) {
  const { colors, r, ui, theme } = useUi()
  const label = getSessionLabelMeta(row.sessionLabel)
  const dotColor =
    row.status === 'running' ? colors.accent : row.status === 'error' ? '#ef4444' : colors.rail
  const status =
    row.status === 'running' ? '进行中' : row.status === 'error' ? '异常' : row.status ? '空闲' : ''
  const tag = label
    ? {
        suspended: ['#b45309', '#fef3c7'],
        'not-started': ['#6b7280', '#f3f4f6'],
        'pending-review': ['#7c3aed', '#ede9fe'],
        'pending-advance': ['#0e7490', '#cffafe'],
        undelivered: ['#e11d48', '#ffe4e6'],
      }[label.key]
    : undefined
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title || '未命名会话'}
      onPress={open}
      onLongPress={menu}
      style={({ pressed }) => [
        ui.listRow,
        {
          marginHorizontal: r(32),
          gap: r(20),
          borderTopWidth: separator ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.tint : colors.background,
        },
      ]}
    >
      {match ? (
        <ProjectSessionIcon name="search" size={24} color={colors.faint} />
      ) : (
        <View
          style={{ width: r(12), height: r(12), borderRadius: r(6), backgroundColor: dotColor }}
        />
      )}
      <View style={{ flex: 1, minWidth: 0, gap: r(8) }}>
        <View style={[ui.row, { gap: r(12) }]}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: colors.text,
              fontSize: r(30),
              lineHeight: r(42),
              fontWeight: '600',
            }}
          >
            {row.title || '未命名会话'}
          </Text>
          {label && tag && (
            <Text
              style={{
                fontSize: r(20),
                paddingHorizontal: r(12),
                borderRadius: 999,
                overflow: 'hidden',
                color: theme.mode === 'dark' ? colors.text : tag[0],
                backgroundColor: theme.mode === 'dark' ? colors.tint : tag[1],
              }}
            >
              {label.label}
            </Text>
          )}
        </View>
        {!!snippet && (
          <Text
            numberOfLines={2}
            style={{ color: colors.muted, fontSize: r(24), lineHeight: r(34) }}
          >
            {snippet}
          </Text>
        )}
        <Text
          numberOfLines={1}
          style={{ color: colors.placeholder, fontSize: r(22), lineHeight: r(32) }}
        >
          {[
            status,
            row.updatedAt && formatRelativeTime(row.updatedAt),
            match ? undefined : row.preview,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <ProjectSessionIcon name="right" size={36} color={colors.faint} />
    </Pressable>
  )
}
