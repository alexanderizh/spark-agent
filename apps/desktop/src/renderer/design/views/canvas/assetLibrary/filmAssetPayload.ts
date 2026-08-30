/**
 * 影视资产载荷类型收窄（步骤模式设计文档 §4.3 / P1 交付物 1）。
 *
 * 历史上影视资产的类型数据散落在 `asset.metadata` 的十余个魔法 key 上
 * （kind / attributes.* / characterSubviews / references ...），本模块把「按 kind
 * 判别的读取视图」收敛为一个判别联合 + 唯一入口 `parseFilmAssetPayload`。
 *
 * 兼容原则（P1 硬性约束）：
 *  - `metadata.kind` 的既有散读不受影响，这里是收窄读取层，不是破坏性替换；
 *  - 已知 kind 但结构化载荷缺失/非法时，降级为 `raw` 分支，绝不抛错；
 *  - 未知 kind 一律回落 `raw` 分支，避免旧数据 / 新增 kind 读取失败。
 */

import { readCharacterSubviews } from '../canvasCharacterLibrary'
import type { CanvasAsset } from '../canvas.types'

/** 结构化角色载荷（读自 metadata.attributes + characterSubviews） */
export type FilmCharacterPayload = {
  appearance: string
  personality?: string
  subviewAssets?: Array<{ view: string; assetId: string }>
}

/** 结构化场景载荷 */
export type FilmScenePayload = {
  description: string
  timeOfDay?: string
}

/** 结构化道具载荷 */
export type FilmPropPayload = {
  description: string
}

/** 结构化特效载荷 */
export type FilmEffectPayload = {
  description: string
}

/**
 * 按 kind 判别的影视资产载荷。
 *
 * 前四个分支是结构化视图；其余 kind（manuscript / chapter / script /
 * prompt_library / shot_group 以及任何未知值）统一走 `raw` 分支，
 * 保留完整 metadata 供调用方自行取用。
 *
 * 注意：raw 分支的 kind 必须写 `string & {}` 而不是 `string` —— 裸 `string`
 * 会吞掉前面四个字面量分支的判别收窄（`payload.kind === 'character'` 后仍
 * 联合两分支，无法访问 `payload.character`）；`string & {}` 保持任意字符串
 * 可赋值的同时让字面量分支优先参与 narrowing（TS ≥ 4.3）。
 */
export type FilmAssetPayload =
  | { kind: 'character'; character: FilmCharacterPayload }
  | { kind: 'scene'; scene: FilmScenePayload }
  | { kind: 'prop'; prop: FilmPropPayload }
  | { kind: 'effect'; effect: FilmEffectPayload }
  | { kind: string & {}; raw: Record<string, unknown> }

const STRING_ATTRIBUTES_ALIASES: Record<string, readonly string[]> = {
  appearance: ['appearance', '外貌', '外形', '长相'],
  personality: ['personality', '性格', '气质', '个性'],
  timeOfDay: ['timeOfDay', '时间', '时段'],
  description: ['description', '描述', '说明'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAttributes(metadata: Record<string, unknown>): Record<string, unknown> {
  const attributes = metadata['attributes']
  return isRecord(attributes) ? attributes : {}
}

/** 按主 key + 中文别名读取字符串属性，取第一个非空值 */
function readStringAttribute(
  attributes: Record<string, unknown>,
  key: keyof typeof STRING_ATTRIBUTES_ALIASES,
): string {
  for (const candidate of STRING_ATTRIBUTES_ALIASES[key] ?? []) {
    const value = attributes[candidate]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseCharacterPayload(metadata: Record<string, unknown>): FilmCharacterPayload {
  const attributes = readAttributes(metadata)
  const appearance = readStringAttribute(attributes, 'appearance')
  const personalityValue = readStringAttribute(attributes, 'personality')
  const subviewAssets = readCharacterSubviews(metadata).map((subview) => ({
    view: subview.label || subview.kind,
    assetId: subview.sourceAssetId,
  }))
  return {
    appearance,
    ...(personalityValue ? { personality: personalityValue } : {}),
    ...(subviewAssets.length > 0 ? { subviewAssets } : {}),
  }
}

function parseDescriptionPayload(
  metadata: Record<string, unknown>,
  contentText: string | null | undefined,
): string {
  const description = readStringAttribute(readAttributes(metadata), 'description')
  if (description) return description
  return (contentText ?? '').trim()
}

/**
 * 把 `asset.metadata` 解析为强类型载荷；不满足影视资产前提（缺 kind）返回 null。
 *
 * - kind 非法（非 string）→ null；
 * - character / scene / prop / effect → 结构化分支（字段缺失给安全缺省，不抛错）；
 * - 其余任何 kind → raw 分支，raw 即原 metadata 引用（只读约定，调用方不得改写）。
 */
export function parseFilmAssetPayload(
  metadata: Record<string, unknown> | undefined | null,
): FilmAssetPayload | null {
  if (!isRecord(metadata)) return null
  const kind = metadata['kind']
  if (typeof kind !== 'string' || !kind) return null
  switch (kind) {
    case 'character':
      return { kind: 'character', character: parseCharacterPayload(metadata) }
    case 'scene': {
      const description = parseDescriptionPayload(metadata, null)
      const timeOfDay = readStringAttribute(readAttributes(metadata), 'timeOfDay')
      return {
        kind: 'scene',
        scene: { description, ...(timeOfDay ? { timeOfDay } : {}) },
      }
    }
    case 'prop':
      return { kind: 'prop', prop: { description: parseDescriptionPayload(metadata, null) } }
    case 'effect':
      return { kind: 'effect', effect: { description: parseDescriptionPayload(metadata, null) } }
    default:
      return { kind, raw: metadata }
  }
}

/** 便捷重载：直接从资产读取；非影视资产返回 null */
export function readFilmAssetPayload(asset: CanvasAsset): FilmAssetPayload | null {
  return parseFilmAssetPayload(asset?.metadata)
}

/** 判断载荷是否为结构化分支（非 raw） */
export function isStructuredFilmAssetPayload(
  payload: FilmAssetPayload,
): payload is Exclude<FilmAssetPayload, { kind: string; raw: Record<string, unknown> }> {
  return (
    payload.kind === 'character' ||
    payload.kind === 'scene' ||
    payload.kind === 'prop' ||
    payload.kind === 'effect'
  )
}
