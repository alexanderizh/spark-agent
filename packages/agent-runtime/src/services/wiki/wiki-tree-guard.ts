/**
 * @module wiki-tree-guard
 *
 * 目录树结构守卫 — move / 挂载时的防环校验（IPC 与 Agent 桥共用）。
 *
 * 之前这份逻辑内联在 registerWikiIpc 的 move handler 里；Agent 工具
 * （wiki_update 带 parent_id）引入移动能力后，两条写入路径必须共用同一份
 * 判定，避免「UI 不能造环、Agent 却可以」的口径分裂。
 */

/** 树回溯深度上限（防脏数据 parent 链成环时死循环；64 层远超合理层级）。 */
const MAX_TREE_DEPTH = 64

interface MinimalPageRow {
  parent_id: string | null
  space_id: string
  kind?: string
}

interface MinimalPageRepo {
  getById(id: string): MinimalPageRow | null
}

/**
 * 目标节点是否位于 candidate 子树内（move 防环）。
 * 逐层向上回溯父链；跨空间或断链视为「不是后代」（移动校验另有跨空间拦截）。
 */
export function isWikiDescendant(
  repo: MinimalPageRepo,
  spaceId: string,
  candidateId: string,
  ancestorId: string,
): boolean {
  let cursor = candidateId
  for (let depth = 0; depth < MAX_TREE_DEPTH; depth += 1) {
    const row = repo.getById(cursor)
    if (row == null || row.space_id !== spaceId) return false
    if (row.parent_id == null) return false
    if (row.parent_id === ancestorId) return true
    cursor = row.parent_id
  }
  return false
}

/**
 * 移动 / 挂载校验的公共入口：目标父节点存在性、同空间、文件夹约束、防环
 * 四条一次做完（树语义 = 只有文件夹可以作为父节点，对齐文件树心智模型；
 * 页面下挂子级会让「正文页」与「容器」职责混淆）。校验失败返回结构化消息
 * （调用方转 Error / 结构化回执），通过返回 null。
 */
export function validateWikiMoveTarget(input: {
  repo: MinimalPageRepo & { getById(id: string): (MinimalPageRow & { title?: string }) | null }
  pageId: string
  spaceId: string
  parentId: string | null
}): string | null {
  const { repo, pageId, spaceId, parentId } = input
  if (parentId === pageId) return '不能把节点移动到自己下面'
  if (parentId == null) return null
  const parent = repo.getById(parentId)
  if (parent == null) return '目标父节点不存在'
  if (parent.space_id !== spaceId) return '不能跨空间移动节点'
  if (parent.kind != null && parent.kind !== 'folder') {
    return '只能移动到文件夹下，页面下面不能再挂子节点'
  }
  if (isWikiDescendant(repo, spaceId, parentId, pageId)) {
    return '不能把节点移动到它自己的子节点下'
  }
  return null
}
