import { describe, expect, it } from 'vitest'
import {
  describeCodePanelTabState,
  resolveRestoredSidePanelTabs,
  type CodePanelTabState,
} from './side-panel-restore'
import type { UnifiedSidePanelKind } from './ChatSidePanels'

const snap = (
  unifiedSideTabs: UnifiedSidePanelKind[],
  activeUnifiedSideTab: UnifiedSidePanelKind | null,
  unifiedPanelOpen = true,
) => ({ unifiedSideTabs, activeUnifiedSideTab, unifiedPanelOpen })

describe('describeCodePanelTabState', () => {
  it('没有 code tab → closed，与面板展开与否无关', () => {
    expect(
      describeCodePanelTabState({
        unifiedSideTabs: ['review'],
        unifiedPanelOpen: true,
        activeUnifiedSideTab: 'review',
      }),
    ).toBe('closed')
  })

  it('code tab 存在但面板收起 → collapsed', () => {
    expect(
      describeCodePanelTabState({
        unifiedSideTabs: ['code'],
        unifiedPanelOpen: false,
        activeUnifiedSideTab: 'code',
      }),
    ).toBe('collapsed')
  })

  it('面板展开但看的是别的 tab → open', () => {
    expect(
      describeCodePanelTabState({
        unifiedSideTabs: ['code', 'terminal'],
        unifiedPanelOpen: true,
        activeUnifiedSideTab: 'terminal',
      }),
    ).toBe('open')
  })

  it('面板展开且正在看代码 → active', () => {
    expect(
      describeCodePanelTabState({
        unifiedSideTabs: ['code'],
        unifiedPanelOpen: true,
        activeUnifiedSideTab: 'code',
      }),
    ).toBe('active')
  })
})

describe('resolveRestoredSidePanelTabs', () => {
  it('同项目切会话且正在看代码：保留 code tab 并强制维持展开', () => {
    const res = resolveRestoredSidePanelTabs(undefined, 'active')
    expect(res.unifiedPanelOpen).toBe(true)
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.activeUnifiedSideTab).toBe('code')
  })

  it('正在看代码时即使目标会话快照是收起的，也要把代码面板带回来', () => {
    const res = resolveRestoredSidePanelTabs(snap([], null, false), 'active')
    expect(res.unifiedPanelOpen).toBe(true)
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.activeUnifiedSideTab).toBe('code')
  })

  it('代码 tab 开着但当时在看终端：并入 code，激活 tab 沿用会话快照', () => {
    const res = resolveRestoredSidePanelTabs(snap(['terminal'], 'terminal'), 'open')
    expect(res.unifiedSideTabs).toEqual(['terminal', 'code'])
    expect(res.activeUnifiedSideTab).toBe('terminal')
    expect(res.unifiedPanelOpen).toBe(true)
  })

  it('用户主动收起过面板：切到无快照会话时不强行展开，且 code tab 不丢', () => {
    const res = resolveRestoredSidePanelTabs(undefined, 'collapsed')
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.unifiedPanelOpen).toBe(false)
  })

  it('用户主动收起过面板：目标会话快照要求展开也不强行拉开（收起是更新的意图）', () => {
    const res = resolveRestoredSidePanelTabs(snap(['review'], 'review', true), 'collapsed')
    expect(res.unifiedPanelOpen).toBe(false)
    expect(res.unifiedSideTabs).toEqual(['review', 'code'])
  })

  it('跨项目且目标项目没有代码面板：收起面板', () => {
    const res = resolveRestoredSidePanelTabs(undefined, 'closed')
    expect(res.unifiedPanelOpen).toBe(false)
    expect(res.unifiedSideTabs).toEqual([])
    expect(res.activeUnifiedSideTab).toBeNull()
  })

  it('会话快照要求展开且还有 tab 时保持展开', () => {
    const res = resolveRestoredSidePanelTabs(snap(['review'], 'review'), 'closed')
    expect(res.unifiedPanelOpen).toBe(true)
    expect(res.unifiedSideTabs).toEqual(['review'])
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('会话快照里残留的 code 已失效（项目里文件全关）时不再恢复出空 code tab', () => {
    const res = resolveRestoredSidePanelTabs(snap(['code', 'review'], 'code'), 'closed')
    expect(res.unifiedSideTabs).toEqual(['review'])
    // 激活项指向的 code 已不在恢复结果里 → 回落到末尾 tab
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('快照里唯一的 code 失效后：面板回落到它自己的空态（会话仍是展开态）', () => {
    const res = resolveRestoredSidePanelTabs(snap(['code'], 'code'), 'closed')
    expect(res.unifiedSideTabs).toEqual([])
    expect(res.activeUnifiedSideTab).toBeNull()
    // 「展开但无 tab」是该面板设计好的空态（显示 tab 选择器），保持会话自身的展开态
    expect(res.unifiedPanelOpen).toBe(true)
  })

  it('code tab 已在会话快照里时保持原有位置，不跳到末尾', () => {
    const res = resolveRestoredSidePanelTabs(snap(['code', 'review'], 'review'), 'open')
    expect(res.unifiedSideTabs).toEqual(['code', 'review'])
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('会话快照里没有 tab 但项目里代码 tab 还开着：把 code tab 带回来', () => {
    const res = resolveRestoredSidePanelTabs(snap([], null, false), 'open')
    expect(res.unifiedSideTabs).toEqual(['code'])
    expect(res.activeUnifiedSideTab).toBe('code')
  })

  it('会话快照里的激活 tab 已失效时回落到末尾 tab，而不是渲染不存在的面板', () => {
    const res = resolveRestoredSidePanelTabs(
      snap(['code', 'review'], 'preview:/tmp/a.ts'),
      'closed',
    )
    expect(res.unifiedSideTabs).toEqual(['review'])
    expect(res.activeUnifiedSideTab).toBe('review')
  })

  it('四态全覆盖：active/open 会自行打开容器，collapsed/closed 不会', () => {
    const opened: Record<CodePanelTabState, boolean> = {
      active: resolveRestoredSidePanelTabs(undefined, 'active').unifiedPanelOpen,
      open: resolveRestoredSidePanelTabs(undefined, 'open').unifiedPanelOpen,
      collapsed: resolveRestoredSidePanelTabs(undefined, 'collapsed').unifiedPanelOpen,
      closed: resolveRestoredSidePanelTabs(undefined, 'closed').unifiedPanelOpen,
    }
    expect(opened).toEqual({ active: true, open: true, collapsed: false, closed: false })
  })
})
