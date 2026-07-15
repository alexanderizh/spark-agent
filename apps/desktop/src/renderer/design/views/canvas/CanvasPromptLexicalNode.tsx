import { createContext, useContext, type ReactNode } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import type {
  CanvasPromptBlock,
  CanvasPromptParameterBlock,
  CanvasPromptRelation,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { CanvasPromptHoverCard } from './CanvasPromptHoverCard'
import { readCanvasTextInputContent } from './canvasTextInputPresentation'
import type { CanvasAsset, CanvasNode } from './canvas.types'

export type CanvasPromptAtomicBlock = Exclude<CanvasPromptBlock, { kind: 'text' }>

export type SerializedCanvasPromptAtomicNode = Spread<
  {
    type: 'canvas-prompt-atomic'
    version: 1
    block: CanvasPromptAtomicBlock
  },
  SerializedLexicalNode
>

type CanvasPromptDecoratorContextValue = {
  nodeById: Map<string, CanvasNode>
  assetById: Map<string, CanvasAsset>
  disabled: boolean
  onBlockEdit?: (blockId: string) => void
}

const CanvasPromptDecoratorContext = createContext<CanvasPromptDecoratorContextValue | null>(null)

export function CanvasPromptDecoratorProvider({
  value,
  children,
}: {
  value: CanvasPromptDecoratorContextValue
  children: ReactNode
}) {
  return (
    <CanvasPromptDecoratorContext.Provider value={value}>
      {children}
    </CanvasPromptDecoratorContext.Provider>
  )
}

export class CanvasPromptAtomicNode extends DecoratorNode<ReactNode> {
  __block: CanvasPromptAtomicBlock

  static override getType(): string {
    return 'canvas-prompt-atomic'
  }

  static override clone(node: CanvasPromptAtomicNode): CanvasPromptAtomicNode {
    return new CanvasPromptAtomicNode(cloneBlock(node.__block), node.__key)
  }

  static override importJSON(serializedNode: SerializedCanvasPromptAtomicNode): CanvasPromptAtomicNode {
    return $createCanvasPromptAtomicNode(serializedNode.block)
  }

  constructor(block: CanvasPromptAtomicBlock, key?: NodeKey) {
    super(key)
    this.__block = cloneBlock(block)
  }

  override exportJSON(): SerializedCanvasPromptAtomicNode {
    return {
      type: 'canvas-prompt-atomic',
      version: 1,
      block: cloneBlock(this.__block),
    }
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = 'canvas-prompt-lexical-atomic'
    return element
  }

  override updateDOM(): false {
    return false
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.textContent = this.getTextContent()
    return { element }
  }

  override isInline(): true {
    return true
  }

  override isKeyboardSelectable(): true {
    return true
  }

  override getTextContent(): string {
    const block = this.__block
    if (block.kind === 'reference') return `@${block.label}`
    if (block.kind === 'structured') return `@${block.summary}`
    return `${String(block.value)}${block.unit ? ` ${block.unit}` : ''}`
  }

  getBlock(): CanvasPromptAtomicBlock {
    return cloneBlock(this.getLatest().__block)
  }

  setBlock(block: CanvasPromptAtomicBlock): this {
    const writable = this.getWritable()
    writable.__block = cloneBlock(block)
    return writable
  }

  override decorate(): ReactNode {
    return <CanvasPromptAtomicDecorator nodeKey={this.getKey()} block={this.getBlock()} />
  }
}

export function $createCanvasPromptAtomicNode(
  block: CanvasPromptAtomicBlock,
): CanvasPromptAtomicNode {
  return $applyNodeReplacement(new CanvasPromptAtomicNode(block))
}

export function $isCanvasPromptAtomicNode(
  node: LexicalNode | null | undefined,
): node is CanvasPromptAtomicNode {
  return node instanceof CanvasPromptAtomicNode
}

function CanvasPromptAtomicDecorator({
  nodeKey,
  block,
}: {
  nodeKey: NodeKey
  block: CanvasPromptAtomicBlock
}) {
  const context = useContext(CanvasPromptDecoratorContext)
  const [editor] = useLexicalComposerContext()
  if (!context) return null

  const remove = () => {
    editor.update(() => {
      const node = $getNodeByKey<CanvasPromptAtomicNode>(nodeKey)
      if (
        $isCanvasPromptAtomicNode(node) &&
        block.kind === 'reference' &&
        block.source === 'connection'
      ) {
        node.setBlock({ ...block, suppressed: true })
      } else {
        node?.remove()
      }
    })
    window.requestAnimationFrame(() => editor.focus())
  }

  if (block.kind === 'reference' && block.suppressed) {
    return <span hidden data-prompt-block-id={block.id} />
  }

  if (block.kind === 'parameter') {
    const label = parameterLabel(block.parameter)
    const value = String(block.value)
    const update = (nextValue: string) => {
      editor.update(() => {
        const node = $getNodeByKey<CanvasPromptAtomicNode>(nodeKey)
        if ($isCanvasPromptAtomicNode(node)) node.setBlock({ ...block, value: nextValue })
      })
    }
    return (
      <span
        className="canvas-prompt-chip is-parameter"
        contentEditable={false}
        data-prompt-block-id={block.id}
      >
        <span className="canvas-prompt-chip-icon">{parameterIcon(block.parameter)}</span>
        <input
          type="text"
          inputMode={block.parameter === 'duration' ? 'decimal' : 'text'}
          aria-label={label}
          placeholder={label}
          value={value}
          size={Math.max(4, Math.min(20, value.length || label.length))}
          disabled={context.disabled}
          onChange={(event) => update(event.target.value)}
        />
        {block.unit ? <span className="canvas-prompt-chip-unit">{block.unit}</span> : null}
        <RemoveButton label={`删除${label}`} disabled={context.disabled} onClick={remove} />
      </span>
    )
  }

  const node = context.nodeById.get(block.sourceNodeId)
  const label = block.kind === 'reference' ? block.label : block.summary
  const disconnected = block.kind === 'reference' && block.disconnected === true
  const invalid = !node || disconnected
  const thumbnail = node ? (
    renderCanvasPromptNodeThumbnail(node, context.assetById)
  ) : (
    <span className="canvas-prompt-chip-icon">!</span>
  )
  const relation = block.kind === 'reference' ? block.relation : block.schema
  const media =
    !disconnected && node ? renderCanvasPromptNodeHoverMedia(node, context.assetById) : null
  const content = media
    ? ''
    : disconnected
      ? '引用连接已断开，请重新绑定后再提交。'
      : node
        ? previewNodeContent(node, context.assetById)
        : '引用节点已删除，请重新绑定后再提交。'

  return (
    <span
      className={`canvas-prompt-chip-shell${invalid ? ' is-invalid' : ''}`}
      contentEditable={false}
      data-prompt-block-id={block.id}
    >
      <CanvasPromptHoverCard media={media} content={content}>
        <button
          type="button"
          className={`canvas-prompt-chip${invalid ? ' is-invalid' : ''}`}
          aria-invalid={invalid}
          disabled={context.disabled}
          onClick={() => context.onBlockEdit?.(block.id)}
        >
          <span className="canvas-prompt-chip-thumb">{thumbnail}</span>
          <span className="canvas-prompt-chip-copy">
            <strong>{label}</strong>
            <small>{relation}</small>
          </span>
        </button>
      </CanvasPromptHoverCard>
      <RemoveButton label={`删除${label}`} disabled={context.disabled} onClick={remove} />
    </span>
  )
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      className="canvas-prompt-chip-remove"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <Icons.X size={12} />
    </button>
  )
}

