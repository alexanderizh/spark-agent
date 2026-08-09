import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RenderDiagramBlock } from './RenderDiagramBlock'

const baseBlock = {
  kind: 'diagram_block' as const,
  toolCallId: 'd1',
  diagramType: 'markmap' as const,
  source: '# 主题\n## 分支',
  title: '大纲',
  height: 360,
  status: 'rendered' as const,
  error: undefined,
  warnings: [],
}

describe('RenderDiagramBlock', () => {
  // 注：rendered 状态会触发 React.lazy 懒加载渲染器（SSR 同步模式下不可用），
  // 这里用 pending/error 状态覆盖工具栏、徽标与状态机分支；真实出图靠运行时验证。

  it('renders toolbar with title and markmap type badge in pending state', () => {
    const markup = renderToStaticMarkup(
      <RenderDiagramBlock block={{ ...baseBlock, status: 'pending' }} />,
    )
    expect(markup).toContain('大纲')
    expect(markup).toContain('思维导图')
    expect(markup).toContain('等待图表校验')
  })

  it('shows the mermaid type badge for mermaid diagrams', () => {
    const markup = renderToStaticMarkup(
      <RenderDiagramBlock block={{ ...baseBlock, diagramType: 'mermaid', status: 'pending' }} />,
    )
    expect(markup).toContain('Mermaid 图表')
  })

  it('shows a structured error state with the underlying message', () => {
    const markup = renderToStaticMarkup(
      <RenderDiagramBlock block={{ ...baseBlock, status: 'error', error: '语法错误' }} />,
    )
    expect(markup).toContain('图表渲染失败')
    expect(markup).toContain('语法错误')
  })

  it('renders warnings when present', () => {
    const markup = renderToStaticMarkup(
      <RenderDiagramBlock
        block={{ ...baseBlock, status: 'error', error: '失败', warnings: ['外链被拦截'] }}
      />,
    )
    expect(markup).toContain('外链被拦截')
  })
})
