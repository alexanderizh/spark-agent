/**
 * @module PressureNoticeHost
 *
 * 压力降级通知（M2 收尾 / M3 挂载）：监听 stream:resource-monitor:pressure-changed，
 * 三形态呈现（方案 §5 通知矩阵）——
 *  - 升入 warning：Toast 轻提示（不打断操作）；
 *  - 升入 critical / emergency：应用内常驻横幅（可手动关闭；压力恢复自动消失）；
 *  - 升入 emergency：同步发送一条系统通知；
 *  - 恢复至 nominal：横幅消失 +「性能已恢复」Toast。
 * 同一时刻仅显示最高级别横幅。页面加载前已发生的级别不补发通知
 * （历史回看走性能页事件列表）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, OctagonAlert, X } from 'lucide-react'
import type { PressureLevel, ResourcePressureChangedPayload } from '@spark/protocol'
import { pressureActionCopy } from './performance-format'
import { useToast } from '../components/Toast'
import { useApp } from '../AppContext'

interface BannerState {
  level: 'critical' | 'emergency'
  changedAt: string
  triggeredBy: string[]
}

const TRIGGER_LABELS: Record<string, string> = {
  'system-used-pct': '系统内存',
  'app-footprint-pct': '应用占用',
  'host-rss-pct': '宿主内存',
  'children-rss-pct': '子进程内存',
  'children-count': '子进程数',
  'event-loop-delay-ms': '事件循环延迟',
}

function triggerSummary(keys: string[]): string {
  const labels = keys.map((key) => TRIGGER_LABELS[key] ?? key)
  return labels.length > 0 ? labels.join('、') : '资源指标'
}

function bannerTitle(level: 'critical' | 'emergency'): string {
  return level === 'emergency' ? '危急：已暂停全部新任务派发' : '性能降级：新任务派发已暂停'
}

function bannerBody(level: 'critical' | 'emergency', keys: string[]): string {
  const triggers = triggerSummary(keys)
  if (level === 'emergency') {
    return `${triggers}压力越过危急阈值，${pressureActionCopy('emergency')}。进行中任务的输入已保留，压力恢复后自动重新调度。建议结束闲置会话或稍后重启应用释放资源。`
  }
  return `${triggers}压力超过严重阈值，${pressureActionCopy('critical')}。进行中的任务不受影响，压力恢复后自动重新派发。`
}

/** emergency 系统通知（Electron 渲染层 web Notification；失败静默——横幅仍在）。 */
function sendSystemNotice(keys: string[]): void {
  try {
    if (typeof Notification === 'undefined') return
    const body = `${triggerSummary(keys)}压力越过危急阈值，已暂停全部新任务派发。点击查看性能页详情。`
    const notice = new Notification('SparkWork 性能危急', { body, silent: true })
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
          navigateToPerformance,
        )
      },
    )
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="perf-notice-host">
      {banner != null && (
        <div className={`perf-notice ${banner.level === 'critical' ? 'lvl-c' : 'lvl-e'}`}>
          <span className="n-ic">
            {banner.level === 'emergency' ? (
              <OctagonAlert size={17} />
            ) : (
              <AlertTriangle size={17} />
            )}
          </span>
          <div className="n-c">
            <div className="n-title">{bannerTitle(banner.level)}</div>
            <div className="n-body">{bannerBody(banner.level, banner.triggeredBy)}</div>
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
  navigateToPerformance: () => void,
): void {
  const upgraded = rank(level) > rank(previousLevel)

  if (level === 'nominal') {
    setBanner(null)
    if (previousLevel !== 'nominal') {
      toast.success('性能已恢复', { duration: 4000 })
    }
    return
  }

  if (level === 'warning') {
    setBanner(null)
    if (upgraded) {
      toast.warning('内存压力升高，新任务将延迟排队', {
        duration: 8000,
        actions: [{ label: '查看性能', onClick: navigateToPerformance }],
      })
    }
    return
  }

  // critical / emergency：常驻横幅（同一时刻仅最高级别）。
  setBanner((current) => {
    if (current != null && rank(current.level) > rank(level)) return current
    return {
      level: level as 'critical' | 'emergency',
      changedAt: new Date().toISOString(),
      triggeredBy,
    }
  })
  if (level === 'emergency' && upgraded) {
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
