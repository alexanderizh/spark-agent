import { buildProductionBiblePrompt } from './canvasPipeline'
import { buildCanvasPipelineOperationDraft } from './canvasPipelineActionContracts'
import { readFilmData, type CreateFilmAssetInput, type FilmAssetKind, type ShotSegment } from './canvasFilmAssets'
import { SPECIALIZED_NODE_SCHEMAS } from './canvasSpecializedNodeSchemas'
import { materializeStoryboardRows } from './canvasStoryboardMaterialization'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { formatStoryboardRowsAsMarkdown } from './canvasTextInputPresentation'
import { isValidScreenplayText } from './canvasTextOutputValidation'
import type { CanvasAsset, CanvasNode, CanvasNodeData, CanvasSnapshot } from './canvas.types'

type JSONSchema = Record<string, unknown>

type SpecializedCanvasWorkspace = {
  createTextNode: (input: { text: string; x: number; y: number }) => Promise<CanvasNode | undefined>
  insertAsset: (input: { assetId: string; boardId: string; x: number; y: number }) => Promise<CanvasNode | null>
  createFilmAsset: (input: CreateFilmAssetInput) => Promise<CanvasAsset>
  updateFilmAsset: (assetId: string, patch: Record<string, unknown>) => Promise<void>
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => Promise<void>
  patchNodes: (nodeIds: string[], patch: Partial<CanvasNode>) => Promise<void>
  connectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => Promise<void>
  createShotGroup: (input: { name: string; description?: string }) => Promise<{ id: string; name: string; segments: ShotSegment[] }>
  createShotSegment: (groupId: string, input: Partial<ShotSegment> & { title: string }) => Promise<ShotSegment | void>
  createOperationNode: (input: {
    boardId: string
    operation: import('./canvas.types').CanvasOperationType
    inputNodeIds: string[]
    x: number
    y: number
    title?: string
    message?: string
    systemPrompt?: string
    modelParams?: Record<string, unknown>
    taskPipelineRole?: CanvasNodeData['pipelineRole']
    outputPipelineRole?: CanvasNodeData['outputPipelineRole']
    shotScriptConfig?: import('./canvas.types').ShotScriptConfig
  }) => Promise<CanvasSnapshot | void>
}

export type SpecializedCanvasToolContext = {
  projectId: string
  getSnapshot: () => CanvasSnapshot | null
  workspace: SpecializedCanvasWorkspace
}

export type SpecializedCanvasToolDescriptor = {
  name: string
  description: string
  paramsSchema: JSONSchema
  handler: (ctx: SpecializedCanvasToolContext, input: any) => Promise<unknown>
}

function requireSnapshot(ctx: SpecializedCanvasToolContext): CanvasSnapshot {
  const snapshot = ctx.getSnapshot()
  if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试。')
  return snapshot
}

function activeBoardId(snapshot: CanvasSnapshot): string {
  return snapshot.activeBoardId ?? snapshot.board.id
}

function placement(snapshot: CanvasSnapshot, x?: number, y?: number): { x: number; y: number } {
  if (x != null && y != null) return { x, y }
  const visible = snapshot.nodes.filter((node) => !node.hidden && node.boardId === activeBoardId(snapshot))
  return {
    x: visible.length ? Math.max(...visible.map((node) => node.x + node.width)) + 40 : 80,
    y: visible.length ? Math.round(visible.reduce((sum, node) => sum + node.y, 0) / visible.length) : 80,
  }
}

function sourceNodes(snapshot: CanvasSnapshot, ids: string[] | undefined): CanvasNode[] {
  const values = ids ?? []
  return values.map((id) => {
    const node = snapshot.nodes.find((candidate) => candidate.id === id && !candidate.hidden)
    if (!node) throw new Error(`未找到来源节点 ${id}`)
    return node
  })
}

