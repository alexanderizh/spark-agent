import type { CanvasPipelineRole, ShotScriptConfig } from './canvas.types'
import { parseCanvasJsonCandidates } from './canvasJsonRepair'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { formatStoryboardRowsAsMarkdown } from './canvasTextInputPresentation'
import {
  extractEntityKindLabel,
  parseExtractedEntities,
  type ExtractEntityKind,
} from './canvasEntityExtract'
import {
  parseSplitEpisodesOutput,
  SPLIT_EPISODES_WORKFLOW,
  type ParsedSplitEpisode,
} from './canvasEpisodeSplit'

export type CanvasSemanticTextValidation =
  | {
      ok: true
      text: string
      storyboardRows?: ParsedShotRow[]
      /** 分集任务（workflow=split_episodes）按集拆分出的数组；解析失败时不携带。 */
      episodes?: ParsedSplitEpisode[]
    }
  | {
      ok: false
      code: 'invalid_screenplay_output' | 'invalid_storyboard_output' | 'invalid_entity_output'
      message: string
    }

export type CanvasSemanticTextValidationOptions = {
  shotScriptConfig?: ShotScriptConfig | null
  /** 任务 modelParams.workflow；用于 screenplay 角色识别分集任务并按集拆分。 */
  workflow?: string | null
}

/**
 * 场次标题是恢复剧本节点的最低必要信息。模型可能输出「第1场｜内景｜…」、
 * 「场1 内景 …」、带 Markdown 标题/方括号的版本，或传统 INT./EXT. 标记；
 * 不要求同一行必须同时出现地点、时间、出场人物和对白，缺失内容留给用户编辑。
 */
