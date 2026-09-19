import { Box, Static, Text } from 'ink'
import type { ReactElement } from 'react'

import type { ActiveToolProjection, RowTone, TranscriptRow } from '../projection.js'
import type { TerminalCapabilities, TuiTheme } from '../theme.js'
import { glyphs } from '../theme.js'
import { MarkdownText } from './markdown.js'

export interface TranscriptProps {
  readonly rows: readonly TranscriptRow[]
  readonly theme: TuiTheme
  readonly capabilities: TerminalCapabilities
  /** Keep rows in the live layout when the caller owns a scroll viewport. */
  readonly staticOutput?: boolean
}

export function Transcript(props: TranscriptProps): ReactElement {
  const { rows, theme, capabilities } = props
  // Below 256 colors a background block turns into terminal soup; drop it.
  const userBg =
    theme.userBg !== undefined &&
    (capabilities.color === 'truecolor' || capabilities.color === '256')
      ? theme.userBg
      : undefined
  if (props.staticOutput === false) {
    return (
      <Box flexDirection="column">
        {rows.map((row) => renderTranscriptRow(row, theme, capabilities, userBg))}
      </Box>
    )
  }
  return (
    <Static items={[...rows]}>
      {(row) => renderTranscriptRow(row, theme, capabilities, userBg)}
    </Static>
  )
}

function renderTranscriptRow(
  row: TranscriptRow,
  theme: TuiTheme,
  capabilities: TerminalCapabilities,
  userBg: string | undefined,
): ReactElement {
  if (row.kind === 'user') {
    return (
      <Box
        key={row.key}
        marginY={1}
        width={capabilities.width}
        {...(userBg === undefined ? {} : { backgroundColor: userBg })}
      >
        <Text bold>{row.text}</Text>
      </Box>
    )
  }
  if (row.kind === 'assistant') {
    // Markdown rendering with breathing room around each answer block.
    return (
      <Box key={row.key} flexDirection="column" marginY={1} width={capabilities.width}>
        <MarkdownText text={row.text} theme={theme} capabilities={capabilities} />
      </Box>
    )
  }
  if (row.toolLine) {
    return renderToolLine(row, theme, capabilities)
  }
  const color = toneColor(row.tone, theme)
  return color === undefined ? (
    <Text key={row.key}>{row.text}</Text>
  ) : (
    <Text key={row.key} color={color} dimColor={row.tone === 'dim'}>
      {row.text}
    </Text>
  )
}

export interface ActiveToolsProps {
  readonly tools: readonly ActiveToolProjection[]
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
}

export function ActiveTools({ tools, capabilities, theme }: ActiveToolsProps): ReactElement {
  const symbols = glyphs(capabilities)
  return (
    <Box flexDirection="column" marginTop={tools.length > 0 ? 1 : 0}>
      {tools.map((tool) => (
        <Box key={tool.callId} marginBottom={1}>
          <Text>
            <Text color={tool.status === 'running' ? theme.accent : theme.dim}>
              {symbols.tool} {tool.title}
            </Text>
            <Text color={theme.dim}>
              {' '}
              {symbols.pending}{' '}
              {tool.isTask
                ? tool.status === 'running'
                  ? 'subagent running'
                  : tool.status === 'approval'
                    ? 'subagent waiting for approval'
                    : 'subagent queued'
                : tool.status === 'running'
                  ? 'running'
                  : tool.status === 'approval'
                    ? 'waiting for approval'
                    : 'preparing'}
            </Text>
            {tool.detail === undefined ? undefined : (
              <Text color={theme.dim}> · {tool.detail}</Text>
            )}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** Bounded error excerpt kept under a failed tool line. */
const FAILED_DETAIL_MAX_LINES = 3

/** Subagent reply excerpt kept under a completed task line. */
const TASK_DETAIL_MAX_LINES = 2

/**
 * One settled tool call collapses to a single line (`⏺ Read · path ✓ 19ms`):
 * the mark plus duration already carry the outcome, so the former second
 * status line and the multi-line result preview are noise once a tool lands.
 * Details stay only where they change decisions: failures keep a short error
 * excerpt, and background processes keep their live output tail.
 */
function renderToolLine(
  row: TranscriptRow,
  theme: TuiTheme,
  capabilities: TerminalCapabilities,
): ReactElement {
  const toolLine = row.toolLine
  if (toolLine === undefined) return <Text key={row.key}>{row.text}</Text>
  const symbols = glyphs(capabilities)
  const running = toolLine.processStatus === 'still running'
  const failed = !toolLine.ok
  const statusColor = failed ? theme.error : running ? theme.dim : theme.ok
  const statusGlyph = running ? symbols.pending : failed ? symbols.failure : symbols.success
  const statusWord = toolLine.processStatus ?? (failed ? 'failed' : undefined)
  const trail: string[] = []
  if (toolLine.sessionId !== undefined) trail.push(`session ${shortId(toolLine.sessionId)}`)
  if (toolLine.processId !== undefined) trail.push(`process ${shortId(toolLine.processId)}`)
  // Failures, live background output, and subagent replies stay legible;
  // plain successes fold to the single header line.
  const detailLines = failed
    ? toolLine.resultLines.slice(0, FAILED_DETAIL_MAX_LINES)
    : running
      ? toolLine.resultLines.slice(0, FAILED_DETAIL_MAX_LINES)
      : toolLine.isTask
        ? toolLine.resultLines.slice(0, TASK_DETAIL_MAX_LINES)
        : []
  return (
    <Box key={row.key} flexDirection="column" marginTop={1} width={capabilities.width}>
      <Text>
        <Text color={failed ? theme.error : theme.accent}>
          {symbols.tool} {toolLine.title}
        </Text>
        <Text color={statusColor}>
          {' '}
          {statusGlyph}
          {statusWord === undefined ? '' : ` ${statusWord}`}
        </Text>
        <Text color={theme.dim}>
          {' '}
          {toolLine.durationMs}
          {trail.length === 0 ? '' : ` · ${trail.join(' · ')}`}
        </Text>
        {toolLine.detail === undefined ? undefined : (
          <Text color={theme.dim}> · {toolLine.detail}</Text>
        )}
      </Text>
      {detailLines.map((line, index) => (
        <Text key={`${row.key}-result-${index}`} color={failed ? theme.error : theme.dim}>
          {'  '}
          {line}
        </Text>
      ))}
    </Box>
  )
}

function shortId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12)
}

function toneColor(tone: RowTone, theme: TuiTheme): string | undefined {
  switch (tone) {
    case 'accent':
      return theme.accent
    case 'ok':
      return theme.ok
    case 'warn':
      return theme.warn
    case 'error':
      return theme.error
    case 'dim':
      return theme.dim
    case 'normal':
      return theme.fg
  }
}
