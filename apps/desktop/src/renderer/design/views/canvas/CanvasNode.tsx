import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Progress } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import { isOperationNode, nodeOperation } from './canvas.capabilities'
import { isLongText, pickTextNodeMinSize } from './canvasNodeSize'
import { getNodePipelineActions } from './canvasPipeline'
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
function DirectorStageMini({ data }: { data: SparkCanvasNode['data'] }) {
  const stage = readDirectorStageMini(data)
  const toPlan = (x: number, z: number) => ({ px: 50 + x * 40, py: 50 + z * 40 })
  const cam = stage ? toPlan(stage.camera.x, stage.camera.z) : { px: 50, py: 90 }
  const head = (deg: number) => ({ hx: Math.sin((deg * Math.PI) / 180), hy: -Math.cos((deg * Math.PI) / 180) })
  const fov = stage?.camera.fov ?? 50
  const facing = stage?.camera.facing ?? 0
  const left = head(facing - fov / 2)
  const right = head(facing + fov / 2)
  const L = 120
  return (
    <svg className="canvas-node-director-mini" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <clipPath id="mini-stage-clip">
          <rect x="8" y="8" width="84" height="84" rx="4" />
        </clipPath>
      </defs>
      <rect x="8" y="8" width="84" height="84" rx="4" className="mini-floor" />
      <g clipPath="url(#mini-stage-clip)" className="mini-grid">
        {[26, 44, 62, 80].map((v) => (
          <line key={`mx-${v}`} x1={v} y1="8" x2={v} y2="92" />
        ))}
        {[26, 44, 62, 80].map((v) => (
          <line key={`my-${v}`} x1="8" y1={v} x2="92" y2={v} />
        ))}
      </g>
      <polygon
        clipPath="url(#mini-stage-clip)"
        className="mini-cone"
        points={`${cam.px},${cam.py} ${cam.px + left.hx * L},${cam.py + left.hy * L} ${cam.px + right.hx * L},${cam.py + right.hy * L}`}
      />
      {stage?.items.map((item, index) => {
        const p = toPlan(item.x, item.z)
        return <circle key={index} cx={p.px} cy={p.py} r={3.4} fill={item.color} className="mini-dot" />
      })}
      <rect x={cam.px - 3} y={cam.py - 3} width={6} height={6} rx={1.4} className="mini-cam" />
    </svg>
  )
}