const SCREENPLAY_SCENE_HEADING_PATTERNS: readonly RegExp[] = [
  /^(?:\s*#{1,6}\s*)?(?:【\s*)?(?:(?:第\s*)?(?:\d+|[一二三四五六七八九十百千万]+)\s*场|场\s*(?:\d+|[一二三四五六七八九十百千万]+)|(?:第\s*)?(?:\d+|[一二三四五六七八九十百千万]+)(?=\s*(?:内景|外景|室内|室外|[｜|]))|(?:INT|EXT)\.?)(?=\s|[｜|:：】]|$)/im,
  /^\s*(?:#{1,6}\s*)?(?:【\s*)?(?:场景|场次|场号|scene)\s*(?:(?:编号|号)?\s*[：:]?\s*(?:\d+|[一二三四五六七八九十百千万]+))?(?=\s|[｜|:：】\-]|$)/im,
  /^\s*(?:#{1,6}\s*)?(?:【\s*)?\d{1,3}[.)、]?\s*(?=(?:INT|EXT)\.?\b|内景|外景|室内|室外)/im,
]

const DEFAULT_SCREENPLAY_SCENE_HEADING = '第1场｜｜｜'

export function isValidScreenplayText(text: string): boolean {
  const value = text.trim()
  return Boolean(value && SCREENPLAY_SCENE_HEADING_PATTERNS.some((pattern) => pattern.test(value)))
}

export function validateCanvasSemanticTextOutput(
  role: CanvasPipelineRole | undefined,
  text: string,
  options: CanvasSemanticTextValidationOptions = {},
): CanvasSemanticTextValidation {
  const value = text.trim()
  if (role === 'screenplay') {
    if (!value) {
      return {
        ok: false,
        code: 'invalid_screenplay_output',
        message: '剧本结果为空，无法创建剧本节点。',
      }
    }
    if (options.workflow === SPLIT_EPISODES_WORKFLOW) {
      // 分集任务优先按集拆成数组；每集正文单独做场次标题规范化，
      // 拆分失败时保持整段单节点输出，不因结构问题判任务失败。
      const episodes = parseSplitEpisodesOutput(value).map((episode) => ({
        ...episode,
        script: normalizeScreenplayText(episode.script),
      }))
      if (episodes.length > 0) {
        return { ok: true, text: normalizeScreenplayText(value), episodes }
      }
    }
    return { ok: true, text: normalizeScreenplayText(value) }
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
    const storyboardRows = normalizeStoryboardRows(
      normalizeRecoverableStoryboardRows(
        parseShotTable(JSON.stringify(envelope.root), {
          allowPartialJsonRecovery: false,
          allowEmptyRows: true,
        }),
      ),
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

/**
 * 剧本任务的目标是先让用户拿到可编辑内容，而不是因标题小变体丢弃整段结果。
 * 非空文本缺少场次标题时补一个字段为空的首场，后续仍可由用户继续补全地点、时间等。
 */
export function normalizeScreenplayText(text: string): string {
  if (isValidScreenplayText(text)) return text
  return `${DEFAULT_SCREENPLAY_SCENE_HEADING}\n\n${text}`
}

function normalizeRecoverableStoryboardRows(rows: ParsedShotRow[]): ParsedShotRow[] {
  return rows.map((row) => {
    if (typeof row.actionBeats === 'string' && row.actionBeats.trim()) return row
    const actionBeats = buildFallbackActionBeats(row)
    return actionBeats ? { ...row, actionBeats } : row
  })
}

const STORYBOARD_TEXT_FIELDS = [
  'shotSize',
  'angle',
  'movement',
  'sceneLayout',
  'composition',
  'blocking',
  'lighting',
  'cameraParams',
  'focalLength',
  'aperture',
  'iso',
  'colorTone',
  'mood',
  'performance',
  'costume',
  'groupName',
  'sceneName',
  'description',
  'dialogue',
  'narration',
  'characterReferences',
  'actionBeats',
  'soundEffects',
  'transition',
  'firstFrame',
  'lastFrame',
  'continuity',
  'shotPrompt',
  'negativePrompt',
] as const

/**
 * 把模型省略的可编辑文本字段统一成空字符串，并为缺失镜号补顺序值。
 * 这样下游表格、资产编辑器和后续 Agent 输入看到的是稳定字段，而不是一组
 * 因 Provider/模型不同而变化的 undefined。
 */
function normalizeStoryboardRows(rows: ParsedShotRow[]): ParsedShotRow[] {
  return rows.map((row, index) => {
    const normalized: ParsedShotRow = {
      ...row,
      index: row.index ?? index + 1,
      title: row.title?.trim() || `镜${row.index ?? index + 1}`,
    }
    for (const field of STORYBOARD_TEXT_FIELDS) {
      const value = normalized[field] as string | undefined
      normalized[field] = value?.trim() ?? ''
    }
    return normalized
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
  for (const parsed of parseCanvasJsonCandidates(text)) {
    if (!parsed || typeof parsed !== 'object') continue
    const sourceRoot = (Array.isArray(parsed) ? { shots: parsed } : parsed) as Record<
      string,
      unknown
    >
    const summary = sourceRoot.summary
    if (summary && (typeof summary !== 'object' || Array.isArray(summary))) continue

    const rawShots: unknown[] = Array.isArray(sourceRoot.shots)
      ? sourceRoot.shots
      : Array.isArray(sourceRoot.segments)
        ? sourceRoot.segments
        : Array.isArray(sourceRoot.groups)
          ? sourceRoot.groups.flatMap((group) => {
              if (!group || typeof group !== 'object' || Array.isArray(group)) return []
              const groupRecord = group as Record<string, unknown>
              const groupName =
                typeof groupRecord.name === 'string'
                  ? groupRecord.name.trim()
                  : typeof groupRecord.groupName === 'string'
                    ? groupRecord.groupName.trim()
                    : ''
              const segments = Array.isArray(groupRecord.segments)
                ? groupRecord.segments
                : Array.isArray(groupRecord.shots)
                  ? groupRecord.shots
                  : []
              return segments.map((shot) => {
                if (!shot || typeof shot !== 'object' || Array.isArray(shot) || !groupName) {
                  return shot
                }
                const shotRecord = shot as Record<string, unknown>
                return shotRecord.groupName || shotRecord['分组']
                  ? shotRecord
                  : { ...shotRecord, groupName }
              })
            })
          : []
    if (rawShots.length === 0 && !Array.isArray(sourceRoot.shots)) continue

    const shots = rawShots.filter(
      (shot): shot is Record<string, unknown> =>
        shot != null && typeof shot === 'object' && !Array.isArray(shot),
    )
    if (shots.length !== rawShots.length) continue
    const root: Record<string, unknown> = {
      shots,
      ...(summary ? { summary } : {}),
    }
    return {
      root,
      shots,
      ...(summary ? { summary: summary as Record<string, unknown> } : {}),
    }
  }
  return null
}

function validateStoryboardContract(input: {
  envelope: StoryboardEnvelope
  rows: ParsedShotRow[]
}): string | null {
  const { shots } = input.envelope
  if (shots.length === 0) {
    return '分镜结果包含 shots，但镜头数组为空，未加载为分镜节点。请检查模型输出或任务输入。'
  }
  if (input.rows.length !== shots.length) {
    return `分镜结果包含 ${shots.length} 个镜头对象，但只有 ${input.rows.length} 个可解析。`
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
  for (const parsed of parseCanvasJsonCandidates(text)) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    return {
      keys: Object.keys(record),
      ...(Array.isArray(record.shots) ? { shotsLength: record.shots.length } : {}),
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
