import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SIDEBAR_FILTER,
  SCHEDULED_TASK_FILTER_OPTIONS,
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
