import { Box, Static, Text } from 'ink'
import type { ReactElement } from 'react'

import type { ActiveToolProjection, RowTone, TranscriptRow } from '../projection.js'
import type { TerminalCapabilities, TuiTheme } from '../theme.js'
import { glyphs } from '../theme.js'

export interface TranscriptProps {
  readonly rows: readonly TranscriptRow[]
  readonly theme: TuiTheme
}

export function Transcript({ rows, theme }: TranscriptProps): ReactElement {
  return (
    <Static items={[...rows]}>
      {(row) => {
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
  return (
    <Box flexDirection="column">
      {tools.map((tool) => (
        <Text key={tool.callId}>
          <Text color={tool.status === 'running' ? theme.accent : theme.dim}>
            {symbols.tool} {tool.tool}
          </Text>
          <Text color={theme.dim}>
            {tool.status === 'running'
              ? ` ${symbols.spinner[0]} ${previewArgs(tool.args)}`
              : ` ${symbols.pending} ${previewArgs(tool.args)}`}
          </Text>
        </Text>
      ))}
    </Box>
  )
}

function previewArgs(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? ''
    return text.length > 60 ? `${text.slice(0, 59)}…` : text
  } catch {
    return ''
  }
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
