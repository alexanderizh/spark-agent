/**
 * 视频工作台类型定义。
 *
 * 节点 data 字段 videoWorkbench 持有 VideoWorkbenchData，
 * 持久化到画布节点；工作台 Modal 从中读取/回写。
 */

/** 关键帧提取策略 */
export type KeyframeStrategy = 'scene' | 'iframe' | 'uniform'

/** 均匀采样允许的最小时间间隔（秒）。 */
export const MIN_UNIFORM_INTERVAL_SEC = 0.2

/** 觢频探测结果（镜像主进程 VideoProbeInfo 的可序列化形式） */
export interface VideoProbeInfo {
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  hasAudio: boolean
  bitrate: number
  fileSize: number
}

/** 已提取的关键帧（渲染端表示，含回填画布后的 nodeId） */
export interface WorkbenchKeyframe {
  /** 产物绝对路径 */
  path: string
  /** safe-file 协议编码后的预览 URL */
  previewUrl: string
  /** 在视频中的时间戳（秒） */
  timestampSec: number
  /** 序号 */
  index: number
  /** 已回填为画布节点后的 id（未回填时为 null） */
  canvasNodeId?: string | null
}

/** 提取配置 */
export interface KeyframeExtractConfig {
  strategy: KeyframeStrategy
  /** scene 模式阈值 0~1 */
  threshold: number
  /** uniform 模式间隔（秒） */
  intervalSec: number
  /** 上限保护 */
  maxFrames: number
}

/** 工作台产物（剪辑/转码等操作的结果） */
export interface WorkbenchOutput {
  id: string
  type: 'keyframes' | 'trim' | 'segment' | 'concat' | 'transcode' | 'effect' | 'audio'
  /** 产物文件路径 */
  outputPath: string
  /** safe-file 编码后的预览/播放 URL */
  outputUrl: string
  /** 回填画布后的节点 id */
  canvasNodeId?: string
  createdAt: number
  /** 操作摘要，如 "裁剪 00:12-00:45" */
  summary: string
}

/** 产物复制到项目并创建画布节点后的持久化引用。 */
export interface WorkbenchCanvasMaterialization {
  nodeId: string
  outputPath: string
  outputUrl: string
}

/** 工作台激活的 Tab */
export type VideoWorkbenchTab = 'resources' | 'frames' | 'edit' | 'output'

/** 资源来源分类 */
export type WorkbenchResourceSource = 'upstream' | 'canvas' | 'local'

/** 资源媒体类型（V1 读取器也接受 audio，供多轨兼容视图复用）。 */
export type WorkbenchResourceKind = 'video' | 'image' | 'audio'

/**
 * 资源面板条目。
 *
 * 一个资源 = 一条磁盘上的媒体（视频或图片），可能是：
 *  - 上级连线节点产出的"首选产物"（自动收集或用户从画布选择）
 *  - 从画布上的图片/视频节点导入
 *  - 用户从本机导入（落到项目目录）
 *
 * 持久化字段全部可选（旧节点没有这些字段时为 undefined）。
 */
export interface WorkbenchResource {
  /** 资源面板内唯一 id（modal 内生成，与画布节点 id 不同） */
  id: string
  /** 来源分类 */
  source: WorkbenchResourceSource
  /** 媒体类型：视频 / 图片 / 音频 */
  kind: WorkbenchResourceKind
  /** 显示名（沿用节点标题 / 文件名） */
  title: string
  /** 浏览器可播放的 URL（safe-file:// 编码或 http） */
  url: string
  /** 磁盘绝对路径，ffmpeg 需要（图片可作为静帧视频来源） */
  originPath: string
  /** 缩略图 URL（视频可取自关键帧；图片可用 url 本身） */
  thumbnailUrl?: string | undefined
  /** 视频时长（秒），仅视频有 */
  durationSec?: number | undefined
  /** 宽（视频/图片通用） */
  width?: number | undefined
  /** 高 */
  height?: number | undefined
  /** 文件大小（字节），仅本机导入知道 */
  fileSize?: number | undefined
  /** source === 'upstream' 时记录来源画布节点 id（用于回链/重收集） */
  upstreamNodeId?: string | undefined
  /** 上游节点多个产物时的 index（默认 0 = 首选） */
  upstreamArtifactIndex?: number | undefined
  /** 导入时间戳（毫秒） */
  importedAt: number
}

