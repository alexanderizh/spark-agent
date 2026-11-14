#!/usr/bin/env node
/**
 * 设备备注名 + 会话/项目筛选回归冒烟（需先 build）。
 *
 * 这三个工具模块都是纯函数，页面只是消费方，因此口径全部在这里固化：
 *   1. 备注名只存本机、trim 后按**字符**截断、空串 = 恢复原名、脏数据整条忽略
 *   2. 会话筛选：状态/标记/项目多选 OR，时间是 AND，「今天」按自然日 00:00 起算
 *   3. 项目筛选：时间看 updatedAt（虚拟项目空串 → 时间维度开启时不命中），状态按会话数派生
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// 只用到同步 storage API，给最小 mock
const store = new Map()
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/spark-mobile-smoke' },
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: (key) => store.delete(key),
}

const aliases = require(join(root, 'dist/utils/device-aliases.js'))
const sessionFilters = require(join(root, 'dist/utils/session-filters.js'))
const projectFilters = require(join(root, 'dist/utils/project-filters.js'))
const { StorageKeys } = require(join(root, 'dist/utils/storage.js'))

const results = []
function check(name, fn) {
  fn()
  results.push(name)
  console.log(`✅ ${name}`)
}

const DAY = 86_400_000
const now = Date.now()
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString()
const daysAgo = (d) => new Date(now - d * DAY).toISOString()

const session = (over = {}) => ({
  id: 's1',
  title: '会话',
  status: 'idle',
  updatedAt: hoursAgo(1),
  preview: '',
  ...over,
})

const project = (over = {}) => ({
  id: 'p1',
  name: '项目',
  rootPath: '/tmp/p1',
  projectKind: 'normal',
  pinnedAt: null,
  updatedAt: hoursAgo(2),
  sessionCount: 3,
  runningSessionCount: 0,
  ...over,
})

// ─── 1. 设备备注名 ─────────────────────────────────────────────────────────
check('normalizeDeviceAlias: trim + 空串 → null', () => {
  assert.equal(aliases.normalizeDeviceAlias('  我的 Mac  '), '我的 Mac')
  assert.equal(aliases.normalizeDeviceAlias('   '), null)
  assert.equal(aliases.normalizeDeviceAlias(''), null)
  assert.equal(aliases.normalizeDeviceAlias(null), null)
  assert.equal(aliases.normalizeDeviceAlias(undefined), null)
})

check('normalizeDeviceAlias: 按码点截断，不切半个 emoji', () => {
  const long = '机'.repeat(aliases.DEVICE_ALIAS_MAX_LENGTH + 5)
  assert.equal(
    Array.from(aliases.normalizeDeviceAlias(long)).length,
    aliases.DEVICE_ALIAS_MAX_LENGTH,
  )
  const emoji = '🖥'.repeat(aliases.DEVICE_ALIAS_MAX_LENGTH)
  const cut = aliases.normalizeDeviceAlias(emoji)
  assert.equal(Array.from(cut).length, aliases.DEVICE_ALIAS_MAX_LENGTH)
  // 截断后不能出现孤立代理项
  assert.equal(cut, '🖥'.repeat(aliases.DEVICE_ALIAS_MAX_LENGTH))
})

check('readDeviceAliases: 脏数据整条忽略，不抛错', () => {
  store.clear()
  assert.deepEqual(aliases.readDeviceAliases(), {})
  // wx.getStorageSync 对不存在的键返回 ''，必须当空表处理
  store.set(StorageKeys.deviceAliases, '')
  assert.deepEqual(aliases.readDeviceAliases(), {})
  store.set(StorageKeys.deviceAliases, [1, 2, 3])
  assert.deepEqual(aliases.readDeviceAliases(), {})
  store.set(StorageKeys.deviceAliases, { a: 42, b: '  ', c: ' 有效 ', d: null })
  assert.deepEqual(aliases.readDeviceAliases(), { c: '有效' })
})

check('writeDeviceAlias: 写入 / 覆盖 / 留空清除', () => {
  store.clear()
  aliases.writeDeviceAlias('dev-a', '办公室主机')
  assert.equal(aliases.getDeviceAlias('dev-a'), '办公室主机')
  aliases.writeDeviceAlias('dev-a', '  家里主机  ')
  assert.equal(aliases.getDeviceAlias('dev-a'), '家里主机')
  aliases.writeDeviceAlias('dev-b', '笔记本')
  assert.equal(Object.keys(aliases.readDeviceAliases()).length, 2)
  // 留空 = 恢复原名
  aliases.writeDeviceAlias('dev-a', '   ')
  assert.equal(aliases.getDeviceAlias('dev-a'), null)
  assert.deepEqual(aliases.readDeviceAliases(), { 'dev-b': '笔记本' })
})

check('deviceDisplayName / deviceRealName: 别名优先，原名降级', () => {
  store.clear()
  aliases.writeDeviceAlias('dev-a', '办公室主机')
  assert.equal(aliases.deviceDisplayName('dev-a', 'Windows 工作站'), '办公室主机')
  assert.equal(aliases.deviceRealName('dev-a', 'Windows 工作站'), 'Windows 工作站')
  // 没备注名：展示名就是自报名，副标题不重复
  assert.equal(aliases.deviceDisplayName('dev-x', 'Windows 工作站'), 'Windows 工作站')
  assert.equal(aliases.deviceRealName('dev-x', 'Windows 工作站'), null)
  // 自报名为空 → 兜底「桌面端」
  assert.equal(aliases.deviceDisplayName('dev-y', '  '), '桌面端')
  // 备注名与自报名相同 → 不显示副标题
  aliases.writeDeviceAlias('dev-z', '同名机')
  assert.equal(aliases.deviceRealName('dev-z', '同名机'), null)
})

// ─── 2. 会话筛选 ───────────────────────────────────────────────────────────
check('matchSession: 默认筛选不过滤任何会话', () => {
  assert.equal(
    sessionFilters.matchSession(session(), sessionFilters.DEFAULT_SESSION_FILTER, now),
    true,
  )
  assert.equal(sessionFilters.countSessionFilterFacets(sessionFilters.DEFAULT_SESSION_FILTER), 0)
})

check('matchSession: 状态多选 OR，未知状态不命中', () => {
  const filter = { ...sessionFilters.DEFAULT_SESSION_FILTER, statuses: ['running', 'error'] }
  assert.equal(sessionFilters.matchSession(session({ status: 'running' }), filter, now), true)
  assert.equal(sessionFilters.matchSession(session({ status: 'error' }), filter, now), true)
  assert.equal(sessionFilters.matchSession(session({ status: 'idle' }), filter, now), false)
  assert.equal(sessionFilters.matchSession(session({ status: 'weird' }), filter, now), false)
})

check('matchSession: 时间窗按自然日/滚动窗口，未知时间不命中', () => {
  const make = (activity) => ({ ...sessionFilters.DEFAULT_SESSION_FILTER, activity })
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: hoursAgo(1) }), make('today'), now),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(2) }), make('today'), now),
    false,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(2) }), make('3d'), now),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(6) }), make('7d'), now),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(20) }), make('7d'), now),
    false,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(20) }), make('30d'), now),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: daysAgo(60) }), make('30d'), now),
    false,
  )
  assert.equal(
    sessionFilters.matchSession(session({ updatedAt: 'not-a-date' }), make('7d'), now),
    false,
  )
  // 「今天」= 今天 00:00 之后，而不是「最近 24 小时」
  const startOfToday = sessionFilters.startOfToday(now)
  assert.equal(
    sessionFilters.matchSession(
      session({ updatedAt: new Date(startOfToday).toISOString() }),
      make('today'),
      now,
    ),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(
      session({ updatedAt: new Date(startOfToday - 1000).toISOString() }),
      make('today'),
      now,
    ),
    false,
  )
})

check('matchSession: 标记（含未标记）、项目、仅置顶是 AND', () => {
  const filter = {
    ...sessionFilters.DEFAULT_SESSION_FILTER,
    labels: ['pending-review', 'unlabeled'],
    projectIds: ['p1'],
    pinnedOnly: true,
  }
  const pinned = { pinnedAt: hoursAgo(1) }
  assert.equal(
    sessionFilters.matchSession(
      session({ ...pinned, projectId: 'p1', sessionLabel: 'pending-review' }),
      filter,
      now,
    ),
    true,
  )
  assert.equal(
    sessionFilters.matchSession(
      session({ ...pinned, projectId: 'p1', sessionLabel: null }),
      filter,
      now,
    ),
    true,
  )
  // 标记不匹配
  assert.equal(
    sessionFilters.matchSession(
      session({ ...pinned, projectId: 'p1', sessionLabel: 'suspended' }),
      filter,
      now,
    ),
    false,
  )
  // 项目不匹配
  assert.equal(
    sessionFilters.matchSession(
      session({ ...pinned, projectId: 'p2', sessionLabel: 'pending-review' }),
      filter,
      now,
    ),
    false,
  )
  // 未置顶
  assert.equal(
    sessionFilters.matchSession(
      session({ projectId: 'p1', sessionLabel: 'pending-review' }),
      filter,
      now,
    ),
    false,
  )
})

check('matchSession: 缺 projectId 视为未归属项目', () => {
  const filter = { ...sessionFilters.DEFAULT_SESSION_FILTER, projectIds: ['default'] }
  assert.equal(sessionFilters.matchSession(session({ projectId: undefined }), filter, now), true)
  assert.equal(sessionFilters.matchSession(session({ projectId: 'p1' }), filter, now), false)
})

check('resolveSessionProject: 真实项目 / 未归属 / 归档项目分开归类', () => {
  const known = new Map([['p1', 'Spark-Agent']])
  assert.deepEqual(sessionFilters.resolveSessionProject('p1', known), {
    projectKey: 'p1',
    projectName: 'Spark-Agent',
    projectMissing: false,
  })
  assert.deepEqual(sessionFilters.resolveSessionProject('default', known), {
    projectKey: 'default',
    projectName: '未归属项目',
    projectMissing: false,
  })
  // 旧版桌面端不返回 projectId
  assert.deepEqual(sessionFilters.resolveSessionProject(undefined, known), {
    projectKey: 'default',
    projectName: '未归属项目',
    projectMissing: false,
  })
  // 项目已归档/被删：不能并进「未归属」，否则名字错、还会被「未归属」筛选错误命中
  const archived = sessionFilters.resolveSessionProject('p-archived', known)
  assert.equal(archived.projectKey, sessionFilters.ARCHIVED_PROJECT_FILTER_ID)
  assert.equal(archived.projectName, '已归档项目')
  assert.equal(archived.projectMissing, true)
  assert.notEqual(archived.projectKey, sessionFilters.UNASSIGNED_PROJECT_ID)
})

check('countFacets / summarize / toggleFilterValue', () => {
  const filter = {
    statuses: ['running'],
    labels: ['unlabeled'],
    activity: '7d',
    projectIds: ['p1', 'default'],
    pinnedOnly: true,
  }
  assert.equal(sessionFilters.countSessionFilterFacets(filter), 5)
  assert.deepEqual(sessionFilters.summarizeSessionFilter(filter), [
    '运行中',
    '未标记',
    '近 7 天',
    '项目 2 个',
    '仅置顶',
  ])
  assert.deepEqual(sessionFilters.toggleFilterValue(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(sessionFilters.toggleFilterValue(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(
    sessionFilters.sortFilterValues(['30d', 'today'], sessionFilters.SESSION_ACTIVITY_OPTIONS),
    ['today', '30d'],
  )
})

// ─── 3. 项目筛选 ───────────────────────────────────────────────────────────
check('matchProject: 时间看 updatedAt，虚拟项目空时间不命中', () => {
  const make = (activity) => ({ ...projectFilters.DEFAULT_PROJECT_FILTER, activity })
  assert.equal(projectFilters.matchProject(project(), make('today'), now), true)
  assert.equal(
    projectFilters.matchProject(project({ updatedAt: daysAgo(10) }), make('today'), now),
    false,
  )
  assert.equal(
    projectFilters.matchProject(project({ updatedAt: daysAgo(10) }), make('30d'), now),
    true,
  )
  // 未归属项目没有 updatedAt
  assert.equal(projectFilters.matchProject(project({ updatedAt: '' }), make('7d'), now), false)
  assert.equal(projectFilters.matchProject(project({ updatedAt: '' }), make('all'), now), true)
})

check('matchProject: 状态按会话数派生（运行中 / 有会话 / 空项目）', () => {
  const make = (status) => ({ ...projectFilters.DEFAULT_PROJECT_FILTER, status })
  const running = project({ sessionCount: 4, runningSessionCount: 2 })
  const withSessions = project({ sessionCount: 4, runningSessionCount: 0 })
  const empty = project({ sessionCount: 0, runningSessionCount: 0 })
  assert.equal(projectFilters.matchProject(running, make('running'), now), true)
  assert.equal(projectFilters.matchProject(withSessions, make('running'), now), false)
  assert.equal(projectFilters.matchProject(withSessions, make('withSessions'), now), true)
  assert.equal(projectFilters.matchProject(empty, make('withSessions'), now), false)
  assert.equal(projectFilters.matchProject(empty, make('empty'), now), true)
  // 旧版桌面端不透出 runningSessionCount
  assert.equal(
    projectFilters.matchProject(
      project({ sessionCount: 1, runningSessionCount: undefined }),
      make('running'),
      now,
    ),
    false,
  )
})

check('项目筛选摘要与维度数', () => {
  assert.equal(projectFilters.describeProjectFilter(projectFilters.DEFAULT_PROJECT_FILTER), '筛选')
  assert.equal(projectFilters.describeProjectFilter({ activity: '3d', status: 'all' }), '近 3 天')
  assert.equal(
    projectFilters.describeProjectFilter({ activity: '3d', status: 'running' }),
    '筛选中 · 2',
  )
  assert.equal(projectFilters.countProjectFilterFacets({ activity: '3d', status: 'running' }), 2)
})

console.log(`\n🎉 smoke-filters 全部通过：${results.length} 项`)
