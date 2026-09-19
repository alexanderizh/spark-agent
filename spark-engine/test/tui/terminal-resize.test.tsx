import { EventEmitter } from 'node:events'

import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'

import {
  CURSOR_HOME,
  RESIZE_REPAINT_DEBOUNCE_MS,
  useTerminalCapabilities,
  type ResizeStream,
} from '../../src/tui/terminal-resize.js'

/** stdout stand-in: the hook only needs the TTY size fields and the stream API. */
class FakeStdout extends EventEmitter implements ResizeStream {
  isTTY: boolean
  columns: number
  rows: number
  readonly writes: string[] = []

  constructor(options: { isTTY: boolean; columns: number; rows: number }) {
    super()
    this.isTTY = options.isTTY
    this.columns = options.columns
    this.rows = options.rows
  }

  write(value: string): boolean {
    this.writes.push(value)
    return true
  }

  resize(columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.emit('resize')
  }
}

function Probe(props: {
  readonly stdout: ResizeStream
  readonly suspendTerminal: (callback: () => void | Promise<void>) => Promise<void>
}): ReactElement {
  const capabilities = useTerminalCapabilities({
    stdout: props.stdout,
    initial: { color: 'mono', unicode: false, width: 100, height: 30 },
    suspendTerminal: props.suspendTerminal,
  })
  return <Text>{`${capabilities.width}x${capabilities.height ?? '-'}`}</Text>
}

const settle = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve))
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
  await new Promise((resolve) => setImmediate(resolve))
}

describe('terminal resize handling', () => {
  it('follows the terminal immediately and repaints once after a drag settles', async () => {
    const stdout = new FakeStdout({ isTTY: true, columns: 100, rows: 30 })
    const suspensions: number[] = []
    const suspendTerminal = async (callback: () => void | Promise<void>): Promise<void> => {
      suspensions.push(Date.now())
      await callback()
    }

    const app = render(<Probe stdout={stdout} suspendTerminal={suspendTerminal} />)
    expect(app.lastFrame()).toContain('100x30')

    // Drag: many resize events in a row, the frame must never trail the width.
    stdout.resize(90, 30)
    stdout.resize(80, 30)
    stdout.resize(60, 30)
    await settle()
    expect(app.lastFrame()).toContain('60x30')
    // Under load the real clock can stretch the drag past the debounce window,
    // so the repaint may legitimately have fired by now; what must never
    // happen is a trailing frame or a repaint that is not a cursor-home.
    expect(stdout.writes.every((write) => write === CURSOR_HOME)).toBe(true)

    await settle(RESIZE_REPAINT_DEBOUNCE_MS + 80)
    expect(suspensions).toHaveLength(1)
    expect(stdout.writes).toEqual([CURSOR_HOME])
    app.unmount()
  })

  it('repaints again for a later resize and ignores unchanged sizes', async () => {
    const stdout = new FakeStdout({ isTTY: true, columns: 100, rows: 30 })
    const suspensions: number[] = []
    const suspendTerminal = async (callback: () => void | Promise<void>): Promise<void> => {
      suspensions.push(Date.now())
      await callback()
    }

    const app = render(<Probe stdout={stdout} suspendTerminal={suspendTerminal} />)
    stdout.emit('resize')
    await settle(RESIZE_REPAINT_DEBOUNCE_MS + 80)
    expect(suspensions).toHaveLength(0)

    stdout.resize(120, 40)
    await settle(RESIZE_REPAINT_DEBOUNCE_MS + 80)
    expect(suspensions).toHaveLength(1)
    expect(app.lastFrame()).toContain('120x40')
    app.unmount()
  })

  it('never writes terminal escapes when stdout is piped', async () => {
    const stdout = new FakeStdout({ isTTY: false, columns: 100, rows: 30 })
    const suspensions: number[] = []
    const suspendTerminal = async (callback: () => void | Promise<void>): Promise<void> => {
      suspensions.push(Date.now())
      await callback()
    }

    const app = render(<Probe stdout={stdout} suspendTerminal={suspendTerminal} />)
    stdout.resize(70, 30)
    await settle()
    // Piped output has no viewport: width still follows, height stays unknown.
    expect(app.lastFrame()).toContain('70x-')

    await settle(RESIZE_REPAINT_DEBOUNCE_MS + 80)
    expect(suspensions).toHaveLength(0)
    expect(stdout.writes).toEqual([])
    app.unmount()
  })
})
