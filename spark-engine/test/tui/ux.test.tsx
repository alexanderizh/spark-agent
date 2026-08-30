import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { EffortPicker } from '../../src/tui/components/effort-picker.js'
import { PermissionPicker } from '../../src/tui/components/permission-picker.js'
import { PlanApprovalCard } from '../../src/tui/components/plan-card.js'
import { defaultTheme } from '../../src/tui/theme.js'

describe('PermissionPicker', () => {
  it('renders codex-style modes with the current one highlighted and applies a safe pick directly', async () => {
    const onPick = vi.fn()
    const app = render(
      <PermissionPicker
        theme={defaultTheme}
        current="default"
        onPick={onPick}
        onClose={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    const text = app.lastFrame() ?? ''
    expect(text).toContain('权限策略切换')
    expect(text).toContain('请求批准')
    expect(text).toContain('自动权限')
    expect(text).toContain('完全访问')
    expect(text).toContain('✓当前')

    app.stdin.write('3') // plan
    await new Promise<void>((resolveTick) => setImmediate(resolveTick))
    expect(onPick).toHaveBeenCalledWith('plan')
    app.unmount()
  })

  it('requires a second confirm before arming permission bypass', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <PermissionPicker
        theme={defaultTheme}
        current="acceptEdits"
        onPick={onPick}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    )
    app.stdin.write('\u001b[B') // down to plan
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
        current="plan"
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

describe('PlanApprovalCard', () => {
  it('submits on enter and iterates on escape with a bounded preview', async () => {
    const longPlan = Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join('\n')
    const onApprove = vi.fn()
    const onDismiss = vi.fn()
    const app = render(
      <PlanApprovalCard
        proposal={longPlan}
        theme={defaultTheme}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    )
    const shown = app.lastFrame() ?? ''
    expect(shown).toContain('step 1')
    expect(shown).toContain('共 40 行')
    expect(shown).not.toContain('step 20')

    app.stdin.write('\r')
    await tick()
    expect(onApprove).toHaveBeenCalledTimes(1)
    app.unmount()

    const second = render(
      <PlanApprovalCard
        proposal="short plan"
        theme={defaultTheme}
        onApprove={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    second.stdin.write('\u001b')
    await escapeTick()
    expect(onDismiss).toHaveBeenCalledTimes(1)
    second.unmount()
  })
})

describe('EffortPicker', () => {
  it('lists auto/low/medium/high/max/off, marks the current level, and picks via enter', async () => {
    const onPick = vi.fn()
    const app = render(
      <EffortPicker theme={defaultTheme} current="low" onPick={onPick} onClose={vi.fn()} />,
    )
    const text = app.lastFrame() ?? ''
    for (const label of ['auto', 'low', 'medium', 'high', 'max', 'off']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('✓当前')

    app.stdin.write('\u001b[A') // up: low -> auto? down order is auto..off, up from low(index1) -> auto(index0)
    await tick()
    app.stdin.write('\r')
    await tick()
    expect(onPick).toHaveBeenCalledWith(undefined)
    app.unmount()
  })

  it('picks by digit and closes on escape', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <EffortPicker theme={defaultTheme} current={undefined} onPick={onPick} onClose={onClose} />,
    )
    app.stdin.write('5') // max
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
