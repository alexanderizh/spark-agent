import { useState } from 'react'

import { Icons } from '../../Icons'
import type { UIBlock } from '../../services/event-mapper'

export type ContextCompactionBlock = Extract<UIBlock, { kind: 'context_compaction' }>

/**
 * 上下文压缩状态卡：同一次压缩的阶段事件与承接摘要在 MessageBuilder 中
 * 合并为一张卡。摘要面向模型上下文承接，默认折叠为单行，点击展开查看。
 */
export function ContextCompactionCard({ block }: { block: ContextCompactionBlock }) {
  const [expanded, setExpanded] = useState(false)
  const sourceLabel =
    block.source === 'claude_code'
      ? 'Claude Code'
      : block.source === 'codex_cli'
        ? 'Codex CLI'
        : 'Codex SDK'
  const phaseLabel =
    block.phase === 'started'
      ? '压缩中…'
      : block.phase === 'completed'
        ? '压缩完成'
        : block.phase === 'failed'
          ? '压缩失败'
          : '已压缩'
  const tokenText =
    block.preTokens != null || block.postTokens != null
      ? [
          block.preTokens != null ? `${block.preTokens.toLocaleString()} t` : null,
          block.postTokens != null ? `${block.postTokens.toLocaleString()} t` : null,
        ]
          .filter(Boolean)
          .join(' → ')
      : null
  const durationText =
    block.durationMs != null && block.durationMs > 0
      ? block.durationMs >= 1000
        ? `${(block.durationMs / 1000).toFixed(1)}s`
        : `${block.durationMs}ms`
      : null
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--c-surface, #1e1e2e)',
        border: '1px solid var(--c-border, #333)',
        fontSize: 12,
        color: 'var(--c-text, #ccc)',
        display: 'grid',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icons.Layers size={14} style={{ opacity: 0.65, flexShrink: 0 }} />
        <span style={{ opacity: 0.78, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sourceLabel} {phaseLabel}
          {block.trigger != null ? `（${block.trigger}）` : ''}
          {tokenText != null ? ` · ${tokenText}` : ''}
          {durationText != null ? ` · ${durationText}` : ''}
        </span>
        {block.summary != null && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              padding: '2px 8px',
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--c-dim, #8a8f98)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {expanded ? '收起' : '查看摘要'}
          </button>
        )}
      </div>
      {expanded && block.summary != null && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            lineHeight: 1.45,
            maxHeight: 320,
            overflowY: 'auto',
            borderTop: '1px solid var(--c-border, #333)',
            paddingTop: 6,
          }}
        >
          {block.summary}
        </div>
      )}
      {block.message != null && (
        <div style={{ color: 'var(--c-warn, #f59e0b)', whiteSpace: 'pre-wrap' }}>
          {block.message}
        </div>
      )}
      {expanded && block.rawType != null && (
        <div style={{ color: 'var(--c-dim, #8a8f98)', fontSize: 11 }}>raw: {block.rawType}</div>
      )}
    </div>
  )
}
