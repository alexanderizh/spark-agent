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
  readonly theme: TuiTheme
}

/**
 * The busy status line shown while a turn runs: the current action in the
 * accent color with dim runtime details. The animated spinner itself lives in
 * the status bar (`SpinnerGlyph`), so this line stays a quiet text row.
 */
export function WorkingLine(props: WorkingLineProps): ReactElement {
  return (
    <Text>
      <Text color={props.theme.accent}>{props.label}</Text>
      {props.detail === undefined ? undefined : (
        <Text color={props.theme.dim}> · {props.detail}</Text>
      )}
    </Text>
  )
}
