import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import { getNodePipelineActions } from './canvasPipeline'

/** 把 op 的图标 key 映射为 Icons 组件（找不到回退 Workflow） */
function resolvePipelineIcon(iconKey: string | undefined): React.ReactNode {
  const map = Icons as unknown as Record<string, (p: { size?: number }) => React.ReactNode>
  const IconFn = (iconKey && map[iconKey]) || Icons.Workflow
  return <IconFn size={14} />
}

/**
 * 右键菜单上下文（文档 §7.6 / §11.4）。
 *
 * 空白画布右键按约定归集为：资源内容节点 / 任务节点 / 画布操作。
 * node.type === 'task' / 'group' 会走专用菜单分支。
 */
export type CanvasContextMenuContext =
  | { kind: 'pane'; left: number; top: number; flowPosition: { x: number; y: number } }
  | {
      kind: 'node'
      left: number
      top: number
      flowPosition: { x: number; y: number }
      node: CanvasNode
      selectedCount: number
    }
  | {
      kind: 'multi'
      left: number
      top: number
      selectedNodeIds: string[]
    }

export type CanvasContextMenuItem =
  | { type: 'item'; key: string; label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }
  | {
      type: 'submenu'
      key: string
      label: string
      icon?: React.ReactNode
      children: Array<{
        key: string
        label: string
        icon?: React.ReactNode
        danger?: boolean
        disabled?: boolean
      }>
    }
  | { type: 'divider' }

type MenuHandlers = {
  // pane
  onAddText: (position: { x: number; y: number }) => void
  onAddImage: (position: { x: number; y: number }) => void
  onAddPrompt: (position: { x: number; y: number }) => void
  onInsertAsset: () => void
  onCreateBoard: () => void
  onResetView: () => void
  // node（普通内容节点）
  onEditNode: (nodeId: string) => void
  onDuplicateNode: (nodeId: string) => void
  onLocateOrigin: (nodeId: string) => void
  onStartAiForNode: (nodeId: string) => void
  onToggleLockNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  /** 全景产物节点右键 → 360° 全景预览 */
  onPreviewPanorama: (nodeId: string) => void
  /** 流水线一键编排（设计 §7）：actionId 来自 getPipelineActions */
  onPipelineAction: (nodeId: string, actionId: string) => void
  // task node
  onViewTask: (nodeId: string) => void
  onRetryTask: (nodeId: string) => void
  // group node
  onRenameGroup: (nodeId: string) => void
  onDissolveGroup: (nodeId: string) => void
  // multi
  onDuplicateSelection: () => void
  onCreateGroupFromSelection: () => void
  onDeleteSelection: () => void
  onStartAiForSelection: () => void
}

