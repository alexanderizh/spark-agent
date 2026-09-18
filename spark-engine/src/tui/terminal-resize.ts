/**
 * Terminal resize handling for the live frame.
 *
 * Two problems meet here, both caused by Ink rewriting frames "relative to the
 * previous frame's cursor line":
 *   1. Geometry lag — while the capabilities state trails the terminal, a frame
 *      can be wider than the terminal (the 100%-wide status bar is enough). The
 *      terminal then wraps that row itself, so Ink's line accounting no longer
 *      matches the physical screen and every later render is misaligned.
 *   2. Reflow residue — when the width changes, the terminal reflows the frame
 *      already on screen. Ink erases previous lines relative to the cursor and
 *      then skips lines whose content did not change, so content that reflow
 *      pushed onto an unchanged line is never erased. Those fragments stay on
 *      screen as duplicates above the live frame.
 *
 * Solving (1) is a plain state update on every resize event. Solving (2) needs a
 * full-frame rewrite from a known row, which is what `suspendTerminal` does:
 * it resets Ink's frame accounting and repaints the whole frame. It is
 * debounced so a drag resize repaints once it settles instead of flickering
 * through every intermediate width.
 */
import { useEffect, useState } from 'react'

import { detectTerminalCapabilities, type TerminalCapabilities } from './theme.js'

/** Move the cursor to the viewport origin before the repaint. */
export const CURSOR_HOME = '\u001b[H'

/** Wait for the drag to settle before paying for a full-frame rewrite. */
export const RESIZE_REPAINT_DEBOUNCE_MS = 120

/** Ink's terminal handoff (`useApp().suspendTerminal`). */
export type TerminalRepaintHandle = (callback: () => void | Promise<void>) => Promise<void>

/**
 * Stream surface this hook needs. Real stdout is wider; tests inject a plain
 * EventEmitter stand-in with the same TTY fields.
 */
export interface ResizeStream {
  readonly isTTY: boolean
  readonly columns: number
  readonly rows: number
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
  write(value: string): unknown
}

export interface UseTerminalCapabilitiesOptions {
  readonly stdout: ResizeStream
  /** Capabilities resolved at mount (tests pin width/color mode). */
  readonly initial?: TerminalCapabilities | undefined
  /** Ink's terminal handoff; it repaints the full frame when it resumes. */
  readonly suspendTerminal: TerminalRepaintHandle
}

/**
 * Terminal capabilities that follow the terminal size, plus the post-resize
 * repaint that clears reflow residue.
 */
export function useTerminalCapabilities(
  options: UseTerminalCapabilitiesOptions,
): TerminalCapabilities {
  const { stdout, suspendTerminal } = options
  const [capabilities, setCapabilities] = useState<TerminalCapabilities>(
    () => options.initial ?? detectTerminalCapabilities(stdout),
  )

  useEffect(() => {
    let lastWidth = stdout.columns
    let lastHeight = stdout.rows
    let repaint: ReturnType<typeof setTimeout> | undefined
    const onResize = (): void => {
      const width = stdout.columns
      const height = stdout.rows
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      // Immediate: a stale width is what desynchronizes Ink's frame accounting.
      setCapabilities(detectTerminalCapabilities(stdout))
      // Only a real terminal can be repainted from the viewport origin; a pipe
      // must keep receiving plain output.
      if (!stdout.isTTY) return
      if (repaint !== undefined) clearTimeout(repaint)
      repaint = setTimeout(() => {
        repaint = undefined
        void repaintFrame(stdout, suspendTerminal)
      }, RESIZE_REPAINT_DEBOUNCE_MS)
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
      if (repaint !== undefined) clearTimeout(repaint)
    }
  }, [stdout, suspendTerminal])

  return capabilities
}

/**
 * Rewrite the whole frame after the terminal reflowed it: hand the terminal to
 * Ink (which resets its frame accounting), park the cursor at the origin, then
 * let Ink's resume repaint every row.
 */
async function repaintFrame(
  stdout: ResizeStream,
  suspendTerminal: TerminalRepaintHandle,
): Promise<void> {
  try {
    await suspendTerminal(() => {
      try {
        stdout.write(CURSOR_HOME)
      } catch {
        // The terminal may be gone; Ink's resume repaint is best effort too.
      }
    })
  } catch {
    // A suspension is already active (a child process owns the terminal) or the
    // repaint raced unmount. The next resize schedules a fresh attempt, and the
    // regular renders keep the frame usable in the meantime.
  }
}
