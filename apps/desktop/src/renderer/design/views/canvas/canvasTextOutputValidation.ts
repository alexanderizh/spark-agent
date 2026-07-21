import type { CanvasPipelineRole, ShotScriptConfig } from './canvas.types'
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
      code: 'invalid_screenplay_output' | 'invalid_storyboard_output' | 'invalid_entity_output'
      message: string
    }

export type CanvasSemanticTextValidationOptions = {
  shotScriptConfig?: ShotScriptConfig | null
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
  options: CanvasSemanticTextValidationOptions = {},
): CanvasSemanticTextValidation {
  void options
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
    const envelope = parseCompleteStoryboardEnvelope(value)
    if (!envelope) {
      const jsonShape = inspectJsonShape(value)
      const message = storyboardValidationMessage(jsonShape, value)
      return {
        ok: false,
        code: 'invalid_storyboard_output',
        message,
      }
    }
    const storyboardRows = normalizeRecoverableStoryboardRows(
      parseShotTable(JSON.stringify(envelope.root), {
        allowPartialJsonRecovery: false,
      }),
    )
    const validationError = validateStoryboardContract({
      envelope,
      rows: storyboardRows,
    })
    if (validationError) {
      return {
        ok: false,
        code: 'invalid_storyboard_output',
        message: validationError,
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

function normalizeRecoverableStoryboardRows(rows: ParsedShotRow[]): ParsedShotRow[] {
  return rows.map((row) => {
    if (typeof row.actionBeats === 'string' && row.actionBeats.trim()) return row
    const actionBeats = buildFallbackActionBeats(row)
    return actionBeats ? { ...row, actionBeats } : row
  })
}

function buildFallbackActionBeats(row: ParsedShotRow): string {
  const durationSec = row.durationSec
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return ''
  if (!isHalfSecond(durationSec)) return ''
  const beatCount = Math.round(durationSec * 2)
  if (beatCount <= 0) return ''
  const source =
    firstNonEmpty(row.description, row.movement, row.shotPrompt, row.title) ||
    '保持镜头内动作、表情、视线和画面变化连续推进'
  return Array.from({ length: beatCount }, (_, index) => {
    const start = index / 2
    const end = start + 0.5
    return `${start.toFixed(1)}–${end.toFixed(1)}s：${source}`
  }).join('；')
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

type StoryboardEnvelope = {
  root: Record<string, unknown>
  shots: Record<string, unknown>[]
  summary?: Record<string, unknown>
}

function parseCompleteStoryboardEnvelope(text: string): StoryboardEnvelope | null {
  const candidates = [text.trim()]
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate) as unknown
      if (typeof parsed === 'string') parsed = JSON.parse(parsed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const root = parsed as Record<string, unknown>
      if (!Array.isArray(root.shots)) continue
      if (root.summary && (typeof root.summary !== 'object' || Array.isArray(root.summary))) continue
      const shots = root.shots.filter(
        (shot): shot is Record<string, unknown> =>
          shot != null && typeof shot === 'object' && !Array.isArray(shot),
      )
      if (shots.length !== root.shots.length) continue
      return {
        root,
        shots,
        ...(root.summary ? { summary: root.summary as Record<string, unknown> } : {}),
      }
    } catch {
      // Try a fully closed fenced or double-serialized candidate next.
    }
  }
  return null
}

function validateStoryboardContract(input: {
  envelope: StoryboardEnvelope
  rows: ParsedShotRow[]
}): string | null {
  const { shots, summary } = input.envelope
  if (shots.length === 0) {
    return '分镜结果包含 shots，但镜头数组为空，未加载为分镜节点。请检查模型输出或任务输入。'
  }
  if (input.rows.length !== shots.length) {
    return `分镜结果包含 ${shots.length} 个镜头对象，但只有 ${input.rows.length} 个可解析，可能存在空对象或字段损坏，未加载为分镜节点。`
  }
  let totalDurationSec = 0
  for (const row of input.rows) {
    if (row.durationSec != null) {
      totalDurationSec += row.durationSec
    }
  }
  if (!summary) return null
  const shotCount = summary.shotCount
  if (typeof shotCount === 'number' && Number.isInteger(shotCount) && shotCount !== shots.length) {
    return `分镜 summary.shotCount=${shotCount}，但 shots 实际包含 ${shots.length} 镜，疑似输出截断或汇总错误。`
  }
  const summaryDuration = summary.totalDurationSec
  if (
    typeof summaryDuration === 'number' &&
    Number.isFinite(summaryDuration) &&
    totalDurationSec > 0 &&
    Math.abs(summaryDuration - totalDurationSec) > 0.001
  ) {
    return `分镜 summary.totalDurationSec=${summaryDuration}，但逐镜合计为 ${totalDurationSec}，疑似输出截断或汇总错误。`
  }
  return null
}

function isHalfSecond(value: number): boolean {
  return Math.abs(value * 2 - Math.round(value * 2)) < 0.000_001
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

function storyboardValidationMessage(shape: JsonShape, sourceText: string): string {
  if (shape?.shotsLength === 0) {
    return '分镜结果包含 shots，但镜头数组为空，未加载为分镜节点。请检查模型输出或任务输入。'
  }
  if (shape?.shotsLength != null) {
    return `分镜结果包含 ${shape.shotsLength} 个 shots，但缺少完整 summary（shotCount / totalDurationSec），无法确认是否截断，已拒绝加载。`
  }
  if (shape && shape.keys.length > 0) {
    const keys = shape.keys.slice(0, 8).join('、')
    return `分镜结果 JSON 顶层字段为 ${keys}；期望 shots（或可解析的分镜表）。该输出可能来自错误的节点功能提示词，未加载为分镜节点。`
  }
  if (/"shots"\s*:/.test(sourceText)) {
    return '分镜结果包含 shots，但 JSON 未完整闭合或缺少完整 summary，疑似模型输出被截断，已拒绝加载以避免保存残缺分镜。'
  }
  return '分镜结果不包含可解析的 shots JSON 或分镜表，未加载为分镜节点。'
}
