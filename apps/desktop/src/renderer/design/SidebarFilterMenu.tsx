/**
 * SidebarFilterMenu — 会话栏全局过滤器
 *
 * 控件位置:第一个项目组 proj-head 右侧操作按钮组
 * 作用:筛选/分组整个会话栏列表
 */
import { useMemo, useState } from 'react'
import { Dropdown, Tooltip } from '@lobehub/ui'
import { Switch } from 'antd'
import { ListFilter } from 'lucide-react'
import './SidebarFilterMenu.less'
import { Icons } from './Icons'
import { useI18n } from './i18n'
import { getCanvasWorkspaceIds } from './workspace-visibility'
import './session-labels.less'
import {
  SIDEBAR_LABEL_FILTER_OPTIONS,
  getSidebarLabelFilterColorClass,
  type SidebarLabelsFilterValue,
} from './session-labels'
import type { WorkspaceInfo } from '@spark/protocol'

export type SidebarStatusFilter =
  | 'active'
  | 'unread'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'archived'
  | 'all'
/** 状态筛选的具体值（不含「全部」）；筛选状态里的空数组 = 全部状态。 */
export type SidebarStatusFilterValue = Exclude<SidebarStatusFilter, 'all'>
export type SidebarLastActivityFilter = 'today' | '1d' | '3d' | '7d' | '30d' | 'all'
export type SidebarGroupBy = 'date' | 'project' | 'state' | 'none'
export type SidebarScheduledTasksFilter = 'all' | 'attached' | 'none'
export type SidebarCanvasProjectsFilter = 'show' | 'hide'

/** Project filter option for sessions that have no workspace association. */
export const SIDEBAR_UNGROUPED_SESSIONS_FILTER_ID = '__ungrouped_sessions__'

export interface SidebarFilterState {
  /** 状态多选（OR 语义）：空数组 = 全部状态；「已归档」与其余状态可并存。 */
  status: SidebarStatusFilterValue[]
  /** 选中的 workspaceId 集合，可包含未归属会话筛选项；空数组 = 全部项目 */
  projectIds: string[]
  lastActivity: SidebarLastActivityFilter
  scheduledTasks: SidebarScheduledTasksFilter
  canvasProjects: SidebarCanvasProjectsFilter
  groupBy: SidebarGroupBy
  /** 标记多选（OR 语义）：空数组 = 全部标记；「已标记/未标记」可与具体标记并存。 */
  labels: SidebarLabelsFilterValue[]
}

export const DEFAULT_SIDEBAR_FILTER: SidebarFilterState = {
  status: ['active'],
  projectIds: [],
  lastActivity: 'all',
  scheduledTasks: 'all',
  canvasProjects: 'show',
  groupBy: 'project',
  labels: [],
}

/** 多选筛选值是否一致（顺序敏感即可：切换顺序等同重新筛选）。 */
function isSameSelection<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function isDefaultFilter(state: SidebarFilterState): boolean {
  return (
    isSameSelection(state.status, DEFAULT_SIDEBAR_FILTER.status) &&
    state.projectIds.length === 0 &&
    state.lastActivity === DEFAULT_SIDEBAR_FILTER.lastActivity &&
    state.scheduledTasks === DEFAULT_SIDEBAR_FILTER.scheduledTasks &&
    state.canvasProjects === DEFAULT_SIDEBAR_FILTER.canvasProjects &&
    state.groupBy === DEFAULT_SIDEBAR_FILTER.groupBy &&
    state.labels.length === 0
  )
}

/** 清除筛选时保留独立的画布项目显示偏好。 */
export function clearSidebarFilters(state: SidebarFilterState): SidebarFilterState {
  return { ...DEFAULT_SIDEBAR_FILTER, canvasProjects: state.canvasProjects }
}

/**
 * 拖拽排序只被「会改变分组内会话集合」的因素阻断：非项目分组、状态/最近活动/
 * 计划任务/标记筛选与搜索 —— 它们让分组内只剩余部分会话，此时拖拽会把被隐藏会话
 * 挤出手动序。项目筛选与画布项目显隐只决定哪些项目分组可见，不改变分组内的
 * 会话列表，因此不禁用拖拽（隐藏项由合并逻辑保留手动序）。
 */
