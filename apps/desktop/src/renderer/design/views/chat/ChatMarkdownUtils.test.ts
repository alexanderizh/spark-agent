import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './ChatMarkdownUtils'

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
})