async function connectSources(
  ctx: SpecializedCanvasToolContext,
  sources: readonly CanvasNode[],
  targetNodeId: string,
): Promise<void> {
  for (const source of sources) {
    await ctx.workspace.connectNodes({ sourceNodeId: source.id, targetNodeId })
  }
}

async function upsertFilmAsset(
  ctx: SpecializedCanvasToolContext,
  snapshot: CanvasSnapshot,
  input: CreateFilmAssetInput,
): Promise<{ asset: CanvasAsset; reused: boolean }> {
  const name = input.name.trim()
  const existing = snapshot.assets.find(
    (asset) => asset.metadata?.kind === input.kind && asset.title?.trim() === name,
  )
  if (!existing) return { asset: await ctx.workspace.createFilmAsset({ ...input, name }), reused: false }
  await ctx.workspace.updateFilmAsset(existing.id, {
    title: name,
    contentText: input.text ?? existing.contentText ?? '',
    ...(input.prompt != null ? { prompt: input.prompt } : {}),
    ...(input.tags != null ? { tags: input.tags } : {}),
    ...(input.attributes != null ? { attributes: input.attributes } : {}),
  })
  return {
    asset: { ...existing, title: name, contentText: input.text ?? existing.contentText ?? '' },
    reused: true,
  }
}

async function materializeFilmAssetNode(
  ctx: SpecializedCanvasToolContext,
  input: {
    kind: FilmAssetKind
    name: string
    text: string
    prompt?: string
    tags?: string[]
    attributes?: Record<string, string>
    pipelineRole: NonNullable<CanvasNodeData['pipelineRole']>
    sourceNodeIds?: string[]
    x?: number
    y?: number
  },
): Promise<{ assetId: string; nodeId: string; reused: boolean }> {
  const name = input.name.trim()
  const text = input.text.trim()
  if (!name) throw new Error('名称不能为空')
  if (!text) throw new Error('正文不能为空')
  const snapshot = requireSnapshot(ctx)
  const sources = sourceNodes(snapshot, input.sourceNodeIds)
  const { asset, reused } = await upsertFilmAsset(ctx, snapshot, {
    kind: input.kind,
    name,
    text,
    ...(input.prompt != null ? { prompt: input.prompt } : {}),
    ...(input.tags != null ? { tags: input.tags } : {}),
    ...(input.attributes != null ? { attributes: input.attributes } : {}),
  })
  const pos = placement(snapshot, input.x, input.y)
  const node = await ctx.workspace.insertAsset({
    assetId: asset.id,
    boardId: activeBoardId(snapshot),
    ...pos,
  })
  if (!node) throw new Error(`${name}资产已创建，但插入画布失败`)
  await ctx.workspace.updateNodeData(node.id, {
    text,
    format: 'markdown',
    pipelineRole: input.pipelineRole,
    productionState: 'draft',
  })
  await ctx.workspace.patchNodes([node.id], { title: name })
  await connectSources(ctx, sources, node.id)
  return { assetId: asset.id, nodeId: node.id, reused }
}

function contentTool(
  name: string,
  description: string,
  kind: 'chapter' | 'script',
  role: 'chapter' | 'screenplay',
  validate?: (text: string) => boolean,
): SpecializedCanvasToolDescriptor {
  return {
    name,
    description,
    paramsSchema: SPECIALIZED_NODE_SCHEMAS.content,
    handler: async (ctx, input) => {
      const text = String(input.text ?? '').trim()
      if (!text) throw new Error('正文不能为空')
      if (validate && !validate(text)) throw new Error('剧本正文不符合现有场次剧本格式')
      return materializeFilmAssetNode(ctx, {
        kind,
        name: String(input.title ?? '').trim(),
        text,
        pipelineRole: role,
        sourceNodeIds: input.sourceNodeIds,
        x: input.x,
        y: input.y,
      })
    },
  }
}

