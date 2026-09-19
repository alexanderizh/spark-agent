import { Text } from 'ink'
import { useEffect, useState, type ReactElement } from 'react'

import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'

const FRAME_INTERVAL_MS = 130

/**
 * Shared animation clock for spinner glyphs so every busy indicator in the
 * chrome (status bar today) rotates on one interval instead of each spinning
 * its own timer. `tick` freezes the frame for deterministic tests.
 */
export function useSpinnerTick(tick?: number): number {
  const [internalTick, setInternalTick] = useState(0)
  useEffect(() => {
    if (tick !== undefined) return
    const timer = setInterval(() => {
      setInternalTick((value) => value + 1)
    }, FRAME_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [tick])
  return tick ?? internalTick
}

export interface SpinnerGlyphProps {
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
  /** Deterministic frame override for tests. */
  readonly tick?: number
}

/** The animated spinner glyph alone, for embedding into other chrome lines. */
export function SpinnerGlyph(props: SpinnerGlyphProps): ReactElement {
  const symbols = glyphs(props.capabilities)
  const tick = useSpinnerTick(props.tick)
  const frame = symbols.spinner[tick % symbols.spinner.length] ?? symbols.spinner[0]
  return <Text color={props.theme.accent}>{frame}</Text>
}

export interface WorkingLineProps {
  readonly label: string
  readonly detail?: string
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
  /** Deterministic frame override for tests. */
  readonly tick?: number
}

/**
 * The busy status line shown while a turn runs: a loading glyph, the current
 * action in the accent color, and dim runtime details. Empty details render
 * nothing at all, so a bare action never trails a dangling separator.
 */
export function WorkingLine(props: WorkingLineProps): ReactElement {
  const detail = props.detail ?? ''
  return (
    <Text>
      <SpinnerGlyph
        capabilities={props.capabilities}
        theme={props.theme}
        {...(props.tick === undefined ? {} : { tick: props.tick })}
      />
      <Text color={props.theme.accent}> {props.label}</Text>
      {detail === '' ? undefined : <Text color={props.theme.dim}> · {detail}</Text>}
    </Text>
  )
}
