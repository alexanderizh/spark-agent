// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickCreateTaskHistory } from './QuickCreateTaskHistory'
import type { QuickCreateTaskRecord } from './quickCreateTaskStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

const IMAGE_TASK: QuickCreateTaskRecord = {
  id: 'task-image',
  mode: 'image',
  operation: 'text_to_image',
  prompt: '清晨窗边的静物',
  inputFiles: [],
  modelParams: {},
  status: 'succeeded',
  assets: [
    { type: 'image', filePath: '/tmp/output-a.png' },
    { type: 'image', filePath: '/tmp/output-b.png' },
  ],
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
}

const VIDEO_TASK: QuickCreateTaskRecord = {
  ...IMAGE_TASK,
  id: 'task-video',
  mode: 'video',
  operation: 'text_to_video',
  prompt: '雨夜街头镜头推进',
  assets: [{ type: 'video', filePath: '/tmp/output.mp4' }],
}

const RUNNING_TASK: QuickCreateTaskRecord = {
  ...IMAGE_TASK,
  id: 'task-running',
  status: 'running',
  assets: [],
  progress: 30,
}

const CANCELLED_TASK: QuickCreateTaskRecord = {
  ...IMAGE_TASK,
  id: 'task-cancelled',
  status: 'cancelled',
  assets: [],
}

