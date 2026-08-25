/**
 * 文件树节点拖拽（file-explorer DnD）。
 *
 * 一个自定义 MIME 同时服务两个 drop 场景：
 *  1. 拖到树内目录节点 / 树空白处 → 移动文件（FileExplorerPanel 消费 relPath，走 file:move）
 *  2. 拖到会话输入区 → 作为参考资源附件（ComposerV2 消费 absPath，走 OS 文件拖入同链路）
 *
 * 与既有拖拽互不冲突：本 MIME 不含 Files 类型（不会触发 ComposerV2 的 OS 文件分支），
 * 也不是 session-reference MIME；树内 drop 在 React 层 stopPropagation，不会冒泡到
 * ComposerV2 的 window 级监听。
 */

import { ROOT_PATH } from './fileExplorerTypes'

export const FILE_EXPLORER_NODE_MIME = 'application/x-spark-file-explorer-node'

export interface FileExplorerNodeDragPayload {
  /** 相对 workspace root 的 posix 路径（移动用） */
  relPath: string
  /** 绝对路径（拖入会话区作参考资源用） */
  absPath: string
  /** 显示名 */
  name: string
  type: 'file' | 'directory'
}

export function writeFileExplorerNodeDragPayload(
  dataTransfer: DataTransfer,
  payload: FileExplorerNodeDragPayload,
): void {
  // copyMove：树内 drop 目标可声明 move，避免悬停光标显示「复制 +」形态
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(FILE_EXPLORER_NODE_MIME, JSON.stringify(payload))
  // text/plain 兜底：拖到终端 / 外部文本框可得到路径
  dataTransfer.setData('text/plain', payload.absPath)
}

export function readFileExplorerNodeDragPayload(
  dataTransfer: DataTransfer | null,
): FileExplorerNodeDragPayload | null {
  if (dataTransfer == null) return null
  const raw = dataTransfer.getData(FILE_EXPLORER_NODE_MIME)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<FileExplorerNodeDragPayload>
    if (typeof value.relPath !== 'string' || value.relPath === ROOT_PATH) return null
    if (typeof value.absPath !== 'string' || value.absPath === '') return null
    if (typeof value.name !== 'string') return null
    if (value.type !== 'file' && value.type !== 'directory') return null
    return { relPath: value.relPath, absPath: value.absPath, name: value.name, type: value.type }
  } catch {
    return null
  }
}

export function hasFileExplorerNodeDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(FILE_EXPLORER_NODE_MIME) === true
}

// ── 拖拽进行中的源路径（dragstart 时写入，dragend 清除）──
// dragover 阶段规范上不保证 getData 可用，用模块级状态做「不能移到自身/子孙」的即时判定；
// drop 时仍以 payload 兜底校验（防外部构造的同 MIME 拖入）。
let activeDragRelPath: string | null = null

export function setActiveDragRelPath(relPath: string | null): void {
  activeDragRelPath = relPath
}

/** targetDir 能否作为移动目标（不能是源自身或其子孙目录） */
export function isAcceptableMoveTarget(targetDir: string): boolean {
  const src = activeDragRelPath
  if (src == null || src === ROOT_PATH) return true
  if (targetDir === src) return false
  return !targetDir.startsWith(src + '/')
}
