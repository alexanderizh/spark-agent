/**
 * 远程侧栏的筛选浮层（对齐桌面端 SidebarFilterMenu 的语义，按远程数据裁剪）。
 *
 * 五个维度：状态 / 标记 / 项目（多选 OR，空 = 全部）、最近活动（单选）、只看置顶（开关）。
 * 只有项目维度能在树上就地生效；状态/标记/活动/置顶一开，宿主会切到「结果视图」
 * 全量拉一遍再过滤（会话树是懒加载的，未展开的项目没有会话行可筛）。
 *
 * 项目维度单独做成「选择器」子视图：项目数量只增不减（用户侧动辄几十个），
 * chip 平铺会把 232px 的面板拉成一条长龙；子视图还能让列表占满整个面板高度，
 * 不像内嵌列表那样和上面三个维度抢空间、出现「面板滚一层、列表再滚一层」。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icons } from '../../Icons'
import {
  REMOTE_ACTIVITY_FILTER_OPTIONS,
  REMOTE_STATUS_FILTER_OPTIONS,
  countActiveFilterFacets,
  toggleFilterValue,
  type RemoteLabelFilter,
  type RemoteSessionFilter,
} from './remoteSessionFilters'
import { REMOTE_SESSION_LABELS } from './remoteSessionLabels'
import type { RemoteProjectRow } from './remoteSessionStore'

/** 收起态最多显示几个已选项目 chip，其余收进「+N」 */
const MAX_PROJECT_CHIPS = 3

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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const activeCount = countActiveFilterFacets(filter)
  /** 面板内的「选择项目」子视图：占满面板，列表不被上面几个维度挤压 */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const projectSearchRef = useRef<HTMLInputElement | null>(null)

  /** 关整个面板时顺手把选择器与搜索词收回去：下次打开是紧凑形态 */
  const closePanel = useCallback(() => {
    setOpen(false)
    setPickerOpen(false)
    setProjectQuery('')
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current
      if (node != null && event.target instanceof Node && node.contains(event.target)) return
      closePanel()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 先退选择器，再退面板：Esc 一次只退一层，符合「返回」的直觉
      if (pickerOpen) setPickerOpen(false)
      else closePanel()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [closePanel, open, pickerOpen])

  // 进入选择器就聚焦搜索框：项目多的时候，摊开列表再去找输入框是多余动作
  useEffect(() => {
    if (pickerOpen) projectSearchRef.current?.focus()
  }, [pickerOpen])

  const labelOptions: ReadonlyArray<{ value: RemoteLabelFilter; label: string }> = [
    { value: 'unlabeled', label: '未标记' },
    ...REMOTE_SESSION_LABELS.map((meta) => ({ value: meta.key, label: meta.label })),
  ]

  const toggleProject = (projectId: string) => {
    onChange({ ...filter, projectIds: toggleFilterValue(filter.projectIds, projectId) })
  }
  const selectedProjects = projects.filter((project) => filter.projectIds.includes(project.id))
  const normalizedQuery = projectQuery.trim().toLowerCase()
  const visibleProjects =
    normalizedQuery.length === 0
      ? projects
      : projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery))

  return (
    <div className="rc-filter-wrap" ref={rootRef}>
      <button
        type="button"
        className={`rc-icon-btn${activeCount > 0 ? ' is-active' : ''}`}
        onClick={() => {
          if (open) closePanel()
          else setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={activeCount > 0 ? `筛选（${activeCount} 项已启用）` : '筛选会话'}
        aria-label="筛选会话"
      >
        <Icons.ListFilter size={13} />
        {activeCount > 0 && <span className="rc-filter-badge">{activeCount}</span>}
      </button>

      {open && (
        <div
          className={`rc-filter-menu${pickerOpen ? ' is-picker' : ''}`}
          role="dialog"
          aria-label={pickerOpen ? '选择项目' : '筛选会话'}
        >
          {pickerOpen ? (
            <>
              <div className="rc-picker-head">
                <button
                  type="button"
                  className="rc-picker-back"
                  onClick={() => setPickerOpen(false)}
                  title="返回筛选"
                  aria-label="返回筛选"
                >
                  <Icons.ChevronLeft size={12} />
                </button>
                <span className="rc-picker-title">选择项目</span>
                <span className="rc-picker-count">
                  {filter.projectIds.length}/{projects.length}
                </span>
              </div>

              <input
                ref={projectSearchRef}
                className="rc-filter-search"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="搜索项目"
                aria-label="搜索项目"
              />

              <div className="rc-picker-list" role="group" aria-label="项目列表">
                {visibleProjects.length === 0 ? (
                  <div className="rc-filter-empty">没有匹配的项目</div>
                ) : (
                  visibleProjects.map((project) => {
                    const selected = filter.projectIds.includes(project.id)
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={`rc-filter-picker-item${selected ? ' is-selected' : ''}`}
                        onClick={() => toggleProject(project.id)}
                        role="checkbox"
                        aria-checked={selected}
                        title={project.name}
                      >
                        <span className="rc-filter-check">
                          {selected && <Icons.Check size={10} />}
                        </span>
                        <span className="rc-filter-picker-name">{project.name}</span>
                      </button>
                    )
                  })
                )}
              </div>

              <div className="rc-picker-foot">
                <button
                  type="button"
                  className="rc-link-btn"
                  disabled={filter.projectIds.length === 0}
                  onClick={() => onChange({ ...filter, projectIds: [] })}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="rc-picker-done"
                  onClick={() => setPickerOpen(false)}
                >
                  完成
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rc-filter-head">
                <span>筛选</span>
                <button
                  type="button"
                  className="rc-link-btn"
                  onClick={onClear}
                  disabled={activeCount === 0}
                >
                  清除全部
                </button>
              </div>

              <FilterGroup title="状态">
                {REMOTE_STATUS_FILTER_OPTIONS.map((option) => (
                  <FilterOption
                    key={option.value}
                    label={option.label}
                    selected={filter.statuses.includes(option.value)}
                    onClick={() =>
                      onChange({
                        ...filter,
                        statuses: toggleFilterValue(filter.statuses, option.value),
                      })
                    }
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="标记">
                {labelOptions.map((option) => (
                  <FilterOption
                    key={option.value}
                    label={option.label}
                    selected={filter.labels.includes(option.value)}
                    onClick={() =>
                      onChange({
                        ...filter,
                        labels: toggleFilterValue(filter.labels, option.value),
                      })
                    }
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="最近活动" single>
                {REMOTE_ACTIVITY_FILTER_OPTIONS.map((option) => (
                  <FilterOption
                    key={option.value}
                    label={option.label}
                    selected={filter.activity === option.value}
                    onClick={() => onChange({ ...filter, activity: option.value })}
                  />
                ))}
              </FilterGroup>

              {/*
               * 项目：这里只放一行摘要（已选几个 / 全部），点它进选择器。
               * 直接把几十个项目铺成 chip 会把面板拉成长条，也很难扫读。
               */}
              <div className="rc-filter-group">
                <div className="rc-filter-group-title">
                  <button
                    type="button"
                    className="rc-filter-picker-entry"
                    onClick={() => setPickerOpen(true)}
                    disabled={projects.length === 0}
                    title={projects.length === 0 ? '还没有项目' : '选择要筛选的项目'}
                  >
                    <span>项目</span>
                    <span className="rc-filter-picker-entry-value">
                      {projects.length === 0
                        ? '还没有项目'
                        : selectedProjects.length === 0
                          ? `全部（${projects.length}）`
                          : `已选 ${selectedProjects.length} / ${projects.length}`}
                    </span>
                    {projects.length > 0 && <Icons.ChevronRight size={10} />}
                  </button>
                </div>
                {selectedProjects.length > 0 && (
                  <div className="rc-filter-options">
                    {selectedProjects.slice(0, MAX_PROJECT_CHIPS).map((project) => (
                      <FilterOption
                        key={project.id}
                        label={project.name}
                        selected
                        onClick={() => toggleProject(project.id)}
                      />
                    ))}
                    {selectedProjects.length > MAX_PROJECT_CHIPS && (
                      <button
                        type="button"
                        className="rc-filter-more"
                        onClick={() => setPickerOpen(true)}
                        title="查看全部已选项目"
                      >
                        +{selectedProjects.length - MAX_PROJECT_CHIPS}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <FilterGroup title="其它">
                <FilterOption
                  label="只看置顶"
                  selected={filter.pinnedOnly}
                  onClick={() => onChange({ ...filter, pinnedOnly: !filter.pinnedOnly })}
                />
              </FilterGroup>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FilterGroup({
  title,
  single = false,
  children,
}: {
  title: string
  /** 单选组（点击即替换），用来区分活动时间与多选维度 */
  single?: boolean
  children: ReactNode
}) {
  return (
    <div className={`rc-filter-group${single ? ' is-single' : ''}`}>
      <div className="rc-filter-group-title">{title}</div>
      <div className="rc-filter-options">{children}</div>
    </div>
  )
}

function FilterOption({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`rc-filter-opt${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      title={label}
    >
      <span className="rc-filter-opt-label">{label}</span>
      {selected && (
        <span className="rc-filter-opt-check">
          <Icons.Check size={11} />
        </span>
      )}
    </button>
  )
}
