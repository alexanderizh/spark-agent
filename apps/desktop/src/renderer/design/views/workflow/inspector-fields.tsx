import type { ReactNode } from 'react'
import { Icons } from '../../Icons'

/**
 * 工作流检查器的通用字段容器与标签选择器。
 * 从 WorkflowView.tsx 拆出（D-工作流工具节点配置面板），供 WorkflowInspector 与
 * WorkflowToolConfigPanel 共用，避免面板组件反向依赖 WorkflowView 造成循环引用。
 *
 * 样式沿用 AgentsView 的 .agent-field / .tool-chip 写法，视觉与检查器其它字段一致。
 */

export function InspectorField({ label, children }: { label: string; children: ReactNode }) {
  // 不用 <label> 包 children：label 元素会拦截内部 click，
  // 在 select / popover 等控件里会导致下拉"点不出来"。
  // 复用 AgentsView 的 .agent-field 写法 —— lobe-ui (antd-based) 控件
  // 自带 variant 样式，宽度由 .agent-field .ant-* 规则兜底为 100%。
  return (
    <div className="agent-field">
      <span className="agent-field-label">{label}</span>
      {children}
    </div>
  )
}

export function TagPicker({
  items,
  selected,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const selectedSet = new Set(selected)
  if (items.length === 0) return <div className="agents-empty-mini">暂无可选项</div>
  return (
    <div className="wf-tools-row">
      {items.map((item) => {
        const active = selectedSet.has(item.id)
        return (
          <button
            key={item.id}
            className={`tool-chip ${active ? 'active' : ''}`}
            onClick={() =>
              onChange(active ? selected.filter((id) => id !== item.id) : [...selected, item.id])
            }
          >
            {active && <Icons.Check size={11} />} {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
