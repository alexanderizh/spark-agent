import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Handle, NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Progress } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { useCanvasSelectedCount } from './canvasSelectionContext'
import { flowNodeContentEqual, canvasFlowNodeDataEqual } from './canvasStageNodeSync'
import { operationLabel } from './canvas.api'
import { isOperationNode, nodeOperation } from './canvas.capabilities'
import { isLongText, pickCanvasNodeMinSize } from './canvasNodeSize'
import { getNodePipelineActions } from './canvasPipeline'
import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'
import type { CanvasOperationType } from './canvas.types'

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

/** 操作节点图标：按 operation 类型映射 */
function operationNodeIcon(operation: CanvasOperationType | null): React.ReactNode {
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

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  assetSubviewCount?: number
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
    createGroupFromSelection: () => void
    addSelectionToGroup: (groupId: string) => void
    removeNodeFromGroup: (nodeId: string) => void
    dissolveGroup: (groupId: string) => void
    openAiComposer: (nodeId: string) => void
    saveToLibrary: (nodeId: string) => void
    annotateImage?: (nodeId: string) => void
    splitGridImage?: (nodeId: string) => void
    extractCharacterSubview?: (nodeId: string) => void
    /** 360 全景产物节点：右键 → 全景预览（与普通图片「编辑」解耦） */
    previewPanorama: (nodeId: string) => void
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
  }
}

const PRODUCTION_STATE_BADGE: Partial<
  Record<NonNullable<SparkCanvasNode['data']['productionState']>, { label: string; color: string }>
> = {
  confirmed: { label: '已确认', color: 'green' },
  stale: { label: '待更新', color: 'orange' },
  draft: { label: '草稿', color: 'default' },
}

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

/**
 * 分镜脚本产物节点的传统分镜脚本表渲染。
 * 仅展示，不带操作按钮（节点交互仍走顶部工具栏/右键菜单）。
 * 触发条件是「内容像分镜表」（见 CanvasNode 内 shotScriptRows 判定），与节点角色无关。
 * 数据来自分镜 agent 输出，parseShotTable 优先解析 JSON shots/groups.segments，兼容 Markdown 表格。
 */
