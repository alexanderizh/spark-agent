/**
 * SidebarFilterMenu — 会话栏全局过滤器
 *
 * 控件位置:第一个项目组 proj-head 右侧操作按钮组
 * 作用:筛选/分组整个会话栏列表
 */
import { useMemo, useState } from 'react'
import { Dropdown } from '@lobehub/ui'
import './SidebarFilterMenu.less'
import { Icons } from './Icons'
import { useI18n } from './i18n'
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

const STATUS_OPTIONS: Array<{ value: SidebarStatusFilter; labelKey: string }> = [
  { value: 'active', labelKey: 'sidebar.filter.status.active' },
  { value: 'archived', labelKey: 'sidebar.filter.status.archived' },
  { value: 'all', labelKey: 'sidebar.filter.all' },
]

const LAST_ACTIVITY_OPTIONS: Array<{ value: SidebarLastActivityFilter; labelKey: string }> = [
  { value: '1d', labelKey: 'sidebar.filter.activity.1d' },
  { value: '3d', labelKey: 'sidebar.filter.activity.3d' },
  { value: '7d', labelKey: 'sidebar.filter.activity.7d' },
  { value: '30d', labelKey: 'sidebar.filter.activity.30d' },
  { value: 'all', labelKey: 'sidebar.filter.all' },
]

const GROUP_BY_OPTIONS: Array<{ value: SidebarGroupBy; labelKey: string }> = [
  { value: 'date', labelKey: 'sidebar.filter.groupBy.date' },
  { value: 'project', labelKey: 'sidebar.filter.groupBy.project' },
  { value: 'state', labelKey: 'sidebar.filter.groupBy.state' },
  { value: 'none', labelKey: 'sidebar.filter.groupBy.none' },
]

const SUBMENU_PLACEMENT = 'rightTop' as unknown as 'topRight'

function getStatusLabelKey(value: SidebarStatusFilter): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.labelKey ?? 'sidebar.filter.all'
}

function getLastActivityLabelKey(value: SidebarLastActivityFilter): string {
  return LAST_ACTIVITY_OPTIONS.find((o) => o.value === value)?.labelKey ?? 'sidebar.filter.all'
}

function getGroupByLabelKey(value: SidebarGroupBy): string {
  return GROUP_BY_OPTIONS.find((o) => o.value === value)?.labelKey ?? 'sidebar.filter.groupBy.none'
}

/* ─── SubMenu — 二级浮层内容(不带 chrome, 由 Dropdown 外层负责) ─── */
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
      {options.map((opt) => {
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
    <Dropdown
      menu={{ items: [] }}
      open={open}
      onOpenChange={setOpen}
      trigger={['hover']}
      placement={SUBMENU_PLACEMENT}
      align={{ offset: [4, 0], overflow: { shiftX: true, adjustY: true } }}
      popupRender={() => children}
    >
      <button type="button" className={`sidebar-filter-row${open ? ' is-open' : ''}`}>
        <span className="sidebar-filter-row-label">{label}</span>
        <span className={`sidebar-filter-row-value${highlighted ? ' is-highlight' : ''}`}>
          {valueLabel}
        </span>
        <Icons.ChevronRight size={12} className="sidebar-filter-row-chev" />
      </button>
    </Dropdown>
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
  const { t } = useI18n()
  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  )
  const lastActivityOptions = useMemo(
    () => LAST_ACTIVITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  )
  const groupByOptions = useMemo(
    () => GROUP_BY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  )

  const projectOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; hint?: string }> = [
      { value: 'all', label: t('sidebar.filter.allProjects') },
    ]
    for (const w of workspaces) {
      const last = w.rootPath?.split(/[/\\]/).filter(Boolean).slice(-1)[0] ?? ''
      const hint = last && last !== w.name ? last : undefined
      const item: { value: string; label: string; hint?: string } = { value: w.id, label: w.name }
      if (hint !== undefined) item.hint = hint
      list.push(item)
    }
    return list
  }, [workspaces, t])

  const projectLabel = useMemo(() => {
    if (state.projectId === 'all') return t('sidebar.filter.all')
    const found = workspaces.find((w) => w.id === state.projectId)
    return found?.name ?? t('sidebar.filter.all')
  }, [state.projectId, workspaces, t])

  const statusHighlight =
    state.status !== DEFAULT_SIDEBAR_FILTER.status || state.status === 'active'
  const projectHighlight = state.projectId !== 'all'
  const lastActivityHighlight = state.lastActivity !== 'all'

  return (
    <div className="sidebar-filter-menu" onClick={(e) => e.stopPropagation()}>
      <FilterRow
        label={t('sidebar.filter.rowStatus')}
        valueLabel={t(getStatusLabelKey(state.status))}
        highlighted={statusHighlight}
      >
        <SubMenu
          options={statusOptions}
          current={state.status}
          onSelect={(value) => onChange({ ...state, status: value })}
        />
      </FilterRow>
      <FilterRow
        label={t('sidebar.filter.rowProject')}
        valueLabel={projectLabel}
        highlighted={projectHighlight}
      >
        <SubMenu
          options={projectOptions}
          current={state.projectId}
          onSelect={(value) => onChange({ ...state, projectId: value })}
        />
      </FilterRow>
      <FilterRow
        label={t('sidebar.filter.rowLastActivity')}
        valueLabel={t(getLastActivityLabelKey(state.lastActivity))}
        highlighted={lastActivityHighlight}
      >
        <SubMenu
          options={lastActivityOptions}
          current={state.lastActivity}
          onSelect={(value) => onChange({ ...state, lastActivity: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <FilterRow
        label={t('sidebar.filter.rowGroupBy')}
        valueLabel={t(getGroupByLabelKey(state.groupBy))}
      >
        <SubMenu
          options={groupByOptions}
          current={state.groupBy}
          onSelect={(value) => onChange({ ...state, groupBy: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <button type="button" className="sidebar-filter-clear" onClick={onClear}>
        {t('sidebar.filter.clearFilters')}
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
  const { t } = useI18n()
  const active = !isDefaultFilter(state)

  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      popupRender={() => (
        <FilterPopupContent
          state={state}
          workspaces={workspaces}
          onChange={onChange}
          onClear={onClear}
        />
      )}
    >
      <button
        type="button"
        className={`icon-btn sidebar-filter-btn${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        title={t('sidebar.filterSessions')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icons.ListFilter size={15} />
        {active && <span className="sidebar-filter-btn-dot" />}
      </button>
    </Dropdown>
  )
}
