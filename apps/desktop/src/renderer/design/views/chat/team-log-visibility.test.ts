// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetTeamActivityLogsVisibilityForTest,
  setTeamActivityLogsVisible,
} from './team-log-visibility'

describe('team activity log visibility preference', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTeamActivityLogsVisibilityForTest()
  })

  it('defaults to hidden and persists explicit visibility changes', () => {
    expect(localStorage.getItem('spark-agent:team-activity-logs-visible')).toBeNull()

    setTeamActivityLogsVisible(true)
    expect(localStorage.getItem('spark-agent:team-activity-logs-visible')).toBe('true')

    resetTeamActivityLogsVisibilityForTest()
    setTeamActivityLogsVisible(false)
    expect(localStorage.getItem('spark-agent:team-activity-logs-visible')).toBe('false')
  })
})
