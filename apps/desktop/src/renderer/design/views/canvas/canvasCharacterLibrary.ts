import { normalizeEduAssetUrl } from '@spark/shared'
import { filmUid, readAssetKind, readReferences } from './canvasFilmAssets'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

export type CharacterSubviewKind =
  | 'full_body'
  | 'portrait'
  | 'expression'
  | 'turnaround'
  | 'costume'
  | 'prop'
  | 'custom'

export type FilmCharacterSubview = {
  id: string
  label: string
  kind: CharacterSubviewKind
  sourceAssetId: string
  cropPx: { x: number; y: number; width: number; height: number }
  order: number
  createdAt: string
  updatedAt: string
}

export const CHARACTER_SUBVIEW_KIND_LABELS: Record<CharacterSubviewKind, string> = {
  full_body: '全身',
  portrait: '脸部',
  expression: '表情',
  turnaround: '三视图',
  costume: '服装',
  prop: '道具',
  custom: '自定义',
}

const CHARACTER_SUBVIEW_KIND_SET = new Set<CharacterSubviewKind>([
  'full_body',
  'portrait',
  'expression',
  'turnaround',
  'costume',
  'prop',
  'custom',
])

function isCharacterSubviewKind(value: unknown): value is CharacterSubviewKind {
  return typeof value === 'string' && CHARACTER_SUBVIEW_KIND_SET.has(value as CharacterSubviewKind)
}

function isCharacterSubview(value: unknown): value is FilmCharacterSubview {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const crop = item['cropPx']
  return (
    typeof item['id'] === 'string' &&
    typeof item['label'] === 'string' &&
    isCharacterSubviewKind(item['kind']) &&
    typeof item['sourceAssetId'] === 'string' &&
    typeof item['order'] === 'number' &&
    typeof item['createdAt'] === 'string' &&
    typeof item['updatedAt'] === 'string' &&
    Boolean(crop) &&
    typeof crop === 'object' &&
    typeof (crop as Record<string, unknown>)['x'] === 'number' &&
    typeof (crop as Record<string, unknown>)['y'] === 'number' &&
    typeof (crop as Record<string, unknown>)['width'] === 'number' &&
    typeof (crop as Record<string, unknown>)['height'] === 'number'
  )
}

function normalizeCropPx(cropPx: FilmCharacterSubview['cropPx']): FilmCharacterSubview['cropPx'] {
  const x = Number.isFinite(cropPx.x) ? Math.max(0, Math.round(cropPx.x)) : 0
  const y = Number.isFinite(cropPx.y) ? Math.max(0, Math.round(cropPx.y)) : 0
  const width = Number.isFinite(cropPx.width) ? Math.max(1, Math.round(cropPx.width)) : 1
  const height = Number.isFinite(cropPx.height) ? Math.max(1, Math.round(cropPx.height)) : 1
  return { x, y, width, height }
}

export function normalizeCharacterSubviews(
  subviews: FilmCharacterSubview[],
): FilmCharacterSubview[] {
  return subviews
    .filter(isCharacterSubview)
    .map((subview, index) => ({
      id: subview.id,
      label: subview.label.trim() || `视图 ${index + 1}`,
      kind: isCharacterSubviewKind(subview.kind) ? subview.kind : 'custom',
      sourceAssetId: subview.sourceAssetId,
      cropPx: normalizeCropPx(subview.cropPx),
      order: Number.isFinite(subview.order) ? subview.order : index,
      createdAt: subview.createdAt,
      updatedAt: subview.updatedAt,
    }))
    .sort((a, b) => a.order - b.order)
    .map((subview, index) => ({ ...subview, order: index }))
}

export function readCharacterSubviews(
  metadata: Record<string, unknown> | undefined,
): FilmCharacterSubview[] {
  if (!metadata) return []
  const raw = metadata['characterSubviews']
  if (!Array.isArray(raw)) return []
  return normalizeCharacterSubviews(raw.filter(isCharacterSubview))
}

export function writeCharacterSubviews(
  metadata: Record<string, unknown> | undefined,
  subviews: FilmCharacterSubview[],
): Record<string, unknown> {
  return { ...(metadata ?? {}), characterSubviews: normalizeCharacterSubviews(subviews) }
}

