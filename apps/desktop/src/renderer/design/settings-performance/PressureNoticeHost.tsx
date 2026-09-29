/**
 * @module PressureNoticeHost
 *
 * 压力降级通知（M2 收尾 / M3 挂载）：监听 stream:resource-monitor:pressure-changed。
 * 2026-09-23 产品决策：常态使用完全静默——warning（限流）/ critical（暂停新派发）
 * 不再弹任何提示（状态在性能页可见），只有 emergency（即将溢出，已熔断全部派发）
 * 才通知用户：右上角常驻消息弹窗（带「查看性能」）+ 一条系统通知；压力降回
 * emergency 以下即关闭弹窗，完全恢复（nominal）时补一条「电脑资源已恢复」。
 * 页面加载前已发生的级别不补发（历史回看走性能页事件列表）。
 *
 * 2026-09-30 改造：原先自绘的顶部常驻横幅（`.perf-notice*`）改为走统一消息弹窗
 * （useToast，右上角）。根因是那套样式只随懒加载的「设置」页 chunk 下发，冷启动
 * 未进设置页时横幅完全没有样式，退化成文档流块被排到窗口底部、压住会话输入区。
 * 统一走 Toast 后样式随主包常驻，位置也与其他应用内提示一致。
 *
 * 文案导向（2026-09-23 用户反馈）：主语必须是「电脑资源压力」而非「应用性能」——
 * 这是系统资源保护机制的说辞，避免用户误以为应用本身出了故障。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { PressureLevel, ResourcePressureChangedPayload } from '@spark/protocol'
import { useToast } from '../components/Toast'
import type { ToastFn } from '../components/Toast'
import { useApp } from '../AppContext'

/**
 * 触发指标 → 用户视角的现象描述（2026-09-23 文案决策：主语是「电脑」，
 * 不用指标名——用户关心的是「电脑怎么了」，不是 host-rss 与 children-rss
 * 的区别；四个内存指标共用同一现象句，去重后只显示一次）。
 */
const TRIGGER_PHENOMENA: Record<string, string> = {
  'system-used-pct': '内存占用接近上限',
  'app-footprint-pct': '内存占用接近上限',
  'host-rss-pct': '内存占用接近上限',
  'children-rss-pct': '内存占用接近上限',
  'children-count': '后台进程数量过多',
  'event-loop-delay-ms': '系统响应明显变慢',
}

function describePhenomena(keys: string[]): string {
  const seen = new Set<string>()
  for (const key of keys) {
    const label = TRIGGER_PHENOMENA[key]
    if (label != null) seen.add(label)
  }
  return seen.size > 0 ? [...seen].join('、') : '资源占用接近饱和'
}

/**
 * 常驻弹窗正文（比原横幅短：弹窗宽度有限，长文会折成高密度文字块；
 * 「不是应用故障」「进行中的任务不受影响」是 2026-09-23 定下的关键安抚信息，保留）。
 */
function noticeMessage(keys: string[]): string {
  return `检测到电脑整体${describePhenomena(keys)}，Spark 已暂停新任务派发以保护系统流畅。这是资源保护机制而非应用故障，进行中的任务不受影响；释放电脑资源后会自动恢复。`
}

/** emergency 系统通知（Electron 渲染层 web Notification；失败静默——弹窗仍在）。 */
function sendSystemNotice(keys: string[]): void {
  try {
    if (typeof Notification === 'undefined') return
    const body = `电脑整体${describePhenomena(keys)}，Spark 已暂停新任务派发以保护系统流畅。释放电脑资源后将自动恢复。`
    const notice = new Notification('电脑资源压力提示', { body, silent: true })
    notice.onclick = () => {
      window.focus()
      notice.close()
    }
  } catch {
    /* 弹窗仍在，系统通知失败可接受 */
  }
}

export function PressureNoticeHost() {
  const { toast, dismiss } = useToast()
  const { setTweak } = useApp()
  /** 当前常驻弹窗 id（null = 没有正在展示的弹窗）。 */
  const noticeIdRef = useRef<string | null>(null)
  /** 当前弹窗文案：长时间停在 emergency 时只有现象变化才重建，避免无谓的重建动画。 */
  const noticeTextRef = useRef<string | null>(null)
  /** 页面加载标记（首个 effect 填充）：早于挂载的流事件不弹通知，避免每次切页补报。 */
  const mountedAtRef = useRef<number>(0)

  const navigateToPerformance = useCallback((): void => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'performance')
  }, [setTweak])

  const hideNotice = useCallback((): void => {
    const id = noticeIdRef.current
    noticeIdRef.current = null
    noticeTextRef.current = null
    if (id != null) dismiss(id)
  }, [dismiss])

  const showNotice = useCallback((triggeredBy: string[]): void => {
    const text = noticeMessage(triggeredBy)
    if (noticeIdRef.current != null && noticeTextRef.current === text) return
    hideNotice()
    noticeIdRef.current = toast.warning(text, {
      sticky: true,
      actions: [{ label: '查看性能', onClick: navigateToPerformance }],
    })
    noticeTextRef.current = text
  }, [hideNotice, navigateToPerformance, toast])

  useEffect(() => {
    mountedAtRef.current = Date.now()
  }, [])

  // 卸载（应用退出）时清掉常驻弹窗，避免残留 id 被后续消息重建。
  useEffect(() => () => hideNotice(), [hideNotice])

  useEffect(() => {
    const off = window.spark.on(
      'stream:resource-monitor:pressure-changed',
      (payload: ResourcePressureChangedPayload) => {
        const changedAtMs = Date.parse(payload.changedAt)
        if (Number.isFinite(changedAtMs) && changedAtMs < mountedAtRef.current) return
        handleLevelChange(payload.previousLevel, payload.level, payload.triggeredBy, {
          toast,
          showNotice,
          hideNotice,
        })
      },
    )
    return off
  }, [hideNotice, showNotice, toast])

  return null
}

type NoticeApi = {
  toast: ToastFn
  showNotice: (triggeredBy: string[]) => void
  hideNotice: () => void
}

function handleLevelChange(
  previousLevel: PressureLevel,
  level: PressureLevel,
  triggeredBy: string[],
  api: NoticeApi,
): void {
  // emergency 以下全部静默（2026-09-23 产品决策）：warning/critical 仅内部
  // 限流/暂停派发，性能页可见；消息弹窗只留给即将溢出的 emergency。
  if (level !== 'emergency') {
    api.hideNotice()
    if (level === 'nominal' && previousLevel === 'emergency') {
      api.toast.success('电脑资源已恢复，任务派发已继续', { duration: 4000 })
    }
    return
  }

  api.showNotice(triggeredBy)
  // 只在升级到 emergency 时补系统通知；长时间停在 emergency 不重复打扰。
  if (rank(level) > rank(previousLevel)) {
    sendSystemNotice(triggeredBy)
  }
}

function rank(level: PressureLevel): number {
  switch (level) {
    case 'nominal':
      return 0
    case 'warning':
      return 1
    case 'critical':
      return 2
    case 'emergency':
      return 3
  }
}
