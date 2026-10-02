// @vitest-environment jsdom
//
// FileMarkdownView — 文件预览 Markdown 完整渲染器的聚焦测试。
// 用例取自 README.md 等项目文档的真实语法形态：内嵌 HTML 布局、嵌套 badge、
// 嵌套列表、表格对齐、锚点、mermaid 识别与不可信内容的安全过滤。

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FileMarkdownView } from '../design/components/FileMarkdownView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 交互组件依赖 IPC（favicon 元数据、外链打开），单测环境无宿主，mock 掉
vi.mock('../design/components/ClickableFilePath', () => ({
  ClickableUrl: ({ url, label }: { url: string; label?: string }) => (
    <a href={url} data-testid="clickable-url">
      {label ?? url}
    </a>
  ),
  ClickableFilePath: ({ path, label }: { path: string; label?: React.ReactNode }) => (
    <span data-testid="clickable-file-path" data-path={path}>
      {label ?? path}
    </span>
  ),
}))

// MarkdownImage 依赖 Toast/IPC；保留 resolveImageSrc 真实实现（相对路径→safe-file 转换是被测行为）
vi.mock('../design/components/MarkdownImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../design/components/MarkdownImage')>()
  return {
    ...actual,
    MarkdownImage: ({
      src,
      alt,
      basePath,
    }: {
      src: string
      alt: string
      basePath?: string | null
    }) => <img src={actual.resolveImageSrc(src, basePath)} alt={alt} />,
  }
})

vi.mock('../design/views/chat/RenderDiagramBlock', () => ({
  RenderDiagramBlock: ({ block }: { block: { source: string } }) => (
    <div data-testid="mermaid-block">{block.source}</div>
  ),
}))

vi.mock('../design/views/chat/RenderSvgBlock', () => ({
  RenderSvgBlock: ({ source }: { source: string }) => <div data-testid="svg-block">{source}</div>,
}))

// shiki 高亮器按需动态 import，单测里退化为纯文本渲染
vi.mock('../design/components/MarkdownCodeBlock', () => ({
  MarkdownCodeBlock: ({ code, lang }: { code: string; lang: string }) => (
    <pre data-testid="code-block" data-lang={lang}>
      {code}
    </pre>
  ),
}))

function renderMarkdown(content: string): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  act(() => {
    root = createRoot(container)
    root.render(<FileMarkdownView content={content} />)
  })
  roots.push(root)
  return container
}

const roots: Array<Root | null> = []

