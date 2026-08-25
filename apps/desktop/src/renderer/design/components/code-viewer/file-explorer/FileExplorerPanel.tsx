/**
 * 文件树资源管理器容器。
 *
 * 组合 Toolbar + Tree + 删除确认框；
 * 实现全部 FileMenuActions（打开/复制路径/复制/剪切/粘贴/新建/重命名/删除/刷新）。
 *
 * 受控状态（expandedDirs）由外部持有以便 per-session 快照；
 * 内部状态：选中项、内联重命名目标、待确认删除项。
 * 文件操作 IPC 成功后由 watch 自动 reload 受影响目录，无需手动刷新。
 */

import { useState, type DragEvent } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Icons } from '../../../Icons'
import { ConfirmDialog } from '../../ConfirmDialog'
import { useToast } from '../../Toast'
import { FileTree } from './FileTree'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { buildEmptyMenuItems, type FileMenuActions } from './FileNodeMenu'
import { useFileClipboard, setFileClipboard } from './useFileClipboard'
import { useFileExplorerTree } from './useFileExplorerTree'
import {
  copyPath,
  createDirectoryPath,
  createFilePath,
  movePath,
  trashPath,
  writeClipboardText,
} from './fileExplorerActions'
import {
  hasFileExplorerNodeDrag,
  readFileExplorerNodeDragPayload,
  setActiveDragRelPath,
  writeFileExplorerNodeDragPayload,
  type FileExplorerNodeDragPayload,
} from './fileExplorerDnd'
import {
  baseName,
  parentPath,
  ROOT_PATH,
  type FileExplorerNode,
  type RenameTarget,
} from './fileExplorerTypes'

export interface FileExplorerPanelProps {
  workspaceId: string | null
  workspaceRootPath: string | null
  expandedDirs: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpenFile: (relativePath: string) => void
  // 右键菜单的显式「预览 / 编辑」入口（可选：不传则菜单不显示对应项）
  onPreviewFile?: ((relativePath: string) => void) | undefined
  onEditFile?: ((relativePath: string) => void) | undefined
  // 右键菜单「添加到对话」（可选：不传则菜单不显示对应项）
  onAddToChat?: ((relativePath: string) => void) | undefined
  /** 工具栏搜索按钮：切换到全局搜索面板（与文件树槽位互斥） */
  onOpenSearch: () => void
}

