import type {
  CanvasProject,
  CanvasProjectMode,
  StepSegmentStatus,
  StepStudioStageKey,
  StepStudioState,
} from '../canvas.types'

/**
 * 步骤模式（Step Studio）项目级元数据与内容状态的读写 helper。
 *
 * 存储契约（todo/步骤模式与资产库全面改造设计.md §4.1/§4.2）：
 * - `project.metadata.stepStudio`      → StepStudioProjectMeta（模式 + 当前步骤，高频小写入）
 * - `project.metadata.stepStudioState` → StepStudioState（分段序列等内容，P5 起写入）
 *
 * 两键分离的原因：updateProjectMetadata 是浅合并整键替换，模式切换（频繁）与
 * 分段内容写入（生成回填）若共用一键，读-改-写会互相覆盖丢数据。
 *
 * 所有读取均做缺省容错：老项目无字段 → lastMode 'canvas' / activeStep 'setup'，
 * 零迁移。metadata 值来自 JSON 反序列化，视为不可信输入，逐字段校验。
 */

/** project.metadata 中存放模式元数据的键 */
export const STEP_STUDIO_META_KEY = 'stepStudio'
/** project.metadata 中存放内容状态（分段序列）的键 */
export const STEP_STUDIO_STATE_KEY = 'stepStudioState'

export interface StepStudioProjectMeta {
  /** 上次使用的创作模式（项目级记忆，重开项目恢复） */
  lastMode: CanvasProjectMode
  /** 步骤模式当前停留步骤 */
  activeStep: StepStudioStageKey
}

const CANVAS_PROJECT_MODES: readonly CanvasProjectMode[] = ['canvas', 'step']
const STEP_STUDIO_STAGE_KEYS: readonly StepStudioStageKey[] = ['setup', 'storyboard', 'assembly']
const STEP_SEGMENT_STATUSES: readonly StepSegmentStatus[] = [
  'draft',
  'generating',
  'done',
  'failed',
]

/** 缺省元数据：老项目 / 无效数据一律回落画布模式第一步 */
export const DEFAULT_STEP_STUDIO_META: StepStudioProjectMeta = {
  lastMode: 'canvas',
  activeStep: 'setup',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取项目创作模式元数据（容错：无效/缺失字段回落缺省值） */
export function readStepStudioMeta(
  project: Pick<CanvasProject, 'metadata'>,
): StepStudioProjectMeta {
  const raw = project.metadata?.[STEP_STUDIO_META_KEY]
  if (!isRecord(raw)) return { ...DEFAULT_STEP_STUDIO_META }
  const lastMode = CANVAS_PROJECT_MODES.includes(raw.lastMode as CanvasProjectMode)
    ? (raw.lastMode as CanvasProjectMode)
    : DEFAULT_STEP_STUDIO_META.lastMode
  const activeStep = STEP_STUDIO_STAGE_KEYS.includes(raw.activeStep as StepStudioStageKey)
    ? (raw.activeStep as StepStudioStageKey)
    : DEFAULT_STEP_STUDIO_META.activeStep
  return { lastMode, activeStep }
}

/** 构造写 metadata 的 patch（可直接传 store.updateProjectMetadata） */
export function stepStudioMetaPatch(meta: StepStudioProjectMeta): Record<string, unknown> {
  return { [STEP_STUDIO_META_KEY]: { ...meta } }
}

// ── StepStudioState（内容状态）读写 ──

function isValidStepStudioState(value: unknown): value is StepStudioState {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 1) return false
  if (!Array.isArray(value.sequences)) return false
  return value.sequences.every((seq) => isRecord(seq) && Array.isArray(seq.segments))
}

/**
 * 读取步骤模式内容状态；无/无效时返回 null（调用方自行决定是否初始化默认序列）。
 * 注意：序列内部字段（StepShotSegment）的深层校验在消费端按需进行——
 * 这里只保证顶层结构可信，避免热路径全量深校验。
 */
export function readStepStudioState(
  project: Pick<CanvasProject, 'metadata'>,
): StepStudioState | null {
  const raw = project.metadata?.[STEP_STUDIO_STATE_KEY]
  return isValidStepStudioState(raw) ? raw : null
}

/** 构造内容状态写入 patch */
export function stepStudioStatePatch(state: StepStudioState): Record<string, unknown> {
  return { [STEP_STUDIO_STATE_KEY]: state }
}

/**
 * 容错读取 AI 拆分剧本任务指针（state 深层视为不可信 JSON：
 * 非法形态一律视为无进行中的拆解任务）。
 */
export function readBreakdownTask(
  state: StepStudioState | null,
): { taskId: string; sequenceId: string } | null {
  const raw = state?.breakdown
  if (!isRecord(raw)) return null
  if (typeof raw.taskId !== 'string' || !raw.taskId) return null
  if (typeof raw.sequenceId !== 'string' || !raw.sequenceId) return null
  return { taskId: raw.taskId, sequenceId: raw.sequenceId }
}

// ── 分段状态工具（供 P5 分镜步骤使用；状态枚举校验在此收敛一处） ──

export function isStepSegmentStatus(value: unknown): value is StepSegmentStatus {
  return typeof value === 'string' && STEP_SEGMENT_STATUSES.includes(value as StepSegmentStatus)
}