describe('FileMarkdownView', () => {
  beforeEach(() => {
    vi.stubGlobal('spark', {
      invoke: vi.fn(async () => ({})),
      on: vi.fn(() => vi.fn()),
    })
  })

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop()
      if (root != null) act(() => root?.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('渲染嵌套图片链接 badge（README 顶部 shields.io 徽标）', () => {
    const container = renderMarkdown(
      '[![License](https://img.shields.io/badge/license-MIT-blue)](https://example.com/license)',
    )
    // 外层必须是链接，内部是图片，而不是把源码当文本吐出来
    const anchor = container.querySelector('a[href="https://example.com/license"]')
    expect(anchor).not.toBeNull()
    const img = anchor?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://img.shields.io/badge/license-MIT-blue')
    expect(container.textContent).not.toContain('![')
  })

  it('渲染内嵌 HTML 布局：div 居中与 table 双列卡片', () => {
    const container = renderMarkdown(
      [
        '<div align="center">',
        '',
        '# 标题在 div 内',
        '',
        '</div>',
        '',
        '<table>',
        '<tr>',
        '<td width="50%" valign="top">',
        '',
        '**左列加粗**',
        '',
        '![左图](./left.png)',
        '',
        '</td>',
        '<td width="50%" valign="top">',
        '',
        '右列普通文本',
        '',
        '</td>',
        '</tr>',
        '</table>',
      ].join('\n'),
    )
    // HTML 标签不允许以文本形式泄露
    expect(container.textContent).not.toContain('<table>')
    expect(container.textContent).not.toContain('<td')
    const centerDiv = container.querySelector('div[align="center"]')
    expect(centerDiv).not.toBeNull()
    expect(centerDiv?.querySelector('h1')?.textContent).toBe('标题在 div 内')

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const cells = table?.querySelectorAll('td')
    expect(cells?.length).toBe(2)
    expect(cells?.[0]?.getAttribute('width')).toBe('50%')
    // td 内的 markdown（空行分隔后）按 CommonMark 规则解析
    expect(cells?.[0]?.querySelector('strong')?.textContent).toBe('左列加粗')
    expect(cells?.[0]?.querySelector('img')?.getAttribute('src')).toContain('left.png')
    expect(cells?.[1]?.textContent).toContain('右列普通文本')
  })

  it('渲染任意层级嵌套列表', () => {
    const container = renderMarkdown(['- 一级', '  - 二级', '    - 三级', '- 又一级'].join('\n'))
    const surface = container.querySelector('.file-markdown-view')
    expect(surface).not.toBeNull()
    const topList = surface?.querySelector(':scope > ul')
    expect(topList).not.toBeNull()
    // 逐层精确路径：一级项下的二级列表、二级项下的三级列表各一个
    expect(surface?.querySelectorAll(':scope > ul > li > ul').length).toBe(1)
    expect(surface?.querySelectorAll(':scope > ul > li > ul > li > ul').length).toBe(1)
    expect(surface?.querySelectorAll(':scope > ul > li').length).toBe(2)
  })

  it('渲染 GFM 表格并保留列对齐', () => {
    const container = renderMarkdown(
      ['| 左 | 中 | 右 |', '| :-- | :-: | --: |', '| a | b | c |'].join('\n'),
    )
    const table = container.querySelector('.md-table-wrap table')
    expect(table).not.toBeNull()
    const headers = table?.querySelectorAll('th')
    expect(headers?.length).toBe(3)
    // remark-gfm 的对齐信息落在 style 上（与 GitHub 渲染一致）
    expect(headers?.[1]?.getAttribute('style')).toContain('text-align: center')
    expect(headers?.[2]?.getAttribute('style')).toContain('text-align: right')
    expect(table?.querySelector('td')?.textContent).toBe('a')
  })

  it('标题生成 GitHub 风格锚点 id，锚点链接指向对应标题', () => {
    const container = renderMarkdown(
      ['## ✨ 功能特性', '', '见 [下载安装](#下载安装)', '', '## 下载安装'].join('\n'),
    )
    const headings = container.querySelectorAll('h2')
    expect(headings.length).toBe(2)
    expect(headings[1]?.id).toBe('下载安装')
    // href 经 URL 编码，锚点链接按 class 断言
    const anchorLink = container.querySelector('a.md-anchor-link')
    expect(anchorLink).not.toBeNull()
    expect(anchorLink?.textContent).toBe('下载安装')
  })

  it('mermaid 与 svg 代码块直接成图，普通代码块走高亮组件', () => {
    const container = renderMarkdown(
      [
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        '',
        '```svg',
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        '```',
        '',
        '```ts',
        'const x: number = 1',
        '```',
      ].join('\n'),
    )
    expect(container.querySelector('[data-testid="mermaid-block"]')?.textContent).toContain(
      'graph TD',
    )
    expect(container.querySelector('[data-testid="svg-block"]')).not.toBeNull()
    const codeBlock = container.querySelector('[data-testid="code-block"]')
    expect(codeBlock?.getAttribute('data-lang')).toBe('ts')
    expect(codeBlock?.textContent).toContain('const x')
  })

  it('过滤不可信内容：script 与事件属性被剥除，javascript: 链接退化为文本', () => {
    const container = renderMarkdown(
      [
        '<script>alert(1)</script>',
        '',
        '<img src="https://ok.example.com/a.png" onerror="alert(2)" />',
        '',
        '[点我](javascript:alert(3))',
      ].join('\n'),
    )
    expect(container.querySelector('script')).toBeNull()
    const img = container.querySelector('img[src*="ok.example.com"]')
    expect(img?.getAttribute('onerror')).toBeNull()
    const link = container.querySelector('.md-unsafe-link')
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe('点我')
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('相对路径图片基于 imageBasePath 解析为 safe-file 协议', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root: Root | null = null
    act(() => {
      root = createRoot(container)
      root.render(
        <FileMarkdownView
          content="![示意图](./images/arch.svg)"
          imageBasePath="/Users/demo/project/docs"
        />,
      )
    })
    roots.push(root)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    const src = img?.getAttribute('src') ?? ''
    // resolveImageSrc 会把 ./images/arch.svg 相对基准目录编码成 safe-file://x/<base64>
    expect(src.startsWith('safe-file://')).toBe(true)
  })

  it('本地文件链接渲染为可点击文件路径（label 保真为链接文本）', () => {
    const container = renderMarkdown('[配置说明](./docs/setup.md)')
    const filePath = container.querySelector('[data-testid="clickable-file-path"]')
    expect(filePath?.getAttribute('data-path')).toContain('docs/setup.md')
    // 与 GitHub 一致：显示链接文本而非路径本身
    expect(filePath?.textContent).toBe('配置说明')
  })

  it('完整渲染仓库 README（真实文档冒烟）', () => {
    const readmePath = path.resolve(__dirname, '../../../../../README.md')
    const readme = fs.readFileSync(readmePath, 'utf8')
    const container = renderMarkdown(readme)

    // 顶部 shields.io badge 全部渲染成图片：锚点型在 <a> 内、本地路径型在文件引用组件内
    const badgeImgs = container.querySelectorAll('img[src*="img.shields.io"]')
    expect(badgeImgs.length).toBeGreaterThanOrEqual(6)
    expect(container.textContent).not.toContain('<div')
    expect(container.textContent).not.toContain('<td')

    // 能力图解的 HTML 布局表格正常成表，且 td 内 markdown（加粗/图片）被解析
    const layoutTable = container.querySelector('table')
    expect(layoutTable).not.toBeNull()
    expect(layoutTable?.querySelectorAll('td').length).toBeGreaterThan(0)
    expect(layoutTable?.querySelector('strong')?.textContent).toContain('长期记忆')

    // 相对路径截图解析为 safe-file 协议（预览场景由 imageBasePath 提供时）
    expect(container.querySelectorAll('img[src^="https://"]').length).toBeGreaterThan(0)

    // 标题锚点齐全：主要章节可直接定位
    for (const section of ['下载安装', '快速开始', '从源码构建', '许可证']) {
      expect(container.querySelector(`[id="${section}"]`)).not.toBeNull()
    }

    // 代码块（sh 安装脚本、目录树等）进入代码组件
    const codeBlocks = container.querySelectorAll('[data-testid="code-block"]')
    expect(codeBlocks.length).toBeGreaterThanOrEqual(5)
  })
})