export function FileExplorerPanel({
  workspaceId,
  workspaceRootPath,
  expandedDirs,
  onExpandedChange,
  onOpenFile,
  onPreviewFile,
  onEditFile,
  onAddToChat,
  onOpenSearch,
}: FileExplorerPanelProps): ReactNode {
  const { toast } = useToast()
  const clipboard = useFileClipboard()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)
  /** 拖拽进行中的源节点路径（dragstart 写入 / dragend 清除），用于源行半透明反馈 */
  const [draggingPath, setDraggingPath] = useState<string | null>(null)

  const tree = useFileExplorerTree({
    workspaceId,
    enabled: workspaceId != null,
    expandedDirs,
    onExpandedChange,
  })

  const joinAbs = (rel: string): string => {
    if (workspaceRootPath == null) return rel
    if (rel === '') return workspaceRootPath
    const sep = workspaceRootPath.includes('\\') ? '\\' : '/'
    return workspaceRootPath + sep + rel.split('/').join(sep)
  }

  const openAndSelect = (p: string): void => {
    setSelectedPath(p)
    onOpenFile(p)
  }

  const expandDir = (dir: string): void => {
    if (dir !== '' && !expandedDirs.has(dir)) {
      onExpandedChange(new Set(expandedDirs).add(dir))
    }
  }

  // ── 拖拽移动（树内）──
  // 拖到目录节点 = 移入；拖到树空白处 = 移到根；拖到会话输入区 = 参考资源（由 ComposerV2 消费）。
  // 成功后 watch 自动 reload 受影响目录，无需手动刷新。
  const handleNodeDragStart = (node: FileExplorerNode, event: DragEvent<HTMLDivElement>): void => {
    if (node.path === ROOT_PATH) return
    setActiveDragRelPath(node.path)
    setDraggingPath(node.path)
    writeFileExplorerNodeDragPayload(event.dataTransfer, {
      relPath: node.path,
      absPath: joinAbs(node.path),
      name: node.name,
      type: node.type,
    })
  }

  const handleNodeDragEnd = (): void => {
    setActiveDragRelPath(null)
    setDraggingPath(null)
  }

  const moveNodeToDir = async (
    payload: FileExplorerNodeDragPayload,
    targetDir: string,
  ): Promise<void> => {
    if (workspaceId == null) return
    // 合法性兜底（dragover 已按拖拽中源路径拦截，这里防异常构造的 payload）
    if (targetDir === payload.relPath || targetDir.startsWith(payload.relPath + '/')) {
      toast.error('不能移动到自身或其子目录')
      return
    }
    const name = baseName(payload.relPath)
    const target = targetDir === ROOT_PATH ? name : `${targetDir}/${name}`
    if (target === payload.relPath) {
      toast.info('已在当前位置')
      return
    }
    // 'error' 策略：目标已存在即报错，绝不静默覆盖
    const res = await movePath(workspaceId, payload.relPath, target, 'error')
    if (res.ok) {
      toast.success(`已移动到 ${targetDir === ROOT_PATH ? '根目录' : baseName(targetDir)}`)
      setSelectedPath(target)
    } else {
      toast.error(res.error ?? '移动失败')
    }
  }

  const handleDropIntoDir = (dirPath: string, event: DragEvent<HTMLDivElement>): void => {
    const payload = readFileExplorerNodeDragPayload(event.dataTransfer)
    if (payload == null) return
    void moveNodeToDir(payload, dirPath)
  }

  const handleTreeScrollDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasFileExplorerNodeDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleTreeScrollDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasFileExplorerNodeDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    const payload = readFileExplorerNodeDragPayload(event.dataTransfer)
    if (payload == null) return
    void moveNodeToDir(payload, ROOT_PATH)
  }

  // ── FileMenuActions ──
  const menuActions: FileMenuActions = {
    onOpenFile: (p) => openAndSelect(p),
    ...(onPreviewFile != null ? { onPreviewFile: (p: string) => onPreviewFile(p) } : {}),
    ...(onEditFile != null ? { onEditFile: (p: string) => onEditFile(p) } : {}),
    ...(onAddToChat != null ? { onAddToChat: (p: string) => onAddToChat(p) } : {}),
    onCopyPath: async (p) => {
      try {
        await writeClipboardText(joinAbs(p))
        toast.success('已复制路径')
      } catch {
        toast.error('复制路径失败')
      }
    },
    onCopy: (p) => {
      const node = tree.nodes.get(p)
      setFileClipboard({ path: p, mode: 'copy', type: node?.type ?? 'file' })
      toast.success('已复制')
    },
    onCut: (p) => {
      const node = tree.nodes.get(p)
      setFileClipboard({ path: p, mode: 'cut', type: node?.type ?? 'file' })
      toast.success('已剪切')
    },
    onRename: (p) => setRenameTarget({ kind: 'rename', path: p, initialValue: baseName(p) }),
    onDelete: (p) => setConfirmDeletePath(p),
    onPasteInto: async (dir) => {
      const cb = clipboard
      if (cb == null || workspaceId == null) return
      const name = baseName(cb.path)
      const target = dir === '' ? name : `${dir}/${name}`
      if (cb.mode === 'cut') {
        // 剪切：同源跳过；目标已存在则报错（移动不应静默覆盖）
        if (target === cb.path) {
          toast.info('源与目标相同')
          return
        }
        const res = await movePath(workspaceId, cb.path, target, 'error')
        if (res.ok) {
          toast.success('已移动')
          setFileClipboard(null)
        } else {
          toast.error(res.error ?? '移动失败')
        }
        return
      }
      // 复制：rename 策略 → 目标已存在或同源时后端自动改名 _copy / _copy1 / _copy2 …
      const res = await copyPath(workspaceId, cb.path, target, 'rename')
      if (res.ok) {
        if (res.finalPath != null && res.finalPath !== target) {
          toast.success(`已复制为 ${baseName(res.finalPath)}`)
        } else {
          toast.success('已复制')
        }
      } else {
        toast.error(res.error ?? '复制失败')
      }
    },
    onCreateFile: (dir) => {
      expandDir(dir)
      setRenameTarget({ kind: 'create-file', parentDir: dir })
    },
    onCreateDirectory: (dir) => {
      expandDir(dir)
      setRenameTarget({ kind: 'create-directory', parentDir: dir })
    },
    onRefresh: () => tree.refresh(),
  }

  const handleConfirmRename = async (value: string): Promise<void> => {
    const rt = renameTarget
    setRenameTarget(null)
    if (rt == null || workspaceId == null) return
    try {
      if (rt.kind === 'rename') {
        const parent = parentPath(rt.path)
        const newPath = parent === '' ? value : `${parent}/${value}`
        if (newPath === rt.path) return
        const res = await movePath(workspaceId, rt.path, newPath, 'error')
        if (res.ok) {
          toast.success('已重命名')
          setSelectedPath(newPath)
        } else {
          toast.error(res.error ?? '重命名失败')
        }
      } else {
        const parent = rt.parentDir
        const newPath = parent === '' ? value : `${parent}/${value}`
        const res =
          rt.kind === 'create-file'
            ? await createFilePath(workspaceId, newPath)
            : await createDirectoryPath(workspaceId, newPath)
        if (res.ok) {
          toast.success('已创建')
          if (rt.kind === 'create-file') openAndSelect(newPath)
        } else {
          toast.error(res.error ?? '创建失败')
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    const p = confirmDeletePath
    setConfirmDeletePath(null)
    if (p == null || workspaceId == null) return
    const res = await trashPath(workspaceId, p)
    if (res.ok) toast.success('已删除到回收站')
    else toast.error(res.error ?? '删除失败')
  }

  const emptyMenu = buildEmptyMenuItems('', menuActions, clipboard)
  const showEmpty = !tree.loading && tree.error == null && tree.visiblePaths.length === 0

  return (
    <div className="fe-panel">
      <FileExplorerToolbar
        workspaceLabel={baseName(workspaceRootPath ?? '') || '项目'}
        onNewFile={() => menuActions.onCreateFile('')}
        onNewDirectory={() => menuActions.onCreateDirectory('')}
        onOpenSearch={onOpenSearch}
        onCollapseAll={() => onExpandedChange(new Set())}
        onRefresh={tree.refresh}
      />
      <Dropdown trigger={['contextMenu']} menu={emptyMenu} placement="bottomLeft">
        <div
          className="fe-tree-scroll"
          onDragOver={handleTreeScrollDragOver}
          onDrop={handleTreeScrollDrop}
        >
          {tree.loading && (
            <div className="fe-state">
              <Icons.Spinner size={16} className="fe-spin" /> 加载中…
            </div>
          )}
          {!tree.loading && tree.error != null && (
            <div className="fe-state fe-state-error">{tree.error}</div>
          )}
          {!tree.loading && tree.error == null && (
            <FileTree
              nodes={tree.nodes}
              visiblePaths={tree.visiblePaths}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              menuActions={menuActions}
              renameTarget={renameTarget}
              onToggleDir={tree.toggleDir}
              onSelect={openAndSelect}
              onConfirmRename={(v) => {
                void handleConfirmRename(v)
              }}
              onCancelRename={() => setRenameTarget(null)}
              onNodeDragStart={handleNodeDragStart}
              onNodeDragEnd={handleNodeDragEnd}
              onDropIntoDir={handleDropIntoDir}
              draggingPath={draggingPath}
            />
          )}
          {showEmpty && <div className="fe-state">暂无文件</div>}
        </div>
      </Dropdown>
      <ConfirmDialog
        open={confirmDeletePath != null}
        title="删除"
        danger
        confirmText="删除"
        description={
          confirmDeletePath != null
            ? `确定删除「${baseName(confirmDeletePath)}」？将移到系统回收站，可从回收站恢复。`
            : undefined
        }
        onOpenChange={(o) => {
          if (!o) setConfirmDeletePath(null)
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
