import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  Handle,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react'
import { Dropdown } from '@lobehub/ui'
import { Progress } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { canvasFlowNodeDataEqual } from './canvasStageNodeSync'
import { operationLabel } from './canvas.api'
import { isCanvasImageContentNode, isOperationNode, nodeOperation } from './canvas.capabilities'
import {
  isLongText,
  keepsCanvasMediaNodeAspectRatio,
  pickCanvasNodeMinSize,
} from './canvasNodeSize'
import { getNodePipelineActions } from './canvasPipeline'
import {
  CANVAS_GENERAL_CREATE_OPERATION_GROUPS,
  CANVAS_PIPELINE_CREATE_OPERATIONS,
} from './canvasNodeGenerationMenu'
import { buildCanvasOperationParamSummary } from './canvasOperationParamSummary'
import {
  getNodeCurrentSubtype,
  getNodeSubtypeOptions,
  isSubtypeSwitchable,
} from './canvasNodeSubtypeSwitch'
import { readRenderableShotScriptRows } from './canvasShotScriptPresentation'
import type { ParsedShotRow } from './canvasShotTableParse'
import { resolveStoryboardSplitSourceNode } from './canvasStoryboardNodeSplit'
import {
  CanvasOperationOutputList,
  CanvasOperationOutputPreview,
} from './CanvasOperationOutputPreview'
import { CanvasShotScriptTable } from './CanvasShotScriptTable'
import { resolveCanvasOperationOutputState } from './canvasOperationOutputModel'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'
import type { CanvasOperationOutputMode, CanvasOperationType } from './canvas.types'
import type { CanvasNodeData } from './canvas.types'
import type { CanvasOperationRunView } from './canvasOperationRuns'

/** 把 op 的图标 key 映射为 Icons 组件（找不到回退 Workflow） */
function resolvePipelineIcon(iconKey: string | undefined, size = 14): React.ReactNode {
  const map = Icons as unknown as Record<string, (p: { size?: number }) => React.ReactNode>
  const IconFn = (iconKey && map[iconKey]) || Icons.Workflow
  return <IconFn size={size} />
}

/** 从节点数据里解析导演台站位（兼容 v2 items / 旧版 objects），用于卡片迷你俯视图。 */
function readDirectorStageMini(data: SparkCanvasNode['data']): {
  items: Array<{ x: number; z: number; color: string }>
  camera: { x: number; z: number; facing: number; fov: number }
} | null {
  const raw = data.directorStage as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  const clamp = (v: number) => Math.min(1, Math.max(-1, v))
  const fovFromFocal = (focal: number) =>
    (2 * Math.atan(36 / (2 * Math.min(300, Math.max(8, focal || 35)))) * 180) / Math.PI

  if (Array.isArray(raw.items) && raw.camera && typeof raw.camera === 'object') {
    const cam = raw.camera as Record<string, unknown>
    const items = (raw.items as Array<Record<string, unknown>>)
      .filter((it) => typeof it.x === 'number')
      .map((it) => ({
        x: clamp(Number(it.x) || 0),
        z: clamp(Number(it.z) || 0),
        color: typeof it.color === 'string' ? it.color : '#60a5fa',
      }))
    return {
      items,
      camera: {
        x: clamp(Number(cam.x) || 0),
        z: clamp(Number.isFinite(Number(cam.z)) ? Number(cam.z) : 0.9),
        facing: Number(cam.facing) || 0,
        fov: fovFromFocal(Number(cam.focalLength) || 35),
      },
    }
  }

  if (Array.isArray(raw.objects)) {
    const objs = raw.objects as Array<Record<string, unknown>>
    const camObj = objs.find((o) => o.kind === 'camera')
    const items = objs
      .filter((o) => o.kind !== 'camera')
      .map((o) => {
        const pos = (o.position as { x?: number; z?: number } | undefined) ?? {}
        return {
          x: clamp((Number(pos.x) || 0) / 5),
          z: clamp((Number(pos.z) || 0) / 5),
          color: o.kind === 'prop' ? '#e2e8f0' : '#60a5fa',
        }
      })
    const camPos = (camObj?.position as { x?: number; z?: number } | undefined) ?? {}
    return {
      items,
      camera: {
        x: clamp((Number(camPos.x) || 0) / 5),
        z: clamp((Number(camPos.z) || 4) / 5),
        facing: 0,
        fov: 50,
      },
    }
  }
  return null
}

/** 导演台节点卡片：迷你俯视图（网格 + 站位点 + 相机 FOV 扇形）。 */
function DirectorStageMini({ data, nodeId }: { data: SparkCanvasNode['data']; nodeId: string }) {
  const stage = readDirectorStageMini(data)
  const clipId = `mini-stage-clip-${nodeId}`
  const toPlan = (x: number, z: number) => ({ px: 50 + x * 40, py: 50 + z * 40 })
  const cam = stage ? toPlan(stage.camera.x, stage.camera.z) : { px: 50, py: 90 }
  const head = (deg: number) => ({
    hx: Math.sin((deg * Math.PI) / 180),
    hy: -Math.cos((deg * Math.PI) / 180),
  })
  const fov = stage?.camera.fov ?? 50
  const facing = stage?.camera.facing ?? 0
  const left = head(facing - fov / 2)
  const right = head(facing + fov / 2)
  const L = 120
  return (
    <svg
      className="canvas-node-director-mini"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="8" y="8" width="84" height="84" rx="4" />
        </clipPath>
      </defs>
      <rect x="8" y="8" width="84" height="84" rx="4" className="mini-floor" />
      <g clipPath={`url(#${clipId})`} className="mini-grid">
        {[26, 44, 62, 80].map((v) => (
          <line key={`mx-${v}`} x1={v} y1="8" x2={v} y2="92" />
        ))}
        {[26, 44, 62, 80].map((v) => (
          <line key={`my-${v}`} x1="8" y1={v} x2="92" y2={v} />
        ))}
      </g>
      <polygon
        clipPath={`url(#${clipId})`}
        className="mini-cone"
        points={`${cam.px},${cam.py} ${cam.px + left.hx * L},${cam.py + left.hy * L} ${cam.px + right.hx * L},${cam.py + right.hy * L}`}
      />
      {stage?.items.map((item, index) => {
        const p = toPlan(item.x, item.z)
        return (
          <circle key={index} cx={p.px} cy={p.py} r={3.4} fill={item.color} className="mini-dot" />
        )
      })}
      <rect x={cam.px - 3} y={cam.py - 3} width={6} height={6} rx={1.4} className="mini-cam" />
    </svg>
  )
}

