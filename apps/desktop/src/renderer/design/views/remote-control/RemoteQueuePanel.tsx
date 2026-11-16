import type { SessionGetQueueResponse } from '@spark/protocol'
import { projectQueuedTurnsForDisplay } from '../chat/internal-turn-message-visibility'
import { Icons } from '../../Icons'

export function RemoteQueuePanel({ snapshot }: { snapshot: SessionGetQueueResponse | null }) {
  if (snapshot == null || snapshot.queuedTurns.length === 0) return null

  const turns = projectQueuedTurnsForDisplay(snapshot.queuedTurns)

  return (
    <div className="rc-queue-panel" role="status" aria-live="polite">
      <div className="rc-queue-head">
        <span className="rc-queue-title">
          <Icons.ListTodo size={13} />
          等待执行 · {turns.length}
        </span>
        {snapshot.paused != null && <span className="rc-queue-paused">队列已暂停</span>}
      </div>
      <div className="rc-queue-list">
        {turns.map((turn, index) => (
          <div className="rc-queue-item" key={turn.turnId}>
            <span className="rc-queue-index">{index + 1}</span>
            <span className="rc-queue-message" title={turn.message}>
              {turn.message || (turn.attachments?.length ? '附件消息' : '无文本内容')}
            </span>
            {(turn.attachments?.length ?? 0) > 0 && (
              <span className="rc-queue-attachments">附件 {turn.attachments?.length}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
