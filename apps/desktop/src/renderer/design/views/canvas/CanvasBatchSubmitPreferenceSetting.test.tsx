// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY,
  writeSkipCanvasBatchSubmitConfirmation,
} from './canvasBatchSubmitPreferences'
import { CanvasBatchSubmitPreferenceSetting } from './CanvasBatchSubmitPreferenceSetting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Switch: ({
      checked,
      onChange,
    }: {
      checked?: boolean
      onChange?: (checked: boolean) => void
    }) =>
      ReactActual.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        onClick: () => onChange?.(!checked),
      }),
  }
})

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

async function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasBatchSubmitPreferenceSetting />))
  return container
}

describe('CanvasBatchSubmitPreferenceSetting', () => {
  it('shows confirmation by default and persists direct-submit mode', async () => {
    const container = await render()
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle.click())

    expect(window.localStorage.getItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY)).toBe('true')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('synchronizes when the preference changes elsewhere', async () => {
    const container = await render()
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!

    await act(async () => writeSkipCanvasBatchSubmitConfirmation(true))

    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
