/**
 * WikiPageTree — 知识库目录树（左栏）。
 *
 * 纯展示 + 交互：树构建、过滤、命中高亮、归档过滤、同级排序都在本文件
 * （纯函数，便于单测）；数据的读写与状态（展开集合、选中页）由 WikiView 持有。
 *
 * 交互对齐重设计稿 v3：子层级用 1px 竖向引导线（.wiki_tree_kids）而非纯缩进；
 * hover 才出现「新建子页 / 更多」；右键与「更多」共用同一菜单。
 * 归档页在树上以弱化样式呈现，且只提供「取消归档 / 删除」两条破坏性操作。
 * 树语义 = 只有文件夹可以作为父节点（对齐文件树心智）：文件夹行点击 = 折叠/
 * 展开；「新建子页面 / 新建子文件夹」入口只出现在文件夹上；页面不可被移入。
 *
 * 拖拽（HTML5 DnD，对齐文件树心智模型）：
 *   - 文件夹行：上 1/4 → 插到它前面；下 1/4 → 插到它后面；中部 → 移入；
 *   - 页面行：手动排序下按中线分为前插/后插两段；非手动排序整行不可 drop；
 *   - 非手动排序模式下前后插无意义（顺序由排序规则决定），文件夹整行只响应「移入」；
 *   - 归档视图 / 过滤命中态下禁用拖拽（对看不见全集的列表做重排容易误操作）；
 *   - 拖到自己子树内整行禁 drop（防环前置，落库前主进程 move 通道还有一道）；
 *   - 容器空白区（含深层级缩进空白）= 移到根级末尾。
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

/**
 * 解析行内落点（纯函数，便于单测）。树语义对齐文件树心智：
 *   - 文件夹：中部 = 移入为其子级；手动排序下上/下 28% = 同级前插/后插；
 *   - 页面：**不接受移入**（页面下不挂子节点），手动排序下整行按中线
 *     分为前插/后插两个落区；非手动排序下整行无落区（顺序由规则决定）。
 * 返回 null = 该位置不接受 drop（浏览器显示禁止光标）。
 */
export function resolveDropZone(
  page: WikiPageMeta,
  rel: number,
  reorderEnabled: boolean,
): DropZone | null {
  if (page.kind === 'folder') {
    if (!reorderEnabled) return 'into'
    if (rel < 0.28) return 'before'
    if (rel > 0.72) return 'after'
    return 'into'
  }
  return reorderEnabled ? (rel < 0.5 ? 'before' : 'after') : null
}

