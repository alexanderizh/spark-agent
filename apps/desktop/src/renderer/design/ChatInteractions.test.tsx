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

const { SubagentCard, TurnFileSummaryCard } = await import('./ChatInteractions')
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

  it('hides line statistics when the whole summary has no line changes', () => {
    act(() => {
      root.render(
        <TurnFileSummaryCard
          files={[{ path: '/tmp/generated.bin', changeType: 'modify', adds: 0, dels: 0 }]}
          totalAdds={0}
          totalDels={0}
        />,
      )
    })

    expect(container.querySelector('.diff-stats')).toBeNull()
    expect(container.querySelector('.file-stats')).toBeNull()
  })

  it('shortens absolute paths for display while retaining the full path as the title', () => {
    const fullPath = '/Users/test/project/packages/app/src/index.ts'
    act(() => {
      root.render(
        <TurnFileSummaryCard
          files={[{ path: fullPath, changeType: 'modify', adds: 1, dels: 0 }]}
          totalAdds={1}
          totalDels={0}
          workspaceRootPath="/Users/test/project"
        />,
      )
    })

    const path = container.querySelector('.file-path')
    expect(path?.textContent).toBe('packages/app/src/index.ts')
    expect(path?.getAttribute('title')).toBe(fullPath)
  })
})

describe('SubagentCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.setItem('spark-settings-general', JSON.stringify({ language: 'zh-CN' }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
  })

  it('does not present a repeated task label as progress or execution output', async () => {
    await act(async () => {
      root.render(
        <SubagentCard
          name="Subagent"
          role="List ComfyUI embeddings"
          task="List ComfyUI embeddings"
          status="done"
          tokens=""
          progressSummary="List ComfyUI embeddings"
          resultSummary="List ComfyUI embeddings"
          output="List ComfyUI embeddings"
        />,
      )
    })

    await act(async () => container.querySelector<HTMLElement>('[role="button"]')?.click())

    expect(container.textContent).toContain('任务说明')
    expect(container.textContent).not.toContain('当前进度')
    expect(container.textContent).not.toContain('执行结果')
    expect(container.textContent).toContain('Provider 未提供额外的可读结果')
  })

  it('renders distinct progress, result summary, and structured full output separately', async () => {
    await act(async () => {
      root.render(
        <SubagentCard
          name="researcher"
          role="Authentication specialist"
          task="Trace authentication callbacks."
          status="done"
          tokens="640"
          progressSummary="Reviewing callback registry"
          resultSummary="Two callbacks verified"
          output="Both callbacks preserve the permission scope."
        />,
      )
    })

    await act(async () => container.querySelector<HTMLElement>('[role="button"]')?.click())

    expect(container.textContent).toContain('当前进度')
    expect(container.textContent).toContain('Reviewing callback registry')
    expect(container.textContent).toContain('结果摘要')
    expect(container.textContent).toContain('Two callbacks verified')
    expect(container.textContent).toContain('执行结果')
    expect(container.textContent).toContain('Both callbacks preserve the permission scope.')
  })

  it('does not describe a paused subagent as ended', async () => {
    await act(async () => {
      root.render(
        <SubagentCard
          name="researcher"
          role="Research"
          task="Wait for user input."
          status="paused"
          tokens=""
          output=""
        />,
      )
    })

    await act(async () => container.querySelector<HTMLElement>('[role="button"]')?.click())

    expect(container.textContent).toContain('已暂停')
    expect(container.textContent).not.toContain('任务已结束')
  })
})
