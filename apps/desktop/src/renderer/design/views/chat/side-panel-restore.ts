/**
 * 统一侧面板在「切换会话」时的 tab 恢复策略（纯函数，便于单测）。
 *
 * 侧面板的 tab 状态有两条来源：
 *  1. 会话级快照：终端 / 审查 / 侧聊 / 预览 / 计划 等与当前会话绑定的 tab；
 *  2. 项目级快照：「代码」tab —— 它是项目级实例，同一项目下所有会话共享同一个编辑器，
 *     只要该项目里代码面板还开着，切会话后就应当继续开着。
 *
 * 因此恢复规则是：先按会话快照铺底（并摘掉其中残留的 code，避免恢复出「文件已被清空」
 * 的空 code tab），再按项目级 codeTabOpen 并入 code；激活 tab 优先沿用会话快照。
 */

import type { UnifiedSidePanelKind } from './ChatSidePanels'

/** 会话级侧面板快照中与 tab 相关的部分 */
export interface SessionPanelTabsSnapshot {
  unifiedSideTabs: UnifiedSidePanelKind[]
  activeUnifiedSideTab: UnifiedSidePanelKind | null
  unifiedPanelOpen: boolean
}

/** 项目级「代码」面板的 tab 存活状态（由 CodePanelSnapshot 推导） */
export interface CodePanelTabsState {
  /** 该项目里「代码」tab 是否处于打开状态 */
  codeTabOpen: boolean
  /** 切换前「代码」tab 是否为当前激活 tab */
  codeTabActive: boolean
}

export interface RestoredSidePanelTabs {
  unifiedPanelOpen: boolean
  unifiedSideTabs: UnifiedSidePanelKind[]
  activeUnifiedSideTab: UnifiedSidePanelKind | null
}

export function resolveRestoredSidePanelTabs(
  sessionSnapshot: SessionPanelTabsSnapshot | undefined,
  code: CodePanelTabsState,
): RestoredSidePanelTabs {
  const snapTabs = sessionSnapshot?.unifiedSideTabs ?? []
  const snapActiveTab = sessionSnapshot?.activeUnifiedSideTab ?? null
  // 「代码」tab 的存续完全由项目级状态决定：先摘掉会话快照里的 code 再按需并入
  const baseTabs = snapTabs.filter((tab) => tab !== 'code')
  // 显式标注：UnifiedSidePanelKind 含模板字面量成员，不标注时 'code' 会被拓宽成 string
  const unifiedSideTabs: UnifiedSidePanelKind[] = code.codeTabOpen
    ? [...baseTabs, 'code']
    : baseTabs
  // 展开条件：项目里代码面板还开着，或会话快照要求展开且确实还剩 tab；
  // 恢复后一个 tab 都不剩时回落为收起，避免残留空壳面板挡住聊天区。
  const unifiedPanelOpen =
    code.codeTabOpen || ((sessionSnapshot?.unifiedPanelOpen ?? false) && baseTabs.length > 0)
  // 激活 tab：刚切过来时正在看代码 → 继续看代码；否则沿用会话快照；
  // 会话快照指向的 code 已不在 tabs 里时作废，回落到剩余最后一个 tab。
  const activeUnifiedSideTab: UnifiedSidePanelKind | null =
    code.codeTabOpen && (code.codeTabActive || snapActiveTab == null)
      ? 'code'
      : snapActiveTab === 'code'
        ? (unifiedSideTabs.at(-1) ?? null)
        : snapActiveTab
  return { unifiedPanelOpen, unifiedSideTabs, activeUnifiedSideTab }
}
