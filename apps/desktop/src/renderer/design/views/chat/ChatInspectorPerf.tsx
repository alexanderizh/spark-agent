import { useEffect, useMemo, useState } from 'react'
import './ChatInspectorPerf.less'
import { buildSessionPerf, type TurnPerfRow } from './ChatViewUtils'
import type { TurnPromptSnapshotEvent } from '@spark/protocol'

function formatTokensPerSecond(value: number): string {
  return value >= 100 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1)
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** 中断类行的状态文案（不参与吞吐统计，展示保持信息量） */
const INTERRUPTED_LABEL: Partial<Record<TurnPerfRow['status'], string>> = {
  cancelled: '中断',
  error: '错误',
  unknown: '未记录',
}

function rowTooltip(row: TurnPerfRow): string {
  const lines = [`第 ${row.turnNumber} 轮 · ${row.model}`]
  if (row.tokensPerSecond != null) {
    lines.push(
      `吞吐 ${formatTokensPerSecond(row.tokensPerSecond)} tok/s（输出 ${row.outputTokens ?? '—'} tokens / 纯生成 ${
        row.streamActiveMs != null ? formatMs(row.streamActiveMs) : '—'
      }）`,
    )
  } else {
    lines.push(`吞吐未测（${row.streamActiveMs != null ? '无输出 token 计量' : '无可观测流输出'}）`)
  }
  lines.push(
    `首输出 ${row.ttftMs != null ? formatMs(row.ttftMs) : '—'} · 轮次 ${
      row.turnDurationMs != null ? formatMs(row.turnDurationMs) : '—'
    }`,
  )
  return lines.join('\n')
}

/** 运行中轮的秒级跳动（仅存在 live 行时挂定时器，面板关闭/轮结束自动停）。 */
function useLiveElapsedSeconds(startedAtIso: string | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null)
  useEffect(() => {
    if (startedAtIso == null) {
      setElapsed(null)
      return
    }
    const startedAt = new Date(startedAtIso).getTime()
    if (!Number.isFinite(startedAt)) {
      setElapsed(null)
      return
    }
    const update = () => setElapsed(Math.max(0, (Date.now() - startedAt) / 1000))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [startedAtIso])
  return elapsed
}

