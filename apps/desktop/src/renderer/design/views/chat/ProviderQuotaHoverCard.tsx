import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderQuotaSnapshot } from '@spark/protocol'
import { ProviderQuotaChip, useQuotaNow } from '../provider/quota-chip'
import {
  computeAutoRouterHoverCardPosition,
  type AutoRouterHoverCardPosition,
} from './auto-router-hover-card-placement'
import './ProviderQuotaHoverCard.less'

/**
 * 会话模型选择器「渠道行」的悬浮用量卡片（限额注册表命中的渠道才有）。
 *
 * 与 AutoRouterHoverCard 同一套交互与定位策略：portal + position: fixed
 * （菜单容器有 overflow 裁剪），复用几何定位纯函数；卡片 `pointer-events: none`
 * 纯展示。开合状态见 ./useHoverRevealCard（两卡共用同一状态机）。
 * 胶囊本体复用 provider/quota-chip（与渠道卡片限额行同款）。
 */
export function ProviderQuotaHoverCard({
  providerName,
  quota,
  error,
  loading,
  anchorEl,
}: {
  providerName: string
  quota?: ProviderQuotaSnapshot | undefined
  error?: string | undefined
  loading: boolean
  anchorEl: HTMLElement
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const now = useQuotaNow()
  // 先隐形渲染量尺寸，layout effect 里定位后再显示，避免首帧闪现在错误位置
  const [position, setPosition] = useState<AutoRouterHoverCardPosition | null>(null)

  useLayoutEffect(() => {
    const el = cardRef.current
    if (el == null) return
    const rect = el.getBoundingClientRect()
    const anchorRect = anchorEl.getBoundingClientRect()
    setPosition(
      computeAutoRouterHoverCardPosition(
        { left: anchorRect.left, right: anchorRect.right, top: anchorRect.top },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [anchorEl, quota, error, loading])

  return createPortal(
    <div
      ref={cardRef}
      className="composer-provider-quota-card"
      role="tooltip"
      style={
        position == null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
    >
      <div className="composer-provider-quota-card-head">
        <span className="composer-provider-quota-card-name">{providerName}</span>
        {quota?.planLabel != null && (
          <span className="pv_quota_plan" title={`套餐档位：${quota.planLabel}`}>
            {quota.planLabel}
          </span>
        )}
      </div>
      {error != null ? (
        <div className="composer-provider-quota-card-error">{error}</div>
      ) : quota == null ? (
        <div className="composer-provider-quota-card-hint">
          {loading ? '查询中…' : '无限额数据'}
        </div>
      ) : quota.limits.length === 0 ? (
        <div className="composer-provider-quota-card-hint">无限额数据</div>
      ) : (
        <div className="composer-provider-quota-card-chips">
          {quota.limits.map((limit, idx) => (
            <ProviderQuotaChip
              key={`${limit.kind}-${limit.windowLabel}-${idx}`}
              limit={limit}
              now={now}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
