/**
 * 文件操作 IPC 薄封装。
 *
 * 仅负责调用与返回 FileOperationResult —— 不处理 UI（toast / 刷新），
 * 由调用方（FileExplorerPanel 及其子组件）根据结果决定反馈。
 * watch 会在操作成功后自动 reload 受影响目录，组件通常无需手动刷新。
 */

import type { FileConflictPolicy, FileOperationResult, SessionId } from '@spark/protocol'

/** 删除到系统回收站 */
export async function trashPath(
  workspaceId: string,
  path: string,
  sessionId?: SessionId,
): Promise<FileOperationResult> {
  return window.spark.invoke('file:trash', {
    workspaceId,
    path,
    ...(sessionId ? { sessionId } : {}),
  })
}

/** 新建文件（父目录不存在时后端自动 mkdir -p） */
export async function createFilePath(
  workspaceId: string,
  path: string,
  content?: string,
  sessionId?: SessionId,
): Promise<FileOperationResult> {
  return window.spark.invoke('file:create-file', {
    workspaceId,
    path,
    ...(content != null ? { content } : {}),
    ...(sessionId ? { sessionId } : {}),
  })
}

/** 新建目录（支持递归创建多层） */
export async function createDirectoryPath(
  workspaceId: string,
  path: string,
  sessionId?: SessionId,
): Promise<FileOperationResult> {
  return window.spark.invoke('file:create-directory', {
    workspaceId,
    path,
    ...(sessionId ? { sessionId } : {}),
  })
}

/** 移动 / 重命名 */
export async function movePath(
  workspaceId: string,
  fromPath: string,
  toPath: string,
  ifExists: FileConflictPolicy = 'error',
  sessionId?: SessionId,
): Promise<FileOperationResult> {
  return window.spark.invoke('file:move', {
    workspaceId,
    fromPath,
    toPath,
    ifExists,
    ...(sessionId ? { sessionId } : {}),
  })
}

/** 复制（文件或目录） */
export async function copyPath(
  workspaceId: string,
  fromPath: string,
  toPath: string,
  ifExists: FileConflictPolicy = 'error',
  sessionId?: SessionId,
): Promise<FileOperationResult> {
  return window.spark.invoke('file:copy', {
    workspaceId,
    fromPath,
    toPath,
    ifExists,
    ...(sessionId ? { sessionId } : {}),
  })
}

/** 写文本到系统剪贴板（复制路径用） */
export async function writeClipboardText(text: string): Promise<void> {
  await window.spark.invoke('clipboard:write-text', { text })
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

/** 「在系统文件夹打开」菜单文案（随平台：macOS=Finder，其余=资源管理器） */
export const OPEN_IN_FILE_MANAGER_LABEL = isMac ? '在 Finder 中显示' : '在资源管理器中显示'

/** 在系统文件管理器中打开目录（目录节点与工作区根用） */
export async function openDirectoryInFileManager(absPath: string): Promise<void> {
  const res = await window.spark.invoke('tool:open-folder', { rootPath: absPath })
  if (!res.opened) throw new Error(res.error ?? '打开目录失败')
}

/** 在系统文件管理器中显示文件（打开所在目录并选中该文件） */
export async function revealPathInFileManager(absPath: string): Promise<void> {
  const res = await window.spark.invoke('file:reveal', { filePath: absPath })
  if (!res.revealed) throw new Error(res.error ?? '显示文件失败')
}
