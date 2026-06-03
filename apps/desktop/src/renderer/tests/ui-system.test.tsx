// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@spark/ui-kit'
import { AppProvider, useApp } from '../design/AppContext'
import { SparkCheckbox, SparkTextarea } from '../design/components/FormControls'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function pointerDown(element: Element) {
  element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  }))
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  expect(setter).toBeDefined()
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text))
  expect(button).toBeDefined()
  if (button == null) throw new Error(`Button not found: ${text}`)
  return button
}

describe('Desktop UI system overlays', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    if (!('PointerEvent' in window)) {
      vi.stubGlobal('PointerEvent', MouseEvent)
    }
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('portals dropdown content outside clipped sidebar containers', async () => {
    function ClippedMenu() {
      return (
        <div data-testid="clipper" style={{ overflow: 'hidden', width: 80, height: 32 }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button">筛选</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-testid="filter-menu">
              <DropdownMenuItem>最近 7 天</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<ClippedMenu />)
    })

    await act(async () => {
      pointerDown(buttonByText('筛选'))
    })

    const clipper = container.querySelector('[data-testid="clipper"]')
    const menu = document.body.querySelector('[data-testid="filter-menu"]')

    expect(menu).not.toBeNull()
    expect(clipper?.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
  })

  it('resolves app confirm dialogs without native confirm', async () => {
    function ConfirmHarness() {
      const { requestConfirm } = useApp()
      const [result, setResult] = React.useState('pending')
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void requestConfirm({
                title: '离开当前表单？',
                description: '未保存内容会保留在当前页面。',
                confirmText: '继续',
              }).then((confirmed) => setResult(String(confirmed)))
            }}
          >
            打开确认
          </button>
          <span data-testid="confirm-result">{result}</span>
        </>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<AppProvider><ConfirmHarness /></AppProvider>)
    })

    await act(async () => {
      click(buttonByText('打开确认'))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('离开当前表单？')

    await act(async () => {
      click(buttonByText('继续'))
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="confirm-result"]')?.textContent).toBe('true')
  })

  it('resolves app prompt dialogs with typed form values', async () => {
    function PromptHarness() {
      const { requestPrompt } = useApp()
      const [result, setResult] = React.useState('pending')
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void requestPrompt({
                title: '重命名 Agent',
                value: '默认名称',
                confirmText: '保存',
              }).then((value) => setResult(value ?? 'cancelled'))
            }}
          >
            打开输入
          </button>
          <span data-testid="prompt-result">{result}</span>
        </>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<AppProvider><PromptHarness /></AppProvider>)
    })

    await act(async () => {
      click(buttonByText('打开输入'))
      await Promise.resolve()
    })

    const input = document.body.querySelector<HTMLInputElement>('.spark-confirm-dialog input')
    expect(input).not.toBeNull()

    await act(async () => {
      if (input == null) throw new Error('Prompt input missing')
      setInputValue(input, 'Research Agent')
      click(buttonByText('保存'))
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="prompt-result"]')?.textContent).toBe('Research Agent')
  })

  it('keeps custom textarea and checkbox controls usable', () => {
    function FormHarness() {
      const [notes, setNotes] = React.useState('')
      const [enabled, setEnabled] = React.useState(false)
      return (
        <>
          <SparkTextarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          <SparkCheckbox
            checked={enabled}
            label="启用技能"
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span data-testid="form-state">{`${notes}:${String(enabled)}`}</span>
        </>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<FormHarness />)
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.spark-textarea')
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(textarea).not.toBeNull()
    expect(checkbox).not.toBeNull()

    act(() => {
      if (textarea == null || checkbox == null) throw new Error('Form controls missing')
      setInputValue(textarea, 'ready')
      checkbox.click()
    })

    expect(container.querySelector('[data-testid="form-state"]')?.textContent).toBe('ready:true')
  })
})
