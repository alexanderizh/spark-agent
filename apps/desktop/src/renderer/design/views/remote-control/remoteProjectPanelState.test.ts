import { describe, expect, it } from 'vitest'
import {
  REMOTE_PROJECT_PANEL_DEFAULT_OPEN,
  REMOTE_PROJECT_PANEL_DEFAULT_WIDTH,
  REMOTE_PROJECT_PANEL_MAX_WIDTH,
  REMOTE_PROJECT_PANEL_MIN_WIDTH,
  REMOTE_PROJECT_PANEL_OPEN_KEY,
  REMOTE_PROJECT_PANEL_WIDTH_KEY,
  clampRemoteProjectPanelWidth,
  filterProjectArtifacts,
  mergeSessionTimelineArtifacts,
  readRemoteProjectPanelOpen,
  readRemoteProjectPanelWidth,
  rememberRemoteProjectPanelOpen,
  rememberRemoteProjectPanelWidth,
  remoteFilePreviewPanelKind,
  remotePathOfPreviewPanelTab,
  type RemoteProjectPanelStorage,
} from './remoteProjectPanelState'

function fakeStorage(): RemoteProjectPanelStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('remote project panel width', () => {
  it('bounds values and uses a finite default for invalid input', () => {
    expect(clampRemoteProjectPanelWidth(100)).toBe(REMOTE_PROJECT_PANEL_MIN_WIDTH)
    expect(clampRemoteProjectPanelWidth(900)).toBe(REMOTE_PROJECT_PANEL_MAX_WIDTH)
    expect(clampRemoteProjectPanelWidth(333.4)).toBe(333)
    expect(clampRemoteProjectPanelWidth(Number.NaN)).toBe(REMOTE_PROJECT_PANEL_DEFAULT_WIDTH)
  })

  it('persists only a bounded width and recovers from invalid storage data', () => {
    const storage = fakeStorage()
    expect(readRemoteProjectPanelWidth(storage)).toBe(REMOTE_PROJECT_PANEL_DEFAULT_WIDTH)
    expect(rememberRemoteProjectPanelWidth(900, storage)).toBe(REMOTE_PROJECT_PANEL_MAX_WIDTH)
    expect(storage.values.get(REMOTE_PROJECT_PANEL_WIDTH_KEY)).toBe('560')
    storage.setItem(REMOTE_PROJECT_PANEL_WIDTH_KEY, 'invalid')
    expect(readRemoteProjectPanelWidth(storage)).toBe(REMOTE_PROJECT_PANEL_DEFAULT_WIDTH)
  })
})

describe('filterProjectArtifacts', () => {
  const artifacts = [
    { path: '/project/a.png', sessionId: 's1', sessionTitle: 'One', presentedAt: '2026-11-18' },
    { path: '/project/b.pdf', sessionId: 's1', sessionTitle: 'One', presentedAt: '2026-11-18' },
    { path: '/project/c.ts', sessionId: 's2', sessionTitle: 'Two', presentedAt: '2026-11-18' },
    { path: '/project/d.md', sessionId: 's2', sessionTitle: 'Two', presentedAt: '2026-11-18' },
  ]

  it('defaults to only the active session and applies file type filters', () => {
    expect(
      filterProjectArtifacts(artifacts, 's1', 'session', 'all').map(({ path }) => path),
    ).toEqual(['/project/a.png', '/project/b.pdf'])
    expect(
      filterProjectArtifacts(artifacts, 's1', 'session', 'image').map(({ path }) => path),
    ).toEqual(['/project/a.png'])
  })

  it('returns no session-scoped artifacts without an active session', () => {
    expect(filterProjectArtifacts(artifacts, null, 'session', 'all')).toEqual([])
  })

  it('includes artifacts across sessions when project scope is selected', () => {
    expect(
      filterProjectArtifacts(artifacts, 's1', 'project', 'text').map(({ path }) => path),
    ).toEqual(['/project/d.md'])
  })
})

describe('remote project panel open state', () => {
  it('defaults to open when never persisted (2026-11-25 默认展开)', () => {
    const storage = fakeStorage()
    expect(readRemoteProjectPanelOpen(storage)).toBe(REMOTE_PROJECT_PANEL_DEFAULT_OPEN)
    expect(REMOTE_PROJECT_PANEL_DEFAULT_OPEN).toBe(true)
  })

  it('remembers the user manual choice and never forces it open again', () => {
    const storage = fakeStorage()
    rememberRemoteProjectPanelOpen(false, storage)
    expect(storage.values.get(REMOTE_PROJECT_PANEL_OPEN_KEY)).toBe('false')
    expect(readRemoteProjectPanelOpen(storage)).toBe(false)
    rememberRemoteProjectPanelOpen(true, storage)
    expect(readRemoteProjectPanelOpen(storage)).toBe(true)
  })

  it('recovers from invalid storage data', () => {
    const storage = fakeStorage()
    storage.setItem(REMOTE_PROJECT_PANEL_OPEN_KEY, 'garbage')
    expect(readRemoteProjectPanelOpen(storage)).toBe(REMOTE_PROJECT_PANEL_DEFAULT_OPEN)
  })
})

describe('mergeSessionTimelineArtifacts', () => {
  const restArtifacts = [
    { path: '/ws/report.md', sessionId: 's1', sessionTitle: '诊断', presentedAt: '2026-11-24T10:00:00Z' },
  ]

  it('appends timeline-only entries as immediate session items', () => {
    const merged = mergeSessionTimelineArtifacts(
      restArtifacts,
      [{ path: '/ws/fresh.md', title: '刚出炉' }],
      's9',
    )
    expect(merged).toHaveLength(2)
    expect(merged[0]?.path).toBe('/ws/fresh.md')
    expect(merged[0]?.sessionTitle).toBe('本会话')
    expect(merged[0]?.presented).toBe(true)
    // 排在最前（时间线即时条目置顶）
    expect((merged[0]?.presentedAt ?? '') >= (merged[1]?.presentedAt ?? '')).toBe(true)
  })

  it('dedupes against REST aggregation by exact path', () => {
    const merged = mergeSessionTimelineArtifacts(
      restArtifacts,
      [{ path: '/ws/report.md' }],
      's1',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.sessionTitle).toBe('诊断')
  })

  it('returns rest artifacts untouched without an active session or timeline files', () => {
    expect(mergeSessionTimelineArtifacts(restArtifacts, [{ path: '/x.md' }], null)).toBe(
      restArtifacts,
    )
    expect(mergeSessionTimelineArtifacts(restArtifacts, [], 's1')).toBe(restArtifacts)
  })
})

describe('preview panel tab kinds', () => {
  it('round-trips preview panel kinds by remote path', () => {
    const kind = remoteFilePreviewPanelKind('G:\\ws\\report.md')
    expect(kind).toBe('preview:G:\\ws\\report.md')
    expect(remotePathOfPreviewPanelTab(kind)).toBe('G:\\ws\\report.md')
    expect(remotePathOfPreviewPanelTab('artifacts')).toBeNull()
    expect(remotePathOfPreviewPanelTab('inspector')).toBeNull()
  })
})
