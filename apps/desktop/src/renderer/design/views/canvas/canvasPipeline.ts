/**
 * 流水线编排「大脑」（设计 §7 右键一键编排 / §9 协作契约）。
 *
 * 纯逻辑，无 DOM/IPC：
 * - 给定节点的 pipelineRole，解析它「下一步可执行」的编排动作（右键菜单数据源）。
 * - 生产状态机 / 确认闸门 / 过期(stale)传播 helper。
 * - 视觉总设定 / 风格预设 / 文稿索引的 metadata 读写 helper。
 */

import type {
  CanvasNode,
  CanvasNodeData,
  CanvasOperationType,
  CanvasPipelineRole,
  CanvasProductionState,
} from './canvas.types'
import type {
  CanvasFilmProjectMetadata,
  FilmStylePreset,
  ManuscriptChapterRef,
  ManuscriptIndex,
} from './canvasFilmTypes'
import { readFilmMetadata, writeFilmMetadata } from './canvasFilmTypes'

// ─── 编排动作（右键「下一步」菜单数据源，设计 §7）────────────────────────────

/** 一个可执行的流水线编排动作 */
export type PipelineAction = {
  /** 动作 id（稳定，便于 UI 绑定与测试） */
  id: string
  /** 中文菜单标签 */
  label: string
  /** 产出节点的流水线角色 */
  produces: CanvasPipelineRole
  /** 若直接落为媒体任务，对应的 operation（agent 文本动作则为空） */
  operation?: CanvasOperationType
  /** 是否需要面向多选（角色图） */
  multiAspect?: boolean
}

const PIPELINE_ACTIONS: Partial<Record<CanvasPipelineRole, PipelineAction[]>> = {
  chapter: [{ id: 'chapter.to_screenplay', label: '转剧本', produces: 'screenplay' }],
  screenplay: [
    { id: 'screenplay.extract_resources', label: '抽取资源', produces: 'character' },
    { id: 'screenplay.to_shots', label: '生成分镜', produces: 'shot' },
  ],
  character: [
    {
      id: 'character.generate_images',
      label: '生成角色图',
      produces: 'design_card',
      operation: 'text_to_image',
      multiAspect: true,
    },
  ],
  scene: [
    {
      id: 'scene.generate_concept',
      label: '生成概念图',
      produces: 'design_card',
      operation: 'text_to_image',
    },
  ],
  prop: [
    {
      id: 'prop.generate_concept',
      label: '生成道具图',
      produces: 'design_card',
      operation: 'text_to_image',
    },
  ],
  effect: [
    {
      id: 'effect.generate_concept',
      label: '生成特效图',
      produces: 'design_card',
      operation: 'text_to_image',
    },
  ],
  shot: [
    {
      id: 'shot.to_keyframes',
      label: '生成关键帧',
      produces: 'keyframe',
      operation: 'text_to_image',
    },
    { id: 'shot.to_video', label: '生成视频', produces: 'clip', operation: 'image_to_video' },
  ],
  keyframe: [
    { id: 'keyframe.to_video', label: '出视频(首尾帧)', produces: 'clip', operation: 'image_to_video' },
  ],
}

/** 解析某流水线角色「下一步」可执行的编排动作 */
export function getPipelineActions(role: CanvasPipelineRole | undefined): PipelineAction[] {
  if (!role) return []
  return PIPELINE_ACTIONS[role] ?? []
}

// ─── 生产状态机 / 确认闸门 / 过期传播（设计 §9.2）──────────────────────────

/** 节点是否已确认（下游正式生成只读 confirmed 内容） */
export function isConfirmed(node: Pick<CanvasNode, 'data'>): boolean {
  return node.data?.productionState === 'confirmed'
}

/** 节点是否已过期（上游变更后待更新） */
export function isStale(node: Pick<CanvasNode, 'data'>): boolean {
  return node.data?.productionState === 'stale'
}

/** 生成「确认」补丁 */
export function confirmPatch(now = new Date().toISOString()): Partial<CanvasNodeData> {
  return { productionState: 'confirmed', confirmedAt: now }
}

