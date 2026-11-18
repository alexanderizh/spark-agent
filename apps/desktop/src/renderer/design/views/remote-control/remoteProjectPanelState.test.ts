import { describe, expect, it } from 'vitest'
import {
  REMOTE_PROJECT_PANEL_DEFAULT_WIDTH,
  REMOTE_PROJECT_PANEL_MAX_WIDTH,
  REMOTE_PROJECT_PANEL_MIN_WIDTH,
  REMOTE_PROJECT_PANEL_WIDTH_KEY,
  clampRemoteProjectPanelWidth,
  filterProjectArtifacts,
  readRemoteProjectPanelWidth,
  rememberRemoteProjectPanelWidth,
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
