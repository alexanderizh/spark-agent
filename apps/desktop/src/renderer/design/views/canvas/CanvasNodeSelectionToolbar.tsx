import type { ReactNode } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Popover } from 'antd'
import './CanvasNodeSelectionToolbar.less'

export type CanvasNodeToolbarAction = {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** 自定义 tooltip 文案；缺省时回退 label。 */
  tooltip?: string
}

export type CanvasNodeToolbarEntry =
  | CanvasNodeToolbarAction
  | {
      key: string
      type: 'divider'
    }
  | {
      key: string
      label: string
      icon: ReactNode
      children: CanvasNodeToolbarAction[]
      expanded?: boolean
    }

function isGroupEntry(
  entry: CanvasNodeToolbarEntry,
): entry is Extract<CanvasNodeToolbarEntry, { children: CanvasNodeToolbarAction[] }> {
  return 'children' in entry
}

function isDividerEntry(entry: CanvasNodeToolbarEntry): entry is { key: string; type: 'divider' } {
  return 'type' in entry && entry.type === 'divider'
}

function renderAction(action: CanvasNodeToolbarAction, compact = false) {
  return (
    <Tooltip key={action.key} title={action.tooltip ?? action.label}>
      <Button
        size="middle"
        type="text"
        className={`canvas-node-selection-toolbar-button${action.danger ? ' is-danger' : ''}${compact ? ' is-compact' : ''}`}
        aria-label={action.label}
        icon={action.icon}
        {...(action.disabled ? { disabled: true } : {})}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          action.onClick()
        }}
      />
    </Tooltip>
  )
}

export function CanvasNodeSelectionToolbar({ entries }: { entries: CanvasNodeToolbarEntry[] }) {
  const expandedEntries = entries.flatMap((entry) =>
    isGroupEntry(entry) && entry.expanded ? entry.children : [entry],
  )
  const visibleEntries = expandedEntries.filter(
    (entry) => isDividerEntry(entry) || !isGroupEntry(entry) || entry.children.length > 0,
  )
  if (visibleEntries.length === 0) return null

  return (
    <div
      className="canvas-node-selection-toolbar canvas-node-toolbar-surface nodrag nopan"
      role="toolbar"
      aria-label="节点工具栏"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {visibleEntries.map((entry) => {
        if (isDividerEntry(entry)) {
          return <span key={entry.key} className="canvas-node-selection-toolbar-divider" />
        }
        if (!isGroupEntry(entry)) return renderAction(entry)

        return (
          <Popover
            key={entry.key}
            trigger="click"
            placement="bottom"
            content={
              <div
                className="canvas-node-selection-toolbar-menu"
                role="menu"
                aria-label={entry.label}
              >
                {entry.children.map((action) => renderAction(action, true))}
              </div>
            }
          >
            <Tooltip title={entry.label}>
              <Button
                size="middle"
                type="text"
                className="canvas-node-selection-toolbar-button"
                aria-label={entry.label}
                icon={entry.icon}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
            </Tooltip>
          </Popover>
        )
      })}
    </div>
  )
}
