import { describe, expect, it } from 'vitest'
import {
  GIT_ENV_PANEL_MIN_RIGHT_GUTTER,
  getRightGutterWidth,
  shouldAutoCollapseGitEnvPanel,
} from './git-env-panel-layout'

describe('git environment panel layout', () => {
  it('calculates the available right gutter from the actual element edges', () => {
    expect(getRightGutterWidth(1200, 900)).toBe(300)
    expect(getRightGutterWidth(1200, 1200)).toBe(0)
    expect(getRightGutterWidth(1200, 1240)).toBe(0)
  })

  it('collapses below 220px and keeps the exact boundary available', () => {
    expect(shouldAutoCollapseGitEnvPanel(GIT_ENV_PANEL_MIN_RIGHT_GUTTER - 1)).toBe(true)
    expect(shouldAutoCollapseGitEnvPanel(GIT_ENV_PANEL_MIN_RIGHT_GUTTER)).toBe(false)
    expect(shouldAutoCollapseGitEnvPanel(GIT_ENV_PANEL_MIN_RIGHT_GUTTER + 1)).toBe(false)
    expect(shouldAutoCollapseGitEnvPanel(null)).toBe(false)
  })
})