function ShotScriptTable({ rows }: { rows: ParsedShotRow[] }) {
  const totalSec = rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0)
  const hasDuration = rows.some((row) => row.durationSec != null)
  return (
    <div className="canvas-node-shot-table-wrap nowheel">
      <table className="canvas-node-shot-table">
        <colgroup>
          <col className="canvas-node-shot-col-idx" />
          {hasDuration ? <col className="canvas-node-shot-col-dur" /> : null}
          <col className="canvas-node-shot-col-size" />
          <col className="canvas-node-shot-col-move" />
          <col />
          <col className="canvas-node-shot-col-line" />
          <col className="canvas-node-shot-col-char" />
        </colgroup>
        <thead>
          <tr>
            <th>镜号</th>
            {hasDuration ? <th>时长</th> : null}
            <th>景别</th>
            <th>运镜</th>
            <th>画面 / 动作</th>
            <th>对白</th>
            <th>角色</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, displayIndex) => (
            <tr key={displayIndex}>
              <td className="canvas-node-shot-idx">#{row.index ?? displayIndex + 1}</td>
              {hasDuration ? (
                <td className="canvas-node-shot-dur">
                  {row.durationSec != null ? `${row.durationSec}s` : '—'}
                </td>
              ) : null}
              <td className="canvas-node-shot-size">{row.shotSize || '—'}</td>
              <td className="canvas-node-shot-move">{row.movement || '—'}</td>
              <td className="canvas-node-shot-desc">
                {row.title ? <div className="canvas-node-shot-title">{row.title}</div> : null}
                {row.description || row.narration ? (
                  <div>
                    {row.description}
                    {row.narration ? (
                      <span className="canvas-node-shot-narr">旁白：{row.narration}</span>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td className="canvas-node-shot-line">{row.dialogue || '—'}</td>
              <td className="canvas-node-shot-char">
                {row.characterNames && row.characterNames.length > 0
                  ? row.characterNames.join('、')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="canvas-node-shot-foot">
        共 {rows.length} 镜{hasDuration ? ` · 总时长 ${totalSec}s` : ''}
      </div>
    </div>
  )
}

export const CanvasNode = memo(function CanvasNode({ data, selected }: NodeProps) {
  const {
    actions,
    canvasNode: node,
    assetSubviewCount = 0,
    inlinePanel,
    inlinePanelExtraHeight,
    inlineToolbar,
  } = data as CanvasFlowNodeData
  const selectedCount = useCanvasSelectedCount()
  const locked = Boolean(node.locked)
  const isGroup = node.type === 'group'
  const isTask = isOperationNode(node)
  const roleMeta = node.data.pipelineRole ? PIPELINE_ROLE_META[node.data.pipelineRole] : undefined
  const displayType = node.type === 'prompt' ? 'text' : node.type
  const metaTypeLabel = roleMeta
    ? roleMeta.label
    : isTask
      ? operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
      : (NODE_TYPE_META_LABEL[displayType as SparkCanvasNode['type']] ?? displayType)
  const title =
    node.type === 'prompt' && (!node.title || node.title === 'Prompt')
      ? 'Text note'
      : (node.title ?? metaTypeLabel)
  const isDirectorStage = node.data.subtype === 'director_stage'
  const isDirectorStage3D = node.data.subtype === 'director_stage_3d'
  const isGroupedChild = Boolean(node.parentNodeId)
  // 长文本节点（剧本/文稿等）：NodeResizer 拖拽下限放宽；渲染时套 long 修饰类。
  // 渲染条件用当前 text 长度判断，旧节点编辑后内容变长也能自动应用阅读样式，
  // 但旧节点的物理尺寸不会自动放大（仅影响新建，参见 canvasNodeSize.ts 顶部说明）。
  const isTextLong = isLongText(node.data.text)
  const minSize = pickCanvasNodeMinSize(node.type, node.data.text)
  const imageSrc = node.data.thumbnailUrl ?? node.data.url
  const normalizedImageSrc = imageSrc ? normalizeEduAssetUrl(imageSrc) : ''
  const normalizedAudioSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const normalizedVideoSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''

  const pipelineActions = isTask ? [] : getNodePipelineActions(node)
  const isPanorama360 = Boolean(node.data.panorama360)
  const canExtractCharacterSubview = node.type === 'image' && !isTask
  // 分镜脚本产物节点：把 agent 输出的 JSON / Markdown 分镜表渲染成传统分镜脚本表。
  // 不依赖 pipelineRole（分镜脚本文本产物节点故意不打 shot 角色，避免右键出现不适用的
  // 关键帧/视频操作），改为「文本节点 + 内容像分镜表 + 能解析出多行」的内容判定，
  // 既覆盖历史节点，又不会误伤普通文本便签。
  const shotScriptRows = useMemo<ParsedShotRow[]>(() => {
    if (node.type !== 'text' || !node.data.text) return []
    const text = node.data.text
    if (!isShotScriptText(text)) return []
    const rows = parseShotTable(text)
    // ≥2 行才算可信的分镜表，避免把含「segments」字眼的普通便签误判
    return rows.length >= 2 ? rows : []
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
      prompt: buildImageOutpaintPrompt(node),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createDetailSheetTask = () =>
    actions.createOperationChild(node.id, node.type === 'image' ? 'image_edit' : 'text_to_image', {
      title: '细节设定图（九宫格）',
      prompt: buildDetailSheetNineGridPrompt(node),
      modelParams: { aspect_ratio: '2:1' },
    })
  // AI 操作子菜单里「上下文专属」的快捷操作（带图标）。
  const contextualAiActions = useMemo(
    () => [
      ...(node.type === 'image' && !isTask
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
      ...((node.type === 'image' || node.type === 'text' || node.type === 'prompt') && !isTask
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
    [createDetailSheetTask, createImageOutpaintTask, isTask, node.type, runImageStyleExtraction],
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
        ...(pipelineActions.length > 0
          ? [
              {
                key: 'pipeline-actions',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Workflow size={14} /> 剧本流水线
                  </span>
                ),
                children: pipelineActions.map((action) => ({
                  key: `pipeline-${action.id}`,
                  label: (
                    <span className="canvas-menu-item">
                      {resolvePipelineIcon(action.icon)} {action.label}
                    </span>
                  ),
                  onClick: () => actions.pipelineAction(node.id, action.id),
                })),
              },
              { type: 'divider' as const },
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
        ...(node.type === 'image' && !isTask
          ? []
          : [
              {
                key: 'edit',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Edit size={14} /> {isTask ? '打开操作面板' : '编辑节点'}
                  </span>
                ),
                onClick: () => actions.editNode(node.id),
              },
            ]),
        ...(node.type === 'image' && !isTask
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
        ...(isTask
          ? []
          : [
              {
                key: 'add-operation',
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Plus size={14} /> 任务节点 ▸
                  </span>
                ),
                children: [
                  ...contextualAiActions,
                  ...(contextualAiActions.length > 0 ? [{ type: 'divider' as const }] : []),
                  {
                    key: 'op-text_to_image',
                    label: '文生图',
                    onClick: () => actions.createOperationChild(node.id, 'text_to_image'),
                  },
                  {
                    key: 'op-image_edit',
                    label: '图生图',
                    onClick: () => actions.createOperationChild(node.id, 'image_edit'),
                  },
                  {
                    key: 'op-image_compose',
                    label: '多图合成',
                    onClick: () => actions.createOperationChild(node.id, 'image_compose'),
                  },
                  {
                    key: 'op-storyboard_grid',
                    label: '故事板',
                    onClick: () => actions.createOperationChild(node.id, 'storyboard_grid'),
                  },
                  {
                    key: 'op-panorama_360',
                    label: '360 全景图',
                    onClick: () => actions.createOperationChild(node.id, 'panorama_360'),
                  },
                  {
                    key: 'op-text_generate',
                    label: '文本生成',
                    onClick: () => actions.createOperationChild(node.id, 'text_generate'),
                  },
                  {
                    key: 'op-text_rewrite',
                    label: '文本改写',
                    onClick: () => actions.createOperationChild(node.id, 'text_rewrite'),
                  },
                  {
                    key: 'op-prompt_optimize',
                    label: 'Prompt 优化',
                    onClick: () => actions.createOperationChild(node.id, 'prompt_optimize'),
                  },
                  {
                    key: 'op-text_to_video',
                    label: '文生视频',
                    onClick: () => actions.createOperationChild(node.id, 'text_to_video'),
                  },
                  {
                    key: 'op-image_to_video',
                    label: '图生视频',
                    onClick: () => actions.createOperationChild(node.id, 'image_to_video'),
                  },
                  {
                    key: 'op-text_to_audio',
                    label: '文生音频',
                    onClick: () => actions.createOperationChild(node.id, 'text_to_audio'),
                  },
                  {
                    key: 'op-audio_transcribe',
                    label: '语音转写',
                    onClick: () => actions.createOperationChild(node.id, 'audio_transcribe'),
                  },
                ],
              },
            ]),
        ...(isTask
          ? []
          : [
              {
                key: 'group',
                disabled: selectedCount < 2,
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Layers size={14} /> 创建组
                  </span>
                ),
                onClick: () => actions.createGroupFromSelection(),
              },
            ]),
        ...((node.type === 'image' || node.type === 'video') && !isTask
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
                key: 'add-to-group',
                disabled: selectedCount < 2,
                label: (
                  <span className="canvas-menu-item">
                    <Icons.Plus size={14} /> 加入选中节点
                  </span>
                ),
                onClick: () => actions.addSelectionToGroup(node.id),
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
        ...(isGroup
          ? []
          : [
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
            ]),
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
      isTask,
      locked,
      canExtractCharacterSubview,
      node.id,
      node.type,
      pipelineActions,
      selectedCount,
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
  const productionBadge =
    node.data.productionState && PRODUCTION_STATE_BADGE[node.data.productionState]
  const operationSummary = isOperationNode(node) ? operationRuntimeSummary(node) : null
  const nodeStyle = {
    ...(roleMeta ? { ['--role-color' as string]: roleMeta.color } : {}),
    ...(hasInlineExtension ? { ['--canvas-node-base-height' as string]: `${node.height}px` } : {}),
  } as CSSProperties

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <div className="canvas-node-shell">
        {!hasInlineExtension ? (
          <NodeToolbar isVisible position={Position.Top} align="start" offset={6}>
            <div className="canvas-node-meta-bar nodrag nopan">
              <span className="canvas-node-meta-title">
                {node.type === 'image' &&
                  (node.data.panorama360 ? <Icons.Globe size={12} /> : <Icons.Image size={12} />)}
                {node.type === 'audio' && <Icons.Play size={12} />}
                {(node.type === 'text' || node.type === 'prompt') && <Icons.File size={12} />}
                {isDirectorStage ? (
                  <Icons.Play size={12} />
                ) : isOperationNode(node) ? (
                  operationNodeIcon(nodeOperation(node))
                ) : node.type === 'task' ? (
                  <Icons.Activity size={12} />
                ) : null}
                {node.type === 'video' && <Icons.Play size={12} />}
                {node.type === 'group' && <Icons.Layers size={12} />}
                <span title={node.data.panorama360 ? `360全景 · ${title}` : title}>
                  {node.data.panorama360 ? `360全景 · ${title}` : title}
                </span>
              </span>
              <span className="canvas-node-meta-tags">
                {roleMeta ? (
                  <span className="canvas-node-meta-chip canvas-node-meta-chip-role">
                    {roleMeta.label}
                  </span>
                ) : (
                  <span className="canvas-node-meta-chip">{metaTypeLabel}</span>
                )}
                {productionBadge ? (
                  <span
                    className={`canvas-node-meta-chip canvas-node-meta-chip-state is-${node.data.productionState}`}
                  >
                    {productionBadge.label}
                  </span>
                ) : null}
              </span>
            </div>
          </NodeToolbar>
        ) : null}
        <div
          data-canvas-node-id={node.id}
          className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}${roleMeta ? ' canvas-node-has-role' : ''}${hasInlineExtension ? ' canvas-node-inline-expanded' : ''}${isTask && node.data.status === 'running' ? ' canvas-node-task-running' : ''}${isTask && node.data.status === 'failed' ? ' canvas-node-task-failed' : ''}${renderShotTable ? ' canvas-node-shot-script' : ''}`}
          style={nodeStyle}
          onDoubleClick={(event) => {
            event.stopPropagation()
            actions.editNode(node.id)
          }}
        >
          {/* 缩放锚点常驻渲染（仅锁定时隐藏），与选中态解耦：默认透明，
            悬浮节点或节点被选中时由 CSS 浮现并可拖拽，避免选中态丢失导致无法缩放。 */}
          <NodeResizer
            color="var(--primary)"
            isVisible={!locked}
            minWidth={minSize.width}
            minHeight={minSize.height}
            handleClassName="canvas-node-resize-handle"
            lineClassName="canvas-node-resize-line"
          />
          <Handle type="target" position={Position.Left} className="canvas-node-handle" />
          {inlineToolbar ? (
            <div className="canvas-node-inline-toolbar nodrag nopan">{inlineToolbar}</div>
          ) : null}
          <div className="canvas-node-core">
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
                        <span>{assetSubviewCount > 0 ? `子视图 ${assetSubviewCount}` : '提取子视图'}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="canvas-node-image-placeholder">
                    <Icons.Image size={30} />
                    <span>{node.data.message ?? '等待图片 URL'}</span>
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
                    <span>{node.data.message ?? '等待音频结果'}</span>
                  </div>
                )
              ) : node.type === 'video' ? (
                node.data.url ? (
                  <video
                    className="canvas-node-image"
                    src={normalizedVideoSrc}
                    controls
                    preload="metadata"
                  />
                ) : (
                  <div className="canvas-node-image-placeholder">
                    <Icons.Play size={30} />
                    <span>{node.data.message ?? '等待视频结果'}</span>
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
              ) : isDirectorStage ? (
                <div className="canvas-node-director-stage">
                  <DirectorStageMini data={node.data} nodeId={node.id} />
                  <div className="canvas-node-director-stage-hint">
                    双击编排画面 · 站位 / 取景 / 提示词
                  </div>
                </div>
              ) : isOperationNode(node) ? (
                <div className="canvas-node-task canvas-node-operation">
                  <div className="canvas-node-task-row">
                    <span className="canvas-node-operation-label">
                      {operationNodeIcon(nodeOperation(node))}
                      {nodeOperation(node) ? operationLabel(nodeOperation(node)!) : 'AI 任务'}
                    </span>
                    <Tag
                      color={
                        node.data.status === 'completed'
                          ? 'green'
                          : node.data.status === 'failed'
                            ? 'red'
                            : node.data.status === 'running'
                              ? 'blue'
                              : 'default'
                      }
                      bordered
                    >
                      {operationStatusLabel(node.data.status)}
                    </Tag>
                  </div>
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
                  {operationSummary ? (
                    <div className="canvas-node-task-meta">{operationSummary}</div>
                  ) : null}
                  <div className="canvas-node-task-msg">
                    {node.data.message ?? node.data.prompt ?? '点击节点下方编辑面板调整参数后运行'}
                  </div>
                </div>
              ) : renderShotTable ? (
                <ShotScriptTable rows={shotScriptRows} />
              ) : (
                <div className={`canvas-node-text${isTextLong ? ' canvas-node-text-long' : ''}`}>
                  {node.data.text ?? node.data.message ?? 'Empty'}
                </div>
              )}
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
  return canvasFlowNodeDataEqual(prev.data as CanvasFlowNodeData, next.data as CanvasFlowNodeData)
}
