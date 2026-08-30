// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  getSidebarAutoSyncAction,
  SIDEBAR_AUTO_COLLAPSE_WIDTH,
  SIDEBAR_AUTO_RESTORE_WIDTH,
} from '../sidebarAutoSync'

describe('getSidebarAutoSyncAction', () => {
  it('keeps the sidebar open when panel layout changes but the window width does not', () => {
    expect(
      getSidebarAutoSyncAction({
        width: 1314,
        previousWidth: 1314,
        sidebarHidden: false,
        fitsWithSidebarVisible: false,
      }),
    ).toBe('none')
  })

  it('does not auto-collapse on width growth after a manual sidebar expand', () => {
    expect(
      getSidebarAutoSyncAction({
        width: 1328,
        previousWidth: 1314,
        sidebarHidden: false,
        fitsWithSidebarVisible: false,
      }),
    ).toBe('none')
  })

  it('auto-collapses when the window becomes narrower and the visible layout no longer fits', () => {
    expect(
      getSidebarAutoSyncAction({
        width: 1300,
        previousWidth: 1360,
        sidebarHidden: false,
        fitsWithSidebarVisible: false,
      }),
    ).toBe('hide')
  })

  it('auto-restores when the window grows wide enough again', () => {
    expect(
      getSidebarAutoSyncAction({
        width: SIDEBAR_AUTO_RESTORE_WIDTH + 32,
        previousWidth: SIDEBAR_AUTO_RESTORE_WIDTH - 24,
        sidebarHidden: true,
        fitsWithSidebarVisible: true,
      }),
    ).toBe('show')
  })

  it('preserves the initial mount safeguard for cramped layouts', () => {
    expect(
      getSidebarAutoSyncAction({
        force: true,
        width: SIDEBAR_AUTO_COLLAPSE_WIDTH + 120,
        previousWidth: null,
        sidebarHidden: false,
        fitsWithSidebarVisible: false,
      }),
    ).toBe('hide')
  })
})
