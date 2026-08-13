/**
 * 文件树递归渲染（扁平展开，非嵌套递归）。
 *
 * 遍历 useFileExplorerTree 算好的 visiblePaths，逐行渲染 FileTreeNode。
 * rename/create 输入行：
 *   - rename：命中节点显示内联输入
 *   - create：在 parentDir 节点行紧接其后插入一行虚拟输入（图标按 file/directory）
 */

import type { ReactNode } from 'react'
import { Icons } from '../../../Icons'
import { FileTreeNode } from './FileTreeNode'
import { InlineRenameInput } from './InlineRenameInput'
import type { FileMenuActions } from './FileNodeMenu'
import { ROOT_PATH, type FileExplorerNode, type RenameTarget } from './fileExplorerTypes'

export interface FileTreeProps {
  nodes: Map<string, FileExplorerNode>
  visiblePaths: string[]
  expandedDirs: Set<string>
  selectedPath: string | null
  menuActions: FileMenuActions
  renameTarget: RenameTarget | null
  onToggleDir: (path: string) => void
  onSelect: (path: string) => void
  onConfirmRename: (value: string) => void
  onCancelRename: () => void
}

export function FileTree({
  nodes,
  visiblePaths,
  expandedDirs,
  selectedPath,
  menuActions,
  renameTarget,
  onToggleDir,
  onSelect,
  onConfirmRename,
  onCancelRename,
}: FileTreeProps): ReactNode {
  const createParentDir =
    renameTarget != null && renameTarget.kind !== 'rename' ? renameTarget.parentDir : null
  const createKind =
    renameTarget?.kind === 'create-file'
      ? 'file'
      : renameTarget?.kind === 'create-directory'
        ? 'directory'
        : null

  const rows: ReactNode[] = []
  let createInserted = false
  // root 下新建：虚拟行插在列表最前（root 节点本身不在 visiblePaths）
  if (createParentDir === ROOT_PATH && createKind != null) {
    rows.push(
      <CreateRow
        key="__create__"
        depth={1}
        kind={createKind}
        onConfirm={onConfirmRename}
        onCancel={onCancelRename}
      />,
    )
    createInserted = true
  }
  for (const path of visiblePaths) {
    const node = nodes.get(path)
    if (node == null) continue
    const renameSlot =
      renameTarget?.kind === 'rename' && renameTarget.path === path
        ? { initialValue: renameTarget.initialValue, selectNameOnly: node.type === 'file' }
        : null
    rows.push(
      <FileTreeNode
        key={path}
        node={node}
        expanded={expandedDirs.has(path)}
        selected={selectedPath === path}
        menuActions={menuActions}
        rename={renameSlot}
        onToggleDir={onToggleDir}
        onSelect={onSelect}
        onConfirmRename={onConfirmRename}
        onCancelRename={onCancelRename}
      />,
    )
    // 新建行紧接 parentDir 节点之后
    if (createParentDir != null && createKind != null && path === createParentDir && !createInserted) {
      rows.push(
        <CreateRow
          key="__create__"
          depth={node.depth + 1}
          kind={createKind}
          onConfirm={onConfirmRename}
          onCancel={onCancelRename}
        />,
      )
      createInserted = true
    }
  }
  // parentDir 不可见（折叠/空目录）时，新建行兜底追加
  if (createParentDir != null && createKind != null && !createInserted) {
    const parentNode = nodes.get(createParentDir)
    const depth = (parentNode?.depth ?? 0) + 1
    rows.push(
      <CreateRow
        key="__create__"
        depth={depth}
        kind={createKind}
        onConfirm={onConfirmRename}
        onCancel={onCancelRename}
      />,
    )
  }

  return <div className="fe-tree">{rows}</div>
}

function CreateRow({
  depth,
  kind,
  onConfirm,
  onCancel,
}: {
  depth: number
  kind: 'file' | 'directory'
  onConfirm: (value: string) => void
  onCancel: () => void
}): ReactNode {
  return (
    <div className="fe-node fe-create-row" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="fe-chevron invisible">
        <Icons.ChevronRight size={14} />
      </span>
      <span className="fe-icon">
        {kind === 'directory' ? <Icons.FolderClosed size={15} /> : <Icons.FilePlus size={14} />}
      </span>
      <InlineRenameInput
        initialValue=""
        selectNameOnly={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  )
}
