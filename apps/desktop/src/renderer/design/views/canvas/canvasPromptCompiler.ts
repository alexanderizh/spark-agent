import type {
  CanvasPromptBlock,
  CanvasPromptCompilation,
  CanvasPromptDocument,
  CanvasPromptInputKind,
  CanvasPromptInputSnapshot,
  CanvasPromptModelReference,
  CanvasPromptRelation,
  CanvasPromptRelationManifestEntry,
  CanvasPromptStructuredBlock,
  CanvasPromptCompiledInputFile,
} from '@spark/protocol'
import type { CanvasAsset, CanvasNode, CanvasOperationType } from './canvas.types'
import { readCanvasTextInputContent } from './canvasTextInputPresentation'
import {
  renderCanvasPromptWithReferences,
  renderCanvasReferenceImageList,
  renderCanvasTextReference,
  type CanvasModelReferenceImage,
} from './canvasModelInputPresentation'

type CanvasPromptReferenceState = {
  textOrdinal: number
  inputImageOrdinal: number
  referenceVideoOrdinal: number
  inputVideoOrdinal: number
  referenceAudioOrdinal: number
  inputAudioOrdinal: number
  referenceImages: CanvasModelReferenceImage[]
  textResources: string[]
  mediaReferences: Map<string, CanvasPromptModelReference>
  textReferences: Map<
    string,
    CanvasPromptModelReference & { channel: 'text'; ordinal: number }
  >
}

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
  const referenceState: CanvasPromptReferenceState = {
    textOrdinal: 0,
    inputImageOrdinal: 0,
    referenceVideoOrdinal: 0,
    inputVideoOrdinal: 0,
    referenceAudioOrdinal: 0,
    inputAudioOrdinal: 0,
    referenceImages: [],
    textResources: [],
    mediaReferences: new Map(),
    textReferences: new Map(),
  }

  for (const [blockIndex, block] of input.document.blocks.entries()) {
    const compiled = compileBlock({
      block,
      blockIndex,
      nodeById,
      assetById,
      relationManifest,
      inputSnapshots,
      inputFiles,
      referenceState,
      warnings,
    })
    if (compiled) textParts.push(compiled)
  }

  const referenceResources = [
    renderCanvasReferenceImageList(referenceState.referenceImages),
    ...referenceState.textResources,
  ]
  const compiledUserText = renderCanvasPromptWithReferences({
    userInput: textParts.join(''),
    resources: referenceResources,
  })
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
  referenceState: CanvasPromptReferenceState
  warnings: NonNullable<CanvasPromptCompilation['promptWarnings']>
}): string {
  const { block } = input
  if (block.kind === 'text') return block.text
  if (block.kind === 'reference' && block.suppressed) return ''
  if (block.kind === 'parameter') {
    const unit = block.unit ? ` ${block.unit}` : ''
    const relation = block.relation ? `；关系：${block.relation}` : ''
    return `[参数/${block.parameter}] ${String(block.value)}${unit}${relation}`
  }

  if (block.kind === 'reference' && block.disconnected) {
    throw new CanvasPromptCompileError(
      block.id,
      `引用“${block.label}”已断开连接，请重新绑定后再提交`,
    )
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
    let modelReference = input.referenceState.mediaReferences.get(key)
    if (!modelReference) {
      input.inputFiles.push(file)
      modelReference = createMediaModelReference({
        key,
        kind: snapshot.kind,
        role: file.role ?? 'input',
        label,
        relation,
        state: input.referenceState,
      })
    }
    input.relationManifest.push(
      buildRelationManifestEntry({ block, node, relation, order, label, snapshot, modelReference }),
    )
    return renderInlineMediaReference(modelReference, label, relation)
  }

  let modelReference = input.referenceState.textReferences.get(node.id)
  const isFirstMention = !modelReference
  if (!modelReference) {
    input.referenceState.textOrdinal += 1
    const textOrdinal = input.referenceState.textOrdinal
    modelReference = {
      channel: 'text',
      ordinal: textOrdinal,
      label: `文本引用 T${textOrdinal}`,
    }
    input.referenceState.textReferences.set(node.id, modelReference)
  }
  input.relationManifest.push(
    buildRelationManifestEntry({ block, node, relation, order, label, snapshot, modelReference }),
  )
  if (!content && isFirstMention) {
    input.warnings.push({
      code: 'empty_text_reference',
      message: `引用“${label}”没有文本内容`,
      blockId: block.id,
    })
  }
  if (isFirstMention) {
    input.referenceState.textResources.push(
      renderCanvasTextReference({ ordinal: modelReference.ordinal, label, relation, content }),
    )
  }
  return modelReference.label
}

