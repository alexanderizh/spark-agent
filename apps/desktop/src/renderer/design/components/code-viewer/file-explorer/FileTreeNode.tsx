/**
 * 文件树单个节点行。
 *
 * 渲染：缩进 + 展开箭头（目录可点）+ 类型图标 + 名称（或内联重命名输入框）+ 复制徽标。
 * 外层包 lobehub Dropdown（trigger=contextMenu）挂右键菜单；菜单项由 buildNodeMenuItems 构造。
 * 剪切态半透明、复制态右侧小徽标，提供与 VSCode 一致的视觉反馈。
 */

import type { ReactNode } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Icons } from '../../../Icons'
import { VscodeFileIcon } from '../VscodeFileIcon'
import { useFileClipboard } from './useFileClipboard'
import { buildNodeMenuItems, type FileMenuActions } from './FileNodeMenu'
import { InlineRenameInput } from './InlineRenameInput'
import type { FileExplorerNode } from './fileExplorerTypes'

export interface FileTreeNodeProps {
  node: FileExplorerNode
  expanded: boolean
  selected: boolean
  menuActions: FileMenuActions
  /** 非空时该行显示内联重命名输入框（替代名称） */
  rename?: { initialValue: string; selectNameOnly: boolean } | null
  onToggleDir: (path: string) => void
  onSelect: (path: string) => void
  onConfirmRename: (value: string) => void
  onCancelRename: () => void
}

export function FileTreeNode({
  node,
  expanded,
  selected,
  menuActions,
  rename,
  onToggleDir,
  onSelect,
  onConfirmRename,
  onCancelRename,
}: FileTreeNodeProps): ReactNode {
  const clipboard = useFileClipboard()
  const isDir = node.type === 'directory'
  const isCut = clipboard?.mode === 'cut' && clipboard.path === node.path
  const isCopied = clipboard?.mode === 'copy' && clipboard.path === node.path
  const menu = buildNodeMenuItems(node, menuActions, clipboard)

  const handleClick = (): void => {
    if (rename != null) return // 编辑中不触发选中/展开
    if (isDir) onToggleDir(node.path)
    else onSelect(node.path)
  }

  const className = [
    'fe-node',
    selected ? 'selected' : '',
    isCut ? 'cut' : '',
    isCopied ? 'copied' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <div
        className={className}
        style={{ paddingLeft: 8 + node.depth * 14 }}
        onClick={handleClick}
        onContextMenu={(e) => e.stopPropagation()}
        title={node.path}
      >
        <span className={`fe-chevron${isDir ? '' : ' invisible'}${expanded ? ' open' : ''}`}>
          <Icons.ChevronRight size={14} />
        </span>
        <span className="fe-icon">
          <VscodeFileIcon
            name={node.name}
            kind={isDir ? 'folder' : 'file'}
            open={expanded}
            size={isDir ? 15 : 14}
          />
        </span>
        {rename != null ? (
          <InlineRenameInput
            initialValue={rename.initialValue}
            selectNameOnly={rename.selectNameOnly}
            onConfirm={onConfirmRename}
            onCancel={onCancelRename}
          />
        ) : (
          <span className="fe-name">{node.name}</span>
        )}
        {isCopied && rename == null && (
          <span className="fe-badge" title="已复制">
            <Icons.Copy size={11} />
          </span>
        )}
      </div>
    </Dropdown>
  )
}
