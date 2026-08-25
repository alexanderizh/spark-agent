/**
 * 文件树单个节点行。
 *
 * 渲染：缩进 + 展开箭头（目录可点）+ 类型图标 + 名称（或内联重命名输入框）+ 复制徽标。
 * 外层包 lobehub Dropdown（trigger=contextMenu）挂右键菜单；菜单项由 buildNodeMenuItems 构造。
 * 剪切态半透明、复制态右侧小徽标，提供与 VSCode 一致的视觉反馈。
 *
 * 拖拽：所有节点可作为拖拽源（onNodeDragStart 写自定义 MIME payload）；
 * 目录节点额外是 drop 目标（悬停高亮 → onDropIntoDir 移入），文件节点阻止
 * 悬停/落下（stopPropagation 且不 preventDefault），避免误触树空白处的「移到根」。
 */

import { useState, type DragEvent, type ReactNode } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Icons } from '../../../Icons'
import { VscodeFileIcon } from '../VscodeFileIcon'
import { useFileClipboard } from './useFileClipboard'
import { buildNodeMenuItems, type FileMenuActions } from './FileNodeMenu'
import { InlineRenameInput } from './InlineRenameInput'
import { hasFileExplorerNodeDrag, isAcceptableMoveTarget } from './fileExplorerDnd'
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
  /** 拖拽源：写自定义 MIME payload（移动 / 拖入会话区共用） */
  onNodeDragStart: (node: FileExplorerNode, event: DragEvent<HTMLDivElement>) => void
  /** 拖拽结束（含松手与取消）；清理 dnd 模块的拖拽中源路径 */
  onNodeDragEnd: () => void
  /** drop 到目录节点 → 移入该目录（仅目录节点触发） */
  onDropIntoDir: (dirPath: string, event: DragEvent<HTMLDivElement>) => void
  /** 该行是否为当前拖拽源（拖动中） */
  dragging?: boolean
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
  onNodeDragStart,
  onNodeDragEnd,
  onDropIntoDir,
  dragging = false,
}: FileTreeNodeProps): ReactNode {
  const clipboard = useFileClipboard()
  const [dropActive, setDropActive] = useState(false)
  const isDir = node.type === 'directory'
  const isCut = clipboard?.mode === 'cut' && clipboard.path === node.path
  const isCopied = clipboard?.mode === 'copy' && clipboard.path === node.path
  const menu = buildNodeMenuItems(node, menuActions, clipboard)

  const handleClick = (): void => {
    if (rename != null) return // 编辑中不触发选中/展开
    if (isDir) onToggleDir(node.path)
    else onSelect(node.path)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasFileExplorerNodeDrag(event.dataTransfer)) return
    // 目录且非源自身/子孙：允许落下并高亮
    if (isDir && isAcceptableMoveTarget(node.path)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setDropActive(true)
      return
    }
    // 文件节点 / 非法目标：吞掉事件阻止冒泡到树空白处的「移到根」，但不允许落下
    event.stopPropagation()
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!isDir) return
    event.preventDefault()
    event.stopPropagation()
    setDropActive(false)
    onDropIntoDir(node.path, event)
  }

  const className = [
    'fe-node',
    selected ? 'selected' : '',
    isCut ? 'cut' : '',
    isCopied ? 'copied' : '',
    dropActive ? 'drop-target' : '',
    dragging ? 'dragging' : '',
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
        draggable={rename == null}
        onDragStart={(e) => {
          if (rename != null) {
            e.preventDefault()
            return
          }
          onNodeDragStart(node, e)
        }}
        onDragEnd={onNodeDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          if (hasFileExplorerNodeDrag(e.dataTransfer)) setDropActive(false)
        }}
        onDrop={handleDrop}
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
