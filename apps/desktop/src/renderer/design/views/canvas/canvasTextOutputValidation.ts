import type { CanvasPipelineRole } from './canvas.types'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { formatStoryboardRowsAsMarkdown } from './canvasTextInputPresentation'
import {
  extractEntityKindLabel,
  parseExtractedEntities,
  type ExtractEntityKind,
} from './canvasEntityExtract'

export type CanvasSemanticTextValidation =
  | { ok: true; text: string; storyboardRows?: ParsedShotRow[] }
  | {
      ok: false
      code:
        | 'invalid_screenplay_output'
        | 'invalid_storyboard_output'
        | 'invalid_entity_output'
      message: string
    }

const SCREENPLAY_SCENE_HEADING =
  /^(?:#{1,6}\s*)?(?:【\s*)?(?:场\s*(?:\d+|[一二三四五六七八九十百]+)|(?:INT|EXT)\.)[^\n]*(?:内景|外景|INT\.|EXT\.)/im

export function isValidScreenplayText(text: string): boolean {
  const value = text.trim()
  if (!value || !SCREENPLAY_SCENE_HEADING.test(value)) return false
  return /(?:：|:)/.test(value) || /出场人物/.test(value)
}

export function validateCanvasSemanticTextOutput(
  role: CanvasPipelineRole | undefined,
  text: string,
): CanvasSemanticTextValidation {
  const value = text.trim()
  if (role === 'screenplay') {
    if (!isValidScreenplayText(value)) {
      return {
        ok: false,
        code: 'invalid_screenplay_output',
        message: '剧本结果缺少可识别的场次标题或角色对白，未加载为剧本节点。',
      }
    }
    return { ok: true, text: value }
  }
  if (role === 'shot') {
    const storyboardRows = parseShotTable(value)
    if (storyboardRows.length === 0) {
      const jsonShape = inspectJsonShape(value)
      const message = storyboardValidationMessage(jsonShape)
      return {
        ok: false,
        code: 'invalid_storyboard_output',
        message,
      }
    }
    return {
      ok: true,
      text: formatStoryboardRowsAsMarkdown(storyboardRows),
      storyboardRows,
    }
  }
  const entityKind = pipelineRoleToEntityKind(role)
  if (entityKind) {
    const entities = parseExtractedEntities(entityKind, value)
    if (entities.length === 0) {
      return {
        ok: false,
        code: 'invalid_entity_output',
        message: `${extractEntityKindLabel(entityKind)}抽取结果不包含可解析的 entities JSON 或实体清单，未加载为实体节点。`,
      }
    }
  }
  return { ok: true, text: value }
}

function pipelineRoleToEntityKind(role: CanvasPipelineRole | undefined): ExtractEntityKind | null {
  return role === 'character' || role === 'scene' || role === 'prop' || role === 'effect'
    ? role
    : null
}

type JsonShape = { keys: string[]; shotsLength?: number } | null

function inspectJsonShape(text: string): JsonShape {
  const candidates = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }
  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate) as unknown
      if (typeof parsed === 'string') parsed = JSON.parse(parsed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const record = parsed as Record<string, unknown>
      return {
        keys: Object.keys(record),
        ...(Array.isArray(record.shots) ? { shotsLength: record.shots.length } : {}),
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function storyboardValidationMessage(shape: JsonShape): string {
  if (shape?.shotsLength === 0) {
    return '分镜结果包含 shots，但镜头数组为空，未加载为分镜节点。请检查模型输出或任务输入。'
  }
  if (shape && shape.keys.length > 0) {
    const keys = shape.keys.slice(0, 8).join('、')
    return `分镜结果 JSON 顶层字段为 ${keys}；期望 shots（或可解析的分镜表）。该输出可能来自错误的节点功能提示词，未加载为分镜节点。`
  }
  return '分镜结果不包含可解析的 shots JSON 或分镜表，未加载为分镜节点。'
}
