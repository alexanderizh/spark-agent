import { describe, expect, it } from 'vitest'

import {
  buildQqExternalId,
  parseQqDispatchEvent,
  parseQqExternalId,
  parseQqEventTimestamp,
  splitQqContent,
} from './qqProtocol.js'

describe('parseQqDispatchEvent', () => {
  it('解析群 @ 消息为 group 场景并保留 msg_id', () => {
    const event = parseQqDispatchEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'msgid-1',
      group_openid: 'GOPEN1',
      content: '<@!BOT123> /help',
      author: { id: 'auth1', member_openid: 'MEMBER1' },
      timestamp: '1717054268',
    })
    expect(event).toEqual({
      scene: 'group',
      targetId: 'GOPEN1',
      senderName: 'MEMBER1',
      text: '/help',
      msgId: 'msgid-1',
      timestamp: 1717054268,
    })
  })

  it('解析单聊消息为 user 场景（author.user_openid 兜底）', () => {
    const event = parseQqDispatchEvent('C2C_MESSAGE_CREATE', {
      id: 'msgid-2',
      content: '你好',
      author: { id: 'auth2', user_openid: 'USER1' },
      timestamp: 1717054270,
    })
    expect(event).toEqual({
      scene: 'user',
      targetId: 'USER1',
      senderName: 'USER1',
      text: '你好',
      msgId: 'msgid-2',
      timestamp: 1717054270,
    })
  })

  it('解析频道 @ 消息为 channel 场景', () => {
    const event = parseQqDispatchEvent('AT_MESSAGE_CREATE', {
      id: 'msgid-3',
      channel_id: 'CHAN1',
      content: '/status',
      author: { id: 'auth3', username: 'tester' },
      timestamp: '1717054272',
    })
    expect(event?.scene).toBe('channel')
    expect(event?.targetId).toBe('CHAN1')
    expect(event?.senderName).toBe('tester')
  })

  it('忽略无关事件与缺字段事件', () => {
    expect(parseQqDispatchEvent('GUILD_MEMBER_ADD', { id: 'x' })).toBeNull()
    expect(parseQqDispatchEvent('C2C_MESSAGE_CREATE', { content: 'hi' })).toBeNull()
    expect(parseQqDispatchEvent(undefined, { content: 'hi' })).toBeNull()
  })

  it('解析 RFC3339 时间戳（QQ 官方事件格式），不得误判为旧事件', () => {
    const now = Math.floor(Date.now() / 1000)
    // 回归：QQ 事件时间戳是 RFC3339 字符串，旧的 parseInt 实现会解析成 "2026"
    // 这样的年份，导致网关重放过滤把所有消息当旧事件丢弃。
    const event = parseQqDispatchEvent('C2C_MESSAGE_CREATE', {
      id: 'msgid-4',
      content: '/bind 123456',
      author: { id: 'auth4', user_openid: 'USER2' },
      timestamp: '2026-09-12T17:39:00+08:00',
    })
    expect(event).not.toBeNull()
    expect(event?.timestamp).toBeGreaterThanOrEqual(
      Math.floor(Date.parse('2026-09-12T17:39:00+08:00') / 1000) - 1,
    )
    // 现在时刻的消息绝不能被判定为 60 秒前的旧事件（网关重放过滤的判定条件）。
    expect(event && event.timestamp * 1000 >= Date.now() - 86_400_000).toBe(true)
    expect(now).toBeGreaterThan(0)
  })
})

describe('QQ externalId 编解码', () => {
  it('三种场景往返一致', () => {
    for (const [scene, id] of [
      ['group', 'G1'],
      ['user', 'U1'],
      ['channel', 'C1'],
    ] as const) {
      const externalId = buildQqExternalId(scene, id)
      expect(parseQqExternalId(externalId)).toEqual({ scene, targetId: id })
    }
  })

  it('拒绝无前缀与空目标', () => {
    expect(parseQqExternalId('G1')).toBeNull()
    expect(parseQqExternalId('qq-group:')).toBeNull()
  })
})

describe('parseQqEventTimestamp', () => {
  it('解析 RFC3339 字符串为秒', () => {
    expect(parseQqEventTimestamp('2026-09-12T17:39:00+08:00')).toBe(
      Math.floor(Date.parse('2026-09-12T17:39:00+08:00') / 1000),
    )
  })

  it('兼容数值秒/毫秒与纯数字字符串', () => {
    expect(parseQqEventTimestamp(1717054268)).toBe(1717054268)
    expect(parseQqEventTimestamp(1717054268000)).toBe(1717054268)
    expect(parseQqEventTimestamp('1717054268')).toBe(1717054268)
  })

  it('异常输入回退当前时间而非远古时间（防重放过滤误杀）', () => {
    const before = Math.floor(Date.now() / 1000)
    // 旧的 parseInt bug：RFC3339 截断出 "2026" 这样的年份；此处直接模拟该输入。
    for (const bad of ['2026', 'abc', null, undefined, '', 0, NaN]) {
      const parsed = parseQqEventTimestamp(bad as unknown)
      expect(Math.abs(parsed - before)).toBeLessThan(5)
    }
  })
})

describe('splitQqContent', () => {
  it('按 UTF-8 字节分片且不拆坏多字节字符', () => {
    // 3 个中文 = 9 字节；上限 8 字节应拆成 2+1。
    const chunks = splitQqContent('你好吗', 8)
    expect(chunks).toEqual(['你好', '吗'])
    expect(chunks[0]).toHaveLength(2)
  })

  it('未超限内容原样返回', () => {
    expect(splitQqContent('hello', 100)).toEqual(['hello'])
  })

  it('空内容返回单空串', () => {
    expect(splitQqContent('', 100)).toEqual([''])
  })

  it('优先在换行处断开，断点块去尾随空白、续块去行首空白', () => {
    // 预算 12 字节：取最后一个换行为断点，块尾 '\n\n' 与续块行首空白都被去掉
    const chunks = splitQqContent('aaaa\n\nbbbbbbbb', 12)
    expect(chunks).toEqual(['aaaa', 'bbbbbbbb'])
  })

  it('无换行时优先在句末标点处断开', () => {
    // 预算 10 字节：硬切会落在 'cdefg|h' 中间，句末断点应切在 'ab。' 之后
    const chunks = splitQqContent('ab。cdefghij', 10)
    expect(chunks).toEqual(['ab。', 'cdefghij'])
  })

  it('无句末标点时在逗号/空格等软断点断开', () => {
    // 预算 8 字节：英文按空格断开（断点块尾随空格被去掉）
    expect(splitQqContent('one two three', 8)).toEqual(['one two', 'three'])
    // 预算 9 字节：中文按逗号断开
    expect(splitQqContent('甲，乙，丙丁', 9)).toEqual(['甲，', '乙，', '丙丁'])
  })

  it('断点后剩余部分加当前字符仍超预算时独立成块，任何一块都不超限', () => {
    // 预算 11 字节：'.' 后的剩余 9 字节 + 3 字节字符 > 11，剩余部分须独立成块
    const chunks = splitQqContent('.中文中文中文文', 11)
    expect(chunks).toEqual(['.', '中文中', '文中文', '文'])
  })

  it('长混合文本分片不变量：每块均非空且不超过预算', () => {
    const paragraph = '段落一。第二段落，包含中文与 English words 混排。\n'
    const text = paragraph.repeat(6)
    const chunks = splitQqContent(text, 100)
    expect(chunks.length).toBeGreaterThan(1)
    const encoder = new TextEncoder()
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(encoder.encode(chunk).byteLength).toBeLessThanOrEqual(100)
    }
  })
})