export function createCharacterSubviewDraft(
  sourceAssetId: string,
  order: number,
  cropPx: FilmCharacterSubview['cropPx'],
  input?: Partial<Pick<FilmCharacterSubview, 'label' | 'kind'>>,
): FilmCharacterSubview {
  const at = new Date().toISOString()
  return {
    id: filmUid('char_view'),
    label: input?.label?.trim() || `视图 ${order + 1}`,
    kind: input?.kind ?? 'portrait',
    sourceAssetId,
    cropPx: normalizeCropPx(cropPx),
    order,
    createdAt: at,
    updatedAt: at,
  }
}

export function resolveCharacterSourceImageAsset(
  characterAsset: CanvasAsset | null | undefined,
  assets: CanvasAsset[],
  context?: { nodes: CanvasNode[]; tasks: CanvasTask[] },
): CanvasAsset | null {
  if (!characterAsset) return null
  if (characterAsset.type === 'image') return characterAsset
  const generatedDesignCard = resolveGeneratedCharacterDesignCardAsset(characterAsset, assets, context)
  if (generatedDesignCard) return generatedDesignCard
  const refs = readReferences(characterAsset.metadata)
  const preferredKinds: Array<'concept' | 'reference' | 'expression' | 'costume' | 'other'> = [
    'concept',
    'reference',
    'expression',
    'costume',
    'other',
  ]
  for (const kind of preferredKinds) {
    const match = refs.find((ref) => ref.kind === kind)
    if (!match) continue
    const asset = assets.find((item) => item.id === match.assetId && item.type === 'image')
    if (asset) return asset
  }
  for (const ref of refs) {
    const asset = assets.find((item) => item.id === ref.assetId && item.type === 'image')
    if (asset) return asset
  }
  return null
}

function resolveGeneratedCharacterDesignCardAsset(
  characterAsset: CanvasAsset,
  assets: CanvasAsset[],
  context?: { nodes: CanvasNode[]; tasks: CanvasTask[] },
): CanvasAsset | null {
  if (!context) return null
  const designCardAssetIds = new Set(
    context.nodes
      .filter(
        (node) =>
          node.type === 'image' &&
          node.assetId &&
          node.data.pipelineRole === 'design_card',
      )
      .map((node) => node.assetId as string),
  )
  if (designCardAssetIds.size === 0) return null
  const imageAssetById = new Map(
    assets.filter((asset) => asset.type === 'image').map((asset) => [asset.id, asset] as const),
  )
  const candidates = new Map<string, CanvasAsset>()
  for (const task of context.tasks) {
    if (!task.inputAssetIds.includes(characterAsset.id)) continue
    for (const outputAssetId of task.outputAssetIds) {
      if (!designCardAssetIds.has(outputAssetId)) continue
      const asset = imageAssetById.get(outputAssetId)
      if (asset) candidates.set(asset.id, asset)
    }
  }
  const sorted = Array.from(candidates.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sorted[0] ?? null
}

export function resolveCharacterAssetForDesignCardImageAsset(
  imageAsset: CanvasAsset | null | undefined,
  assets: CanvasAsset[],
  tasks: CanvasTask[],
): CanvasAsset | null {
  if (!imageAsset || imageAsset.type !== 'image') return null
  const taskId =
    typeof imageAsset.metadata?.taskId === 'string' ? imageAsset.metadata.taskId : null
  const relatedTasks = [
    ...(taskId ? tasks.filter((task) => task.id === taskId) : []),
    ...tasks.filter((task) => task.outputAssetIds.includes(imageAsset.id) && task.id !== taskId),
  ]
  for (const task of relatedTasks) {
    for (const assetId of task.inputAssetIds) {
      const asset = assets.find((item) => item.id === assetId)
      if (asset && readAssetKind(asset) === 'character') return asset
    }
  }
  return null
}

export function characterSourceImageUrl(asset: CanvasAsset | null | undefined): string | null {
  const url = asset?.thumbnailUrl ?? asset?.url ?? null
  return url ? normalizeEduAssetUrl(url) : null
}

export async function cropCharacterSubviewToDataUrl(
  sourceImageUrl: string,
  cropPx: FilmCharacterSubview['cropPx'],
): Promise<string> {
  const image = await loadImage(sourceImageUrl)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法初始化裁切画布')
  const crop = normalizeCropPx(cropPx)
  canvas.width = crop.width
  canvas.height = crop.height
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  return canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('角色参考图加载失败'))
    image.src = src
  })
}
