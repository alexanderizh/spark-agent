/**
 * 远程会话排队面板：直接复用本地会话的 QueuedTaskList（拖拽排序 / 编辑 /
 * 立即执行 / 移除 / 清空），只做一层「SessionQueuedTurn → QueuedMessage」投影。
 *
 * 投影沿用本地同一套规则（projectQueuedTurnsForDisplay + editable 口径）：
 * 内部排队轮（定时任务 / 目标模式 / 远端协作等）隐藏正文、不可编辑回填，
 * 但仍可排序 / 立即执行 / 移除。
 *
 * 与本地的已知差异：错误暂停恢复条（重试 / 跳过继续）远程端未提供对应操作，
 * paused 时仅显示徽标，不做恢复按钮。
 */
import type { SessionGetQueueResponse, SessionQueuedTurn } from '@spark/protocol'
import { projectQueuedTurnsForDisplay } from '../chat/internal-turn-message-visibility'
import { QueuedTaskList } from '../chat/QueuedTaskList'
import type { QueuedMessage } from '../chat/ChatComposerTypes'
import { fileNameOf } from './remoteRichContent'

/** 与本地 ComposerV2.mapQueuedTurns 同口径：把排队轮投影成队列条目。 */
export function remoteQueuedTurnsToMessages(turns: SessionQueuedTurn[]): QueuedMessage[] {
  return projectQueuedTurnsForDisplay(turns).map((turn) => ({
    id: turn.turnId,
    turnId: turn.turnId,
    content: turn.message,
    enqueuedAt: turn.enqueuedAt,
    attachments: (turn.attachments ?? []).map((attachment, index) => ({
      id: `${turn.turnId}-${index}`,
      // 排队轮附件只可能是 image/file（submitTurn 白名单收敛过）；directory 兜底按 file 展示
      type: attachment.type === 'image' ? 'image' : 'file',
      path: attachment.path,
      name: fileNameOf(attachment.path),
    })),
    sessionReferences: [],
    editable:
      turn.userMessageVisibility !== 'hidden' &&
      (turn.turnSource == null || turn.turnSource === 'user'),
    ...(turn.runtime != null ? { runtime: turn.runtime } : {}),
  }))
}

export interface RemoteQueuePanelProps {
  snapshot: SessionGetQueueResponse | null
  /** 任一队列操作在途（清空 / 重排）：整面板禁用，防并发写队列 */
  busy?: boolean
  clearing?: boolean
  reordering?: boolean
  onClear: () => void
  /** 编辑 = 撤回排队轮并把正文与附件回填输入框（宿主实现） */
  onEdit: (turn: SessionQueuedTurn) => void
  onSendNow: (turn: SessionQueuedTurn) => void
  onRemove: (turn: SessionQueuedTurn) => void
  onReorder: (turnIds: string[]) => void
}

export function RemoteQueuePanel({
  snapshot,
  busy = false,
  clearing = false,
  reordering = false,
  onClear,
  onEdit,
  onSendNow,
  onRemove,
  onReorder,
}: RemoteQueuePanelProps) {
  if (snapshot == null || snapshot.queuedTurns.length === 0) return null

  const projected = projectQueuedTurnsForDisplay(snapshot.queuedTurns)
  const byTurnId = new Map(projected.map((turn) => [turn.turnId, turn]))
  const messages = remoteQueuedTurnsToMessages(snapshot.queuedTurns)

  /** 回调按 turnId 找回投影后的 turn（含展示正文与附件路径），宿主据此操作 */
  const resolveTurn = (message: QueuedMessage): SessionQueuedTurn | null =>
    byTurnId.get(message.turnId) ?? null

  return (
    <div className="rc-queue-panel">
      {snapshot.paused != null && <span className="rc-queue-paused">队列已暂停</span>}
      <QueuedTaskList
        messages={messages}
        clearing={clearing}
        reordering={reordering || busy}
        paused={null}
        recovering={null}
        canRetry={false}
        onClear={onClear}
        onRetry={() => undefined}
        onResume={() => undefined}
        onEdit={(message) => {
          const turn = resolveTurn(message)
          if (turn != null) onEdit(turn)
        }}
        onSendNow={(message) => {
          const turn = resolveTurn(message)
          if (turn != null) onSendNow(turn)
        }}
        onRemove={(message) => {
          const turn = resolveTurn(message)
          if (turn != null) onRemove(turn)
        }}
        onReorder={(turnIds) => onReorder([...turnIds])}
      />
    </div>
  )
}
