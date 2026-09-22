/**
 * @module PressureNoticeHost
 *
 * 压力降级通知（M2 收尾 / M3 挂载）：监听 stream:resource-monitor:pressure-changed。
 * 2026-09-23 产品决策：常态使用完全静默——warning（限流）/ critical（暂停新派发）
 * 不再弹任何提示（状态在性能页可见），只有 emergency（即将溢出，已熔断全部派发）
 * 才通知用户：应用内常驻横幅 + 一条系统通知；压力降回 emergency 以下横幅消失，
 * 完全恢复（nominal）时补一条「电脑资源已恢复」。页面加载前已发生的级别不补发
 * （历史回看走性能页事件列表）。
 * 文案导向（同日用户反馈）：主语必须是「电脑资源压力」而非「应用性能」——
 * 这是系统资源保护机制的说辞，避免用户误以为应用本身出了故障。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { OctagonAlert, X } from 'lucide-react'
import type { PressureLevel, ResourcePressureChangedPayload } from '@spark/protocol'
import { useToast } from '../components/Toast'
import { useApp } from '../AppContext'

interface BannerState {
  changedAt: string
  triggeredBy: string[]
}

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

function bannerBody(keys: string[]): string {
  return `检测到电脑整体${describePhenomena(keys)}。为避免电脑进一步变慢，Spark 已主动暂停新任务派发——这是系统资源保护机制，不是应用故障。进行中的任务不受影响；关闭闲置应用或会话、释放电脑资源后，会自动恢复派发。`
}

/** emergency 系统通知（Electron 渲染层 web Notification；失败静默——横幅仍在）。 */
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
    /* 横幅仍在，系统通知失败可接受 */
  }
}

export function PressureNoticeHost() {
  const toastCtx = useToast()
  const { setTweak } = useApp()
  const [banner, setBanner] = useState<BannerState | null>(null)
  /** 页面加载标记（首个 effect 填充）：早于挂载的流事件不弹通知，避免每次切页补报。 */
  const mountedAtRef = useRef<number>(0)

  const navigateToPerformance = useCallback((): void => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'performance')
  }, [setTweak])

  useEffect(() => {
    mountedAtRef.current = Date.now()
  }, [])

  useEffect(() => {
    const off = window.spark.on(
      'stream:resource-monitor:pressure-changed',
      (payload: ResourcePressureChangedPayload) => {
        const changedAtMs = Date.parse(payload.changedAt)
        if (Number.isFinite(changedAtMs) && changedAtMs < mountedAtRef.current) return
        handleLevelChange(
          toastCtx.toast,
          setBanner,
          payload.previousLevel,
          payload.level,
          payload.triggeredBy,
        )
      },
    )
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="perf-notice-host">
      {banner != null && (
        <div className="perf-notice lvl-e">
          <span className="n-ic">
            <OctagonAlert size={17} />
          </span>
          <div className="n-c">
            <div className="n-title">电脑资源压力较高，已暂停新任务</div>
            <div className="n-body">{bannerBody(banner.triggeredBy)}</div>
            <div className="n-actions">
              <button className="n-link" onClick={navigateToPerformance}>
                查看性能
              </button>
            </div>
          </div>
          <button className="n-x" title="关闭" aria-label="关闭" onClick={() => setBanner(null)}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

type SetBanner = React.Dispatch<React.SetStateAction<BannerState | null>>
type ToastApi = ReturnType<typeof useToast>['toast']

function handleLevelChange(
  toast: ToastApi,
  setBanner: SetBanner,
  previousLevel: PressureLevel,
  level: PressureLevel,
  triggeredBy: string[],
): void {
  // emergency 以下全部静默（2026-09-23 产品决策）：warning/critical 仅内部
  // 限流/暂停派发，性能页可见；弹窗提示只留给即将溢出的 emergency。
  if (level !== 'emergency') {
    setBanner(null)
    if (level === 'nominal' && previousLevel === 'emergency') {
      toast.success('电脑资源已恢复，任务派发已继续', { duration: 4000 })
    }
    return
  }

  setBanner({ changedAt: new Date().toISOString(), triggeredBy })
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
