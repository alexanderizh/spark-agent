/**
 * 远程侧栏的筛选浮层（对齐桌面端 SidebarFilterMenu 的语义，按远程数据裁剪）。
 *
 * 五个维度：状态 / 标记 / 项目（多选 OR，空 = 全部）、最近活动（单选）、只看置顶（开关）。
 * 只有项目维度能在树上就地生效；状态/标记/活动/置顶一开，宿主会切到「结果视图」
 * 全量拉一遍再过滤（会话树是懒加载的，未展开的项目没有会话行可筛）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
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

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current
      if (node != null && event.target instanceof Node && node.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const labelOptions: ReadonlyArray<{ value: RemoteLabelFilter; label: string }> = [
    { value: 'unlabeled', label: '未标记' },
    ...REMOTE_SESSION_LABELS.map((meta) => ({ value: meta.key, label: meta.label })),
  ]

  return (
    <div className="rc-filter-wrap" ref={rootRef}>
      <button
        type="button"
        className={`rc-icon-btn${activeCount > 0 ? ' is-active' : ''}`}
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={activeCount > 0 ? `筛选（${activeCount} 项已启用）` : '筛选会话'}
        aria-label="筛选会话"
      >
        <Icons.ListFilter size={13} />
        {activeCount > 0 && <span className="rc-filter-badge">{activeCount}</span>}
      </button>

      {open && (
        <div className="rc-filter-menu" role="dialog" aria-label="筛选会话">
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
                  onChange({ ...filter, labels: toggleFilterValue(filter.labels, option.value) })
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

          <FilterGroup title="项目">
            {projects.length === 0 ? (
              <div className="rc-filter-empty">还没有项目</div>
            ) : (
              projects.map((project) => (
                <FilterOption
                  key={project.id}
                  label={project.name}
                  selected={filter.projectIds.includes(project.id)}
                  onClick={() =>
                    onChange({
                      ...filter,
                      projectIds: toggleFilterValue(filter.projectIds, project.id),
                    })
                  }
                />
              ))
            )}
          </FilterGroup>

          <FilterGroup title="其它">
            <FilterOption
              label="只看置顶"
              selected={filter.pinnedOnly}
              onClick={() => onChange({ ...filter, pinnedOnly: !filter.pinnedOnly })}
            />
          </FilterGroup>
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
