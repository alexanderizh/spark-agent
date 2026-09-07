import { Box, Text } from 'ink'
import type { ReactElement, ReactNode } from 'react'

import {
  supportsRichBackground,
  type TerminalCapabilities,
  type TuiTheme,
} from '../theme.js'

export interface PickerFrameProps {
  readonly title: string
  readonly footer: string
  readonly theme: TuiTheme
  readonly children: ReactNode
  readonly titleSuffix?: string
}

/** Flat picker chrome: a focused left rail and quiet list dividers, never a card outline. */
export function PickerFrame(props: PickerFrameProps): ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={props.theme.accent}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Text bold color={props.theme.accentStrong ?? props.theme.accent}>
        {props.title}
        {props.titleSuffix ?? ''}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={props.theme.line ?? props.theme.dim}
        borderLeft={false}
        borderRight={false}
        marginTop={1}
        marginBottom={1}
      >
        {props.children}
      </Box>
      <Text color={props.theme.faint ?? props.theme.dim}>{props.footer}</Text>
    </Box>
  )
}

export interface PickerRowProps {
  readonly selected: boolean
  readonly theme: TuiTheme
  readonly capabilities?: TerminalCapabilities | undefined
  readonly children: ReactNode
  readonly warning?: boolean
  readonly dimmed?: boolean | undefined
}

export interface PickerRowStyle {
  readonly backgroundColor: string | undefined
  readonly inverse: boolean
}

export function pickerRowStyle(
  selected: boolean,
  theme: TuiTheme,
  capabilities: TerminalCapabilities | undefined,
): PickerRowStyle {
  const filled = supportsRichBackground(capabilities) && theme.selectedBg !== undefined
  return {
    backgroundColor: selected && filled ? theme.selectedBg : undefined,
    inverse: selected && !filled,
  }
}

/** Shared focus treatment with an explicit inverse-video fallback for limited terminals. */
export function PickerRow(props: PickerRowProps): ReactElement {
  const style = pickerRowStyle(props.selected, props.theme, props.capabilities)
  const color = props.warning
    ? props.theme.warn
    : props.selected
      ? (props.theme.accentStrong ?? props.theme.accent)
      : props.theme.fg

  return (
    <Box
      paddingX={1}
      {...(style.backgroundColor === undefined ? {} : { backgroundColor: style.backgroundColor })}
    >
      <Text
        bold={props.selected}
        dimColor={props.dimmed ?? false}
        inverse={style.inverse}
        {...(color === undefined ? {} : { color })}
      >
        {props.children}
      </Text>
    </Box>
  )
}