/** 根据上下文构造菜单项列表 */
export function buildContextMenuItems(
  context: CanvasContextMenuContext,
  // handlers 保留为 API 契约的一部分；当前菜单项仅依赖 context，dispatch 时才用 handlers
  _handlers: MenuHandlers,
): CanvasContextMenuItem[] {
  if (context.kind === 'pane') {
    return [
      {
        type: 'submenu',
        key: 'add_resource',
        label: '资源内容节点',
        icon: <Icons.FileText size={14} />,
        children: [
          { key: 'add_text', label: '添加文本', icon: <Icons.File size={14} /> },
          { key: 'add_image', label: '上传图片', icon: <Icons.Image size={14} /> },
          { key: 'add_prompt', label: '新建 Prompt', icon: <Icons.Edit size={14} /> },
          { key: 'insert_asset', label: '从资产选择', icon: <Icons.Folder size={14} /> },
        ],
      },
      { type: 'divider' },
      { type: 'item', key: 'create_board', label: '新建画布', icon: <Icons.Plus size={14} /> },
      { type: 'item', key: 'reset_view', label: '视图重置', icon: <Icons.RotateCcw size={14} /> },
    ]
  }

  if (context.kind === 'multi') {
    return [
      { type: 'item', key: 'dup_selection', label: '复制选中节点', icon: <Icons.Copy size={14} /> },
      { type: 'item', key: 'group_selection', label: '组合选中节点', icon: <Icons.Layers size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'ai_selection', label: '基于选中创建任务节点', icon: <Icons.Sparkles size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'delete_selection', label: '删除选中', icon: <Icons.Trash size={14} />, danger: true },
    ]
  }

  // 单节点
  const { node } = context
  if (node.type === 'task') {
    return [
      { type: 'item', key: 'view_task', label: '查看任务详情', icon: <Icons.Search size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'retry_task', label: '重试任务', icon: <Icons.RotateCcw size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'dup_node', label: '复制节点', icon: <Icons.Copy size={14} /> },
      { type: 'item', key: 'delete_node', label: '删除任务节点', icon: <Icons.Trash size={14} />, danger: true },
    ]
  }
  if (node.type === 'group') {
    const pipelineActions = getNodePipelineActions(node)
    const pipelineItems: CanvasContextMenuItem[] =
      pipelineActions.length > 0
        ? [
            {
              type: 'submenu',
              key: 'pipeline_actions',
              label: '剧本流水线',
              icon: <Icons.Workflow size={14} />,
              children: pipelineActions.map((action) => ({
                key: `pipeline:${action.id}`,
                label: `${action.label}`,
                icon: resolvePipelineIcon(action.icon),
              })),
            },
            { type: 'divider' },
          ]
        : []
    return [
      { type: 'item', key: 'rename_group', label: '重命名组', icon: <Icons.Edit size={14} /> },
      { type: 'item', key: 'dup_node', label: '复制组', icon: <Icons.Copy size={14} /> },
      { type: 'divider' },
      ...pipelineItems,
      { type: 'item', key: 'ai_node', label: '基于组创建任务节点', icon: <Icons.Sparkles size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'dissolve_group', label: '解散组', icon: <Icons.Layers size={14} /> },
      { type: 'item', key: 'delete_node', label: '删除组', icon: <Icons.Trash size={14} />, danger: true },
    ]
  }
  // 普通内容节点：专用流水线操作（无 pipelineRole 的文本节点也给「剧本类」入口）
  const pipelineActions = getNodePipelineActions(node)
  const pipelineItems: CanvasContextMenuItem[] =
    pipelineActions.length > 0
      ? [
          {
            type: 'submenu',
            key: 'pipeline_actions',
            label: '剧本流水线',
            icon: <Icons.Workflow size={14} />,
            children: pipelineActions.map((action) => ({
              key: `pipeline:${action.id}`,
              label: `${action.label}`,
              icon: resolvePipelineIcon(action.icon),
            })),
          },
          { type: 'divider' },
        ]
      : []
  // 360 全景产物节点：在最前面提供「全景预览」专用入口（与普通图片「编辑」解耦）
  const panoramaItem: CanvasContextMenuItem[] = node.data.panorama360
    ? [
        { type: 'item', key: 'preview_panorama', label: '全景预览', icon: <Icons.Globe size={14} /> },
        { type: 'divider' },
      ]
    : []
  return [
    ...panoramaItem,
    ...pipelineItems,
    // 普通图片节点没有可编辑文本/URL，编辑入口无意义，仅保留专用入口（如图片标注）
    ...(node.type === 'image'
      ? []
      : [
          {
            type: 'item' as const,
            key: 'edit_node',
            label: '编辑节点',
            icon: <Icons.Edit size={14} />,
          },
        ]),
    { type: 'item', key: 'dup_node', label: '复制', icon: <Icons.Copy size={14} /> },
    { type: 'divider' },
    { type: 'item', key: 'ai_node', label: '基于当前节点创建任务节点', icon: <Icons.Sparkles size={14} /> },
    ...(node.assetId
      ? [{ type: 'item' as const, key: 'locate_origin', label: '定位来源任务', icon: <Icons.Search size={14} /> }]
      : []),
    { type: 'divider' },
    { type: 'item', key: 'lock_node', label: node.locked ? '解锁节点' : '锁定节点', icon: <Icons.Check size={14} /> },
    { type: 'item', key: 'delete_node', label: '删除节点', icon: <Icons.Trash size={14} />, danger: true },
  ]
}