function entityTool(
  name: string,
  label: string,
  kind: 'character' | 'scene' | 'prop' | 'effect',
): SpecializedCanvasToolDescriptor {
  return {
    name,
    description: `按画布现有${label}资产格式创建或更新${label}节点。`,
    paramsSchema: SPECIALIZED_NODE_SCHEMAS.filmEntity,
    handler: async (ctx, input) =>
      materializeFilmAssetNode(ctx, {
        kind,
        name: String(input.name ?? '').trim(),
        text: String(input.description ?? '').trim(),
        pipelineRole: kind,
        prompt: input.prompt,
        tags: input.tags,
        attributes: input.attributes,
        sourceNodeIds: input.sourceNodeIds,
        x: input.x,
        y: input.y,
      }),
  }
}

function segmentDraft(segment: ShotSegment): Partial<ShotSegment> & { title: string } {
  const { id: _id, index: _index, ...draft } = segment
  return draft
}

async function createStoryboardNode(ctx: SpecializedCanvasToolContext, input: any): Promise<unknown> {
  const snapshot = requireSnapshot(ctx)
  const sources = sourceNodes(snapshot, input.sourceNodeIds)
  const rows = parseShotTable(JSON.stringify({ shots: input.shots ?? [] }))
  if (rows.length === 0) throw new Error('分镜至少需要一个有效镜头')
  const prepared = materializeStoryboardRows({
    metadata: snapshot.project.metadata,
    defaultGroupName: String(input.title ?? '').trim() || '分镜脚本',
    assets: snapshot.assets,
    rows,
  })
  const groupIds: string[] = []
  const segmentIds: string[] = []
  for (const groupDraft of prepared.createdGroups) {
    const group = await ctx.workspace.createShotGroup({
      name: groupDraft.name,
      ...(groupDraft.description ? { description: groupDraft.description } : {}),
    })
    groupIds.push(group.id)
    for (const segment of groupDraft.segments) {
      const created = await ctx.workspace.createShotSegment(group.id, segmentDraft(segment))
      if (created?.id) segmentIds.push(created.id)
    }
  }
  const pos = placement(snapshot, input.x, input.y)
  const node = await ctx.workspace.createTextNode({
    text: formatStoryboardRowsAsMarkdown(rows),
    ...pos,
  })
  if (!node) throw new Error('分镜数据已创建，但分镜文本节点插入失败')
  await ctx.workspace.updateNodeData(node.id, {
    text: formatStoryboardRowsAsMarkdown(rows),
    format: 'markdown',
    pipelineRole: 'shot',
    productionState: 'draft',
    ...(groupIds.length === 1 ? { shotGroupId: groupIds[0] } : {}),
  })
  await ctx.workspace.patchNodes([node.id], { title: String(input.title ?? '分镜脚本') })
  await connectSources(ctx, sources, node.id)
  return { nodeId: node.id, groupIds, segmentIds }
}

function inputToRow(input: Record<string, unknown>): ParsedShotRow {
  const rows = parseShotTable(JSON.stringify({ shots: [input] }))
  if (!rows[0]) throw new Error('镜头字段无法解析')
  return rows[0]
}

function validateShotReferences(
  snapshot: CanvasSnapshot,
  shotGroupId: string | undefined,
  shotSegmentId: string | undefined,
): void {
  if (!shotGroupId && !shotSegmentId) return
  const groups = readFilmData(snapshot.project.metadata)?.shotGroups ?? []
  const group = shotGroupId ? groups.find((candidate) => candidate.id === shotGroupId) : undefined
  if (shotGroupId && !group) throw new Error(`未找到分镜分组 ${shotGroupId}`)
  if (!shotSegmentId) return
  const segmentExists = group
    ? group.segments.some((segment) => segment.id === shotSegmentId)
    : groups.some((candidate) => candidate.segments.some((segment) => segment.id === shotSegmentId))
  if (!segmentExists) throw new Error(`未找到分镜片段 ${shotSegmentId}`)
}

