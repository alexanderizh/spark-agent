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

  it('renders a table that directly follows a paragraph without a blank line', () => {
    expect(
      parseMarkdown(
        '本轮修复汇总：\n|修复点|源码位置 (今日核实)|\n|---|---|\n|client onNotification 兜底| codex-app-server-client.ts:294 |',
      ),
    ).toEqual([
      { kind: 'paragraph', text: '本轮修复汇总：' },
      {
        kind: 'table',
        headers: ['修复点', '源码位置 (今日核实)'],
        rows: [['client onNotification 兜底', 'codex-app-server-client.ts:294']],
      },
    ])
  })

  it('keeps delimiter-like text inside a paragraph when the previous line has no pipe', () => {
    expect(parseMarkdown('普通文本\n下一行没有竖线\n| --- | --- |')).toEqual([
      { kind: 'paragraph', text: '普通文本\n下一行没有竖线\n| --- | --- |' },
    ])
  })

  it('keeps an unfinished fence visible during streaming', () => {
    expect(parseMarkdown('```tsx\nconst pending = true')).toEqual([
      { kind: 'incomplete_code', lang: 'tsx', code: 'const pending = true' },
    ])
  })

  it('recognizes compact double-backtick code emitted on one line', () => {
    expect(parseMarkdown('``json {"year":["2025"],"period":["P09"]} ``')).toEqual([
      { kind: 'code', lang: 'json', code: '{"year":["2025"],"period":["P09"]}' },
    ])
  })

  it.each([
    ['json', '{"ok":true}'],
    ['js', 'const value = 1'],
    ['ts', 'const value: number = 1'],
    ['css', '.card { display: grid; }'],
    ['bash', 'echo "$HOME"'],
    ['html', '<main>内容</main>'],
  ])('recognizes compact code for %s without a language-specific branch', (lang, code) => {
    expect(parseMarkdown(' ``' + lang + ' ' + code + '`` ')).toEqual([{ kind: 'code', lang, code }])
  })

  it('recognizes a compact fence when the language and code touch', () => {
    expect(parseMarkdown('``json{"ok":true}``')).toEqual([
      { kind: 'code', lang: 'json', code: '{"ok":true}' },
    ])
  })

  it('recognizes an unlabeled compact code line without promoting ordinary inline code', () => {
    expect(parseMarkdown(' `` {"ok":true} `` ')).toEqual([
      { kind: 'code', lang: '', code: '{"ok":true}' },
    ])
    expect(parseMarkdown('返回值为 ``2025``。')).toEqual([
      { kind: 'paragraph', text: '返回值为 ``2025``。' },
    ])
  })

  it('accepts longer standard fences and optional fence metadata', () => {
    expect(parseMarkdown('````json title=payload\n{"ok":true}\n`````')).toEqual([
      { kind: 'code', lang: 'json', code: '{"ok":true}' },
    ])
  })

  it('recognizes compact fences with list-style indentation', () => {
    expect(
      parseMarkdown(
        '3. 前端处理 listcols 时，用年份维度结果作为白名单：\n\n  ```js (column[key] || []).filter(Boolean)```',
      ),
    ).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [{ text: '前端处理 listcols 时，用年份维度结果作为白名单：' }],
      },
      { kind: 'code', lang: 'js', code: '(column[key] || []).filter(Boolean)' },
    ])
  })

  it('recognizes double-backtick fences across multiple lines', () => {
    expect(parseMarkdown('  ``json\n  {"year":["2025"]}\n  ``')).toEqual([
      { kind: 'code', lang: 'json', code: '  {"year":["2025"]}' },
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

    expect(content.slice(0, stableEnd)).toBe('第一段\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n')
    expect(content.slice(stableEnd)).toBe('正在生成')
  })

  it('does not close a longer streaming fence with a shorter fence', () => {
    const content = '```ts\nconst pair = "``"\n\n仍在生成'
    const stableEnd = findStableMarkdownPrefixEnd(content)

    expect(content.slice(0, stableEnd)).toBe('')
    expect(content.slice(stableEnd)).toBe(content)
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
