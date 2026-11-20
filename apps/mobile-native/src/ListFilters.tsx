import Svg, { Path } from 'react-native-svg'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  DEFAULT_SESSION_FILTER,
  SESSION_ACTIVITY_OPTIONS,
  SESSION_LABEL_FILTER_OPTIONS,
  SESSION_STATUS_OPTIONS,
  countSessionFilterFacets,
  type SessionFilterState,
} from '../../mobile/src/utils/session-filters'
import {
  DEFAULT_PROJECT_FILTER,
  PROJECT_STATUS_OPTIONS,
  describeProjectFilter,
  countProjectFilterFacets,
  type ProjectFilterState,
} from '../../mobile/src/utils/project-filters'
import { type ReactNode, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Action, useUi } from './ui'

function FilterSheet({
  title,
  close,
  children,
}: {
  title: string
  close(): void
  children: ReactNode
}) {
  const { ui, colors, r } = useUi()
  return (
    <Modal transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,14,12,0.42)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        <SafeAreaView
          edges={['bottom']}
          style={{
            maxHeight: '78%',
            backgroundColor: colors.background,
            padding: r(24),
            borderTopLeftRadius: r(36),
            borderTopRightRadius: r(36),
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: r(72),
              height: r(8),
              borderRadius: r(4),
              backgroundColor: colors.rail,
            }}
          />
          <View style={ui.header}>
            <View style={{ width: 56 }} />
            <Text style={ui.headerTitle}>{title}</Text>
            <Action compact label="完成" onPress={close} />
          </View>
          <ScrollView contentContainerStyle={{ gap: r(24) }}>{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

function Options<T extends string>({
  label,
  options,
  selected,
  toggle,
}: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  selected: readonly T[]
  toggle(value: T): void
}) {
  const { ui } = useUi()
  return (
    <View>
      <Text style={ui.muted}>{label}</Text>
      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        {options.map((item) => (
          <Action
            key={item.value}
            compact
            label={item.label}
            primary={selected.includes(item.value)}
            onPress={() => toggle(item.value)}
          />
        ))}
      </View>
    </View>
  )
}

function toggleValue<T>(values: readonly T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function SessionFilters({
  filter,
  change,
}: {
  filter: SessionFilterState
  change(filter: SessionFilterState): void
}) {
  const [open, setOpen] = useState(false)
  const facets = countSessionFilterFacets(filter)
  return (
    <View>
      <Action
        compact
        label={facets ? `筛选中 · ${facets}` : '筛选会话'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <FilterSheet title="筛选会话" close={() => setOpen(false)}>
          <Options
            label="状态"
            options={SESSION_STATUS_OPTIONS}
            selected={filter.statuses}
            toggle={(value) => change({ ...filter, statuses: toggleValue(filter.statuses, value) })}
          />
          <Options
            label="标记"
            options={SESSION_LABEL_FILTER_OPTIONS}
            selected={filter.labels}
            toggle={(value) => change({ ...filter, labels: toggleValue(filter.labels, value) })}
          />
          <Options
            label="最近活动"
            options={SESSION_ACTIVITY_OPTIONS}
            selected={[filter.activity]}
            toggle={(activity) => change({ ...filter, activity })}
          />
          <Action
            label="只看置顶"
            primary={filter.pinnedOnly}
            onPress={() => change({ ...filter, pinnedOnly: !filter.pinnedOnly })}
          />
          <Action
            label="清除筛选"
            disabled={!facets}
            onPress={() => change(DEFAULT_SESSION_FILTER)}
          />
        </FilterSheet>
      )}
    </View>
  )
}

export function ProjectFilters({
  filter,
  change,
}: {
  filter: ProjectFilterState
  change(filter: ProjectFilterState): void
}) {
  const [open, setOpen] = useState(false)
  const { colors, r, theme, ui } = useUi()
  const dark = theme.mode === 'dark'
  const active = countProjectFilterFacets(filter) > 0
  const label = describeProjectFilter(filter)
  return (
    <View style={{ maxWidth: '62%' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          ui.row,
          {
            gap: r(8),
            paddingHorizontal: r(20),
            paddingVertical: r(10),
            borderRadius: 999,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: active ? colors.accent : colors.fieldLine,
            backgroundColor: pressed
              ? colors.tint
              : active
                ? dark
                  ? '#1e2b3d'
                  : '#eef4fe'
                : colors.paper,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: r(24),
            lineHeight: r(32),
            color: active ? colors.accent : dark ? '#e8e6e1' : '#4b4944',
            fontWeight: active ? '600' : '400',
          }}
        >
          {label}
        </Text>
        <Svg width={r(40)} height={r(40)} viewBox="0 0 24 24" accessible={false}>
          <Path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke={colors.placeholder}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      {open && (
        <FilterSheet title="筛选项目" close={() => setOpen(false)}>
          <Options
            label="状态"
            options={PROJECT_STATUS_OPTIONS}
            selected={[filter.status]}
            toggle={(status) => change({ ...filter, status })}
          />
          <Options
            label="最近活动"
            options={SESSION_ACTIVITY_OPTIONS}
            selected={[filter.activity]}
            toggle={(activity) => change({ ...filter, activity })}
          />
          <Action label="清除筛选" onPress={() => change(DEFAULT_PROJECT_FILTER)} />
        </FilterSheet>
      )}
    </View>
  )
}
