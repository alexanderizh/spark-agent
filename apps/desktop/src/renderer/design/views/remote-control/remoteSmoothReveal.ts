/**
 * 拟流式呈现（远程会话专用）。
 *
 * 目标端不是在推 token，而是每 500ms 把「自上次以来新增的原始事件」整批推上
 * 来（MobileBridgeService 的 poller）。一轮短回答常常一批就到齐，端上看着就是
 * 「一次性刷出来」，跟本机对话区的逐字流式手感差很远。
 *
 * 这里只做呈现层的事情，不改事件、不改最终文本：把「单批突增」的正文按帧揭示。
 *   - 单个条目首次出现：直接显示全文（打开一个正在跑的会话不该倒带回放）；
 *   - 同一段继续增长且一次增长 ≥ 阈值：分帧揭示，步长随剩余量自适应；
 *   - 增长小于阈值（本来就是细粒度分片）：立即显示，不做多余动画；
 *   - 文本回退 / 替换（收尾对账把分段换成全文）：立即对齐，绝不卡在旧长度。
 */
import { useEffect, useMemo, useState } from 'react'
import type { RemoteTimelineItem } from './remoteEventMerge'

/** 一次增长超过这么多字符才值得拆帧；更小的增长本来就是分片到达 */
export const SMOOTH_THRESHOLD_CHARS = 48
/** 每帧间隔：60ms ≈ 16fps，Markdown 重渲染与手感之间取平衡 */
const SMOOTH_TICK_MS = 60
/** 单帧最少揭示字符数，避免长文揭示过慢 */
const SMOOTH_MIN_STEP = 12

/** 单帧揭示多少字符：剩余越多步长越大（约 5 帧追平） */
export function smoothStep(remaining: number): number {
  if (remaining <= 0) return 0
  return Math.min(remaining, Math.max(SMOOTH_MIN_STEP, Math.ceil(remaining / 5)))
}

export interface SmoothTarget {
  /** 条目身份：切换条目即重置揭示进度 */
  key: string
  index: number
  length: number
}

/** 取最后一条仍在流式的正文/思考条目作为揭示目标 */
export function findSmoothTarget(items: readonly RemoteTimelineItem[]): SmoothTarget | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item == null) continue
    if (item.kind !== 'assistant' && item.kind !== 'thinking') continue
    if (!item.streaming) return null
    return { key: `${item.kind}-${item.id}`, index, length: item.text.length }
  }
  return null
}

interface RevealState {
  key: string | null
  shown: number
}

/**
 * 把时间线里正在流式的最后一条正文按帧揭示。
 * 入参不变时返回同一引用，避免下游 memo 失效。
 */
export function useSmoothRemoteItems(items: RemoteTimelineItem[]): RemoteTimelineItem[] {
  const target = useMemo(() => findSmoothTarget(items), [items])
  const [reveal, setReveal] = useState<RevealState>({ key: null, shown: 0 })

  useEffect(() => {
    if (target == null) return
    const timer = window.setInterval(() => {
      setReveal((previous) => {
        // 条目换了：直接对齐全文，不倒带回放
        if (previous.key !== target.key) return { key: target.key, shown: target.length }
        const remaining = target.length - previous.shown
        if (remaining <= 0) return previous
        const step = remaining < SMOOTH_THRESHOLD_CHARS ? remaining : smoothStep(remaining)
        return { key: target.key, shown: previous.shown + step }
      })
    }, SMOOTH_TICK_MS)
    return () => window.clearInterval(timer)
  }, [target])

  return useMemo(() => {
    if (target == null) return items
    // 进度不属于当前条目（刚切换）时按全文显示，避免出现「先截断再补全」的闪烁
    if (reveal.key !== target.key) return items
    const visible = Math.max(0, Math.min(reveal.shown, target.length))
    if (visible >= target.length) return items
    const item = items[target.index]
    if (item == null || (item.kind !== 'assistant' && item.kind !== 'thinking')) return items
    if (item.text.length <= visible) return items
    const next = [...items]
    next[target.index] = { ...item, text: item.text.slice(0, visible) }
    return next
  }, [items, reveal, target])
}