/** 生成「人工编辑」补丁：标记被人改过，若曾确认则回落 draft（需重新确认） */
export function humanEditPatch(prev: CanvasNodeData | undefined): Partial<CanvasNodeData> {
  const nextState: CanvasProductionState =
    prev?.productionState === 'confirmed' ? 'draft' : prev?.productionState ?? 'draft'
  return { editedByHuman: true, productionState: nextState }
}

/**
 * 给定一个上游节点 id，计算下游节点的「过期」补丁。
 * 已确认或草稿都会被标 stale，并记录是哪个上游导致的。
 */
export function stalePatch(
  prev: CanvasNodeData | undefined,
  upstreamNodeId: string,
): Partial<CanvasNodeData> {
  const existing = new Set(prev?.staleFrom ?? [])
  existing.add(upstreamNodeId)
  return { productionState: 'stale', staleFrom: [...existing] }
}

/**
 * 沿血缘边计算需要标记 stale 的下游节点集合。
 * edges：{ source, target } 形式的有向边（source→target 表示 target 依赖 source）。
 */
export function collectDownstream(
  changedNodeId: string,
  edges: Array<{ source: string; target: string }>,
): string[] {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }
  const visited = new Set<string>()
  const queue = [changedNodeId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  return [...visited]
}

// ─── 视觉总设定 Style Bible（设计 §S0）──────────────────────────────────────

export function readStyleBible(metadata: Record<string, unknown> | undefined): string {
  const film = readFilmMetadata(metadata)
  return film?.styleBible?.trim() ?? ''
}

export function writeStyleBible(
  metadata: Record<string, unknown> | undefined,
  styleBible: string,
): Record<string, unknown> {
  const film: CanvasFilmProjectMetadata = { ...(readFilmMetadata(metadata) ?? {}) }
  film.styleBible = styleBible
  return writeFilmMetadata(metadata, film)
}

// ─── 风格预设（运镜/画面/动作，设计 §S5）────────────────────────────────────

export function readStylePresets(
  metadata: Record<string, unknown> | undefined,
): FilmStylePreset[] {
  const film = readFilmMetadata(metadata)
  return film?.stylePresets ?? []
}

export function upsertStylePreset(
  metadata: Record<string, unknown> | undefined,
  preset: FilmStylePreset,
): Record<string, unknown> {
  const film: CanvasFilmProjectMetadata = { ...(readFilmMetadata(metadata) ?? {}) }
  const presets = [...(film.stylePresets ?? [])]
  const index = presets.findIndex((item) => item.id === preset.id)
  if (index >= 0) presets[index] = preset
  else presets.push(preset)
  film.stylePresets = presets
  return writeFilmMetadata(metadata, film)
}

// ─── 文稿索引（设计 §S1）────────────────────────────────────────────────────

export function readManuscriptIndex(
  metadata: Record<string, unknown> | undefined,
): ManuscriptIndex | null {
  const film = readFilmMetadata(metadata)
  return film?.manuscript ?? null
}

/** 写入/合并文稿章节索引（按 id 去重 upsert，按 order 排序） */
export function upsertManuscriptChapters(
  metadata: Record<string, unknown> | undefined,
  chapters: ManuscriptChapterRef[],
  manuscript?: { sourceAssetId?: string; title?: string },
): Record<string, unknown> {
  const film: CanvasFilmProjectMetadata = { ...(readFilmMetadata(metadata) ?? {}) }
  const existing = film.manuscript?.chapters ?? []
  const byId = new Map<string, ManuscriptChapterRef>()
  for (const chapter of existing) byId.set(chapter.id, chapter)
  for (const chapter of chapters) byId.set(chapter.id, chapter)
  const merged = [...byId.values()].sort((a, b) => a.order - b.order)
  const sourceAssetId = manuscript?.sourceAssetId ?? film.manuscript?.sourceAssetId
  const title = manuscript?.title ?? film.manuscript?.title
  film.manuscript = {
    ...(sourceAssetId ? { sourceAssetId } : {}),
    ...(title ? { title } : {}),
    chapters: merged,
  }
  return writeFilmMetadata(metadata, film)
}

/** 清空文稿章节索引（删除整部文稿时调用） */
export function clearManuscriptIndex(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const film: CanvasFilmProjectMetadata = { ...(readFilmMetadata(metadata) ?? {}) }
  delete film.manuscript
  return writeFilmMetadata(metadata, film)
}
