/**
 * 文件树右键菜单项构造。
 *
 * 返回 lobehub Dropdown 的 menu 配置（{ items }）。
 * 分两种：节点右键（打开/复制路径/复制/剪切/粘贴/新建/重命名/删除）
 *         空白右键（新建文件/文件夹/粘贴/刷新）。
 *
 * 注：item() 的 danger 采用必填默认 false（而非可选），避免 exactOptionalPropertyTypes 下
 * `boolean | undefined` 与 Dropdown menu 项类型不兼容；返回内联推断类型，与 ClickableFilePath
 * 的菜单构造方式保持一致。
 */

import type { ReactNode } from 'react'
import { Icons } from '../../../Icons'
import { canOpenInEditor, canOpenPreview } from '../../fileOpenRouting'
import type { FileClipboardEntry, FileExplorerNode } from './fileExplorerTypes'

/** 文件树菜单触发的全部动作（由 FileExplorerPanel 实现） */
export interface FileMenuActions {
  onOpenFile: (path: string) => void
  // 显式「预览 / 编辑」入口（可选：不传则菜单不显示对应项）
  onPreviewFile?: (path: string) => void
  onEditFile?: (path: string) => void
  onCopyPath: (path: string) => void
  onCopy: (path: string) => void
  onCut: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onPasteInto: (dirPath: string) => void
  onCreateFile: (dirPath: string) => void
  onCreateDirectory: (dirPath: string) => void
  onRefresh: () => void
}

interface NodeMenuItem {
  key: string
  label: ReactNode
  onClick: () => void
  danger: boolean
}

function item(icon: ReactNode, text: string, onClick: () => void, danger = false): NodeMenuItem {
  return {
    key: text,
    label: (
      <span className="fe-menu-item">
        {icon}
        <span>{text}</span>
      </span>
    ),
    onClick,
    danger,
  }
}

/** 节点右键菜单（根据 文件/目录、是否有剪贴板内容动态构造） */
export function buildNodeMenuItems(
  node: FileExplorerNode,
  actions: FileMenuActions,
  clipboard: FileClipboardEntry | null,
): { items: NodeMenuItem[] } {
  const isDir = node.type === 'directory'
  const items: NodeMenuItem[] = []
  if (!isDir) {
    items.push(item(<Icons.ExternalLink size={14} />, '打开', () => actions.onOpenFile(node.path)))
    // 可预览（md/html/office/图片等）显示「预览」；Monaco 可编辑的显示「编辑」，
    // 供用户显式选择打开方式（单击默认按统一路由预览优先分流）
    if (actions.onPreviewFile != null && canOpenPreview(node.path)) {
      items.push(item(<Icons.Eye size={14} />, '预览', () => actions.onPreviewFile?.(node.path)))
    }
    if (actions.onEditFile != null && canOpenInEditor(node.path)) {
      items.push(item(<Icons.Edit size={14} />, '编辑', () => actions.onEditFile?.(node.path)))
    }
  }
  items.push(item(<Icons.Copy size={14} />, '复制路径', () => actions.onCopyPath(node.path)))
  items.push(item(<Icons.Copy size={14} />, '复制', () => actions.onCopy(node.path)))
  items.push(item(<Icons.Scissors size={14} />, '剪切', () => actions.onCut(node.path)))
  if (isDir && clipboard != null) {
    items.push(item(<Icons.FolderPlus size={14} />, '粘贴', () => actions.onPasteInto(node.path)))
  }
  if (isDir) {
    items.push(item(<Icons.FilePlus size={14} />, '新建文件', () => actions.onCreateFile(node.path)))
    items.push(
      item(<Icons.FolderPlus size={14} />, '新建文件夹', () => actions.onCreateDirectory(node.path)),
    )
  }
  items.push(item(<Icons.Edit size={14} />, '重命名', () => actions.onRename(node.path)))
  items.push(item(<Icons.Trash size={14} />, '删除', () => actions.onDelete(node.path), true))
  return { items }
}

/** 空白处右键菜单（新建 / 粘贴 / 刷新）；targetDir 为粘贴/新建的目标目录 */
export function buildEmptyMenuItems(
  targetDir: string,
  actions: FileMenuActions,
  clipboard: FileClipboardEntry | null,
): { items: NodeMenuItem[] } {
  const items: NodeMenuItem[] = [
    item(<Icons.FilePlus size={14} />, '新建文件', () => actions.onCreateFile(targetDir)),
    item(<Icons.FolderPlus size={14} />, '新建文件夹', () => actions.onCreateDirectory(targetDir)),
  ]
  if (clipboard != null) {
    items.push(item(<Icons.FolderPlus size={14} />, '粘贴', () => actions.onPasteInto(targetDir)))
  }
  items.push(item(<Icons.Refresh size={14} />, '刷新', () => actions.onRefresh()))
  return { items }
}
