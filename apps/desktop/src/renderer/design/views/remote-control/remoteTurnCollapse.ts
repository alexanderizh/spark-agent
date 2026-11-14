/**
 * 回合级自动折叠（远程视图）。
 *
 * 对齐桌面端主对话区（views/chat/assistant-turn-collapse.ts）：一轮处理完之后
 * 只保留最后一段正文总结，中间的正文分段、思考、工具调用收进一行
 * 「已折叠 N 项过程」，点开才看全过程。
 *
 * 目标端一个 turn 常被拆成「正文 → 干活 → 正文 → 干活 → 总结」十几段，
 * 中途全铺出来会把真正的结论冲到屏幕外；而运行中的那一轮必须保持展开，
 * 否则用户看不到实时进展。
 *
 * 只做数据整形，不碰渲染，便于单测。
 */
import type { RemoteTimelineItem } from './remoteEventMerge'

export interface RemoteTurnCollapseProjection {
  /** 折起来是否有意义（没有可收起的中间内容时不该出现折叠条） */
  canCollapse: boolean
  /** 折叠态下仍显示的条目（保持原顺序） */
  visible: RemoteTimelineItem[]
  /** 被收起的条目数 */
  hiddenCount: number
  /** 被收起的活动段里失败的工具数（折叠条上要能看见，别把失败藏起来） */
  hiddenFailures: number
}

export interface RemoteTurnCollapseOptions {
  /**
   * 这一轮是否已经处理完。
   * 运行中的最后一轮传 false —— 实时进展不能被收起来。
   */
  finished: boolean
}

/** 始终可见：提问、产物卡片（交付结果不是过程日志） */
function isAlwaysVisible(item: RemoteTimelineItem): boolean {
  return item.kind === 'user' || item.kind === 'files'
}

/**
 * 一轮里「算总结」的正文：从末尾往前收集连续的助手正文段。
 * 产物卡片夹在中间不切断连续性（和桌面端 skip delivery blocks 同一取舍）。
 */
function collectSummaryItems(items: RemoteTimelineItem[]): Set<RemoteTimelineItem> {
  const summary = new Set<RemoteTimelineItem>()
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item == null) continue
    if (item.kind === 'files') continue
    if (item.kind === 'assistant' && item.text.trim().length > 0) {
      summary.add(item)
      continue
    }
    // 活动段 / 提示 / 提问：总结到此处为止
    break
  }
  return summary
}

export function projectRemoteTurnCollapse(
  items: readonly RemoteTimelineItem[],
  options: RemoteTurnCollapseOptions,
): RemoteTurnCollapseProjection {
  const unchanged: RemoteTurnCollapseProjection = {
    canCollapse: false,
    visible: [...items],
    hiddenCount: 0,
    hiddenFailures: 0,
  }

  if (!options.finished || items.length === 0) return unchanged
  // 中间有报错就没法「一句话总结完」：错误提示必须留在折叠外
  if (items.some((item) => item.kind === 'notice' && item.tone === 'error')) return unchanged

  const summary = collectSummaryItems([...items])
  // 没有任何正文总结（例如这轮只跑了工具就中断）：收起来会只剩一条空折叠条
  if (summary.size === 0) return unchanged

  const visible = items.filter((item) => isAlwaysVisible(item) || summary.has(item))
  const hidden = items.filter((item) => !visible.includes(item))
  if (hidden.length === 0) return unchanged

  return {
    canCollapse: true,
    visible,
    hiddenCount: hidden.length,
    hiddenFailures: hidden.reduce((total, item) => {
      if (item.kind !== 'activity') return total
      return (
        total + item.steps.filter((step) => step.kind === 'tool' && step.status === 'error').length
      )
    }, 0),
  }
}

export interface RemoteTurnSlice {
  /** 回合 key（取回合内第一条的 id，滚动/展开状态据此稳定） */
  key: string
  items: RemoteTimelineItem[]
  /** 回合首条在整条时间线上的下标，用于判断「是否最后一条」 */
  startIndex: number
}

/**
 * 按用户提问切回合：用户消息是新回合的第一条，其余归属上一条。
 * 时间线若以助手内容开头（历史只取到半轮），单独成一段。
 */
export function splitRemoteTurns(items: readonly RemoteTimelineItem[]): RemoteTurnSlice[] {
  const turns: RemoteTurnSlice[] = []
  let current: RemoteTurnSlice | null = null

  items.forEach((item, index) => {
    if (item.kind === 'user' || current == null) {
      current = { key: `turn:${item.id}`, items: [], startIndex: index }
      turns.push(current)
    }
    current.items.push(item)
  })

  return turns
}
