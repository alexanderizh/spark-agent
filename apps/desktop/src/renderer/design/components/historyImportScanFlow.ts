/**
 * 导入历史弹窗「扫描中」动画的卡片模型与几何计算。
 *
 * 纯函数模块（不依赖 React / UI 库 / 样式），便于单测；约束：
 *   - 动画区只单独展示前 SCAN_NAMED_CARD_COUNT 个来源，其余来源合并为末尾一张「更多」卡，
 *     避免扫描动画里堆满所有来源平台；
 *   - 卡片组围绕汇聚圆圆心垂直居中，每条连线都指向汇聚圆圆心；
 *   - 尺寸常量需与 HistoryImportModal.less 中 .hi-scan-flow / .hi-scan-source 保持一致。
 */
import type { HistoryImportSource } from '@spark/protocol'

export type ScanStatus = 'scanning' | 'done' | 'unavailable'

export type ScanSourceState = {
  status: ScanStatus
  count: number
  rootPath: string
  error?: string
}

/** 扫描动画需要的来源描述（与弹窗内 HISTORY_IMPORT_SOURCES 同构，仅取渲染所需字段） */
export type ScanFlowSourceDescriptor = {
  value: HistoryImportSource
  label: string
}

/** 扫描动画卡片：具名来源卡 + 聚合其余来源的「更多」卡 */
export type ScanFlowCard =
  | {
      kind: 'source'
      key: string
      label: string
      source: HistoryImportSource
      state: ScanSourceState
    }
  | {
      kind: 'more'
      key: string
      label: string
      members: HistoryImportSource[]
      state: ScanSourceState
    }

/** 「更多」聚合卡文案与 key */
export const SCAN_MORE_LABEL = '更多'
const SCAN_MORE_KEY = 'more'

/** 扫描态来源卡片尺寸与槽位（与 HistoryImportModal.less 保持一致） */
export const SCAN_CARD_WIDTH = 238
export const SCAN_CARD_HEIGHT = 64
export const SCAN_CARD_SLOT = 74
/** 扫描流程容器高度：卡片组围绕汇聚圆心垂直居中（与 less 中 .hi-scan-flow 一致） */
export const SCAN_FLOW_HEIGHT = 360
/** 汇聚圆圆心（相对扫描流程容器） */
export const SCAN_COLLECTOR_CENTER = { x: 618, y: SCAN_FLOW_HEIGHT / 2 }
/**
 * 扫描动画单独展示的来源卡数量（如 Codex / Claude Code / ZCode），
 * 其余来源合并为末尾一张「更多」卡。
 */
export const SCAN_NAMED_CARD_COUNT = 3

/** 扫描卡片纵向偏移：整组卡片围绕汇聚圆心居中，末位为「更多」聚合卡 */
export function scanCardTop(index: number, cardCount: number): number {
  const stackHeight = (cardCount - 1) * SCAN_CARD_SLOT + SCAN_CARD_HEIGHT
  return SCAN_COLLECTOR_CENTER.y - stackHeight / 2 + index * SCAN_CARD_SLOT
}

/** 单条来源→汇聚圆连线的几何（起点为卡片右边缘中心，终点为圆心） */
export function scanLineGeometry(top: number): { top: number; width: number; angle: number } {
  const startY = top + SCAN_CARD_HEIGHT / 2
  const dx = SCAN_COLLECTOR_CENTER.x - SCAN_CARD_WIDTH
  const dy = SCAN_COLLECTOR_CENTER.y - startY
  return {
    top: startY,
    width: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  }
}

/** 聚合多来源扫描状态：仍有在扫则视为在扫，全部不可用才算不可用，条数求和 */
export function mergeScanState(states: ScanSourceState[]): ScanSourceState {
  if (states.length === 0) return { status: 'done', count: 0, rootPath: '' }
  const status: ScanStatus = states.some((state) => state.status === 'scanning')
    ? 'scanning'
    : states.every((state) => state.status === 'unavailable')
      ? 'unavailable'
      : 'done'
  return {
    status,
    count: states.reduce((sum, state) => sum + state.count, 0),
    rootPath: '',
  }
}

/**
 * 扫描动画卡片列表：前 namedCount 个来源单独成卡，其余来源聚合成一张「更多」卡。
 * 只剩一个来源时直接具名展示——不为了单张卡再套一层「更多」。
 */
export function buildScanFlowCards(
  sources: readonly ScanFlowSourceDescriptor[],
  scanSources: Readonly<Record<HistoryImportSource, ScanSourceState>>,
  namedCount: number = SCAN_NAMED_CARD_COUNT,
): ScanFlowCard[] {
  const named = sources.slice(0, namedCount)
  const rest = sources.slice(namedCount)
  const cards: ScanFlowCard[] = named.map((entry) => ({
    kind: 'source',
    key: entry.value,
    label: entry.label,
    source: entry.value,
    state: scanSources[entry.value],
  }))
  const only = rest[0]
  if (rest.length === 1 && only != null) {
    cards.push({
      kind: 'source',
      key: only.value,
      label: only.label,
      source: only.value,
      state: scanSources[only.value],
    })
    return cards
  }
  if (rest.length > 1) {
    cards.push({
      kind: 'more',
      key: SCAN_MORE_KEY,
      label: SCAN_MORE_LABEL,
      members: rest.map((entry) => entry.value),
      state: mergeScanState(rest.map((entry) => scanSources[entry.value])),
    })
  }
  return cards
}