/** 操作节点图标：按 operation 类型映射 */
function operationNodeIcon(operation: CanvasOperationType | null): React.ReactNode {
  if (!operation) return <Icons.Sparkles size={13} />
  if (
    operation.startsWith('text_to_image') ||
    operation === 'image_to_image' ||
    operation === 'image_edit' ||
    operation === 'image_compose'
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

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  lineage?: {
    incoming: number
    outgoing: number
    generated: number
    usedAsInput: number
  }
  selectedCount: number
  actions: {
    duplicateNode: (nodeId: string) => void
    editNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    toggleLockNode: (nodeId: string) => void
    bringNodeToFront: (nodeId: string) => void
    createGroupFromSelection: () => void
    addSelectionToGroup: (groupId: string) => void
    removeNodeFromGroup: (nodeId: string) => void
    dissolveGroup: (groupId: string) => void
    openAiComposer: (nodeId: string) => void
    saveToLibrary: (nodeId: string) => void
    createOperationChild: (
      parentId: string,
      operation: import('./canvas.types').CanvasOperationType,
      options?: { title?: string; prompt?: string },
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

const typeColor: Record<SparkCanvasNode['type'], string> = {
  image: 'blue',
  audio: 'cyan',
  video: 'purple',
  text: 'default',
  prompt: 'orange',
  task: 'green',
  group: 'default',
  // 类型化 AI 操作节点（文档 §7.10 升级：每个 operation 一个独立 node type）
  text_to_image: 'green',
  image_to_image: 'green',
  image_edit: 'green',
  image_compose: 'green',
  text_generate: 'green',
  text_rewrite: 'green',
  prompt_optimize: 'green',
  text_to_video: 'green',
  image_to_video: 'green',
  video_edit: 'green',
  text_to_audio: 'green',
  audio_transcribe: 'green',
}

export const CanvasNode = memo(function CanvasNode({ data, selected }: NodeProps) {
  const { actions, canvasNode: node, lineage, selectedCount } = data as CanvasFlowNodeData
  const displayType = node.type === 'prompt' ? 'text' : node.type
  const title =
    node.type === 'prompt' && (!node.title || node.title === 'Prompt')
      ? 'Text note'
      : (node.title ?? displayType)
  const locked = Boolean(node.locked)
  const isGroup = node.type === 'group'
  const isTask = isOperationNode(node)
  const isDirectorStage = node.data.subtype === 'director_stage'
  const isGroupedChild = Boolean(node.parentNodeId)
  const hasLineage = Boolean(lineage && (lineage.incoming > 0 || lineage.outgoing > 0))
  // 长文本节点（剧本/文稿等）：NodeResizer 拖拽下限放宽；渲染时套 long 修饰类。
  // 渲染条件用当前 text 长度判断，旧节点编辑后内容变长也能自动应用阅读样式，
  // 但旧节点的物理尺寸不会自动放大（仅影响新建，参见 canvasNodeSize.ts 顶部说明）。
  const isTextLong = isLongText(node.data.text)
  const textMinSize = pickTextNodeMinSize(node.data.text)
  const imageSrc = node.data.thumbnailUrl ?? node.data.url
  const normalizedImageSrc = imageSrc ? normalizeEduAssetUrl(imageSrc) : ''
  const normalizedAudioSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const normalizedVideoSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''

  const pipelineActions = isTask || isGroup ? [] : getNodePipelineActions(node)
  const menu = {
    className: 'canvas-node-context-menu',
    items: [
      ...(pipelineActions.length > 0
        ? [
            ...pipelineActions.map((action) => ({
              key: `pipeline-${action.id}`,
              label: (
                <span className="canvas-menu-item">
                  {resolvePipelineIcon(action.icon)} {action.label}
                </span>
              ),
              onClick: () => actions.pipelineAction(node.id, action.id),
            })),
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
      {
        key: 'edit',
        label: (
          <span className="canvas-menu-item">
            <Icons.Edit size={14} /> {isTask ? '打开操作面板' : '编辑节点'}
          </span>
        ),
        onClick: () => actions.editNode(node.id),
      },
      ...(node.type === 'image' && !isTask
        ? [
            {
              key: 'extract-style',
              label: (
                <span className="canvas-menu-item">
                  <Icons.Sparkles size={14} /> 提取风格
                </span>
              ),
              onClick: () =>
                actions.createOperationChild(node.id, 'text_generate', {
                  title: '风格提取',
                  prompt:
                    '请分析输入图片的视觉风格，并输出可复用的中文风格描述。重点包括：画面题材、艺术媒介、色彩倾向、光影氛围、构图镜头、材质细节、时代/类型气质，以及适合作为后续生成提示词的风格关键词。',
                }),
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
                  <Icons.Plus size={14} /> 新增 AI 操作 ▸
                </span>
              ),
              children: [
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
  }

  const roleMeta = node.data.pipelineRole ? PIPELINE_ROLE_META[node.data.pipelineRole] : undefined

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <div
        className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}${roleMeta ? ' canvas-node-has-role' : ''}`}
        {...(roleMeta ? { style: { ['--role-color' as string]: roleMeta.color } } : {})}
        onDoubleClick={(event) => {
          event.stopPropagation()
          actions.editNode(node.id)
        }}
      >
        <NodeResizer
          color="var(--primary)"
          isVisible={selected && !locked}
          minWidth={isGroup ? 320 : isTextLong ? textMinSize.width : 180}
          minHeight={isGroup ? 200 : isTextLong ? textMinSize.height : 112}
          handleClassName="canvas-node-resize-handle"
          lineClassName="canvas-node-resize-line"
        />
        <Handle type="target" position={Position.Left} className="canvas-node-handle" />
        <div className="canvas-node-head">
          <div className="canvas-node-title">
            {node.type === 'image' && <Icons.Image size={14} />}
            {node.type === 'audio' && <Icons.Play size={14} />}
            {(node.type === 'text' || node.type === 'prompt') && <Icons.File size={14} />}
            {isDirectorStage ? (
              <Icons.Play size={14} />
            ) : isOperationNode(node) ? (
              operationNodeIcon(nodeOperation(node))
            ) : node.type === 'task' ? (
              <Icons.Activity size={14} />
            ) : null}
            {node.type === 'video' && <Icons.Play size={14} />}
            {node.type === 'group' && <Icons.Layers size={14} />}
            <span>{title}</span>
          </div>
          <div className="canvas-node-head-actions">
            {pipelineActions.slice(0, 2).map((action) => (
              <Tooltip key={action.id} title={`下一步：${action.label}`}>
                <button
                  type="button"
                  className="canvas-node-pipeline-action nodrag nopan"
                  aria-label={`下一步：${action.label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.pipelineAction(node.id, action.id)
                  }}
                >
                  {resolvePipelineIcon(action.icon, 12)}
                  <span>{action.label}</span>
                </button>
              </Tooltip>
            ))}
            <Tooltip title={isTask ? '打开操作面板' : '基于此节点继续 AI 操作'}>
              <button
                type="button"
                className="canvas-node-ai-action nodrag nopan"
                aria-label={isTask ? '打开操作面板' : '基于此节点继续 AI 操作'}
                onClick={(event) => {
                  event.stopPropagation()
                  if (isTask) actions.editNode(node.id)
                  else actions.openAiComposer(node.id)
                }}
              >
                {isTask ? <Icons.Edit size={13} /> : <Icons.Sparkles size={13} />}
              </button>
            </Tooltip>
            {(node.type === 'text' || node.type === 'prompt') && (
              <Tooltip title="编辑文本 / Prompt">
                <button
                  type="button"
                  className="canvas-node-ai-action nodrag nopan"
                  aria-label="编辑文本 / Prompt"
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.editNode(node.id)
                  }}
                >
                  <Icons.Edit size={13} />
                </button>
              </Tooltip>
            )}
            {node.data.productionState && PRODUCTION_STATE_BADGE[node.data.productionState] && (
              <Tag color={PRODUCTION_STATE_BADGE[node.data.productionState]!.color} bordered>
                {PRODUCTION_STATE_BADGE[node.data.productionState]!.label}
              </Tag>
            )}
            {roleMeta ? (
              <span className="canvas-node-role-chip">{roleMeta.label}</span>
            ) : (
              <Tag color={typeColor[node.type]} bordered>
                {displayType}
              </Tag>
            )}
          </div>
        </div>

        {hasLineage && (
          <div className="canvas-node-lineage-strip">
            <span>
              <Icons.ArrowDown size={12} />
              {lineage?.incoming ?? 0}
            </span>
            <span>
              <Icons.ArrowUp size={12} />
              {lineage?.outgoing ?? 0}
            </span>
            {lineage?.generated ? (
              <span>
                <Icons.GitBranch size={12} />
                {lineage.generated}
              </span>
            ) : null}
          </div>
        )}

        <div className="canvas-node-body">
          {node.type === 'image' ? (
            node.data.url ? (
              <img className="canvas-node-image" src={normalizedImageSrc} alt={title} />
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
          ) : isDirectorStage ? (
            <div className="canvas-node-director-stage">
              <DirectorStageMini data={node.data} />
              <div className="canvas-node-director-stage-hint">双击编排画面 · 站位 / 取景 / 提示词</div>
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
                size="small"
                status={
                  node.data.status === 'failed'
                    ? 'exception'
                    : node.data.status === 'completed'
                      ? 'success'
                      : 'active'
                }
              />
              <div className="canvas-node-task-msg">
                {node.data.message ?? node.data.prompt ?? '点击节点下方编辑面板调整参数后运行'}
              </div>
            </div>
          ) : (
            <div className={`canvas-node-text${isTextLong ? ' canvas-node-text-long' : ''}`}>
              {node.data.text ?? node.data.message ?? 'Empty'}
            </div>
          )}
        </div>
        <Handle type="source" position={Position.Right} className="canvas-node-handle" />
      </div>
    </Dropdown>
  )
})
