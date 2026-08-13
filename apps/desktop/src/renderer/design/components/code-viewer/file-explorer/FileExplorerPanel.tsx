/**
 * 文件树资源管理器容器。
 *
 * 组合 Toolbar + SearchBox + Tree/SearchResults + 删除确认框；
 * 实现全部 FileMenuActions（打开/复制路径/复制/剪切/粘贴/新建/重命名/删除/刷新）。
 *
 * 受控状态（expandedDirs）由外部持有以便 per-session 快照；
 * 内部状态：搜索开关/关键词、选中项、内联重命名目标、待确认删除项。
 * 文件操作 IPC 成功后由 watch 自动 reload 受影响目录，无需手动刷新。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Icons } from '../../../Icons'
import { FileTypeIcon } from '../../FileDisplay'
import { ConfirmDialog } from '../../ConfirmDialog'
import { useToast } from '../../Toast'
import { FileTree } from './FileTree'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { FileSearchBox } from './FileSearchBox'
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
import { baseName, parentPath, type FileExplorerNode, type RenameTarget } from './fileExplorerTypes'

export interface FileExplorerPanelProps {
  workspaceId: string | null
  workspaceRootPath: string | null
  expandedDirs: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpenFile: (relativePath: string) => void
}

export function FileExplorerPanel({
  workspaceId,
  workspaceRootPath,
  expandedDirs,
  onExpandedChange,
  onOpenFile,
}: FileExplorerPanelProps): ReactNode {
  const { toast } = useToast()
  const clipboard = useFileClipboard()
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)

  const tree = useFileExplorerTree({
    workspaceId,
    enabled: workspaceId != null,
    expandedDirs,
    onExpandedChange,
    searchQuery,
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

  // ── FileMenuActions ──
  const menuActions: FileMenuActions = {
    onOpenFile: (p) => openAndSelect(p),
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

  const handleToggleSearch = (): void => {
    if (searchActive) {
      setSearchActive(false)
      setSearchQuery('')
    } else {
      setSearchActive(true)
    }
  }

  const emptyMenu = buildEmptyMenuItems('', menuActions, clipboard)
  const isSearching = searchActive && searchQuery.trim() !== ''
  const showEmpty =
    !tree.loading && tree.error == null && !isSearching && tree.visiblePaths.length === 0

  return (
    <div className="fe-panel">
      <FileExplorerToolbar
        workspaceLabel={baseName(workspaceRootPath ?? '') || '项目'}
        searchActive={searchActive}
        onNewFile={() => menuActions.onCreateFile('')}
        onNewDirectory={() => menuActions.onCreateDirectory('')}
        onToggleSearch={handleToggleSearch}
        onCollapseAll={() => onExpandedChange(new Set())}
        onRefresh={tree.refresh}
      />
      {searchActive && (
        <FileSearchBox
          value={searchQuery}
          onChange={setSearchQuery}
          onClose={() => {
            setSearchActive(false)
            setSearchQuery('')
          }}
        />
      )}
      <Dropdown trigger={['contextMenu']} menu={emptyMenu} placement="bottomLeft">
        <div className="fe-tree-scroll">
          {tree.loading && (
            <div className="fe-state">
              <Icons.Spinner size={16} className="fe-spin" /> 加载中…
            </div>
          )}
          {!tree.loading && tree.error != null && (
            <div className="fe-state fe-state-error">{tree.error}</div>
          )}
          {!tree.loading && tree.error == null && isSearching && (
            <SearchResults
              nodes={tree.nodes}
              matches={tree.searchMatches}
              selectedPath={selectedPath}
              onSelect={openAndSelect}
            />
          )}
          {!tree.loading && tree.error == null && !isSearching && (
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

/** 搜索结果列表（仅文件可点击打开；目录不展示，避免误点） */
function SearchResults({
  nodes,
  matches,
  selectedPath,
  onSelect,
}: {
  nodes: Map<string, FileExplorerNode>
  matches: string[]
  selectedPath: string | null
  onSelect: (path: string) => void
}): ReactNode {
  const fileMatches = matches.filter((p) => nodes.get(p)?.type === 'file')
  if (fileMatches.length === 0) {
    return <div className="fe-state">无匹配文件</div>
  }
  return (
    <div className="fe-tree fe-search-results">
      {fileMatches.map((p) => {
        const node = nodes.get(p)
        if (node == null) return null
        return (
          <div
            key={p}
            className={`fe-node${selectedPath === p ? ' selected' : ''}`}
            style={{ paddingLeft: 22 }}
            title={p}
            onClick={() => onSelect(p)}
          >
            <span className="fe-chevron invisible">
              <Icons.ChevronRight size={14} />
            </span>
            <span className="fe-icon">
              <FileTypeIcon filePath={p} size={14} />
            </span>
            <span className="fe-name">{node.name}</span>
          </div>
        )
      })}
    </div>
  )
}
