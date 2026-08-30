import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { InputEditor } from '../../src/tui/components/input-editor.js'
import { defaultTheme } from '../../src/tui/theme.js'

const capabilities = { color: 'mono' as const, unicode: true, width: 80 }

function editor(overrides: Partial<Parameters<typeof InputEditor>[0]> = {}) {
  return render(
    <InputEditor
      active
      locked={false}
      capabilities={capabilities}
      theme={defaultTheme}
      onSubmit={vi.fn()}
      onEscape={vi.fn()}
      onControlC={vi.fn()}
      {...overrides}
    />,
  )
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/** A bare Escape byte is held behind a macrotask while Ink rules out sequences. */
async function escapeTick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30))
}

describe('InputEditor shortcuts', () => {
  it('clears a non-empty draft on Esc without interrupting', async () => {
    const onEscape = vi.fn()
    const app = editor({ onEscape })
    app.stdin.write('draft text')
    await tick()
    expect(app.lastFrame() ?? '').toContain('draft text')

    app.stdin.write('\u001b')
    await escapeTick()
    expect(onEscape).not.toHaveBeenCalled()
    expect(app.lastFrame() ?? '').not.toContain('draft text')
    app.unmount()
  })

  it('keeps the draft and interrupts when a turn is running', async () => {
    const onEscape = vi.fn()
    const app = editor({ onEscape, running: true })
    app.stdin.write('partial thought')
    await tick()

    app.stdin.write('\u001b')
    await escapeTick()
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(app.lastFrame() ?? '').toContain('partial thought')
    app.unmount()
  })

  it('interrupts with Esc when the input is already empty', async () => {
    const onEscape = vi.fn()
    const app = editor({ onEscape })
    app.stdin.write('\u001b')
    await escapeTick()
    expect(onEscape).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('Ctrl+U clears the whole line and Ctrl+W deletes one word back', async () => {
    const onSubmit = vi.fn()
    const app = editor({ onSubmit })
    app.stdin.write('deploy the service now')
    await tick()

    app.stdin.write('\u0017') // Ctrl+W removes "now"
    await tick()
    expect(app.lastFrame() ?? '').toContain('deploy the service ')
    expect(app.lastFrame() ?? '').not.toContain('service now')

    app.stdin.write('\u0015') // Ctrl+U clears everything
    await tick()
    expect(app.lastFrame() ?? '').not.toContain('deploy')

    app.stdin.write('\r') // submitting an empty draft must be a no-op
    await tick()
    expect(onSubmit).not.toHaveBeenCalled()
    app.unmount()
  })

  it('Shift+Tab cycles permission and Tab completion stays on plain Tab', async () => {
    const onCyclePermission = vi.fn()
    const app = editor({ onCyclePermission })
    app.stdin.write('/hel')
    await tick()
    expect(app.lastFrame() ?? '').toContain('/help')

    app.stdin.write('\u001b[Z') // Shift+Tab: mode cycle, not completion adoption
    await tick()
    expect(onCyclePermission).toHaveBeenCalledTimes(1)
    expect(app.lastFrame() ?? '').toContain('/hel')

    app.stdin.write('\t')
    await tick()
    expect(app.lastFrame() ?? '').toContain('/help ') // completion adopted
    expect(onCyclePermission).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('routes Ctrl+O to the thinking toggle', async () => {
    const onToggleThinking = vi.fn()
    const app = editor({ onToggleThinking })
    app.stdin.write('\u000f')
    await tick()
    expect(onToggleThinking).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('turns a trailing backslash + Enter into a newline instead of submitting', async () => {
    const onSubmit = vi.fn()
    const app = editor({ onSubmit })
    app.stdin.write('first line \\')
    await tick()
    app.stdin.write('\r')
    await tick()
    app.stdin.write('second line')
    await tick()

    expect(onSubmit).not.toHaveBeenCalled()
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('first line')
    expect(frame).toContain('second line')
    expect(frame).not.toContain('\\')

    app.stdin.write('\r')
    await tick()
    expect(onSubmit).toHaveBeenCalledWith('first line \nsecond line')
    app.unmount()
  })
})
