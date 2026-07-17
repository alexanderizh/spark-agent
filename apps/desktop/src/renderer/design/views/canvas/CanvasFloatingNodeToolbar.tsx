import { memo } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Popover } from 'antd'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import { isCanvasImageContentNode } from './canvas.capabilities'
import { getNodePipelineActions } from './canvasPipeline'
import {
  CANVAS_BASE_TASK_MENU_LABEL,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
  CANVAS_FUNCTIONAL_MENU_LABEL,
  canvasBaseCreateOperations,
} from './canvasNodeGenerationMenu'
import type {
  CanvasNode,
  CanvasOperationType,
  CanvasProductionState,
  CanvasTask,
} from './canvas.types'

const FLOATING_IMAGE_STYLE_EXTRACTION_PROMPT =
  '请分析输入图片的视觉风格，并输出可复用的中文风格描述。重点包括：画面题材、艺术媒介、色彩倾向、光影氛围、构图镜头、材质细节、时代/类型气质，以及适合作为后续生成提示词的风格关键词。'

function buildFloatingTextStyleExtractionPrompt(node: CanvasNode): string {
  const source = (node.data.text ?? node.data.prompt ?? node.title ?? '').trim()
  return [
    '请阅读输入的剧本文本，提炼出这一章节可复用的镜头风格描述（中文）。',
    '重点包括：整体影像气质、景别偏好、运镜方式、构图习惯、色调与光影氛围、画面材质与年代质感、节奏与剪辑风格，以及适合作为后续分镜 / 生成提示词的风格关键词。',
    source ? `章节文本：\n${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function readCanvasNodeSourceText(node: CanvasNode): string {
  return (node.data.text ?? node.data.prompt ?? node.title ?? '').trim()
}

function buildFloatingImageOutpaintPrompt(node: CanvasNode): string {
  const source = readCanvasNodeSourceText(node)
  return [
    '请基于输入图片进行自然扩图，将画面扩展为默认 2:1 横向比例。',
    '保持主体身份、造型、场景透视、光影方向、材质纹理、镜头语言和整体风格一致。',
    '扩展区域需要像原图真实延伸出来，避免重复主体、变形、黑边、文字、水印、拼接痕迹或明显 AI 边缘。',
    source ? `补充要求：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildFloatingDetailSheetNineGridPrompt(node: CanvasNode): string {
  const source = readCanvasNodeSourceText(node)
  const sourceIntro =
    node.type === 'image'
      ? '请以输入图片为核心参考，保留主体/场景的身份一致性和视觉风格。'
      : '请根据输入内容进行视觉扩散设计。'
  return [
    sourceIntro,
    '生成一张 2:1 横向画布的九宫格设定拆分图，3x3 排列，每格是同一主题的不同角度、距离或细节变化。',
    '如果主题是场景：包含远景建立、正面、侧面、俯视/高角度、低角度、入口/出口、关键道具、材质细节、光影氛围等变化。',
    '如果主题是人物：包含正面、侧面、背面、半身、全身、表情、服装细节、道具细节、动态姿态等变化。',
    '如果主题是道具/物体：包含正视、侧视、背视、打开/使用状态、局部材质、尺寸关系、环境中的摆放、功能细节等变化。',
    '九格之间保持同一世界观与设计语言，画面干净，不要文字标签、水印、边框说明或 UI 元素。',
    source ? `输入内容：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const CanvasFloatingNodeToolbar = memo(function CanvasFloatingNodeToolbar({
  node,
  resourceNode,
  isOperation,
  onClose,
  onFocus,
  onDuplicate,
  onToggleLock,
  onBringToFront,
  onSaveToLibrary,
  onDownload,
  onAnnotate,
  onSplitGrid,
  onExtractCharacterSubview,
  onPreviewPanorama,
  onOpenInlineAi,
  onEditNode,
  onDelete,
  onPipelineAction,
  onCreateOperationChild,
  onSetProductionState,
  onMergeGroup,
  onDissolveGroup,
  operationFullscreen = false,
  onOperationFullscreenChange,
}: {
  node: CanvasNode
  /** 操作节点当前主产物；资源动作作用于它，节点管理仍作用于稳定步骤节点。 */
  resourceNode?: CanvasNode
  isOperation: boolean
  onClose: () => void
  onFocus: () => void
  onDuplicate: () => void
  onToggleLock: () => void
  onBringToFront: () => void
  onSaveToLibrary: () => void
  onDownload: () => void
  onAnnotate: () => void
  onSplitGrid: () => void
  onExtractCharacterSubview: () => void
  onPreviewPanorama: () => void
  onOpenInlineAi: () => void
  onEditNode: () => void
  onDelete: () => void
  onPipelineAction: (actionId: string) => void
  onCreateOperationChild: (
    operation: CanvasOperationType,
    options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
  ) => void
  onSetProductionState: (state: CanvasProductionState) => void
  onMergeGroup: () => void
  onDissolveGroup: () => void
  operationFullscreen?: boolean
  onOperationFullscreenChange?: (nextFullscreen: boolean) => void
}) {
  const contentNode = resourceNode ?? node
  const hasResource = !isOperation || Boolean(resourceNode)
  const isMedia = contentNode.type === 'image' || contentNode.type === 'video'
  const isImage = isCanvasImageContentNode(contentNode)
  const isGroup = node.type === 'group'
  const isPanorama360 = Boolean(contentNode.data.panorama360)
  const pipelineActions = hasResource ? getNodePipelineActions(contentNode) : []
  const canEditNode = contentNode.type !== 'image' || isOperation
  const title =
    node.title ??
    (isOperation
      ? operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
      : node.type)
  const operationTitle = isOperation
    ? operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
    : title
  const operationStatus = node.data.status ?? 'pending'
  const operationStatusColor =
    operationStatus === 'completed'
      ? 'green'
      : operationStatus === 'failed'
        ? 'red'
        : operationStatus === 'running'
          ? 'blue'
          : 'default'
  const createImageOutpaintTask = () =>
    onCreateOperationChild('image_edit', {
      title: '图片扩图',
      prompt: buildFloatingImageOutpaintPrompt(contentNode),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createDetailSheetTask = () =>
    onCreateOperationChild(contentNode.type === 'image' ? 'image_edit' : 'text_to_image', {
      title: '细节设定图（九宫格）',
      prompt: buildFloatingDetailSheetNineGridPrompt(contentNode),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createStyleExtractionTask = () => {
    const isTextLike = contentNode.type === 'text' || contentNode.type === 'prompt'
    return onCreateOperationChild('text_generate', {
      title: '风格提取',
      prompt: isTextLike
        ? buildFloatingTextStyleExtractionPrompt(contentNode)
        : FLOATING_IMAGE_STYLE_EXTRACTION_PROMPT,
    })
  }
  const contextualAiActions = [
    ...(isImage && hasResource
      ? [
          {
            key: 'outpaint-image',
            label: '图片扩图',
            icon: <Icons.Crop size={14} />,
            onClick: createImageOutpaintTask,
          },
          {
            key: 'extract-style',
            label: '提取风格',
            icon: <Icons.Sparkles size={14} />,
            onClick: createStyleExtractionTask,
          },
        ]
      : (contentNode.type === 'text' || contentNode.type === 'prompt') && hasResource
        ? [
            {
              key: 'extract-style',
              label: '提取风格',
              icon: <Icons.Sparkles size={14} />,
              onClick: createStyleExtractionTask,
            },
          ]
        : []),
    ...((contentNode.type === 'image' ||
      contentNode.type === 'text' ||
      contentNode.type === 'prompt') &&
    hasResource
      ? [
          {
            key: 'detail-sheet-nine-grid',
            label: '细节设定图（九宫格）',
            icon: <Icons.Grid size={14} />,
            onClick: createDetailSheetTask,
          },
        ]
      : []),
  ]
  const baseTaskOperations = canvasBaseCreateOperations()
  const menuButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    options?: { danger?: boolean; disabled?: boolean },
  ) => (
    <Button
      block
      size="middle"
      type="text"
      icon={icon}
      onClick={onClick}
      {...(options?.danger ? { className: 'canvas-floating-menu-danger' } : {})}
      {...(options?.disabled ? { disabled: true } : {})}
    >
      {label}
    </Button>
  )
  const aiOperationMenu = (
    <div className="canvas-floating-menu">
      <div className="canvas-floating-menu-title">{CANVAS_BASE_TASK_MENU_LABEL}</div>
      {menuButton('打开 AI 面板', <Icons.Sparkles size={14} />, onOpenInlineAi)}
      {baseTaskOperations.length > 0 && <div className="canvas-floating-menu-divider" />}
      {baseTaskOperations.map((item) => (
        <div key={item.operation}>
          {menuButton(item.label, resolveCanvasFloatingIcon(item.icon, 14), () =>
            onCreateOperationChild(item.operation),
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className="canvas-floating-toolbar-shell" role="toolbar" aria-label={`${title} 编辑工具`}>
      <div className="canvas-floating-toolbar-title">
        {isOperation ? <Icons.Sparkles size={14} /> : <Icons.Edit size={14} />}
        <span>{isOperation ? operationTitle : title}</span>
        {isOperation && (
          <Tag color={operationStatusColor} bordered>
            {floatingOperationStatusLabel(operationStatus)}
          </Tag>
        )}
      </div>
      <div className="canvas-floating-toolbar-divider" />
      <Tooltip title="聚焦节点">
        <Button size="middle" type="text" icon={<Icons.Crosshair size={14} />} onClick={onFocus}>
          聚焦
        </Button>
      </Tooltip>
      {!isGroup && hasResource && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottomLeft"
          arrow={false}
          overlayClassName="canvas-floating-toolbar-popover"
          content={aiOperationMenu}
        >
          <Button size="middle" type="text" icon={<Icons.Sparkles size={14} />}>
            {CANVAS_BASE_TASK_MENU_LABEL}
          </Button>
        </Popover>
      )}
      {!isGroup && hasResource && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottom"
          content={
            <div className="canvas-floating-menu">
              <div className="canvas-floating-menu-title">{CANVAS_FUNCTIONAL_MENU_LABEL}</div>
              {pipelineActions.length > 0 &&
                pipelineActions.map((action) => (
                  <div key={action.id}>
                    {menuButton(action.label, resolveCanvasFloatingIcon(action.icon, 14), () =>
                      onPipelineAction(action.id),
                    )}
                  </div>
                ))}
              {pipelineActions.length > 0 && <div className="canvas-floating-menu-divider" />}
              {contextualAiActions.map((action) => (
                <div key={action.key}>{menuButton(action.label, action.icon, action.onClick)}</div>
              ))}
              {contextualAiActions.length > 0 && <div className="canvas-floating-menu-divider" />}
              {CANVAS_FUNCTIONAL_CREATE_OPERATIONS.map((item) => (
                <div key={item.operation}>
                  {menuButton(item.label, resolveCanvasFloatingIcon(item.icon, 14), () =>
                    onCreateOperationChild(item.operation),
                  )}
                </div>
              ))}
              <div className="canvas-floating-menu-divider" />
              {menuButton('确认采用', <Icons.Check size={14} />, () =>
                onSetProductionState('confirmed'),
              )}
              {menuButton('标记待更新', <Icons.RotateCcw size={14} />, () =>
                onSetProductionState('stale'),
              )}
            </div>
          }
        >
          <Button size="middle" type="text" icon={<Icons.Workflow size={14} />}>
            {CANVAS_FUNCTIONAL_MENU_LABEL}
          </Button>
        </Popover>
      )}
      {hasResource && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottom"
          content={
            <div className="canvas-floating-menu">
              <div className="canvas-floating-menu-title">媒体 / 素材</div>
              {isMedia && menuButton('下载到本地', <Icons.Download size={14} />, onDownload)}
              {isImage && (
                <>
                  {menuButton('提取子视图', <Icons.Crop size={14} />, onExtractCharacterSubview)}
                  {menuButton('图片标注', <Icons.Crop size={14} />, onAnnotate)}
                  {menuButton('宫格切分', <Icons.Grid size={14} />, onSplitGrid)}
                </>
              )}
              {isPanorama360 &&
                menuButton('全景预览', <Icons.Globe size={14} />, onPreviewPanorama)}
              {contentNode.type === 'group' && (
                <>
                  {menuButton('多图合并', <Icons.Image size={14} />, onMergeGroup)}
                  {menuButton('解散组', <Icons.FolderOpen size={14} />, onDissolveGroup)}
                </>
              )}
              {menuButton('保存到资源库', <Icons.Folder size={14} />, onSaveToLibrary)}
            </div>
          }
        >
          <Button size="middle" type="text" icon={<Icons.Folder size={14} />}>
            素材
          </Button>
        </Popover>
      )}
      <div className="canvas-floating-toolbar-spacer" />
      {isOperation && (
        <Tooltip title={operationFullscreen ? '退出全屏' : '全屏展示'}>
          <Button
            size="middle"
            type="text"
            icon={operationFullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
            onClick={() => onOperationFullscreenChange?.(!operationFullscreen)}
          >
            {operationFullscreen ? '退出全屏' : '全屏'}
          </Button>
        </Tooltip>
      )}
      <Popover
        trigger="hover"
        mouseEnterDelay={0.08}
        mouseLeaveDelay={0.18}
        placement="bottom"
        content={
          <div className="canvas-floating-menu">
            <div className="canvas-floating-menu-title">节点管理</div>
            {menuButton('复制节点', <Icons.Copy size={14} />, onDuplicate)}
            {menuButton(
              node.locked ? '解锁节点' : '锁定节点',
              <Icons.Lock size={14} />,
              onToggleLock,
            )}
            {menuButton('置于顶层', <Icons.Layers size={14} />, onBringToFront)}
            {canEditNode &&
              !isOperation &&
              menuButton('编辑节点', <Icons.Edit size={14} />, onEditNode)}
            <div className="canvas-floating-menu-divider" />
            {menuButton('删除节点', <Icons.Trash size={14} />, onDelete, { danger: true })}
          </div>
        }
      >
        <Button size="middle" type="text" icon={<Icons.More size={14} />}>
          更多
        </Button>
      </Popover>
      <div className="canvas-floating-toolbar-divider" />
      <Tooltip title="关闭编辑">
        <Button size="middle" type="text" icon={<Icons.X size={14} />} onClick={onClose} />
      </Tooltip>
    </div>
  )
})

function floatingOperationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

function resolveCanvasFloatingIcon(iconKey: string | undefined, size = 14): React.ReactNode {
  const map = Icons as unknown as Record<string, (p: { size?: number }) => React.ReactNode>
  const IconFn = (iconKey && map[iconKey]) || Icons.Workflow
  return <IconFn size={size} />
}