/** 真·3D 导演台节点卡片：角色/道具计数 + 最近一次截图缩略图（若有）。 */
function Stage3DMini({ data }: { data: SparkCanvasNode['data'] }) {
  const raw = data.stage3d as Record<string, unknown> | undefined
  const actors = Array.isArray(raw?.actors) ? (raw!.actors as unknown[]).length : 0
  const props = Array.isArray(raw?.props) ? (raw!.props as unknown[]).length : 0
  const thumb = data.thumbnailUrl ?? (typeof raw?.thumbnailUrl === 'string' ? raw.thumbnailUrl : '')
  const normalizedThumb = thumb ? normalizeEduAssetUrl(thumb) : ''
  return (
    <div className="canvas-node-stage3d">
      {normalizedThumb ? (
        <img className="canvas-node-stage3d-thumb" src={normalizedThumb} alt="3D 导演台预览" />
      ) : (
        <Icons.Box size={30} />
      )}
      <div className="canvas-node-stage3d-stats">
        <span>角色 {actors}</span>
        <span>道具 {props}</span>
      </div>
      <div className="canvas-node-stage3d-hint">双击进入三维编排</div>
    </div>
  )
}

/** 视频工作台节点卡片：源视频缩略图 + 关键帧计数 + 提示。 */
function VideoWorkbenchMini({ data }: { data: SparkCanvasNode['data'] }) {
  const raw = data.videoWorkbench as Record<string, unknown> | undefined
  const keyframeCount = Array.isArray(raw?.keyframes) ? (raw!.keyframes as unknown[]).length : 0
  const probe = raw?.probeInfo as
    | { durationSec?: number; width?: number; height?: number }
    | undefined
  const thumb = data.thumbnailUrl ?? ''
  const normalizedThumb = thumb ? normalizeEduAssetUrl(thumb) : ''
  const durationLabel = probe?.durationSec ? formatVwbDuration(probe.durationSec) : null
  const resolutionLabel = probe?.width && probe?.height ? `${probe.width} × ${probe.height}` : null
  return (
    <div className="canvas-node-video-workbench">
      <div className="canvas-node-vwb-stage">
        {normalizedThumb ? (
          <img className="canvas-node-vwb-thumb" src={normalizedThumb} alt="视频工作台预览" />
        ) : (
          <div className="canvas-node-vwb-nothumb">
            <Icons.Video size={30} />
            <span>等待导入视频素材</span>
          </div>
        )}
        <div className="canvas-node-vwb-shade" />
        <div className="canvas-node-vwb-play">
          <Icons.Play size={18} />
        </div>
        <div className="canvas-node-vwb-badges">
          {durationLabel ? <span>{durationLabel}</span> : null}
          {resolutionLabel ? <span>{resolutionLabel}</span> : null}
        </div>
      </div>
      <div className="canvas-node-vwb-footer">
        <div className="canvas-node-vwb-summary">
          <span className="canvas-node-vwb-summary-dot" />
          <span>{keyframeCount > 0 ? `${keyframeCount} 个关键帧` : '尚未提取关键帧'}</span>
        </div>
        <span className="canvas-node-vwb-hint">双击进入工作台</span>
      </div>
    </div>
  )
}

/** mm:ss 时长格式化（VideoWorkbenchMini 专用，避免循环依赖 videoWorkbench.types） */
function formatVwbDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 操作节点图标：工作流语义优先于底层 operation 类型。 */
function operationNodeIcon(
  operation: CanvasOperationType | null,
  workflow?: string,
): React.ReactNode {
  if (workflow === 'extract_character') return <Icons.User size={13} />
  if (workflow === 'extract_scene') return <Icons.Box size={13} />
  if (!operation) return <Icons.Sparkles size={13} />
  if (
    operation.startsWith('text_to_image') ||
    operation === 'image_to_image' ||
    operation === 'image_edit' ||
    operation === 'image_compose' ||
    operation === 'storyboard_grid' ||
    operation === 'panorama_360'
  ) {
    return <Icons.Image size={13} />
  }
  if (operation.includes('video')) {
    return <Icons.Play size={13} />
  }
  if (operation.includes('audio')) {
    return <Icons.File size={13} />
  }
  return <Icons.Sparkles size={13} />
}