export function canReorderSidebarSessions(
  filter: SidebarFilterState,
  searchActive: boolean,
): boolean {
  return (
    filter.groupBy === 'project' &&
    isSameSelection(filter.status, DEFAULT_SIDEBAR_FILTER.status) &&
    filter.lastActivity === DEFAULT_SIDEBAR_FILTER.lastActivity &&
    filter.scheduledTasks === DEFAULT_SIDEBAR_FILTER.scheduledTasks &&
    filter.labels.length === 0 &&
    !searchActive
  )
}

const STATUS_OPTIONS: Array<{ value: SidebarStatusFilter; labelKey: string }> = [
  { value: 'active', labelKey: 'sidebar.filter.status.active' },
  // 未读 = 完成后尚未查看（蓝点/Dock 角标来源），方便在大量会话中快速定位
  { value: 'unread', labelKey: 'sidebar.filter.status.unread' },
  { value: 'running', labelKey: 'sidebar.filter.status.running' },
  { value: 'completed', labelKey: 'sidebar.filter.status.completed' },
  { value: 'cancelled', labelKey: 'sidebar.filter.status.cancelled' },
  { value: 'archived', labelKey: 'sidebar.filter.status.archived' },
  { value: 'all', labelKey: 'sidebar.filter.all' },
]

const LAST_ACTIVITY_OPTIONS: Array<{ value: SidebarLastActivityFilter; labelKey: string }> = [
  { value: 'today', labelKey: 'sidebar.filter.activity.today' },
  { value: '1d', labelKey: 'sidebar.filter.activity.1d' },
  { value: '3d', labelKey: 'sidebar.filter.activity.3d' },
  { value: '7d', labelKey: 'sidebar.filter.activity.7d' },
  { value: '30d', labelKey: 'sidebar.filter.activity.30d' },
  { value: 'all', labelKey: 'sidebar.filter.all' },
]

export const SCHEDULED_TASK_FILTER_OPTIONS: Array<{
  value: SidebarScheduledTasksFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'sidebar.filter.all' },
  { value: 'attached', labelKey: 'sidebar.filter.scheduledTasks.attached' },
  { value: 'none', labelKey: 'sidebar.filter.scheduledTasks.none' },
]

const GROUP_BY_OPTIONS: Array<{ value: SidebarGroupBy; labelKey: string }> = [
  { value: 'date', labelKey: 'sidebar.filter.groupBy.date' },
  { value: 'project', labelKey: 'sidebar.filter.groupBy.project' },
  { value: 'state', labelKey: 'sidebar.filter.groupBy.state' },
  { value: 'none', labelKey: 'sidebar.filter.groupBy.none' },
]

const SUBMENU_PLACEMENT = 'rightTop' as unknown as 'topRight'

/** 多选行的行值文案：空选择=「全部」；单选显示该项；多选显示「首个 +N」。 */
function formatMultiSelectRowLabel(labels: readonly string[], allText: string): string {
  const [first, ...rest] = labels
  if (first == null) return allText
  if (rest.length === 0) return first
  return `${first} +${rest.length}`
}

function getOptionLabelKey<T extends string>(
  options: ReadonlyArray<{ value: T; labelKey: string }>,
  value: T,
): string {
  return options.find((option) => option.value === value)?.labelKey ?? options[0]?.labelKey ?? ''
}

/* ─── SubMenu — 二级浮层内容(不带 chrome, 由 Dropdown 外层负责) ─── */
function SubMenu<T extends string>({
  options,
  current,
  onSelect,
}: {
  options: Array<{ value: T; label: string; hint?: string; dotClass?: string | undefined }>
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
              <span className="sidebar-filter-submenu-item-text">
                {opt.dotClass != null && (
                  <span className={`session-label-dot ${opt.dotClass}`} aria-hidden />
                )}
                {opt.label}
              </span>
              {opt.hint && <span className="sidebar-filter-submenu-item-hint">{opt.hint}</span>}
            </span>
            {active && <Icons.Check size={14} className="sidebar-filter-submenu-check" />}
          </button>
        )
      })}
    </div>
  )
}

