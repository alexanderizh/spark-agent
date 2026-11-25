/**
 * 远程侧栏的筛选浮层 —— 与桌面端侧栏 SidebarFilterMenu 同构的「行式」设计。
 *
 * 每个筛选维度默认收起为一行（行尾显示当前值，启用时高亮），悬停才从右侧展开
 * 二级子菜单勾选；「只看置顶」是开关行，底部「清除全部」。样式直接复用
 * SidebarFilterMenu.less / session-labels.less，不另造一套视觉。
 *
 * 维度与语义沿用 remoteSessionFilters：状态 / 标记 / 项目（多选 OR，空 = 全部）、
 * 最近活动（单选）、只看置顶（开关）。只有项目维度能在树上就地生效；状态/标记/
 * 活动/置顶一开，宿主会切到「结果视图」全量拉一遍再过滤（会话树是懒加载的，
 * 未展开的项目没有会话行可筛）。
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Switch } from 'antd'
// 行式筛选器的视觉与本地侧栏完全一致：直接复用同一份样式与标记色板
import '../../SidebarFilterMenu.less'
import '../../session-labels.less'
import { Icons } from '../../Icons'
import { getSidebarLabelFilterColorClass } from '../../session-labels'
import {
  REMOTE_ACTIVITY_FILTER_OPTIONS,
  REMOTE_STATUS_FILTER_OPTIONS,
  countActiveFilterFacets,
  isRemoteFilterActive,
  toggleFilterValue,
  type RemoteActivityFilter,
  type RemoteLabelFilter,
  type RemoteSessionFilter,
  type RemoteStatusFilter,
} from './remoteSessionFilters'
import { REMOTE_SESSION_LABELS, sessionLabelText } from './remoteSessionLabels'
import type { RemoteProjectRow } from './remoteSessionStore'

/** 二级子菜单与一级弹层的相对定位（与本地 SidebarFilterMenu 相同的 placement 值） */
const SUBMENU_PLACEMENT = 'rightTop' as unknown as 'topRight'

interface SubMenuOption<T extends string> {
  value: T
  label: string
  hint?: string
  /** 标记色点 class（仅标记维度的具体标记有） */
  dotClass?: string | undefined
}

/** 多选行的行值文案：空选择=「全部」；单选显示该项；多选显示「首个 +N」。 */
function formatMultiSelectRowLabel(labels: readonly string[], allText: string): string {
  const [first, ...rest] = labels
  if (first == null) return allText
  if (rest.length === 0) return first
  return `${first} +${rest.length}`
}

