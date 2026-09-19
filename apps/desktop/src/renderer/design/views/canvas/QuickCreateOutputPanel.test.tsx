// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickCreateOutputPanel } from './QuickCreateOutputPanel'
import type { QuickCreateTaskRecord } from './quickCreateTaskStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

const TASK: QuickCreateTaskRecord = {
  id: 'quick-output-test',
  mode: 'image',
  operation: 'text_to_image',
  prompt: '测试输出',
  inputFiles: [{ type: 'image', path: '/tmp/input.png' }],
  modelParams: {},
  status: 'succeeded',
  assets: [
    { type: 'image', filePath: '/tmp/output-a.png', url: 'safe-file:///tmp/output-a.png' },
    { type: 'image', filePath: '/tmp/output-b.png', url: 'safe-file:///tmp/output-b.png' },
  ],
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
}

const RUNNING_TASK: QuickCreateTaskRecord = {
  ...TASK,
  id: 'quick-output-running-test',
  status: 'running',
  assets: [],
  progress: 42,
}

const NO_INPUT_TASK: QuickCreateTaskRecord = {
  ...TASK,
  id: 'quick-output-no-input-test',
  inputFiles: [],
}

function stageImageSrc(): string | null | undefined {
  return document
    .querySelector('.media-artifact-viewer-stage:not(.is-compare) img')
    ?.getAttribute('src')
}

describe('QuickCreateOutputPanel', () => {
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
    document.body.innerHTML = ''
  })

  it('产物舞台使用公用查看器：支持翻页、输入输出对比与全屏大图预览', () => {
    act(() => root.render(<QuickCreateOutputPanel task={TASK} />))

    expect(document.querySelector('.image-lightbox-backdrop')).toBeNull()
    const firstOutputSrc = stageImageSrc()
    expect(firstOutputSrc).toContain('safe-file://')

    // 公用查看器内翻页
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="下一项输出"]')?.click())
    const secondOutputSrc = stageImageSrc()
    expect(secondOutputSrc).toContain('safe-file://')
    expect(secondOutputSrc).not.toBe(firstOutputSrc)

    // 有参考图时显示对比入口，进入左右对比
    act(() => document.querySelector<HTMLButtonElement>('[title="并排查看输入与输出"]')?.click())
    const compareStage = document.querySelector('.media-artifact-viewer-stage.is-compare')
    expect(compareStage).not.toBeNull()
    expect(compareStage?.textContent).toContain('输入图')
    expect(compareStage?.textContent).toContain('输出图')

    act(() => document.querySelector<HTMLButtonElement>('[title="退出对比"]')?.click())
    expect(document.querySelector('.media-artifact-viewer-stage.is-compare')).toBeNull()

    // 大图预览带翻页，显示的是当前输出
    act(() => document.querySelector<HTMLButtonElement>('[title="打开全屏大图预览"]')?.click())
    expect(document.querySelector('.image-lightbox-backdrop')).not.toBeNull()
    expect(document.querySelector('.image-lightbox-img')?.getAttribute('src')).toBe(secondOutputSrc)
    act(() => document.querySelector<HTMLButtonElement>('[title="关闭 (Esc)"]')?.click())
    expect(document.querySelector('.image-lightbox-backdrop')).toBeNull()
  })

  it('没有参考图时不渲染对比入口', () => {
    act(() => root.render(<QuickCreateOutputPanel task={NO_INPUT_TASK} />))

    expect(document.querySelector('[title="并排查看输入与输出"]')).toBeNull()
    expect(stageImageSrc()).toContain('safe-file://')
  })

  it('多图时展示缩略图条，点击缩略图切换当前输出', () => {
    act(() => root.render(<QuickCreateOutputPanel task={TASK} />))

    const thumbs = document.querySelectorAll<HTMLButtonElement>(
      '.quick-create-output-thumbs button',
    )
    expect(thumbs.length).toBe(2)

    // safe-file URL 会把路径编码为 base64，这里直接对比缩略图与舞台的 src 一致性
    const secondThumbSrc = thumbs[1]?.querySelector('img')?.getAttribute('src')
    act(() => thumbs[1]?.click())
    expect(stageImageSrc()).toBe(secondThumbSrc)
    expect(thumbs[1]?.getAttribute('aria-selected')).toBe('true')
  })

  it('查看器工具栏提供复制、下载与打开所在文件夹', () => {
    act(() => root.render(<QuickCreateOutputPanel task={TASK} />))

    expect(document.querySelector('[title="复制图片"]')).not.toBeNull()
    expect(document.querySelector('[title="下载到本地"]')).not.toBeNull()
    expect(document.querySelector('[title="打开产物所在文件夹"]')).not.toBeNull()
  })

  it('运行任务展示处理中动效和进度，失败任务不继续显示 loading', () => {
    act(() => root.render(<QuickCreateOutputPanel task={RUNNING_TASK} />))

    expect(document.querySelector('.quick-create-output-loader')).not.toBeNull()
    expect(document.querySelector('.quick-create-output-progress span')).not.toBeNull()
    expect(document.body.textContent).toContain('创作进行中')

    act(() =>
      root.render(
        <QuickCreateOutputPanel
          task={{
            ...RUNNING_TASK,
            status: 'failed',
            error: { code: 'provider_error', message: 'Provider 暂时不可用' },
          }}
        />,
      ),
    )

    expect(document.querySelector('.quick-create-output-loader')).toBeNull()
    expect(document.body.textContent).toContain('这次创作没有完成')
  })

  it('反推任务的提示词产物带标题并可一键复制', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const reverseText = '逆光下的柯基特写，浅景深，暖色调'
    act(() =>
      root.render(
        <QuickCreateOutputPanel
          task={{
            ...TASK,
            id: 'quick-output-reverse-test',
            mode: 'reverse',
            operation: 'image_prompt_reverse',
            prompt: '',
            assets: [],
            text: reverseText,
          }}
        />,
      ),
    )

    expect(document.querySelector('.quick-create-output-text-head')?.textContent).toContain(
      '反推提示词',
    )
    expect(document.querySelector('.quick-create-output-text')?.textContent).toBe(reverseText)

    const copyButton = document.querySelector<HTMLButtonElement>('[aria-label="复制反推提示词"]')
    expect(copyButton).not.toBeNull()
    await act(async () => copyButton?.click())
    expect(writeText).toHaveBeenCalledWith(reverseText)
  })

  it('空输出只显示下一步提示，不渲染装饰性营销内容', () => {
    act(() => root.render(<QuickCreateOutputPanel />))

    expect(document.querySelector('.quick-create-output-empty-label')).not.toBeNull()
    expect(document.body.textContent).toContain('等待生成')
    expect(document.body.textContent).toContain('填写提示词并点击')
    expect(document.querySelector('.quick-create-output-benefits')).toBeNull()
    expect(document.querySelector('.quick-create-output-tip')).toBeNull()
  })
})