/** 执行菜单项 key → 对应 handler */
export function dispatchContextMenuItem(
  key: string,
  context: CanvasContextMenuContext,
  handlers: MenuHandlers,
): void {
  // 仅 pane / node 场景有 flowPosition；multi 的动作不需要坐标
  const pos =
    context.kind === 'multi' ? { x: 0, y: 0 } : context.flowPosition
  const nodeId = context.kind === 'node' ? context.node.id : ''

  if (key.startsWith('pipeline:')) {
    handlers.onPipelineAction(nodeId, key.slice('pipeline:'.length))
    return
  }

  switch (key) {
    case 'add_text':
      handlers.onAddText(pos)
      break
    case 'add_image':
      handlers.onAddImage(pos)
      break
    case 'add_prompt':
      handlers.onAddPrompt(pos)
      break
    case 'insert_asset':
      handlers.onInsertAsset()
      break
    case 'create_board':
      handlers.onCreateBoard()
      break
    case 'reset_view':
      handlers.onResetView()
      break
    case 'edit_node':
      handlers.onEditNode(nodeId)
      break
    case 'preview_panorama':
      handlers.onPreviewPanorama(nodeId)
      break
    case 'dup_node':
      handlers.onDuplicateNode(nodeId)
      break
    case 'locate_origin':
      handlers.onLocateOrigin(nodeId)
      break
    case 'ai_node':
      handlers.onStartAiForNode(nodeId)
      break
    case 'lock_node':
      handlers.onToggleLockNode(nodeId)
      break
    case 'delete_node':
      handlers.onDeleteNode(nodeId)
      break
    case 'view_task':
      handlers.onViewTask(nodeId)
      break
    case 'retry_task':
      handlers.onRetryTask(nodeId)
      break
    case 'rename_group':
      handlers.onRenameGroup(nodeId)
      break
    case 'dissolve_group':
      handlers.onDissolveGroup(nodeId)
      break
    case 'dup_selection':
      handlers.onDuplicateSelection()
      break
    case 'group_selection':
      handlers.onCreateGroupFromSelection()
      break
    case 'delete_selection':
      handlers.onDeleteSelection()
      break
    case 'ai_selection':
      handlers.onStartAiForSelection()
      break
  }
}

/**
 * 右键菜单浮层。由 CanvasStage / WorkspaceView 触发，传入上下文与 handlers。
 */
export function CanvasContextMenu({
  context,
  handlers,
  onClose,
}: {
  context: CanvasContextMenuContext
  handlers: MenuHandlers
  onClose: () => void
}) {
  const items = buildContextMenuItems(context, handlers)
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const minInset = 12
  const left = Math.min(
    Math.max(context.left, minInset),
    Math.max(viewportWidth - 220, minInset),
  )
  const top = Math.min(
    Math.max(context.top, minInset),
    Math.max(viewportHeight - 120, minInset),
  )
  const openSubmenusLeft = left > viewportWidth - 420
  const openSubmenusUp = top > viewportHeight / 2

  return (
    <>
      <div
        className="canvas-context-menu-overlay"
        onClick={onClose}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        className={`canvas-context-menu${openSubmenusLeft ? ' canvas-context-menu-submenus-left' : ''}${
          openSubmenusUp ? ' canvas-context-menu-submenus-up' : ''
        }`}
        style={{ left, top, maxHeight: `calc(100vh - ${top + minInset}px)` }}
        role="menu"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) =>
          item.type === 'divider' ? (
            <div key={`d${index}`} className="canvas-context-menu-divider" />
          ) : item.type === 'submenu' ? (
            <div key={item.key} className="canvas-context-submenu" role="none">
              <button
                type="button"
                role="menuitem"
                className="canvas-context-menu-item canvas-context-menu-item-submenu"
              >
                {item.icon && <span className="canvas-context-menu-icon">{item.icon}</span>}
                <span>{item.label}</span>
                <span className="canvas-context-menu-caret">
                  <Icons.ChevronRight size={14} />
                </span>
              </button>
              <div className="canvas-context-submenu-panel" role="menu">
                {item.children.map((child) => (
                  <button
                    key={child.key}
                    type="button"
                    role="menuitem"
                    className={`canvas-context-menu-item${child.danger ? ' danger' : ''}`}
                    disabled={child.disabled}
                    onClick={() => {
                      dispatchContextMenuItem(child.key, context, handlers)
                      onClose()
                    }}
                  >
                    {child.icon && <span className="canvas-context-menu-icon">{child.icon}</span>}
                    <span>{child.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`canvas-context-menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                dispatchContextMenuItem(item.key, context, handlers)
                onClose()
              }}
            >
              {item.icon && <span className="canvas-context-menu-icon">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ),
        )}
      </div>
    </>
  )
}
