// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../chat/ChatMarkdown', () => ({ MarkdownText: 'div' }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import {
  CanvasOperationOutputList,
  CanvasOperationOutputPreview,
} from './CanvasOperationOutputPreview'
import type { CanvasOperationOutputView } from './canvasOperationRuns'

const at = '2026-07-15T00:00:00.000Z'

function characterOutput(id: string, title: string): CanvasOperationOutputView {
  return {
    id,
    type: 'text',
    title,
    text: `${title}的角色设定描述`,
    pipelineRole: 'character',
    createdAt: at,
    updatedAt: at,
  }
}

describe('CanvasOperationOutputList', () => {
  it('在同一节点中按列表展示全部角色产物及数量', () => {
    const html = renderToStaticMarkup(
      <CanvasOperationOutputList
        outputs={[
          characterOutput('character-1', '苏烬'),
          characterOutput('character-2', '林雾'),
          characterOutput('character-3', '陈默'),
        ]}
      />,
    )

    expect(html).toContain('3 个角色')
    expect(html).toContain('苏烬')
    expect(html).toContain('林雾')
    expect(html).toContain('陈默')
    expect(html.match(/class="canvas-operation-output-list-item"/g)).toHaveLength(3)
  })

  it('为角色结果标记角色语义，供角色图标与样式使用', () => {
    const html = renderToStaticMarkup(
      <CanvasOperationOutputList outputs={[characterOutput('character-1', '苏烬')]} />,
    )

    expect(html).toContain('data-output-role="character"')
  })

  it('未选中节点的产物列表不隔离滚轮', () => {
    const html = renderToStaticMarkup(
      <CanvasOperationOutputList
        outputs={[characterOutput('character-1', '苏烬')]}
        isolateWheel={false}
      />,
    )

    expect(html).toContain('class="canvas-operation-output-list"')
    expect(html).not.toContain('nowheel')
  })

  it('为每个产物提供展开按钮，并只回传被点击的产物', async () => {
    const outputs = [characterOutput('character-1', '苏烬'), characterOutput('character-2', '林雾')]
    const onExpandOutput = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasOperationOutputList outputs={outputs} onExpandOutput={onExpandOutput} />)
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '.canvas-operation-output-list-expand',
    )
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('展开产物 苏烬')

    await act(async () => buttons[1]?.click())
    expect(onExpandOutput).toHaveBeenCalledTimes(1)
    expect(onExpandOutput).toHaveBeenCalledWith(outputs[1])

    await act(async () => root.unmount())
  })

  it('为每个产物提供删除按钮，并只回传被点击的产物', async () => {
    const outputs = [characterOutput('character-1', '苏烬'), characterOutput('character-2', '林雾')]
    const onDeleteOutput = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasOperationOutputList outputs={outputs} onDeleteOutput={onDeleteOutput} />)
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '.canvas-operation-output-list-delete',
    )
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('删除产物 苏烬')

    await act(async () => buttons[1]?.click())
    expect(onDeleteOutput).toHaveBeenCalledTimes(1)
    expect(onDeleteOutput).toHaveBeenCalledWith(outputs[1])

    await act(async () => root.unmount())
  })
})

describe('CanvasOperationOutputPreview', () => {
  it('详情图片默认填满预览舞台并提供独立缩放工具栏', async () => {
    const output: CanvasOperationOutputView = {
      id: 'image-output',
      type: 'image',
      title: '海边日落',
      url: 'https://example.com/sunset.png',
      createdAt: at,
      updatedAt: at,
    }
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasOperationOutputPreview output={output} variant="detail" />)
    })

    expect(
      container.querySelector('.canvas-operation-output-image-preview.is-detail'),
    ).not.toBeNull()
    expect(container.querySelector('[aria-label="图片缩放工具栏"]')?.textContent).toContain('100%')
    expect(
      container.querySelector<HTMLImageElement>('.canvas-operation-output-media.is-detail')?.style
        .transform,
    ).toContain('scale(1)')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="放大图片"]')?.click()
    })
    expect(container.querySelector('[aria-label="图片缩放工具栏"]')?.textContent).toContain('125%')

    await act(async () => root.unmount())
  })

  it('节点卡片图片不挂载详情缩放层，也不拦截节点拖拽', () => {
    const output: CanvasOperationOutputView = {
      id: 'image-output',
      type: 'image',
      title: '海边日落',
      url: 'https://example.com/sunset.png',
      createdAt: at,
      updatedAt: at,
    }

    const html = renderToStaticMarkup(<CanvasOperationOutputPreview output={output} />)

    expect(html).toContain('canvas-operation-output-media is-card')
    expect(html).not.toContain('canvas-operation-output-image-zoom')
    // 节点卡片内产物区域不再包装拖拽源，抓取图片应移动节点本身而不是启动产物拖拽。
    expect(html).not.toContain('canvas-agent-artifact-drag-source')
    expect(html).not.toContain('nodrag')
  })

  it('本地产物在详情面板成为可拖入 Agent 会话的拖拽源', () => {
    const output: CanvasOperationOutputView = {
      id: 'local-image-output',
      type: 'image',
      title: '本地镜头图',
      url: 'safe-file://x/L3Byb2plY3QvYXNzZXRzL3Nob3QucG5n',
      filePath: '/project/assets/shot.png',
      createdAt: at,
      updatedAt: at,
    }

    const html = renderToStaticMarkup(
      <CanvasOperationOutputPreview output={output} variant="detail" />,
    )

    expect(html).toContain('canvas-agent-artifact-drag-source')
    expect(html).toContain('draggable="true"')
    expect(html).toContain('title="拖入 Agent 对话"')
  })

  it('切换详情产物时重置图片缩放状态', async () => {
    const first: CanvasOperationOutputView = {
      id: 'image-a',
      type: 'image',
      title: '图片 A',
      url: 'https://example.com/a.png',
      createdAt: at,
      updatedAt: at,
    }
    const second: CanvasOperationOutputView = {
      ...first,
      id: 'image-b',
      title: '图片 B',
      url: 'https://example.com/b.png',
    }
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasOperationOutputPreview output={first} variant="detail" />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="放大图片"]')?.click()
    })
    expect(container.querySelector('[aria-label="图片缩放工具栏"]')?.textContent).toContain('125%')

    await act(async () => {
      root.render(<CanvasOperationOutputPreview output={second} variant="detail" />)
    })
    expect(container.querySelector('[aria-label="图片缩放工具栏"]')?.textContent).toContain('100%')

    await act(async () => root.unmount())
  })

  it('分离音频任务的产物预览复用音频资源节点播放器外壳', () => {
    const output: CanvasOperationOutputView = {
      id: 'audio-output',
      nodeId: 'audio-node',
      type: 'audio',
      title: '76-音频.mp3',
      url: 'file:///tmp/76-audio.mp3',
      createdAt: at,
      updatedAt: at,
    }

    const html = renderToStaticMarkup(<CanvasOperationOutputPreview output={output} selected />)

    expect(html).toContain('canvas-operation-output-audio')
    expect(html).toContain('canvas-node-audio-shell')
    expect(html).toContain('aria-label="播放"')
    // 音频操作已由外层 CanvasNode 的统一选中工具栏承载，预览内部不再渲染第二排工具栏。
    expect(html).not.toContain('aria-label="音频节点工具栏"')
  })
})
