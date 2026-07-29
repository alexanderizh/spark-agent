import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { ChatTurnNavItem } from './chat-turn-navigation'
import './ChatTurnNavigator.less'

const MIN_LEFT_GUTTER = 56
const PREVIEW_OPEN_DELAY_MS = 100
const PREVIEW_CLOSE_DELAY_MS = 80
const PREVIEW_EDGE_GAP = 10

interface PreviewState {
  itemKey: string
  trigger: HTMLElement
}

export function ChatTurnNavigator({
  items,
  scrollRef,
  hasMoreHistory,
  isLoadingOlder,
  onLoadOlder,
  onNavigate,
}: {
  items: ChatTurnNavItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  hasMoreHistory: boolean
  isLoadingOlder: boolean
  onLoadOlder: () => void
  onNavigate: (item: ChatTurnNavItem, behavior: ScrollBehavior) => void
}) {
  const reduceMotion = useReducedMotion() === true
  const markerRefs = useRef(new Map<string, HTMLButtonElement>())
  const previewRef = useRef<HTMLDivElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(() => items.at(-1)?.key ?? null)
  const [rovingKey, setRovingKey] = useState<string | null>(() => items.at(-1)?.key ?? null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0 })
  const [pulseKey, setPulseKey] = useState<string | null>(null)

  const messageIndexToTurnKey = useMemo(() => {
    const map = new Map<number, string>()
    for (const item of items) {
      for (const messageIndex of item.messageIndexes) map.set(messageIndex, item.key)
    }
    return map
  }, [items])

  const clearTimer = (ref: RefObject<number | null>) => {
    if (ref.current == null) return
    window.clearTimeout(ref.current)
    ref.current = null
  }

  const closePreview = useCallback((delay = PREVIEW_CLOSE_DELAY_MS) => {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    closeTimerRef.current = window.setTimeout(() => setPreview(null), delay)
  }, [])

  const openPreview = useCallback((item: ChatTurnNavItem, trigger: HTMLElement, delay: number) => {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    openTimerRef.current = window.setTimeout(
      () => setPreview({ itemKey: item.key, trigger }),
      delay,
    )
  }, [])

  const measureLayout = useCallback(() => {
    const scrollElement = scrollRef.current
    const viewport = scrollElement?.parentElement
    const content = scrollElement?.querySelector<HTMLElement>('.chat-stream-inner')
    if (!scrollElement || !viewport || !content) return
    const viewportRect = viewport.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const leftGutter = contentRect.left - viewportRect.left
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches === true
    const nextVisible = items.length >= 2 && leftGutter >= MIN_LEFT_GUTTER && !coarsePointer
    setVisible((previous) => (previous === nextVisible ? previous : nextVisible))
  }, [items.length, scrollRef])

  useLayoutEffect(() => {
    measureLayout()
    const scrollElement = scrollRef.current
    const viewport = scrollElement?.parentElement
    const content = scrollElement?.querySelector<HTMLElement>('.chat-stream-inner')
    if (!scrollElement || !viewport || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureLayout)
    observer.observe(viewport)
    observer.observe(content)
    window.addEventListener('resize', measureLayout)
    const classObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(measureLayout)
    if (viewport.parentElement != null) {
      classObserver?.observe(viewport.parentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
    }
    return () => {
      observer.disconnect()
      classObserver?.disconnect()
      window.removeEventListener('resize', measureLayout)
    }
  }, [measureLayout, scrollRef])

  const updateActiveTurn = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement || items.length === 0) return
    const scrollRect = scrollElement.getBoundingClientRect()
    const referenceY = scrollRect.top + scrollElement.clientHeight * 0.32
    const rows = Array.from(
      scrollElement.querySelectorAll<HTMLElement>('[data-virtual-message-index]'),
    )
    let closestIndex: number | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    for (const row of rows) {
      const index = Number(row.dataset.virtualMessageIndex)
      if (!Number.isInteger(index)) continue
      const rect = row.getBoundingClientRect()
      const distance =
        referenceY >= rect.top && referenceY <= rect.bottom
          ? 0
          : Math.min(Math.abs(referenceY - rect.top), Math.abs(referenceY - rect.bottom))
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    }

    const key =
      closestIndex == null
        ? (items.at(-1)?.key ?? null)
        : (messageIndexToTurnKey.get(closestIndex) ?? null)
    if (key != null) setActiveKey((previous) => (previous === key ? previous : key))
  }, [items, messageIndexToTurnKey, scrollRef])

  const scheduleActiveTurnUpdate = useCallback(() => {
    if (frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      updateActiveTurn()
    })
  }, [updateActiveTurn])

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return
    scheduleActiveTurnUpdate()
    scrollElement.addEventListener('scroll', scheduleActiveTurnUpdate, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleActiveTurnUpdate)
    observer?.observe(scrollElement)
    return () => {
      scrollElement.removeEventListener('scroll', scheduleActiveTurnUpdate)
      observer?.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [scheduleActiveTurnUpdate, scrollRef])

  const fallbackKey = items.at(-1)?.key ?? null
  const resolvedActiveKey = items.some((item) => item.key === activeKey) ? activeKey : fallbackKey
  const resolvedRovingKey = items.some((item) => item.key === rovingKey) ? rovingKey : fallbackKey
  const previewItem =
    preview == null ? null : (items.find((item) => item.key === preview.itemKey) ?? null)

  useEffect(() => {
    if (resolvedActiveKey == null) return
    const marker = markerRefs.current.get(resolvedActiveKey)
    marker?.scrollIntoView?.({ block: 'nearest' })
  }, [resolvedActiveKey])

  useLayoutEffect(() => {
    if (preview == null || previewItem == null) return
    const triggerRect = preview.trigger.getBoundingClientRect()
    const previewRect = previewRef.current?.getBoundingClientRect()
    const width = previewRect?.width ?? 420
    const height = previewRect?.height ?? 156
    setPreviewPosition({
      left: Math.min(window.innerWidth - width - PREVIEW_EDGE_GAP, triggerRect.right + 10),
      top: Math.max(
        PREVIEW_EDGE_GAP,
        Math.min(window.innerHeight - height - PREVIEW_EDGE_GAP, triggerRect.top - 18),
      ),
    })
  }, [preview, previewItem])

  useEffect(
    () => () => {
      clearTimer(openTimerRef)
      clearTimer(closeTimerRef)
      clearTimer(pulseTimerRef)
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  const navigateTo = (item: ChatTurnNavItem) => {
    setActiveKey(item.key)
    setRovingKey(item.key)
    setPulseKey(item.key)
    clearTimer(pulseTimerRef)
    pulseTimerRef.current = window.setTimeout(
      () => setPulseKey((current) => (current === item.key ? null : current)),
      300,
    )
    closePreview(0)
    onNavigate(item, reduceMotion ? 'auto' : 'smooth')
  }

  const handleMarkerKeyDown = (event: KeyboardEvent<HTMLButtonElement>, itemIndex: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, itemIndex - 1)
    else if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, itemIndex + 1)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Escape') {
      closePreview(0)
      return
    }
    if (nextIndex == null) return
    event.preventDefault()
    const next = items[nextIndex]
    if (next == null) return
    setRovingKey(next.key)
    markerRefs.current.get(next.key)?.focus()
  }

  if (!visible) return null

  return (
    <>
      <nav className="chat-turn-navigator" aria-label="对话轮次导航">
        <div className="chat-turn-navigator-track">
          {hasMoreHistory && (
            <button
              type="button"
              className="chat-turn-marker chat-turn-marker-more"
              aria-label={isLoadingOlder ? '正在加载更早轮次' : '加载更早轮次'}
              title={isLoadingOlder ? '正在加载…' : '加载更早轮次'}
              disabled={isLoadingOlder}
              onClick={onLoadOlder}
            >
              <span className="chat-turn-more-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
          )}
          {items.map((item, itemIndex) => {
            const isActive = item.key === resolvedActiveKey
            const previewId = `chat-turn-preview-${item.ordinal}`
            return (
              <button
                key={item.key}
                ref={(element) => {
                  if (element == null) markerRefs.current.delete(item.key)
                  else markerRefs.current.set(item.key, element)
                }}
                type="button"
                className={`chat-turn-marker${isActive ? ' is-active' : ''}${
                  item.status === 'streaming' ? ' is-streaming' : ''
                }${pulseKey === item.key ? ' is-pulsing' : ''}`}
                tabIndex={item.key === resolvedRovingKey ? 0 : -1}
                aria-label={`第 ${item.ordinal} 轮：${item.userPreview}`}
                aria-current={isActive ? 'location' : undefined}
                aria-describedby={preview?.itemKey === item.key ? previewId : undefined}
                onClick={() => navigateTo(item)}
                onKeyDown={(event) => handleMarkerKeyDown(event, itemIndex)}
                onPointerEnter={(event) =>
                  openPreview(item, event.currentTarget, PREVIEW_OPEN_DELAY_MS)
                }
                onPointerLeave={() => closePreview()}
                onFocus={(event) => openPreview(item, event.currentTarget, 0)}
                onBlur={() => closePreview()}
              >
                <span className="chat-turn-marker-line" aria-hidden="true" />
                {isActive && (
                  <motion.span
                    layoutId="chat-turn-active-indicator"
                    className="chat-turn-marker-active-line"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 420, damping: 34, mass: 0.45 }
                    }
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })}
        </div>
      </nav>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {preview != null && previewItem != null && (
              <motion.div
                ref={previewRef}
                id={`chat-turn-preview-${previewItem.ordinal}`}
                role="tooltip"
                className="chat-turn-preview"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6, scale: 0.985 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -4, scale: 0.99 }}
                transition={{ duration: reduceMotion ? 0.06 : 0.16, ease: 'easeOut' }}
                style={{ left: previewPosition.left, top: previewPosition.top }}
              >
                <div className="chat-turn-preview-user">{previewItem.userPreview}</div>
                <div className="chat-turn-preview-assistant">{previewItem.assistantPreview}</div>
                {previewItem.status === 'streaming' && (
                  <span className="chat-turn-preview-status">执行中</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
