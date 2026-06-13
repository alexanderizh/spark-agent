/**
 * SidebarFilterMenu — 会话栏全局过滤器
 *
 * 控件位置:第一个项目组 proj-head 右侧操作按钮组
 * 作用:筛选/分组整个会话栏列表
 */
import { useMemo, useState } from 'react'
import { Trigger } from '@arco-design/web-react'
import './SidebarFilterMenu.less'
import { Icons } from './Icons'
import type { WorkspaceInfo } from '@spark/protocol'

export type SidebarStatusFilter = 'active' | 'archived' | 'all'
export type SidebarLastActivityFilter = '1d' | '3d' | '7d' | '30d' | 'all'
export type SidebarGroupBy = 'date' | 'project' | 'state' | 'none'

export interface SidebarFilterState {
  status: SidebarStatusFilter
  /** workspaceId 或 'all' */
  projectId: string
  lastActivity: SidebarLastActivityFilter
  groupBy: SidebarGroupBy
}

export const DEFAULT_SIDEBAR_FILTER: SidebarFilterState = {
  status: 'active',
  projectId: 'all',
  lastActivity: 'all',
  groupBy: 'project',
}

export function isDefaultFilter(state: SidebarFilterState): boolean {
  return (
    state.status === DEFAULT_SIDEBAR_FILTER.status &&
    state.projectId === DEFAULT_SIDEBAR_FILTER.projectId &&
    state.lastActivity === DEFAULT_SIDEBAR_FILTER.lastActivity &&
    state.groupBy === DEFAULT_SIDEBAR_FILTER.groupBy
  )
}