/**
 * 主时间线轨道上的一个片段。
 *
 * 引用 WorkbenchResource，不复制数据；顺序由 order 字段控制。
 * 静态图资源（kind=image）通过 staticDuration 固定展示时长。
 */
export interface TrackClip {
  /** 轨道内唯一 id */
  id: string
  /** 引用资源面板条目的 id */
  resourceId: string
  /** 排序，按 order 升序展示 */
  order: number
  /** 单段二次裁剪入/出点（秒），缺省 = 资源全长 */
  range?: { startSec: number; endSec: number }
  /** 图片资源作为静帧展示的固定时长（秒），默认 8s */
  staticDuration?: number
}

/**
 * 视频工作台节点数据，持久化在 node.data.videoWorkbench。
 * 源视频路径来自 node.data.url（与普通视频节点一致）。
 */
export interface VideoWorkbenchData {
  /** 源视频资产 id */
  sourceVideoAssetId: string | undefined
  /** ffprobe 结果缓存（首次打开时填充） */
  probeInfo: VideoProbeInfo | undefined
  /** 已提取的关键帧 */
  keyframes: WorkbenchKeyframe[]
  /** 当前提取配置 */
  extractConfig: KeyframeExtractConfig
  /** 工作台产物列表 */
  outputs: WorkbenchOutput[]
  /** 手动标记的时间点列表（秒），用于批量抽帧 */
  manualMarks: number[]
  /** 当前激活的 Tab */
  activeTab: VideoWorkbenchTab
  /** 资源面板条目（含上游自动收集 + 画布导入 + 本机导入） */
  resourcePanel: WorkbenchResource[]
  /** 主时间线轨道（多段拼接，按 order 升序） */
  track: TrackClip[]
  /** 是否在打开时按上级连线自动收集上游节点的首选产物 */
  autoCollectUpstream: boolean
}

/** 创建默认工作台数据 */
export function createDefaultVideoWorkbenchData(): VideoWorkbenchData {
  return {
    sourceVideoAssetId: undefined,
    probeInfo: undefined,
    keyframes: [],
    extractConfig: {
      strategy: 'scene',
      threshold: 0.3,
      intervalSec: 10,
      maxFrames: 20,
    },
    outputs: [],
    manualMarks: [],
    activeTab: 'resources',
    resourcePanel: [],
    track: [],
    autoCollectUpstream: true,
  }
}

