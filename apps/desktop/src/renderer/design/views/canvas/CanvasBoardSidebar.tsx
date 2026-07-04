import { useMemo, useState } from 'react'
import { Input, Tag, Tooltip, message, Modal } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasBoard, CanvasSnapshot } from './canvas.types'

/**
 * 左侧工作台「画布」tab（文档 §7.1 / §7.3）。
 *
 * 展示项目内全部 board，支持：新建 / 切换 / 重命名 / 复制 / 删除 / 设默认 / 排序。
 * board 缩略图用 settings.coverAssetId 对应的资产；无封面时用首字母占位。
 */
export function CanvasBoardSidebar({
  snapshot,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onDuplicateBoard,
  onSetDefaultBoard,
}: {
  snapshot: CanvasSnapshot
  activeBoardId: string
  onSelectBoard: (boardId: string) => void
  onCreateBoard: (input?: { name?: string }) => void
  onRenameBoard: (boardId: string, name: string) => void
  onDeleteBoard: (boardId: string) => Promise<void> | void
  onDuplicateBoard: (boardId: string, name?: string) => void
  onSetDefaultBoard: (boardId: string) => void
}) {
  const boards = useMemo(() => {
    const list = snapshot.boards ?? [snapshot.board]
    // 按 sortOrder 排序，无值则保持原顺序
    return [...list].sort(
      (a, b) => (a.settings?.sortOrder ?? 0) - (b.settings?.sortOrder ?? 0),
    )
  }, [snapshot.boards, snapshot.board])

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CanvasBoard | null>(null)
  const [deleting, setDeleting] = useState(false)

  const assetById = useMemo(
    () => new Map(snapshot.assets.map((asset) => [asset.id, asset])),
    [snapshot.assets],
  )
  // 各 board 节点数（用于列表辅助信息）
  const nodeCountByBoard = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of snapshot.nodes) {
      if (node.hidden) continue
      counts.set(node.boardId, (counts.get(node.boardId) ?? 0) + 1)
    }
    return counts
  }, [snapshot.nodes])

  const startRename = (board: CanvasBoard) => {
    setRenamingId(board.id)
    setRenameValue(board.name)
  }

  const commitRename = (boardId: string) => {
    const next = renameValue.trim()
    if (next.length > 0) onRenameBoard(boardId, next)
    setRenamingId(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await onDeleteBoard(deleteTarget.id)
      message.success(`已删除画布「${deleteTarget.name}」`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除画布失败')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="canvas-board-sidebar">
      <div className="canvas-board-sidebar-head">
        <span className="canvas-board-sidebar-title">画布</span>
        <Tooltip title="新建画布">
          <Button
            size="middle"
            type="text"
            icon={<Icons.Plus size={15} />}
            onClick={() => onCreateBoard()}
            aria-label="新建画布"
          />
        </Tooltip>
      </div>

      <div className="canvas-board-list">
        {boards.map((board) => {
          const isActive = board.id === activeBoardId
          const coverAsset = board.settings?.coverAssetId
            ? assetById.get(board.settings.coverAssetId)
            : undefined
          const count = nodeCountByBoard.get(board.id) ?? 0
          return (
            <div
              key={board.id}
              className={`canvas-board-item${isActive ? ' canvas-board-item-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectBoard(board.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectBoard(board.id)
                }
              }}
            >
              <div className="canvas-board-thumb">
                {coverAsset?.thumbnailUrl || coverAsset?.url ? (
                  <img src={coverAsset.thumbnailUrl ?? coverAsset.url ?? ''} alt="" />
                ) : (
                  <span>{board.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="canvas-board-main">
                {renamingId === board.id ? (
                  <Input
                    size="middle"
                    value={renameValue}
                    autoFocus
                    onChange={(event) => setRenameValue(event.target.value)}
                    onPressEnter={() => commitRename(board.id)}
                    onBlur={() => commitRename(board.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <div className="canvas-board-name">
                    <span className="canvas-board-name-text" title={board.name}>
                      {board.name}
                    </span>
                    {board.settings?.isDefault && (
                      <Tag color="gold" bordered className="canvas-board-default-tag">
                        默认
                      </Tag>
                    )}
                  </div>
                )}
                <div className="canvas-board-meta">{count} 节点</div>
              </div>
              <div className="canvas-board-actions" onClick={(event) => event.stopPropagation()}>
                <Tooltip title="重命名">
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Edit size={13} />}
                    onClick={() => startRename(board)}
                  />
                </Tooltip>
                <Tooltip title="复制画布">
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Copy size={13} />}
                    onClick={() => onDuplicateBoard(board.id)}
                  />
                </Tooltip>
                <Tooltip title="设为默认">
                  <Button
                    size="middle"
                    type="text"
                    disabled={Boolean(board.settings?.isDefault)}
                    icon={<Icons.Star size={13} />}
                    onClick={() => onSetDefaultBoard(board.id)}
                  />
                </Tooltip>
                <Tooltip title="删除画布">
                  <Button
                    size="middle"
                    type="text"
                    danger
                    disabled={boards.length <= 1}
                    icon={<Icons.Trash size={13} />}
                    onClick={() => setDeleteTarget(board)}
                  />
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        title="删除画布"
        open={Boolean(deleteTarget)}
        confirmLoading={deleting}
        okText="删除"
        okType="danger"
        cancelText="取消"
        onOk={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      >
        {deleteTarget && (
          <p>
            确认删除画布「{deleteTarget.name}」？该画布下的节点与任务将被移除，
            项目资产仍保留。此操作可在保存前撤销。
          </p>
        )}
      </Modal>
    </div>
  )
}
