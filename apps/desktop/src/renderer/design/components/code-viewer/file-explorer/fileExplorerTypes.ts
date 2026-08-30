/**
 * 文件树类型与纯函数。
 *
 * 节点模型采用扁平 Map（key = 相对 workspace root 的 posix 路径，root 为 ''），
 * 而非嵌套树 —— 便于 file-change 事件增量更新、路径查找与展开态迁移。
 */

import type { WorkspaceTreeEntry } from '@spark/protocol'

/** 文件树节点（扁平结构中的一个条目） */
export interface FileExplorerNode {
  /** 相对 root 的 posix 路径；root 节点为 '' */
  path: string
  /** 显示名（basename） */
  name: string
  type: 'file' | 'directory'
  /** 深度（root=0，其直接子项=1） */
  depth: number
  /** 目录是否有子项（file 恒 undefined；目录未知时为 true，展开/刷新后纠正） */
  hasChildren?: boolean | undefined
}

/** 文件剪贴板条目（模块级单例，切会话保留，符合 VSCode 习惯） */
export interface FileClipboardEntry {
  /** 相对 root 的 posix 路径 */
  path: string
  /** copy 复制 / cut 剪切（粘贴时移动） */
  mode: 'copy' | 'cut'
  type: 'file' | 'directory'
}

/** root 节点的路径常量 */
export const ROOT_PATH = ''

/**
 * 按 posix 相对路径推导层级深度（root ''=0，顶级 'src'=1，'src/x'=2）。
 *
 * 不用后端 entry.depth：那是「相对本次 list-directory 请求起点」的深度，
 * 展开目录时 reloadDir 传 path=目录 & maxDepth:0，返回的子项 depth 恒为 0，
 * 直接透传会导致展开后所有子项失去缩进。path 本身相对 workspace root，
 * 按 '/' 分段永远能得到真实层级。
 */
export function pathDepth(posixPath: string): number {
  if (posixPath === ROOT_PATH) return 0
  return posixPath.split('/').length
}

/** WorkspaceTreeEntry → FileExplorerNode（统一 posix 路径、简化 symlink） */
export function toExplorerNode(entry: WorkspaceTreeEntry): FileExplorerNode {
  const posixPath = entry.path.replace(/\\/g, '/')
  const type: 'file' | 'directory' = entry.type === 'file' ? 'file' : 'directory'
  return {
    path: posixPath,
    name: entry.name,
    type,
    depth: pathDepth(posixPath),
    hasChildren: type === 'directory' ? entry.childrenCount !== 0 : undefined,
  }
}

/** 取 posix 路径的父目录（root 的父为 ''，顶级 'src' 的父为 ''） */
export function parentPath(posixPath: string): string {
  const idx = posixPath.lastIndexOf('/')
  return idx < 0 ? '' : posixPath.slice(0, idx)
}

/** 取 posix 路径的 basename */
export function baseName(posixPath: string): string {
  const idx = posixPath.lastIndexOf('/')
  return idx < 0 ? posixPath : posixPath.slice(idx + 1)
}

/** 节点排序：目录优先，再按名称自然序（numeric） */
function compareNodes(a: FileExplorerNode, b: FileExplorerNode): number {
  const aDir = a.type === 'directory' ? 0 : 1
  const bDir = b.type === 'directory' ? 0 : 1
  if (aDir !== bDir) return aDir - bDir
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 按展开目录计算当前可见的节点 path 序列（DFS，目录优先排序）。
 * root 节点本身不入列；返回的是从顶级开始、按可见层级铺平的 path 列表。
 */
export function computeVisiblePaths(
  nodes: Map<string, FileExplorerNode>,
  expandedDirs: Set<string>,
): string[] {
  // 父路径 → 子节点的索引，避免每层全表扫描
  const byParent = new Map<string, FileExplorerNode[]>()
  for (const node of nodes.values()) {
    if (node.path === ROOT_PATH) continue
    const parent = parentPath(node.path)
    const list = byParent.get(parent)
    if (list != null) list.push(node)
    else byParent.set(parent, [node])
  }
  for (const list of byParent.values()) list.sort(compareNodes)

  const result: string[] = []
  const walk = (parent: string): void => {
    const children = byParent.get(parent)
    if (children == null) return
    for (const child of children) {
      result.push(child.path)
      if (child.type === 'directory' && expandedDirs.has(child.path)) {
        walk(child.path)
      }
    }
  }
  walk(ROOT_PATH)
  return result
}

/**
 * 内联重命名 / 新建目标（FileExplorerPanel 持有，FileTree 消费）。
 * - rename：替换现有节点 path 的名称显示为输入框
 * - create-file / create-directory：在 parentDir 下插入一行虚拟输入框
 */
export type RenameTarget =
  | { kind: 'rename'; path: string; initialValue: string }
  | { kind: 'create-file'; parentDir: string }
  | { kind: 'create-directory'; parentDir: string }
