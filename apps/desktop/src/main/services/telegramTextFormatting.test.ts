import { describe, expect, it } from 'vitest'

import { formatTelegramMarkdown, isTelegramFormattingError } from './telegramTextFormatting.js'

describe('formatTelegramMarkdown', () => {
  it('converts common Markdown without exposing markers', () => {
    expect(
      formatTelegramMarkdown(
        '**这次做了什么**：\n1. **文件卡片通道**：调用 `present_files`。\n- [文档](https://example.com?a=1&b=2)',
      ),
    ).toBe(
      '<b>这次做了什么</b>：\n1. <b>文件卡片通道</b>：调用 <code>present_files</code>。\n• <a href="https://example.com/?a=1&amp;b=2">文档</a>',
    )
  })

  it('escapes model HTML and formats headings, quotes, and code blocks', () => {
    expect(formatTelegramMarkdown('# 标题\n> <危险>\n```ts\nconst x = 1 < 2\n```')).toBe(
      '<b>标题</b>\n<blockquote>&lt;危险&gt;</blockquote>\n<pre><code class="language-ts">const x = 1 &lt; 2</code></pre>',
    )
  })
})

describe('isTelegramFormattingError', () => {
  it('only retries Telegram entity parsing failures', () => {
    expect(
      isTelegramFormattingError(
        new Error("sendMessage failed: 400 Bad Request: can't parse entities"),
      ),
    ).toBe(true)
    expect(isTelegramFormattingError(new Error('sendMessage failed: 429 Too Many Requests'))).toBe(
      false,
    )
  })
})
