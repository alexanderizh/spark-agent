import type { ReactNode } from 'react'
import { Icons } from '../../Icons'
import type { WorkflowNodeKind } from '@spark/protocol'
import { NODE_KIND_META, NODE_KIND_ORDER } from './node-kinds'

export type WfContextMenuState =
  | { kind: 'node'; nodeId: string; left: number; top: number }
  | { kind: 'edge'; edgeId: string; left: number; top: number }
  | { kind: 'pane'; flowX: number; flowY: number; left: number; top: number }

type WorkflowContextMenuProps = {
  menu: WfContextMenuState | null
  onClose: () => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onAddNode: (kind: WorkflowNodeKind, position: { x: number; y: number }) => void
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'wf-context-menu-danger' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function WorkflowContextMenu({
  menu,
  onClose,
  onDuplicateNode,
  onDeleteNode,
  onDeleteEdge,
  onAddNode,
}: WorkflowContextMenuProps) {
  if (menu == null) return null

  const closeAnd = (action: () => void) => {
    action()
    onClose()
  }

  return (
    <div
      className="wf-context-menu"
      style={{ left: menu.left, top: menu.top }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.kind === 'node' && (
        <>
          <MenuItem
            icon={<Icons.Copy size={14} />}
            label="复制节点"
            onClick={() => closeAnd(() => onDuplicateNode(menu.nodeId))}
          />
          <div className="wf-context-menu-divider" role="separator" />
          <MenuItem
            icon={<Icons.Trash size={14} />}
            label="删除节点"
            danger
            onClick={() => closeAnd(() => onDeleteNode(menu.nodeId))}
          />
        </>
      )}
      {menu.kind === 'edge' && (
        <MenuItem
          icon={<Icons.Trash size={14} />}
          label="删除连线"
          danger
          onClick={() => closeAnd(() => onDeleteEdge(menu.edgeId))}
        />
      )}
      {menu.kind === 'pane' && (
        <>
          <div className="wf-context-menu-section">添加节点</div>
          {NODE_KIND_ORDER.map((kind) => {
            const meta = NODE_KIND_META[kind]
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                className="wf-context-menu-node-kind"
                style={{ ['--node-accent' as string]: `var(${meta.accent})` }}
                onClick={() =>
                  closeAnd(() => onAddNode(kind, { x: menu.flowX, y: menu.flowY }))
                }
              >
                <span className="wf-context-menu-icon">{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
