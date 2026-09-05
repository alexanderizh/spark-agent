import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { MarkdownText } from '../../src/tui/components/markdown.js'
import { defaultTheme } from '../../src/tui/theme.js'

function frame(text: string): string {
  const app = render(
    <MarkdownText
      text={text}
      theme={defaultTheme}
      capabilities={{ color: 'mono', unicode: false, width: 80 }}
    />,
  )
  const output = stripAnsi(app.lastFrame() ?? '')
  app.unmount()
  return output
}

function stripAnsi(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) break
        index += 1
      }
    } else {
      output += value[index] ?? ''
    }
  }
  return output
}

describe('MarkdownText', () => {
  it('keeps every character of plain prose untouched', () => {
    expect(frame('普通段落，保持原样。')).toContain('普通段落，保持原样。')
  })

  it('renders headings, bullets and ordered lists without losing content', () => {
    const output = frame('# 标题\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二')
    expect(output).toContain('标题')
    expect(output).toContain('第一项')
    expect(output).toContain('第二项')
    expect(output).toContain('1. 步骤一')
    expect(output).toContain('2. 步骤二')
    expect(output).not.toContain('# 标题')
    expect(output).not.toContain('- 第一项')
  })

  it('renders fenced code blocks verbatim and drops the fence markers', () => {
    const output = frame('```ts\nconst a = 1\n```')
    expect(output).toContain('const a = 1')
    expect(output).not.toContain('```')
  })

  it('renders inline bold and code without the markers', () => {
    const output = frame('使用 **spark** 运行 `spark tui` 命令')
    expect(output).toContain('spark')
    expect(output).toContain('spark tui')
    expect(output).not.toContain('**')
    expect(output).not.toContain('`')
  })

  it('falls back to plain text for unknown syntax without dropping characters', () => {
    const text = '链接 [docs](https://example.com) 与 ~~删除线~~ 保留'
    expect(frame(text)).toContain('链接 [docs](https://example.com) 与 ~~删除线~~ 保留')
  })
})
