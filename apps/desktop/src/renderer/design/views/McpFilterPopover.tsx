/**
 * McpFilterPopover — 连接器与 MCP 列表的筛选弹窗选择器
 *
 * 设计要点
 * ────────
 * - 取代旧的「状态 chip + 作用域 segmented」两行平铺筛选器，改为点击按钮弹出 Popover 选择。
 * - 集中持有筛选相关的常量与类型（StatusFilter / STATUS_OPTIONS / SCOPES），供 McpView 复用。
 * - 状态/作用域的点击即时应用并保持弹层打开，便于连续调整；底部提供「重置」。
 * - 触发按钮根据生效条件数显示徽标与摘要文案，无筛选时回归普通态。
 */
import { useState } from 'react'
import { Button } from '@lobehub/ui'
import { Popover } from 'antd'
import { Icons } from '../Icons'

export type StatusFilter = 'all' | 'ok' | 'warn' | 'err' | 'off'

export const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '在线' },
  { value: 'warn', label: '需注意' },
  { value: 'err', label: '错误' },
  { value: 'off', label: '未启用' },
]

export const SCOPES = ['system', 'user', 'project', 'team', 'session'] as const

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

interface McpFilterPopoverProps {
  statusFilter: StatusFilter
  scopeFilter: string
  statusCounts: Record<StatusFilter, number>
  onStatusChange: (value: StatusFilter) => void
  onScopeChange: (value: string) => void
  onReset: () => void
}

export function McpFilterPopover({
  statusFilter,
  scopeFilter,
  statusCounts,
  onStatusChange,
  onScopeChange,
  onReset,
}: McpFilterPopoverProps) {
  const [open, setOpen] = useState(false)

  const statusActive = statusFilter !== 'all'
  const scopeActive = scopeFilter !== 'all'
  const activeCount = (statusActive ? 1 : 0) + (scopeActive ? 1 : 0)

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label
  const scopeLabel = scopeFilter === 'all' ? null : capitalize(scopeFilter)
  const buttonLabel =
    activeCount === 0
      ? '筛选'
      : activeCount === 1
        ? `筛选：${statusLabel ?? scopeLabel ?? ''}`
        : `筛选 · ${activeCount}`

  const handleReset = () => {
    onReset()
  }

  const content = (
    <div className="mv_filter_popover">
      <div className="mv_filter_section">
        <div className="mv_filter_section_title">状态</div>
        <div className="mv_filter_options">
          {STATUS_OPTIONS.map((option) => {
            const active = statusFilter === option.value
            return (
              <Button
                key={option.value}
                type="text" size="small"
                className={`mv_filter_option ${active ? 'mv_filter_option_active' : ''}`}
                onClick={() => onStatusChange(option.value)}
              >
                <span className="mv_filter_option_dot" />
                <span className="mv_filter_option_label">{option.label}</span>
                <span className="mv_filter_count">{statusCounts[option.value]}</span>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="mv_filter_section">
        <div className="mv_filter_section_title">作用域</div>
        <div className="mv_filter_options">
          <Button
            type="text" size="small"
            className={`mv_filter_option ${scopeFilter === 'all' ? 'mv_filter_option_active' : ''}`}
            onClick={() => onScopeChange('all')}
          >
            <span className="mv_filter_option_label">全部</span>
          </Button>
          {SCOPES.map((scope) => {
            const active = scopeFilter === scope
            return (
              <Button
                key={scope}
                type="text" size="small"
                className={`mv_filter_option ${active ? 'mv_filter_option_active' : ''}`}
                onClick={() => onScopeChange(scope)}
              >
                <span className="mv_filter_option_label">{capitalize(scope)}</span>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="mv_filter_footer">
        <Button type="text" size="small" disabled={activeCount === 0} onClick={handleReset}>
          重置
        </Button>
      </div>
    </div>
  )

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={setOpen}
    >
      <Button
        size="small"
        icon={<Icons.Filter size={12} />}
        className={`mv_filter_btn ${activeCount > 0 ? 'mv_filter_btn_active' : ''}`}
      >
        <span>{buttonLabel}</span>
        {activeCount > 0 && <span className="mv_filter_badge">{activeCount}</span>}
      </Button>
    </Popover>
  )
}
