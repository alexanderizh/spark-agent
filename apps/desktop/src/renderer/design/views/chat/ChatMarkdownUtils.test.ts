import { describe, expect, it } from 'vitest'
import { findStableMarkdownPrefixEnd, parseMarkdown } from './ChatMarkdownUtils'

describe('parseMarkdown', () => {
  it('preserves headings, task lists, tables and fenced code blocks', () => {
    expect(
      parseMarkdown(
        '# 标题\n\n- [x] 已完成\n- [ ] 待处理\n\n| 名称 | 状态 |\n| --- | --- |\n| Chat | 正常 |\n\n```ts\nconst ok = true\n```',
      ),
    ).toEqual([
      { kind: 'heading', level: 1, text: '标题' },
      {
        kind: 'list',
        ordered: false,
        items: [
          { text: '已完成', checked: true },
          { text: '待处理', checked: false },
        ],
      },
      { kind: 'table', headers: ['名称', '状态'], rows: [['Chat', '正常']] },
      { kind: 'code', lang: 'ts', code: 'const ok = true' },
    ])
  })

  it('keeps an unfinished fence visible during streaming', () => {
    expect(parseMarkdown('```tsx\nconst pending = true')).toEqual([
      { kind: 'incomplete_code', lang: 'tsx', code: 'const pending = true' },
    ])
  })

  it('keeps blank-separated ordered items in one list and preserves its start', () => {
    expect(parseMarkdown('3. 第三项\n\n4. 第四项')).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [{ text: '第三项' }, { text: '第四项' }],
      },
    ])
  })

  it('keeps blank-separated unordered items in one list', () => {
    expect(parseMarkdown('- 第一项\n\n- 第二项')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [{ text: '第一项' }, { text: '第二项' }],
      },
    ])
  })

  it('finds stable paragraph boundaries without splitting fenced code', () => {
    const content = '第一段\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n正在生成'
    const stableEnd = findStableMarkdownPrefixEnd(content)

    expect(content.slice(0, stableEnd)).toBe(
      '第一段\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n',
    )
    expect(content.slice(stableEnd)).toBe('正在生成')
  })

  it('does not split a streaming list at blank lines between items', () => {
    const content = '两点关键发现：\n\n1. 第一项\n\n2. 第二项'
    const stableEnd = findStableMarkdownPrefixEnd(content)

    expect(content.slice(0, stableEnd)).toBe('两点关键发现：\n\n')
    expect(parseMarkdown(content.slice(stableEnd))).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 1,
        items: [{ text: '第一项' }, { text: '第二项' }],
      },
    ])
  })

  it('stabilizes a completed list once the following block is complete', () => {
    const content = '1. 已完成\n\n下一段\n'
    const stableEnd = findStableMarkdownPrefixEnd(content)

    expect(content.slice(0, stableEnd)).toBe('1. 已完成\n\n')
    expect(content.slice(stableEnd)).toBe('下一段\n')
  })
})