export function ChatInspectorPerf({
  snapshots,
  isSessionRunning,
}: {
  snapshots: TurnPromptSnapshotEvent[]
  isSessionRunning: boolean
}) {
  const perf = useMemo(
    () => buildSessionPerf(snapshots, isSessionRunning),
    [snapshots, isSessionRunning],
  )

  const liveStartedAt =
    perf.liveRow != null ? liveStartedTimestamp(snapshots, perf.liveRow.turnId) : null
  const liveElapsed = useLiveElapsedSeconds(liveStartedAt)

  if (perf.totalTurns === 0) return null

  // 慢轮判定只在样本足够时启用（≥3 个可测吞吐轮，否则中位数不稳）
  const measurableCount = perf.rows.filter(
    (row) => row.status === 'completed' && row.tokensPerSecond != null,
  ).length
  const slowEnabled = perf.slowTokensPerSecond != null && measurableCount >= 3

  // live 行的边界口径吞吐：usage_update 已合并 outputTokens + streamActiveMs 时即可算，
  // 首段流式期间（尚无 usage 上报）如实显示 —
  const liveTps = perf.liveRow != null ? liveTokensPerSecond(perf.liveRow) : null

  const shownRows = perf.rows
  const maxTokensPerSecond = Math.max(...shownRows.map((row) => row.tokensPerSecond ?? 0), 0.1)

  return (
    <div className="inspector-section chat-inspector-perf">
      <h4>
        性能
        <span className="inspector-count">
          {perf.completedCount}/{perf.totalTurns} 轮
        </span>
      </h4>

      {perf.liveRow != null && (
        <div
          className="perf-live-strip"
          title="吞吐在消息边界更新（usage 上报时）；流式进行中暂无逐 token 计量"
        >
          <span className="perf-live-badge">LIVE</span>
          <span className="perf-live-text">
            生成中
            {liveElapsed != null
              ? ` ${Math.floor(liveElapsed / 60)}:${String(Math.floor(liveElapsed % 60)).padStart(2, '0')}`
              : ''}
          </span>
          <span className="perf-live-tps">
            {liveTps != null ? `${formatTokensPerSecond(liveTps)} tok/s` : '— tok/s'}
          </span>
        </div>
      )}

      <div className="perf-tiles">
        <div
          className="perf-tile"
          title="已完成轮次的输出吞吐中位数 = 输出 token / 纯生成时长（剔除工具执行时间）"
        >
          <span className="perf-tile-value">
            {perf.medianTokensPerSecond != null
              ? formatTokensPerSecond(perf.medianTokensPerSecond)
              : '—'}
          </span>
          <span className="perf-tile-label">中位吞吐 tok/s</span>
        </div>
        <div className="perf-tile" title="已完成轮次的首输出延迟中位数（请求发出 → 首个可见输出）">
          <span className="perf-tile-value">
            {perf.medianTtftMs != null ? formatMs(perf.medianTtftMs) : '—'}
          </span>
          <span className="perf-tile-label">TTFT 中位</span>
        </div>
        <div
          className="perf-tile"
          title="纯生成时长 ÷ 轮次总时长：会话时间花在等模型生成的占比，其余为工具执行与调度"
        >
          <span className="perf-tile-value">
            {perf.generationShare != null ? formatPercent(perf.generationShare) : '—'}
          </span>
          <span className="perf-tile-label">生成时间占比</span>
        </div>
      </div>

      <div className="perf-chart">
        {shownRows.map((row) => {
          const interruptedLabel = INTERRUPTED_LABEL[row.status]
          if (interruptedLabel != null) {
            return (
              <div
                key={row.turnId}
                className="perf-row perf-row-interrupted"
                title={`${rowTooltip(row)}\n${row.status === 'unknown' ? '终态未记录（应用中断或旧版本数据）' : `该轮${interruptedLabel}，不计入统计`}`}
              >
                <span className="perf-row-index">{row.turnNumber}</span>
                <div className="perf-bar-track">
                  <div className="perf-bar-fill perf-bar-muted" />
                </div>
                <span className="perf-row-status">{interruptedLabel}</span>
                <span className="perf-row-ttft">
                  {row.ttftMs != null ? formatMs(row.ttftMs) : '—'}
                </span>
              </div>
            )
          }
          const isSlow =
            slowEnabled &&
            row.status === 'completed' &&
            row.tokensPerSecond != null &&
            row.tokensPerSecond < (perf.slowTokensPerSecond ?? 0)
          const pct = ((row.tokensPerSecond ?? 0) / maxTokensPerSecond) * 100
          return (
            <div
              key={row.turnId}
              className={`perf-row${row.status === 'running' ? ' perf-row-live' : ''}${isSlow ? ' perf-row-slow' : ''}`}
              title={rowTooltip(row)}
            >
              <span className="perf-row-index">{row.turnNumber}</span>
              <div className="perf-bar-track">
                <div
                  className={`perf-bar-fill${isSlow ? ' perf-bar-slow' : ''}${row.status === 'running' ? ' perf-bar-live' : ''}`}
                  style={{ width: `${pct}%` }} /* dynamic */
                />
              </div>
              <span className="perf-row-tps">
                {row.tokensPerSecond != null ? formatTokensPerSecond(row.tokensPerSecond) : '—'}
              </span>
              <span className="perf-row-ttft">
                {row.ttftMs != null ? formatMs(row.ttftMs) : '—'}
                {isSlow ? ' ⚠' : ''}
              </span>
            </div>
          )
        })}
      </div>

      <div className="perf-footnote">
        {perf.completedCount === 0
          ? '暂无已完成轮次；完成一轮对话后这里会显示吞吐 / TTFT 统计。'
          : '吞吐 = 输出 token ÷ 纯生成时长（已剔除工具执行时间）；⚠ = 低于会话中位数一半的偏慢轮。'}
      </div>
    </div>
  )
}

/** 运行中轮的起点：该轮 turn_prompt_snapshot 的时间戳（轮启动时刻）。 */
function liveStartedTimestamp(snapshots: TurnPromptSnapshotEvent[], turnId: string): string | null {
  for (const snapshot of snapshots) {
    if (snapshot?.turnId === turnId) return snapshot.timestamp
  }
  return null
}

/** live 行的边界口径吞吐：usage_update 已合并 outputTokens + streamActiveMs 时即可算。 */
function liveTokensPerSecond(row: TurnPerfRow): number | null {
  if (row.outputTokens == null || row.streamActiveMs == null || row.streamActiveMs <= 0) return null
  return (row.outputTokens / row.streamActiveMs) * 1000
}
