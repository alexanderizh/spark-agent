import { Box, Text } from 'ink'
import type { ReactElement, ReactNode } from 'react'

import type { PermissionMode } from '../../permission/types.js'
import type { TerminalCapabilities, TuiTheme } from '../theme.js'

export interface StatusBarProps {
  readonly model: string
  readonly permission: PermissionMode
  readonly effort: string
  readonly perf?: string | undefined
  readonly cwd?: string | undefined
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
}

/** One low-noise chrome line. Separators preserve grouping without a background fill. */
export function StatusBar(props: StatusBarProps): ReactElement {
  const segments: ReactNode[] = [
    <Text key="model" bold color={props.theme.accentStrong ?? props.theme.accent}>
      {props.model}
    </Text>,
    <Text key="permission" color={props.permission === 'bypass' ? props.theme.warn : props.theme.dim}>
      {props.permission}
    </Text>,
    <Text key="effort" {...(props.theme.fg === undefined ? {} : { color: props.theme.fg })}>
      reasoning: {props.effort}
    </Text>,
  ]
  if (props.perf) segments.push(<Text key="perf" color={props.theme.dim}>{props.perf}</Text>)
  if (props.cwd) segments.push(<Text key="cwd" color={props.theme.dim}>{props.cwd}</Text>)

  return (
    <Box width="100%" paddingX={1} flexWrap="wrap">
      <Text color={props.theme.accent}>▎ </Text>
      <Box flexGrow={1} flexShrink={1} flexWrap="wrap">
        {segments.map((segment, index) => (
          <Box key={index}>
            {index > 0 && <Text color={props.theme.line ?? props.theme.faint ?? props.theme.dim}> │ </Text>}
            {segment}
          </Box>
        ))}
      </Box>
      <Text color={props.theme.faint ?? props.theme.dim}> /help</Text>
    </Box>
  )
}
