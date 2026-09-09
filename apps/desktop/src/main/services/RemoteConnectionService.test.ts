import { describe, expect, it } from 'vitest'

import { buildFeishuCard } from './RemoteConnectionService.js'

describe('buildFeishuCard', () => {
  it('keeps Markdown content in a rich-text card even without actions', () => {
    const card = buildFeishuCard({
      title: '模型列表',
      text: '**主模型**\n\n1. GPT\n2. Claude\n\n`/use-model 1`',
    }) as {
      header: { title: { content: string } }
      elements: Array<{ tag: string; text?: { tag: string; content: string } }>
    }

    expect(card.header.title.content).toBe('模型列表')
    expect(card.elements).toHaveLength(1)
    expect(card.elements[0]?.text).toEqual({
      tag: 'lark_md',
      content: '**主模型**\n\n1. GPT\n2. Claude\n\n`/use-model 1`',
    })
  })

  it('keeps actions as the last card section', () => {
    const card = buildFeishuCard({
      text: '选择模型',
      actions: [{ label: '切换 1', command: '/use-model 1', style: 'primary' }],
    }) as { elements: Array<{ tag: string; actions?: unknown[] }> }

    expect(card.elements.at(-1)).toEqual({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '切换 1' },
          type: 'primary',
          value: { command: '/use-model 1' },
        },
      ],
    })
  })
})