function renderHistory(root: Root, props: Partial<Parameters<typeof QuickCreateTaskHistory>[0]>) {
  act(() =>
    root.render(
      <QuickCreateTaskHistory
        tasks={[IMAGE_TASK, VIDEO_TASK, RUNNING_TASK]}
        expandedTaskId={null}
        onRowActivate={vi.fn()}
        onReuse={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onOpenOutput={vi.fn()}
        onSavePrompt={vi.fn()}
        {...props}
      />,
    ),
  )
}

describe('QuickCreateTaskHistory', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
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
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('默认列表展示全部记录，切换卡片视图后瀑布流只显示有产物图片的任务', () => {
    renderHistory(root, {})

    expect(document.querySelector('.quick-create-card-grid')).toBeNull()
    expect(document.querySelectorAll('.quick-create-task').length).toBe(3)

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="卡片视图"]')?.click())

    const cards = document.querySelectorAll('.quick-create-card')
    expect(cards.length).toBe(1)
    const coverSrc = document
      .querySelector<HTMLImageElement>('.quick-create-card-media img')
      ?.getAttribute('src')
    expect(coverSrc).toContain('safe-file://')
    expect(document.body.textContent).toContain('2 图')

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="列表视图"]')?.click())
    expect(document.querySelector('.quick-create-card-grid')).toBeNull()
    expect(document.querySelectorAll('.quick-create-task').length).toBe(3)
  })

  it('点击卡片打开详情弹层，弹层内点击图片进入独立产物查看', () => {
    renderHistory(root, {})

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="卡片视图"]')?.click())
    act(() => document.querySelector<HTMLButtonElement>('.quick-create-card-media')?.click())

    const modal = document.querySelector('.quick-create-task-detail-modal')
    expect(modal).not.toBeNull()
    expect(document.body.textContent).toContain('清晨窗边的静物')
    expect(document.querySelector('.quick-create-media-viewer-modal')).toBeNull()

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看大图"]')?.click())
    expect(document.querySelector('.quick-create-media-viewer-modal')).not.toBeNull()
    expect(document.querySelector('.media-artifact-viewer')).not.toBeNull()
    expect(
      document.querySelector('.media-artifact-viewer-stage img')?.getAttribute('src'),
    ).toContain('safe-file://')

    act(() =>
      document
        .querySelector<HTMLButtonElement>('.quick-create-media-viewer-modal .ant-modal-close')
        ?.click(),
    )
    expect(document.querySelector('.quick-create-media-viewer-modal')).toBeNull()
    expect(document.querySelector('.quick-create-task-detail-modal')).not.toBeNull()
  })

  it('弹窗提示词默认 2 行折叠，列表展开行保持 3 行折叠', () => {
    renderHistory(root, { expandedTaskId: IMAGE_TASK.id })

    const listPrompt = document.querySelector<HTMLParagraphElement>(
      '.quick-create-task-detail .quick-create-detail-prompt p',
    )
    expect(listPrompt?.classList.contains('is-clamped')).toBe(true)
    expect(listPrompt?.style.webkitLineClamp).toBe('3')

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="卡片视图"]')?.click())
    act(() => document.querySelector<HTMLButtonElement>('.quick-create-card-media')?.click())

    const modalPrompt = document.querySelector<HTMLParagraphElement>(
      '.quick-create-task-detail-modal .quick-create-detail-prompt p',
    )
    expect(modalPrompt?.classList.contains('is-clamped')).toBe(true)
    expect(modalPrompt?.style.webkitLineClamp).toBe('2')
  })

  it('列表详情内查看产物使用独立弹层，不切换创作结果区块', () => {
    renderHistory(root, { expandedTaskId: IMAGE_TASK.id })

    act(() =>
      document.querySelector<HTMLButtonElement>('.quick-create-history-output-thumb')?.click(),
    )

    expect(document.querySelector('.quick-create-media-viewer-modal')).not.toBeNull()
    expect(document.querySelector('.media-artifact-viewer-stage img')).not.toBeNull()

    act(() =>
      document
        .querySelector<HTMLButtonElement>('.quick-create-media-viewer-modal .ant-modal-close')
        ?.click(),
    )
    expect(document.querySelector('.quick-create-media-viewer-modal')).toBeNull()
  })

  it('视频任务详情的产物以独立弹层查看并提供视频播放器', () => {
    renderHistory(root, { expandedTaskId: VIDEO_TASK.id })

    act(() =>
      document.querySelector<HTMLButtonElement>('.quick-create-history-output-thumb')?.click(),
    )

    expect(document.querySelector('.quick-create-media-viewer-modal')).not.toBeNull()
    expect(document.querySelector('.media-artifact-video')).not.toBeNull()
  })

  it('列表视图点击任务行仍触发行激活回调', () => {
    const onRowActivate = vi.fn()
    renderHistory(root, { onRowActivate })

    act(() => document.querySelector<HTMLButtonElement>('.quick-create-task-main')?.click())

    expect(onRowActivate).toHaveBeenCalledTimes(1)
    expect(onRowActivate).toHaveBeenCalledWith(IMAGE_TASK)
  })

  it('列表操作列使用纯图标按钮并调用现有任务操作', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const onRowActivate = vi.fn()
    const onRetry = vi.fn()
    const onReuse = vi.fn()
    const onSavePrompt = vi.fn()
    const onOpenOutput = vi.fn()
    const onDelete = vi.fn()
    renderHistory(root, {
      onRowActivate,
      onRetry,
      onReuse,
      onSavePrompt,
      onOpenOutput,
      onDelete,
    })

    const actions = document.querySelector('.quick-create-list-actions')
    expect(actions).not.toBeNull()
    expect(actions?.querySelectorAll('button')).toHaveLength(6)
    expect(actions?.textContent).toBe('')

    await act(async () =>
      actions?.querySelector<HTMLButtonElement>('[aria-label="复制提示词"]')?.click(),
    )
    act(() => actions?.querySelector<HTMLButtonElement>('[aria-label="重新生成"]')?.click())
    act(() => actions?.querySelector<HTMLButtonElement>('[aria-label="复用配置"]')?.click())
    act(() => actions?.querySelector<HTMLButtonElement>('[aria-label="存入提示词库"]')?.click())
    act(() => actions?.querySelector<HTMLButtonElement>('[aria-label="打开产物"]')?.click())
    act(() => actions?.querySelector<HTMLButtonElement>('[aria-label="移除记录"]')?.click())

    expect(writeText).toHaveBeenCalledWith(IMAGE_TASK.prompt)
    expect(onRetry).toHaveBeenCalledWith(IMAGE_TASK)
    expect(onReuse).toHaveBeenCalledWith(IMAGE_TASK)
    expect(onSavePrompt).toHaveBeenCalledWith(IMAGE_TASK)
    expect(onOpenOutput).toHaveBeenCalledWith(IMAGE_TASK.assets[0])
    expect(onDelete).toHaveBeenCalledWith(IMAGE_TASK.id)
    expect(onRowActivate).not.toHaveBeenCalled()
  })

  it('列表操作列的移除记录按钮带危险色标识，与只读操作区分', () => {
    renderHistory(root, {})

    const removeButton = document.querySelector<HTMLButtonElement>(
      '.quick-create-list-actions [aria-label="移除记录"]',
    )
    expect(removeButton).not.toBeNull()
    expect(removeButton?.classList.contains('is-danger')).toBe(true)
    const reuseButton = document.querySelector<HTMLButtonElement>(
      '.quick-create-list-actions [aria-label="复用配置"]',
    )
    expect(reuseButton?.className.includes('is-danger')).toBe(false)
  })

  it('运行中任务的列表操作列不显示重试和打开产物', () => {
    renderHistory(root, { tasks: [RUNNING_TASK] })

    const actions = document.querySelector('.quick-create-list-actions')
    expect(actions?.querySelector('[aria-label="重试"]')).toBeNull()
    expect(actions?.querySelector('[aria-label="重新生成"]')).toBeNull()
    expect(actions?.querySelector('[aria-label="打开产物"]')).toBeNull()
    expect(actions?.querySelector('[aria-label="复用配置"]')).not.toBeNull()
    expect(actions?.querySelector('[aria-label="移除记录"]')).not.toBeNull()
  })

  it('展开行详情使用差异色详情区块', () => {
    renderHistory(root, { expandedTaskId: IMAGE_TASK.id })

    expect(
      document.querySelector('.quick-create-task.is-expanded .quick-create-task-detail'),
    ).not.toBeNull()
  })

  it('在任务详情操作区保存提示词到提示词库', () => {
    const onSavePrompt = vi.fn()
    renderHistory(root, { onSavePrompt, expandedTaskId: IMAGE_TASK.id })

    act(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-create-task-actions button'))
        .find((button) => button.textContent?.includes('存入提示词库'))
        ?.click(),
    )

    expect(onSavePrompt).toHaveBeenCalledWith(IMAGE_TASK)
  })

  it('任务详情提示词 label 后可一键复制提示词', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderHistory(root, { expandedTaskId: IMAGE_TASK.id })

    const copyButton = document.querySelector<HTMLButtonElement>(
      '.quick-create-detail-prompt [aria-label="复制提示词"]',
    )
    expect(copyButton).not.toBeNull()

    await act(async () => copyButton?.click())
    expect(writeText).toHaveBeenCalledWith('清晨窗边的静物')
  })

  it('反推任务输入提示词为空时提示词块不显示复制，反推产物提示词可一键复制', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const reverseText = '逆光下的柯基特写，浅景深，暖色调'
    const reverseTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-reverse',
      mode: 'reverse',
      operation: 'image_prompt_reverse',
      prompt: '',
      assets: [],
      text: reverseText,
    }
    renderHistory(root, { tasks: [reverseTask], expandedTaskId: reverseTask.id })

    expect(document.body.textContent).toContain('图片反推任务')
    const blocks = document.querySelectorAll(
      '.quick-create-task-detail .quick-create-detail-prompt',
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.querySelector('[aria-label="复制提示词"]')).toBeNull()

    const resultBlock = blocks[1]
    expect(resultBlock?.textContent).toContain('反推提示词')
    const copyButton =
      resultBlock?.querySelector<HTMLButtonElement>('[aria-label="复制反推提示词"]')
    expect(copyButton).not.toBeNull()

    await act(async () => copyButton?.click())
    expect(writeText).toHaveBeenCalledWith(reverseText)
  })

  it('反推任务的列表操作列复制的是反推产物提示词', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const reverseTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-reverse-list',
      mode: 'reverse',
      operation: 'image_prompt_reverse',
      prompt: '',
      assets: [],
      text: '逆光下的柯基特写',
    }
    renderHistory(root, { tasks: [reverseTask] })

    const actions = document.querySelector('.quick-create-list-actions')
    expect(actions?.querySelector('[aria-label="复制提示词"]')).toBeNull()
    const copyButton = actions?.querySelector<HTMLButtonElement>('[aria-label="复制反推提示词"]')
    expect(copyButton).not.toBeNull()

    await act(async () => copyButton?.click())
    expect(writeText).toHaveBeenCalledWith('逆光下的柯基特写')
  })

  it('反推任务未产出提示词时不显示任何复制入口', () => {
    const runningReverseTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-reverse-running',
      mode: 'reverse',
      operation: 'image_prompt_reverse',
      prompt: '',
      assets: [],
      status: 'running',
    }
    renderHistory(root, { tasks: [runningReverseTask], expandedTaskId: runningReverseTask.id })

    const actions = document.querySelector('.quick-create-list-actions')
    expect(actions?.querySelector('[aria-label^="复制"]')).toBeNull()
    expect(document.querySelector('.quick-create-task-detail [aria-label^="复制"]')).toBeNull()
  })

  it('成功任务详情显示重新生成并回调重试', () => {
    const onRetry = vi.fn()
    renderHistory(root, { onRetry, expandedTaskId: IMAGE_TASK.id })

    const retryButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.quick-create-task-actions button'),
    ).find((button) => button.textContent?.includes('重新生成'))
    expect(retryButton).toBeDefined()

    act(() => retryButton?.click())
    expect(onRetry).toHaveBeenCalledWith(IMAGE_TASK)
  })

  it('已取消任务显示重试按钮', () => {
    const onRetry = vi.fn()
    renderHistory(root, { tasks: [CANCELLED_TASK], onRetry, expandedTaskId: CANCELLED_TASK.id })

    const retryButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.quick-create-task-actions button'),
    ).find((button) => button.textContent?.includes('重试'))
    expect(retryButton).toBeDefined()

    act(() => retryButton?.click())
    expect(onRetry).toHaveBeenCalledWith(CANCELLED_TASK)
  })

  it('任意状态（含运行中）都显示复用配置', () => {
    const onReuse = vi.fn()
    renderHistory(root, { tasks: [RUNNING_TASK], onReuse, expandedTaskId: RUNNING_TASK.id })

    const reuseButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.quick-create-task-actions button'),
    ).find((button) => button.textContent?.includes('复用配置'))
    expect(reuseButton).toBeDefined()
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('.quick-create-task-actions button'),
      ).some((button) => button.textContent?.includes('重试')),
    ).toBe(false)

    act(() => reuseButton?.click())
    expect(onReuse).toHaveBeenCalledWith(RUNNING_TASK)
  })
})
