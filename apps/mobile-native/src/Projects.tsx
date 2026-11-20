import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { formatRelativeTime } from '../../mobile/src/utils/format'
import { DEFAULT_PROJECT_FILTER, matchProject } from '../../mobile/src/utils/project-filters'
import {
  NO_PROJECT_WORKSPACE_NAME,
  sortByManualOrderWithinPinnedSections,
} from '../../mobile/src/utils/sidebar-order'
import { ProjectFilters } from './ListFilters'
import type { Project, Relay } from './relay'
import { moveRowActions, RowMenu, type RowAction } from './RowMenu'
import { Action, useUi } from './ui'

export function Projects({
  relay,
  deviceId,
  deviceLabel,
  online,
  connection,
  select,
  showAll,
  changeDevice,
  backToComputers,
  manage,
  create,
}: {
  relay: Relay
  deviceId: string
  deviceLabel: string
  online: boolean
  connection: number
  select(project: Project): void
  showAll(): void
  changeDevice(): void
  backToComputers(): void
  manage(): void
  create(project: Project): void
}) {
  const appearance = useUi()
  const styles = projectStyles(appearance)
  const { ui, colors } = appearance
  const [items, setItems] = useState<Project[]>()
  const [unassigned, setUnassigned] = useState<Project>()
  const [issue, setIssue] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [menu, setMenu] = useState<Project>()
  const [filter, setFilter] = useState(DEFAULT_PROJECT_FILTER)
  const [search, setSearch] = useState('')
  const keyword = search.trim().toLocaleLowerCase()
  const [order, setOrder] = useState<string[]>()
  const [complete, setComplete] = useState(false)
  const ordered = sortByManualOrderWithinPinnedSections(
    items ?? [],
    order,
    (row) => row.id,
    (row) => !!row.pinnedAt,
  )
  const visible = ordered.filter(
    (item) => item.name.toLocaleLowerCase().includes(keyword) && matchProject(item, filter),
  )
  const actions: RowAction[] = []
  if (menu) {
    actions.push({
      label: menu.pinnedAt ? '取消置顶' : '置顶',
      run: () => relay.updateProject(deviceId, menu.id, { pinned: !menu.pinnedAt }),
    })
    if (order && complete) {
      const pinned = !!menu.pinnedAt
      const section = ordered.filter((row) => !!row.pinnedAt === pinned).map((row) => row.id)
      const shown = visible.filter((row) => !!row.pinnedAt === pinned).map((row) => row.id)
      const other = ordered.filter((row) => !!row.pinnedAt !== pinned).map((row) => row.id)
      actions.push(
        ...moveRowActions(menu.id, section, shown, (moved) =>
          relay.saveSidebarOrder(deviceId, {
            scope: 'projects',
            itemIds: pinned ? [...moved, ...other] : [...other, ...moved],
          }),
        ),
      )
    }
    if (menu.name !== NO_PROJECT_WORKSPACE_NAME) {
      actions.push(
        {
          label: '重命名',
          prompt: { initial: menu.name },
          run: (name) => relay.updateProject(deviceId, menu.id, { name }),
        },
        {
          label: '归档',
          prompt: { confirmation: '项目和会话将保留，可以在桌面端恢复。' },
          run: () => relay.updateProject(deviceId, menu.id, { archived: true }),
        },
        {
          label: '删除项目',
          prompt: {
            confirmation: `「${menu.name}」及其 ${menu.sessionCount} 条会话将被删除，且不可恢复。`,
          },
          run: async () => {
            if (!(await relay.deleteProject(deviceId, menu.id))) throw new Error('项目删除未确认')
          },
        },
      )
    }
  }
  useEffect(() => {
    if (!online) return
    let active = true
    setIssue('')
    setComplete(false)
    void Promise.all([
      relay.projectList(deviceId),
      relay.unassignedSessionCount(deviceId),
      relay.readSidebarOrder(deviceId).catch(() => undefined),
    ])
      .then(([list, unassignedCount, sidebar]) => {
        if (!active) return
        setItems(list.projects)
        setUnassigned(
          unassignedCount > 0
            ? {
                id: 'default',
                name: '未归属项目',
                sessionCount: unassignedCount,
                runningSessionCount: list.unassignedRunningSessionCount,
              }
            : undefined,
        )
        setOrder(sidebar?.projectIds)
        setComplete(list.complete)
      })
      .catch(() => {
        if (active) setIssue('加载项目失败')
      })
    return () => {
      active = false
    }
  }, [connection, deviceId, online, refresh, relay])
  const ready = online && !!items && !issue
  const pinned = visible.filter((item) => item.pinnedAt)
  const normal = visible.filter((item) => !item.pinnedAt)
  const virtual =
    unassigned && matchProject(unassigned, filter) && unassigned.name.includes(keyword)
      ? unassigned
      : undefined
  const row = (item: Project) => (
    <ProjectRow
      key={item.id}
      project={item}
      open={() => select(item)}
      add={() => create(item)}
      longPress={item.id === 'default' ? undefined : () => setMenu(item)}
    />
  )
  return (
    <View style={ui.screen}>
      <ScrollView stickyHeaderIndices={ready ? [1] : undefined} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <View style={styles.headingLine}>
            <View style={styles.grow}>
              <Text accessibilityRole="header" style={ui.title}>
                项目
              </Text>
              <Text style={styles.subtitle}>先选电脑，再浏览它自己的项目</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={manage} hitSlop={8}>
              <Text style={styles.deviceLink}>设备管理</Text>
            </Pressable>
          </View>
          <View style={styles.deviceCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="切换电脑"
              onPress={changeDevice}
              style={styles.deviceMain}
            >
              <View style={[styles.deviceDot, online && { backgroundColor: '#22c55e' }]} />
              <View style={styles.grow}>
                <View style={styles.deviceNameLine}>
                  <Text numberOfLines={1} style={styles.deviceName}>
                    {deviceLabel}
                  </Text>
                  <ProjectIcon name="down" />
                </View>
                <Text style={styles.deviceHint}>
                  {online ? '当前电脑 · 点此切换' : '当前电脑离线 · 点此切换'}
                </Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={backToComputers} hitSlop={6}>
              <Text style={styles.deviceLink}>返回电脑列表</Text>
            </Pressable>
          </View>
        </View>
        {ready && (
          <View style={styles.sticky}>
            <View style={styles.search}>
              <ProjectIcon name="search" size={32} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                accessibilityLabel="搜索项目"
                placeholder="搜索项目"
                placeholderTextColor={colors.placeholder}
                returnKeyType="search"
              />
            </View>
            <View style={styles.toolbar}>
              <ProjectFilters filter={filter} change={setFilter} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="全部会话"
                onPress={showAll}
                hitSlop={6}
                style={styles.allLink}
              >
                <Text style={styles.linkText}>全部会话</Text>
                <ProjectIcon name="chevron" />
              </Pressable>
            </View>
          </View>
        )}
        <View style={styles.list}>
          {ready ? (
            <>
              {pinned.length > 0 && <Text style={styles.section}>置顶</Text>}
              {pinned.map(row)}
              {(normal.length > 0 || !!virtual) && <Text style={styles.section}>项目</Text>}
              {normal.map(row)}
              {virtual && row(virtual)}
              {!pinned.length && !normal.length && !virtual && (
                <Text style={styles.empty}>
                  {items.length || unassigned ? '没有匹配的项目' : '这台电脑还没有项目'}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.empty}>
              {!online ? '这台电脑当前离线' : issue || '正在加载这台电脑的项目…'}
            </Text>
          )}
          {!online && <Action label="返回电脑列表" onPress={backToComputers} />}
          {online && !!issue && <Action label="重试" onPress={() => setRefresh((n) => n + 1)} />}
        </View>
      </ScrollView>
      {menu && (
        <RowMenu
          title={menu.name}
          actions={actions}
          online={online}
          close={() => setMenu(undefined)}
          refresh={() => setRefresh((n) => n + 1)}
        />
      )}
    </View>
  )
}

const iconPaths = {
  folder:
    'M4 20h16a1 1 0 001-1V8a1 1 0 00-1-1h-7.6L10 4.8A1 1 0 009.2 4.4H4a1 1 0 00-1 1V19a1 1 0 001 1z',
  chat: 'M21 12a8 8 0 01-8 8H4l2.3-2.9A8 8 0 1121 12z',
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-3.5-3.5',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  pin: 'M14.5 3l6.5 6.5-2.2.6-3.6 3.6.3 3.9-1.8 1.8-3.5-3.5L5 21l-2-2 5.1-5.2-3.5-3.5L6.4 8.5l3.9.3L13.9 5.2z',
}

function ProjectIcon({ name, size = 40 }: { name: keyof typeof iconPaths; size?: number }) {
  const { colors, r, theme } = useUi()
  const stroke = {
    folder: colors.placeholder,
    down: colors.placeholder,
    chevron: colors.faint,
    search: colors.text,
    plus: colors.text,
    chat: theme.mode === 'dark' ? '#fb923c' : '#e8590c',
    pin: 'none',
  }[name]
  return (
    <Svg width={r(size)} height={r(size)} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={iconPaths[name]}
        fill={name === 'pin' ? '#d97706' : 'none'}
        stroke={stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

function ProjectRow({
  project,
  open,
  add,
  longPress,
}: {
  project: Project
  open(): void
  add(): void
  longPress?(): void
}) {
  const appearance = useUi()
  const { colors, r } = appearance
  const styles = projectStyles(appearance)
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={project.name}
        onPress={open}
        onLongPress={longPress}
        style={({ pressed }) => [styles.rowContent, pressed && styles.pressed]}
      >
        <ProjectIcon name={project.id === 'default' ? 'chat' : 'folder'} />
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
          <View style={styles.meta}>
            <Text style={styles.caption}>{project.sessionCount} 条会话</Text>
            {!!project.runningSessionCount && (
              <View style={styles.running}>
                <View
                  style={{
                    width: r(10),
                    height: r(10),
                    borderRadius: r(5),
                    backgroundColor: colors.accent,
                  }}
                />
                <Text style={{ color: colors.accent, fontSize: r(21) }}>运行中</Text>
              </View>
            )}
            {!!project.updatedAt && (
              <Text
                numberOfLines={1}
                style={[styles.caption, { flexShrink: 1, color: colors.faint }]}
              >
                {formatRelativeTime(project.updatedAt)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.pin}>{!!project.pinnedAt && <ProjectIcon name="pin" />}</View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`在${project.name}新建会话`}
        onPress={add}
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      >
        <ProjectIcon name="plus" size={32} />
      </Pressable>
      <Pressable accessible={false} onPress={open} style={styles.chevron}>
        <ProjectIcon name="chevron" />
      </Pressable>
    </View>
  )
}

function projectStyles({ colors, r, theme }: ReturnType<typeof useUi>) {
  const dark = theme.mode === 'dark'
  const border = dark ? '#353431' : '#ececec'
  const muted = dark ? '#98958f' : '#8a8782'
  const horizontal = { flexDirection: 'row', alignItems: 'center' } as const
  return StyleSheet.create({
    heading: { paddingHorizontal: r(32), paddingTop: r(18), gap: r(24), paddingBottom: r(24) },
    headingLine: { ...horizontal, alignItems: 'flex-end', gap: r(16) },
    subtitle: { marginTop: r(10), color: muted, fontSize: r(24) },
    deviceLink: { color: colors.accent, fontSize: r(23) },
    deviceCard: {
      ...horizontal,
      gap: r(14),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: dark ? '#3b3935' : '#e9e7e4',
      borderRadius: r(18),
      backgroundColor: colors.paper,
      paddingHorizontal: r(20),
      paddingVertical: r(18),
    },
    deviceMain: { ...horizontal, flex: 1, gap: r(14), minWidth: 0 },
    deviceNameLine: { ...horizontal, gap: r(8) },
    deviceName: { color: colors.text, fontSize: r(26), fontWeight: '600', flexShrink: 1 },
    deviceDot: {
      width: r(16),
      height: r(16),
      borderRadius: r(8),
      backgroundColor: dark ? '#484641' : '#d4d1cc',
    },
    deviceHint: { color: muted, fontSize: r(21), marginTop: r(6) },
    sticky: {
      paddingTop: r(8),
      paddingHorizontal: r(32),
      paddingBottom: r(16),
      backgroundColor: colors.background,
    },
    search: {
      ...horizontal,
      gap: r(12),
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      backgroundColor: colors.paper,
      paddingHorizontal: r(24),
      minHeight: r(70),
      marginBottom: r(20),
    },
    searchInput: { flex: 1, color: colors.text, padding: 0, fontSize: r(28), minHeight: r(64) },
    toolbar: { ...horizontal, justifyContent: 'space-between', gap: r(16) },
    allLink: { ...horizontal, gap: r(4), paddingVertical: r(10), paddingLeft: r(12) },
    linkText: { color: colors.accent, fontSize: r(24) },
    list: { paddingTop: r(12), paddingHorizontal: r(32), paddingBottom: r(48) },
    section: {
      color: colors.placeholder,
      fontSize: r(26),
      fontWeight: '500',
      letterSpacing: r(0.5),
      marginVertical: r(10),
    },
    row: {
      ...horizontal,
      minHeight: r(104),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    rowContent: { ...horizontal, flex: 1, alignSelf: 'stretch', gap: r(18), paddingRight: r(18) },
    pressed: { backgroundColor: dark ? '#2c2b29' : '#f2f1ef' },
    grow: { flex: 1, minWidth: 0 },
    projectName: { color: colors.text, fontSize: r(29), fontWeight: '500', lineHeight: r(40) },
    meta: { ...horizontal, gap: r(12), marginTop: r(4) },
    caption: { color: colors.placeholder, fontSize: r(22), lineHeight: r(32) },
    running: {
      ...horizontal,
      gap: r(6),
      paddingHorizontal: r(12),
      paddingVertical: r(2),
      borderRadius: 999,
      backgroundColor: '#3b82f61f',
    },
    pin: { width: r(40), alignItems: 'center' },
    add: {
      width: r(56),
      alignSelf: 'stretch',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: r(8),
    },
    chevron: { alignSelf: 'stretch', justifyContent: 'center', paddingLeft: r(18) },
    empty: { textAlign: 'center', color: muted, padding: r(40), fontSize: r(26) },
  })
}
