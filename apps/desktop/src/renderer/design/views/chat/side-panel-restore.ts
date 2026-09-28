/**
 * 统一侧面板在「切换会话」时的 tab 恢复策略（纯函数，便于单测）。
 *
 * 侧面板的 tab 有两类来源：
 *  1. 会话级快照：终端 / 审查 / 侧聊 / 预览 / 计划 等与当前会话绑定的 tab；
 *  2. 项目级快照：「代码」tab —— 它是项目级实例，同一项目下所有会话共享同一个编辑器，
 *     所以它的**存在性**只认项目级状态，不认会话快照（后者可能残留一个文件已全部关闭的旧 code）。
 *
 * 容器（unifiedPanelOpen）是两者共用的一个开关，恢复时的优先级：
 *  ① 切换前正在看代码 → 展开并聚焦 code（用户刚看过的面板不该消失）；
 *  ② 用户刚主动收起过面板（collapsed）→ 尊重这次收起，不自动展开；
 *  ③ 目标会话从未有过快照且该项目的 code tab 还开着 → 展开（新会话不该把面板甩掉）；
 *  ④ 其余情况沿用目标会话自己的展开态。
 */

import type { UnifiedSidePanelKind } from './ChatSidePanels'

/** 会话级侧面板快照中与 tab 相关的部分 */
export interface SessionPanelTabsSnapshot {
  unifiedSideTabs: UnifiedSidePanelKind[]
  activeUnifiedSideTab: UnifiedSidePanelKind | null
  unifiedPanelOpen: boolean
}

/**
 * 项目级「代码」面板在切换前的形态（由当前统一面板状态推导，见 describeCodePanelTabState）：
 * - `closed`    没有 code tab
 * - `collapsed` code tab 存在，但用户把统一面板整体收起了
 * - `open`      code tab 存在、面板展开，但当前看的是别的 tab
 * - `active`    code tab 存在、面板展开，且当前就在看代码
 */
export type CodePanelTabState = 'closed' | 'collapsed' | 'open' | 'active'

export interface RestoredSidePanelTabs {
  unifiedPanelOpen: boolean
  unifiedSideTabs: UnifiedSidePanelKind[]
  activeUnifiedSideTab: UnifiedSidePanelKind | null
}

/** 把统一面板的即时状态归纳成项目级「代码」tab 的形态。 */
export function describeCodePanelTabState(options: {
  unifiedSideTabs: readonly UnifiedSidePanelKind[]
  unifiedPanelOpen: boolean
  activeUnifiedSideTab: UnifiedSidePanelKind | null
}): CodePanelTabState {
  if (!options.unifiedSideTabs.includes('code')) return 'closed'
  if (!options.unifiedPanelOpen) return 'collapsed'
  return options.activeUnifiedSideTab === 'code' ? 'active' : 'open'
}

export function resolveRestoredSidePanelTabs(
  sessionSnapshot: SessionPanelTabsSnapshot | undefined,
  codeTabState: CodePanelTabState,
): RestoredSidePanelTabs {
  const snapTabs = sessionSnapshot?.unifiedSideTabs ?? []
  const snapActiveTab = sessionSnapshot?.activeUnifiedSideTab ?? null
  const hasCodeTab = codeTabState !== 'closed'
  // 「代码」tab 的存在性以项目级状态为准，位置沿用会话快照里的顺序（避免每次都跳到末尾）。
  // 显式标注：UnifiedSidePanelKind 含模板字面量成员，不标注时 'code' 会被拓宽成 string。
  const unifiedSideTabs: UnifiedSidePanelKind[] = hasCodeTab
    ? snapTabs.includes('code')
      ? snapTabs
      : [...snapTabs, 'code']
    : snapTabs.filter((tab) => tab !== 'code')
  // 容器展开：见文件头 ①②③④
  const unifiedPanelOpen =
    codeTabState === 'active' ||
    (codeTabState !== 'collapsed' &&
      ((sessionSnapshot?.unifiedPanelOpen ?? false) ||
        (sessionSnapshot == null && codeTabState === 'open')))
  // 激活 tab：正在看代码 → 继续看代码；否则沿用会话快照里仍存在的那个；
  // 快照指向的 tab 已不在恢复结果里（含 code 已关闭）时回落到末尾 tab。
  const activeUnifiedSideTab: UnifiedSidePanelKind | null =
    codeTabState === 'active'
      ? 'code'
      : snapActiveTab != null && unifiedSideTabs.includes(snapActiveTab)
        ? snapActiveTab
        : (unifiedSideTabs.at(-1) ?? null)
  return { unifiedPanelOpen, unifiedSideTabs, activeUnifiedSideTab }
}
