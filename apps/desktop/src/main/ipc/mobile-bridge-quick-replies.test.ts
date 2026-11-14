import { describe, expect, it } from 'vitest'
import {
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_LENGTH,
  isQuickReplyTool,
  parseQuickReplies,
} from './mobile-bridge-quick-replies.js'

describe('isQuickReplyTool', () => {
  it('只认 spark_ui 的建议工具（大小写与空白容错）', () => {
    expect(isQuickReplyTool('mcp__spark_ui__suggest_replies')).toBe(true)
    expect(isQuickReplyTool('  MCP__SPARK_UI__SUGGEST_REPLIES ')).toBe(true)
    expect(isQuickReplyTool('mcp__spark_ui__other')).toBe(false)
    expect(isQuickReplyTool('bash')).toBe(false)
  })
})

describe('parseQuickReplies', () => {
  it('取出建议文案', () => {
    expect(parseQuickReplies({ replies: ['继续', '提交'] })).toEqual(['继续', '提交'])
  })

  it('去掉首尾空白、去重、丢弃非字符串', () => {
    expect(parseQuickReplies({ replies: ['  继续 ', '继续', 42, null, '提交'] })).toEqual([
      '继续',
      '提交',
    ])
  })

  it('超过上限截断到 4 条', () => {
    const replies = Array.from({ length: 9 }, (_, index) => `建议 ${index}`)
    expect(parseQuickReplies({ replies })).toHaveLength(MAX_QUICK_REPLIES)
  })

  it('单条超过 40 字按码点截断（不劈开代理对）', () => {
    const long = '好'.repeat(60)
    const [reply] = parseQuickReplies({ replies: [long] })
    expect([...(reply ?? '')]).toHaveLength(MAX_QUICK_REPLY_LENGTH)
  })

  it('emoji 不会被截成半个字符', () => {
    const text = `${'🌸'.repeat(40)}好`
    const [reply] = parseQuickReplies({ replies: [text] })
    expect([...(reply ?? '')]).toHaveLength(MAX_QUICK_REPLY_LENGTH)
    // 按码点截断：第 40 个字符仍是完整的 emoji，尾巴上的「好」被丢在门外
    expect(reply?.endsWith('🌸')).toBe(true)
    expect(reply?.includes('好')).toBe(false)
  })

  it('脏入参一律返回空数组', () => {
    expect(parseQuickReplies(null)).toEqual([])
    expect(parseQuickReplies('replies')).toEqual([])
    expect(parseQuickReplies(['继续'])).toEqual([])
    expect(parseQuickReplies({ replies: '继续' })).toEqual([])
    expect(parseQuickReplies({ replies: [] })).toEqual([])
    expect(parseQuickReplies({ replies: ['   '] })).toEqual([])
  })
})