export function renderCanvasPromptNodeThumbnail(
  node: CanvasNode,
  assetById: Map<string, CanvasAsset>,
) {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  if (asset) return <AssetThumbnail asset={asset} />
  const preview = node.data.thumbnailUrl ?? (node.type === 'image' ? node.data.url : undefined)
  if (preview) return <img src={preview} alt="" />
  if (node.type === 'video') return <Icons.Play size={15} />
  if (node.type === 'image') return <Icons.Image size={15} />
  return <Icons.File size={15} />
}

function renderCanvasPromptNodeHoverMedia(node: CanvasNode, assetById: Map<string, CanvasAsset>) {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  const mediaType =
    node.type === 'image' || asset?.type === 'image'
      ? 'image'
      : node.type === 'video' || asset?.type === 'video'
        ? 'video'
        : null
  if (!mediaType) return null
  const previewUrl =
    mediaType === 'image'
      ? (node.data.url ?? asset?.url ?? node.data.thumbnailUrl ?? asset?.thumbnailUrl)
      : (node.data.thumbnailUrl ?? asset?.thumbnailUrl)
  if (previewUrl) {
    return <img src={previewUrl} alt={node.title ?? asset?.title ?? ''} loading="lazy" />
  }
  return (
    <span className="canvas-prompt-hover-media-empty">
      {mediaType === 'video' ? <Icons.Play size={24} /> : <Icons.Image size={24} />}
      {mediaType === 'video' ? '暂无视频封面' : '图片不可预览'}
    </span>
  )
}

export function canvasPromptNodeTypeLabel(node: CanvasNode): string {
  if (node.data.pipelineRole === 'character') return '角色'
  if (node.data.pipelineRole === 'scene') return '场景'
  if (node.data.pipelineRole === 'prop') return '道具'
  if (node.type === 'image') return '图片资源'
  if (node.type === 'video') return '视频资源'
  if (node.type === 'audio') return '音频资源'
  if (node.type === 'text' || node.type === 'prompt') return '文本输入'
  return '画布节点'
}

export function defaultCanvasPromptRelationForNode(node: CanvasNode): CanvasPromptRelation {
  if (node.data.pipelineRole === 'character') return 'character'
  if (node.data.pipelineRole === 'scene') return 'scene'
  if (node.data.pipelineRole === 'prop') return 'prop'
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function parameterLabel(parameter: CanvasPromptParameterBlock['parameter']): string {
  if (parameter === 'duration') return '设置时长'
  if (parameter === 'dialogue') return '输入台词'
  if (parameter === 'blocking') return '输入站位信息'
  return '输入参数'
}

function parameterIcon(parameter: CanvasPromptParameterBlock['parameter']) {
  if (parameter === 'duration') return <Icons.Clock size={15} />
  if (parameter === 'dialogue') return <Icons.MessageSquare size={15} />
  return <Icons.Crosshair size={15} />
}

function previewNodeContent(node: CanvasNode, assetById: Map<string, CanvasAsset>): string {
  const asset = node.assetId ? assetById.get(node.assetId) : undefined
  const text = readCanvasTextInputContent(node, asset ? [asset] : [])
  if (text) return text
  if (typeof node.data.prompt === 'string' && node.data.prompt.trim()) return node.data.prompt.trim()
  return '暂无可预览内容'
}

function cloneBlock<T extends CanvasPromptAtomicBlock>(block: T): T {
  return { ...block }
}