/* ─── SubMenu — 单选二级浮层内容（不带 chrome，由 Dropdown 外层负责） ─── */
function SubMenu<T extends string>({
  options,
  current,
  onSelect,
}: {
  options: ReadonlyArray<SubMenuOption<T>>
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

/* ─── MultiSelectSubMenu — 多选二级浮层；首项「全部」= 清空该维度选择 ───
 * 「全部」不进 options：真实值是字面量联合类型，哨兵混进去要么类型撒谎、
 * 要么与真实 id 撞车，单独渲染首项两边都干净。 */
function MultiSelectSubMenu<T extends string>({
  allLabel,
  options,
  selectedValues,
  onClear,
  onToggle,
}: {
  allLabel: string
  options: ReadonlyArray<SubMenuOption<T>>
  selectedValues: ReadonlySet<T>
  onClear: () => void
  onToggle: (value: T) => void
}) {
  const allActive = selectedValues.size === 0
  return (
    <div className="sidebar-filter-submenu">
      <button
        type="button"
        className={`sidebar-filter-submenu-item${allActive ? ' is-active' : ''}`}
        onClick={onClear}
      >
        <span className="sidebar-filter-submenu-item-label">
          <span className="sidebar-filter-submenu-item-text">{allLabel}</span>
        </span>
        {allActive && <Icons.Check size={14} className="sidebar-filter-submenu-check" />}
      </button>
      {options.map((opt) => {
        const active = selectedValues.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            className={`sidebar-filter-submenu-item${active ? ' is-active' : ''}`}
            onClick={() => onToggle(opt.value)}
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

/* ─── 行 — 一级菜单条目，悬停展开二级 Trigger ─── */
function FilterRow({
  label,
  valueLabel,
  highlighted,
  children,
}: {
  label: string
  valueLabel: string
  highlighted?: boolean
  children: ReactNode
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
  filter,
  projects,
  onChange,
  onClear,
}: {
  filter: RemoteSessionFilter
  projects: RemoteProjectRow[]
  onChange: (next: RemoteSessionFilter) => void
  onClear: () => void
}) {
  const statusOptions = useMemo<ReadonlyArray<SubMenuOption<RemoteStatusFilter>>>(
    () =>
      REMOTE_STATUS_FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  )
  const activityOptions = useMemo<ReadonlyArray<SubMenuOption<RemoteActivityFilter>>>(
    () =>
      REMOTE_ACTIVITY_FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  )
  const labelOptions = useMemo<ReadonlyArray<SubMenuOption<RemoteLabelFilter>>>(
    () => [
      { value: 'unlabeled', label: '未标记' },
      ...REMOTE_SESSION_LABELS.map((meta) => ({
        value: meta.key,
        label: meta.label,
        // 具体标记带状态色点，与本地侧栏筛选器共用同一套色板
        dotClass: getSidebarLabelFilterColorClass(meta.key),
      })),
    ],
    [],
  )
  const projectOptions = useMemo<ReadonlyArray<SubMenuOption<string>>>(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  )

  const statusLabelByValue = useMemo(
    () => new Map(REMOTE_STATUS_FILTER_OPTIONS.map((option) => [option.value, option.label])),
    [],
  )
  const activityLabelByValue = useMemo(
    () => new Map(REMOTE_ACTIVITY_FILTER_OPTIONS.map((option) => [option.value, option.label])),
    [],
  )
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )

  const toggleProject = (projectId: string) => {
    onChange({ ...filter, projectIds: toggleFilterValue(filter.projectIds, projectId) })
  }
  const toggleStatus = (value: RemoteStatusFilter) => {
    onChange({ ...filter, statuses: toggleFilterValue(filter.statuses, value) })
  }
  const toggleLabel = (value: RemoteLabelFilter) => {
    onChange({ ...filter, labels: toggleFilterValue(filter.labels, value) })
  }

  // 行值文案：空选择=「全部」；多选显示「首个 +N」（悬停子菜单可见完整勾选）
  const statusValueLabel = formatMultiSelectRowLabel(
    filter.statuses.map((value) => statusLabelByValue.get(value) ?? value),
    '全部',
  )
  const projectValueLabel = formatMultiSelectRowLabel(
    filter.projectIds.map((id) => projectNameById.get(id) ?? id),
    '全部项目',
  )
  const labelValueLabel = formatMultiSelectRowLabel(
    filter.labels.map((value) =>
      value === 'unlabeled' ? '未标记' : (sessionLabelText(value) ?? value),
    ),
    '全部',
  )

  // 有选择就保持高亮，清空成全部才熄灭（与本地侧栏一致）
  const statusHighlight = filter.statuses.length > 0
  const projectHighlight = filter.projectIds.length > 0
  const activityHighlight = filter.activity !== 'all'
  const labelsHighlight = filter.labels.length > 0

  return (
    <>
      <FilterRow label="状态" valueLabel={statusValueLabel} highlighted={statusHighlight}>
        <MultiSelectSubMenu
          allLabel="全部"
          options={statusOptions}
          selectedValues={new Set(filter.statuses)}
          onClear={() => onChange({ ...filter, statuses: [] })}
          onToggle={toggleStatus}
        />
      </FilterRow>
      <FilterRow label="项目" valueLabel={projectValueLabel} highlighted={projectHighlight}>
        <MultiSelectSubMenu
          allLabel="全部项目"
          options={projectOptions}
          selectedValues={new Set(filter.projectIds)}
          onClear={() => onChange({ ...filter, projectIds: [] })}
          onToggle={toggleProject}
        />
      </FilterRow>
      <FilterRow
        label="最近活动"
        valueLabel={activityLabelByValue.get(filter.activity) ?? filter.activity}
        highlighted={activityHighlight}
      >
        <SubMenu
          options={activityOptions}
          current={filter.activity}
          onSelect={(value) => onChange({ ...filter, activity: value })}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <FilterRow label="标记" valueLabel={labelValueLabel} highlighted={labelsHighlight}>
        <MultiSelectSubMenu
          allLabel="全部"
          options={labelOptions}
          selectedValues={new Set(filter.labels)}
          onClear={() => onChange({ ...filter, labels: [] })}
          onToggle={toggleLabel}
        />
      </FilterRow>
      <div className="sidebar-filter-divider" />
      <div className="sidebar-filter-setting">
        <span className="sidebar-filter-setting-label">只看置顶</span>
        <Switch
          size="small"
          checked={filter.pinnedOnly}
          onChange={(checked) => onChange({ ...filter, pinnedOnly: checked })}
          aria-label="只看置顶"
        />
      </div>
      <div className="sidebar-filter-divider" />
      <button
        type="button"
        className="sidebar-filter-clear"
        onClick={onClear}
        disabled={!isRemoteFilterActive(filter)}
      >
        清除全部
      </button>
    </>
  )
}

export interface RemoteSessionFilterMenuProps {
  filter: RemoteSessionFilter
  onChange: (next: RemoteSessionFilter) => void
  /** 项目行（含「未归属」虚拟行），用于「只看这些项目」 */
  projects: RemoteProjectRow[]
  /** 清除全部筛选 */
  onClear: () => void
}

export function RemoteSessionFilterMenu({
  filter,
  onChange,
  projects,
  onClear,
}: RemoteSessionFilterMenuProps) {
  const [open, setOpen] = useState(false)
  const activeCount = countActiveFilterFacets(filter)

  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      popupRender={() => (
        <div className="sidebar-filter-menu" onClick={(event) => event.stopPropagation()}>
          <FilterPopupContent
            filter={filter}
            projects={projects}
            onChange={onChange}
            onClear={onClear}
          />
        </div>
      )}
    >
      <button
        type="button"
        className={`rc-icon-btn${activeCount > 0 ? ' is-active' : ''}`}
        onClick={(event) => event.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeCount > 0 ? `筛选（${activeCount} 项已启用）` : '筛选会话'}
        aria-label="筛选会话"
      >
        <Icons.ListFilter size={13} />
        {activeCount > 0 && <span className="rc-filter-badge">{activeCount}</span>}
      </button>
    </Dropdown>
  )
}
