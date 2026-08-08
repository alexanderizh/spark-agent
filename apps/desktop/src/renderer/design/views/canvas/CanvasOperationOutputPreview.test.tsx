import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../chat/ChatMarkdown', () => ({ MarkdownText: 'div' }))

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
})

describe('CanvasOperationOutputPreview', () => {
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
