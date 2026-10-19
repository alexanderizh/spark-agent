import path from 'node:path'

import { NO_PROJECT_WORKSPACE_NAME } from '@spark/protocol'

/**
 * 「不使用项目」保留名守卫（workspace:update / workspace:open 共用）。
 *
 * 保留工作区是侧栏分组与临时会话落点的不变量锚点：主进程的
 * ensureNoProjectWorkspacePath / getNoProjectWorkspaceId / TerminalService
 * 以及渲染端多处分组逻辑都按名称精确查找它。出现第二个同名工作区会导致
 * 根目录误搬迁、定时任务与终端落点误认；保留工作区自身被改名或归档则查找失效。
 */

/** 守卫所需的最小工作区投影（WorkspaceRow 天然满足） */
export interface WorkspaceNameRow {
  id: string
  name: string
  rootPath: string
}

/**
 * workspace:update 中与守卫相关的字段（其余字段不受守卫影响）。
 * IPC 请求以缺省（undefined）表示不改动，仓储层以 null 表示清除，两种都接受。
 */
export interface WorkspaceUpdateReservedNamePatch {
  name?: string | null | undefined
  archived?: boolean | null | undefined
}

/**
 * workspace:update 守卫：
 * - 任何工作区不得改名为保留名（防重名误认）
 * - 保留工作区自身不得改名（含空白变体——查找是精确匹配）或归档；
 *   `archived: false` 恢复放行，允许修复历史脏数据
 * - 目标不存在时直接放行，由后续 updateWorkspace 的存在性校验兜底
 */
export function assertWorkspaceUpdateReservedName(
  target: WorkspaceNameRow | null | undefined,
  patch: WorkspaceUpdateReservedNamePatch,
): void {
  if (target == null) return
  if (target.name === NO_PROJECT_WORKSPACE_NAME) {
    if (patch.name !== undefined && patch.name !== NO_PROJECT_WORKSPACE_NAME) {
      throw new Error('「不使用项目」是系统保留项目，不能改名')
    }
    if (patch.archived === true) {
      throw new Error('「不使用项目」是系统保留项目，不能归档')
    }
    return
  }
  if (patch.name === NO_PROJECT_WORKSPACE_NAME) {
    throw new Error('「不使用项目」是系统保留名称，不能作为项目名')
  }
}

/**
 * workspace:open 创建分支守卫：openWorkspace 无重名校验，
 * `create.name` 或缺省时的 `basename(rootPath)` 都可能撞上保留名。
 * - 不存在同名记录时放行（系统首次创建保留工作区走这条路）
 * - rootPath 与既有保留工作区一致时放行（findByRootPath 幂等复用，不会真正创建）
 */
export function assertWorkspaceCreateReservedName(params: {
  rootPath: string
  createName: string | undefined
  existingNoProject: WorkspaceNameRow | null | undefined
}): void {
  const requestedName = params.createName ?? path.basename(path.resolve(params.rootPath))
  if (requestedName !== NO_PROJECT_WORKSPACE_NAME) return
  if (params.existingNoProject == null) return
  if (path.resolve(params.rootPath) === path.resolve(params.existingNoProject.rootPath)) {
    return
  }
  throw new Error('「不使用项目」是系统保留名称，已存在同名项目')
}
