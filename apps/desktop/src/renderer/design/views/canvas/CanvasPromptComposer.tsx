import { useMemo, useState, type KeyboardEvent } from 'react'
import type {
  CanvasPromptBlock,
  CanvasPromptDocument,
  CanvasPromptReferenceBlock,
  CanvasPromptRelation,
} from '@spark/protocol'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { CanvasPromptHoverCard } from './CanvasPromptHoverCard'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { buildCanvasPromptMentionItems, filterCanvasPromptMentionItems } from './canvasPromptMentions'
import { readCanvasTextInputContent } from './canvasTextInputPresentation'
import { Icons } from '../../Icons'

type MentionState = {
  blockId: string
  start: number
  end: number
  query: string
}

export type CanvasPromptComposerProps = {
  document: CanvasPromptDocument
  mentionNodes: CanvasNode[]
  assets: CanvasAsset[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onChange(document: CanvasPromptDocument): void
  onMentionSelect?(node: CanvasNode, relation: CanvasPromptRelation): boolean | void
  onBlockEdit?(blockId: string): void
}

export function CanvasPromptComposer({
  document,
  mentionNodes,
  assets,
  placeholder,
  disabled,
  className,
  onChange,
  onMentionSelect,
  onBlockEdit,
}: CanvasPromptComposerProps) {
  const [mention, setMention] = useState<MentionState | null>(null)
  const [parameterMenuOpen, setParameterMenuOpen] = useState(false)
  const nodeById = useMemo(() => new Map(mentionNodes.map((node) => [node.id, node])), [mentionNodes])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const mentionItems = useMemo(() => buildCanvasPromptMentionItems(mentionNodes), [mentionNodes])
  const candidates = useMemo(
    () => filterCanvasPromptMentionItems(mentionItems, mention?.query ?? '').slice(0, 8),
    [mention?.query, mentionItems],
  )
  const blocks = document.blocks.length > 0 ? document.blocks : [{ kind: 'text' as const, id: 'draft', text: '' }]

  const updateText = (block: Extract<CanvasPromptBlock, { kind: 'text' }>, text: string) => {
    const exists = document.blocks.some((item) => item.id === block.id)
    const next = exists
      ? document.blocks.map((item) => (item.id === block.id ? { ...block, text } : item))
      : [{ ...block, text }]
    onChange({ version: 2, blocks: next })
  }

  const detectMention = (
    block: Extract<CanvasPromptBlock, { kind: 'text' }>,
    event: KeyboardEvent<HTMLSpanElement>,
  ) => {
    const text = event.currentTarget.textContent ?? ''
    const selection = window.getSelection()
    const cursor = selection?.anchorNode && event.currentTarget.contains(selection.anchorNode)
      ? selection.anchorOffset
      : text.length
    const before = text.slice(0, cursor)
    const start = before.lastIndexOf('@')
    if (start < 0 || /[\s\n\r\t,，。；;:：()[\]{}<>]/.test(before.slice(start + 1))) {
      setMention(null)
      return
    }
    setMention({ blockId: block.id, start, end: cursor, query: before.slice(start + 1) })
  }

  const selectMention = (node: CanvasNode, label: string) => {
    if (!mention) return
    const relation = defaultRelationForNode(node)
    if (onMentionSelect?.(node, relation) === false) return
    const sourceBlock = blocks.find((block) => block.kind === 'text' && block.id === mention.blockId)
    if (!sourceBlock || sourceBlock.kind !== 'text') return
    const reference: CanvasPromptReferenceBlock = {
      kind: 'reference',
      id: uniqueBlockId(document, `reference-${node.id}`),
      source: 'manual',
      sourceNodeId: node.id,
      relation,
      label,
      order: document.blocks.filter((block) => block.kind === 'reference').length,
    }
    const before = sourceBlock.text.slice(0, mention.start)
    const after = sourceBlock.text.slice(mention.end)
    const next: CanvasPromptBlock[] = []
    for (const block of blocks) {
      if (block.id !== sourceBlock.id) {
        next.push(block)
        continue
      }
      if (before) next.push({ kind: 'text', id: `${block.id}-before`, text: before })
      next.push(reference)
      next.push({ kind: 'text', id: `${block.id}-after`, text: after || ' ' })
    }
    onChange({ version: 2, blocks: next })
    setMention(null)
  }

  const addParameter = (parameter: 'duration' | 'dialogue' | 'blocking') => {
    const label = parameter === 'duration' ? '请设置时长' : parameter === 'dialogue' ? '请输入台词' : '请输入站位信息'
    onChange({
      version: 2,
      blocks: [
        ...document.blocks,
        { kind: 'parameter', id: uniqueBlockId(document, `parameter-${parameter}`), parameter, value: label },
        { kind: 'text', id: uniqueBlockId(document, 'text-after-parameter'), text: ' ' },
      ],
    })
    setParameterMenuOpen(false)
  }

  return (
    <div className={`canvas-prompt-composer${className ? ` ${className}` : ''}`}>
      <div className="canvas-prompt-composer-toolbar">
        <button
          type="button"
          className="canvas-prompt-composer-add"
          aria-label="添加提示词参数"
          disabled={disabled}
          onClick={() => setParameterMenuOpen((open) => !open)}
        >
          <Icons.Plus size={16} />
        </button>
        <span>{placeholder ?? '使用 @ 引用角色、场景、道具、音色及参考素材'}</span>
        {parameterMenuOpen ? (
          <div className="canvas-prompt-parameter-menu">
            <button type="button" onClick={() => addParameter('duration')}>添加镜头时长</button>
            <button type="button" onClick={() => addParameter('dialogue')}>添加台词</button>
            <button type="button" onClick={() => addParameter('blocking')}>添加站位信息</button>
          </div>
        ) : null}
      </div>
      <div className="canvas-prompt-composer-body" aria-label="提示词编排器">
        {blocks.map((block) => {
          if (block.kind === 'text') {
            return (
              <span
                key={block.id}
                className="canvas-prompt-text-block"
                contentEditable={!disabled}
                suppressContentEditableWarning
                data-placeholder={placeholder}
                onInput={(event) => updateText(block, event.currentTarget.textContent ?? '')}
                onKeyUp={(event) => detectMention(block, event)}
                onBlur={() => window.setTimeout(() => setMention(null), 120)}
              >
                {block.text}
              </span>
            )
          }
          return renderAtomicBlock({
            block,
            nodeById,
            assetById,
            ...(disabled != null ? { disabled } : {}),
            ...(onBlockEdit ? { onBlockEdit } : {}),
          })
        })}
        {mention && candidates.length > 0 ? (
          <div className="canvas-prompt-mention-menu">
            {candidates.map((item) => (
              <button
                type="button"
                key={item.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(item.node, item.label)}
              >
                <span>{renderNodeThumbnail(item.node, assetById)}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function renderAtomicBlock(input: {
  block: Exclude<CanvasPromptBlock, { kind: 'text' }>
  nodeById: Map<string, CanvasNode>
  assetById: Map<string, CanvasAsset>
  disabled?: boolean
  onBlockEdit?: (blockId: string) => void
}) {
  const { block } = input
  if (block.kind === 'parameter') {
    return (
      <button
        key={block.id}
        type="button"
        className="canvas-prompt-chip is-parameter"
        disabled={input.disabled}
        onClick={() => input.onBlockEdit?.(block.id)}
      >
        <span className="canvas-prompt-chip-icon">{block.parameter === 'duration' ? '◷' : block.parameter === 'dialogue' ? '▤' : '⌖'}</span>
        <span>{String(block.value)}{block.unit ? ` ${block.unit}` : ''}</span>
      </button>
    )
  }
  const node = input.nodeById.get(block.sourceNodeId)
  const label = block.kind === 'reference' ? block.label : block.summary
  const content = node ? previewNodeContent(node, input.assetById) : '引用节点已删除，请重新绑定后再提交。'
  const relation = block.kind === 'reference' ? block.relation : block.schema
  const thumbnail = node ? renderNodeThumbnail(node, input.assetById) : <span className="canvas-prompt-chip-icon">!</span>
  const chip = (
    <button
      key={block.id}
      type="button"
      className={`canvas-prompt-chip${node ? '' : ' is-invalid'}`}
      aria-invalid={!node}
      disabled={input.disabled}
      onClick={() => input.onBlockEdit?.(block.id)}
    >
      <span className="canvas-prompt-chip-thumb">{thumbnail}</span>
      <span className="canvas-prompt-chip-copy"><strong>{label}</strong><small>{relation}</small></span>
    </button>
  )
  return (
    <CanvasPromptHoverCard
      key={block.id}
      title={label}
      preview={thumbnail}
      metadata={[{ label: '关系', value: relation }, { label: '来源', value: node?.title ?? block.sourceNodeId }]}
      content={content}
    >
      {chip}
    </CanvasPromptHoverCard>
  )
}

function renderNodeThumbnail(node: CanvasNode, assetById: Map<string, CanvasAsset>) {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  if (asset) return <AssetThumbnail asset={asset} />
  const preview = node.data.thumbnailUrl ?? (node.type === 'image' ? node.data.url : undefined)
  if (preview) return <img src={preview} alt="" />
  if (node.type === 'video') return <Icons.Play size={15} />
  if (node.type === 'image') return <Icons.Image size={15} />
  return <Icons.File size={15} />
}

function previewNodeContent(node: CanvasNode, assetById: Map<string, CanvasAsset>): string {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  const text = readCanvasTextInputContent(node, asset ? [asset] : [])
  if (text) return text
  if (typeof node.data.prompt === 'string' && node.data.prompt.trim()) return node.data.prompt.trim()
  try {
    return JSON.stringify(node.data, null, 2)
  } catch {
    return node.title ?? node.id
  }
}

function defaultRelationForNode(node: CanvasNode): CanvasPromptRelation {
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function uniqueBlockId(document: CanvasPromptDocument, prefix: string): string {
  const ids = new Set(document.blocks.map((block) => block.id))
  let index = document.blocks.length
  while (ids.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}