/* ─── MultiSelectSubMenu — 多选二级浮层（复用 SubMenu 样式；「全部」= 清空选择） ─── */
function MultiSelectSubMenu<T extends string>({
  options,
  selectedValues,
  onClear,
  onToggle,
}: {
  options: Array<{ value: T; label: string; hint?: string; dotClass?: string | undefined }>
  /** 当前选中的具体值集合（不含「全部」；空集合 = 全部）。 */
  selectedValues: ReadonlySet<T>
  onClear: () => void
  onToggle: (value: Exclude<T, 'all'>) => void
}) {
  return (
    <div className="sidebar-filter-submenu">
      {options.map((opt) => {
        const isAllOption = opt.value === ('all' as T)
        const active = isAllOption
          ? selectedValues.size === 0
          : selectedValues.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            className={`sidebar-filter-submenu-item${active ? ' is-active' : ''}`}
            // 「全部」选项已在此分支前被 isAllOption 拦截，这里只会收到具体值
            onClick={() => (isAllOption ? onClear() : onToggle(opt.value as Exclude<T, 'all'>))}
          >
            <span className="sidebar-filter-submenu-item-label">
              <span className="sidebar-filter-submenu-item-text">
                {opt.dotClass != null && (
                  <span className={`session-label-dot ${opt.dotClass}`} aria-hidden />
                )}
                {opt.label}
              </span>
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
  const scheduledTaskOptions = useMemo(
    () =>
      SCHEDULED_TASK_FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  )
  const labelOptions = useMemo(
    () =>
      SIDEBAR_LABEL_FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
        // 具体标记带状态色点，与右键二级菜单共用同一套色板
        dotClass: getSidebarLabelFilterColorClass(option.value),
      })),
    [t],
  )
  const projectOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; hint?: string }> = [
      { value: 'all', label: t('sidebar.filter.allProjects') },
      {
        value: SIDEBAR_UNGROUPED_SESSIONS_FILTER_ID,
        label: t('sidebar.ungroupedChats'),
      },
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

  // 行值文案：空选择=「全部」；单选显示项目名；多选显示「首个 +N」（悬停子菜单可见完整勾选）。
  const projectLabel = useMemo(() => {
    const names = state.projectIds.map((id) =>
      id === SIDEBAR_UNGROUPED_SESSIONS_FILTER_ID
        ? t('sidebar.ungroupedChats')
        : (workspaces.find((w) => w.id === id)?.name ?? id),
    )
    return formatMultiSelectRowLabel(names, t('sidebar.filter.all'))
  }, [state.projectIds, workspaces, t])
  const selectedProjectIdSet = useMemo(() => new Set(state.projectIds), [state.projectIds])
  const selectedStatusLabelSet = useMemo(() => new Set(state.status), [state.status])
  const selectedLabelSet = useMemo(() => new Set(state.labels), [state.labels])
  const toggleProject = (workspaceId: string) => {
    onChange({
      ...state,
      projectIds: state.projectIds.includes(workspaceId)
        ? state.projectIds.filter((id) => id !== workspaceId)
        : [...state.projectIds, workspaceId],
    })
  }
  const toggleStatus = (value: SidebarStatusFilterValue) => {
    // 默认「活跃」是初始基线而非用户显式勾选，且「活跃」(未归档) 在谓词上包含其余
    // 状态——直接追加会让点选空转（列表不变）。因此从默认基线点选视为切换
    // （对齐旧单选交互的肌肉记忆），用户显式改动过选择后恢复纯追加/取消。
    const fromDefault = isSameSelection(state.status, DEFAULT_SIDEBAR_FILTER.status)
    const next =
      fromDefault && value !== 'active'
        ? [value]
        : state.status.includes(value)
          ? state.status.filter((item) => item !== value)
          : [...state.status, value]
    onChange({ ...state, status: next })
  }
  const toggleLabel = (value: SidebarLabelsFilterValue) => {
    onChange({
      ...state,
      labels: state.labels.includes(value)
        ? state.labels.filter((item) => item !== value)
        : [...state.labels, value],
    })
  }

  const setCanvasProjectsVisibility = (show: boolean) => {
    const value: SidebarCanvasProjectsFilter = show ? 'show' : 'hide'
    // 隐藏画布项目时，把选中集合里的画布项目剔除；其余选择保留。
    const canvasWorkspaceIds = show ? null : getCanvasWorkspaceIds(workspaces)
    onChange({
      ...state,
      canvasProjects: value,
      projectIds:
        canvasWorkspaceIds != null
          ? state.projectIds.filter((id) => !canvasWorkspaceIds.has(id))
          : state.projectIds,
    })
  }

  // 状态默认即「活跃」筛选，保持与其他已选状态一致的高亮；清空成「全部」才熄灭。
  const statusHighlight = state.status.length > 0
  const projectHighlight = state.projectIds.length > 0
  const lastActivityHighlight = state.lastActivity !== 'all'
  const scheduledTasksHighlight = state.scheduledTasks !== 'all'
  const labelsHighlight = state.labels.length > 0

  return (
    <div className="sidebar-filter-menu" onClick={(e) => e.stopPropagation()}>
      <FilterRow
        label={t('sidebar.filter.rowStatus')}
        valueLabel={formatMultiSelectRowLabel(
          state.status.map((value) =>
            t(getOptionLabelKey(STATUS_OPTIONS, value)),
          ),
          t('sidebar.filter.all'),
        )}
        highlighted={statusHighlight}
      >
        <MultiSelectSubMenu
          options={statusOptions}
          selectedValues={selectedStatusLabelSet}
          onClear={() => onChange({ ...state, status: [] })}
          onToggle={toggleStatus}
        />
      </FilterRow>
      <FilterRow
        label={t('sidebar.filter.rowProject')}
        valueLabel={projectLabel}
        highlighted={projectHighlight}
      >
        <MultiSelectSubMenu
          options={projectOptions}
          selectedValues={selectedProjectIdSet}
          onClear={() => onChange({ ...state, projectIds: [] })}
          onToggle={toggleProject}
        />
      </FilterRow>
      <FilterRow
        label={t('sidebar.filter.rowLastActivity')}
        valueLabel={t(getOptionLabelKey(LAST_ACTIVITY_OPTIONS, state.lastActivity))}
        highlighted={lastActivityHighlight}
      >
        <SubMenu
          options={lastActivityOptions}
          current={state.lastActivity}
          onSelect={(value) => onChange({ ...state, lastActivity: value })}
        />
      </FilterRow>
      <FilterRow
        label={t('sidebar.filter.rowScheduledTasks')}
        valueLabel={t(getOptionLabelKey(SCHEDULED_TASK_FILTER_OPTIONS, state.scheduledTasks))}
        highlighted={scheduledTasksHighlight}
      >
        <SubMenu
          options={scheduledTaskOptions}
          current={state.scheduledTasks}
          onSelect={(value) => onChange({ ...state, scheduledTasks: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <FilterRow
        label={t('sidebar.filter.rowLabels')}
        valueLabel={formatMultiSelectRowLabel(
          state.labels.map((value) => t(getOptionLabelKey(SIDEBAR_LABEL_FILTER_OPTIONS, value))),
          t('sidebar.filter.all'),
        )}
        highlighted={labelsHighlight}
      >
        <MultiSelectSubMenu
          options={labelOptions}
          selectedValues={selectedLabelSet}
          onClear={() => onChange({ ...state, labels: [] })}
          onToggle={toggleLabel}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <FilterRow
        label={t('sidebar.filter.rowGroupBy')}
        valueLabel={t(getOptionLabelKey(GROUP_BY_OPTIONS, state.groupBy))}
      >
        <SubMenu
          options={groupByOptions}
          current={state.groupBy}
          onSelect={(value) => onChange({ ...state, groupBy: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <div className="sidebar-filter-setting">
        <span className="sidebar-filter-setting-label">
          {t('sidebar.filter.rowCanvasProjects')}
        </span>
        <Switch
          size="small"
          checked={state.canvasProjects === 'show'}
          onChange={setCanvasProjectsVisibility}
          aria-label={t('sidebar.filter.rowCanvasProjects')}
        />
      </div>
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
      <Tooltip title={t('sidebar.filterSessions')} mouseEnterDelay={0.05}>
        <button
          type="button"
          className={`icon-btn sidebar-filter-btn${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}
          aria-label={t('sidebar.filterSessions')}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ListFilter size={16} />
          {active && <span className="sidebar-filter-btn-dot" />}
        </button>
      </Tooltip>
    </Dropdown>
  )
}
