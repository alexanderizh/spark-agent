// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./views/ChatView', () => ({
  MarkdownText: ({ content }: { content: string }) => React.createElement('div', null, content),
}))
vi.mock('./components/Toast', () => ({
  useToast: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
  }),
}))
vi.mock('./components/SessionFileOpenPicker', () => ({
  SessionFileOpenPicker: () => React.createElement('button', { type: 'button' }, 'open'),
}))
vi.mock('./components/FileDisplay', () => ({
  FileTypeIcon: () => React.createElement('span', null, 'icon'),
  getFileTypeBadge: () => ({ label: 'TS', tone: 'code' }),
}))

const { TurnFileSummaryCard } = await import('./ChatInteractions')
type FileChangeSummaryItem = import('./ChatInteractions').FileChangeSummaryItem

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function buildFiles(count: number): FileChangeSummaryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/tmp/file-${index + 1}.ts`,
    changeType: 'delete',
    adds: index + 1,
    dels: 0,
  }))
}

describe('TurnFileSummaryCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows only the first ten files by default when the list overflows', () => {
    act(() => {
      root.render(<TurnFileSummaryCard files={buildFiles(12)} totalAdds={78} totalDels={0} />)
    })

    expect(container.querySelectorAll('.turn-summary-file-row')).toHaveLength(10)
    expect(container.textContent).toContain('展开剩余 2 个文件')
    expect(container.textContent).not.toContain('/tmp/file-11.ts')
    expect(container.textContent).not.toContain('/tmp/file-12.ts')
  })

  it('reveals the remaining files after manual expansion', async () => {
    act(() => {
      root.render(<TurnFileSummaryCard files={buildFiles(12)} totalAdds={78} totalDels={0} />)
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('展开剩余 2 个文件'),
    )
    expect(button).toBeTruthy()

    await act(async () => {
      button?.click()
    })

    expect(container.querySelectorAll('.turn-summary-file-row')).toHaveLength(12)
    expect(container.textContent).toContain('/tmp/file-11.ts')
    expect(container.textContent).toContain('/tmp/file-12.ts')
    expect(container.textContent).toContain('收起剩余文件')
  })
})
