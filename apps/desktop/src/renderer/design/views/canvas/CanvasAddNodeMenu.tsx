import { useEffect, useMemo } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { CANVAS_CAPABILITIES } from './canvas.capabilities'
import { getOperationVisual } from './canvasOperationIcons'
import type { CanvasNodeData, CanvasOperationType } from './canvas.types'

/**
 * 画布节点创建约定（文档 §7.7）：
 *
 * 节点在交互层归并为两类：
 * - 资源内容节点：文本 / 媒体 / 组，以及从资产、历史、模板导入
 * - 任务节点：所有 AI 操作（底层仍为 task + operation）
 *
 * 资源入口动作（上传、从资产选择等）通过 action 触发，不新增底层 node type。
 */
export type AddNodeMenuCategory = 'resource' | 'task'

export type AddNodeMenuItem = {
  id: string
  label: string
  category: AddNodeMenuCategory
  icon: React.ReactNode
  /** 类型语义色 class，用于按钮配色（image/text/audio/video） */
  colorClass?: string
  /** 资源内容节点：给出 type + data；资源入口：onAction；任务：onOperation */
  nodeType?: 'text' | 'prompt' | 'image' | 'video' | 'audio' | 'group'
  data?: CanvasNodeData
  operation?: CanvasOperationType
  action?: 'upload_image' | 'insert_asset' | 'from_history' | 'from_template'
}

export const ADD_NODE_CATEGORY_LABELS: Record<AddNodeMenuCategory, string> = {
  resource: '资源内容节点',
  task: '任务节点',
}

/**
 * 节点工厂的菜单结构。内容由调用方决定如何落地（createTextNode / createTask 等）。
 */
export function useAddNodeMenuItems(): AddNodeMenuItem[] {
  const taskItems = useMemo<AddNodeMenuItem[]>(
    () =>
      CANVAS_CAPABILITIES.map((capability) => {
        const visual = getOperationVisual(capability.operation)
        return {
          id: `task:${capability.operation}`,
          label: capability.label,
          category: 'task' as const,
          icon: visual.icon,
          colorClass: visual.colorClass,
          operation: capability.operation,
        }
      }),
    [],
  )

  return useMemo<AddNodeMenuItem[]>(
    () => [
      // 资源内容节点
      {
        id: 'resource:text',
        label: '文本',
        category: 'resource',
        icon: <Icons.FileText size={15} />,
        colorClass: 'canvas-op-color-text',
        nodeType: 'text',
        data: { text: '', format: 'plain', origin: 'manual' },
      },
      {
        id: 'resource:image',
        label: '图片',
        category: 'resource',
        icon: <Icons.Image size={15} />,
        colorClass: 'canvas-op-color-image',
        action: 'upload_image',
      },
      {
        id: 'resource:group',
        label: '组',
        category: 'resource',
        icon: <Icons.Layers size={15} />,
        colorClass: 'canvas-op-color-resource',
        nodeType: 'group',
      },
      {
        id: 'resource:asset',
        label: '从资产选择',
        category: 'resource',
        icon: <Icons.Folder size={15} />,
        colorClass: 'canvas-op-color-resource',
        action: 'insert_asset',
      },
      {
        id: 'resource:history',
        label: '从历史选择',
        category: 'resource',
        icon: <Icons.Clock size={15} />,
        colorClass: 'canvas-op-color-resource',
        action: 'from_history',
      },
      {
        id: 'resource:template',
        label: '从模板创建',
        category: 'resource',
        icon: <Icons.FilePlus size={15} />,
        colorClass: 'canvas-op-color-resource',
        action: 'from_template',
      },
      // 任务节点（AI 操作，由 capabilities 驱动）
      ...taskItems,
    ],
    [taskItems],
  )
}

/** 按 category 分组，供菜单/底栏分组渲染 */
export function groupAddNodeItems(
  items: AddNodeMenuItem[],
): Record<AddNodeMenuCategory, AddNodeMenuItem[]> {
  return {
    resource: items.filter((item) => item.category === 'resource'),
    task: items.filter((item) => item.category === 'task'),
  }
}

function AddNodeMenuGrid({
  items,
  onSelect,
}: {
  items: AddNodeMenuItem[]
  onSelect: (item: AddNodeMenuItem) => void
}) {
  return (
    <div className="canvas-add-node-grid">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`canvas-add-node-item ${item.colorClass ?? ''}`}
          role="menuitem"
          onClick={() => onSelect(item)}
        >
          <span className="canvas-add-node-icon">{item.icon}</span>
          <span className="canvas-add-node-label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 底部工具栏悬浮菜单：鼠标悬停展开该分类下的全部节点类型。
 */
export function CanvasDockAddDropdown({
  label,
  shortLabel,
  icon,
  items,
  onSelect,
}: {
  label: string
  shortLabel?: string
  icon: React.ReactNode
  items: AddNodeMenuItem[]
  onSelect: (item: AddNodeMenuItem) => void
}) {
  return (
    <div className="canvas-dock-add-dropdown">
      <Tooltip title={label} placement="top">
        <Button
          size="middle"
          type="text"
          icon={icon}
          {...(shortLabel ? { className: 'canvas-dock-labeled-action' } : {})}
          aria-label={label}
        >
          {shortLabel}
        </Button>
      </Tooltip>
      <div className="canvas-dock-add-dropdown-panel" role="menu" aria-label={label}>
        <div className="canvas-dock-add-dropdown-title">{label}</div>
        <AddNodeMenuGrid
          items={items}
          onSelect={(item) => {
            onSelect(item)
          }}
        />
      </div>
    </div>
  )
}

/**
 * 节点工厂浮层（全量两类节点）。渲染分组列表。
 */
export function CanvasAddNodeMenu({
  items,
  onSelect,
  onClose,
}: {
  items: AddNodeMenuItem[]
  onSelect: (item: AddNodeMenuItem) => void
  onClose: () => void
}) {
  // ESC 关闭节点工厂菜单
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const grouped = groupAddNodeItems(items)
  const sections: Array<[AddNodeMenuCategory, AddNodeMenuItem[]]> = [
    ['resource', grouped.resource],
    ['task', grouped.task],
  ]

  return (
    <>
      <div className="canvas-add-node-overlay" onClick={onClose} />
      <div className="canvas-add-node-menu" role="menu">
        {sections.map(([category, list]) =>
          list.length === 0 ? null : (
            <div key={category} className="canvas-add-node-section">
              <div className="canvas-add-node-section-title">
                <Tag color="default" bordered>
                  {ADD_NODE_CATEGORY_LABELS[category]}
                </Tag>
              </div>
              <AddNodeMenuGrid
                items={list}
                onSelect={(item) => {
                  onSelect(item)
                  onClose()
                }}
              />
            </div>
          ),
        )}
      </div>
    </>
  )
}
