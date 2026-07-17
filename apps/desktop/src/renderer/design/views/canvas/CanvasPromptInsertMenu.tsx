import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CanvasPromptParameterBlock } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { CanvasAsset } from './canvas.types'
import type { CanvasPromptMentionItem } from './canvasPromptMentions'
import {
  filterCanvasPromptInsertItems,
  type CanvasPromptInsertFilter,
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
  onRequestClose(): void
}

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
  onRequestClose,
}: CanvasPromptInsertMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [filter, setFilter] = useState<CanvasPromptInsertFilter>('all')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('right')
  const [fixedPosition, setFixedPosition] = useState({
    top: 0,
    left: 0,
    maxHeight: undefined as number | undefined,
  })
  const filteredItems = useMemo(
    () => filterCanvasPromptInsertItems(items, query, filter, assetById),
    [assetById, filter, items, query],
  )
  const highlightedItem = filteredItems.find((item) => item.id === highlightedId) ?? null

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    if (!fixedToTrigger || !triggerElement) return
    const updatePosition = () => {
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
        if (current.top === top && current.left === left && current.maxHeight === maxHeight) {
          return current
        }
        return { top, left, maxHeight }
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
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

  return (
    <div
      ref={rootRef}
      className="canvas-prompt-insert-menu"
      style={fixedToTrigger ? { position: 'fixed', ...fixedPosition } : undefined}
    >
      <input
        ref={searchRef}
        aria-label="搜索节点与资源"
        className="canvas-prompt-insert-search"
        placeholder="搜索节点、角色、场景或资源"
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
          icon={<Icons.User size={14} />}
          label="角色"
          active={filter === 'character'}
          onClick={() => toggleFilter('character')}
        />
        <Shortcut
          icon={<Icons.Map size={14} />}
          label="场景"
          active={filter === 'scene'}
          onClick={() => toggleFilter('scene')}
        />
      </div>
      <div className="canvas-prompt-insert-section-title">
        <span>{filter === 'character' ? '角色' : filter === 'scene' ? '场景' : '节点与资源'}</span>
        <small>{filteredItems.length}</small>
      </div>
      <div className="canvas-prompt-insert-results" role="listbox">
        {filteredItems.map((item) => (
          <button
            type="button"
            role="option"
            aria-selected={highlightedId === item.id}
            className={`canvas-prompt-insert-result${highlightedId === item.id ? ' is-highlighted' : ''}`}
            key={item.id}
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
        ))}
        {filteredItems.length === 0 ? (
          <div className="canvas-prompt-insert-empty">没有匹配的节点或资源</div>
        ) : null}
      </div>
      {highlightedItem ? (
        <PromptInsertPreview item={highlightedItem} assetById={assetById} side={previewSide} />
      ) : null}
    </div>
  )
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
