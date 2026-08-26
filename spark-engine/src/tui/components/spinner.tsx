import { Text } from 'ink'
import { useEffect, useState, type ReactElement } from 'react'

import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'

export interface WorkingLineProps {
  readonly label: string
  readonly detail?: string
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
  /** Deterministic frame override for tests. */
  readonly tick?: number
}

const FRAME_INTERVAL_MS = 130

/**
 * The busy indicator line shown while a turn runs: an animated spinner glyph
 * in the accent color, the current action, and dim runtime details — the same
 * visual grammar as the working line of first-class terminal agents.
 */
export function WorkingLine(props: WorkingLineProps): ReactElement {
  const symbols = glyphs(props.capabilities)
  const [internalTick, setInternalTick] = useState(0)
  useEffect(() => {
    if (props.tick !== undefined) return
    const timer = setInterval(() => {
      setInternalTick((tick) => tick + 1)
    }, FRAME_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [props.tick])
  const tick = props.tick ?? internalTick
  const spinner = symbols.spinner[tick % symbols.spinner.length] ?? symbols.spinner[0]
  return (
    <Text>
      <Text color={props.theme.accent}>
        {spinner} {props.label}
      </Text>
      {props.detail === undefined ? undefined : (
        <Text color={props.theme.dim}> · {props.detail}</Text>
      )}
    </Text>
  )
}
