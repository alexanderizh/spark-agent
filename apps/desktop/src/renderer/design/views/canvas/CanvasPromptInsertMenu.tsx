import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CanvasPromptParameterBlock } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { CanvasAsset } from './canvas.types'
import type { CanvasPromptMentionItem } from './canvasPromptMentions'
import {
  filterCanvasPromptInsertItems,
  type CanvasPromptInsertFilter,
  type CanvasPromptInsertSort,
} from './canvasPromptInsertMenuModel'
import {
  canvasPromptNodeTypeLabel,
  previewCanvasPromptNodeContent,
  renderCanvasPromptNodeHoverMedia,
  renderCanvasPromptNodeThumbnail,
} from './CanvasPromptLexicalNode'

export type CanvasPromptInsertMenuProps = {
  items: CanvasPromptMentionItem[]
  assetById: Map<string, CanvasAsset>
  query: string
  autoFocus?: boolean
  triggerElement?: HTMLElement | null
  fixedToTrigger?: boolean
  onQueryChange(query: string): void
  onInsertParameter(parameter: CanvasPromptParameterBlock['parameter']): void
  onInsertReference(item: CanvasPromptMentionItem): void
  onPickFromCanvas?(): void
  onRequestClose(): void
}

const PROMPT_INSERT_PINNED_STORAGE_PREFIX = 'spark-canvas:prompt-insert-pinned:v1:'
const PROMPT_INSERT_SORT_STORAGE_KEY = 'spark-canvas:prompt-insert-sort:v1'

