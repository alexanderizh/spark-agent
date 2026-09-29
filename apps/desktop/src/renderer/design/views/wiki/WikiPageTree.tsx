/**
 * WikiPageTree — 知识库目录树（左栏）。
 *
 * 纯展示 + 交互：树构建、过滤、命中高亮、归档过滤、同级排序都在本文件
 * （纯函数，便于单测）；数据的读写与状态（展开集合、选中页）由 WikiView 持有。
 *
 * 交互对齐重设计稿 v3：子层级用 1px 竖向引导线（.wiki_tree_kids）而非纯缩进；
 * hover 才出现「新建子页 / 更多」；右键与「更多」共用同一菜单
 * （新建子页面 / 重命名 / 编辑标签 / 复制链接 / 置顶 / 归档·还原 / 删除）。
 * 归档页在树上以弱化样式呈现，且只提供「取消归档 / 删除」两条破坏性操作。
 *
 * 拖拽（HTML5 DnD，对齐文件树心智模型）：
 *   - 拖到目标行上 1/4 → 插到它前面；下 1/4 → 插到它后面；中部 → 移入为其子页；
 *   - 非手动排序模式下前后插无意义（顺序由排序规则决定），整行只响应「移入」；
 *   - 归档视图 / 过滤命中态下禁用拖拽（对看不见全集的列表做重排容易误操作）；
 *   - 落点防环（移到自己子页下）由 WikiView 预检 + 主进程 move 通道双保险。
 */

import React, { useMemo, useState } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { WikiPageKind, WikiPageMeta } from '@spark/protocol'
import { Icons } from '../../Icons'

export interface WikiTreeNode {
  page: WikiPageMeta
  children: WikiTreeNode[]
}

/** 同级排序方式（对齐会话侧栏：置顶段恒在最前，段内按所选方式排）。 */
export type WikiTreeSort = 'manual' | 'title' | 'updated'

/** 拖拽落点提示：into=移入为子页 / before·after=同级前插后插 / root-end=移到根级末尾。 */
export type WikiMoveHint =
  | { kind: 'into'; pageId: string }
  | { kind: 'before'; pageId: string }
  | { kind: 'after'; pageId: string }
  | { kind: 'root-end' }

