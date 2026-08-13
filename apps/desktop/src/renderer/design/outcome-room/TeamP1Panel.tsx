import type { SessionId } from '@spark/protocol'
import { useTeamP1 } from './useTeamP1'
import { Button } from '@lobehub/ui'
import './TeamP1Panel.less'
import { RefreshCw } from 'lucide-react'


export function TeamP1Panel({ sessionId }: { sessionId: SessionId | undefined }) {
  const { snapshot, loading, error, refresh, mutate } = useTeamP1(sessionId)
  const activeSnapshot = snapshot?.discussionId == null ? null : snapshot
  const discussionId = activeSnapshot?.discussionId
  if (sessionId == null) return null
  return (
    <section className="team-p1-panel" aria-label="交接与 Steering Gate">
      <header>
        <strong>交接与 Steering Gate</strong>
        <Button
          type="text"
          size='small'
          aria-label="重新加载交接与 Steering Gate"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} aria-hidden />
        </Button>
      </header>
      {loading && snapshot == null && <p aria-busy="true">正在加载交接与 Steering Gate…</p>}
      {error != null && <p role="alert">{error}</p>}
      {snapshot == null && !loading && error == null && <p>暂无团队讨论数据。</p>}
      {snapshot != null && activeSnapshot == null && !loading && error == null && (
        <p>当前会话尚未建立团队讨论。</p>
      )}
      {activeSnapshot != null &&
        activeSnapshot.handoffs.length === 0 &&
        activeSnapshot.gates.length === 0 &&
        !loading && <p className='team-p1-panel-no-content'>暂无交接或 Steering Gate。</p>}
      {activeSnapshot != null && discussionId != null && (
        <div className="team-p1-panel__columns">
          <div>
            <h4>Typed Handoff（{activeSnapshot.handoffs.length}）</h4>
            {activeSnapshot.handoffs.map((handoff) => (
              <article key={handoff.id}>
                <strong>{handoff.purpose}</strong>
                <span>
                  {handoff.senderId} → {handoff.recipientId} · {handoff.status} · v{handoff.version}
                </span>
                {handoff.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() =>
                      void mutate({
                        expectedDiscussionId: discussionId,
                        kind: 'handoff',
                        action: 'submit',
                        id: handoff.id,
                        expectedVersion: handoff.version,
                      })
                    }
                  >
                    提交
                  </button>
                )}
                {handoff.status === 'submitted' && (
                  <button
                    type="button"
                    onClick={() =>
                      void mutate({
                        expectedDiscussionId: discussionId,
                        kind: 'handoff',
                        action: 'accept',
                        id: handoff.id,
                        expectedVersion: handoff.version,
                      })
                    }
                  >
                    接受
                  </button>
                )}
              </article>
            ))}
          </div>
          <div>
            <h4>Steering Gate（{activeSnapshot.gates.length}）</h4>
            {activeSnapshot.gates.map((gate) => (
              <article key={gate.id}>
                <strong>{gate.trigger}</strong>
                <span>
                  {gate.reason} · {gate.impact} · {gate.status} · v{gate.version}
                </span>
                {gate.status === 'waiting' && (
                  <button
                    type="button"
                    onClick={() =>
                      void mutate({
                        expectedDiscussionId: discussionId,
                        kind: 'gate',
                        action: 'approve',
                        id: gate.id,
                        expectedVersion: gate.version,
                      })
                    }
                  >
                    批准
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