export function CanvasPromptInsertMenu({
  items,
  assetById,
  query,
  autoFocus = false,
  triggerElement,
  fixedToTrigger = false,
  onQueryChange,
  onInsertParameter,
  onInsertReference,
  onPickFromCanvas,
  onRequestClose,
}: CanvasPromptInsertMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [filter, setFilter] = useState<CanvasPromptInsertFilter>('all')
  const [sort, setSort] = useState<CanvasPromptInsertSort>(readStoredSort)
  const projectId = items[0]?.node.projectId ?? 'unknown'
  const pinnedStorageKey = `${PROMPT_INSERT_PINNED_STORAGE_PREFIX}${projectId}`
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinnedIds(pinnedStorageKey))
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('right')
  const [fixedPosition, setFixedPosition] = useState<{
    top: number
    left: number
    maxHeight: number | undefined
  } | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const filteredItems = useMemo(
    () => filterCanvasPromptInsertItems(items, query, filter, assetById, sort, pinnedIds),
    [assetById, filter, items, pinnedIds, query, sort],
  )
  const highlightedItem = filteredItems.find((item) => item.id === highlightedId) ?? null

  // 结果列表可滚动时显示「跳到底部」按钮：距底 > 48px 视为不在底部。
  const updateJumpState = useCallback(() => {
    const el = resultsRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowJumpToBottom(distance > 48)
  }, [])

  useLayoutEffect(() => {
    const el = resultsRef.current
    if (!el) return
    el.addEventListener('scroll', updateJumpState, { passive: true })
    return () => el.removeEventListener('scroll', updateJumpState)
  }, [updateJumpState])

  useLayoutEffect(() => {
    updateJumpState()
  }, [filteredItems, fixedPosition, updateJumpState])

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    if (!fixedToTrigger || !triggerElement) return
    const updatePosition = () => {
      if (!triggerElement.isConnected) {
        setFixedPosition(null)
        return
      }
      const triggerRect = triggerElement.getBoundingClientRect()
      const menuRect = rootRef.current?.getBoundingClientRect()
      const viewportMargin = 12
      const triggerGap = 6
      const menuWidth = menuRect?.width || 340
      const menuHeight = menuRect?.height || 0
      const spaceBelow = Math.max(
        0,
        window.innerHeight - triggerRect.bottom - triggerGap - viewportMargin,
      )
      const spaceAbove = Math.max(0, triggerRect.top - triggerGap - viewportMargin)
      const placeBelow = menuHeight <= spaceBelow || spaceBelow >= spaceAbove
      const maxHeight = placeBelow ? spaceBelow : spaceAbove
      const top = placeBelow
        ? triggerRect.bottom + triggerGap
        : Math.max(viewportMargin, triggerRect.top - triggerGap - Math.min(menuHeight, maxHeight))
      const left = Math.max(
        viewportMargin,
        Math.min(triggerRect.left, window.innerWidth - menuWidth - viewportMargin),
      )
      setFixedPosition((current) => {
        if (current?.top === top && current.left === left && current.maxHeight === maxHeight) {
          return current
        }
        return { top, left, maxHeight }
      })
    }
    updatePosition()
    const triggerPositionObserver = new MutationObserver(updatePosition)
    triggerPositionObserver.observe(triggerElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      triggerPositionObserver.disconnect()
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [filteredItems.length, fixedToTrigger, triggerElement])

  useEffect(() => {
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target) || triggerElement?.contains(target)) return
      onRequestClose()
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRequestClose()
    }
    document.addEventListener('pointerdown', closeFromPointer, true)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer, true)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [onRequestClose, triggerElement])

  const highlight = (item: CanvasPromptMentionItem) => {
    setHighlightedId(item.id)
    const menuRect = rootRef.current?.getBoundingClientRect()
    setPreviewSide(menuRect && menuRect.right + 272 > window.innerWidth ? 'left' : 'right')
  }

  const moveHighlight = (direction: 1 | -1) => {
    if (filteredItems.length === 0) return
    const currentIndex = filteredItems.findIndex((item) => item.id === highlightedId)
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : filteredItems.length - 1
        : (currentIndex + direction + filteredItems.length) % filteredItems.length
    const nextItem = filteredItems[nextIndex]
    if (nextItem) highlight(nextItem)
  }

  const toggleFilter = (nextFilter: Exclude<CanvasPromptInsertFilter, 'all'>) => {
    setFilter((current) => (current === nextFilter ? 'all' : nextFilter))
    setHighlightedId(null)
  }

  const changeSort = (nextSort: CanvasPromptInsertSort) => {
    setSort(nextSort)
    try {
      window.localStorage.setItem(PROMPT_INSERT_SORT_STORAGE_KEY, nextSort)
    } catch {
      // 偏好持久化失败不影响列表使用。
    }
  }

  const togglePinned = (itemId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      try {
        window.localStorage.setItem(pinnedStorageKey, JSON.stringify([...next]))
      } catch {
        // 置顶持久化失败时仍保留本次弹窗内状态。
      }
      return next
    })
  }

  return (
    <div
      ref={rootRef}
      className={`canvas-prompt-insert-menu${onPickFromCanvas ? ' has-canvas-pick' : ''}`}
      style={
        fixedToTrigger
          ? {
              position: 'fixed',
              ...(fixedPosition ?? { visibility: 'hidden' }),
            }
          : undefined
      }
    >
      <input
        ref={searchRef}
        aria-label="搜索节点与资源"
        className="canvas-prompt-insert-search"
        placeholder="搜索节点、图片、视频或资源"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key === 'Enter') {
            const item = highlightedItem ?? filteredItems[0]
            if (item) {
              event.preventDefault()
              onInsertReference(item)
            }
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onRequestClose()
          }
        }}
      />
      {onPickFromCanvas ? (
        <button
          type="button"
          className="canvas-prompt-insert-canvas-pick"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPickFromCanvas}
        >
          <span className="canvas-prompt-insert-canvas-pick-icon">
            <Icons.MousePointer size={16} />
          </span>
          <span>
            <strong>从画布点选节点</strong>
            <small>菜单关闭后，单击画布中的节点插入 Tag</small>
          </span>
        </button>
      ) : null}
      <div className="canvas-prompt-insert-shortcuts">
        <Shortcut
          icon={<Icons.Clock size={14} />}
          label="镜头时长"
          onClick={() => onInsertParameter('duration')}
        />
        <Shortcut
          icon={<Icons.MessageSquare size={14} />}
          label="台词"
          onClick={() => onInsertParameter('dialogue')}
        />
        <Shortcut
          icon={<Icons.Crosshair size={14} />}
          label="站位"
          onClick={() => onInsertParameter('blocking')}
        />
        <Shortcut
          icon={<Icons.Image size={14} />}
          label="图片"
          active={filter === 'image'}
          onClick={() => toggleFilter('image')}
        />
        <Shortcut
          icon={<Icons.Video size={14} />}
          label="视频"
          active={filter === 'video'}
          onClick={() => toggleFilter('video')}
        />
      </div>
      <div className="canvas-prompt-insert-section-title">
        <span>
          {filter === 'image' ? '图片' : filter === 'video' ? '视频' : '节点与资源'}
          <small>{filteredItems.length}</small>
        </span>
        <select
          aria-label="列表排序"
          value={sort}
          onChange={(event) => changeSort(event.target.value as CanvasPromptInsertSort)}
        >
          <option value="updated">最近修改</option>
          <option value="created">最近添加</option>
        </select>
      </div>
      <div ref={resultsRef} className="canvas-prompt-insert-results" role="list">
        {filteredItems.map((item) => {
          const pinned = pinnedIds.has(item.id)
          return (
            <div className="canvas-prompt-insert-result-row" role="listitem" key={item.id}>
              <button
                type="button"
                className={`canvas-prompt-insert-result${highlightedId === item.id ? ' is-highlighted' : ''}`}
                onMouseEnter={() => highlight(item)}
                onFocus={() => highlight(item)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsertReference(item)}
              >
                <span className="canvas-prompt-menu-thumb">
                  {renderCanvasPromptNodeThumbnail(item.node, assetById)}
                </span>
                <span className="canvas-prompt-menu-copy">
                  <strong>{item.label}</strong>
                  <small>{canvasPromptNodeTypeLabel(item.node)}</small>
                </span>
              </button>
              <button
                type="button"
                className={`canvas-prompt-insert-pin${pinned ? ' is-pinned' : ''}`}
                aria-label={`${pinned ? '取消置顶' : '置顶'}${item.label}`}
                aria-pressed={pinned}
                title={pinned ? '取消置顶' : '置顶'}
                onMouseEnter={() => highlight(item)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => togglePinned(item.id)}
              >
                {pinned ? <Icons.PinFill size={13} /> : <Icons.Pin size={13} />}
              </button>
            </div>
          )
        })}
        {filteredItems.length === 0 ? (
          <div className="canvas-prompt-insert-empty" role="status">
            没有匹配的节点或资源
          </div>
        ) : null}
      </div>
      {showJumpToBottom ? (
        <button
          type="button"
          className="canvas-prompt-insert-jump"
          aria-label="跳到底部"
          title="跳到底部"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const el = resultsRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          }}
        >
          <Icons.ArrowDown size={14} />
        </button>
      ) : null}
      {highlightedItem ? (
        <PromptInsertPreview item={highlightedItem} assetById={assetById} side={previewSide} />
      ) : null}
    </div>
  )
}

