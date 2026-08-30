import { useState } from 'react'
import type { SessionId } from '@spark/protocol'
import { RefreshCw } from 'lucide-react'
import { Button } from '@lobehub/ui'
import {
  useTeamReplayPlaybook,
  type ReplayEvent,
  type TeamReplayPlaybookMutationPayload,
} from './useTeamReplayPlaybook'
import './ReplayPlaybookPanel.less'

export interface ReplayPlaybookPanelProps {
  sessionId: SessionId | undefined
  discussionId: string | undefined
  activePlaybookId?: string
  canPropose?: boolean
  canGovern?: boolean
}

export function ReplayPlaybookPanel({
  sessionId,
  discussionId,
  activePlaybookId,
  canPropose = true,
  canGovern = true,
}: ReplayPlaybookPanelProps) {
  const replay = useTeamReplayPlaybook(sessionId, discussionId, activePlaybookId)
  const [branchId, setBranchId] = useState('review-branch')
  const [branchSourceSeq, setBranchSourceSeq] = useState(0)
  const [diffFromSeq, setDiffFromSeq] = useState(0)
  const [diffToSeq, setDiffToSeq] = useState(0)

  const runMutation = async (payload: TeamReplayPlaybookMutationPayload) => {
    try {
      await replay.mutate(payload)
    } catch {
      // The hook exposes the error and conflict state for the panel to render.
    }
  }

  const currentPlaybook = replay.playbook ?? replay.playbooks[0] ?? null
  const canMutate = canGovern && currentPlaybook != null
  const timelineStatus = replay.timeline?.status ?? 'unknown'
  const timelineEvents = replay.timeline?.events ?? []
  const showEmptyTimeline = timelineEvents.length === 0 || (replay.error != null && replay.conflict)

  return (
    <section className="replay-playbook-panel" aria-busy={replay.loading}>
      <div className="replay-playbook-panel__header">
        <h2>Replay 与 Playbook</h2>
        <Button
          type="text"
          size="small"
          aria-label="重新加载 Replay 与 Playbook"
          onClick={() => void replay.refresh()}
          disabled={replay.loading}
        >
          <RefreshCw size={15} aria-hidden />
        </Button>
      </div>

      {replay.loading && <p role="status">正在加载 Replay 与 Playbook…</p>}
      {replay.error && (
        <div className="replay-playbook-panel__error" role="alert">
          {replay.conflict && <strong>数据版本冲突</strong>}
          <span>{replay.error}</span>
        </div>
      )}

      <div className="replay-playbook-panel__replay" data-replay-timeline>
        <div className="replay-playbook-panel__section-heading">
          <h3>Replay 时间线</h3>
          <span>
            数据状态：{timelineStatus === 'unknown' ? '未知数据' : '部分数据（可能存在未同步字段）'}
          </span>
        </div>

        {showEmptyTimeline ? (
          <p className="replay-playbook-panel__empty">暂无 Replay 事件</p>
        ) : (
          <ol className="replay-playbook-panel__timeline">
            {timelineEvents.map((event) => (
              <ReplayEventRow key={event.id} event={event} />
            ))}
          </ol>
        )}

        <div className="replay-playbook-panel__controls">
          <label>
            游标
            <input
              aria-label="Replay 游标"
              value={replay.timeline?.cursor ?? ''}
              readOnly
              placeholder="无游标"
            />
          </label>
          <label>
            分支 ID
            <input
              aria-label="分支 ID"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            />
          </label>
          <label>
            起始序号
            <input
              aria-label="分支起始序号"
              type="number"
              min={0}
              value={branchSourceSeq}
              onChange={(event) => setBranchSourceSeq(Number(event.target.value) || 0)}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void replay.fork({
                branchId,
                sourceSeq: branchSourceSeq,
                reason: 'Manual branch from Replay timeline',
              })
            }
            disabled={sessionId == null || discussionId == null || !branchId.trim()}
          >
            创建分支
          </button>
        </div>

        <div className="replay-playbook-panel__diff-controls">
          <label>
            Diff 起点
            <input
              aria-label="Diff 起点"
              type="number"
              min={0}
              value={diffFromSeq}
              onChange={(event) => setDiffFromSeq(Number(event.target.value) || 0)}
            />
          </label>
          <label>
            Diff 终点
            <input
              aria-label="Diff 终点"
              type="number"
              min={0}
              value={diffToSeq}
              onChange={(event) => setDiffToSeq(Number(event.target.value) || 0)}
            />
          </label>
          <button
            type="button"
            onClick={() => void replay.loadDiff({ fromSeq: diffFromSeq, toSeq: diffToSeq })}
            disabled={sessionId == null || discussionId == null}
          >
            查看 Diff
          </button>
        </div>
        {replay.branch && <p>当前分支：{replay.branch.id}</p>}
        {replay.diff && (
          <p>
            Diff：序号 {replay.diff.fromSeq}–{replay.diff.toSeq}，{replay.diff.events.length} 个事件
          </p>
        )}
      </div>

      <div className="replay-playbook-panel__playbook" data-playbook-list>
        <div className="replay-playbook-panel__section-heading">
          <h3>Playbook 治理</h3>
          {!canPropose && !canGovern && <span>当前角色无治理权限</span>}
        </div>

        {currentPlaybook == null ? (
          <p className="replay-playbook-panel__empty">暂无 Playbook</p>
        ) : (
          <article className="replay-playbook-panel__card">
            <h4>{currentPlaybook.name}</h4>
            <p>
              版本 {currentPlaybook.version} · 状态：{currentPlaybook.status}
            </p>
            <div className="replay-playbook-panel__actions">
              <button
                type="button"
                disabled={!canPropose || replay.mutatingKey != null}
                onClick={() =>
                  void runMutation({
                    action: 'propose',
                    id: currentPlaybook.id,
                    name: currentPlaybook.name,
                    graph: currentPlaybook.graph,
                    roles: currentPlaybook.roles,
                    handoffRules: currentPlaybook.handoffRules,
                    gateRules: currentPlaybook.gateRules,
                    deliberationRules: currentPlaybook.deliberationRules,
                  })
                }
              >
                提议
              </button>
              <button
                type="button"
                disabled={!canMutate || replay.mutatingKey != null}
                onClick={() =>
                  void runMutation({
                    action: 'publish',
                    id: currentPlaybook.id,
                    expectedVersion: currentPlaybook.version,
                  })
                }
              >
                发布
              </button>
              <button
                type="button"
                disabled={!canMutate || replay.mutatingKey != null}
                onClick={() =>
                  void runMutation({
                    action: 'apply',
                    id: currentPlaybook.id,
                    expectedVersion: currentPlaybook.version,
                    targetDiscussionId: discussionId ?? '',
                  })
                }
              >
                应用
              </button>
              <button
                type="button"
                disabled={!canMutate || replay.mutatingKey != null}
                onClick={() =>
                  void runMutation({
                    action: 'archive',
                    id: currentPlaybook.id,
                    expectedVersion: currentPlaybook.version,
                  })
                }
              >
                归档
              </button>
            </div>
          </article>
        )}

        {replay.playbooks.length > 1 && (
          <ul>
            {replay.playbooks.map((item) => (
              <li key={`${item.id}-${item.version}`}>
                {item.name} · v{item.version} · {item.status}
              </li>
            ))}
          </ul>
        )}
        {replay.applications.length > 0 && <p>已应用记录：{replay.applications.length}</p>}
        {!canPropose && canGovern && <p>当前角色无提议权限</p>}
        {replay.mutatingKey && <p role="status">正在提交变更…</p>}
      </div>
    </section>
  )
}

function ReplayEventRow({ event }: { event: ReplayEvent }) {
  return (
    <li className="replay-playbook-panel__event">
      <time dateTime={event.time}>{event.time}</time>
      <span>{event.actor}</span>
      <strong>{event.action}</strong>
      {event.evidenceRefs.length > 0 && <small>证据：{event.evidenceRefs.join(', ')}</small>}
    </li>
  )
}
