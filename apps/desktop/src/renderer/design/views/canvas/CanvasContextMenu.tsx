import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import { getPipelineActions } from './canvasPipeline'

/**
 * 右键菜单上下文（文档 §7.6 / §11.4）。
 *
 * 区分五种触发场景，每种渲染不同菜单项，避免巨型统一菜单：
 *   - pane：空白画布右键
 *   - node：普通内容节点右键（含选中态判断）
 *   - multi：多选状态右键
 *   node.type === 'task' / 'group' 会走专用菜单分支。
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
  /** 流水线一键编排（设计 §7）：actionId 来自 getPipelineActions */
  onPipelineAction: (nodeId: string, actionId: string) => void
  // task node
  onViewTask: (nodeId: string) => void
  onRetryTask: (nodeId: string) => void
  onRerunWithInputs: (nodeId: string) => void
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
      { type: 'item', key: 'add_text', label: '添加文本', icon: <Icons.File size={14} /> },
      { type: 'item', key: 'add_image', label: '上传图片', icon: <Icons.Image size={14} /> },
      { type: 'item', key: 'add_prompt', label: '新建 Prompt', icon: <Icons.Edit size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'insert_asset', label: '从资产插入', icon: <Icons.Folder size={14} /> },
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
      { type: 'item', key: 'ai_selection', label: '基于选中发起 AI 操作', icon: <Icons.Sparkles size={14} /> },
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
      { type: 'item', key: 'rerun_inputs', label: '基于输入重新运行', icon: <Icons.Sparkles size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'dup_node', label: '复制节点', icon: <Icons.Copy size={14} /> },
      { type: 'item', key: 'delete_node', label: '删除任务节点', icon: <Icons.Trash size={14} />, danger: true },
    ]
  }
  if (node.type === 'group') {
    return [
      { type: 'item', key: 'rename_group', label: '重命名组', icon: <Icons.Edit size={14} /> },
      { type: 'item', key: 'dup_node', label: '复制组', icon: <Icons.Copy size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'ai_node', label: '基于组发起 AI 任务', icon: <Icons.Sparkles size={14} /> },
      { type: 'divider' },
      { type: 'item', key: 'dissolve_group', label: '解散组', icon: <Icons.Layers size={14} /> },
      { type: 'item', key: 'delete_node', label: '删除组', icon: <Icons.Trash size={14} />, danger: true },
    ]
  }
  // 普通内容节点
  const pipelineActions = getPipelineActions(node.data?.pipelineRole)
  const pipelineItems: CanvasContextMenuItem[] =
    pipelineActions.length > 0
      ? [
          ...pipelineActions.map(
            (action): CanvasContextMenuItem => ({
              type: 'item',
              key: `pipeline:${action.id}`,
              label: `${action.label}`,
              icon: <Icons.Workflow size={14} />,
            }),
          ),
          { type: 'divider' },
        ]
      : []
  return [
    ...pipelineItems,
    { type: 'item', key: 'edit_node', label: '编辑节点', icon: <Icons.Edit size={14} /> },
    { type: 'item', key: 'dup_node', label: '复制', icon: <Icons.Copy size={14} /> },
    { type: 'divider' },
    { type: 'item', key: 'ai_node', label: '基于当前节点发起 AI 操作', icon: <Icons.Sparkles size={14} /> },
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
    case 'rerun_inputs':
      handlers.onRerunWithInputs(nodeId)
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
  const left = context.left
  const top = context.top

  return (
    <>
      <div className="canvas-context-menu-overlay" onClick={onClose} onContextMenu={(event) => event.preventDefault()} />
      <div
        className="canvas-context-menu"
        style={{ left, top }}
        role="menu"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) =>
          item.type === 'divider' ? (
            <div key={`d${index}`} className="canvas-context-menu-divider" />
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