/** 扁平页面列表 → 目录树（父节点缺失时视为根，避免脏数据丢页）。 */
export function buildWikiTree(pages: readonly WikiPageMeta[]): WikiTreeNode[] {
  const byId = new Map<string, WikiTreeNode>()
  for (const page of pages) byId.set(page.id, { page, children: [] })
  const roots: WikiTreeNode[] = []
  for (const page of pages) {
    const node = byId.get(page.id)!
    const parent = page.parentId != null ? byId.get(page.parentId) : undefined
    if (parent != null && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * 同级排序：置顶段恒在最前（与会话侧栏同一口径），段内按排序方式。
 * - manual：sort_order 升序，created_at 兜底（服务端 ORDER BY 同口径）；
 * - title：标题本地化比较；
 * - updated：updatedAt 倒序（最近动的在前）。
 */
export function sortWikiNodes(nodes: readonly WikiTreeNode[], sort: WikiTreeSort): WikiTreeNode[] {
  const cmp = (a: WikiTreeNode, b: WikiTreeNode): number => {
    if (a.page.pinned !== b.page.pinned) return a.page.pinned ? -1 : 1
    if (sort === 'title') return a.page.title.localeCompare(b.page.title, 'zh-Hans-CN')
    if (sort === 'updated') return b.page.updatedAt - a.page.updatedAt
    if (a.page.sortOrder !== b.page.sortOrder) return a.page.sortOrder - b.page.sortOrder
    return a.page.createdAt - b.page.createdAt
  }
  return nodes.map((node) => ({ ...node, children: sortWikiNodes(node.children, sort) })).sort(cmp)
}

/** 命中过滤：保留命中节点及其祖先链；query 为空时原样返回。 */
export function filterWikiTree(
  nodes: readonly WikiTreeNode[],
  query: string,
): { nodes: WikiTreeNode[]; matchedIds: Set<string> } {
  const q = query.trim().toLowerCase()
  const matchedIds = new Set<string>()
  if (q.length === 0) return { nodes: [...nodes], matchedIds }
  const walk = (list: readonly WikiTreeNode[]): WikiTreeNode[] => {
    const kept: WikiTreeNode[] = []
    for (const node of list) {
      const children = walk(node.children)
      const hit = node.page.title.toLowerCase().includes(q)
      if (hit) matchedIds.add(node.page.id)
      if (hit || children.length > 0) kept.push({ page: node.page, children })
    }
    return kept
  }
  return { nodes: walk(nodes), matchedIds }
}

/** 目标页的全部祖先 id（选中深层页时自动展开其路径）。 */
export function findAncestorIds(pages: readonly WikiPageMeta[], pageId: string): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const ancestors: string[] = []
  let cursor = byId.get(pageId)?.parentId ?? null
  while (cursor != null) {
    ancestors.push(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return ancestors
}

/**
 * 归档视图过滤：只保留已归档页（其非归档后代一并保留，避免归档父页时
 * 子页从归档视图里「消失」得无法处理）。query 为空时原样返回。
 */
export function filterArchivedTree(nodes: readonly WikiTreeNode[]): WikiTreeNode[] {
  const walk = (list: readonly WikiTreeNode[]): WikiTreeNode[] => {
    const kept: WikiTreeNode[] = []
    for (const node of list) {
      const children = walk(node.children)
      if (node.page.status === 'archived' || children.length > 0) {
        kept.push({ page: node.page, children })
      }
    }
    return kept
  }
  return walk(nodes)
}

const KIND_LABEL: Record<WikiPageKind, string> = {
  knowledge: '知识',
  experience: '经验',
  pattern: '模式',
  reference: '参考',
  note: '随笔',
}

/** 命中片段高亮（大小写不敏感，只高亮首处）。 */
function highlight(label: string, query: string): React.ReactNode {
  const q = query.trim()
  if (q.length === 0) return label
  const index = label.toLowerCase().indexOf(q.toLowerCase())
  if (index < 0) return label
  return (
    <>
      {label.slice(0, index)}
      <mark>{label.slice(index, index + q.length)}</mark>
      {label.slice(index + q.length)}
    </>
  )
}

export interface WikiPageTreeProps {
  nodes: readonly WikiTreeNode[]
  activeId: string | null
  expandedIds: ReadonlySet<string>
  matchedIds: ReadonlySet<string>
  query: string
  /** 可拖拽态（非归档视图 + 无过滤词）。未传 onMove 时拖拽整体关闭。 */
  dragEnabled?: boolean
  /** 手动排序下才允许同级前插/后插；其余排序方式整行只响应「移入」。 */
  reorderEnabled?: boolean
  onToggle: (id: string) => void
  onSelect: (page: WikiPageMeta) => void
  onCreateChild: (page: WikiPageMeta) => void
  onRename: (page: WikiPageMeta) => void
  /** 未提供时右键菜单不出现「编辑标签…」（Repo Wiki 树走此降级）。 */
  onEditTags?: (page: WikiPageMeta) => void
  onArchive: (page: WikiPageMeta) => void
  onRestore: (page: WikiPageMeta) => void
  onDelete: (page: WikiPageMeta) => void
  /** 未提供时不出现置顶入口（Repo Wiki 树走此降级）。 */
  onTogglePin?: (page: WikiPageMeta) => void
  /** 未提供时拖拽整体关闭（Repo Wiki 页序由扫描重建决定，不接受手动移动）。 */
  onMove?: (pageId: string, hint: WikiMoveHint) => void
}

/** 拖拽落点（含根级空区的「移到根级末尾」）。 */
type DropZone = 'before' | 'after' | 'into' | 'root-end'

export function WikiPageTree({
  nodes,
  activeId,
  expandedIds,
  matchedIds,
  query,
  dragEnabled = false,
  reorderEnabled = false,
  onToggle,
  onSelect,
  onCreateChild,
  onRename,
  onEditTags,
  onArchive,
  onRestore,
  onDelete,
  onTogglePin,
  onMove,
}: WikiPageTreeProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; zone: DropZone } | null>(null)

  const statusHint = (page: WikiPageMeta) =>
    page.status === 'draft' ? '草稿' : page.status === 'archived' ? '已归档' : null

  const menuFor = (page: WikiPageMeta): MenuProps => {
    const archived = page.status === 'archived'
    return {
      items: [
        { key: 'child', label: '新建子页面', disabled: archived },
        { key: 'rename', label: '重命名', disabled: archived },
        ...(onEditTags != null ? [{ key: 'tags', label: '编辑标签…', disabled: archived }] : []),
        ...(onTogglePin != null
          ? [{ key: 'pin', label: page.pinned ? '取消置顶' : '置顶', disabled: archived }]
          : []),
        { key: 'copy', label: '复制链接' },
        { type: 'divider' },
        // 归档 / 还原互斥：归档页只能被还原，活跃页只能被归档
        archived ? { key: 'restore', label: '取消归档' } : { key: 'archive', label: '归档' },
        { key: 'delete', label: '删除', danger: true },
      ],
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (key === 'child') onCreateChild(page)
        else if (key === 'rename') onRename(page)
        else if (key === 'tags') onEditTags?.(page)
        else if (key === 'pin') onTogglePin?.(page)
        else if (key === 'copy') void navigator.clipboard?.writeText(`[[${page.title}]]`)
        else if (key === 'archive') onArchive(page)
        else if (key === 'restore') onRestore(page)
        else if (key === 'delete') onDelete(page)
      },
    }
  }

  /** 行内 hover 操作区：编辑态语义外的轻量入口（置顶开关一击直达）。 */
  const hoverActs = (page: WikiPageMeta) => {
    if (page.status === 'archived') return null
    return (
      <span className="wiki_tree_acts">
        {onTogglePin != null && (
          <button
            type="button"
            className={`wiki_tree_act${page.pinned ? ' is-pinned' : ''}`}
            title={page.pinned ? '取消置顶' : '置顶'}
            aria-label={page.pinned ? '取消置顶' : '置顶'}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(page)
            }}
          >
            {page.pinned ? <Icons.PinFill size={15} /> : <Icons.Pin size={15} />}
          </button>
        )}
        <button
          type="button"
          className="wiki_tree_act"
          title="新建子页面"
          aria-label="新建子页面"
          onClick={(e) => {
            e.stopPropagation()
            onCreateChild(page)
          }}
        >
          <Icons.Plus size={15} />
        </button>
        <Dropdown menu={menuFor(page)} trigger={['click']}>
          <button
            type="button"
            className="wiki_tree_act"
            title="更多"
            aria-label="更多操作"
            onClick={(e) => e.stopPropagation()}
          >
            <Icons.More size={15} />
          </button>
        </Dropdown>
      </span>
    )
  }

  const renderNodes = (list: readonly WikiTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const { page, children } = node
      const hasChildren = children.length > 0
      const open = hasChildren && (expandedIds.has(page.id) || matchedIds.has(page.id))
      const isActive = page.id === activeId
      const archived = page.status === 'archived'
      // 拖拽态：归档页不可拖（已退场内容不参与排序）；归档视图里全员不可拖。
      const draggable = dragEnabled && onMove != null && !archived
      const dropZone = dropAt != null && dropAt.id === page.id ? dropAt.zone : null
      const isDropTarget = dropZone != null && dropZone !== 'root-end' && dragId != null
      const zoneClass =
        isDropTarget && dropZone !== 'into'
          ? dropZone === 'before'
            ? ' is-drop-before'
            : ' is-drop-after'
          : ''
      const intoClass = isDropTarget && dropZone === 'into' ? ' is-drop-into' : ''
      return (
        <React.Fragment key={page.id}>
          <Dropdown menu={menuFor(page)} trigger={['contextMenu']}>
            <div
              className={`wiki_tree_node${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${
                dragId === page.id ? ' is-dragging' : ''
              }${zoneClass}${intoClass}`}
              onClick={() => onSelect(page)}
              role="treeitem"
              aria-selected={isActive}
              aria-level={depth + 1}
              aria-expanded={hasChildren ? open : undefined}
              tabIndex={0}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable) return
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', page.id)
                setDragId(page.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropAt(null)
              }}
              onDragOver={(e) => {
                if (onMove == null || dragId == null || dragId === page.id || archived) return
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const rel = (e.clientY - rect.top) / rect.height
                // 非手动排序：前后插会被排序规则覆盖，整行只做「移入」。
                const zone: DropZone = reorderEnabled
                  ? rel < 0.28
                    ? 'before'
                    : rel > 0.72
                      ? 'after'
                      : 'into'
                  : 'into'
                setDropAt((prev) => {
                  const next = { id: page.id, zone }
                  if (prev != null && prev.id === next.id && prev.zone === next.zone) return prev
                  return next
                })
              }}
              onDrop={(e) => {
                if (onMove == null || dragId == null || dragId === page.id || archived) return
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const rel = (e.clientY - rect.top) / rect.height
                const zone: DropZone = reorderEnabled
                  ? rel < 0.28
                    ? 'before'
                    : rel > 0.72
                      ? 'after'
                      : 'into'
                  : 'into'
                setDragId(null)
                setDropAt(null)
                if (zone === 'into') onMove(dragId, { kind: 'into', pageId: page.id })
                else if (zone === 'before') onMove(dragId, { kind: 'before', pageId: page.id })
                else onMove(dragId, { kind: 'after', pageId: page.id })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(page)
                }
              }}
            >
              <button
                type="button"
                className={`wiki_tree_twist${open ? ' is-open' : ''}${
                  hasChildren ? '' : ' is-leaf'
                }`}
                aria-label={open ? '折叠' : '展开'}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(page.id)
                }}
              >
                <Icons.ChevronRight size={12} />
              </button>
              <span
                className={`wiki_tree_dot k-${page.kind}`}
                title={KIND_LABEL[page.kind]}
                aria-hidden
              />
              <span className="wiki_tree_label" title={page.title}>
                {highlight(page.title, query)}
                {statusHint(page) != null && (
                  <span className="wiki_hint"> · {statusHint(page)}</span>
                )}
              </span>
              {page.pinned && (
                <span className="wiki_tree_pin" title="已置顶" aria-label="已置顶">
                  <Icons.PinFill size={10} />
                </span>
              )}
              {hasChildren && <span className="wiki_tree_count">{children.length}</span>}
              {hoverActs(page)}
            </div>
          </Dropdown>
          {open && <div className="wiki_tree_kids">{renderNodes(children, depth + 1)}</div>}
        </React.Fragment>
      )
    })

  // 根级落区：树容器自身的空白处 = 「移到根级末尾」。行级 handler 已
  // stopPropagation，落到容器上的事件必然来自空白区。onDragOver 必须
  // preventDefault，否则浏览器不会给容器派发 drop。
  const rootDropping = dropAt?.zone === 'root-end' && dragId != null

  const content = useMemo(
    () => renderNodes(nodes, 0),
    [
      nodes,
      activeId,
      expandedIds,
      matchedIds,
      query,
      dragId,
      dropAt,
      reorderEnabled,
      onMove,
      onEditTags,
      onTogglePin,
    ],
  )
  return (
    <div
      className={`wiki_tree${rootDropping ? ' is-drop-root' : ''}`}
      role="tree"
      onDragOver={(e) => {
        if (onMove == null || dragId == null || e.target !== e.currentTarget) return
        e.preventDefault()
        setDropAt((prev) =>
          prev?.zone === 'root-end' ? prev : { id: '__root__', zone: 'root-end' },
        )
      }}
      onDrop={(e) => {
        if (onMove == null || dragId == null || e.target !== e.currentTarget) return
        e.preventDefault()
        const moved = dragId
        setDragId(null)
        setDropAt(null)
        onMove(moved, { kind: 'root-end' })
      }}
    >
      {content}
    </div>
  )
}
