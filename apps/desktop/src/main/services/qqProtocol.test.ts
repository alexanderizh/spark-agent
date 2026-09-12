import { describe, expect, it } from 'vitest'

import {
  buildQqExternalId,
  parseQqDispatchEvent,
  parseQqExternalId,
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
})
