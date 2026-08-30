// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestComposerPrefill, useAppControlComposerPrefill } from './composerAppControl'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness(props: {
  sessionId: string | null
  value: string
  setValue(value: string): void
}) {
  useAppControlComposerPrefill(props)
  return null
}

async function renderHarness(props: React.ComponentProps<typeof Harness>): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness {...props} />))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('composer AppControl prefill', () => {
  it('writes only to the targeted empty composer', async () => {
    const setValue = vi.fn()
    await renderHarness({ sessionId: 'chat-1', value: '', setValue })

    await expect(requestComposerPrefill('Draft only', 'chat-1')).resolves.toBe(true)
    expect(setValue).toHaveBeenCalledWith('Draft only')
  })

  it('rejects overwriting existing user input and ignores another session', async () => {
    const setValue = vi.fn()
    await renderHarness({ sessionId: 'chat-1', value: 'User text', setValue })

    await expect(requestComposerPrefill('Overwrite', 'chat-1')).resolves.toBe(false)
    await expect(requestComposerPrefill('Other session', 'chat-2')).resolves.toBe(false)
    expect(setValue).not.toHaveBeenCalled()
  })
})
