import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type ReactNode,
} from 'react'
import {
  Handle,
  NodeResizer,
  Position,
  useConnection,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react'
import { Button, Dropdown, Tooltip } from '@lobehub/ui'
import { Progress, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { canvasFlowNodeDataEqual } from './canvasStageNodeSync'
import { canCopyNodeContent, copyNodeContentToClipboard } from './canvasClipboard'
import {
  calculateCanvasContextMenuAnchorSpace,
  CANVAS_CONTEXT_MENU_STAGE_INSETS,
} from './canvasContextMenuModel'
import { operationLabel } from './canvas.api'
import { isCanvasImageContentNode, isOperationNode, nodeOperation } from './canvas.capabilities'
import { isFullBleedCanvasImageNode } from './canvasImageNodePresentation'
import {
  canvasNodeHasStandaloneActionFooter,
  canvasNodeUsesFlatMediaFrame,
  resolveCanvasNodeMetaLabel,
} from './canvasNodeChrome'
import {
  isLongText,
  keepsCanvasMediaNodeAspectRatio,
  pickCanvasNodeMinSize,
} from './canvasNodeSize'
import { getNodePipelineActions } from './canvasPipeline'
import { CANVAS_PIPELINE_MENU_GROUPS, type CanvasPipelineAssetKind } from './canvasPipelineOps'
import {
  CANVAS_FEATURE_MENU_LABEL,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
  CANVAS_FUNCTIONAL_MENU_LABEL,
  canvasVisibleFeatureCreateOperations,
  canvasVisiblePrimaryCreateOperations,
} from './canvasNodeGenerationMenu'
import { getOperationVisual } from './canvasOperationIcons'
import { buildCanvasOperationParamSummary } from './canvasOperationParamSummary'
import { canvasOperationRuntimeSummary } from './canvasNodeSecondaryLabel'
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
import type { CanvasAudioPreviewActions } from './CanvasOperationOutputPreview'
import { CanvasOperationOutputThumbnailSwitcher } from './CanvasOperationOutputThumbnailSwitcher'
import {
  CanvasAudioNodePresentation,
  type CanvasAudioNodePresentationHandle,
} from './audioNode/CanvasAudioNodePresentation'
import { CanvasVideoPlayer } from './videoPlayer/CanvasVideoPlayer'
import { CanvasShotScriptTable } from './CanvasShotScriptTable'
import {
  CanvasNodeSelectionToolbar,
  type CanvasNodeToolbarAction,
  type CanvasNodeToolbarEntry,
} from './CanvasNodeSelectionToolbar'
import { resolveCanvasOperationOutputState } from './canvasOperationOutputModel'
import { buildCanvasOperationMediaThumbnailItems } from './canvasOperationOutputThumbnails'
import { canvasNodeInlinePrimaryAction } from './canvasNodeInlinePrimaryAction'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'
import type { CanvasOperationType } from './canvas.types'
import type { CanvasNodeData } from './canvas.types'
import {
  canvasOperationOutputSelectionFingerprint,
  isCanvasOperationRunQuickDeletable,
  resolveCanvasOperationCurrentRun,
  type CanvasOperationOutputView,
  type CanvasOperationRunView,
} from './canvasOperationRuns'
import { effectiveCanvasOperationStatus } from './canvasTaskOutputIntegrity'
import type { CanvasCollapsedGroupPresentation } from './canvasGroupCollapse'
import { CanvasCollapsedGroup } from './CanvasCollapsedGroup'

/** 把 op 的图标 key 映射为 Icons 组件（找不到回退 Workflow） */
function resolvePipelineIcon(iconKey: string | undefined, size = 14): React.ReactNode {
  const map = Icons as unknown as Record<string, (p: { size?: number }) => React.ReactNode>
  const IconFn = (iconKey && map[iconKey]) || Icons.Workflow
  return <IconFn size={size} />
}

function openAudioTrim(ref: { current: CanvasAudioNodePresentationHandle | null }) {
  ref.current?.openTrim()
}

function openAudioSpeed(ref: { current: CanvasAudioNodePresentationHandle | null }) {
  ref.current?.openSpeed()
}

/** 3D 导演台节点卡片：角色/道具计数 + 最近一次截图缩略图（若有）。 */
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

function OperationOutputDeck({
  runs,
  fallback,
  isolateWheel,
  runIndex,
  outputIndex,
  onSelectOutput,
  onExpandOutput,
  onDeleteOutput,
  overlayActions,
  onVideoMetadata,
  onVideoEdit,
  selected,
  audioActions,
  audioPresentationRef,
}: {
  runs: CanvasOperationRunView[]
  fallback: ReactNode
  isolateWheel: boolean
  runIndex: number
  outputIndex: number
  onSelectOutput: (
    runIndex: number,
    outputIndex: number,
    output?: CanvasOperationRunView['outputs'][number],
  ) => void
  onExpandOutput?: (output: CanvasOperationOutputView) => void
  onDeleteOutput?: (output: CanvasOperationOutputView) => void
  overlayActions?: ReactNode
  onVideoMetadata?: (
    output: CanvasOperationRunView['outputs'][number],
    dimensions: { width: number; height: number },
  ) => void
  onVideoEdit?: () => void
  selected: boolean
  audioActions?: CanvasAudioPreviewActions
  audioPresentationRef?: Ref<CanvasAudioNodePresentationHandle>
}) {
  const activeRun = runs[runIndex]
  const outputs = activeRun?.outputs ?? []
  const activeOutput = outputs[Math.min(outputIndex, Math.max(0, outputs.length - 1))]
  const displayRunNumber = activeRun ? runs.length - runIndex : 0
  const showOutputList =
    outputs.length > 1 &&
    outputs.every((output) => output.type === 'text' || output.type === 'prompt')
  const shouldShowOutputNavigation = runs.length > 1
  const showOutputFooter = shouldShowOutputNavigation

  // 有真实运行记录对应的 overlay action 时保留底栏；无历史节点直接回退普通内容。
  if (!activeRun && !overlayActions) return <>{fallback}</>

  return (
    <div className="canvas-operation-output-deck">
      <div
        className={`canvas-operation-output-stage${showOutputList ? ' is-list' : ''}${activeOutput?.type === 'audio' ? ' is-audio' : ''}`}
      >
        {showOutputList ? (
          <CanvasOperationOutputList
            outputs={outputs}
            isolateWheel={isolateWheel}
            {...(onExpandOutput ? { onExpandOutput } : {})}
            {...(onDeleteOutput ? { onDeleteOutput } : {})}
          />
        ) : (
          <>
            {activeOutput ? (
              <CanvasOperationOutputPreview
                output={activeOutput}
                isolateWheel={isolateWheel}
                selected={selected}
                {...(audioActions ? { audioActions } : {})}
                {...(audioPresentationRef ? { audioPresentationRef } : {})}
                onVideoMetadata={(dimensions) => onVideoMetadata?.(activeOutput, dimensions)}
                {...(onVideoEdit ? { onVideoEdit } : {})}
              />
            ) : (
              fallback
            )}
          </>
        )}
      </div>
      {showOutputFooter || overlayActions ? (
        <div className="canvas-operation-output-nav nodrag nopan">
          {shouldShowOutputNavigation ? (
            <div className="canvas-operation-run-nav">
              <button
                type="button"
                aria-label="查看更新的一次运行"
                disabled={runIndex === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  const nextRunIndex = Math.max(0, runIndex - 1)
                  const next = runs[nextRunIndex]?.outputs[0]
                  onSelectOutput(nextRunIndex, 0, next)
                }}
              >
                <Tooltip title="查看更新的一次运行">
                  <Icons.ChevronLeft size={13} />
                </Tooltip>
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
                  const nextRunIndex = Math.min(runs.length - 1, runIndex + 1)
                  const next = runs[nextRunIndex]?.outputs[0]
                  onSelectOutput(nextRunIndex, 0, next)
                }}
              >
                <Tooltip title="查看更早的一次运行">
                  <Icons.ChevronRight size={13} />
                </Tooltip>
              </button>
            </div>
          ) : null}
          {overlayActions}
        </div>
      ) : null}
    </div>
  )
}

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  /** 当前画布选区节点数；多选时隐藏节点自身的顶部工具栏。 */
  selectedNodeCount?: number
  /** 节点自身或最近一次任务产物关联的影视资产类型，用于放宽同类型流水线入口。 */
  assetKinds?: CanvasPipelineAssetKind[]
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
  /** 编组折叠时使用的封面预览投影；不改变持久化布局。 */
  collapsedGroupPresentation?: CanvasCollapsedGroupPresentation
  actions: {
    duplicateNode: (nodeId: string) => void
    editNode: (nodeId: string) => void
    renameNode?: (nodeId: string, title: string | null) => Promise<void> | void
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
    selectGroupChildren?: (groupId: string) => void
    /** 单节点右键：把该节点加入画布 Agent 对话引用列表 */
    addNodeToAgent?: (nodeId: string) => void
    /** 单任务节点右键：使用已保存配置直接提交运行 */
    runOperationNode?: (nodeId: string) => void
    selectOperationInput?: (nodeId: string) => void
    uploadOperationInput?: (nodeId: string) => void
    openAiComposer: (nodeId: string) => void
    saveToLibrary: (nodeId: string) => void
    annotateImage?: (nodeId: string) => void
    splitGridImage?: (nodeId: string) => void
    splitStoryboard?: (nodeId: string) => void
    extractCharacterSubview?: (nodeId: string) => void
    /** 图片节点：右键/chip/占位按钮 → 替换图片（复用画布替换管线） */
    replaceImage?: (nodeId: string) => void
    /** 空视频节点：节点内上传按钮 → 写入当前视频节点。 */
    replaceVideo?: (nodeId: string, file: File) => void
    /** 360 全景产物节点：右键 → 全景预览（与普通图片「编辑」解耦） */
    previewPanorama: (nodeId: string) => void
    /** 视频节点：右键 → 视频编辑（打开视频工作台） */
    editVideo?: (nodeId: string) => void
    /** 音频节点：截取（返回开始/结束秒），由父级触发 IPC 并物化新子节点 */
    audioTrim?: (nodeId: string, startSec: number, endSec: number) => void
    /** 音频节点：变速（factor 由 IPC 校验 0.1x–4.0x），由父级触发 IPC 并物化新子节点 */
    audioSpeed?: (nodeId: string, factor: number) => void
    /** 多产物操作节点：展开最近一次运行的全部产物，或指定的产物节点 */
    expandOperationOutputs?: (nodeId: string, outputs?: CanvasOperationOutputView[]) => void
    /** 多产物操作节点：从节点内直接删除指定产物 */
    deleteOperationOutputs?: (nodeId: string, outputs: CanvasOperationOutputView[]) => void
    /** 操作节点：快捷删除当前非成功或无产物的运行记录 */
    deleteOperationRun?: (nodeId: string, run: CanvasOperationRunView) => void
    createOperationChild: (
      parentId: string,
      operation: import('./canvas.types').CanvasOperationType,
      options?: {
        title?: string
        prompt?: string
        modelParams?: Record<string, unknown>
        /** 无需用户确认配置的本地任务（如提取首尾帧）：创建后立即提交运行 */
        autoRun?: boolean
      },
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

function buildTextStyleExtractionPrompt(node: SparkCanvasNode): string {
  const source = sourceNodeText(node)
  return [
    '请阅读输入的剧本文本，提炼出这一章节可复用的镜头风格描述（中文）。',
    '重点包括：整体影像气质、景别偏好、运镜方式、构图习惯、色调与光影氛围、画面材质与年代质感、节奏与剪辑风格，以及适合作为后续分镜 / 生成提示词的风格关键词。',
    source ? `章节文本：\n${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

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
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  const connection = useConnection((current) =>
    current.inProgress && current.toNode?.id === id
      ? { isValid: current.isValid, pointer: current.pointer }
      : null,
  )
  const viewportTransform = useStore(
    (state) => (state.connection.inProgress ? state.transform : null),
    (previous, next) =>
      previous === next ||
      (previous != null &&
        next != null &&
        previous[0] === next[0] &&
        previous[1] === next[1] &&
        previous[2] === next[2]),
  )
  const {
    actions,
    canvasNode: node,
    assetKinds = [],
    assetSubviewCount = 0,
    operationRuns = [],
    isGeneratedOutput = false,
    baseRenderedHeight = node.height,
    cardChromeExtraHeight = 0,
    inlinePanel,
    inlinePanelExtraHeight,
    inlineToolbar,
    collapsedGroupPresentation,
    lineage,
    selectedNodeCount = 1,
  } = data as CanvasFlowNodeData
  const locked = Boolean(node.locked)
  const connectionTargetsNode = connection != null
  const connectionTargetIsValid = connection?.isValid === true
  const connectionPointer = connection?.pointer
  const connectionPointerPosition =
    connectionTargetIsValid && connectionPointer && viewportTransform
      ? {
          // React Flow exposes the pointer in renderer coordinates while custom node
          // content is laid out in flow coordinates. Convert it back so the marker
          // can travel through the invisible snap zone without moving the real handle.
          left:
            (connectionPointer.x - viewportTransform[0]) / viewportTransform[2] - positionAbsoluteX,
          top:
            (connectionPointer.y - viewportTransform[1]) / viewportTransform[2] - positionAbsoluteY,
        }
      : null
  const isGroup = node.type === 'group'
  const isTask = isOperationNode(node)
  const operationOutputState = useMemo(
    () => resolveCanvasOperationOutputState(node, operationRuns),
    [node, operationRuns],
  )
  const operationSelectionSyncKey = `${canvasOperationOutputSelectionFingerprint(operationRuns)}:${operationOutputState.primaryRunIndex}:${operationOutputState.primaryOutputIndex}`
  const [operationSelectionOverride, setOperationSelectionOverride] = useState<{
    syncKey: string
    runIndex: number
    outputIndex: number
  } | null>(null)
  // 本地 override 让点击立即反馈；外部默认产物或运行历史变化后 syncKey 改变，自动回落
  // 到持久化解析结果，无需在 effect 中同步 setState。
  const operationSelection =
    operationSelectionOverride?.syncKey === operationSelectionSyncKey
      ? operationSelectionOverride
      : {
          runIndex: Math.max(0, operationOutputState.primaryRunIndex),
          outputIndex: Math.max(0, operationOutputState.primaryOutputIndex),
        }
  const operationMediaThumbnails = useMemo(
    () => buildCanvasOperationMediaThumbnailItems(operationRuns),
    [operationRuns],
  )
  const activeOperationOutput =
    operationRuns[operationSelection.runIndex]?.outputs[operationSelection.outputIndex]
  const currentOperationRun = isTask
    ? resolveCanvasOperationCurrentRun(node, operationRuns)
    : undefined
  const operationStatus = isTask
    ? operationRuns.length === 0
      ? 'pending'
      : effectiveCanvasOperationStatus(
          node.data.status,
          Boolean(
            operationOutputState.primaryOutput &&
            operationOutputState.primaryRun?.taskId === node.taskId,
          ),
          currentOperationRun?.status,
        )
    : null
  const operationProgress =
    operationRuns.length === 0 ? 0 : (currentOperationRun?.progress ?? node.data.progress ?? 0)
  const isAudioTaskNode = isTask && node.data.operation === 'extract_audio'
  const showImagePromptInputActions =
    isTask && node.data.operation === 'image_prompt_reverse' && (lineage?.incoming ?? 0) === 0
  const selectOperationOutput = (
    runIndex: number,
    outputIndex: number,
    output?: CanvasOperationRunView['outputs'][number],
  ) => {
    setOperationSelectionOverride({
      syncKey: operationSelectionSyncKey,
      runIndex,
      outputIndex,
    })
    if (!output) return
    actions.updateNodeData?.(node.id, {
      primaryOutputId: output.id,
      primaryOutputSelection: 'manual',
    })
  }
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
  const metaLabel = resolveCanvasNodeMetaLabel(node, metaTypeLabel)
  const title =
    node.type === 'prompt' && (!node.title || node.title === 'Prompt')
      ? 'Text note'
      : (node.title ?? metaTypeLabel)
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
    audioOperation: isAudioTaskNode,
  })
  const [resizeHovered, setResizeHovered] = useState(false)
  const [resizing, setResizing] = useState(false)
  const videoUploadInputRef = useRef<HTMLInputElement | null>(null)
  const audioPresentationRef = useRef<CanvasAudioNodePresentationHandle>(null)
  // 未锁定节点在选中或悬浮时挂载缩放控件，无需先点击，同时避免所有节点常驻控件。
  const showResizer =
    !locked && !collapsedGroupPresentation && (selected || resizeHovered || resizing)
  const imageSrc = node.data.thumbnailUrl ?? node.data.url
  const isFullBleedImageNode = isFullBleedCanvasImageNode(node)
  // 图片与视频无论 loaded / empty 都使用同一个扁平媒体 Frame，避免资源加载前后
  // 因标题栏、footer 切换导致节点尺寸跳动。图片的源比例修正仍由 presentation helper 负责。
  const useFlatMediaFrame = canvasNodeUsesFlatMediaFrame(node)
  const showStandaloneActionFooter = canvasNodeHasStandaloneActionFooter(node)
  const isEmptyImageNode = node.type === 'image' && !isFullBleedImageNode
  const isEmptyVideoNode = node.type === 'video' && !node.data.url
  const inlinePrimaryAction = canvasNodeInlinePrimaryAction(node)
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
  const pipelineActions = contentNode
    ? getNodePipelineActions(contentNode, { assetKinds }).filter(
        (action) => action.kind !== 'video',
      )
    : []
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
  const isTextLikeContent = contentNode
    ? contentNode.type === 'text' || contentNode.type === 'prompt'
    : false
  const canExtractCharacterSubview = isImageContent && hasOperationOutput
  const imageTaskOutput =
    isTask && activeOperationOutput?.type === 'image' ? activeOperationOutput : null
  const latestOperationOutputCount =
    operationRuns.find((run) => run.outputs.length > 0)?.outputs.length ?? 0
  const canExpandOperationOutputs =
    isTask && Boolean(actions.expandOperationOutputs) && latestOperationOutputCount > 0
  const canExpandImageTaskOutput = Boolean(imageTaskOutput && actions.expandOperationOutputs)
  const canDeleteImageTaskOutput = Boolean(
    imageTaskOutput &&
    (imageTaskOutput.assetId || imageTaskOutput.nodeId) &&
    actions.deleteOperationOutputs,
  )
  const canDeleteCurrentOperationRun = Boolean(
    actions.deleteOperationRun && isCanvasOperationRunQuickDeletable(currentOperationRun),
  )
  const operationTaskActions =
    imageTaskOutput || canDeleteCurrentOperationRun ? (
      <div
        className="canvas-node-media-action-group canvas-node-task-image-actions nodrag nopan"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {imageTaskOutput ? (
          <>
            <Tooltip title="预览">
              <button
                type="button"
                className="canvas-node-subview-chip canvas-node-image-chip-preview"
                aria-label="预览"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  actions.editNode(node.id)
                }}
              >
                <Icons.Eye size={13} />
              </button>
            </Tooltip>
            {canExtractCharacterSubview ? (
              <Tooltip title="提取子视图">
                <button
                  type="button"
                  className="canvas-node-subview-chip"
                  aria-label="提取子视图"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    actions.extractCharacterSubview?.(node.id)
                  }}
                >
                  <Icons.Crop size={13} />
                </button>
              </Tooltip>
            ) : null}
            {canExpandImageTaskOutput ? (
              <Tooltip title="展开产物">
                <button
                  type="button"
                  className="canvas-node-subview-chip"
                  aria-label="展开产物"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    actions.expandOperationOutputs?.(node.id, [imageTaskOutput])
                  }}
                >
                  <Icons.Layers size={13} />
                </button>
              </Tooltip>
            ) : null}
            {canDeleteImageTaskOutput ? (
              <Tooltip title="删除当前产物">
                <button
                  type="button"
                  className="canvas-node-subview-chip is-danger"
                  aria-label={`删除当前产物 ${imageTaskOutput.title}`}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    actions.deleteOperationOutputs?.(node.id, [imageTaskOutput])
                  }}
                >
                  <Icons.Trash size={13} />
                </button>
              </Tooltip>
            ) : null}
          </>
        ) : null}
        {canDeleteCurrentOperationRun && currentOperationRun ? (
          <Tooltip
            title={
              currentOperationRun.status === 'pending' || currentOperationRun.status === 'running'
                ? '取消并删除本次运行'
                : '删除本次运行'
            }
          >
            <button
              type="button"
              className="canvas-node-subview-chip is-danger"
              aria-label="删除本次运行记录"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                actions.deleteOperationRun?.(node.id, currentOperationRun)
              }}
            >
              <Icons.Trash size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    ) : null
  const imageResourceActions =
    !isTask && node.type === 'image' && node.data.url ? (
      <div
        className="canvas-node-media-action-group canvas-node-image-chips nodrag nopan"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip title="预览">
          <button
            type="button"
            className="canvas-node-subview-chip canvas-node-image-chip-preview"
            aria-label="预览"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              actions.editNode(node.id)
            }}
          >
            <Icons.Eye size={13} />
          </button>
        </Tooltip>
        <Tooltip title="替换图片">
          <button
            type="button"
            className="canvas-node-subview-chip canvas-node-image-chip-replace"
            aria-label="替换图片"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              actions.replaceImage?.(node.id)
            }}
          >
            <Icons.Refresh size={13} />
          </button>
        </Tooltip>
        <Tooltip title="提取子视图">
          <button
            type="button"
            className={`canvas-node-subview-chip${assetSubviewCount > 0 ? ' has-subviews' : ''}`}
            aria-label="提取子视图"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              actions.extractCharacterSubview?.(node.id)
            }}
          >
            <Icons.Crop size={13} />
          </button>
        </Tooltip>
      </div>
    ) : null
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
  const audioToolbarNodeId =
    node.type === 'audio' && node.data.url
      ? node.id
      : isTask &&
          operationOutputState.mode !== 'collection' &&
          operationOutputState.mode !== 'bundle' &&
          activeOperationOutput?.type === 'audio' &&
          activeOperationOutput.nodeId
        ? activeOperationOutput.nodeId
        : null
  const videoToolbarSourceNodeId =
    contentNode?.type === 'video' && contentNode.data.url
      ? isTask
        ? (operationOutputState.primaryOutput?.nodeId ?? null)
        : node.id
      : null
  const runStyleExtraction = () => {
    const target = contentNode ?? node
    const isTextLike = target.type === 'text' || target.type === 'prompt'
    return actions.createOperationChild(node.id, 'text_generate', {
      title: '风格提取',
      prompt: isTextLike ? buildTextStyleExtractionPrompt(target) : IMAGE_STYLE_EXTRACTION_PROMPT,
    })
  }
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
              onClick: runStyleExtraction,
            },
          ]
        : isTextLikeContent
          ? [
              {
                key: 'extract-style',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Sparkles size={14} /> 提取风格
                  </span>
                ),
                onClick: runStyleExtraction,
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
      isTextLikeContent,
      runStyleExtraction,
    ],
  )
  const selectionToolbarEntries = useMemo<CanvasNodeToolbarEntry[]>(() => {
    // 单节点顶部工具栏放已确认的快捷操作；视频编辑同时保留右键入口，其他上下文管理类入口
    // （影视创作、资源库、类型切换、编组管理等）继续留在右键菜单，不能因为右键菜单中存在就自动迁移。
    const entries: CanvasNodeToolbarEntry[] = []
    const addAction = (action: CanvasNodeToolbarAction) => entries.push(action)

    if (isTask && actions.runOperationNode) {
      addAction({
        key: 'run-operation',
        label: '提交运行',
        icon: <Icons.Play size={15} />,
        disabled: operationStatus === 'running',
        onClick: () => actions.runOperationNode?.(node.id),
      })
    }
    if (isPanorama360) {
      addAction({
        key: 'preview-panorama',
        label: '全景预览',
        icon: <Icons.Globe size={15} />,
        onClick: () => actions.previewPanorama(node.id),
      })
    }
    if (canExpandOperationOutputs) {
      addAction({
        key: 'expand-operation-outputs',
        label: '展开产物',
        icon: <Icons.Layers size={15} />,
        onClick: () => actions.expandOperationOutputs?.(node.id),
      })
    }
    if (videoToolbarSourceNodeId) {
      if (actions.editVideo) {
        addAction({
          key: 'edit-video',
          label: '视频编辑',
          icon: <Icons.Video size={15} />,
          onClick: () => actions.editVideo?.(node.id),
        })
      }
      addAction({
        key: 'extract-audio',
        label: '分离音频',
        icon: <Icons.AudioLines size={15} />,
        onClick: () => actions.createOperationChild(videoToolbarSourceNodeId, 'extract_audio'),
      })
      addAction({
        key: 'extract-first-last-frames',
        label: '提取首尾帧',
        icon: <Icons.Image size={15} />,
        onClick: () =>
          actions.createOperationChild(videoToolbarSourceNodeId, 'extract_first_last_frames', {
            autoRun: true,
          }),
      })
    }
    addAction({
      key: 'duplicate',
      label: '复制节点',
      icon: <Icons.Copy size={15} />,
      onClick: () => actions.duplicateNode(node.id),
    })
    // 不支持的节点（视频/音频/工作流/分组等）以及暂无产物/内容的资源/任务节点：
    // 不放进工具栏，避免出现按不动的灰按钮。不在 disabled + tooltip 上做文章。
    if (canCopyNodeContent(node, activeOperationOutput).kind !== 'none') {
      addAction({
        key: 'copy-content',
        label: '复制内容',
        icon: <Icons.Clipboard size={15} />,
        onClick: () => {
          copyNodeContentToClipboard(node, activeOperationOutput).catch((error) => {
            console.warn('[CanvasNode] 复制内容失败', error)
            message.error(error instanceof Error ? error.message : '复制内容失败')
          })
        },
      })
    }

    const mediaChildren: CanvasNodeToolbarAction[] = []
    if (isImageContent) {
      mediaChildren.push({
        key: 'replace-image',
        label: '替换图片',
        icon: <Icons.Refresh size={15} />,
        onClick: () => actions.replaceImage?.(node.id),
      })
    }
    if (isImageContent && hasOperationOutput) {
      if (canExtractCharacterSubview) {
        mediaChildren.push({
          key: 'extract-character-subview',
          label: '提取子视图',
          icon: <Icons.Crop size={15} />,
          onClick: () => actions.extractCharacterSubview?.(node.id),
        })
      }
      mediaChildren.push(
        {
          key: 'split-grid-image',
          label: '宫格切分',
          icon: <Icons.Grid size={15} />,
          onClick: () => actions.splitGridImage?.(node.id),
        },
        {
          key: 'annotate-image',
          label: '图片标注',
          icon: <Icons.Edit size={15} />,
          onClick: () => actions.annotateImage?.(node.id),
        },
      )
    }
    if (storyboardSplitSource && actions.splitStoryboard) {
      mediaChildren.push({
        key: 'split-storyboard-by-shot',
        label: '按镜拆分',
        icon: <Icons.Scissors size={15} />,
        onClick: () => actions.splitStoryboard?.(storyboardSplitSource.id),
      })
    }
    if (
      (isImageContent || contentNode?.type === 'video' || contentNode?.type === 'audio') &&
      hasOperationOutput &&
      !audioToolbarNodeId
    ) {
      mediaChildren.push({
        key: 'download-media',
        label: '下载到本地',
        icon: <Icons.Download size={15} />,
        onClick: () => actions.downloadMedia(node.id),
      })
    }
    if (mediaChildren.length > 0) {
      entries.push({
        key: 'media-actions',
        label: '素材操作',
        icon: <Icons.Image size={15} />,
        expanded: true,
        children: mediaChildren,
      })
    }
    if (audioToolbarNodeId) {
      addAction({
        key: 'audio-trim',
        label: '音频截取',
        icon: <Icons.Scissors size={15} />,
        onClick: () => openAudioTrim(audioPresentationRef),
      })
      addAction({
        key: 'audio-speed',
        label: '音频变速',
        icon: <Icons.Sliders size={15} />,
        onClick: () => openAudioSpeed(audioPresentationRef),
      })
      addAction({
        key: 'audio-download',
        label: '下载音频到本地',
        icon: <Icons.Download size={15} />,
        onClick: () => actions.downloadMedia(audioToolbarNodeId),
      })
    }
    entries.push({ key: 'delete-divider', type: 'divider' })
    addAction({
      key: 'delete-node',
      label: '删除节点',
      icon: <Icons.Trash size={15} />,
      danger: true,
      onClick: () => actions.deleteNode(node.id),
    })
    return entries
  }, [
    actions,
    canExpandOperationOutputs,
    canExtractCharacterSubview,
    videoToolbarSourceNodeId,
    audioToolbarNodeId,
    contentNode,
    hasOperationOutput,
    isImageContent,
    isPanorama360,
    isTask,
    node,
    operationStatus,
    storyboardSplitSource,
  ])
  const [contextMenuBoundary, setContextMenuBoundary] = useState<{
    maxHeight: number
    maxWidth: number
    placement: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  }>({ maxHeight: 520, maxWidth: 320, placement: 'bottomLeft' })
  const menu = useMemo(
    () => ({
      className: 'canvas-node-context-menu',
      style: {
        maxHeight: Math.max(0, Math.min(520, contextMenuBoundary.maxHeight)),
        maxWidth: Math.max(0, Math.min(240, contextMenuBoundary.maxWidth)),
      },
      items: [
        // 单节点已迁移到顶部工具栏的运行、预览、展开、复制和素材操作不在这里重复显示。
        // 图片标注保留在右键菜单，方便图片资源和图片任务从上下文菜单直接进入。
        // 视频编辑、影视创作、资源库、类型切换、编组管理和 Agent 引用仍保留在右键菜单。
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
        ...(pipelineActions.length > 0
          ? [
              {
                key: 'pipeline-actions',
                popupClassName: 'canvas-node-context-submenu-popup',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Film size={14} /> {CANVAS_FUNCTIONAL_MENU_LABEL}
                  </span>
                ),
                children: [
                  ...CANVAS_PIPELINE_MENU_GROUPS.flatMap((group) => {
                    const groupActions = pipelineActions.filter(
                      (action) => action.kind === group.id,
                    )
                    return groupActions.length > 0
                      ? [
                          {
                            type: 'group' as const,
                            key: `pipeline-group-${group.id}`,
                            label: group.label,
                            children: groupActions.map((action) => ({
                              key: `pipeline-${action.id}`,
                              label: (
                                <span className="canvas-menu-item">
                                  {resolvePipelineIcon(action.icon)} {action.label}
                                </span>
                              ),
                              onClick: () => actions.pipelineAction(node.id, action.id),
                            })),
                          },
                        ]
                      : []
                  }),
                ],
              },
              { type: 'divider' as const },
            ]
          : []),
        ...(contextualAiActions.length > 0 || canCreateOperationFromNode
          ? [
              {
                key: 'feature-actions',
                popupClassName: 'canvas-node-context-submenu-popup',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Sparkles size={14} /> {CANVAS_FEATURE_MENU_LABEL}
                  </span>
                ),
                children: [
                  {
                    type: 'group' as const,
                    key: 'feature-group-node-enhance',
                    label: '视觉工具',
                    children: [
                      ...contextualAiActions,
                      ...CANVAS_FUNCTIONAL_CREATE_OPERATIONS.map((item) => ({
                        key: `feature-op-${item.operation}`,
                        label: (
                          <span className="canvas-menu-item">
                            {resolvePipelineIcon(item.icon)} {item.label}
                          </span>
                        ),
                        onClick: () => actions.createOperationChild(node.id, item.operation),
                      })),
                    ],
                  },
                  ...(canCreateOperationFromNode
                    ? [
                        {
                          type: 'group' as const,
                          key: 'feature-group-media-tools',
                          label: '媒体工具',
                          children: canvasVisibleFeatureCreateOperations().map((item) => ({
                            key: `feature-op-${item.operation}`,
                            label: (
                              <span className="canvas-menu-item">
                                {getOperationVisual(item.operation).icon} {item.label}
                              </span>
                            ),
                            onClick: () => actions.createOperationChild(node.id, item.operation),
                          })),
                        },
                      ]
                    : []),
                  ...(isImageContent && hasOperationOutput
                    ? [
                        {
                          type: 'group' as const,
                          key: 'feature-group-image-tools',
                          label: '图片工具',
                          children: [
                            ...(actions.annotateImage
                              ? [
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
                            ...(actions.extractCharacterSubview
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
                            ...(actions.splitGridImage
                              ? [
                                  {
                                    key: 'split-grid-image',
                                    label: (
                                      <span className="canvas-menu-item">
                                        <Icons.Grid size={14} /> 宫格切分
                                      </span>
                                    ),
                                    onClick: () => actions.splitGridImage?.(node.id),
                                  },
                                ]
                              : []),
                          ],
                        },
                      ]
                    : []),
                ],
              },
              { type: 'divider' as const },
            ]
          : []),
        ...(canCreateOperationFromNode
          ? canvasVisiblePrimaryCreateOperations().map((item) => ({
              key: `op-${item.operation}`,
              label: (
                <span className="canvas-menu-item">
                  {getOperationVisual(item.operation).icon} {item.label}
                </span>
              ),
              onClick: () => actions.createOperationChild(node.id, item.operation),
            }))
          : []),
        ...(isImageContent && hasOperationOutput && isPanorama360
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
                popupClassName: 'canvas-node-context-submenu-popup',
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
              ...(actions.selectGroupChildren
                ? [
                    {
                      key: 'select-group-children',
                      label: (
                        <span className="canvas-menu-item">
                          <Icons.CheckSquare size={14} /> 选中组内节点
                        </span>
                      ),
                      onClick: () => actions.selectGroupChildren?.(node.id),
                    },
                  ]
                : []),
              {
                key: 'toggle-group-collapse',
                label: (
                  <span className="canvas-menu-item">
                    {collapsedGroupPresentation ? (
                      <Icons.FolderOpen size={14} />
                    ) : (
                      <Icons.Folder size={14} />
                    )}{' '}
                    {collapsedGroupPresentation ? '展开编组' : '折叠编组'}
                  </span>
                ),
                onClick: () =>
                  actions.updateNodeData?.(node.id, {
                    collapsed: !collapsedGroupPresentation,
                  }),
              },
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
      isVideoWorkbench,
      locked,
      canCreateOperationFromNode,
      hasOperationOutput,
      isImageContent,
      isPanorama360,
      collapsedGroupPresentation,
      contentNode,
      contextMenuBoundary.maxHeight,
      contextMenuBoundary.maxWidth,
      node.id,
      node.type,
      pipelineActions,
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
  const operationSummary = isOperationNode(node) ? canvasOperationRuntimeSummary(node) : null
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
  const shouldShowContentTitle = isTextContentNode
  const passiveStatusLabel = isResourceOutput
    ? '产物'
    : productionBadge?.label
      ? productionBadge.label
      : node.type === 'group'
        ? '节点组'
        : isMediaContentNode
          ? node.data.url
            ? '已生成'
            : '待添加'
          : isTextContentNode
            ? '可编辑'
            : '已就绪'
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
          {!isDirectorStage3D &&
            !isVideoWorkbench &&
            (node.type === 'text' || node.type === 'prompt') && <Icons.File size={14} />}
          {isDirectorStage3D ? (
            <Icons.Box size={14} />
          ) : isVideoWorkbench ? (
            <Icons.Film size={14} />
          ) : isOperationNode(node) ? (
            operationNodeIcon(nodeOperation(node), operationWorkflow)
          ) : node.type === 'task' ? (
            <Icons.Activity size={14} />
          ) : null}
          {node.type === 'video' && <Icons.Play size={14} />}
          {node.type === 'group' && <Icons.Layers size={14} />}
        </span>
        <span className="canvas-node-kind-label">
          {node.data.panorama360 ? `360全景 · ${metaLabel}` : metaLabel}
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
        {isGroup ? (
          <button
            type="button"
            className="canvas-node-group-collapse-trigger nodrag nopan"
            aria-label="折叠编组"
            title="折叠编组"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              actions.updateNodeData?.(node.id, { collapsed: true })
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <Icons.ChevronUp size={13} />
          </button>
        ) : null}
      </span>
    </div>
  )

  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={menu}
      placement={contextMenuBoundary.placement}
      autoAdjustOverflow
    >
      <div
        className={`canvas-node-shell${selected ? ' canvas-node-shell-selected' : ''}`}
        onContextMenuCapture={(event) => {
          const stage = event.currentTarget.closest<HTMLElement>('.canvas-stage')
          if (!stage) return
          const rect = stage.getBoundingClientRect()
          const nextBoundary = calculateCanvasContextMenuAnchorSpace({
            point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
            container: { width: rect.width, height: rect.height },
            inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
          })
          setContextMenuBoundary((current) =>
            current.maxHeight === nextBoundary.maxHeight &&
            current.maxWidth === nextBoundary.maxWidth &&
            current.placement === nextBoundary.placement
              ? current
              : nextBoundary,
          )
        }}
      >
        <div
          data-canvas-node-id={node.id}
          className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}${roleMeta ? ' canvas-node-has-role' : ''}${hasInlineExtension ? ' canvas-node-inline-expanded' : ''}${collapsedGroupPresentation ? ' canvas-node-collapsed-group' : ''}${isTask && operationStatus === 'running' ? ' canvas-node-task-running' : ''}${isTask && operationStatus === 'failed' ? ' canvas-node-task-failed' : ''}${renderShotTable ? ' canvas-node-shot-script' : ''}${isResourceOutput ? ' canvas-node-resource-output' : ''}${useFlatMediaFrame ? ' canvas-node-media-full-bleed' : ''}${isFullBleedImageNode || isEmptyImageNode ? ' canvas-node-image-full-bleed' : ''}${node.type === 'video' && useFlatMediaFrame ? ' canvas-node-video-full-bleed' : ''}${isEmptyImageNode ? ' canvas-node-image-empty canvas-node-media-empty' : ''}${isEmptyVideoNode ? ' canvas-node-video-empty canvas-node-media-empty' : ''}${connectionTargetsNode ? ' canvas-node-connection-target' : ''}${connectionTargetIsValid ? ' canvas-node-connection-valid' : ''}`}
          style={nodeStyle}
          onPointerEnter={() => setResizeHovered(true)}
          onPointerLeave={() => setResizeHovered(false)}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (isGroup && actions.updateNodeData) {
              actions.updateNodeData(node.id, { collapsed: !collapsedGroupPresentation })
              return
            }
            actions.editNode(node.id)
          }}
        >
          {connectionPointerPosition ? (
            <span
              className="canvas-node-connection-follow"
              aria-hidden="true"
              style={{ left: connectionPointerPosition.left, top: connectionPointerPosition.top }}
            />
          ) : null}
          {!collapsedGroupPresentation ? nodeMetaBar : null}
          {selected && selectedNodeCount < 2 ? (
            <CanvasNodeSelectionToolbar entries={selectionToolbarEntries} />
          ) : null}
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
          {collapsedGroupPresentation ? (
            <CanvasCollapsedGroup
              nodeId={node.id}
              title={node.title}
              presentation={collapsedGroupPresentation}
              onRename={(nextTitle) => actions.renameNode?.(node.id, nextTitle)}
              onColorChange={(groupColor) => actions.updateNodeData?.(node.id, { groupColor })}
              onExpand={() => actions.updateNodeData?.(node.id, { collapsed: false })}
            />
          ) : (
            <>
              {inlineToolbar ? (
                <div className="canvas-node-inline-toolbar nodrag nopan">{inlineToolbar}</div>
              ) : null}
              <div
                className={`canvas-node-core${node.type === 'audio' || (isTask && activeOperationOutput?.type === 'audio') ? ' canvas-node-core-audio' : ''}`}
              >
                {shouldShowContentTitle && isTextContentNode ? (
                  <div className="canvas-node-content-title canvas-node-content-title-text">
                    <strong title={title}>{title}</strong>
                  </div>
                ) : null}
                {/* 仅选中节点时用 nowheel 将滚轮留给节点内容区；未选中时交还画布缩放/平移。 */}
                <div
                  className={`canvas-node-body${selected ? ' nowheel' : ''}${node.type === 'audio' || (isTask && activeOperationOutput?.type === 'audio') ? ' canvas-node-body-audio' : ''}`}
                >
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
                        {imageResourceActions}
                      </div>
                    ) : (
                      <div className="canvas-node-image-placeholder">
                        <Icons.Image size={30} />
                        <strong>{node.data.message ?? '图片节点'}</strong>
                        <span>双击节点添加内容</span>
                        <button
                          type="button"
                          className="canvas-node-image-placeholder-upload"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            actions.replaceImage?.(node.id)
                          }}
                        >
                          <Icons.Upload size={14} />
                          <span>上传图片</span>
                        </button>
                      </div>
                    )
                  ) : node.type === 'audio' ? (
                    node.data.url ? (
                      <CanvasAudioNodePresentation
                        ref={audioPresentationRef}
                        src={normalizedAudioSrc}
                        fileName={node.data.message ?? node.title ?? '音频'}
                        durationSec={node.data.audioDurationSec ?? 0}
                        cachedPeaks={node.data.audioWaveformPeaks}
                        selected={Boolean(selected)}
                        actions={{
                          onTrimApply: (start, end) => actions.audioTrim?.(node.id, start, end),
                          onSpeedApply: (factor) => actions.audioSpeed?.(node.id, factor),
                          onDownload: () => actions.downloadMedia(node.id),
                          onPeaks: (peaks) =>
                            actions.updateNodeData?.(node.id, {
                              audioWaveformPeaks: peaks,
                            }),
                        }}
                      />
                    ) : (
                      <div className="canvas-node-image-placeholder">
                        <Icons.Play size={30} />
                        <strong>{node.data.message ?? '暂无音频'}</strong>
                        <span>运行任务后在这里预览</span>
                      </div>
                    )
                  ) : node.type === 'video' ? (
                    node.data.url ? (
                      <CanvasVideoPlayer
                        className="canvas-node-image"
                        src={normalizedVideoSrc}
                        onVideoMetadata={({ width: mediaWidth, height: mediaHeight }) => {
                          if (
                            mediaWidth > 0 &&
                            mediaHeight > 0 &&
                            (node.data.mediaWidth !== mediaWidth ||
                              node.data.mediaHeight !== mediaHeight)
                          ) {
                            actions.updateNodeData?.(node.id, { mediaWidth, mediaHeight })
                          }
                        }}
                        onDoubleClickEdit={() => actions.editNode(node.id)}
                      />
                    ) : (
                      <div className="canvas-node-image-placeholder">
                        <Icons.Play size={30} />
                        <strong>{node.data.message ?? '暂无视频'}</strong>
                        <span>上传后可直接在节点内预览</span>
                        {inlinePrimaryAction?.kind === 'upload-video' ? (
                          <>
                            <button
                              type="button"
                              className="canvas-node-inline-primary-action nodrag nopan"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                videoUploadInputRef.current?.click()
                              }}
                            >
                              {inlinePrimaryAction.label}
                            </button>
                            <input
                              ref={videoUploadInputRef}
                              type="file"
                              accept="video/*"
                              aria-label="上传视频"
                              hidden
                              onChange={(event) => {
                                const file = event.target.files?.[0]
                                event.target.value = ''
                                if (file) actions.replaceVideo?.(node.id, file)
                              }}
                            />
                          </>
                        ) : null}
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
                  ) : isOperationNode(node) ? (
                    <div className="canvas-node-task canvas-node-operation">
                      <OperationOutputDeck
                        runs={operationRuns}
                        isolateWheel={selected}
                        runIndex={operationSelection.runIndex}
                        outputIndex={operationSelection.outputIndex}
                        onSelectOutput={selectOperationOutput}
                        {...(actions.expandOperationOutputs
                          ? {
                              onExpandOutput: (output: CanvasOperationOutputView) =>
                                actions.expandOperationOutputs?.(node.id, [output]),
                            }
                          : {})}
                        {...(actions.deleteOperationOutputs
                          ? {
                              onDeleteOutput: (output: CanvasOperationOutputView) =>
                                actions.deleteOperationOutputs?.(node.id, [output]),
                            }
                          : {})}
                        overlayActions={operationTaskActions}
                        onVideoMetadata={(output, dimensions) => {
                          if (
                            !output.nodeId ||
                            (output.width === dimensions.width &&
                              output.height === dimensions.height)
                          ) {
                            return
                          }
                          actions.updateNodeData?.(output.nodeId, {
                            mediaWidth: dimensions.width,
                            mediaHeight: dimensions.height,
                          })
                        }}
                        onVideoEdit={() => actions.editNode(node.id)}
                        selected={selected}
                        audioPresentationRef={audioPresentationRef}
                        {...(activeOperationOutput?.type === 'audio' && activeOperationOutput.nodeId
                          ? {
                              audioActions: {
                                onTrimApply: (start: number, end: number) => {
                                  void actions.audioTrim?.(
                                    activeOperationOutput.nodeId!,
                                    start,
                                    end,
                                  )
                                },
                                onSpeedApply: (factor: number) => {
                                  void actions.audioSpeed?.(activeOperationOutput.nodeId!, factor)
                                },
                                onDownload: () =>
                                  actions.downloadMedia(activeOperationOutput.nodeId!),
                                onPeaks: (peaks: number[]) => {
                                  void actions.updateNodeData?.(activeOperationOutput.nodeId!, {
                                    audioWaveformPeaks: peaks,
                                  })
                                },
                              },
                            }
                          : {})}
                        fallback={
                          <div className="canvas-operation-empty-state">
                            <div className="canvas-operation-empty-icon">
                              {operationNodeIcon(nodeOperation(node), operationWorkflow)}
                            </div>
                            {(operationStatus ?? 'pending') !== 'pending' ? (
                              <Progress
                                percent={operationProgress}
                                size="middle"
                                status={
                                  operationStatus === 'failed'
                                    ? 'exception'
                                    : operationStatus === 'completed'
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
                            {showImagePromptInputActions ? (
                              <div className="canvas-operation-input-actions nodrag nopan">
                                {actions.selectOperationInput ? (
                                  <Button
                                    type="text"
                                    size="small"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      actions.selectOperationInput?.(node.id)
                                    }}
                                  >
                                    从画布选择
                                  </Button>
                                ) : null}
                                {actions.uploadOperationInput ? (
                                  <Button
                                    type="text"
                                    size="small"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      actions.uploadOperationInput?.(node.id)
                                    }}
                                  >
                                    上传图片
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                    </div>
                  ) : renderShotTable ? (
                    <CanvasShotScriptTable rows={shotScriptRows} isolateWheel={selected} />
                  ) : isResourceOutput && (node.type === 'text' || node.type === 'prompt') ? (
                    <div className={`canvas-node-resource-text${selected ? ' nowheel' : ''}`}>
                      <div className="canvas-node-resource-text-icon">
                        <Icons.File size={26} />
                      </div>
                      <div className="canvas-node-resource-text-content md-surface">
                        <MarkdownText
                          content={node.data.text ?? node.data.message ?? '空文本产物'}
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`canvas-node-text md-surface${isTextLong ? ' canvas-node-text-long' : ''}`}
                    >
                      <MarkdownText
                        content={node.data.text ?? node.data.message ?? '空节点 · 双击编辑'}
                      />
                      {inlinePrimaryAction?.kind === 'edit' ? (
                        <button
                          type="button"
                          className="canvas-node-inline-primary-action nodrag nopan"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            actions.editNode(node.id)
                          }}
                        >
                          {inlinePrimaryAction.label}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                {showStandaloneActionFooter ? (
                  useFlatMediaFrame ? (
                    <div className="canvas-node-image-overlay-footer nodrag nopan">
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
                  ) : (
                    <div className="canvas-node-quick-footer nodrag nopan">
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
                  )
                ) : null}
              </div>
              {selected &&
              isTask &&
              operationOutputState.mode !== 'collection' &&
              operationOutputState.mode !== 'bundle' ? (
                <CanvasOperationOutputThumbnailSwitcher
                  items={operationMediaThumbnails}
                  activeOutputId={activeOperationOutput?.id}
                  onSelect={(item) =>
                    selectOperationOutput(item.runIndex, item.outputIndex, item.output)
                  }
                />
              ) : null}
              {renderedInlinePanel ? (
                <div
                  className={`canvas-node-inline-panel nodrag nopan${selected ? ' nowheel' : ''}${inlinePanelVisible ? ' is-visible' : ' is-hiding'}`}
                  style={{
                    ['--canvas-node-inline-extra-height' as string]: `${inlinePanelDisplayHeight}px`,
                  }}
                >
                  {renderedInlinePanel}
                </div>
              ) : null}
            </>
          )}
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
