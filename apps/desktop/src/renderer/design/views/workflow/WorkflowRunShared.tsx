/**
 * @module WorkflowRunShared
 *
 * 工作流「运行明细」共享渲染：运行历史面板与编辑器试跑面板复用同一套
 * 节点行/状态徽标/时长格式化，保证历史回看与实时试跑的视觉语言一致。
 */

import { useState } from 'react'
import type { WorkflowProgressNode, WorkflowRunSummaryItem } from '@spark/protocol'
import { Icons } from '../../Icons'

/** 毫秒 → 人读时长：与实时进度卡同一套口语化格式（<1s / 12s / 2m05s / 1h03m）。 */
export function formatRunDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '<1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

export function formatRunClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const clock = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return sameYear ? clock : `${date.getFullYear()}-${clock}`
}

export const RUN_STATUS_META: Record<
  WorkflowRunSummaryItem['status'],
  { label: string; className: string }
> = {
  working: { label: '运行中', className: 'is-working' },
  completed: { label: '已完成', className: 'is-completed' },
  failed: { label: '失败', className: 'is-failed' },
  canceled: { label: '已取消', className: 'is-canceled' },
}

const NODE_STATUS_ICON: Record<WorkflowProgressNode['status'], 'check' | 'x' | 'minus' | 'dot'> = {
  completed: 'check',
  failed: 'x',
  skipped: 'minus',
  running: 'dot',
  pending: 'dot',
}

export function RunNodeRow({ node }: { node: WorkflowProgressNode }) {
  const [expanded, setExpanded] = useState(false)
  const durationMs =
    node.startedAt != null && node.endedAt != null
      ? Date.parse(node.endedAt) - Date.parse(node.startedAt)
      : Number.NaN
  const duration = formatRunDuration(durationMs)
  const expandable = node.outputPreview != null && node.outputPreview.length > 0
  const iconKind = NODE_STATUS_ICON[node.status]
  return (
    <div className={`wf-run-node ${node.status}`}>
      <div
        className={`wf-run-node-head ${expandable ? 'is-expandable' : ''}`}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? () => setExpanded((value) => !value) : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setExpanded((value) => !value)
                }
              }
            : undefined
        }
      >
        <span className="wf-run-node-icon" aria-hidden="true">
          {iconKind === 'check' && <Icons.Check size={12} />}
          {iconKind === 'x' && <Icons.X size={12} />}
          {iconKind === 'minus' && <Icons.Minus size={12} />}
          {iconKind === 'dot' && <span className="wf-run-node-dot" />}
        </span>
        <span className="wf-run-node-title" title={node.title}>
          {node.title}
        </span>
        {node.agentName != null && <span className="wf-run-node-agent">{node.agentName}</span>}
        {duration.length > 0 && <span className="wf-run-node-duration">{duration}</span>}
        {expandable && (
          <Icons.ChevronRight size={11} className={`wf-run-chevron ${expanded ? 'is-open' : ''}`} />
        )}
      </div>
      {node.error != null && (
        <div className="wf-run-node-error">
          {node.error.code != null && node.error.code.length > 0 ? `[${node.error.code}] ` : ''}
          {node.error.message}
        </div>
      )}
      {expanded && node.outputPreview != null && (
        <pre className="wf-run-node-output">{node.outputPreview}</pre>
      )}
    </div>
  )
}
