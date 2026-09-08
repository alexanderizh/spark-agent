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
}

export function Transcript({ rows, theme, capabilities }: TranscriptProps): ReactElement {
  // Below 256 colors a background block turns into terminal soup; drop it.
  const userBg =
    theme.userBg !== undefined &&
    (capabilities.color === 'truecolor' || capabilities.color === '256')
      ? theme.userBg
      : undefined
  return (
    <Static items={[...rows]}>
      {(row) => {
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
          const toolLine = row.toolLine
          const symbols = glyphs(capabilities)
          const branch = capabilities.unicode ? '└' : '\\'
          const status = toolLine.isTask
            ? toolLine.ok
              ? 'subagent completed'
              : 'subagent failed'
            : toolLine.ok
              ? 'completed'
              : 'failed'
          return (
            <Box key={row.key} flexDirection="column" marginTop={1} width={capabilities.width}>
              <Text>
                <Text color={theme.accent}>
                  {symbols.tool} {toolLine.title}
                </Text>
                {toolLine.detail === undefined ? undefined : (
                  <Text color={theme.dim}> · {toolLine.detail}</Text>
                )}
              </Text>
              <Text>
                <Text color={theme.dim}> {branch} </Text>
                <Text color={toolLine.ok ? theme.ok : theme.error}>
                  {toolLine.ok ? symbols.success : symbols.failure} {status}
                </Text>
                <Text color={theme.dim}>
                  {' '}
                  · {toolLine.durationMs}
                  {toolLine.sessionId === undefined
                    ? ''
                    : ` · session ${shortId(toolLine.sessionId)}`}
                </Text>
              </Text>
              {toolLine.resultLines.map((line, index) => (
                <Text
                  key={`${row.key}-result-${index}`}
                  color={toolLine.ok ? theme.dim : theme.error}
                >
                  {'    '}
                  {line}
                </Text>
              ))}
            </Box>
          )
        }
        const color = toneColor(row.tone, theme)
        return color === undefined ? (
          <Text key={row.key}>{row.text}</Text>
        ) : (
          <Text key={row.key} color={color} dimColor={row.tone === 'dim'}>
            {row.text}
          </Text>
        )
      }}
    </Static>
  )
}

export interface ActiveToolsProps {
  readonly tools: readonly ActiveToolProjection[]
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
}

export function ActiveTools({ tools, capabilities, theme }: ActiveToolsProps): ReactElement {
  const symbols = glyphs(capabilities)
  const branch = capabilities.unicode ? '└' : '\\'
  return (
    <Box flexDirection="column" marginTop={tools.length > 0 ? 1 : 0}>
      {tools.map((tool) => (
        <Box key={tool.callId} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={tool.status === 'running' ? theme.accent : theme.dim}>
              {symbols.tool} {tool.title}
            </Text>
            {tool.detail === undefined ? undefined : (
              <Text color={theme.dim}> · {tool.detail}</Text>
            )}
          </Text>
          <Text color={theme.dim}>
            {'  '}
            {branch}{' '}
            <Text color={tool.status === 'running' ? theme.accent : theme.dim}>
              {tool.status === 'running' ? symbols.spinner[0] : symbols.pending}
            </Text>{' '}
            {tool.isTask
              ? tool.status === 'running'
                ? 'subagent dispatched'
                : 'subagent waiting for approval'
              : tool.status === 'running'
                ? 'running'
                : 'waiting for approval'}
          </Text>
        </Box>
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