const STATUS_OPTIONS: Array<{ value: SidebarStatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

const LAST_ACTIVITY_OPTIONS: Array<{ value: SidebarLastActivityFilter; label: string }> = [
  { value: '1d', label: '1d' },
  { value: '3d', label: '3d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]

const GROUP_BY_OPTIONS: Array<{ value: SidebarGroupBy; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'project', label: 'Project' },
  { value: 'state', label: 'State' },
  { value: 'none', label: 'None' },
]

function getStatusLabel(value: SidebarStatusFilter): string {
  return STATUS_OPTIONS.find(o => o.value === value)?.label ?? value
}

function getLastActivityLabel(value: SidebarLastActivityFilter): string {
  return LAST_ACTIVITY_OPTIONS.find(o => o.value === value)?.label ?? value
}

function getGroupByLabel(value: SidebarGroupBy): string {
  return GROUP_BY_OPTIONS.find(o => o.value === value)?.label ?? value
}

/* ─── SubMenu — 二级浮层 ─── */
function SubMenu<T extends string>({
  options,
  current,
  onSelect,
}: {
  options: Array<{ value: T; label: string; hint?: string }>
  current: T | null
  onSelect: (value: T) => void
}) {
  return (
    <div className="sidebar-filter-submenu">
      {options.map(opt => {
        const active = opt.value === current
        return (
          <button
            key={opt.value}
            type="button"
            className={`sidebar-filter-submenu-item${active ? ' is-active' : ''}`}
            onClick={() => onSelect(opt.value)}
          >
            <span className="sidebar-filter-submenu-item-label">
              <span className="sidebar-filter-submenu-item-text">{opt.label}</span>
              {opt.hint && <span className="sidebar-filter-submenu-item-hint">{opt.hint}</span>}
            </span>
            {active && <Icons.Check size={14} className="sidebar-filter-submenu-check" />}
          </button>
        )
      })}
    </div>
  )
}

/* ─── 行 — 一级菜单条目带二级 Trigger ─── */
function FilterRow({
  label,
  valueLabel,
  highlighted,
  children,
}: {
  label: string
  valueLabel: string
  highlighted?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Trigger
      popup={() => <>{children}</>}
      trigger="hover"
      position="rt"
      mouseEnterDelay={50}
      mouseLeaveDelay={150}
      popupAlign={{ left: 4 }}
      popupVisible={open}
      onVisibleChange={setOpen}
      classNames="sidebar-filter-sub-trigger"
    >
      <button
        type="button"
        className={`sidebar-filter-row${open ? ' is-open' : ''}`}
      >
        <span className="sidebar-filter-row-label">{label}</span>
        <span className={`sidebar-filter-row-value${highlighted ? ' is-highlight' : ''}`}>{valueLabel}</span>
        <Icons.ChevronRight size={12} className="sidebar-filter-row-chev" />
      </button>
    </Trigger>
  )
}

/* ─── 主弹层内容 ─── */
function FilterPopupContent({
  state,
  workspaces,
  onChange,
  onClear,
}: {
  state: SidebarFilterState
  workspaces: WorkspaceInfo[]
  onChange: (next: SidebarFilterState) => void
  onClear: () => void
}) {
  const projectOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; hint?: string }> = [
      { value: 'all', label: 'All projects' },
    ]
    for (const w of workspaces) {
      const last = w.rootPath?.split(/[/\\]/).filter(Boolean).slice(-1)[0] ?? ''
      const hint = last && last !== w.name ? last : undefined
      const item: { value: string; label: string; hint?: string } = { value: w.id, label: w.name }
      if (hint !== undefined) item.hint = hint
      list.push(item)
    }
    return list
  }, [workspaces])

  const projectLabel = useMemo(() => {
    if (state.projectId === 'all') return 'All'
    const found = workspaces.find(w => w.id === state.projectId)
    return found?.name ?? 'All'
  }, [state.projectId, workspaces])

  const statusHighlight = state.status !== DEFAULT_SIDEBAR_FILTER.status || state.status === 'active'
  const projectHighlight = state.projectId !== 'all'
  const lastActivityHighlight = state.lastActivity !== 'all'

  return (
    <div className="sidebar-filter-menu" onClick={e => e.stopPropagation()}>
      <FilterRow
        label="Status"
        valueLabel={getStatusLabel(state.status)}
        highlighted={statusHighlight}
      >
        <SubMenu
          options={STATUS_OPTIONS}
          current={state.status}
          onSelect={(value) => onChange({ ...state, status: value })}
        />
      </FilterRow>
      <FilterRow
        label="Project"
        valueLabel={projectLabel === 'All' ? 'All' : projectLabel}
        highlighted={projectHighlight}
      >
        <SubMenu
          options={projectOptions}
          current={state.projectId}
          onSelect={(value) => onChange({ ...state, projectId: value })}
        />
      </FilterRow>
      <FilterRow
        label="Last activity"
        valueLabel={getLastActivityLabel(state.lastActivity)}
        highlighted={lastActivityHighlight}
      >
        <SubMenu
          options={LAST_ACTIVITY_OPTIONS}
          current={state.lastActivity}
          onSelect={(value) => onChange({ ...state, lastActivity: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <FilterRow
        label="Group by"
        valueLabel={getGroupByLabel(state.groupBy)}
      >
        <SubMenu
          options={GROUP_BY_OPTIONS}
          current={state.groupBy}
          onSelect={(value) => onChange({ ...state, groupBy: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <button
        type="button"
        className="sidebar-filter-clear"
        onClick={onClear}
      >
        Clear filters
      </button>
    </div>
  )
}

/* ─── 公开组件 — 触发器 + 弹层 ─── */
export function SidebarFilterMenu({
  state,
  workspaces,
  onChange,
  onClear,
}: {
  state: SidebarFilterState
  workspaces: WorkspaceInfo[]
  onChange: (next: SidebarFilterState) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const active = !isDefaultFilter(state)

  return (
    <Trigger
      popup={() => (
        <FilterPopupContent
          state={state}
          workspaces={workspaces}
          onChange={onChange}
          onClear={onClear}
        />
      )}
      trigger="click"
      position="br"
      popupAlign={{ top: 4 }}
      popupVisible={open}
      onVisibleChange={setOpen}
      classNames="sidebar-filter-trigger"
    >
      <button
        type="button"
        className={`icon-btn sidebar-filter-btn${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        title="筛选会话"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <Icons.Sliders size={13} />
        {active && <span className="sidebar-filter-btn-dot" />}
      </button>
    </Trigger>
  )
}
