import type { ReactNode } from 'react'
import { HunkDiff } from '../../ChatInteractions'

type MarkdownTextComponent = (props: { content: string }) => ReactNode

export type DiffHunk = {
  range: string
  note: string
  adds: number
  dels: number
  lines: { t: 'add' | 'del' | 'ctx' | 'hunk'; n: number | string; s: string }[]
}

/** Parse a unified diff string into structured hunks for HunkDiff */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const lines = diff.split('\n')
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const rawLine of lines) {
    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] ?? '0', 10)
      newLine = parseInt(hunkMatch[2] ?? '0', 10)
      currentHunk = {
        range: rawLine.replace(/^@@\s*/, '').replace(/\s*@@.*$/, ''),
        note: hunkMatch[3]?.trim() ?? '',
        adds: 0,
        dels: 0,
        lines: [],
      }
      hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) {
      // Skip diff header lines (--- a/file, +++ b/file, etc.)
      continue
    }
    if (rawLine.startsWith('+')) {
      currentHunk.adds++
      currentHunk.lines.push({ t: 'add', n: newLine++, s: rawLine.slice(1) })
    } else if (rawLine.startsWith('-')) {
      currentHunk.dels++
      currentHunk.lines.push({ t: 'del', n: oldLine++, s: rawLine.slice(1) })
    } else if (rawLine.startsWith(' ')) {
      currentHunk.lines.push({ t: 'ctx', n: oldLine++, s: rawLine.slice(1) })
      newLine++
    }
    // Skip empty lines (end of diff) and other special lines (\ No newline...)
  }

  return hunks
}

function extractDiffPath(segment: string): string {
  const plus = segment.match(/^\+\+\+\s+b\/(.+)$/m)
  if (plus?.[1]) return plus[1]
  // Deletion: +++ /dev/null, fall back to --- a/PATH
  const minus = segment.match(/^---\s+a\/(.+)$/m)
  if (minus?.[1]) return minus[1]
  const head = segment.match(/^diff --git\s+a\/\S+\s+b\/(.+)$/m)
  if (head?.[1]) return head[1]
  return ''
}

/**
 * Split a multi-file git diff output into per-file segments and parse each into
 * structured hunks for <HunkDiff />. Reuses parseUnifiedDiff so the tool-log diff
 * renders identically to the main-content file_change block.
 */
export function parseGitDiffSegments(content: string): { path: string; hunks: DiffHunk[] }[] {
  const segments: { path: string; hunks: DiffHunk[] }[] = []
  // Split keeps the 'diff --git' marker at the start of each segment.
  const parts = content.split(/^(?=diff --git )/m)
  for (const raw of parts) {
    const segment = raw.trim()
    if (!segment.startsWith('diff --git')) continue
    const hunks = parseUnifiedDiff(segment)
    if (hunks.length === 0) continue
    segments.push({ path: extractDiffPath(segment) || '(unknown)', hunks })
  }
  return segments
}

/**
 * GitDiffContent - renders tool-output git diffs using the same <HunkDiff /> panel
 * used in the main message stream (line numbers, +/- coloring, hunk bars).
 * Falls back to <MarkdownText /> for non-diff content or unparseable diff.
 */
export function GitDiffContent({ content, renderMarkdown }: { content: string; renderMarkdown: MarkdownTextComponent }) {
  const MarkdownRenderer = renderMarkdown
  const isGitDiff =
    content.includes('diff --git') || content.includes('@@') || content.match(/^[+-]/m)

  if (!isGitDiff) {
    return <MarkdownRenderer content={content} />
  }

  const segments = parseGitDiffSegments(content)
  if (segments.length === 0) {
    // Looked like a diff but yielded no hunks (e.g. stray +/- lines) — render as text.
    return <MarkdownRenderer content={content} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
      {segments.map((seg, i) => (
        <HunkDiff key={i} path={seg.path} hunks={seg.hunks} />
      ))}
    </div>
  )
}
