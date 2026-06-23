import { describe, expect, it } from 'vitest'
import {
  CANVAS_PROJECT_SORT_LABELS,
  sortCanvasProjects,
  type CanvasProjectSortDir,
  type CanvasProjectSortKey,
} from './canvasProjectSort'
import type { CanvasProject } from './canvas.types'

function makeProject(overrides: Partial<CanvasProject>): CanvasProject {
  return {
    id: 'p',
    userId: 0,
    title: 'P',
    status: 'active',
    nodeCount: 0,
    assetCount: 0,
    taskCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const SAMPLES: CanvasProject[] = [
  makeProject({
    id: 'a',
    title: 'Apple',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
    lastOpenedAt: '2026-03-03T00:00:00.000Z',
  }),
  makeProject({
    id: 'b',
    title: 'Banana',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    lastOpenedAt: '2026-02-03T00:00:00.000Z',
    pinned: true,
  }),
  makeProject({
    id: 'c',
    title: 'Cherry',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastOpenedAt: '2026-01-03T00:00:00.000Z',
  }),
]

function ids(projects: CanvasProject[]): string[] {
  return projects.map((p) => p.id)
}

describe('sortCanvasProjects', () => {
  it('exposes friendly labels for all sort keys', () => {
    const keys: CanvasProjectSortKey[] = ['updated', 'created', 'lastOpened', 'title']
    for (const key of keys) {
      expect(typeof CANVAS_PROJECT_SORT_LABELS[key]).toBe('string')
      expect(CANVAS_PROJECT_SORT_LABELS[key].length).toBeGreaterThan(0)
    }
  })

  it('always puts pinned projects first regardless of sort key', () => {
    for (const key of ['updated', 'created', 'lastOpened', 'title'] as CanvasProjectSortKey[]) {
      for (const dir of ['desc', 'asc'] as CanvasProjectSortDir[]) {
        const sorted = sortCanvasProjects(SAMPLES, key, dir)
        expect(sorted[0]!.id).toBe('b')
      }
    }
  })

  it('sorts unpinned projects by updatedAt desc by default', () => {
    const sorted = sortCanvasProjects(SAMPLES, 'updated', 'desc')
    expect(ids(sorted)).toEqual(['b', 'a', 'c'])
  })

  it('sorts unpinned projects by updatedAt asc when dir=asc', () => {
    const sorted = sortCanvasProjects(SAMPLES, 'updated', 'asc')
    expect(ids(sorted)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by createdAt asc', () => {
    const sorted = sortCanvasProjects(SAMPLES, 'created', 'asc')
    expect(ids(sorted)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by lastOpenedAt desc', () => {
    const sorted = sortCanvasProjects(SAMPLES, 'lastOpened', 'desc')
    expect(ids(sorted)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by title asc (pinned still first)', () => {
    const sorted = sortCanvasProjects(SAMPLES, 'title', 'asc')
    // Banana is pinned → first; then Apple, Cherry alphabetically
    expect(ids(sorted)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const before = ids(SAMPLES)
    sortCanvasProjects(SAMPLES, 'updated', 'desc')
    expect(ids(SAMPLES)).toEqual(before)
  })

  it('handles projects without lastOpenedAt (falls back to createdAt)', () => {
    const noLast = SAMPLES.map((p) => {
      const next: CanvasProject = { ...p }
      delete next.lastOpenedAt
      return next
    })
    const sorted = sortCanvasProjects(noLast, 'lastOpened', 'desc')
    expect(sorted[0]!.id).toBe('b')
    // unpinned: createdAt desc → a (Mar) before c (Jan)
    expect(ids(sorted)).toEqual(['b', 'a', 'c'])
  })

  it('returns empty array for empty input', () => {
    expect(sortCanvasProjects([], 'updated', 'desc')).toEqual([])
  })
})
