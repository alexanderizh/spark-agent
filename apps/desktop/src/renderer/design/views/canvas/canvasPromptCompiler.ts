import type {
  CanvasPromptBlock,
  CanvasPromptCompilation,
  CanvasPromptDocument,
  CanvasPromptInputKind,
  CanvasPromptInputSnapshot,
  CanvasPromptRelation,
  CanvasPromptRelationManifestEntry,
  CanvasPromptStructuredBlock,
  CanvasPromptCompiledInputFile,
} from '@spark/protocol'
import type { CanvasAsset, CanvasNode, CanvasOperationType } from './canvas.types'
import { presentCanvasTextForModel, readCanvasTextInputContent } from './canvasTextInputPresentation'

export class CanvasPromptCompileError extends Error {
  readonly code = 'canvas_prompt_compile_failed'
  readonly blockId: string

  constructor(blockId: string, message: string) {
    super(message)
    this.name = 'CanvasPromptCompileError'
    this.blockId = blockId
  }
}

export function compileCanvasPromptDocument(input: {
  document: CanvasPromptDocument
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  operation: CanvasOperationType
  systemPrompt?: string
  negativePrompt?: string
  capturedAt?: string
}): CanvasPromptCompilation {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]))
  const relationManifest: CanvasPromptRelationManifestEntry[] = []
  const inputSnapshots: CanvasPromptInputSnapshot[] = []
  const inputFiles: NonNullable<CanvasPromptCompilation['inputFiles']> = []
  const warnings: NonNullable<CanvasPromptCompilation['promptWarnings']> = []
  const textParts: string[] = []
  const seenInputFiles = new Set<string>()

  for (const [blockIndex, block] of input.document.blocks.entries()) {
    const compiled = compileBlock({
      block,
      blockIndex,
      nodeById,
      assetById,
      relationManifest,
      inputSnapshots,
      inputFiles,
      seenInputFiles,
      warnings,
    })
    if (compiled) textParts.push(compiled)
  }

  const compiledUserText = textParts.join('\n\n').trim()
  if (!compiledUserText && inputFiles.length === 0) {
    warnings.push({ code: 'empty_prompt', message: '提示词和媒体输入均为空' })
  }
  const promptSnapshot = cloneDocument(input.document, input.capturedAt)
  return {
    promptSnapshot,
    compiledUserText,
    inputFiles,
    inputSnapshots,
    relationManifest,
    ...(warnings.length > 0 ? { promptWarnings: warnings } : {}),
    ...(input.systemPrompt?.trim() ? { systemPrompt: input.systemPrompt.trim() } : {}),
  }
}

function compileBlock(input: {
  block: CanvasPromptBlock
  blockIndex: number
  nodeById: Map<string, CanvasNode>
  assetById: Map<string, CanvasAsset>
  relationManifest: CanvasPromptRelationManifestEntry[]
  inputSnapshots: CanvasPromptInputSnapshot[]
  inputFiles: NonNullable<CanvasPromptCompilation['inputFiles']>
  seenInputFiles: Set<string>
  warnings: NonNullable<CanvasPromptCompilation['promptWarnings']>
}): string {
  const { block } = input
  if (block.kind === 'text') return block.text.trim()
  if (block.kind === 'reference' && block.suppressed) return ''
  if (block.kind === 'parameter') {
    const unit = block.unit ? ` ${block.unit}` : ''
    const relation = block.relation ? `；关系：${block.relation}` : ''
    return `[参数/${block.parameter}] ${String(block.value)}${unit}${relation}`
  }

  if (block.kind === 'reference' && block.disconnected) {
    throw new CanvasPromptCompileError(block.id, `引用“${block.label}”已断开连接，请重新绑定后再提交`)
  }

  const node = input.nodeById.get(block.sourceNodeId)
  if (!node) throw new CanvasPromptCompileError(block.id, `引用节点不存在：${block.sourceNodeId}`)
  const asset = node.assetId ? input.assetById.get(node.assetId) : undefined
  const content = readNodeContent(node, asset)
  const label = block.kind === 'reference' ? block.label : block.summary
  const relation = block.kind === 'reference' ? block.relation : schemaRelation(block)
  const order = block.kind === 'reference' ? block.order : input.blockIndex
  const snapshot = buildInputSnapshot({
    node,
    ...(asset ? { asset } : {}),
    block,
    relation,
    order,
    label,
    content,
  })
  input.inputSnapshots.push(snapshot)
  input.relationManifest.push({
    blockId: block.id,
    sourceNodeId: node.id,
    relation,
    order,
    label,
    ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
  })

  if (isMediaNode(node, asset)) {
    const role = inputRoleForRelation(node, relation)
    const file = buildInputFile(node, asset, role)
    if (!file) {
      input.warnings.push({
        code: 'missing_media_url',
        message: `引用“${label}”没有可发送的媒体地址`,
        blockId: block.id,
      })
      throw new CanvasPromptCompileError(block.id, `引用“${label}”没有可发送的媒体地址`)
    }
    const key = `${node.id}:${file.role ?? 'input'}`
    if (!input.seenInputFiles.has(key)) {
      input.seenInputFiles.add(key)
      input.inputFiles.push(file)
    }
    return `[${relationLabel(relation)} ref-${input.inputSnapshots.length}: ${label}]`
  }

  if (!content) {
    input.warnings.push({
      code: 'empty_text_reference',
      message: `引用“${label}”没有文本内容`,
      blockId: block.id,
    })
    return `[${relationLabel(relation)} ref-${input.inputSnapshots.length}: ${label}]`
  }
  const rendered = presentCanvasTextForModel(content)
  return `[${relationLabel(relation)} ref-${input.inputSnapshots.length}: ${label}]\n${rendered}`
}

