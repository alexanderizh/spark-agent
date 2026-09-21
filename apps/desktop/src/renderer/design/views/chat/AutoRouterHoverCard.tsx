import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AutoRouterHoverCardModel } from './auto-router-hover-card-model'
import {
  computeAutoRouterHoverCardPosition,
  type AutoRouterHoverCardPosition,
} from './auto-router-hover-card-placement'
import './AutoRouterHoverCard.less'

/**
 * 会话模型选择器「智能路由」行的悬浮配置卡片。
 *
 * 纯展示：卡片 `pointer-events: none`，不吃点击也不挡滚动，不需要"悬停接力"，
 * 指针离开行即关闭。定位走 portal + position: fixed（菜单容器有 overflow 裁剪，
 * 卡片必须挂到 document.body），层级 3600 高于 CLI 子菜单的 3500。
 * 开合状态见 ./useAutoRouterHoverCard。
 */

export function AutoRouterHoverCard({
  model,
  anchorEl,
}: {
  model: AutoRouterHoverCardModel
  anchorEl: HTMLElement
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
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
  }, [anchorEl, model])

  return createPortal(
    <div
      ref={cardRef}
      className="composer-auto-router-card"
      role="tooltip"
      style={
        position == null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
    >
      <div className="composer-auto-router-card-head">
        <span className="composer-auto-router-card-name">{model.name}</span>
        {model.adapterLabel.length > 0 && (
          <span className="composer-auto-router-card-adapter">{model.adapterLabel}</span>
        )}
      </div>
      {model.error != null ? (
        <div className="composer-auto-router-card-error">{model.error}</div>
      ) : (
        <>
          <div className="composer-auto-router-card-rows">
            {model.rows.map((row) => (
              <div key={row.key} className="composer-auto-router-card-row">
                <span
                  className={`composer-auto-router-card-dot${
                    row.dotColor == null ? ' is-placeholder' : row.isFallback ? ' is-empty' : ''
                  }`}
                  style={row.dotColor == null ? undefined : { color: row.dotColor }}
                  aria-hidden
                />
                <span className="composer-auto-router-card-row-label">{row.label}</span>
                <span className="composer-auto-router-card-row-model">{row.modelLabel}</span>
                {row.providerLabel != null && (
                  <span className="composer-auto-router-card-row-provider">
                    {row.providerLabel}
                  </span>
                )}
                {row.meta != null && (
                  <span className="composer-auto-router-card-row-meta">{row.meta}</span>
                )}
              </div>
            ))}
          </div>
          <div className="composer-auto-router-card-footer">{model.footer}</div>
        </>
      )}
    </div>,
    document.body,
  )
}
