import { useMemo, useRef, useState } from 'react'
import { Input, Popover } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import {
  buildCanvasPromptMentionItems,
  filterCanvasPromptMentionItems,
  findCanvasPromptMentionQuery,
  insertCanvasPromptMention,
  type CanvasPromptMentionItem,
  type CanvasPromptMentionQuery,
} from './canvasPromptMentions'

export function CanvasPromptMentionTextArea({
  value,
  rows,
  placeholder,
  disabled,
  className,
  mentionNodes,
  assets,
  onChange,
  onMentionSelect,
}: {
  value: string
  rows: number
  placeholder?: string
  disabled?: boolean
  className?: string
  mentionNodes?: CanvasNode[]
  assets?: CanvasAsset[]
  onChange: (value: string) => void
  onMentionSelect?: (node: CanvasNode, marker: string) => boolean | void
}) {
  const textAreaRef = useRef<TextAreaRef | null>(null)
  const [mention, setMention] = useState<CanvasPromptMentionQuery>(() =>
    findCanvasPromptMentionQuery('', 0),
  )
  const mentionItems = useMemo(
    () => buildCanvasPromptMentionItems(mentionNodes ?? []),
    [mentionNodes],
  )
  const assetById = useMemo(
    () => new Map((assets ?? []).map((asset) => [asset.id, asset])),
    [assets],
  )
  const filteredItems = useMemo(
    () => filterCanvasPromptMentionItems(mentionItems, mention.query).slice(0, 8),
    [mention.query, mentionItems],
  )
  const mentionOpen = !disabled && mention.active && filteredItems.length > 0

  const updateMentionFromTextarea = (textarea: HTMLTextAreaElement) => {
    setMention(findCanvasPromptMentionQuery(textarea.value, textarea.selectionStart))
  }

  const selectMention = (item: CanvasPromptMentionItem) => {
    const accepted = onMentionSelect?.(item.node, item.marker)
    if (accepted === false) return
    const next = insertCanvasPromptMention(value, mention, item)
    onChange(next.value)
    setMention(findCanvasPromptMentionQuery(next.value, next.cursor))
    requestAnimationFrame(() => {
      const textarea = textAreaRef.current?.resizableTextArea?.textArea
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  return (
    <Popover
      open={mentionOpen}
      placement="topLeft"
      trigger="click"
      overlayClassName="canvas-prompt-mention-popover"
      content={
        <div className="canvas-prompt-mention-list">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="canvas-prompt-mention-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectMention(item)}
            >
              <span className="canvas-prompt-mention-thumb">
                {renderMentionThumb(item.node, assetById)}
              </span>
              <span className="canvas-prompt-mention-main">
                <span className="canvas-prompt-mention-label">{item.label}</span>
                <span className="canvas-prompt-mention-type">
                  {nodeMentionTypeLabel(item.node)}
                </span>
              </span>
              <span className="canvas-prompt-mention-marker">{item.marker}</span>
            </button>
          ))}
        </div>
      }
    >
      <Input.TextArea
        ref={textAreaRef}
        rows={rows}
        value={value}
        {...(className != null ? { className } : {})}
        {...(placeholder != null ? { placeholder } : {})}
        {...(disabled != null ? { disabled } : {})}
        onChange={(event) => {
          onChange(event.target.value)
          updateMentionFromTextarea(event.target)
        }}
        onClick={(event) => updateMentionFromTextarea(event.currentTarget)}
        onKeyUp={(event) => updateMentionFromTextarea(event.currentTarget)}
        onBlur={() => {
          window.setTimeout(() => {
            setMention((current) => ({ ...current, active: false }))
          }, 120)
        }}
      />
    </Popover>
  )
}

function nodeMentionTypeLabel(node: CanvasNode): string {
  if (node.type === 'image') return '图片'
  if (node.type === 'video') return '视频'
  if (node.type === 'audio') return '音频'
  if (node.type === 'prompt') return '提示词'
  if (node.type === 'text') return '文本'
  return '资产'
}

function renderMentionThumb(node: CanvasNode, assetById: Map<string, CanvasAsset>) {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  if (asset) return <AssetThumbnail asset={asset} />
  if (node.type === 'video') return <Icons.Play size={18} />
  if (node.type === 'image') return <Icons.Image size={18} />
  return <Icons.File size={18} />
}