function readStoredSort(): CanvasPromptInsertSort {
  try {
    return window.localStorage.getItem(PROMPT_INSERT_SORT_STORAGE_KEY) === 'created'
      ? 'created'
      : 'updated'
  } catch {
    return 'updated'
  }
}

function readPinnedIds(storageKey: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

function PromptInsertPreview({
  item,
  assetById,
  side,
}: {
  item: CanvasPromptMentionItem
  assetById: Map<string, CanvasAsset>
  side: 'left' | 'right'
}) {
  const media = renderCanvasPromptNodeHoverMedia(item.node, assetById)
  const content = previewCanvasPromptNodeContent(item.node, assetById)
  return (
    <aside className={`canvas-prompt-insert-preview is-${side}`} aria-label={`${item.label}预览`}>
      {media ? <div className="canvas-prompt-insert-preview-media">{media}</div> : null}
      <div className="canvas-prompt-insert-preview-copy">
        <strong>{item.label}</strong>
        <small>{canvasPromptNodeTypeLabel(item.node)}</small>
        {!media ? <div className="canvas-prompt-insert-preview-text">{content}</div> : null}
      </div>
    </aside>
  )
}

function Shortcut({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick(): void
}) {
  return (
    <button type="button" className={active ? 'is-active' : ''} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}
