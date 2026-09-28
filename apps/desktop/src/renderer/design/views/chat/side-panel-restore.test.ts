import { describe, expect, it } from 'vitest'
import { resolveRestoredSidePanelTabs } from './side-panel-restore'
import type { UnifiedSidePanelKind } from './ChatSidePanels'

const snap = (
  unifiedSideTabs: UnifiedSidePanelKind[],
  activeUnifiedSideTab: UnifiedSidePanelKind | null,
  unifiedPanelOpen = true,
) => ({ unifiedSideTabs, activeUnifiedSideTab, unifiedPanelOpen })

describe('resolveRestoredSidePanelTabs', () => {
  it('同项目切会话且代码面板开着时：保留 code tab 并维持展开', () => {
    const res = resolveRestoredSidePanelTabs(undefined, { codeTabOpen: true, codeTabActive: true })
    expect(res.unifiedPanelOpen).toBe(true)
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.activeUnifiedSideTab).toBe('code')
  })

  it('代码面板开着但当时在看终端：并入 code，激活 tab 沿用会话快照', () => {
    const res = resolveRestoredSidePanelTabs(snap(['terminal'], 'terminal'), {
      codeTabOpen: true,
      codeTabActive: false,
    })
    expect(res.unifiedSideTabs).toEqual(['terminal', 'code'])
    expect(res.activeUnifiedSideTab).toBe('terminal')
  })

  it('跨项目且目标项目没有代码面板：收起面板', () => {
    const res = resolveRestoredSidePanelTabs(undefined, {
      codeTabOpen: false,
      codeTabActive: false,
    })
    expect(res.unifiedPanelOpen).toBe(false)
    expect(res.unifiedSideTabs).toEqual([])
    expect(res.activeUnifiedSideTab).toBeNull()
  })

  it('会话快照要求展开且还有 tab 时保持展开', () => {
    const res = resolveRestoredSidePanelTabs(snap(['review'], 'review'), {
      codeTabOpen: false,
      codeTabActive: false,
    })
    expect(res.unifiedPanelOpen).toBe(true)
    expect(res.unifiedSideTabs).toEqual(['review'])
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('会话快照里的 code 已失效（文件全关）时不再恢复出空 code tab', () => {
    const res = resolveRestoredSidePanelTabs(snap(['code'], 'code'), {
      codeTabOpen: false,
      codeTabActive: false,
    })
    expect(res.unifiedSideTabs).toEqual([])
    // 一个 tab 都不剩 → 回落为收起
    expect(res.unifiedPanelOpen).toBe(false)
    expect(res.activeUnifiedSideTab).toBeNull()
  })

  it('会话快照里的 code 失效、但还有其他 tab 时激活项回落到剩余 tab', () => {
    const res = resolveRestoredSidePanelTabs(snap(['code', 'review'], 'code'), {
      codeTabOpen: false,
      codeTabActive: false,
    })
    expect(res.unifiedSideTabs).toEqual(['review'])
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('会话快照里没有 tab 但项目里代码面板开着：把 code tab 带回来', () => {
    const res = resolveRestoredSidePanelTabs(snap([], null, false), {
      codeTabOpen: true,
      codeTabActive: false,
    })
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.activeUnifiedSideTab).toBe('code')
  })
})