/** 把秒数格式化为 mm:ss 或 hh:mm:ss */
export function formatTimestamp(sec: number): string {
  const safe = !Number.isFinite(sec) || sec < 0 ? 0 : sec
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 读取并规范化工作台数据（兼容旧节点 / 缺失字段） */
export function readVideoWorkbenchData(
  raw: Record<string, unknown> | undefined,
): VideoWorkbenchData {
  if (!raw) return createDefaultVideoWorkbenchData()
  const defaults = createDefaultVideoWorkbenchData()
  const resourcePanel = Array.isArray(raw.resourcePanel)
    ? raw.resourcePanel.filter(isWorkbenchResource)
    : defaults.resourcePanel
  const resourceIds = new Set(resourcePanel.map((resource) => resource.id))
  const track = Array.isArray(raw.track)
    ? raw.track.filter(isTrackClip).filter((clip) => resourceIds.has(clip.resourceId))
    : defaults.track
  return {
    sourceVideoAssetId:
      typeof raw.sourceVideoAssetId === 'string' ? raw.sourceVideoAssetId : undefined,
    probeInfo: isProbeInfo(raw.probeInfo) ? raw.probeInfo : undefined,
    keyframes: Array.isArray(raw.keyframes) ? (raw.keyframes as WorkbenchKeyframe[]) : [],
    extractConfig: {
      strategy: isValidStrategy((raw.extractConfig as { strategy?: string })?.strategy)
        ? ((raw.extractConfig as { strategy: string }).strategy as KeyframeStrategy)
        : defaults.extractConfig.strategy,
      threshold:
        typeof (raw.extractConfig as { threshold?: number })?.threshold === 'number'
          ? (raw.extractConfig as { threshold: number }).threshold
          : defaults.extractConfig.threshold,
      intervalSec: Number.isFinite((raw.extractConfig as { intervalSec?: number })?.intervalSec)
        ? Math.max(
            MIN_UNIFORM_INTERVAL_SEC,
            (raw.extractConfig as { intervalSec: number }).intervalSec,
          )
        : defaults.extractConfig.intervalSec,
      maxFrames:
        typeof (raw.extractConfig as { maxFrames?: number })?.maxFrames === 'number'
          ? (raw.extractConfig as { maxFrames: number }).maxFrames
          : defaults.extractConfig.maxFrames,
    },
    outputs: Array.isArray(raw.outputs) ? (raw.outputs as WorkbenchOutput[]) : [],
    manualMarks: Array.isArray(raw.manualMarks) ? (raw.manualMarks as number[]) : [],
    activeTab: isValidTab(raw.activeTab)
      ? (raw.activeTab as VideoWorkbenchTab)
      : defaults.activeTab,
    resourcePanel,
    track,
    autoCollectUpstream:
      typeof raw.autoCollectUpstream === 'boolean'
        ? raw.autoCollectUpstream
        : defaults.autoCollectUpstream,
  }
}

function isProbeInfo(v: unknown): v is VideoProbeInfo {
  if (typeof v !== 'object' || v == null) return false
  const o = v as Record<string, unknown>
  return typeof o.durationSec === 'number' && typeof o.width === 'number'
}
function isValidStrategy(s: unknown): s is KeyframeStrategy {
  return s === 'scene' || s === 'iframe' || s === 'uniform'
}
function isValidTab(t: unknown): t is VideoWorkbenchTab {
  return t === 'resources' || t === 'frames' || t === 'edit' || t === 'output'
}
function isWorkbenchResource(v: unknown): v is WorkbenchResource {
  if (typeof v !== 'object' || v == null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.url === 'string' &&
    o.url.length > 0 &&
    typeof o.originPath === 'string' &&
    o.originPath.length > 0 &&
    typeof o.title === 'string' &&
    Number.isFinite(o.importedAt) &&
    isOptionalString(o.thumbnailUrl) &&
    isOptionalFiniteNumber(o.durationSec) &&
    isOptionalFiniteNumber(o.width) &&
    isOptionalFiniteNumber(o.height) &&
    isOptionalFiniteNumber(o.fileSize) &&
    isOptionalString(o.upstreamNodeId) &&
    isOptionalFiniteNumber(o.upstreamArtifactIndex) &&
    (o.source === 'upstream' || o.source === 'canvas' || o.source === 'local') &&
    (o.kind === 'video' || o.kind === 'image' || o.kind === 'audio')
  )
}
function isTrackClip(v: unknown): v is TrackClip {
  if (typeof v !== 'object' || v == null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.resourceId === 'string' &&
    o.resourceId.length > 0 &&
    Number.isInteger(o.order) &&
    Number(o.order) >= 0 &&
    isOptionalPositiveNumber(o.staticDuration) &&
    isOptionalTrackRange(o.range)
  )
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function isOptionalPositiveNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0)
}

function isOptionalTrackRange(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'object' || value == null) return false
  const range = value as Record<string, unknown>
  return (
    typeof range.startSec === 'number' &&
    Number.isFinite(range.startSec) &&
    range.startSec >= 0 &&
    typeof range.endSec === 'number' &&
    Number.isFinite(range.endSec) &&
    range.endSec > range.startSec
  )
}
