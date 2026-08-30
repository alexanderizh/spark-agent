/**
 * 分镜步骤（P5）纯数据层：序列/分段 CRUD、元数据容错归一化、
 * 生成 prompt 组装、任务实时态派生与输入文件（含 role）组装。
 *
 * 存储经 stepStudioMeta 的 stepStudioStatePatch 走 updateProjectMetadata，
 * 本模块不触碰 canvas.api（保持可单测）。
 */

import type {
  CanvasAsset,
  CanvasSnapshot,
  CanvasTask,
  StepSegmentStatus,
  StepShotSegment,
  StepShotSequence,
  StepStudioState,
} from '../canvas.types'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'

// ── 序列 / 分段 CRUD（immutable）──

let seqCounter = 0
let segmentCounter = 0

function nextId(prefix: 'seq' | 'seg'): string {
  const tick = prefix === 'seq' ? ++seqCounter : ++segmentCounter
  return `step_${prefix}_${Date.now().toString(36)}_${tick.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function createSequence(projectId: string, order: number, title?: string): StepShotSequence {
  return {
    id: nextId('seq'),
    projectId,
    title: title?.trim() || `第 ${order + 1} 集`,
    order,
    segments: [],
  }
}

export function createSegment(sequenceId: string, order: number): StepShotSegment {
  return {
    id: nextId('seg'),
    sequenceId,
    order,
    script: '',
    characterAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    referenceAssetIds: [],
    firstFrameAssetId: null,
    lastFrameAssetId: null,
    genMode: 'reference',
    outputVideoAssetIds: [],
    taskId: null,
    status: 'draft',
  }
}

export function withSequences(
  state: StepStudioState,
  update: (sequences: StepShotSequence[]) => StepShotSequence[],
): StepStudioState {
  return { ...state, sequences: renumberSequences(update(state.sequences)) }
}

/** 重排 order（删除/移动后 0..n-1 连续，序列内分段同理） */
function renumberSequences(sequences: StepShotSequence[]): StepShotSequence[] {
  return [...sequences]
    .sort((a, b) => a.order - b.order)
    .map((seq, index) => ({
      ...seq,
      order: index,
      segments: [...seq.segments]
        .sort((a, b) => a.order - b.order)
        .map((seg, segIndex) => ({ ...seg, order: segIndex })),
    }))
}

export function upsertSequence(
  state: StepStudioState,
  sequence: StepShotSequence,
): StepStudioState {
  const exists = state.sequences.some((item) => item.id === sequence.id)
  return withSequences(state, (sequences) =>
    exists
      ? sequences.map((item) => (item.id === sequence.id ? sequence : item))
      : [...sequences, sequence],
  )
}

export function removeSequence(state: StepStudioState, sequenceId: string): StepStudioState {
  return withSequences(state, (sequences) => sequences.filter((item) => item.id !== sequenceId))
}

export function patchSegment(
  state: StepStudioState,
  sequenceId: string,
  segmentId: string,
  patch: Partial<StepShotSegment>,
): StepStudioState {
  return withSequences(state, (sequences) =>
    sequences.map((seq) =>
      seq.id !== sequenceId
        ? seq
        : {
            ...seq,
            segments: seq.segments.map((seg) =>
              seg.id === segmentId ? { ...seg, ...patch } : seg,
            ),
          },
    ),
  )
}

export function addSegment(state: StepStudioState, sequenceId: string): StepStudioState {
  return withSequences(state, (sequences) =>
    sequences.map((seq) => {
      if (seq.id !== sequenceId) return seq
      const order = seq.segments.length
      return { ...seq, segments: [...seq.segments, createSegment(sequenceId, order)] }
    }),
  )
}

export function removeSegment(
  state: StepStudioState,
  sequenceId: string,
  segmentId: string,
): StepStudioState {
  return withSequences(state, (sequences) =>
    sequences.map((seq) =>
      seq.id !== sequenceId
        ? seq
        : { ...seq, segments: seq.segments.filter((seg) => seg.id !== segmentId) },
    ),
  )
}

export function moveSegment(
  state: StepStudioState,
  sequenceId: string,
  segmentId: string,
  direction: 'up' | 'down',
): StepStudioState {
  return withSequences(state, (sequences) =>
    sequences.map((seq) => {
      if (seq.id !== sequenceId) return seq
      const index = seq.segments.findIndex((seg) => seg.id === segmentId)
      const target = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= seq.segments.length) return seq
      const segments = [...seq.segments]
      const [moved] = segments.splice(index, 1)
      if (!moved) return seq
      segments.splice(target, 0, moved)
      return { ...seq, segments: segments.map((seg, i) => ({ ...seg, order: i })) }
    }),
  )
}

/**
 * 拖拽排序（二期）：把 segmentId 分段移到 toIndex 位置。
 * toIndex 钳制到 [0, length-1]；分段不存在时原样返回。
 */
export function reorderSegment(
  state: StepStudioState,
  sequenceId: string,
  segmentId: string,
  toIndex: number,
): StepStudioState {
  return withSequences(state, (sequences) =>
    sequences.map((seq) => {
      if (seq.id !== sequenceId) return seq
      const index = seq.segments.findIndex((seg) => seg.id === segmentId)
      if (index < 0) return seq
      const target = Math.max(0, Math.min(toIndex, seq.segments.length - 1))
      if (index === target) return seq
      const segments = [...seq.segments]
      const [moved] = segments.splice(index, 1)
      if (!moved) return seq
      segments.splice(target, 0, moved)
      return { ...seq, segments: segments.map((seg, i) => ({ ...seg, order: i })) }
    }),
  )
}

// ── 容错归一化（metadata 深层视为不可信 JSON）──

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function coerceOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 深层字段逐项容错：缺字段落类型缺省，非法类型丢弃（渲染层只吃归一化结果） */
export function normalizeSequences(raw: unknown): StepShotSequence[] {
  if (!Array.isArray(raw)) return []
  const sequences: StepShotSequence[] = []
  raw.forEach((item) => {
    if (typeof item !== 'object' || item === null) return
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) return
    const sequenceId = record.id
    const segmentsRaw = Array.isArray(record.segments) ? record.segments : []
    sequences.push({
      id: sequenceId,
      projectId: typeof record.projectId === 'string' ? record.projectId : '',
      title: typeof record.title === 'string' && record.title.trim() ? record.title : '未命名',
      order: typeof record.order === 'number' ? record.order : sequences.length,
      segments: segmentsRaw
        .filter(
          (seg): seg is Record<string, unknown> =>
            typeof seg === 'object' &&
            seg !== null &&
            typeof (seg as Record<string, unknown>).id === 'string',
        )
        .map((seg, index) => ({
          id: seg.id as string,
          sequenceId,
          order: typeof seg.order === 'number' ? seg.order : index,
          script: typeof seg.script === 'string' ? seg.script : '',
          ...(typeof seg.durationSec === 'number' && seg.durationSec > 0
            ? { durationSec: seg.durationSec }
            : {}),
          characterAssetIds: coerceStringArray(seg.characterAssetIds),
          sceneAssetId: coerceOptionalString(seg.sceneAssetId),
          propAssetIds: coerceStringArray(seg.propAssetIds),
          referenceAssetIds: coerceStringArray(seg.referenceAssetIds),
          firstFrameAssetId: coerceOptionalString(seg.firstFrameAssetId),
          lastFrameAssetId: coerceOptionalString(seg.lastFrameAssetId),
          genMode: seg.genMode === 'first_last_frame' ? 'first_last_frame' : 'reference',
          ...(isRecordType(seg.modelParams) ? { modelParams: seg.modelParams } : {}),
          ...coerceOptionalIdFields(seg),
          outputVideoAssetIds: coerceStringArray(seg.outputVideoAssetIds),
          taskId: coerceOptionalString(seg.taskId),
          status: coerceStatus(seg.status),
        })),
    })
  })
  return renumberSequences(sequences)
}

function isRecordType(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceOptionalIdFields(
  seg: Record<string, unknown>,
): Pick<StepShotSegment, 'providerProfileId' | 'modelId'> {
  const picked: Pick<StepShotSegment, 'providerProfileId' | 'modelId'> = {}
  if (typeof seg.providerProfileId === 'string' && seg.providerProfileId)
    picked.providerProfileId = seg.providerProfileId
  if (typeof seg.modelId === 'string' && seg.modelId) picked.modelId = seg.modelId
  return picked
}

function coerceStatus(value: unknown): StepSegmentStatus {
  return value === 'generating' || value === 'done' || value === 'failed' ? value : 'draft'
}

// ── 任务实时态派生 ──

export interface SegmentRuntime {
  /** 以任务为准的实时状态（无任务时回落持久化 status） */
  status: StepSegmentStatus
  /** 任务进度（0-100，无任务 0） */
  progress: number
  /** 最新一段视频产物资产（无则 null） */
  latestVideoAsset: CanvasAsset | null
  /** 任务失败信息 */
  errorText: string | null
}

function taskStatusToSegmentStatus(status: CanvasTask['status']): StepSegmentStatus | null {
  if (status === 'running' || status === 'pending') return 'generating'
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return null
}

/**
 * 分段运行态派生：任务在 snapshot.tasks 中以 taskId 查找，
 * 状态/进度/产物全部实时读取 —— 任务完成事件刷快照后自动更新。
 */
export function deriveSegmentRuntime(
  segment: StepShotSegment,
  snapshot: Pick<CanvasSnapshot, 'tasks' | 'assets'>,
): SegmentRuntime {
  const task = segment.taskId
    ? (snapshot.tasks.find((item) => item.id === segment.taskId) ?? null)
    : null
  if (!task) {
    const fallbackAsset = latestVideoAsset(segment.outputVideoAssetIds, snapshot.assets)
    return {
      status: segment.status,
      progress: 0,
      latestVideoAsset: fallbackAsset,
      errorText: null,
    }
  }
  const liveStatus = taskStatusToSegmentStatus(task.status)
  const outputIds =
    task.outputAssetIds.length > 0 ? task.outputAssetIds : segment.outputVideoAssetIds
  const runtimeError = extractTaskError(task)
  return {
    status: liveStatus ?? segment.status,
    progress: typeof task.progress === 'number' ? task.progress : 0,
    latestVideoAsset: latestVideoAsset(outputIds, snapshot.assets),
    errorText: runtimeError,
  }
}

function latestVideoAsset(ids: string[], assets: CanvasAsset[]): CanvasAsset | null {
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = ids[index]
    if (!id) continue
    const asset = assets.find((item) => item.id === id && item.type === 'video')
    if (asset) return asset
  }
  return null
}

function extractTaskError(task: CanvasTask): string | null {
  if (task.status !== 'failed') return null
  const events = task.runtimeEvents
  if (!Array.isArray(events) || events.length === 0) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    // CanvasTaskRuntimeEvent 的正文在 detail，label 是阶段名（如「生成失败」）
    const detail = typeof event.detail === 'string' ? event.detail.trim() : ''
    if (detail) return detail
  }
  return null
}

// ── 生成 prompt 与输入文件组装 ──

function assetSettingSummary(asset: CanvasAsset): string {
  const attrs = asset.metadata?.attributes
  const attrLines: string[] = []
  if (isRecordType(attrs)) {
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'string' && value.trim()) attrLines.push(`${key}：${value.trim()}`)
    }
  }
  const text = typeof asset.contentText === 'string' ? asset.contentText.trim() : ''
  const parts = [asset.title?.trim(), attrLines.join('；'), text].filter(Boolean)
  return parts.join(' — ')
}

/**
 * 分段生成 prompt：风格圣经 + 出镜资产设定 + 本段剧本 + 时长。
 * 资产设定来自设定步骤的结构化属性（与 buildFilmAssetReferencePrompt 同源口径）。
 */
export function buildStepSegmentPrompt(
  segment: StepShotSegment,
  assetsById: Map<string, CanvasAsset>,
  styleBible: string,
): string {
  const lines: string[] = []
  if (styleBible.trim()) lines.push(`【整体风格】${styleBible.trim()}`)

  const castLines: string[] = []
  for (const id of segment.characterAssetIds) {
    const asset = assetsById.get(id)
    if (asset) castLines.push(`- 角色 ${assetSettingSummary(asset)}`)
  }
  if (segment.sceneAssetId) {
    const scene = assetsById.get(segment.sceneAssetId)
    if (scene) castLines.push(`- 场景 ${assetSettingSummary(scene)}`)
  }
  for (const id of segment.propAssetIds) {
    const asset = assetsById.get(id)
    if (asset) castLines.push(`- 道具 ${assetSettingSummary(asset)}`)
  }
  if (castLines.length > 0) {
    lines.push('【出镜设定】')
    lines.push(...castLines)
  }

  lines.push('【本段剧本】')
  lines.push(segment.script.trim() || '（未填写剧本，请依据出镜设定生成分镜画面）')
  if (typeof segment.durationSec === 'number' && segment.durationSec > 0) {
    lines.push(`【时长】约 ${segment.durationSec} 秒`)
  }
  return lines.join('\n')
}

/** image 资产 → 带角色标记的媒体输入文件（url 优先，回落 storageKey 相对路径） */
export function assetToInputFile(
  asset: CanvasAsset,
  role: CanvasMediaTaskInputFile['role'],
): CanvasMediaTaskInputFile | null {
  const url = typeof asset.url === 'string' && asset.url ? asset.url : null
  const path = typeof asset.storageKey === 'string' && asset.storageKey ? asset.storageKey : null
  if (!url && !path) return null
  return {
    type: 'image',
    ...(role ? { role } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
  }
}

/**
 * 分段的媒体输入组装：
 * - reference 模式：出镜资产参考图 + 分段参考图，全部 role='reference'
 *   （多参考图 → prefersReferenceVideoCapability 自动走 reference_to_video）
 * - first_last_frame 模式：首帧 role='first_frame'、尾帧 role='last_frame'
 *
 * 影视资产（character/scene/prop）取其 references 中第一个可用 image 资产作参考图。
 */
export function collectSegmentInputFiles(
  segment: StepShotSegment,
  assetsById: Map<string, CanvasAsset>,
): CanvasMediaTaskInputFile[] {
  const files: CanvasMediaTaskInputFile[] = []

  if (segment.genMode === 'first_last_frame') {
    const first = segment.firstFrameAssetId ? assetsById.get(segment.firstFrameAssetId) : null
    const last = segment.lastFrameAssetId ? assetsById.get(segment.lastFrameAssetId) : null
    const firstFile = first ? assetToInputFile(first, 'first_frame') : null
    const lastFile = last ? assetToInputFile(last, 'last_frame') : null
    if (firstFile) files.push(firstFile)
    if (lastFile) files.push(lastFile)
    return files
  }

  const filmAssetIds = [...segment.characterAssetIds]
  if (segment.sceneAssetId) filmAssetIds.push(segment.sceneAssetId)
  filmAssetIds.push(...segment.propAssetIds)

  const seen = new Set<string>()
  const pushReference = (assetId: string): void => {
    if (seen.has(assetId)) return
    const asset = assetsById.get(assetId)
    if (!asset) return
    seen.add(assetId)
    const file = assetToInputFile(asset, 'reference')
    if (file) files.push(file)
  }

  for (const filmAssetId of filmAssetIds) {
    const filmAsset = assetsById.get(filmAssetId)
    const references = readFilmReferences(filmAsset)
    const primary = references[0]?.assetId
    if (primary) pushReference(primary)
  }
  for (const referenceAssetId of segment.referenceAssetIds) pushReference(referenceAssetId)
  return files
}

/** 影视资产的参考图 id 列表（FilmReference.assetId，按 order 排序） */
export function readFilmReferences(
  asset: CanvasAsset | undefined,
): Array<{ assetId: string; order: number }> {
  if (!asset) return []
  const raw = asset.metadata?.references
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        isRecordType(item) && typeof item.assetId === 'string',
    )
    .map((item) => ({
      assetId: item.assetId as string,
      order: typeof item.order === 'number' ? item.order : 0,
    }))
    .sort((a, b) => a.order - b.order)
}

/** 分段是否具备生成条件（有剧本或参考输入，且未在生成中） */
export function isSegmentGeneratable(
  segment: StepShotSegment,
  runtimeStatus: StepSegmentStatus,
): boolean {
  if (runtimeStatus === 'generating') return false
  if (segment.script.trim().length > 0) return true
  if (segment.genMode === 'first_last_frame') {
    return Boolean(segment.firstFrameAssetId || segment.lastFrameAssetId)
  }
  return segment.referenceAssetIds.length > 0
}

// ── @ 提及资产引用（二期）──

export interface SegmentMentionDetect {
  /** @ 后已输入的查询串（可为空串：仅键入 @） */
  query: string
  /** '@' 字符在文本中的下标 */
  startIndex: number
}

/**
 * 检测光标处未闭合的 @提及查询：从光标向前扫描到最近 '@'，
 * 中途遇空白即失败（@ 后不允许空白）；'@' 前必须是行首或空白
 * （避免吞邮箱类文本）；查询超长视为普通文本。
 */
export function detectMentionQuery(text: string, caretIndex: number): SegmentMentionDetect | null {
  if (!Number.isInteger(caretIndex) || caretIndex <= 0 || caretIndex > text.length) return null
  for (let index = caretIndex - 1; index >= 0; index -= 1) {
    const ch = text[index]
    if (ch === undefined) continue
    if (ch === '@') {
      const prev = index > 0 ? text[index - 1] : undefined
      if (prev != null && !/\s/.test(prev)) return null
      const query = text.slice(index + 1, caretIndex)
      if (query.length > 24) return null
      return { query, startIndex: index }
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

/**
 * 把提及查询区间替换为「@名称 」：区间从 '@' 起到光标；光标仍停在
 * 查询串中间时再向后延伸到首个空白（清掉查询尾部残字），随后消费
 * 紧邻的一个空白（插入串自带尾空格，避免落双空格）。
 */
export function applyMention(
  text: string,
  startIndex: number,
  caretIndex: number,
  label: string,
): { text: string; caret: number } {
  let end = caretIndex
  if (!/\s/.test(text[caretIndex] ?? ' ')) {
    while (end < text.length && !/\s/.test(text[end] ?? '')) end += 1
  }
  if (end < text.length && /\s/.test(text[end] ?? '')) end += 1
  const inserted = `@${label} `
  return {
    text: text.slice(0, startIndex) + inserted + text.slice(end),
    caret: startIndex + inserted.length,
  }
}

/** 提及面板候选（大小写不敏感的名称/查询包含匹配，取前 limit 条） */
export function filterMentionOptions<T extends { label: string }>(
  options: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options.slice(0, limit)
  return options.filter((option) => option.label.toLowerCase().includes(needle)).slice(0, limit)
}

// ── AI 拆分剧本（二期 R2-2）──

export interface ScriptBreakdownDraft {
  script: string
  durationSec?: number
  characterNames: string[]
  sceneName: string | null
  propNames: string[]
}

/**
 * 构造「AI 拆分剧本」文本任务 prompt：要求输出严格 JSON 分段数组，
 * 出镜资产只能引用项目内既有名称（匹配不到就留空，避免幻觉资产）。
 */
export function buildScriptBreakdownPrompt(
  script: string,
  assetNames: { characters: string[]; scenes: string[]; props: string[] },
): string {
  const lines = [
    '你是影视分镜师。把剧本拆分为可独立生成短视频的分段序列。',
    '【项目资产】（分段标注出镜时只能引用下列名称，匹配不到就留空）',
    `- 角色：${assetNames.characters.join('、') || '（无）'}`,
    `- 场景：${assetNames.scenes.join('、') || '（无）'}`,
    `- 道具：${assetNames.props.join('、') || '（无）'}`,
    '【剧本】',
    script.trim(),
    '【输出要求】',
    '1. 按叙事顺序拆为 3-12 个分段，每段一个镜头或情节单元；',
    '2. 只输出 JSON 数组本身，不要任何解释文字或代码块标记，格式：',
    '[{"script":"本段画面与动作描述","durationSec":6,"characters":["角色名"],"scene":"场景名","props":["道具名"]}]',
    '3. characters/scene/props 只能引用【项目资产】中存在的名称；',
    '4. durationSec 取 4-10 的整数；',
    '5. script 用中文、80 字以内，写画面与动作，不要罗列对白全文。',
  ]
  return lines.join('\n')
}

/** 从模型输出提取 JSON 数组文本（容忍 ```json 围栏与前后解释文字） */
function extractJsonArrayText(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

/**
 * 解析拆解产物为分段草稿（类型逐项容错：字段非法的条目丢弃字段，
 * script 缺失的条目整条丢弃；解析失败返回空数组由调用方提示手动处理）。
 */
export function parseBreakdownDrafts(modelText: string): ScriptBreakdownDraft[] {
  const jsonText = extractJsonArrayText(modelText)
  if (!jsonText) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const drafts: ScriptBreakdownDraft[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const script = typeof record.script === 'string' ? record.script.trim() : ''
    if (!script) continue
    const duration =
      typeof record.durationSec === 'number' && record.durationSec >= 1 && record.durationSec <= 60
        ? Math.round(record.durationSec)
        : undefined
    drafts.push({
      script,
      ...(duration != null ? { durationSec: duration } : {}),
      characterNames: coerceStringArray(record.characters),
      sceneName: coerceOptionalString(record.scene),
      propNames: coerceStringArray(record.props),
    })
    if (drafts.length >= 24) break
  }
  return drafts
}

/**
 * 把拆解草稿解析为可追加的分段：名称按「精确 → 大小写不敏感包含」匹配
 * 项目资产，并把引用写入对应字段；未匹配名称静默忽略（分段仍保留剧本）。
 */
export function breakdownDraftToSegment(
  draft: ScriptBreakdownDraft,
  sequenceId: string,
  order: number,
  assets: ReadonlyArray<{ id: string; title: string; kind: 'character' | 'scene' | 'prop' }>,
): StepShotSegment {
  const findAssetId = (name: string, kind: 'character' | 'scene' | 'prop'): string | null => {
    const needle = name.trim()
    if (!needle) return null
    const pool = assets.filter((asset) => asset.kind === kind)
    const exact = pool.find((asset) => asset.title.trim().toLowerCase() === needle.toLowerCase())
    if (exact) return exact.id
    const partial = pool.find((asset) => asset.title.toLowerCase().includes(needle.toLowerCase()))
    return partial?.id ?? null
  }

  const characterAssetIds = [
    ...new Set(draft.characterNames.map((name) => findAssetId(name, 'character')).filter(Boolean)),
  ] as string[]
  const propAssetIds = [
    ...new Set(draft.propNames.map((name) => findAssetId(name, 'prop')).filter(Boolean)),
  ] as string[]
  const sceneAssetId = draft.sceneName ? findAssetId(draft.sceneName, 'scene') : null

  return {
    ...createSegment(sequenceId, order),
    script: draft.script,
    ...(draft.durationSec != null ? { durationSec: draft.durationSec } : {}),
    characterAssetIds,
    ...(sceneAssetId ? { sceneAssetId } : {}),
    propAssetIds,
  }
}
