import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import RenderMermaidDiagram from './RenderMermaidDiagram'
import RenderMarkmapDiagram from './RenderMarkmapDiagram'

// 回归保护：第三方图表库（mermaid/markmap）会直接改写它们操作的 DOM 节点的内容。
// 若该节点同时被 React 通过 JSX 管理子节点，会触发 React 协调时的
// "removeChild: The node to be removed is not a child of this node" 崩溃。
// 修复采用「逃生舱宿主节点」：宿主 div 在 JSX 里永远没有 children 表达式，
// loading 提示是它的 sibling。本测试锁住这一结构，防止把 loading 放回宿主内部导致崩溃回归。

describe('diagram renderer host-node isolation', () => {
  it('mermaid: loading is a sibling of the empty host div, not its child', () => {
    const html = renderToStaticMarkup(
      <RenderMermaidDiagram source={'graph TD\n  A-->B'} theme={'light' as const} />,
    )
    expect(html).toContain('render-diagram-mermaid-host')
    expect(html).toContain('正在生成图表')
    // 关键：宿主 div 必须是空 div（供 mermaid 通过 innerHTML 接管），
    // loading 文本不得落在宿主内部 —— 否则 React 与 mermaid 抢同一节点的子节点。
    const hostStart = html.indexOf('render-diagram-mermaid-host')
    const hostTag = html.slice(hostStart, html.indexOf('</div>', hostStart))
    expect(hostTag).not.toContain('正在生成图表')
  })

  it('markmap: loading is a sibling of the empty host div, not its child', () => {
    const html = renderToStaticMarkup(
      <RenderMarkmapDiagram source={'# 主题'} theme={'dark' as const} />,
    )
    expect(html).toContain('render-diagram-markmap-host')
    expect(html).toContain('正在生成思维导图')
    const hostStart = html.indexOf('render-diagram-markmap-host')
    const hostTag = html.slice(hostStart, html.indexOf('</div>', hostStart))
    expect(hostTag).not.toContain('正在生成思维导图')
  })

  it('markmap does not automatically fit the whole graph into a constrained viewport', () => {
    const source = readFileSync(resolve(__dirname, 'RenderMarkmapDiagram.tsx'), 'utf8')
    expect(source).not.toMatch(/markmap\.fit\?\.\(/)
    expect(source).not.toContain('Markmap.create(')
    expect(source).toContain('await markmap.setData(root)')
    expect(source).not.toContain('fit 缩小后看全貌')
  })
})
