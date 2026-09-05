import { Box, Text } from 'ink'
import { cloneElement, type ReactElement } from 'react'

import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'

export interface MarkdownTextProps {
  readonly text: string
  readonly theme: TuiTheme
  readonly capabilities: TerminalCapabilities
}

/**
 * Dependency-free terminal markdown for settled assistant messages: headings,
 * lists, quotes, fenced code, inline code and bold. Unknown syntax falls
 * through as plain text, so a parse miss can never lose content.
 */
export function MarkdownText(props: MarkdownTextProps): ReactElement {
  const lines = renderLines(props.text, props.theme, props.capabilities)
  return (
    <Box flexDirection="column">
      {lines.map((line, rowIndex) => (
        <Text key={rowIndex}>
          {line.map((segment, segmentIndex) =>
            typeof segment === 'string'
              ? segment
              : cloneElement(segment, { key: segmentIndex }),
          )}
        </Text>
      ))}
    </Box>
  )
}

type Segment = string | ReactElement

function renderLines(
  text: string,
  theme: TuiTheme,
  capabilities: TerminalCapabilities,
): readonly Segment[][] {
  const symbols = glyphs(capabilities)
  const rows: Segment[][] = []
  let inCode = false
  for (const rawLine of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      rows.push([dim(theme, `  ${rawLine}`.trimEnd())])
      continue
    }
    if (rawLine.trim() === '') {
      rows.push([' '])
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(rawLine)
    if (heading) {
      rows.push(inline(heading[2] ?? '', theme, { bold: true, color: theme.accent }))
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(rawLine)
    if (bullet) {
      const indent = Math.floor((bullet[1] ?? '').length / 2)
      rows.push([
        '  '.repeat(indent),
        accent(theme, symbols.bullet),
        ' ',
        ...inline(bullet[2] ?? '', theme),
      ])
      continue
    }
    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(rawLine)
    if (ordered) {
      const indent = Math.floor((ordered[1] ?? '').length / 2)
      rows.push([
        '  '.repeat(indent),
        accent(theme, `${ordered[2]}.`),
        ' ',
        ...inline(ordered[3] ?? '', theme),
      ])
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(rawLine)
    if (quote) {
      rows.push([dim(theme, `${symbols.bar} `), dim(theme, quote[1] ?? '')])
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(rawLine)) {
      rows.push([dim(theme, symbols.divider.repeat(24))])
      continue
    }
    rows.push(inline(rawLine, theme))
  }
  return rows
}

/** Splits `**bold**` and `` `code` `` runs; everything else stays verbatim. */
function inline(text: string, theme: TuiTheme, base?: { bold?: boolean; color?: string }): Segment[] {
  const segments: Segment[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (part === '') continue
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      segments.push(bold(theme, part.slice(2, -2)))
    } else if (/^`[^`]+`$/.test(part)) {
      segments.push(accent(theme, part.slice(1, -1)))
    } else {
      segments.push(styled(theme, part, base))
    }
  }
  return segments.length > 0 ? segments : [text]
}

// The tiny helpers below keep JSX out of the parser: each wraps one style of
// <Text> run so inline() can mix plain strings and elements freely.

function styled(
  theme: TuiTheme,
  text: string,
  base?: { bold?: boolean; color?: string },
): ReactElement {
  if (base?.bold) {
    return <Text bold {...(base.color === undefined ? {} : { color: base.color })}>{text}</Text>
  }
  if (base?.color !== undefined) return <Text color={base.color}>{text}</Text>
  return <Text>{text}</Text>
}

function bold(theme: TuiTheme, text: string): ReactElement {
  return <Text bold>{text}</Text>
}

function accent(theme: TuiTheme, text: string): ReactElement {
  return <Text color={theme.accent}>{text}</Text>
}

function dim(theme: TuiTheme, text?: string): ReactElement {
  return text === undefined ? <Text color={theme.dim}>{''}</Text> : <Text color={theme.dim}>{text}</Text>
}
