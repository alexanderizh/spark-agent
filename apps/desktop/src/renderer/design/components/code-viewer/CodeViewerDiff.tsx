/**
 * CodeViewerDiff ——「本次改动」视图。
 *
 * 把 useGitDiff 取回的 unified diff 文本用 parseGitDiffViewSegments 解析成行段，
 * 渲染为行级红绿（add / del / ctx / hunk / meta），连续 ctx 行折叠为可点击展开的 gap。
 * 支持 loading / error / 空态（新文件全部新增 / 已删除 / 无改动）。
 */

import { useMemo, useState, useCallback } from 'react'
import { Icons } from '../../Icons'
import { parseGitDiffViewSegments } from '../../views/chat/ChatGitUtils'
import type { GitDiffViewLine } from '../../views/chat/ChatGitUtils'

export interface CodeViewerDiffProps {
  /** unified diff 文本（来自 workspace:git-file-diff） */
  diff?: string | undefined
  /** 变更类型：用于空态文案 */
  changeType?: 'create' | 'modify' | 'delete' | 'rename' | undefined
  /** 二进制文件无法展示文本 diff */
  isBinary?: boolean | undefined
  loading?: boolean | undefined
  error?: string | undefined
  /** 字号（px），由顶部行缩放控件控制（行高为相对值自动跟随） */
  fontSize?: number | undefined
}

export function CodeViewerDiff({
  diff,
  changeType,
  isBinary,
  loading,
  error,
  fontSize,
}: CodeViewerDiffProps) {
  const segments = useMemo(() => (diff ? parseGitDiffViewSegments(diff, 4) : []), [diff])
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set())

  const toggleGap = useCallback((index: number) => {
    setExpandedGaps((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div className="code-viewer-loading">
        <Icons.Spinner size={18} className="cv-spin" /> 加载本次改动…
      </div>
    )
  }
  if (error) {
    return (
      <div className="code-viewer-error">
        <div className="code-viewer-error-title">无法加载改动</div>
        <div className="code-viewer-error-detail">{error}</div>
      </div>
    )
  }
  if (isBinary) {
    return (
      <div className="code-viewer-empty">
        <div className="code-viewer-empty-icon"> BIN </div>
        <div className="code-viewer-empty-text">二进制文件，无法展示文本改动</div>
      </div>
    )
  }
  if (!diff || diff.trim().length === 0) {
    return (
      <div className="code-viewer-empty">
        <div className="code-viewer-empty-icon">↻</div>
        <div className="code-viewer-empty-text">
          {changeType === 'create'
            ? '新文件，全部内容为新增'
            : changeType === 'delete'
              ? '文件已删除'
              : '该文件没有可显示的改动（可能已提交或无变更）'}
        </div>
      </div>
    )
  }

  return (
    <div
      className="code-viewer-diff"
      style={fontSize != null ? { fontSize: `${fontSize}px` } : undefined}
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'gap') {
          const expanded = expandedGaps.has(i)
          return (
            <div key={i}>
              <button
                type="button"
                className="code-viewer-diff-gap"
                onClick={() => toggleGap(i)}
                title={expanded ? '折叠相同行' : `展开 ${seg.count} 行相同内容`}
              >
                {expanded ? '收起' : `··· ${seg.count} 行相同内容 ···`}
              </button>
              {expanded && seg.lines.map((line, j) => <DiffLine key={`g-${i}-${j}`} line={line} />)}
            </div>
          )
        }
        return <DiffLine key={`l-${i}`} line={seg.line} />
      })}
    </div>
  )
}

function DiffLine({ line }: { line: GitDiffViewLine }) {
  if (line.type === 'meta') {
    return (
      <div className="cvd-line meta" title={line.text}>
        <span className="cvd-code">{line.text}</span>
      </div>
    )
  }
  if (line.type === 'hunk') {
    return (
      <div className="cvd-line hunk">
        <span className="cvd-ln" />
        <span className="cvd-code">{line.text}</span>
      </div>
    )
  }
  const ln = line.type === 'del' ? (line.oldLn ?? '') : (line.newLn ?? '')
  return (
    <div className={`cvd-line ${line.type}`}>
      <span className="cvd-ln">{ln}</span>
      <span className="cvd-code">{line.text}</span>
    </div>
  )
}
