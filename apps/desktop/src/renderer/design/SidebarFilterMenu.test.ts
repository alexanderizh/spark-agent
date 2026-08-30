import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SIDEBAR_FILTER,
  SCHEDULED_TASK_FILTER_OPTIONS,
  canReorderSidebarSessions,
  isDefaultFilter,
} from './SidebarFilterMenu'

describe('SidebarFilterMenu scheduled-task filter', () => {
  it('provides all, attached, and unattached options', () => {
    expect(SCHEDULED_TASK_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      'all',
      'attached',
      'none',
    ])
  })

  it('treats a scheduled-task filter as active', () => {
    expect(isDefaultFilter({ ...DEFAULT_SIDEBAR_FILTER, scheduledTasks: 'attached' })).toBe(false)
  })
})

describe('SidebarFilterMenu canvas-project filter', () => {
  it('treats hiding canvas projects as an active filter', () => {
    expect(isDefaultFilter({ ...DEFAULT_SIDEBAR_FILTER, canvasProjects: 'hide' })).toBe(false)
  })
})

describe('SidebarFilterMenu project multi-select', () => {
  it('treats an empty selection as default and any selection as active', () => {
    expect(isDefaultFilter({ ...DEFAULT_SIDEBAR_FILTER })).toBe(true)
    expect(isDefaultFilter({ ...DEFAULT_SIDEBAR_FILTER, projectIds: ['ws-1'] })).toBe(false)
  })

  it('allows reordering while one or multiple projects are selected', () => {
    expect(
      canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, projectIds: ['ws-1'] }, false),
    ).toBe(true)
    expect(
      canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, projectIds: ['ws-1', 'ws-2'] }, false),
    ).toBe(true)
  })
})

describe('canReorderSidebarSessions', () => {
  it('allows reordering while a project filter or canvas-project visibility is active', () => {
    expect(
      canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, canvasProjects: 'hide' }, false),
    ).toBe(true)
  })

  it('blocks reordering for filters that change the sessions inside a group', () => {
    expect(canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, groupBy: 'date' }, false)).toBe(
      false,
    )
    expect(canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, status: 'all' }, false)).toBe(
      false,
    )
    expect(
      canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, lastActivity: '7d' }, false),
    ).toBe(false)
    expect(
      canReorderSidebarSessions({ ...DEFAULT_SIDEBAR_FILTER, scheduledTasks: 'none' }, false),
    ).toBe(false)
    expect(canReorderSidebarSessions(DEFAULT_SIDEBAR_FILTER, true)).toBe(false)
  })
})