/** 拖拽起点在树中的全部后代 id（拖到自己子树里 = 防环，整段禁止 drop）。 */
export function collectDescendantIds(
  nodes: readonly WikiTreeNode[],
  rootId: string,
  out: Set<string> = new Set(),
): Set<string> {
  for (const node of nodes) {
    if (node.page.id === rootId) {
      const walk = (list: readonly WikiTreeNode[]): void => {
        for (const child of list) {
          out.add(child.page.id)
          walk(child.children)
        }
      }
      walk(node.children)
      continue
    }
    collectDescendantIds(node.children, rootId, out)
  }
  return out
}

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
  folder: '文件夹',
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
  /** 未提供时右键菜单不出现「新建子文件夹」（Repo Wiki 树走此降级）。 */
  onCreateChildFolder?: (page: WikiPageMeta) => void
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
  onCreateChildFolder,
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

  /** 拖拽起点的后代集合：拖到自己子树里直接禁 drop（比落库前 toast 早一步拦住）。 */
  const draggingDescendants = useMemo(
    () => (dragId != null ? collectDescendantIds(nodes, dragId) : new Set<string>()),
    [dragId, nodes],
  )

  const statusHint = (page: WikiPageMeta) =>
    page.status === 'draft' ? '草稿' : page.status === 'archived' ? '已归档' : null

  const menuFor = (page: WikiPageMeta): MenuProps => {
    const archived = page.status === 'archived'
    return {
      items: [
        // 树语义：只有文件夹能作为父节点，页面不再提供「新建子页面」入口
        ...(page.kind === 'folder'
          ? [{ key: 'child', label: '新建子页面', disabled: archived }]
          : []),
        ...(page.kind === 'folder' && onCreateChildFolder != null
          ? [{ key: 'childFolder', label: '新建子文件夹', disabled: archived }]
          : []),
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
        else if (key === 'childFolder') onCreateChildFolder?.(page)
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
        {page.kind === 'folder' && (
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
        )}
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
      const isFolder = page.kind === 'folder'
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
      // 文件夹行点击 = 折叠/展开（文件树心智）；页面行点击 = 打开正文。
      const activate = (): void => {
        if (isFolder) onToggle(page.id)
        else onSelect(page)
      }
      const acceptDrop = (e: React.DragEvent<HTMLDivElement>): DropZone | null => {
        if (onMove == null || dragId == null || dragId === page.id || archived) return null
        // 防环前置：目标在自己子树内 → 整行禁 drop（浏览器显示禁止光标）
        if (draggingDescendants.has(page.id)) return null
        const rect = e.currentTarget.getBoundingClientRect()
        const rel = (e.clientY - rect.top) / Math.max(rect.height, 1)
        return resolveDropZone(page, rel, reorderEnabled)
      }
      return (
        <React.Fragment key={page.id}>
          <Dropdown menu={menuFor(page)} trigger={['contextMenu']}>
            <div
              className={`wiki_tree_node${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${
                dragId === page.id ? ' is-dragging' : ''
              }${zoneClass}${intoClass}`}
              onClick={activate}
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
                const zone = acceptDrop(e)
                if (zone == null) return
                e.preventDefault()
                e.stopPropagation()
                setDropAt((prev) => {
                  const next = { id: page.id, zone }
                  if (prev != null && prev.id === next.id && prev.zone === next.zone) return prev
                  return next
                })
              }}
              onDrop={(e) => {
                const zone = acceptDrop(e)
                if (zone == null || onMove == null) return
                e.preventDefault()
                e.stopPropagation()
                const moved = dragId
                setDragId(null)
                setDropAt(null)
                if (moved == null) return
                if (zone === 'into') onMove(moved, { kind: 'into', pageId: page.id })
                else if (zone === 'before') onMove(moved, { kind: 'before', pageId: page.id })
                else if (zone === 'after') onMove(moved, { kind: 'after', pageId: page.id })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  activate()
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
                <Icons.ChevronRight size={14} />
              </button>
              {page.kind === 'folder' ? (
                <span className="wiki_tree_folder_icon" title={KIND_LABEL[page.kind]} aria-hidden>
                  {open ? (
                    <Icons.FolderColorfulOpen size={15} />
                  ) : (
                    <Icons.FolderColorful size={15} />
                  )}
                </span>
              ) : (
                <span
                  className={`wiki_tree_dot k-${page.kind}`}
                  title={KIND_LABEL[page.kind]}
                  aria-hidden
                />
              )}
              <span className="wiki_tree_label" title={page.title}>
                {highlight(page.title, query)}
                {statusHint(page) != null && (
                  <span className="wiki_hint"> · {statusHint(page)}</span>
                )}
              </span>
              {page.pinned && (
                <span
                  className={`wiki_tree_pin${
                    onTogglePin != null && page.status !== 'archived' ? ' is-hot' : ''
                  }`}
                  title="已置顶"
                  aria-label="已置顶"
                >
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

  // 根级落区：树容器内任何非行区域（含深层级的缩进空白）= 「移到根级末尾」。
  // 行级 handler 已 stopPropagation，落到容器上的事件必然来自空白区；
  // target 用 closest 排除行内元素（此前只认容器本身，深层级 kids 空白拖不进来）。
  // onDragOver 必须 preventDefault，否则浏览器不会给容器派发 drop。
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
      draggingDescendants,
      reorderEnabled,
      onMove,
      onEditTags,
      onTogglePin,
    ],
  )
  const isTreeBlank = (e: React.DragEvent<HTMLDivElement>): boolean =>
    !((e.target as Element).closest?.('.wiki_tree_node') != null)
  return (
    <div
      className={`wiki_tree${rootDropping ? ' is-drop-root' : ''}`}
      role="tree"
      onDragOver={(e) => {
        if (onMove == null || dragId == null || !isTreeBlank(e)) return
        e.preventDefault()
        setDropAt((prev) =>
          prev?.zone === 'root-end' ? prev : { id: '__root__', zone: 'root-end' },
        )
      }}
      onDrop={(e) => {
        if (onMove == null || dragId == null || !isTreeBlank(e)) return
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
