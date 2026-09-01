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
