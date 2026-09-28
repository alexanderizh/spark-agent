/**
 * WikiPageTree — 知识库目录树（左栏）。
 *
 * 纯展示 + 交互：树构建、过滤、命中高亮、归档过滤都在本文件（纯函数，便于单测）；
 * 数据的读写与状态（展开集合、选中页）由 WikiView 持有。
 *
 * 交互对齐重设计稿 v3：子层级用 1px 竖向引导线（.wiki_tree_kids）而非纯缩进；
 * hover 才出现「新建子页 / 更多」；右键与「更多」共用同一菜单
 * （新建子页面 / 重命名 / 复制链接 / 归档·还原 / 删除）。
 * 归档页在树上以弱化样式呈现，且只提供「取消归档 / 删除」两条破坏性操作。
 */

import React, { useMemo } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { WikiPageKind, WikiPageMeta } from '@spark/protocol'
import { Icons } from '../../Icons'

export interface WikiTreeNode {
  page: WikiPageMeta
  children: WikiTreeNode[]
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
export function filterArchivedTree(
  nodes: readonly WikiTreeNode[],
): WikiTreeNode[] {
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
  onToggle: (id: string) => void
  onSelect: (page: WikiPageMeta) => void
  onCreateChild: (page: WikiPageMeta) => void
  onRename: (page: WikiPageMeta) => void
  onArchive: (page: WikiPageMeta) => void
  onRestore: (page: WikiPageMeta) => void
  onDelete: (page: WikiPageMeta) => void
}

export function WikiPageTree({
  nodes,
  activeId,
  expandedIds,
  matchedIds,
  query,
  onToggle,
  onSelect,
  onCreateChild,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: WikiPageTreeProps) {
  const statusHint = (page: WikiPageMeta) =>
    page.status === 'draft' ? '草稿' : page.status === 'archived' ? '已归档' : null

  const menuFor = (page: WikiPageMeta): MenuProps => {
    const archived = page.status === 'archived'
    return {
      items: [
        { key: 'child', label: '新建子页面', disabled: archived },
        { key: 'rename', label: '重命名', disabled: archived },
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
        else if (key === 'copy') void navigator.clipboard?.writeText(`[[${page.title}]]`)
        else if (key === 'archive') onArchive(page)
        else if (key === 'restore') onRestore(page)
        else if (key === 'delete') onDelete(page)
      },
    }
  }

  const renderNodes = (list: readonly WikiTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const { page, children } = node
      const hasChildren = children.length > 0
      const open = hasChildren && (expandedIds.has(page.id) || matchedIds.has(page.id))
      const isActive = page.id === activeId
      const archived = page.status === 'archived'
      return (
        <React.Fragment key={page.id}>
          <Dropdown menu={menuFor(page)} trigger={['contextMenu']}>
            <div
              className={`wiki_tree_node${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}`}
              onClick={() => onSelect(page)}
              role="treeitem"
              aria-selected={isActive}
              aria-level={depth + 1}
              aria-expanded={hasChildren ? open : undefined}
              tabIndex={0}
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
              {hasChildren && <span className="wiki_tree_count">{children.length}</span>}
              <span className="wiki_tree_acts">
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
                  <Icons.Plus size={12} />
                </button>
                <Dropdown menu={menuFor(page)} trigger={['click']}>
                  <button
                    type="button"
                    className="wiki_tree_act"
                    title="更多"
                    aria-label="更多操作"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icons.More size={12} />
                  </button>
                </Dropdown>
              </span>
            </div>
          </Dropdown>
          {open && (
            <div className="wiki_tree_kids">{renderNodes(children, depth + 1)}</div>
          )}
        </React.Fragment>
      )
    })

  const content = useMemo(
    () => renderNodes(nodes, 0),
    [nodes, activeId, expandedIds, matchedIds, query],
  )
  return (
    <div className="wiki_tree" role="tree">
      {content}
    </div>
  )
}