function buildRelationManifestEntry(input: {
  block: Extract<CanvasPromptBlock, { kind: 'reference' | 'structured' }>
  node: CanvasNode
  relation: CanvasPromptRelation
  order: number
  label: string
  snapshot: CanvasPromptInputSnapshot
  modelReference: CanvasPromptModelReference
}): CanvasPromptRelationManifestEntry {
  return {
    blockId: input.block.id,
    sourceNodeId: input.node.id,
    relation: input.relation,
    order: input.order,
    label: input.label,
    ...(input.snapshot.contentHash ? { contentHash: input.snapshot.contentHash } : {}),
    modelReference: input.modelReference,
  }
}

function createMediaModelReference(input: {
  key: string
  kind: CanvasPromptInputKind
  role: NonNullable<CanvasPromptCompiledInputFile['role']>
  label: string
  relation: CanvasPromptRelation
  state: CanvasPromptReferenceState
}): CanvasPromptModelReference {
  const { state } = input
  let reference: CanvasPromptModelReference
  if (input.role === 'first_frame') {
    reference = { channel: 'first_frame', label: '首帧图' }
  } else if (input.role === 'last_frame') {
    reference = { channel: 'last_frame', label: '尾帧图' }
  } else if (input.kind === 'image') {
    if (input.role === 'reference') {
      const ordinal = state.referenceImages.length + 1
      reference = { channel: 'reference_images', ordinal, label: `参考图 #${ordinal}` }
      state.referenceImages.push({ ordinal, label: input.label, relation: input.relation })
    } else {
      state.inputImageOrdinal += 1
      reference = {
        channel: 'input_images',
        ordinal: state.inputImageOrdinal,
        label: `输入图 #${state.inputImageOrdinal}`,
      }
    }
  } else if (input.kind === 'video') {
    const isReference = input.role === 'reference'
    if (isReference) state.referenceVideoOrdinal += 1
    else state.inputVideoOrdinal += 1
    const ordinal = isReference ? state.referenceVideoOrdinal : state.inputVideoOrdinal
    reference = {
      channel: isReference ? 'reference_videos' : 'input_videos',
      ordinal,
      label: `${isReference ? '参考视频' : '输入视频'} #${ordinal}`,
    }
  } else {
    const isReference = input.role === 'reference'
    if (isReference) state.referenceAudioOrdinal += 1
    else state.inputAudioOrdinal += 1
    const ordinal = isReference ? state.referenceAudioOrdinal : state.inputAudioOrdinal
    reference = {
      channel: isReference ? 'reference_audios' : 'input_audios',
      ordinal,
      label: `${isReference ? '参考音频' : '输入音频'} #${ordinal}`,
    }
  }
  state.mediaReferences.set(input.key, reference)
  return reference
}

function renderInlineMediaReference(
  reference: CanvasPromptModelReference,
  label: string,
  relation: CanvasPromptRelation,
): string {
  if (reference.channel === 'reference_images') return reference.label
  return `[${reference.label}：${label}（${relationLabel(relation)}）]`
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
  const width = asset?.width ?? undefined
  const height = asset?.height ?? undefined
  const durationMs = asset?.durationMs ?? undefined
  const sizeBytes = asset?.sizeBytes ?? undefined
  return {
    type,
    ...(role ? { role } : {}),
    ...(url.startsWith('data:') ? { dataUrl: url } : { url }),
    ...(mimeType ? { mimeType } : {}),
    ...(sizeBytes != null ? { sizeBytes } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(durationMs != null ? { durationMs } : {}),
  }
}

function readNodeContent(node: CanvasNode, asset?: CanvasAsset): string {
  if (node.type === 'text' || node.type === 'prompt') {
    return readCanvasTextInputContent(node, asset ? [asset] : [])
  }
  return typeof node.data.prompt === 'string' ? node.data.prompt.trim() : ''
}

function isMediaNode(node: CanvasNode, asset?: CanvasAsset): boolean {
  return (
    node.type === 'image' ||
    node.type === 'video' ||
    node.type === 'audio' ||
    asset?.type === 'image' ||
    asset?.type === 'video' ||
    asset?.type === 'audio'
  )
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