async function createShotNode(ctx: SpecializedCanvasToolContext, input: any): Promise<unknown> {
  const snapshot = requireSnapshot(ctx)
  const film = readFilmData(snapshot.project.metadata)
  if (!film?.shotGroups?.some((group) => group.id === input.groupId)) {
    throw new Error(`未找到分镜分组 ${input.groupId}`)
  }
  const sources = sourceNodes(snapshot, input.sourceNodeIds)
  const row = inputToRow(input.shot ?? {})
  const prepared = materializeStoryboardRows({
    metadata: {},
    defaultGroupName: '单镜',
    assets: snapshot.assets,
    rows: [row],
  }).createdGroups[0]!.segments[0]!
  const created = await ctx.workspace.createShotSegment(input.groupId, segmentDraft(prepared))
  if (!created?.id) throw new Error('分镜片段创建后未返回 segment id')
  const pos = placement(snapshot, input.x, input.y)
  const node = await ctx.workspace.createTextNode({ text: formatStoryboardRowsAsMarkdown([row]), ...pos })
  if (!node) throw new Error('分镜片段已创建，但单镜节点插入失败')
  await ctx.workspace.updateNodeData(node.id, {
    text: formatStoryboardRowsAsMarkdown([row]),
    format: 'markdown',
    pipelineRole: 'shot',
    productionState: 'draft',
    shotGroupId: input.groupId,
    shotSegmentId: created.id,
  })
  await ctx.workspace.patchNodes([node.id], { title: created.title })
  await connectSources(ctx, sources, node.id)
  return { nodeId: node.id, groupId: input.groupId, segmentId: created.id }
}

function mediaTool(
  name: string,
  description: string,
  expectedType: 'image' | 'video',
  patch: Partial<CanvasNodeData>,
): SpecializedCanvasToolDescriptor {
  return {
    name,
    description,
    paramsSchema: SPECIALIZED_NODE_SCHEMAS.media,
    handler: async (ctx, input) => {
      const snapshot = requireSnapshot(ctx)
      const sources = sourceNodes(snapshot, input.sourceNodeIds)
      let node = input.nodeId
        ? snapshot.nodes.find((candidate) => candidate.id === input.nodeId && !candidate.hidden)
        : undefined
      if (!node && input.assetId) {
        const asset = snapshot.assets.find((candidate) => candidate.id === input.assetId)
        if (!asset) throw new Error(`未找到媒体资产 ${input.assetId}`)
        if (asset.type !== expectedType) {
          throw new Error(`资产 ${asset.id} 不是${expectedType}资产`)
        }
        const pos = placement(snapshot, input.x, input.y)
        node =
          (await ctx.workspace.insertAsset({
            assetId: asset.id,
            boardId: activeBoardId(snapshot),
            ...pos,
          })) ?? undefined
      }
      if (!node) throw new Error('必须提供有效的 nodeId 或 assetId')
      if (node.type !== expectedType) throw new Error(`节点 ${node.id} 不是${expectedType}节点`)
      validateShotReferences(snapshot, input.shotGroupId, input.shotSegmentId)
      await ctx.workspace.updateNodeData(node.id, {
        ...patch,
        ...(input.shotGroupId ? { shotGroupId: input.shotGroupId } : {}),
        ...(input.shotSegmentId ? { shotSegmentId: input.shotSegmentId } : {}),
      })
      if (input.title) await ctx.workspace.patchNodes([node.id], { title: input.title })
      await connectSources(ctx, sources, node.id)
      return { nodeId: node.id, assetId: node.assetId ?? input.assetId ?? null }
    },
  }
}

