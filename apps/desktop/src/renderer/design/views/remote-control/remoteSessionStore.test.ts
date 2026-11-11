import { describe, expect, it } from 'vitest'
import type { MobileBridgeProjectSummary, MobileBridgeSessionSummary } from '@spark/protocol'
import {
  UNASSIGNED_PROJECT_ID,
  buildProjectRows,
  filterSessions,
  formatRelativeTime,
  getRemoteSessionStore,
  groupSessionsByProject,
  insertSessionInStore,
  isStale,
  patchProjectInStore,
  patchSessionInStore,
  removeProjectFromStore,
  removeSessionFromStore,
  sortSessionRows,
  updateRemoteSessionStore,
} from './remoteSessionStore'

function project(
  partial: Partial<MobileBridgeProjectSummary> & { id: string; name: string },
): MobileBridgeProjectSummary {
  return {
    rootPath: '',
    projectKind: 'local',
    pinnedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessionCount: 0,
    ...partial,
  }
}

function session(
  partial: Partial<MobileBridgeSessionSummary> & { id: string },
): MobileBridgeSessionSummary {
  return {
    title: '会话',
    status: 'idle',
    updatedAt: '2026-01-01T00:00:00.000Z',
    preview: '',
    ...partial,
  }
}

describe('buildProjectRows', () => {
  it('项目直接映射成行，角标来自项目列表自身', () => {
    const rows = buildProjectRows(
      [
        project({ id: 'p1', name: '币安量化', sessionCount: 12, runningSessionCount: 2 }),
        project({ id: 'p2', name: 'react-component', sessionCount: 3 }),
      ],
      0,
      false,
    )
    expect(rows).toEqual([
      { id: 'p1', name: '币安量化', sessionCount: 12, runningCount: 2, kind: 'project' },
      { id: 'p2', name: 'react-component', sessionCount: 3, runningCount: 0, kind: 'project' },
    ])
  })

  it('未归属行只在需要时补到最后', () => {
    const projects = [project({ id: 'p1', name: 'A', sessionCount: 1 })]
    expect(buildProjectRows(projects, 0, false)).toHaveLength(1)

    const withUnassigned = buildProjectRows(projects, 2, true)
    expect(withUnassigned).toHaveLength(2)
    expect(withUnassigned[1]).toEqual({
      id: UNASSIGNED_PROJECT_ID,
      name: '未归属会话',
      sessionCount: 0,
      runningCount: 2,
      kind: 'unassigned',
    })
  })

  it('旧版目标端缺 sessionCount 时按 0 处理，不显示 NaN', () => {
    const rows = buildProjectRows([{ id: 'p1', name: 'A' } as MobileBridgeProjectSummary], 0, false)
    expect(rows[0]?.sessionCount).toBe(0)
    expect(rows[0]?.runningCount).toBe(0)
  })

  it('空名字兜底成「未命名项目」', () => {
    expect(buildProjectRows([project({ id: 'p1', name: '' })], 0, false)[0]?.name).toBe(
      '未命名项目',
    )
  })
})

describe('filterSessions', () => {
  const rows = [
    session({ id: 's1', title: '回测参数网格搜索', preview: '把 grid 收窄到 20 组' }),
    session({ id: 's2', title: '表格组件列宽自适应', preview: 'antd table 的 scroll' }),
    session({ id: 's3', title: 'Spark-Agent 远程协议', preview: '' }),
  ]

  it('空关键词原样返回', () => {
    expect(filterSessions(rows, '   ')).toBe(rows)
  })

  it('标题命中（大小写不敏感）', () => {
    expect(filterSessions(rows, 'spark-agent').map((row) => row.id)).toEqual(['s3'])
  })

  it('预览命中也算：记不住标题也能搜到', () => {
    expect(filterSessions(rows, 'GRID').map((row) => row.id)).toEqual(['s1'])
  })

  it('没有命中返回空数组', () => {
    expect(filterSessions(rows, '不存在的词')).toEqual([])
  })
})

describe('groupSessionsByProject', () => {
  const projects = [project({ id: 'p1', name: '币安量化' }), project({ id: 'p2', name: '前端' })]
  const rows = [
    session({ id: 's1', projectId: 'p2' }),
    session({ id: 's2', projectId: 'p1' }),
    session({ id: 's3', projectId: 'p1' }),
    session({ id: 's4' }),
  ]

  it('顺序跟着项目列表，未归属排最后', () => {
    const groups = groupSessionsByProject(rows, projects)
    expect(groups.map((group) => group.projectId)).toEqual(['p1', 'p2', UNASSIGNED_PROJECT_ID])
    expect(groups[0]?.sessions.map((row) => row.id)).toEqual(['s2', 's3'])
    expect(groups[2]?.name).toBe('未归属会话')
  })

  it('没有会话的项目不产生空分组', () => {
    const groups = groupSessionsByProject([session({ id: 's1', projectId: 'p1' })], projects)
    expect(groups.map((group) => group.projectId)).toEqual(['p1'])
  })

  it('项目已不在列表里（被归档）时用兜底名字', () => {
    const groups = groupSessionsByProject([session({ id: 's1', projectId: 'gone' })], projects)
    expect(groups[0]?.name).toBe('其它项目')
  })
})

