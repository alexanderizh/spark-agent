// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown, Modal } from 'antd'
import { Checkbox as LobeCheckbox, TextArea as LobeTextArea } from '@lobehub/ui'
import { AppDialogHost, AppProvider, useApp } from '../design/AppContext'
import { ComposerActionsMenu } from '../design/components/ComposerActionsMenu'
import { ToastProvider } from '../design/components/Toast'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function mouseOver(element: Element) {
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
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
  const normalizedText = text.replace(/\s/g, '')
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.replace(/\s/g, '').includes(normalizedText))
  expect(button).toBeDefined()
  if (button == null) throw new Error(`Button not found: ${text}`)
  return button
}

describe('Desktop UI system overlays', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('min-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
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
          <Dropdown menu={{ items: [{ key: '7d', label: '最近 7 天' }] }}>
            <button type="button">筛选</button>
          </Dropdown>
        </div>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<ClippedMenu />)
    })

    await act(async () => {
      mouseOver(buttonByText('筛选'))
    })

    const clipper = container.querySelector('[data-testid="clipper"]')
    let menu: Element | null = null
    await vi.waitFor(() => {
      menu = Array.from(document.body.querySelectorAll('.ant-dropdown')).find((candidate) =>
        candidate.textContent?.includes('最近 7 天'),
      ) ?? null
      expect(menu).not.toBeNull()
    })

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
      root.render(
        <AppProvider>
          <ConfirmHarness />
          <AppDialogHost />
        </AppProvider>,
      )
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
      root.render(
        <AppProvider>
          <PromptHarness />
          <AppDialogHost />
        </AppProvider>,
      )
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

  it('keeps global confirm dialogs above modals opened later in the session', async () => {
    function ConfirmAboveModalHarness() {
      const { requestConfirm } = useApp()
      const [skillOpen, setSkillOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setSkillOpen(true)}>
            打开技能详情
          </button>
          <Modal open={skillOpen} title="技能详情" className="skill-detail-modal">
            技能内容
          </Modal>
          <button
            type="button"
            onClick={() => {
              void requestConfirm({
                title: '卸载？',
                description: '确认卸载',
                confirmText: '卸载',
                danger: true,
              })
            }}
          >
            卸载
          </button>
        </>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <ConfirmAboveModalHarness />
          <AppDialogHost />
        </AppProvider>,
      )
    })

    // 会话中先触发过一次全局确认弹窗：其 portal 关闭后仍常驻 body
    await act(async () => {
      click(buttonByText('卸载'))
      await Promise.resolve()
    })
    await act(async () => {
      click(buttonByText('取消'))
      await Promise.resolve()
    })

    // 之后再打开普通弹窗（技能详情），门户排在确认弹窗之后
    await act(async () => {
      click(buttonByText('打开技能详情'))
      await Promise.resolve()
    })

    // 在技能详情弹窗内再次触发确认弹窗
    await act(async () => {
      click(buttonByText('卸载'))
      await Promise.resolve()
    })

    const wraps = Array.from(document.body.querySelectorAll<HTMLElement>('.ant-modal-wrap'))
    const confirmWrap = wraps.find((wrap) =>
      wrap.querySelector('.spark-confirm-dialog') != null,
    )
    const skillWrap = wraps.find((wrap) =>
      wrap.querySelector('.skill-detail-modal') != null,
    )
    expect(confirmWrap).toBeDefined()
    expect(skillWrap).toBeDefined()

    const confirmZ = Number(confirmWrap?.style.zIndex ?? 0)
    const skillZ = Number(skillWrap?.style.zIndex ?? 0)
    // 确认弹窗必须有显式 z-index，且高于普通弹窗，否则会被后开的普通弹窗盖住
    expect(confirmZ).toBeGreaterThan(0)
    expect(confirmZ).toBeGreaterThan(skillZ)
  })

  it('keeps custom textarea and checkbox controls usable', () => {
    function FormHarness() {
      const [notes, setNotes] = React.useState('')
      const [enabled, setEnabled] = React.useState(false)
      return (
        <>
          <LobeTextArea value={notes} onChange={(event) => setNotes(event.target.value)} />
          <LobeCheckbox
            checked={enabled}
            onChange={(checked) => setEnabled(checked)}
          >
            启用技能
          </LobeCheckbox>
          <span data-testid="form-state">{`${notes}:${String(enabled)}`}</span>
        </>
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(<FormHarness />)
    })

    // Lobe's TextArea wraps antd Input.TextArea → renders a real <textarea>.
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    // Lobe's Checkbox is a div with onClick (no <input type="checkbox">).
    // Find the clickable wrapper that contains the label text.
    const labelSpan = Array.from(container.querySelectorAll('span'))
      .find((el) => el.textContent === '启用技能')
    const checkbox = labelSpan?.parentElement
    expect(textarea).not.toBeNull()
    expect(checkbox).not.toBeNull()

    act(() => {
      if (textarea == null || checkbox == null) throw new Error('Form controls missing')
      setInputValue(textarea, 'ready')
      checkbox.click()
    })

    expect(container.querySelector('[data-testid="form-state"]')?.textContent).toBe('ready:true')
  })

  it('omits the placeholder summarize action from the composer add menu', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <ComposerActionsMenu
            onAddAttachments={vi.fn()}
            onInsertSkillMention={vi.fn()}
          />
        </ToastProvider>,
      )
    })

    act(() => {
      const trigger = container.querySelector<HTMLButtonElement>('.composer-actions-trigger')
      expect(trigger).not.toBeNull()
      if (trigger == null) throw new Error('Composer actions trigger missing')
      click(trigger)
    })

    expect(container.textContent).toContain('添加文件或图片')
    expect(container.textContent).toContain('技能')
    expect(container.textContent).not.toContain('总结')
  })

  it('closes the skills submenu when hovering another composer add menu item', async () => {
    vi.stubGlobal('spark', {
      invoke: vi.fn(async () => ({ skills: [] })),
      on: vi.fn(() => vi.fn()),
    })

    act(() => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <ComposerActionsMenu
            onAddAttachments={vi.fn()}
            onInsertSkillMention={vi.fn()}
          />
        </ToastProvider>,
      )
    })

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('.composer-actions-trigger')
      expect(trigger).not.toBeNull()
      if (trigger == null) throw new Error('Composer actions trigger missing')
      click(trigger)
    })

    const addItem = Array.from(container.querySelectorAll<HTMLElement>('.composer-actions-item'))
      .find((item) => item.textContent?.includes('添加文件或图片'))
    const skillItem = Array.from(container.querySelectorAll<HTMLElement>('.composer-actions-item'))
      .find((item) => item.textContent?.includes('技能'))

    expect(addItem).toBeDefined()
    expect(skillItem).toBeDefined()
    if (addItem == null || skillItem == null) throw new Error('Composer menu items missing')

    await act(async () => {
      mouseOver(skillItem)
      await Promise.resolve()
    })

    expect(skillItem.classList.contains('sub-open')).toBe(true)
    expect(container.querySelector('.composer-actions-sub')).not.toBeNull()

    await act(async () => {
      mouseOver(addItem)
      await Promise.resolve()
    })

    expect(skillItem.classList.contains('sub-open')).toBe(false)
    expect(container.querySelector('.composer-actions-sub')).toBeNull()
  })
})
