/**
 * GitChangesSection —— 更改板块：「已暂存 N」与「更改 N」两组可折叠文件列表。
 *
 * 平铺模式（默认）：文件行 = 文件类型图标 + 状态徽章 + 文件名（同名才带短目录消歧）
 *                   + ±行数（hover 时替换为操作按钮：暂存 / 取消暂存 / 打开 / 丢弃）。
 * 树形模式：按目录嵌套展示（目录行可折叠、默认展开），文件行不再需要消歧目录。
 * 组头带批量操作：全部暂存 / 全部取消暂存 / 贮藏 / 全部丢弃（丢弃走二次确认）。
 * 文件行支持右键菜单（通用 ContextMenu）：打开 / 添加到对话 / 复制路径 / 在 Finder（资源管理
 * 器）中显示 + 暂存（或取消暂存）/ 丢弃更改；两组各持一个菜单实例。
 */

import { useCallback, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { Icons } from '../../../Icons'
import { useToast } from '../../Toast'
import { ContextMenu } from '../../ContextMenu'
import { useContextMenu, type ContextMenuEntry } from '../../contextMenuModel'
import {
  OPEN_IN_FILE_MANAGER_LABEL,
  revealPathInFileManager,
  writeClipboardText,
} from '../file-explorer/fileExplorerActions'
import { VscodeFileIcon } from '../VscodeFileIcon'
import type { WorkspaceGitFileChange } from '@spark/protocol'
import {
  getGitChangeStatusCode,
  getGitChangeStatusBadgeClass,
  isGitReviewFileOpenable,
} from '../../../views/chat/ChatGitUtils'
import {
  buildGitPanelChangeTree,
  joinGitWorkspacePath,
  type GitPanelFileLabel,
  type GitPanelTreeDir,
  type GitPanelTreeEntry,
} from './gitPanelViewUtils'
import type { GitPanelActionName } from './useGitPanelActions'

/** 右键菜单目标：变更项 + 行显示名（丢弃确认文案用） */
export interface GitFileMenuTarget {
  change: WorkspaceGitFileChange
  name: string
}

interface GitFileRowProps {
  change: WorkspaceGitFileChange
  /** 主显示名：平铺取消歧 label.name，树形取 basename */
  name: string
  /** 消歧短目录（平铺模式，树形为 null） */
  dir: string | null
  /** 树形模式的缩进层级（平铺 0） */
  depth: number
  /** 所在组：staged 组提供「取消暂存」，changes 组提供「暂存 + 丢弃」 */
  group: 'staged' | 'changes'
  disabled: boolean
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onOpenFile: (path: string) => void
  onDiscardRequest: (paths: string[], label: string) => void
  /** 行右键打开文件菜单（不传则行不响应右键） */
  onOpenFileMenu?: ((event: ReactMouseEvent, target: GitFileMenuTarget) => void) | undefined
}

function GitFileRow({
  change,
  name,
  dir,
  depth,
  group,
  disabled,
  onStage,
  onUnstage,
  onOpenFile,
  onDiscardRequest,
  onOpenFileMenu,
}: GitFileRowProps) {
  const code = getGitChangeStatusCode(change)
  const openable = isGitReviewFileOpenable(change)
  const indentStyle: CSSProperties | undefined =
    depth > 0 ? { paddingLeft: 6 + depth * 13 } : undefined
  return (
    <div
      className="gp-file-row"
      style={indentStyle}
      title={change.path}
      onContextMenu={
        onOpenFileMenu != null ? (event) => onOpenFileMenu(event, { change, name }) : undefined
      }
    >
      <button
        type="button"
        className="gp-file-main"
        disabled={!openable}
        onClick={() => openable && onOpenFile(change.path)}
      >
        <span className="gp-file-type-icon">
          <VscodeFileIcon name={name} kind="file" size={14} />
        </span>
        <span className={`gp-file-badge ${getGitChangeStatusBadgeClass(code)}`}>{code}</span>
        {dir != null && <span className="gp-file-dir">{dir}</span>}
        <span className="gp-file-name">{name}</span>
      </button>
      <span className="gp-file-stats">
        <span className="gp-add">+{change.additions}</span>
        <span className="gp-del">-{change.deletions}</span>
      </span>
      <span className="gp-file-actions">
        {group === 'changes' && (
          <button
            type="button"
            className="gp-icon-btn"
            title="暂存"
            disabled={disabled}
            onClick={() => onStage([change.path])}
          >
            <Icons.Plus size={13} />
          </button>
        )}
        {group === 'staged' && (
          <button
            type="button"
            className="gp-icon-btn"
            title="取消暂存"
            disabled={disabled}
            onClick={() => onUnstage([change.path])}
          >
            <Icons.Minus size={13} />
          </button>
        )}
        {openable && (
          <button
            type="button"
            className="gp-icon-btn"
            title="在编辑器中打开（diff 视图）"
            disabled={disabled}
            onClick={() => onOpenFile(change.path)}
          >
            <Icons.Code size={13} />
          </button>
        )}
        {group === 'changes' && (
          <button
            type="button"
            className="gp-icon-btn danger"
            title="丢弃更改"
            disabled={disabled}
            onClick={() => onDiscardRequest([change.path], name)}
          >
            <Icons.X size={13} />
          </button>
        )}
      </span>
    </div>
  )
}

/**
 * 构造文件行右键菜单条目（通用 ContextMenu 的 entries）。
 *
 * 常规区：打开（diff 视图，已删除文件不可开）· 添加到对话（入口未接通时隐藏）· 复制路径
 *         · 在 Finder/资源管理器中显示（已删除文件与 root 未知时隐藏）；
 * Git 操作区（分割线分隔）：暂存 / 取消暂存（随所在组）· 丢弃更改（danger，走二次确认）。
 * Git 操作在写操作进行中（busy）时禁用。
 */
export function buildGitFileMenuEntries(input: {
  target: GitFileMenuTarget
  group: 'staged' | 'changes'
  /** git 写操作进行中（暂存/取消暂存/丢弃禁用） */
  disabled: boolean
  /** 工作区根目录绝对路径（复制路径用，null 时复制相对路径） */
  rootAbsPath: string | null
  onOpenFile: (path: string) => void
  onAddToChat?: ((relativePath: string) => void) | undefined
  onCopyPath: (relativePath: string) => void
  onOpenInFileManager?: ((relativePath: string) => void) | undefined
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscardRequest: (paths: string[], label: string) => void
}): ContextMenuEntry[] {
  const {
    target,
    group,
    disabled,
    onOpenFile,
    onAddToChat,
    onCopyPath,
    onOpenInFileManager,
    onStage,
    onUnstage,
    onDiscardRequest,
  } = input
  const { change, name } = target
  const entries: ContextMenuEntry[] = []
  if (isGitReviewFileOpenable(change)) {
    entries.push({
      key: 'open',
      label: '在编辑器中打开',
      icon: <Icons.Code size={14} />,
      onClick: () => onOpenFile(change.path),
    })
  }
  if (onAddToChat != null) {
    entries.push({
      key: 'add-to-chat',
      label: '添加到对话',
      icon: <Icons.MessageSquarePlus size={14} />,
      onClick: () => onAddToChat(change.path),
    })
  }
  entries.push({
    key: 'copy-path',
    label: '复制路径',
    icon: <Icons.Copy size={14} />,
    onClick: () => onCopyPath(change.path),
  })
  // 「在系统文件夹打开」需要文件真实存在于磁盘（已删除不可用），且 root 未知时无法拼绝对路径
  if (onOpenInFileManager != null && isGitReviewFileOpenable(change)) {
    entries.push({
      key: 'open-in-file-manager',
      label: OPEN_IN_FILE_MANAGER_LABEL,
      icon: <Icons.FolderOpen size={14} />,
      onClick: () => onOpenInFileManager(change.path),
    })
  }
  entries.push({ type: 'divider' })
  if (group === 'changes') {
    entries.push({
      key: 'stage',
      label: '暂存',
      icon: <Icons.Plus size={14} />,
      disabled,
      onClick: () => onStage([change.path]),
    })
    entries.push({
      key: 'discard',
      label: '丢弃更改',
      icon: <Icons.Undo2 size={14} />,
      danger: true,
      disabled,
      onClick: () => onDiscardRequest([change.path], name),
    })
  } else {
    entries.push({
      key: 'unstage',
      label: '取消暂存',
      icon: <Icons.Minus size={14} />,
      disabled,
      onClick: () => onUnstage([change.path]),
    })
  }
  return entries
}

/** 树形模式的目录行：可折叠（默认展开），右侧 pill 显示递归文件数。 */
function GitTreeDirRow({
  dir,
  depth,
  open,
  onToggle,
}: {
  dir: GitPanelTreeDir
  depth: number
  open: boolean
  onToggle: (path: string) => void
}) {
  return (
    <button
      type="button"
      className="gp-tree-dir"
      style={{ paddingLeft: 4 + depth * 13 }}
      onClick={() => onToggle(dir.path)}
      title={dir.path}
    >
      <Icons.ChevronRight size={13} className={`gp-tree-chevron${open ? ' open' : ''}`} />
      <span className="gp-file-type-icon">
        <VscodeFileIcon name={dir.name} kind="folder" open={open} size={15} />
      </span>
      <span className="gp-tree-dir-name">{dir.name}</span>
      <span className="gp-group-count">{dir.fileCount}</span>
    </button>
  )
}

interface GitGroupSectionProps {
  title: string
  files: WorkspaceGitFileChange[]
  labels: Map<string, GitPanelFileLabel>
  group: 'staged' | 'changes'
  viewMode: 'list' | 'tree'
  collapsed: boolean
  busy: GitPanelActionName | null
  /** 工作区根目录绝对路径（文件行右键「复制路径」用；null 时复制相对路径） */
  rootAbsPath: string | null
  /** 文件行右键「添加到对话」（可选：不传则菜单不显示对应项） */
  onAddToChat?: ((relativePath: string) => void) | undefined
  onToggle: () => void
  onStage: (paths?: string[]) => void
  onUnstage: (paths?: string[]) => void
  onOpenFile: (path: string) => void
  onDiscardRequest: (paths: string[], label: string) => void
  onStash?: (() => void) | undefined
}

/** 单个可折叠分组（已暂存 / 更改两组共用） */
export function GitGroupSection({
  title,
  files,
  labels,
  group,
  viewMode,
  collapsed,
  busy,
  rootAbsPath,
  onAddToChat,
  onToggle,
  onStage,
  onUnstage,
  onOpenFile,
  onDiscardRequest,
  onStash,
}: GitGroupSectionProps) {
  const disabled = busy != null
  const { toast } = useToast()
  // 树形模式的目录折叠状态（存「已折叠」的目录路径，默认全展开）；两组各自独立。
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const toggleDir = (path: string): void => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  // 文件行右键菜单：两组各持一个实例，互不串扰
  const { menu: fileMenu, open: openFileMenu, close: closeFileMenu } =
    useContextMenu<GitFileMenuTarget>()

  const handleCopyPath = useCallback(
    async (relativePath: string): Promise<void> => {
      try {
        // 与文件树「复制路径」同语义：复制绝对路径（root 未知时回退相对路径）
        await writeClipboardText(joinGitWorkspacePath(rootAbsPath, relativePath))
        toast.success('已复制路径')
      } catch {
        toast.error('复制路径失败')
      }
    },
    [rootAbsPath, toast],
  )

  // 「在系统文件夹打开」：打开所在目录并选中文件（root 未知时无法拼绝对路径，不提供该项）
  const handleOpenInFileManager = useCallback(
    (relativePath: string): void => {
      if (rootAbsPath == null) return
      void revealPathInFileManager(joinGitWorkspacePath(rootAbsPath, relativePath)).catch(() => {
        toast.error('打开系统文件夹失败')
      })
    },
    [rootAbsPath, toast],
  )

  const buildMenuEntries = useCallback(
    (target: GitFileMenuTarget): ContextMenuEntry[] =>
      buildGitFileMenuEntries({
        target,
        group,
        disabled,
        rootAbsPath,
        onOpenFile,
        onAddToChat,
        onCopyPath: (relativePath) => void handleCopyPath(relativePath),
        ...(rootAbsPath != null ? { onOpenInFileManager: handleOpenInFileManager } : {}),
        onStage,
        onUnstage,
        onDiscardRequest,
      }),
    [
      group,
      disabled,
      rootAbsPath,
      onOpenFile,
      onAddToChat,
      handleCopyPath,
      handleOpenInFileManager,
      onStage,
      onUnstage,
      onDiscardRequest,
    ],
  )

  const renderTreeRows = (entries: readonly GitPanelTreeEntry[], depth: number) =>
    entries.map((entry) =>
      entry.type === 'dir' ? (
        <div key={`dir:${entry.path}`}>
          <GitTreeDirRow
            dir={entry}
            depth={depth}
            open={!collapsedDirs.has(entry.path)}
            onToggle={toggleDir}
          />
          {!collapsedDirs.has(entry.path) && renderTreeRows(entry.children, depth + 1)}
        </div>
      ) : (
        <GitFileRow
          key={`file:${entry.change.path}`}
          change={entry.change}
          name={entry.change.path.split('/').pop() ?? entry.change.path}
          dir={null}
          depth={depth}
          group={group}
          disabled={disabled}
          onStage={(paths) => onStage(paths)}
          onUnstage={(paths) => onUnstage(paths)}
          onOpenFile={onOpenFile}
          onDiscardRequest={onDiscardRequest}
          onOpenFileMenu={openFileMenu}
        />
      ),
    )

  return (
    <div className={`gp-group${collapsed ? ' collapsed' : ''}`}>
      <div className="gp-group-head">
        <button type="button" className="gp-group-title" onClick={onToggle}>
          <Icons.ChevronDown size={13} className="gp-chevron" />
          <span className={`gp-group-dot ${group === 'staged' ? 'ok' : 'warn'}`} />
          <span>{title}</span>
          <span className="gp-group-count">{files.length}</span>
        </button>
        {files.length > 0 && (
          <span className="gp-group-actions">
            {group === 'changes' && onStash != null && (
              <button
                type="button"
                className="gp-icon-btn"
                title="贮藏全部更改（stash）"
                disabled={disabled}
                onClick={onStash}
              >
                <Icons.Package size={13} />
              </button>
            )}
            {group === 'changes' ? (
              <>
                <button
                  type="button"
                  className="gp-icon-btn"
                  title="全部暂存"
                  disabled={disabled}
                  onClick={() => onStage()}
                >
                  <Icons.Plus size={13} />
                </button>
                <button
                  type="button"
                  className="gp-icon-btn danger"
                  title="丢弃全部更改"
                  disabled={disabled}
                  onClick={() =>
                    onDiscardRequest(
                      files.map((f) => f.path),
                      `${files.length} 个文件`,
                    )
                  }
                >
                  <Icons.Undo2 size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="gp-icon-btn"
                title="取消全部暂存"
                disabled={disabled}
                onClick={() => onUnstage()}
              >
                <Icons.Minus size={13} />
              </button>
            )}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="gp-group-body">
          {viewMode === 'tree'
            ? renderTreeRows(buildGitPanelChangeTree(files), 0)
            : files.map((change) => {
                const label = labels.get(change.path)
                return (
                  <GitFileRow
                    key={`${group}:${change.path}`}
                    change={change}
                    name={label?.name ?? change.path.split('/').pop() ?? change.path}
                    dir={label?.shortDir ?? null}
                    depth={0}
                    group={group}
                    disabled={disabled}
                    onStage={(paths) => onStage(paths)}
                    onUnstage={(paths) => onUnstage(paths)}
                    onOpenFile={onOpenFile}
                    onDiscardRequest={onDiscardRequest}
                    onOpenFileMenu={openFileMenu}
                  />
                )
              })}
          {files.length === 0 && <div className="gp-group-empty">暂无文件</div>}
        </div>
      )}
      {fileMenu != null && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          ariaLabel="Git 文件操作菜单"
          items={buildMenuEntries(fileMenu.target)}
          onClose={closeFileMenu}
        />
      )}
    </div>
  )
}
