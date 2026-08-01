// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listFiles: vi.fn(),
  getFile: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => {
    const invoke =
      channel === 'provider:list'
        ? mocks.listProviders
        : channel === 'provider:files:list'
          ? mocks.listFiles
          : channel === 'provider:files:get'
            ? mocks.getFile
            : channel === 'provider:files:upload'
              ? mocks.uploadFile
              : mocks.deleteFile
    return { invoke, loading: false, error: null }
  },
}))

vi.mock('@lobehub/ui', async () => {
  const React = await import('react')
  return {
    Alert: ({ message }: { message: React.ReactNode }) => React.createElement('div', null, message),
    Button: ({
      children,
      disabled,
      onClick,
    }: {
      children: React.ReactNode
      disabled?: boolean
      onClick?: () => void
    }) => React.createElement('button', { disabled, onClick }, children),
  }
})

vi.mock('antd', async () => {
  const React = await import('react')
  const Modal = ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? React.createElement('div', null, children) : null
  Modal.confirm = vi.fn()
  return {
    Checkbox: ({ checked, onChange }: { checked?: boolean; onChange?: (event: unknown) => void }) =>
      React.createElement('input', { type: 'checkbox', checked, onChange }),
    ConfigProvider: ({ children }: { children: React.ReactNode }) => children,
    Empty: ({ description }: { description?: React.ReactNode }) =>
      React.createElement('div', null, description),
    Input: ({ allowClear: _allowClear, ...props }: Record<string, unknown>) =>
      React.createElement('input', props),
    InputNumber: (props: Record<string, unknown>) => React.createElement('input', props),
    Modal,
    Select: ({ options = [] }: { options?: Array<{ value: string; label: React.ReactNode }> }) =>
      React.createElement(
        'select',
        null,
        options.map((option) =>
          React.createElement('option', { key: option.value, value: option.value }, option.label),
        ),
      ),
    Switch: (props: Record<string, unknown>) =>
      React.createElement('input', { ...props, type: 'checkbox' }),
    Tag: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
    message: { error: vi.fn(), success: vi.fn() },
  }
})

vi.mock('../../Icons', async () => {
  const React = await import('react')
  const Icon = () => React.createElement('span')
  return { Icons: { FolderOpen: Icon, Refresh: Icon, Upload: Icon } }
})

import { CanvasProviderFilesTab } from './CanvasProviderFilesTab'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function providerFiles(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = `file-${start + index}`
    return {
      id,
      filename: `${id}.png`,
      bytes: 1024,
      createdAt: 1_753_987_200,
      purpose: 'user_data',
      object: 'file',
      status: 'active',
    }
  })
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

describe('CanvasProviderFilesTab pagination', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.listProviders.mockResolvedValue({
      profiles: [
        {
          id: 'ark-1',
          name: 'Ark',
          defaultModel: 'doubao',
          mediaProvider: 'volcengine-ark',
        },
      ],
    })
    mocks.listFiles
      .mockResolvedValueOnce({
        providerKind: 'volcengine-ark',
        files: providerFiles(0, 100),
        paginationToken: 'next-1',
      })
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        providerKind: 'volcengine-ark',
        files: providerFiles(100, 100),
      })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not skip a page when loading the next provider batch fails and is retried', async () => {
    await act(async () => root.render(<CanvasProviderFilesTab />))
    await flushEffects()
    await flushEffects()

    for (let page = 2; page <= 5; page += 1) {
      const next = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === '下一页',
      )
      await act(async () => next?.click())
    }
    expect(container.textContent).toContain('第 5 / 5 页')

    let next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '下一页',
    )
    await act(async () => next?.click())
    expect(container.textContent).toContain('第 5 / 5 页')

    next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '下一页',
    )
    await act(async () => next?.click())

    expect(container.textContent).toContain('第 6 / 10 页')
  })
})
