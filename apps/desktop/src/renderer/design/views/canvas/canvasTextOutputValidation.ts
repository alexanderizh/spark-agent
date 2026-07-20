import type { CanvasPipelineRole, ShotScriptConfig } from './canvas.types'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
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
    const storyboardRows = parseShotTable(JSON.stringify(envelope.root), {
      allowPartialJsonRecovery: false,
    })
    const validationError = validateStoryboardContract({
      envelope,
      rows: storyboardRows,
      maxClipSec: options.shotScriptConfig?.maxClipSec ?? DEFAULT_MAX_CLIP_SEC,
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

type StoryboardEnvelope = {
  root: Record<string, unknown>
  shots: Record<string, unknown>[]
  summary: Record<string, unknown>
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
      if (!root.summary || typeof root.summary !== 'object' || Array.isArray(root.summary)) continue
      const shots = root.shots.filter(
        (shot): shot is Record<string, unknown> =>
          shot != null && typeof shot === 'object' && !Array.isArray(shot),
      )
      if (shots.length !== root.shots.length) continue
      return { root, shots, summary: root.summary as Record<string, unknown> }
    } catch {
      // Try a fully closed fenced or double-serialized candidate next.
    }
  }
  return null
}

const CORE_STORYBOARD_FIELDS: Array<{
  key: keyof ParsedShotRow
  label: string
}> = [
  { key: 'shotSize', label: '景别 shotSize' },
  { key: 'angle', label: '机位 angle' },
  { key: 'movement', label: '运镜 movement' },
  { key: 'description', label: '画面动作 description' },
  { key: 'lighting', label: '灯光 lighting' },
  { key: 'composition', label: '构图 composition' },
  { key: 'blocking', label: '人物调度 blocking' },
  { key: 'actionBeats', label: '动作节拍 actionBeats' },
  { key: 'transition', label: '转场 transition' },
  { key: 'firstFrame', label: '首帧 firstFrame' },
  { key: 'lastFrame', label: '尾帧 lastFrame' },
  { key: 'continuity', label: '连续性 continuity' },
  { key: 'shotPrompt', label: '视频提示词 shotPrompt' },
  { key: 'negativePrompt', label: '反向提示词 negativePrompt' },
]

function validateStoryboardContract(input: {
  envelope: StoryboardEnvelope
  rows: ParsedShotRow[]
  maxClipSec: number
}): string | null {
  const { shots, summary } = input.envelope
  if (shots.length === 0) {
    return '分镜结果包含 shots，但镜头数组为空，未加载为分镜节点。请检查模型输出或任务输入。'
  }
  if (input.rows.length !== shots.length) {
    return `分镜结果包含 ${shots.length} 个镜头对象，但只有 ${input.rows.length} 个可解析，可能存在空对象或字段损坏，未加载为分镜节点。`
  }
  const maxClipSec =
    Number.isFinite(input.maxClipSec) && input.maxClipSec > 0
      ? input.maxClipSec
      : DEFAULT_MAX_CLIP_SEC
  let totalDurationSec = 0
  for (const [position, row] of input.rows.entries()) {
    const expectedIndex = position + 1
    if (row.index !== expectedIndex) {
      return `第 ${expectedIndex} 个镜头的 index 必须从 1 连续递增，当前为 ${row.index ?? '缺失'}。`
    }
    if (row.durationSec == null || !Number.isFinite(row.durationSec) || row.durationSec <= 0) {
      return `镜头 #${expectedIndex} 缺少有效的 durationSec。`
    }
    if (!isHalfSecond(row.durationSec)) {
      return `镜头 #${expectedIndex} 的 durationSec=${row.durationSec}，必须是 0.5 秒的整数倍。`
    }
    if (row.durationSec > maxClipSec) {
      return `镜头 #${expectedIndex} 时长 ${row.durationSec}s 超过当前每镜上限 ${maxClipSec}s。`
    }
    const missingCoreFields = CORE_STORYBOARD_FIELDS.filter(({ key }) => {
      const field = row[key]
      return typeof field !== 'string' || field.trim().length === 0
    }).map(({ label }) => label)
    if (missingCoreFields.length > 0) {
      return `镜头 #${expectedIndex} 缺少电影级核心控制字段：${missingCoreFields.join('、')}。`
    }
    const beatError = validateActionBeats(row.actionBeats ?? '', row.durationSec)
    if (beatError) return `镜头 #${expectedIndex} 的 actionBeats 无效：${beatError}`
    if (!/入\s*[：:]/.test(row.transition ?? '') || !/出\s*[：:]/.test(row.transition ?? '')) {
      return `镜头 #${expectedIndex} 的 transition 必须同时包含“入：”和“出：”剪辑标识。`
    }
    totalDurationSec += row.durationSec
  }
  const shotCount = summary.shotCount
  if (typeof shotCount !== 'number' || !Number.isInteger(shotCount)) {
    return '分镜 summary.shotCount 必须是整数。'
  }
  if (shotCount !== shots.length) {
    return `分镜 summary.shotCount=${shotCount}，但 shots 实际包含 ${shots.length} 镜，疑似输出截断或汇总错误。`
  }
  const summaryDuration = summary.totalDurationSec
  if (typeof summaryDuration !== 'number' || !Number.isFinite(summaryDuration)) {
    return '分镜 summary.totalDurationSec 必须是有效数字。'
  }
  if (Math.abs(summaryDuration - totalDurationSec) > 0.001) {
    return `分镜 summary.totalDurationSec=${summaryDuration}，但逐镜合计为 ${totalDurationSec}，疑似输出截断或汇总错误。`
  }
  return null
}

function isHalfSecond(value: number): boolean {
  return Math.abs(value * 2 - Math.round(value * 2)) < 0.000_001
}

function validateActionBeats(value: string, durationSec: number): string | null {
  const ranges = Array.from(
    value.matchAll(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[–—~\-至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/gi),
    (match) => ({ start: Number(match[1]), end: Number(match[2]) }),
  )
  if (ranges.length === 0) return '没有识别到“0.0–0.5s”格式的秒级时间段。'
  let cursor = 0
  for (const range of ranges) {
    if (!isHalfSecond(range.start) || !isHalfSecond(range.end)) {
      return `时码 ${range.start}–${range.end}s 未对齐 0.5 秒。`
    }
    if (Math.abs(range.start - cursor) > 0.001) {
      return `时间轴在 ${cursor}s 后出现空洞或重叠。`
    }
    if (Math.abs(range.end - range.start - 0.5) > 0.001) {
      return `时间段 ${range.start}–${range.end}s 不是 0.5 秒。`
    }
    cursor = range.end
  }
  if (Math.abs(cursor - durationSec) > 0.001) {
    return `末尾时码为 ${cursor}s，与 durationSec=${durationSec}s 不一致。`
  }
  return null
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
