import type { WorkspaceSearchContentMatch } from '@spark/protocol'

export interface SearchResultTreeSource {
  path: string
  rank: number
  matches?: readonly WorkspaceSearchContentMatch[]
}

export interface SearchResultDirectoryNode {
  kind: 'directory'
  path: string
  name: string
  rank: number
  fileCount: number
  matchCount: number
  children: SearchResultTreeNode[]
}

export interface SearchResultFileNode {
  kind: 'file'
  path: string
  name: string
  rank: number
  matches: readonly WorkspaceSearchContentMatch[]
}

export type SearchResultTreeNode = SearchResultDirectoryNode | SearchResultFileNode

export type SearchResultTreeRow =
  | {
      kind: 'directory'
      key: string
      depth: number
      node: SearchResultDirectoryNode
      collapsed: boolean
    }
  | {
      kind: 'file'
      key: string
      depth: number
      node: SearchResultFileNode
      collapsed: boolean
    }
  | {
      kind: 'match'
      key: string
      depth: number
      match: WorkspaceSearchContentMatch
    }

interface MutableDirectoryNode extends Omit<SearchResultDirectoryNode, 'children'> {
  childrenByName: Map<string, MutableTreeNode>
}

type MutableTreeNode = MutableDirectoryNode | SearchResultFileNode

const EMPTY_MATCHES: readonly WorkspaceSearchContentMatch[] = []

export function getSearchResultTreeNodeKey(kind: 'directory' | 'file', path: string): string {
  return `${kind}:${path}`
}

/**
 * 将已排序的搜索结果聚合为目录树。目录 rank 继承其最高优先级后代，既保留层级，
 * 也让文件搜索中最相关的分支维持靠前位置。
 */
export function buildSearchResultTree(
  sources: readonly SearchResultTreeSource[],
): SearchResultTreeNode[] {
  const roots = new Map<string, MutableTreeNode>()

  for (const source of sources) {
    const segments = source.path.replace(/\\/g, '/').split('/').filter(Boolean)
    if (segments.length === 0) continue
    const normalizedPath = segments.join('/')

    let children = roots
    let directoryPath = ''
    const matchCount = source.matches?.length ?? 0

    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]
      if (name == null) continue
      directoryPath = directoryPath === '' ? name : `${directoryPath}/${name}`

      const existing = children.get(name)
      let directory: MutableDirectoryNode
      if (existing?.kind === 'directory') {
        directory = existing
        directory.rank = Math.min(directory.rank, source.rank)
        directory.fileCount += 1
        directory.matchCount += matchCount
      } else {
        directory = {
          kind: 'directory',
          path: directoryPath,
          name,
          rank: source.rank,
          fileCount: 1,
          matchCount,
          childrenByName: new Map(),
        }
        children.set(name, directory)
      }
      children = directory.childrenByName
    }

    const name = segments.at(-1)
    if (name == null || children.has(name)) continue
    children.set(name, {
      kind: 'file',
      path: normalizedPath,
      name,
      rank: source.rank,
      matches: source.matches ?? EMPTY_MATCHES,
    })
  }

  return finalizeNodes(roots)
}

/** 将树按当前展开状态压平成虚拟列表行；折叠节点的后代不会进入渲染集合。 */
export function flattenSearchResultTree(
  nodes: readonly SearchResultTreeNode[],
  collapsedNodeKeys: ReadonlySet<string>,
  includeMatches: boolean,
): SearchResultTreeRow[] {
  const rows: SearchResultTreeRow[] = []

  const visit = (node: SearchResultTreeNode, depth: number): void => {
    const key = getSearchResultTreeNodeKey(node.kind, node.path)
    const collapsed = collapsedNodeKeys.has(key)
    if (node.kind === 'directory') {
      rows.push({ kind: 'directory', key, depth, node, collapsed })
      if (collapsed) return
      for (const child of node.children) visit(child, depth + 1)
      return
    }

    rows.push({ kind: 'file', key, depth, node, collapsed })
    if (collapsed || !includeMatches) return

    node.matches.forEach((match, index) => {
      rows.push({
        kind: 'match',
        key: `match:${match.path}:${match.line}:${match.column}:${index}`,
        depth: depth + 1,
        match,
      })
    })
  }

  for (const node of nodes) visit(node, 0)
  return rows
}

function finalizeNodes(nodes: ReadonlyMap<string, MutableTreeNode>): SearchResultTreeNode[] {
  return [...nodes.values()].sort(compareNodes).map((node): SearchResultTreeNode => {
    if (node.kind === 'file') return node
    return {
      kind: 'directory',
      path: node.path,
      name: node.name,
      rank: node.rank,
      fileCount: node.fileCount,
      matchCount: node.matchCount,
      children: finalizeNodes(node.childrenByName),
    }
  })
}

function compareNodes(a: MutableTreeNode, b: MutableTreeNode): number {
  return a.rank - b.rank || a.name.localeCompare(b.name)
}
