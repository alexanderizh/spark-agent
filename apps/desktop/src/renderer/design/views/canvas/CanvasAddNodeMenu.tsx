import { useMemo } from 'react'
import { Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { CANVAS_CAPABILITIES } from './canvas.capabilities'
import { getOperationVisual } from './canvasOperationIcons'
import type {
  CanvasNodeData,
  CanvasOperationType,
} from './canvas.types'

/**
 * 添加节点「节点工厂」菜单（文档 §7.7）。
 *
 * 把创建入口分成三类：内容节点 / AI 工作节点 / 资源入口节点。
 * 第一阶段不新增底层 node type：AI 工作节点仍是 task+operation；
 * 脚本映射到 text+subtype；资源入口是动作而非持久节点（通过 onAction 触发）。
 */
export type AddNodeMenuItem = {
  id: string
  label: string
  category: 'content' | 'task' | 'resource'
  icon: React.ReactNode
  /** 类型语义色 class，用于按钮配色（image/text/audio/video） */
  colorClass?: string
  /** 内容节点：给出 type + data；资源入口：onAction；AI：onOperation */
  nodeType?: 'text' | 'prompt' | 'image' | 'video' | 'audio' | 'group'
  data?: CanvasNodeData
  operation?: CanvasOperationType
  action?: 'upload_image' | 'insert_asset' | 'from_history' | 'from_template'
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
      // 内容节点
      { id: 'content:text', label: '文本', category: 'content', icon: <Icons.FileText size={15} />, colorClass: 'canvas-op-color-text', nodeType: 'text', data: { text: '', format: 'plain', origin: 'manual' } },
      { id: 'content:prompt', label: 'Prompt', category: 'content', icon: <Icons.Wand size={15} />, colorClass: 'canvas-op-color-text', nodeType: 'prompt', data: { text: '', format: 'prompt', origin: 'manual' } },
      { id: 'content:image', label: '图片', category: 'content', icon: <Icons.Image size={15} />, colorClass: 'canvas-op-color-image', action: 'upload_image' },
      { id: 'content:group', label: '组', category: 'content', icon: <Icons.Layers size={15} />, colorClass: 'canvas-op-color-resource', nodeType: 'group' },
      // AI 工作节点（由 capabilities 驱动，仍是 task+operation）
      ...taskItems,
      // 资源入口节点（菜单动作，不是持久 node type）
      { id: 'resource:asset', label: '从资产选择', category: 'resource', icon: <Icons.Folder size={15} />, colorClass: 'canvas-op-color-resource', action: 'insert_asset' },
      { id: 'resource:history', label: '从历史选择', category: 'resource', icon: <Icons.Clock size={15} />, colorClass: 'canvas-op-color-resource', action: 'from_history' },
      { id: 'resource:template', label: '从模板创建', category: 'resource', icon: <Icons.FilePlus size={15} />, colorClass: 'canvas-op-color-resource', action: 'from_template' },
    ],
    [taskItems],
  )
}

/** 按 category 分组，供菜单/底栏分组渲染 */
export function groupAddNodeItems(items: AddNodeMenuItem[]): {
  content: AddNodeMenuItem[]
  task: AddNodeMenuItem[]
  resource: AddNodeMenuItem[]
} {
  return {
    content: items.filter((item) => item.category === 'content'),
    task: items.filter((item) => item.category === 'task'),
    resource: items.filter((item) => item.category === 'resource'),
  }
}

/**
 * 节点工厂浮层（从底部栏「添加」按钮触发）。渲染分组列表。
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
  const grouped = groupAddNodeItems(items)
  const categoryLabel: Record<AddNodeMenuItem['category'], string> = {
    content: '内容节点',
    task: 'AI 工作节点',
    resource: '资源入口',
  }
  const sections: Array<[AddNodeMenuItem['category'], AddNodeMenuItem[]]> = [
    ['content', grouped.content],
    ['task', grouped.task],
    ['resource', grouped.resource],
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
                  {categoryLabel[category]}
                </Tag>
              </div>
              <div className="canvas-add-node-grid">
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`canvas-add-node-item ${item.colorClass ?? ''}`}
                    role="menuitem"
                    onClick={() => {
                      onSelect(item)
                      onClose()
                    }}
                  >
                    <span className="canvas-add-node-icon">{item.icon}</span>
                    <span className="canvas-add-node-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </>
  )
}