function buildInputSnapshot(input: {
  node: CanvasNode
  asset?: CanvasAsset
  block: Extract<CanvasPromptBlock, { kind: 'reference' | 'structured' }>
  relation: CanvasPromptRelation
  order: number
  label: string
  content: string
}): CanvasPromptInputSnapshot {
  const { node, asset, block, relation, order, label, content } = input
  const kind = inputKindForNode(node, asset, block)
  const sourceUrl = node.data.url ?? asset?.url ?? undefined
  const previewUrl = node.data.thumbnailUrl ?? asset?.thumbnailUrl ?? sourceUrl
  const mimeType = node.data.mimeType ?? asset?.mimeType ?? undefined
  const structuredData = block.kind === 'structured' ? parseJson(content) : undefined
  return {
    blockId: block.id,
    sourceNodeId: node.id,
    ...(node.assetId ? { sourceAssetId: node.assetId } : {}),
    relation,
    order,
    label,
    kind,
    ...(sourceUrl ? { contentHash: stableHash(`${sourceUrl}\n${content}`) } : {}),
    ...(asset?.storageKey ? { storageRef: asset.storageKey } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(asset?.width != null ? { width: asset.width } : {}),
    ...(asset?.height != null ? { height: asset.height } : {}),
    ...(asset?.durationMs != null ? { durationMs: asset.durationMs } : {}),
    ...(content && kind !== 'image' && kind !== 'video' && kind !== 'audio'
      ? { contentText: content }
      : {}),
    ...(block.kind === 'structured' ? { schema: block.schema } : {}),
    ...(structuredData !== undefined ? { structuredData } : {}),
  }
}

function buildInputFile(
  node: CanvasNode,
  asset: CanvasAsset | undefined,
  role: CanvasPromptCompiledInputFile['role'],
): CanvasPromptCompiledInputFile | null {
  const url = node.data.url ?? asset?.url ?? undefined
  if (!url) return null
  const type: CanvasPromptCompiledInputFile['type'] =
    node.type === 'image' || node.type === 'video' || node.type === 'audio' ? node.type : 'file'
  const mimeType = node.data.mimeType ?? asset?.mimeType ?? undefined
  return {
    type,
    ...(role ? { role } : {}),
    ...(url.startsWith('data:') ? { dataUrl: url } : { url }),
    ...(mimeType ? { mimeType } : {}),
  }
}

function readNodeContent(node: CanvasNode, asset?: CanvasAsset): string {
  if (node.type === 'text' || node.type === 'prompt') {
    return readCanvasTextInputContent(node, asset ? [asset] : [])
  }
  return typeof node.data.prompt === 'string' ? node.data.prompt.trim() : ''
}

function isMediaNode(node: CanvasNode, asset?: CanvasAsset): boolean {
  return node.type === 'image' || node.type === 'video' || node.type === 'audio' || asset?.type === 'image' || asset?.type === 'video' || asset?.type === 'audio'
}

function inputKindForNode(
  node: CanvasNode,
  asset: CanvasAsset | undefined,
  block: Extract<CanvasPromptBlock, { kind: 'reference' | 'structured' }>,
): CanvasPromptInputKind {
  if (block.kind === 'structured') return 'structured'
  if (node.type === 'image' || asset?.type === 'image') return 'image'
  if (node.type === 'video' || asset?.type === 'video') return 'video'
  if (node.type === 'audio' || asset?.type === 'audio') return 'audio'
  return 'text'
}

function inputRoleForRelation(
  node: CanvasNode,
  relation: CanvasPromptRelation,
): NonNullable<CanvasPromptCompilation['inputFiles']>[number]['role'] {
  if (relation === 'first_frame') return 'first_frame'
  if (relation === 'last_frame') return 'last_frame'
  if (relation === 'reference_image' || node.type === 'image') return 'reference'
  return 'input'
}

function schemaRelation(block: CanvasPromptStructuredBlock): CanvasPromptRelation {
  if (block.schema === 'storyboard') return 'storyboard'
  if (block.schema === 'screenplay') return 'screenplay'
  return 'generic'
}

function relationLabel(relation: CanvasPromptRelation): string {
  const labels: Record<CanvasPromptRelation, string> = {
    character: '角色',
    supporting_character: '配角',
    scene: '场景',
    prop: '道具',
    first_frame: '首帧',
    last_frame: '尾帧',
    reference_image: '参考图',
    reference_video: '参考视频',
    reference_audio: '参考音频',
    storyboard: '分镜表',
    screenplay: '剧本',
    generic: '引用',
  }
  return labels[relation]
}

function cloneDocument(document: CanvasPromptDocument, capturedAt?: string) {
  return {
    version: 2 as const,
    blocks: document.blocks.map((block) => ({ ...block })),
    ...(capturedAt ? { capturedAt } : {}),
  }
}

function parseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
