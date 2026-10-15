import { Box, Text } from 'ink'
import type { ReactElement } from 'react'

import type { TuiTheme } from '../theme.js'

export interface WelcomeBoxProps {
  readonly version: string
  readonly cwd?: string | undefined
  readonly theme: TuiTheme
}

/**
 * Empty-state welcome line, Codex-style minimal: a terminal glyph, the brand
 * name with version, and the workspace directory. Replaced by the transcript
 * as soon as the first turn starts.
 */
export function WelcomeBox(props: WelcomeBoxProps): ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={props.theme.accent}>{'>_'}</Text>
        <Text> </Text>
        <Text bold {...(props.theme.fg === undefined ? {} : { color: props.theme.fg })}>
          Spark
        </Text>
        <Text color={props.theme.dim}> (v{props.version})</Text>
      </Text>
      {props.cwd !== undefined && props.cwd !== '' && (
        <Text color={props.theme.dim}> {props.cwd}</Text>
      )}
    </Box>
  )
}
