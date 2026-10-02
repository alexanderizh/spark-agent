/**
 * useVoiceHudDrag — 语音 HUD 矩形浮层的自由拖拽定位
 *
 * 设计要点：
 * - 位置以「卡片左上角」语义存储；从未拖拽过（无持久化值）时走 CSS 右下角默认锚点，
 *   首次拖拽把 right/bottom 锚切换为 left/top 内联定位。
 * - 拖拽期间直接写 DOM style（不走 React state），避免 pointermove 频率的全树重渲染；
 *   仅 isDragging 走 state，用于 grabbing 光标。
 * - 位置持久化 localStorage；恢复与窗口 resize 时按视口夹取，保证卡片永远完整可见。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'spark-agent:voice-hud-position'

/** 拖拽/夹取时卡片与视口边缘的最小间距 */
const VIEWPORT_MARGIN = 8

export interface HudPosition {
  x: number
  y: number
}

function isPosition(value: unknown): value is HudPosition {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as { x?: unknown }).x === 'number' &&
    Number.isFinite((value as HudPosition).x) &&
    typeof (value as { y?: unknown }).y === 'number' &&
    Number.isFinite((value as HudPosition).y)
  )
}

/** 解析持久化值；缺失/损坏/字段非法返回 null（回落 CSS 默认锚点） */
export function parseStoredPosition(raw: string | null): HudPosition | null {
  if (raw == null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isPosition(value) ? { x: value.x, y: value.y } : null
  } catch {
    return null
  }
}

/** 视口夹取：卡片完整落在视口内；视口比卡片还小时退化为贴边（margin 处） */
export function clampPosition(
  position: HudPosition,
  cardWidth: number,
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): HudPosition {
  const maxX = Math.max(VIEWPORT_MARGIN, viewportWidth - cardWidth - VIEWPORT_MARGIN)
  const maxY = Math.max(VIEWPORT_MARGIN, viewportHeight - cardHeight - VIEWPORT_MARGIN)
  return {
    x: Math.min(Math.max(position.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_MARGIN), maxY),
  }
}

interface DragState {
  startX: number
  startY: number
  originX: number
  originY: number
}

export interface VoiceHudDragHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
}

export function useVoiceHudDrag(cardRef: React.RefObject<HTMLDivElement | null>): {
  isDragging: boolean
  dragHandlers: VoiceHudDragHandlers
} {
  /** 当前位置；null = 未拖拽过，走 CSS 右下角默认锚点 */
  const positionRef = useRef<HudPosition | null>(null)
  const restoredRef = useRef(false)
  const dragStateRef = useRef<DragState | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // 位置写入内联 left/top，并摘除 CSS 的 right/bottom 锚（fixed 双向锚会拉伸卡片宽度）
  const applyPosition = useCallback((): void => {
    const card = cardRef.current
    const position = positionRef.current
    if (card == null || position == null) return
    card.style.left = `${position.x}px`
    card.style.top = `${position.y}px`
    card.style.right = 'auto'
    card.style.bottom = 'auto'
  }, [cardRef])

  // 首次渲染恢复持久化位置（按当前视口与卡片实际尺寸夹取）；之后每次渲染幂等回放，
  // 保证卡片在 idle 隐藏后重新挂载时位置不丢
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card == null) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const stored = parseStoredPosition(window.localStorage.getItem(STORAGE_KEY))
      if (stored != null) {
        positionRef.current = clampPosition(
          stored,
          card.offsetWidth,
          card.offsetHeight,
          window.innerWidth,
          window.innerHeight,
        )
      }
    }
    applyPosition()
  })

  // 窗口 resize 后重新夹取，防止卡片滞留视口外
  useEffect(() => {
    const handleResize = (): void => {
      const card = cardRef.current
      const position = positionRef.current
      if (card == null || position == null) return
      positionRef.current = clampPosition(
        position,
        card.offsetWidth,
        card.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      )
      applyPosition()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [applyPosition, cardRef])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      const card = cardRef.current
      if (card == null) return
      // 首次拖拽：把 CSS 右下角锚换算成左上角坐标
      const rect = card.getBoundingClientRect()
      positionRef.current = positionRef.current ?? { x: rect.left, y: rect.top }
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: positionRef.current.x,
        originY: positionRef.current.y,
      }
      // 捕获指针：移出卡片仍持续接收 move（jsdom 无此 API，守卫降级不影响其余功能）
      try {
        card.setPointerCapture(event.pointerId)
      } catch {
        // 环境不支持指针捕获时仍可拖拽，只是移出元素后丢失跟踪
      }
      setIsDragging(true)
    },
    [cardRef],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragStateRef.current
      const card = cardRef.current
      if (drag == null || card == null) return
      const next = clampPosition(
        {
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        },
        card.offsetWidth,
        card.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      )
      positionRef.current = next
      applyPosition()
    },
    [applyPosition, cardRef],
  )

  // pointerup / pointercancel 统一收尾：清拖拽态并持久化（cancel 时位置同样有效）
  const settlePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (dragStateRef.current == null) return
      dragStateRef.current = null
      setIsDragging(false)
      const card = cardRef.current
      try {
        card?.releasePointerCapture(event.pointerId)
      } catch {
        // 捕获本就未建立或已释放，忽略
      }
      const position = positionRef.current
      if (position != null) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
      }
    },
    [cardRef],
  )

  const dragHandlers: VoiceHudDragHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: settlePointer,
    onPointerCancel: settlePointer,
  }

  return { isDragging, dragHandlers }
}
