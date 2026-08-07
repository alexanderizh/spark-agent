// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasCinematicEmptyState } from './CanvasCinematicEmptyState'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get: () => () => React.createElement('span'),
    },
  ),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('CanvasCinematicEmptyState', () => {
  it('accepts a prompt and submits it to the canvas Agent entry', async () => {
    const onStartWithAgent = vi.fn()
    const onSubmitAgentPrompt = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <CanvasCinematicEmptyState
          onStartWithAgent={onStartWithAgent}
          onSubmitAgentPrompt={onSubmitAgentPrompt}
          onOpenInlineAi={vi.fn()}
          onUploadFiles={vi.fn()}
          onOpenWorkflowLibrary={vi.fn()}
        />,
      ),
    )

    expect(container.querySelector('.canvas-cinematic-command-hint')?.textContent).toBe(
      '双击画布创建第一个节点',
    )

    const input = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="向画布 Agent 发送消息"]',
    )
    expect(input).not.toBeNull()
    await act(async () => {
      input?.focus()
      if (input) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set
        valueSetter?.call(input, '  创建一组电影分镜  ')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    expect(onStartWithAgent).toHaveBeenCalledTimes(1)

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })

    expect(onSubmitAgentPrompt).toHaveBeenCalledWith('创建一组电影分镜')
    expect(input?.value).toBe('')
  })
})
