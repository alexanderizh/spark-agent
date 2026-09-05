import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { EffortPicker } from '../../src/tui/components/effort-picker.js'
import { PermissionPicker } from '../../src/tui/components/permission-picker.js'
import { defaultTheme } from '../../src/tui/theme.js'

describe('PermissionPicker', () => {
  it('renders exactly three modes with the current one highlighted and applies a safe pick directly', async () => {
    const onPick = vi.fn()
    const app = render(
      <PermissionPicker
        theme={defaultTheme}
        current="manual"
        onPick={onPick}
        onClose={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    const text = app.lastFrame() ?? ''
    expect(text).toContain('权限策略切换')
    expect(text).toContain('手动审批')
    expect(text).toContain('自动审批')
    expect(text).toContain('完全访问')
    expect(text).not.toContain('计划模式')
    expect(text).toContain('✓当前')

    app.stdin.write('2') // auto
    await new Promise<void>((resolveTick) => setImmediate(resolveTick))
    expect(onPick).toHaveBeenCalledWith('auto')
    app.unmount()
  })

  it('requires a second confirm before arming permission bypass', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <PermissionPicker
        theme={defaultTheme}
        current="manual"
        onPick={onPick}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    )
    app.stdin.write('\u001b[B') // down to auto
    await tick()
    app.stdin.write('\u001b[B') // down to bypass
    await tick()
    app.stdin.write('\r') // first enter: arms, must NOT pick yet
    await tick()
    expect(onPick).not.toHaveBeenCalled()
    expect(app.lastFrame() ?? '').toContain('再次按 enter 确认')
    app.stdin.write('\r') // second enter: confirmed
    await tick()
    expect(onPick).toHaveBeenCalledWith('bypass')
    app.unmount()
  })

  it('escapes dismiss instead of picking', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <PermissionPicker
        theme={defaultTheme}
        current="auto"
        onPick={onPick}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    )
    app.stdin.write('\u001b')
    await escapeTick()
    expect(onClose).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
    app.unmount()
  })
})

describe('EffortPicker', () => {
  it('lists low/medium/high/max/off without auto, marks the current level, and picks via enter', async () => {
    const onPick = vi.fn()
    const app = render(
      <EffortPicker theme={defaultTheme} current="high" onPick={onPick} onClose={vi.fn()} />,
    )
    const text = app.lastFrame() ?? ''
    for (const label of ['low', 'medium', 'high', 'max', 'off']) {
      expect(text).toContain(label)
    }
    expect(text).not.toContain('auto')
    expect(text).toContain('✓当前')

    app.stdin.write('\u001b[B') // down: high(index2) -> max(index3)
    await tick()
    app.stdin.write('\r')
    await tick()
    expect(onPick).toHaveBeenCalledWith('max')
    app.unmount()
  })

  it('picks by digit and closes on escape', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <EffortPicker theme={defaultTheme} current="low" onPick={onPick} onClose={onClose} />,
    )
    app.stdin.write('4') // max (low, medium, high, max, off)
    await tick()
    expect(onPick).toHaveBeenCalledWith('max')

    app.stdin.write('\u001b')
    await escapeTick()
    expect(onClose).toHaveBeenCalledTimes(1)
    app.unmount()
  })
})

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/** A bare Escape byte is held behind a macrotask while Ink rules out sequences. */
async function escapeTick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30))
}