function operationStatusLabel(status: SparkCanvasNode['data']['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

function operationRuntimeSummary(node: SparkCanvasNode): string | null {
  const model = typeof node.data.modelId === 'string' ? node.data.modelId.trim() : ''
  if (model) return `模型 ${model}`
  const manifest = typeof node.data.manifestId === 'string' ? node.data.manifestId.trim() : ''
  if (manifest) return `工作流 ${manifest}`
  const provider =
    typeof node.data.providerProfileId === 'string' ? node.data.providerProfileId.trim() : ''
  return provider ? `Provider ${provider}` : null
}

function OperationOutputDeck({
  runs,
  mode,
  fallback,
}: {
  runs: CanvasOperationRunView[]
  mode: CanvasOperationOutputMode
  fallback: ReactNode
}) {
  const [runIndex, setRunIndex] = useState(0)
  const [outputIndex, setOutputIndex] = useState(0)
  const runsKey = runs.map((run) => `${run.taskId}:${run.status}:${run.outputs.length}`).join('|')

  useEffect(() => {
    // 新一轮运行进入列表或状态变化时回到最新运行；用户手动切换产物不会触发。
    setRunIndex(0)
    setOutputIndex(0)
  }, [runsKey])

  const activeRun = runs[runIndex]
  const outputs = activeRun?.outputs ?? []
  const activeOutput = outputs[Math.min(outputIndex, Math.max(0, outputs.length - 1))]
  const displayRunNumber = activeRun ? runs.length - runIndex : 0
  const isCollection = mode === 'collection' && outputs.length > 0
  const shouldShowOutputNavigation = runs.length > 1 || (!isCollection && outputs.length > 1)

  if (!activeRun) return <>{fallback}</>

  return (
    <div className="canvas-operation-output-deck">
      <div className={`canvas-operation-output-stage${isCollection ? ' is-collection' : ''}`}>
        {isCollection ? (
          <CanvasOperationOutputList outputs={outputs} />
        ) : (
          <>
            {activeOutput ? <CanvasOperationOutputPreview output={activeOutput} /> : fallback}
            <div className="canvas-operation-output-stage-label">
              <span>{activeOutput?.title ?? operationStatusLabel(activeRun.status)}</span>
              {outputs.length > 1 ? (
                <span>
                  {Math.min(outputIndex + 1, outputs.length)}/{outputs.length}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
      {shouldShowOutputNavigation ? (
        <div className="canvas-operation-output-nav nodrag nopan">
          <div className="canvas-operation-run-nav">
            <button
              type="button"
              aria-label="查看更新的一次运行"
              disabled={runIndex === 0}
              onClick={(event) => {
                event.stopPropagation()
                setRunIndex((current) => Math.max(0, current - 1))
                setOutputIndex(0)
              }}
            >
              <Icons.ChevronLeft size={13} />
            </button>
            <span>
              第 {displayRunNumber} 次运行
              {runs.length > 1 ? ` / 共 ${runs.length} 次` : ''}
            </span>
            <button
              type="button"
              aria-label="查看更早的一次运行"
              disabled={runIndex >= runs.length - 1}
              onClick={(event) => {
                event.stopPropagation()
                setRunIndex((current) => Math.min(runs.length - 1, current + 1))
                setOutputIndex(0)
              }}
            >
              <Icons.ChevronRight size={13} />
            </button>
          </div>
          {!isCollection && outputs.length > 1 ? (
            <div className="canvas-operation-output-dots" aria-label="本次运行产物">
              {outputs.map((output, index) => (
                <button
                  key={output.id}
                  type="button"
                  className={index === outputIndex ? 'is-active' : ''}
                  aria-label={`查看产物 ${index + 1}：${output.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setOutputIndex(index)
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  assetSubviewCount?: number
  /** 当前操作节点的运行历史与各次产物，仅用于视图聚合。 */
  operationRuns?: CanvasOperationRunView[]
  operationRunsFingerprint?: string
  /** 依据产物比例计算的视图高度；不改写持久化节点尺寸。 */
  baseRenderedHeight?: number
  /** V4 标题行与底栏占用的视图高度；持久化尺寸不包含这部分。 */
  cardChromeExtraHeight?: number
  /** 该资源节点由操作节点 generated edge 产出。 */
  isGeneratedOutput?: boolean
  lineage?: {
    incoming: number
    outgoing: number
    generated: number
    usedAsInput: number
  }
  inlineToolbar?: ReactNode
  inlinePanel?: ReactNode
  inlinePanelExtraHeight?: number
  inlineToolbarHeight?: number
  inlinePanelExtraWidth?: number
  actions: {
    duplicateNode: (nodeId: string) => void
    editNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    downloadMedia: (nodeId: string) => void
    toggleLockNode: (nodeId: string) => void
    bringNodeToFront: (nodeId: string) => void
    mergeGroupToImage: (groupId: string) => void
    mergeSelectionToImage: () => void
    createGroupFromSelection: () => void
    addSelectionToGroup: (groupId: string) => void
    removeNodeFromGroup: (nodeId: string) => void
    dissolveGroup: (groupId: string) => void
    /** 单节点右键：把该节点加入画布 Agent 对话引用列表 */
    addNodeToAgent?: (nodeId: string) => void
    openAiComposer: (nodeId: string) => void
    saveToLibrary: (nodeId: string) => void
    annotateImage?: (nodeId: string) => void
    splitGridImage?: (nodeId: string) => void
    splitStoryboard?: (nodeId: string) => void
    extractCharacterSubview?: (nodeId: string) => void
    /** 360 全景产物节点：右键 → 全景预览（与普通图片「编辑」解耦） */
    previewPanorama: (nodeId: string) => void
    /** 视频节点：右键 → 视频编辑（打开视频工作台） */
    editVideo?: (nodeId: string) => void
    /** 多产物操作节点：右键一键展开最近一次运行的全部产物节点 */
    expandOperationOutputs?: (nodeId: string) => void
    createOperationChild: (
      parentId: string,
      operation: import('./canvas.types').CanvasOperationType,
      options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
    ) => void
    /** 流水线一键编排（设计 §7）：actionId 来自 getPipelineActions */
    pipelineAction: (nodeId: string, actionId: string) => void
    /** 设置生产状态（设计 §9.2 确认/待更新契约） */
    setProductionState: (
      nodeId: string,
      state: import('./canvas.types').CanvasProductionState,
    ) => void
    /** 单节点右键：切换节点子类型（image/text 等），仅改 data 层 */
    updateNodeData?: (nodeId: string, data: Partial<CanvasNodeData>) => void
  }
}

function operationOutputNodeForCapabilities(
  operationNode: SparkCanvasNode,
  output: CanvasOperationRunView['outputs'][number] | null,
): SparkCanvasNode | null {
  if (!output) return null
  const type: SparkCanvasNode['type'] =
    output.type === 'image' || output.type === 'video' || output.type === 'audio'
      ? output.type
      : output.type === 'prompt'
        ? 'prompt'
        : 'text'

  return {
    ...operationNode,
    type,
    title: output.title,
    assetId: output.assetId ?? null,
    data:
      type === 'text' || type === 'prompt'
        ? {
            text: output.text ?? '',
            format: type === 'prompt' ? 'prompt' : 'plain',
            origin: 'task_output',
            ...(output.pipelineRole ? { pipelineRole: output.pipelineRole } : {}),
          }
        : {
            ...(output.url ? { url: output.url } : {}),
            ...(output.thumbnailUrl ? { thumbnailUrl: output.thumbnailUrl } : {}),
            ...(output.mimeType ? { mimeType: output.mimeType } : {}),
            origin: 'task_output',
            ...(output.pipelineRole ? { pipelineRole: output.pipelineRole } : {}),
            ...(output.panorama360 ? { panorama360: output.panorama360 } : {}),
          },
  }
}

const PRODUCTION_STATE_BADGE: Partial<
  Record<NonNullable<SparkCanvasNode['data']['productionState']>, { label: string; color: string }>
> = {
  confirmed: { label: '已确认', color: 'green' },
  stale: { label: '待更新', color: 'orange' },
  draft: { label: '草稿', color: 'default' },
}

/**
 * 是否在节点右键菜单显示「确认（采用）/ 标记待更新」。
 * 暂时关闭：浮动工具栏已提供这两个入口，右键菜单更聚焦。
 * 需要恢复时改为 true。
 */
const PRODUCTION_STATE_MENU_ENABLED = false

/** 流水线角色 → 显示标签 + 主题色（让画布像一条生产流水线） */
const PIPELINE_ROLE_META: Partial<
  Record<NonNullable<SparkCanvasNode['data']['pipelineRole']>, { label: string; color: string }>
> = {
  style_bible: { label: '视觉总设定', color: '#a855f7' },
  chapter: { label: '章节', color: '#3b82f6' },
  screenplay: { label: '剧本', color: '#6366f1' },
  character: { label: '角色', color: '#f97316' },
  scene: { label: '场景', color: '#06b6d4' },
  prop: { label: '道具', color: '#eab308' },
  effect: { label: '特效', color: '#ec4899' },
  camera: { label: '运镜', color: '#14b8a6' },
  frame: { label: '画面', color: '#0ea5e9' },
  action: { label: '动作', color: '#f43f5e' },
  design_card: { label: '设定图卡', color: '#d946ef' },
  shot: { label: '分镜', color: '#22c55e' },
  keyframe: { label: '关键帧', color: '#2dd4bf' },
  clip: { label: '视频片段', color: '#8b5cf6' },
}

const IMAGE_STYLE_EXTRACTION_PROMPT =
  '请分析输入图片的视觉风格，并输出可复用的中文风格描述。重点包括：画面题材、艺术媒介、色彩倾向、光影氛围、构图镜头、材质细节、时代/类型气质，以及适合作为后续生成提示词的风格关键词。'

const INLINE_PANEL_TRANSITION_MS = 180

const NODE_TYPE_META_LABEL: Partial<Record<SparkCanvasNode['type'] | 'prompt', string>> = {
  text: '文本',
  prompt: '文本',
  image: '图像',
  video: '视频',
  audio: '音频',
  group: '组',
  task: '任务',
}

function sourceNodeText(node: SparkCanvasNode): string {
  return (node.data.text ?? node.data.prompt ?? node.title ?? '').trim()
}

function buildImageOutpaintPrompt(node: SparkCanvasNode): string {
  const source = sourceNodeText(node)
  return [
    '请基于输入图片进行自然扩图，将画面扩展为默认 2:1 横向比例。',
    '保持主体身份、造型、场景透视、光影方向、材质纹理、镜头语言和整体风格一致。',
    '扩展区域需要像原图真实延伸出来，避免重复主体、变形、黑边、文字、水印、拼接痕迹或明显 AI 边缘。',
    source ? `补充要求：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildDetailSheetNineGridPrompt(node: SparkCanvasNode): string {
  const source = sourceNodeText(node)
  const sourceIntro =
    node.type === 'image'
      ? '请以输入图片为核心参考，保留主体/场景的身份一致性和视觉风格。'
      : '请根据输入内容进行视觉扩散设计。'
  return [
    sourceIntro,
    '生成一张 2:1 横向画布的九宫格设定拆分图，3x3 排列，每格是同一主题的不同角度、距离或细节变化。',
    '如果主题是场景：包含远景建立、正面、侧面、俯视/高角度、低角度、入口/出口、关键道具、材质细节、光影氛围等变化。',
    '如果主题是人物：包含正面、侧面、背面、半身、全身、表情、服装细节、道具细节、动态姿态等变化。',
    '如果主题是道具/物体：包含正视、侧视、背视、俯视、打开/使用状态、局部材质、尺寸关系、环境中的摆放、功能细节等变化。',
    '九格之间保持同一世界观与设计语言，画面干净，不要文字标签、水印、边框说明或 UI 元素。',
    source ? `输入内容：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const CanvasNode = memo(function CanvasNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  const {
    actions,
    canvasNode: node,
    assetSubviewCount = 0,
    operationRuns = [],
    isGeneratedOutput = false,
    baseRenderedHeight = node.height,
    cardChromeExtraHeight = 0,
    inlinePanel,
    inlinePanelExtraHeight,
    inlineToolbar,
  } = data as CanvasFlowNodeData
  const locked = Boolean(node.locked)
  const isGroup = node.type === 'group'
  const isTask = isOperationNode(node)
  const operationOutputState = useMemo(
    () => resolveCanvasOperationOutputState(node, operationRuns),
    [node, operationRuns],
  )
  const contentNode = useMemo(
    () =>
      isTask ? operationOutputNodeForCapabilities(node, operationOutputState.primaryOutput) : node,
    [isTask, node, operationOutputState.primaryOutput],
  )
  const roleMeta = node.data.pipelineRole ? PIPELINE_ROLE_META[node.data.pipelineRole] : undefined
  const displayType = node.type === 'prompt' ? 'text' : node.type
  const explicitNodeTitle = node.title?.trim()
  const metaTypeLabel = isTask
    ? explicitNodeTitle || operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
    : roleMeta
      ? roleMeta.label
      : (NODE_TYPE_META_LABEL[displayType as SparkCanvasNode['type']] ?? displayType)
  const title =
    node.type === 'prompt' && (!node.title || node.title === 'Prompt')
      ? 'Text note'
      : (node.title ?? metaTypeLabel)
  const isDirectorStage = node.data.subtype === 'director_stage'
  const isDirectorStage3D = node.data.subtype === 'director_stage_3d'
  const isVideoWorkbench = node.data.subtype === 'video_workbench'
  const isResourceOutput = !isTask && (isGeneratedOutput || node.data.origin === 'task_output')
  const isGroupedChild = Boolean(node.parentNodeId)
  // 长文本节点（剧本/文稿等）：NodeResizer 拖拽下限放宽；渲染时套 long 修饰类。
  // 渲染条件用当前 text 长度判断，旧节点编辑后内容变长也能自动应用阅读样式，
  // 但旧节点的物理尺寸不会自动放大（仅影响新建，参见 canvasNodeSize.ts 顶部说明）。
  const isTextLong = isLongText(node.data.text)
  const isShotScriptOperation =
    isTask &&
    (Boolean(node.data.shotScriptConfig) ||
      (node.data.operation === 'text_generate' &&
        (node.data.pipelineRole === 'shot' || node.data.outputPipelineRole === 'shot')))
  const minSize = pickCanvasNodeMinSize(node.type, node.data.text, {
    shotScriptOperation: isShotScriptOperation,
  })
  const [resizeHovered, setResizeHovered] = useState(false)
  const [resizing, setResizing] = useState(false)
  // 未锁定节点在选中或悬浮时挂载缩放控件，无需先点击，同时避免所有节点常驻控件。
  const showResizer = !locked && (selected || resizeHovered || resizing)
  const imageSrc = node.data.thumbnailUrl ?? node.data.url
  const normalizedImageSrc = imageSrc ? normalizeEduAssetUrl(imageSrc) : ''
  const normalizedAudioSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const normalizedVideoSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const operationWorkflow = isTask
    ? typeof node.data.modelParams?.workflow === 'string'
      ? node.data.modelParams.workflow
      : operationRuns.find((run) => run.workflow)?.workflow
    : undefined

  const hasOperationOutput = !isTask || Boolean(operationOutputState.primaryOutput)
  const canCreateOperationFromNode = !isTask || hasOperationOutput
  const pipelineActions = contentNode ? getNodePipelineActions(contentNode) : []
  // 子类型切换（仅 image/text）：当前子类型 + 可选项，供右键菜单「切换类型」渲染。
  const subtypeSwitch = useMemo(() => {
    if (!isSubtypeSwitchable(node)) return null
    return {
      current: getNodeCurrentSubtype(node),
      options: getNodeSubtypeOptions(node),
    }
  }, [node])
  const isPanorama360 = Boolean(contentNode?.data.panorama360 ?? node.data.panorama360)
  const isImageContent = contentNode ? isCanvasImageContentNode(contentNode) : false
  const canExtractCharacterSubview = isImageContent && hasOperationOutput
  const latestOperationOutputCount =
    operationRuns.find((run) => run.outputs.length > 0)?.outputs.length ?? 0
  const canExpandOperationOutputs =
    isTask && Boolean(actions.expandOperationOutputs) && latestOperationOutputCount > 0
  const storyboardSplitSource = useMemo(
    () => resolveStoryboardSplitSourceNode(node, operationOutputState.primaryOutput),
    [node, operationOutputState.primaryOutput],
  )
  // 分镜脚本产物节点：把 agent 输出的 JSON / Markdown 分镜表渲染成传统分镜脚本表。
  // 不依赖 pipelineRole（分镜脚本文本产物节点故意不打 shot 角色，避免右键出现不适用的
  // 关键帧/视频操作），改为「文本节点 + 内容像分镜表 + 能解析出镜头」的内容判定，
  // 既覆盖历史节点，又不会误伤普通文本便签。
  const shotScriptRows = useMemo<ParsedShotRow[]>(() => {
    if (node.type !== 'text' || !node.data.text) return []
    return readRenderableShotScriptRows(node.data.text)
  }, [node.type, node.data.text])
  const renderShotTable = shotScriptRows.length > 0
  const runImageStyleExtraction = () =>
    actions.createOperationChild(node.id, 'text_generate', {
      title: '风格提取',
      prompt: IMAGE_STYLE_EXTRACTION_PROMPT,
    })
  const createImageOutpaintTask = () =>
    actions.createOperationChild(node.id, 'image_edit', {
      title: '图片扩图',
      prompt: buildImageOutpaintPrompt(contentNode ?? node),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createDetailSheetTask = () =>
    actions.createOperationChild(node.id, isImageContent ? 'image_edit' : 'text_to_image', {
      title: '细节设定图（九宫格）',
      prompt: buildDetailSheetNineGridPrompt(contentNode ?? node),
      modelParams: { aspect_ratio: '2:1' },
    })
  // AI 操作子菜单里「上下文专属」的快捷操作（带图标）。
  const contextualAiActions = useMemo(
    () => [
      ...(isImageContent
        ? [
            {
              key: 'outpaint-image',
              label: (
                <span className="canvas-menu-item">
                  <Icons.Crop size={14} /> 图片扩图
                </span>
              ),
              onClick: createImageOutpaintTask,
            },
            {
              key: 'extract-style',
              label: (
                <span className="canvas-menu-item">
                  <Icons.Sparkles size={14} /> 提取风格
                </span>
              ),
              onClick: runImageStyleExtraction,
            },
          ]
        : []),
      ...(isImageContent ||
      Boolean(
        hasOperationOutput &&
        contentNode &&
        (contentNode.type === 'text' || contentNode.type === 'prompt'),
      )
        ? [
            {
              key: 'detail-sheet-nine-grid',
              label: (
                <span className="canvas-menu-item">
                  <Icons.Grid size={14} /> 细节设定图（九宫格）
                </span>
              ),
              onClick: createDetailSheetTask,
            },
          ]
        : []),
    ],
    [
      contentNode,
      createDetailSheetTask,
      createImageOutpaintTask,
      hasOperationOutput,
      isImageContent,
      runImageStyleExtraction,
    ],
  )
  const menu = useMemo(
    () => ({
      className: 'canvas-node-context-menu',
      items: [
        ...(isPanorama360
          ? [
              {
                key: 'preview-panorama',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Globe size={14} /> 全景预览
                  </span>
                ),
                onClick: () => actions.previewPanorama(node.id),
              },
              { type: 'divider' as const },
            ]
          : []),
        // 视频节点 / 视频工作台节点 / 产物为视频的操作节点：右键 → 视频编辑
        ...((node.type === 'video' || isVideoWorkbench || contentNode?.type === 'video') &&
        actions.editVideo
          ? [
              {
                key: 'edit-video',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Video size={14} /> 视频编辑
                  </span>
                ),
                // 统一传 node.id；handleEditVideo 内部自动解析操作节点的产物视频
                onClick: () => actions.editVideo!(node.id),
              },
              { type: 'divider' as const },
            ]
          : []),
        ...(pipelineActions.length > 0 || canCreateOperationFromNode
          ? [
              {
                key: 'pipeline-actions',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Workflow size={14} /> 剧本流水线
                  </span>
                ),
                children: [
                  ...pipelineActions.map((action) => ({
                    key: `pipeline-${action.id}`,
                    label: (
                      <span className="canvas-menu-item">
                        {resolvePipelineIcon(action.icon)} {action.label}
                      </span>
                    ),
                    onClick: () => actions.pipelineAction(node.id, action.id),
                  })),
                  ...(pipelineActions.length > 0 ? [{ type: 'divider' as const }] : []),
                  ...CANVAS_PIPELINE_CREATE_OPERATIONS.map((item) => ({
                    key: `pipeline-op-${item.operation}`,
                    label: (
                      <span className="canvas-menu-item">
                        {resolvePipelineIcon(item.icon)} {item.label}
                      </span>
                    ),
                    onClick: () => actions.createOperationChild(node.id, item.operation),
                  })),
                ],
              },
              { type: 'divider' as const },
            ]
          : []),
        ...(canExpandOperationOutputs
          ? [
              {
                key: 'expand-operation-outputs',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Layers size={14} /> 展开产物
                  </span>
                ),
                onClick: () => actions.expandOperationOutputs?.(node.id),
              },
            ]
          : []),
        {
          key: 'duplicate',
          label: (
            <span className="canvas-menu-item">
              <Icons.Copy size={14} /> 复制节点
            </span>
          ),
          onClick: () => actions.duplicateNode(node.id),
        },
        {
          key: 'edit',
          label: (
            <span className="canvas-menu-item">
              <Icons.Edit size={14} /> 编辑节点
            </span>
          ),
          // 等下拉菜单先完成本次点击和关闭，避免其收尾事件立即关掉刚打开的面板。
          // editNode 与节点双击共用同一入口：操作节点打开任务配置，内容节点打开内容编辑。
          onClick: () => window.requestAnimationFrame(() => actions.editNode(node.id)),
        },
        ...(isImageContent && hasOperationOutput
          ? [
              ...(canExtractCharacterSubview
                ? [
                    {
                      key: 'extract-character-subview',
                      label: (
                        <span className="canvas-menu-item">
                          <Icons.Crop size={14} /> 提取子视图
                        </span>
                      ),
                      onClick: () => actions.extractCharacterSubview?.(node.id),
                    },
                  ]
                : []),
              {
                key: 'split-grid-image',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Grid size={14} /> 宫格切分
                  </span>
                ),
                onClick: () => actions.splitGridImage?.(node.id),
              },
              {
                key: 'annotate-image',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Edit size={14} /> 图片标注
                  </span>
                ),
                onClick: () => actions.annotateImage?.(node.id),
              },
            ]
          : []),
        ...(storyboardSplitSource && actions.splitStoryboard
          ? [
              {
                key: 'split-storyboard-by-shot',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Scissors size={14} /> 按镜拆分
                  </span>
                ),
                onClick: () => actions.splitStoryboard?.(storyboardSplitSource.id),
              },
            ]
          : []),
        ...(canCreateOperationFromNode
          ? [
              {
                key: 'add-operation',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Sparkles size={14} /> 生成任务
                  </span>
                ),
                children: [
                  ...contextualAiActions,
                  ...(contextualAiActions.length > 0 ? [{ type: 'divider' as const }] : []),
                  ...CANVAS_GENERAL_CREATE_OPERATION_GROUPS.flatMap((group, groupIndex) => [
                    ...(groupIndex > 0 ? [{ type: 'divider' as const }] : []),
                    ...group.items.map((item) => ({
                      key: `op-${item.operation}`,
                      label: item.label,
                      onClick: () => actions.createOperationChild(node.id, item.operation),
                    })),
                  ]),
                ],
              },
            ]
          : []),
        ...((isImageContent || contentNode?.type === 'video') && hasOperationOutput
          ? [
              {
                key: 'download-media',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Download size={14} /> 下载到本地…
                  </span>
                ),
                onClick: () => actions.downloadMedia(node.id),
              },
            ]
          : []),
        {
          key: 'save-to-library',
          label: (
            <span className="canvas-menu-item">
              <Icons.Folder size={14} /> 保存到资源库…
            </span>
          ),
          onClick: () => actions.saveToLibrary(node.id),
        },
        // ── 组与引用：单节点语境下有意义的 Agent / 切换类型 / 分组操作 ──
        ...(actions.addNodeToAgent
          ? [
              {
                key: 'add-to-agent',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.MessageSquarePlus size={14} /> 添加到 Agent 对话
                  </span>
                ),
                onClick: () => actions.addNodeToAgent?.(node.id),
              },
            ]
          : []),
        ...(subtypeSwitch
          ? [
              {
                key: 'switch-subtype',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Refresh size={14} /> 切换类型
                  </span>
                ),
                children: subtypeSwitch.options.map((option) => ({
                  key: `subtype-${option.value}`,
                  label: (
                    <span className="canvas-menu-item">
                      {option.label}
                      {subtypeSwitch.current === option.value ? <Icons.Check size={14} /> : null}
                    </span>
                  ),
                  onClick: () =>
                    actions.updateNodeData?.(node.id, option.apply as Partial<CanvasNodeData>),
                })),
              },
            ]
          : []),
        ...(isGroup
          ? [
              {
                key: 'merge-group-to-image',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Image size={14} /> 多图合并
                  </span>
                ),
                onClick: () => actions.mergeGroupToImage(node.id),
              },
              {
                key: 'dissolve-group',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.FolderOpen size={14} /> 解散组
                  </span>
                ),
                onClick: () => actions.dissolveGroup(node.id),
              },
            ]
          : []),
        ...(isGroupedChild
          ? [
              {
                key: 'remove-from-group',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.ArrowUp size={14} /> 移出组
                  </span>
                ),
                onClick: () => actions.removeNodeFromGroup(node.id),
              },
            ]
          : []),
        // 生产状态（确认（采用）/ 标记待更新）暂时隐藏：浮动工具栏仍提供这两个入口。
        // 需要恢复时把 PRODUCTION_STATE_MENU_ENABLED 改回 true。
        ...(PRODUCTION_STATE_MENU_ENABLED && !isGroup
          ? [
              { type: 'divider' as const },
              {
                key: 'confirm',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Check size={14} /> 确认（采用）
                  </span>
                ),
                onClick: () => actions.setProductionState(node.id, 'confirmed'),
              },
              {
                key: 'mark-stale',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.RotateCcw size={14} /> 标记待更新
                  </span>
                ),
                onClick: () => actions.setProductionState(node.id, 'stale'),
              },
              { type: 'divider' as const },
            ]
          : []),
        {
          key: 'lock',
          label: (
            <span className="canvas-menu-item">
              <Icons.Lock size={14} /> {locked ? '解锁节点' : '锁定节点'}
            </span>
          ),
          onClick: () => actions.toggleLockNode(node.id),
        },
        {
          key: 'front',
          label: (
            <span className="canvas-menu-item">
              <Icons.Layers size={14} /> 置于顶层
            </span>
          ),
          onClick: () => actions.bringNodeToFront(node.id),
        },
        {
          key: 'delete',
          label: (
            <span className="canvas-menu-item canvas-menu-item-danger">
              <Icons.Trash size={14} /> 删除节点
            </span>
          ),
          onClick: () => actions.deleteNode(node.id),
        },
      ],
    }),
    [
      actions,
      contextualAiActions,
      isGroup,
      isGroupedChild,
      isPanorama360,
      isVideoWorkbench,
      locked,
      canExtractCharacterSubview,
      canExpandOperationOutputs,
      canCreateOperationFromNode,
      contentNode,
      hasOperationOutput,
      isImageContent,
      node.id,
      node.type,
      pipelineActions,
      storyboardSplitSource,
      subtypeSwitch,
    ],
  )

  const inlinePanelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInlinePanelHeightRef = useRef(inlinePanelExtraHeight ?? 0)
  const [renderedInlinePanel, setRenderedInlinePanel] = useState<ReactNode>(inlinePanel ?? null)
  const [inlinePanelVisible, setInlinePanelVisible] = useState(Boolean(inlinePanel))

  useEffect(() => {
    if (inlinePanelExitTimerRef.current != null) {
      clearTimeout(inlinePanelExitTimerRef.current)
      inlinePanelExitTimerRef.current = null
    }

    if (inlinePanel) {
      lastInlinePanelHeightRef.current = inlinePanelExtraHeight ?? lastInlinePanelHeightRef.current
      setRenderedInlinePanel(inlinePanel)
      requestAnimationFrame(() => setInlinePanelVisible(true))
      return undefined
    }

    setInlinePanelVisible(false)
    inlinePanelExitTimerRef.current = setTimeout(() => {
      setRenderedInlinePanel(null)
      inlinePanelExitTimerRef.current = null
    }, INLINE_PANEL_TRANSITION_MS)

    return () => {
      if (inlinePanelExitTimerRef.current != null) {
        clearTimeout(inlinePanelExitTimerRef.current)
        inlinePanelExitTimerRef.current = null
      }
    }
  }, [inlinePanel, inlinePanelExtraHeight])

  const hasInlineExtension = Boolean(inlineToolbar || renderedInlinePanel)
  const inlinePanelDisplayHeight =
    inlinePanel != null
      ? (inlinePanelExtraHeight ?? lastInlinePanelHeightRef.current)
      : lastInlinePanelHeightRef.current

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(id)
    })
    return () => cancelAnimationFrame(frame)
  }, [
    baseRenderedHeight,
    height,
    id,
    inlinePanelDisplayHeight,
    inlinePanelVisible,
    resizeHovered,
    renderedInlinePanel,
    selected,
    updateNodeInternals,
    width,
  ])

  const productionBadge =
    node.data.productionState && PRODUCTION_STATE_BADGE[node.data.productionState]
  const operationSummary = isOperationNode(node) ? operationRuntimeSummary(node) : null
  const operationStatus = isOperationNode(node) ? (node.data.status ?? 'pending') : null
  const operationParamSummary = isOperationNode(node)
    ? buildCanvasOperationParamSummary(node.data.modelParams, 4)
    : []
  const nodeActionLabel = isDirectorStage3D
    ? '打开导演台'
    : isVideoWorkbench
      ? '打开工作台'
      : isTask
        ? '查看任务'
        : node.type === 'image' || node.type === 'audio' || node.type === 'video'
          ? '预览'
          : '打开编辑'
  const isTextContentNode =
    (node.type === 'text' || node.type === 'prompt') && !isOperationNode(node) && !renderShotTable
  const isMediaContentNode =
    (node.type === 'image' || node.type === 'audio' || node.type === 'video') &&
    !isOperationNode(node)
  const shouldShowContentTitle = isTextContentNode || isMediaContentNode
  const contentTitleMeta = isResourceOutput
    ? '画布产物'
    : roleMeta?.label
      ? `${roleMeta.label}资产`
      : node.type === 'image'
        ? node.data.panorama360
          ? '360° 全景资产'
          : '图片资产'
        : node.type === 'video'
          ? '视频资产'
          : node.type === 'audio'
            ? '音频资产'
            : '双击打开编辑器'
  const passiveStatusLabel = isResourceOutput
    ? '产物'
    : productionBadge?.label
      ? productionBadge.label
      : isDirectorStage
        ? '草稿'
        : node.type === 'group'
          ? '节点组'
          : isMediaContentNode
            ? node.data.url
              ? '已生成'
              : '待添加'
            : isTextContentNode
              ? '可编辑'
              : '已就绪'
  const nodeFooterLabel = operationSummary
    ? operationSummary
    : isOperationNode(node)
      ? '运行记录'
      : isResourceOutput
        ? '画布产物'
        : node.type === 'group'
          ? '成组排列'
          : isDirectorStage3D
            ? '导演场景'
            : isVideoWorkbench
              ? '视频工程'
              : node.type === 'image'
                ? node.data.panorama360
                  ? '360° 全景'
                  : '图片资产'
                : node.type === 'video'
                  ? '视频资产'
                  : node.type === 'audio'
                    ? '音频资产'
                    : isTextContentNode
                      ? `${(node.data.text ?? node.data.message ?? '').length} 字`
                      : '可编辑'
  const nodeStyle = {
    ...(roleMeta ? { ['--role-color' as string]: roleMeta.color } : {}),
    ...(hasInlineExtension
      ? { ['--canvas-node-base-height' as string]: `${baseRenderedHeight}px` }
      : {}),
  } as CSSProperties
  const nodeMetaBar = (
    <div className="canvas-node-meta-bar">
      <span className="canvas-node-meta-title">
        <span className="canvas-node-meta-icon" aria-hidden="true">
          {node.type === 'image' &&
            (node.data.panorama360 ? <Icons.Globe size={14} /> : <Icons.Image size={14} />)}
          {node.type === 'audio' && <Icons.Play size={14} />}
          {(node.type === 'text' || node.type === 'prompt') && <Icons.File size={14} />}
          {isDirectorStage ? (
            <Icons.Box size={14} />
          ) : isOperationNode(node) ? (
            operationNodeIcon(nodeOperation(node), operationWorkflow)
          ) : node.type === 'task' ? (
            <Icons.Activity size={14} />
          ) : null}
          {node.type === 'video' && <Icons.Play size={14} />}
          {node.type === 'group' && <Icons.Layers size={14} />}
        </span>
        <span className="canvas-node-kind-label">
          {node.data.panorama360 ? `360全景 · ${metaTypeLabel}` : metaTypeLabel}
        </span>
      </span>
      <span className="canvas-node-meta-tags">
        {operationStatus ? (
          <span
            className={`canvas-node-meta-chip canvas-node-meta-chip-status is-${operationStatus}`}
          >
            {operationStatusLabel(operationStatus)}
          </span>
        ) : null}
        {!operationStatus ? (
          <span
            className={`canvas-node-meta-chip canvas-node-meta-chip-state${productionBadge ? ` is-${node.data.productionState}` : ''}`}
          >
            {passiveStatusLabel}
          </span>
        ) : null}
      </span>
    </div>
  )

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft" autoAdjustOverflow>
      <div className="canvas-node-shell">
        <div
          data-canvas-node-id={node.id}
          className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}${roleMeta ? ' canvas-node-has-role' : ''}${hasInlineExtension ? ' canvas-node-inline-expanded' : ''}${isTask && node.data.status === 'running' ? ' canvas-node-task-running' : ''}${isTask && node.data.status === 'failed' ? ' canvas-node-task-failed' : ''}${renderShotTable ? ' canvas-node-shot-script' : ''}${isResourceOutput ? ' canvas-node-resource-output' : ''}`}
          style={nodeStyle}
          onPointerEnter={() => setResizeHovered(true)}
          onPointerLeave={() => setResizeHovered(false)}
          onDoubleClick={(event) => {
            event.stopPropagation()
            actions.editNode(node.id)
          }}
        >
          {nodeMetaBar}
          {/* 悬浮、选中或正在拉伸时显示缩放控件。 */}
          <NodeResizer
            color="var(--primary)"
            isVisible={showResizer}
            minWidth={minSize.width}
            minHeight={minSize.height + cardChromeExtraHeight}
            keepAspectRatio={keepsCanvasMediaNodeAspectRatio(node.type)}
            handleClassName="canvas-node-resize-handle"
            lineClassName="canvas-node-resize-line"
            onResizeStart={() => setResizing(true)}
            onResizeEnd={() => setResizing(false)}
          />
          <Handle type="target" position={Position.Left} className="canvas-node-handle" />
          {inlineToolbar ? (
            <div className="canvas-node-inline-toolbar nodrag nopan">{inlineToolbar}</div>
          ) : null}
          <div className="canvas-node-core">
            {shouldShowContentTitle && isTextContentNode ? (
              <div className="canvas-node-content-title canvas-node-content-title-text">
                <strong title={title}>{title}</strong>
                <span>{contentTitleMeta}</span>
              </div>
            ) : null}
            {/* nowheel：阻止画布 d3-zoom 抢走滚轮做缩放。
              需要滚动的节点由内部内容区（如 .canvas-node-text / .canvas-node-task-msg）
              自己处理原生滚动；react-flow 靠事件祖先链上的 nowheel 类跳过缩放。 */}
            <div className="canvas-node-body nowheel">
              {node.type === 'image' ? (
                node.data.url ? (
                  <div className="canvas-node-image-wrap">
                    <img
                      className="canvas-node-image"
                      src={normalizedImageSrc}
                      alt={title}
                      loading="lazy"
                      decoding="async"
                    />
                    {!isTask && (
                      <button
                        type="button"
                        className={`canvas-node-subview-chip${assetSubviewCount > 0 ? ' has-subviews' : ''}`}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          actions.extractCharacterSubview?.(node.id)
                        }}
                      >
                        <Icons.Crop size={12} />
                        <span>
                          {assetSubviewCount > 0 ? `子视图 ${assetSubviewCount}` : '提取子视图'}
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="canvas-node-image-placeholder">
                    <Icons.Image size={30} />
                    <strong>{node.data.message ?? '暂无图片'}</strong>
                    <span>双击节点添加内容</span>
                  </div>
                )
              ) : node.type === 'audio' ? (
                node.data.url ? (
                  <div className="canvas-node-audio">
                    <Icons.Play size={22} />
                    <audio
                      className="canvas-node-audio-player"
                      src={normalizedAudioSrc}
                      controls
                      preload="metadata"
                    />
                    <span className="canvas-node-audio-name">{node.data.message ?? 'audio'}</span>
                  </div>
                ) : (
                  <div className="canvas-node-image-placeholder">
                    <Icons.Play size={30} />
                    <strong>{node.data.message ?? '暂无音频'}</strong>
                    <span>运行任务后在这里预览</span>
                  </div>
                )
              ) : node.type === 'video' ? (
                node.data.url ? (
                  <video
                    className="canvas-node-image"
                    src={normalizedVideoSrc}
                    controls
                    preload="metadata"
                    onContextMenu={(e) => {
                      // 阻止 <video> 原生右键菜单，让事件冒泡到外层 Dropdown 的 contextMenu trigger
                      e.preventDefault()
                    }}
                  />
                ) : (
                  <div className="canvas-node-image-placeholder">
                    <Icons.Play size={30} />
                    <strong>{node.data.message ?? '暂无视频'}</strong>
                    <span>运行任务后在这里预览</span>
                  </div>
                )
              ) : node.type === 'group' ? (
                <div className="canvas-node-group-body">
                  <div className="canvas-node-group-count">{node.data.text ?? '组'}</div>
                  <div className="canvas-node-group-hint">
                    {node.data.message ?? '节点已在组内排列'}
                  </div>
                </div>
              ) : isDirectorStage3D ? (
                <Stage3DMini data={node.data} />
              ) : isVideoWorkbench ? (
                <VideoWorkbenchMini data={node.data} />
              ) : isDirectorStage ? (
                <div className="canvas-node-director-stage">
                  <DirectorStageMini data={node.data} nodeId={node.id} />
                  <div className="canvas-node-director-stage-hint">
                    双击编排画面 · 站位 / 取景 / 提示词
                  </div>
                </div>
              ) : isOperationNode(node) ? (
                <div className="canvas-node-task canvas-node-operation">
                  <OperationOutputDeck
                    runs={operationRuns}
                    mode={operationOutputState.mode}
                    fallback={
                      <div className="canvas-operation-empty-state">
                        <div className="canvas-operation-empty-icon">
                          {operationNodeIcon(nodeOperation(node), operationWorkflow)}
                        </div>
                        {(node.data.status ?? 'pending') !== 'pending' ? (
                          <Progress
                            percent={node.data.progress ?? 0}
                            size="middle"
                            status={
                              node.data.status === 'failed'
                                ? 'exception'
                                : node.data.status === 'completed'
                                  ? 'success'
                                  : 'active'
                            }
                          />
                        ) : null}
                        {operationSummary ? (
                          <div className="canvas-node-task-meta">{operationSummary}</div>
                        ) : null}
                        {operationParamSummary.length > 0 ? (
                          <div className="canvas-operation-param-summary">
                            {operationParamSummary.map((item) => (
                              <span key={item.key}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="canvas-node-task-msg">
                          {node.data.message ??
                            node.data.prompt ??
                            '点击节点下方编辑面板调整参数后运行'}
                        </div>
                      </div>
                    }
                  />
                </div>
              ) : renderShotTable ? (
                <CanvasShotScriptTable rows={shotScriptRows} />
              ) : isResourceOutput && (node.type === 'text' || node.type === 'prompt') ? (
                <div className="canvas-node-resource-text nowheel">
                  <div className="canvas-node-resource-text-icon">
                    <Icons.File size={26} />
                  </div>
                  <div className="canvas-node-resource-text-content md-surface">
                    <MarkdownText content={node.data.text ?? node.data.message ?? '空文本产物'} />
                  </div>
                </div>
              ) : (
                <div
                  className={`canvas-node-text md-surface${isTextLong ? ' canvas-node-text-long' : ''}`}
                >
                  <MarkdownText
                    content={node.data.text ?? node.data.message ?? '空节点 · 双击编辑'}
                  />
                </div>
              )}
            </div>
            {shouldShowContentTitle && isMediaContentNode ? (
              <div className="canvas-node-content-title canvas-node-content-title-media">
                <strong title={title}>{title}</strong>
                <span>{contentTitleMeta}</span>
              </div>
            ) : null}
            <div className="canvas-node-quick-footer nodrag nopan">
              <span title={nodeFooterLabel}>{nodeFooterLabel}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  actions.editNode(node.id)
                }}
              >
                {nodeActionLabel}
              </button>
            </div>
          </div>
          {renderedInlinePanel ? (
            <div
              className={`canvas-node-inline-panel nodrag nopan nowheel${inlinePanelVisible ? ' is-visible' : ' is-hiding'}`}
              style={{
                ['--canvas-node-inline-extra-height' as string]: `${inlinePanelDisplayHeight}px`,
              }}
            >
              {renderedInlinePanel}
            </div>
          ) : null}
          <Handle type="source" position={Position.Right} className="canvas-node-handle" />
        </div>
      </div>
    </Dropdown>
  )
}, canvasNodePropsEqual)

function canvasNodePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  if (prev.selected !== next.selected) return false
  if ((prev.width ?? 0) !== (next.width ?? 0)) return false
  if ((prev.height ?? 0) !== (next.height ?? 0)) return false
  return canvasFlowNodeDataEqual(prev.data as CanvasFlowNodeData, next.data as CanvasFlowNodeData)
}