describe('isStale', () => {
  it('从未拉过（fetchedAt=0）视为过期', () => {
    expect(isStale(0, 60_000, 1_000_000)).toBe(true)
  })

  it('TTL 内不算过期', () => {
    expect(isStale(1_000_000, 60_000, 1_030_000)).toBe(false)
  })

  it('超过 TTL 算过期', () => {
    expect(isStale(1_000_000, 60_000, 1_060_001)).toBe(true)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z')
  const at = (ms: number) => new Date(now - ms).toISOString()

  it('按分钟/小时/天分档', () => {
    expect(formatRelativeTime(at(10_000), now)).toBe('刚刚')
    expect(formatRelativeTime(at(5 * 60_000), now)).toBe('5 分钟前')
    expect(formatRelativeTime(at(3 * 3_600_000), now)).toBe('3 小时前')
    expect(formatRelativeTime(at(2 * 86_400_000), now)).toBe('2 天前')
  })

  it('非法时间给空串，不显示 NaN', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('')
  })
})

describe('sortSessionRows', () => {
  it('置顶在前（置顶时间倒序），其余按更新时间倒序', () => {
    const rows = [
      session({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'new', updatedAt: '2026-03-01T00:00:00.000Z' }),
      session({
        id: 'pin-old',
        updatedAt: '2025-01-01T00:00:00.000Z',
        pinnedAt: '2026-01-05T00:00:00.000Z',
      }),
      session({
        id: 'pin-new',
        updatedAt: '2025-01-01T00:00:00.000Z',
        pinnedAt: '2026-02-05T00:00:00.000Z',
      }),
    ]
    expect(sortSessionRows(rows).map((row) => row.id)).toEqual(['pin-new', 'pin-old', 'new', 'old'])
  })

  it('不修改入参', () => {
    const rows = [
      session({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]
    sortSessionRows(rows)
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('本地写回', () => {
  const DEVICE = 'dev-write-back'

  const seed = () => {
    updateRemoteSessionStore(DEVICE, (store) => {
      store.projects = [project({ id: 'p1', name: '项目一', sessionCount: 2 })]
      store.sessions.p1 = {
        rows: [
          session({ id: 'a', title: '会话 A', projectId: 'p1' }),
          session({ id: 'b', title: '会话 B', projectId: 'p1' }),
        ],
        total: 2,
        fetchedAt: Date.now(),
      }
      store.allSessions = null
    })
    return getRemoteSessionStore(DEVICE)
  }

  it('改标题只动目标会话', () => {
    const store = seed()
    patchSessionInStore(DEVICE, 'a', { title: '新标题' })
    expect(store.sessions.p1?.rows.map((row) => row.title)).toEqual(['新标题', '会话 B'])
    expect(store.version).toBeGreaterThan(0)
  })

  it('置顶后重排到最前', () => {
    const store = seed()
    patchSessionInStore(DEVICE, 'b', { pinnedAt: new Date().toISOString() })
    expect(store.sessions.p1?.rows.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('删除会话同步减总数与项目角标', () => {
    const store = seed()
    const target = store.sessions.p1?.rows[0]
    if (target == null) throw new Error('seed 失败')
    removeSessionFromStore(DEVICE, target)
    expect(store.sessions.p1?.rows.map((row) => row.id)).toEqual(['b'])
    expect(store.sessions.p1?.total).toBe(1)
    expect(store.projects[0]?.sessionCount).toBe(1)
  })

  it('新建会话插到项目顶部并加角标', () => {
    const store = seed()
    insertSessionInStore(
      DEVICE,
      session({ id: 'c', title: '新会话', projectId: 'p1', updatedAt: new Date().toISOString() }),
    )
    expect(store.sessions.p1?.rows[0]?.id).toBe('c')
    expect(store.sessions.p1?.total).toBe(3)
    expect(store.projects[0]?.sessionCount).toBe(3)
  })

  it('项目改名 / 删除生效', () => {
    const store = seed()
    patchProjectInStore(DEVICE, 'p1', { name: '改名后' })
    expect(store.projects[0]?.name).toBe('改名后')
    removeProjectFromStore(DEVICE, 'p1')
    expect(store.projects).toHaveLength(0)
    expect(store.sessions.p1).toBeUndefined()
  })
})