const pipelineOperationTool: SpecializedCanvasToolDescriptor = {
  name: 'canvas_create_pipeline_operation_node',
  description:
    '按现有画布影视流水线 actionId 创建完整操作节点，自动填入专用 system prompt、任务/产物角色和模型参数。',
  paramsSchema: SPECIALIZED_NODE_SCHEMAS.pipelineOperation,
  handler: async (ctx, input) => {
    const snapshot = requireSnapshot(ctx)
    const sourceNode = snapshot.nodes.find((node) => node.id === input.sourceNodeId && !node.hidden)
    if (!sourceNode) throw new Error(`未找到来源节点 ${input.sourceNodeId}`)
    const sourceText =
      sourceNode.data.text?.trim() ||
      (sourceNode.assetId
        ? snapshot.assets.find((asset) => asset.id === sourceNode.assetId)?.contentText?.trim()
        : '') ||
      ''
    if (!sourceText) throw new Error('来源节点没有可用文本内容')
    const draft = buildCanvasPipelineOperationDraft({
      actionId: input.actionId,
      sourceText,
      styleBible: buildProductionBiblePrompt(snapshot.project.metadata),
      maxClipSec: input.maxClipSec,
    })
    const pos = placement(snapshot, input.x, input.y)
    await ctx.workspace.createOperationNode({
      boardId: activeBoardId(snapshot),
      operation: draft.operation,
      inputNodeIds: [sourceNode.id],
      title: draft.title,
      message: draft.message,
      systemPrompt: draft.systemPrompt,
      ...(draft.modelParams ? { modelParams: draft.modelParams } : {}),
      ...(draft.taskPipelineRole ? { taskPipelineRole: draft.taskPipelineRole } : {}),
      ...(draft.outputPipelineRole ? { outputPipelineRole: draft.outputPipelineRole } : {}),
      ...(draft.shotScriptConfig ? { shotScriptConfig: draft.shotScriptConfig } : {}),
      ...pos,
    })
    return { actionId: input.actionId, operation: draft.operation }
  },
}

export const SPECIALIZED_CANVAS_NODE_TOOLS: ReadonlyArray<SpecializedCanvasToolDescriptor> = [
  contentTool('canvas_create_chapter_node', '按画布现有章节格式创建章节资产和节点。', 'chapter', 'chapter'),
  contentTool(
    'canvas_create_screenplay_node',
    '按画布现有场次剧本格式创建或更新剧本资产和节点；正文必须包含场次标题和对白。',
    'script',
    'screenplay',
    isValidScreenplayText,
  ),
  entityTool('canvas_create_character_node', '角色', 'character'),
  entityTool('canvas_create_scene_node', '场景', 'scene'),
  entityTool('canvas_create_prop_node', '道具', 'prop'),
  entityTool('canvas_create_effect_node', '特效', 'effect'),
  {
    name: 'canvas_create_storyboard_node',
    description:
      '按现有 shots JSON 字段创建分镜文本节点、ShotGroup 和 ShotSegment；Markdown 由程序生成。',
    paramsSchema: SPECIALIZED_NODE_SCHEMAS.storyboard,
    handler: createStoryboardNode,
  },
  {
    name: 'canvas_create_shot_node',
    description: '在现有分镜分组中创建一个 ShotSegment 和带回链的单镜文本节点。',
    paramsSchema: SPECIALIZED_NODE_SCHEMAS.shot,
    handler: createShotNode,
  },
  mediaTool('canvas_insert_design_card_node', '把现有图片节点/资产标记为设定图卡。', 'image', {
    pipelineRole: 'design_card',
  }),
  mediaTool('canvas_insert_keyframe_node', '把现有图片节点/资产标记为分镜关键帧并写入回链。', 'image', {
    pipelineRole: 'keyframe',
  }),
  mediaTool('canvas_insert_clip_node', '把现有视频节点/资产标记为视频片段并写入分镜回链。', 'video', {
    pipelineRole: 'clip',
  }),
  mediaTool('canvas_insert_panorama_node', '把现有图片节点/资产标记为 360 等距柱状投影全景图。', 'image', {
    panorama360: { projection: 'equirectangular' },
  }),
  pipelineOperationTool,
]
