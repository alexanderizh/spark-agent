/**
 * 视频工作台类型定义。
 *
 * 节点 data 字段 videoWorkbench 持有 VideoWorkbenchData，
 * 持久化到画布节点；工作台 Modal 从中读取/回写。
 */

/** 关键帧提取策略 */
export type KeyframeStrategy = 'scene' | 'iframe' | 'uniform'

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
  type: 'keyframes' | 'trim' | 'concat' | 'transcode' | 'effect'
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

/** 工作台激活的 Tab */
export type VideoWorkbenchTab = 'frames' | 'edit' | 'output'

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
    activeTab: 'frames',
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
  return {
    sourceVideoAssetId: typeof raw.sourceVideoAssetId === 'string' ? raw.sourceVideoAssetId : undefined,
    probeInfo: isProbeInfo(raw.probeInfo) ? raw.probeInfo : undefined,
    keyframes: Array.isArray(raw.keyframes) ? (raw.keyframes as WorkbenchKeyframe[]) : [],
    extractConfig: {
      strategy: isValidStrategy((raw.extractConfig as { strategy?: string })?.strategy)
        ? ((raw.extractConfig as { strategy: string }).strategy as KeyframeStrategy)
        : defaults.extractConfig.strategy,
      threshold: typeof (raw.extractConfig as { threshold?: number })?.threshold === 'number'
        ? (raw.extractConfig as { threshold: number }).threshold
        : defaults.extractConfig.threshold,
      intervalSec: typeof (raw.extractConfig as { intervalSec?: number })?.intervalSec === 'number'
        ? (raw.extractConfig as { intervalSec: number }).intervalSec
        : defaults.extractConfig.intervalSec,
      maxFrames: typeof (raw.extractConfig as { maxFrames?: number })?.maxFrames === 'number'
        ? (raw.extractConfig as { maxFrames: number }).maxFrames
        : defaults.extractConfig.maxFrames,
    },
    outputs: Array.isArray(raw.outputs) ? (raw.outputs as WorkbenchOutput[]) : [],
    manualMarks: Array.isArray(raw.manualMarks) ? (raw.manualMarks as number[]) : [],
    activeTab: isValidTab(raw.activeTab) ? (raw.activeTab as VideoWorkbenchTab) : defaults.activeTab,
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
  return t === 'frames' || t === 'edit' || t === 'output'
}
