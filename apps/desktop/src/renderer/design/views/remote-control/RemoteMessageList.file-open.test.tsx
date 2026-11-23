// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileOpenHandler } from '../../components/fileOpenRouting'
import { RemoteMessageList } from './RemoteMessageList'

const mocks = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  fetchRemoteAttachment: vi.fn(),
  openLocalFile: vi.fn(),
}))

vi.mock('../../components/Toast', () => ({
  useOptionalToast: () => ({ toast: mocks.toast }),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.openLocalFile }),
}))

vi.mock('./remoteFileCache', () => ({
  fetchRemoteAttachment: mocks.fetchRemoteAttachment,
  remoteFileUrl: vi.fn(() => ''),
  useRemoteFile: vi.fn(() => ({ loading: false, error: null, localPath: null, text: null })),
}))

vi.mock('../chat/ChatMarkdown', () => ({
  MarkdownText: ({ onFilePreview }: { onFilePreview?: FileOpenHandler }) => (
    <button type="button" onClick={() => onFilePreview?.('/remote/report.ts', 'text')}>
      Open remote file
    </button>
  ),
}))

vi.mock('../chat/MessageHoverBar', () => ({ MessageHoverBar: () => null }))
vi.mock('../chat/useMessageTtsAvailable', () => ({ useMessageTtsAvailable: () => false }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteMessageList file path feedback', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchRemoteAttachment.mockResolvedValue({ localPath: 'C:\\cache\\report.ts' })
    mocks.openLocalFile.mockResolvedValue({ opened: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <RemoteMessageList
          deviceId="device-1"
          items={[
            {
              kind: 'assistant',
              id: 'assistant-1',
              seq: 1,
              turnId: 'turn-1',
              text: 'See the generated file.',
              streaming: false,
            },
          ]}
        />,
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows fetch progress and completion when a message file path is opened', async () => {
    let resolveFetch!: (value: { localPath: string }) => void
    mocks.fetchRemoteAttachment.mockReturnValueOnce(
      new Promise<{ localPath: string }>((resolve) => {
        resolveFetch = resolve
      }),
    )
    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    expect(mocks.toast.info).toHaveBeenCalledWith('正在从目标电脑取回：report.ts')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在取回远程文件')

    await act(async () => {
      resolveFetch({ localPath: 'C:\\cache\\report.ts' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(mocks.openLocalFile).toHaveBeenCalledWith({ filePath: 'C:\\cache\\report.ts' })
    expect(mocks.toast.success).toHaveBeenCalledWith('已在系统应用中打开：report.ts')
  })

  it('shows a visible error when the remote file cannot be fetched', async () => {
    mocks.fetchRemoteAttachment.mockRejectedValueOnce(new Error('连接中断'))
    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith('取回远程文件失败：连接中断')
  })
})
