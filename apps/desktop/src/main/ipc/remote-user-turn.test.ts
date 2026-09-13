import { describe, expect, it } from 'vitest'
import { resolveUserMessageDisplayText } from '@spark/protocol'

import { createRemoteUserTurn, extractExplicitRemoteImageSendPath } from './remote-user-turn.js'

describe('createRemoteUserTurn', () => {
  it('keeps platform instructions in model input and exposes only the user message', () => {
    const turn = createRemoteUserTurn('telegram', '浏览器页面截图发给我')
    expect(turn.message).toContain('mcp__spark_files__present_files')
    expect(turn.message).toContain('浏览器页面截图发给我')
    expect(turn.turnSource).toBe('remote_user')
    expect(turn.userMessageDisplayContent).toBe('浏览器页面截图发给我')
    expect(turn.userMessageVisibility).toBeUndefined()
  })

  it('identifies the actual remote channel to the agent', () => {
    expect(createRemoteUserTurn('feishu', '你好').message).toContain('飞书')
    const qq = createRemoteUserTurn('qq', '你好').message
    expect(qq).toContain('本轮远程渠道：QQ')
    expect(qq).toContain('历史消息中提到的 Telegram、QQ 或飞书不代表当前渠道')
  })

  it('forbids false delivery claims when file transfer is disabled', () => {
    const turn = createRemoteUserTurn('qq', '把截图发给我', { canTransferFiles: false })
    expect(turn.message).toContain('当前连接未启用“传输文件”能力')
    expect(turn.message).toContain('绝不能声称文件已发送')
    expect(turn.message).not.toContain('mcp__spark_files__present_files')
    expect(turn.userMessageDisplayContent).toBe('把截图发给我')
  })

  it('never exposes the internal prompt for an attachment-only message', () => {
    expect(createRemoteUserTurn('telegram', '').userMessageDisplayContent).toBe('（图片或附件）')
  })

  it('uses the safe user text for titles without changing ordinary turn fallbacks', () => {
    const turn = createRemoteUserTurn('telegram', '截图发给我')
    expect(resolveUserMessageDisplayText(turn, turn.message)).toBe('截图发给我')
    expect(
      resolveUserMessageDisplayText({ userMessageDisplayContent: '   ' }, '原始用户消息'),
    ).toBe('原始用户消息')
  })
})

describe('extractExplicitRemoteImageSendPath', () => {
  it('extracts one explicit local image requested for delivery', () => {
    expect(
      extractExplicitRemoteImageSendPath(
        '将电脑上/Users/zhangyang/Pictures/Ai视频/image.jpg这张图发给我',
      ),
    ).toBe('/Users/zhangyang/Pictures/Ai视频/image.jpg')
    expect(extractExplicitRemoteImageSendPath('Please send /tmp/result.png to me')).toBe(
      '/tmp/result.png',
    )
  })

  it('does not shortcut URLs, negated requests, unsupported files, or ambiguous paths', () => {
    expect(extractExplicitRemoteImageSendPath('把 https://example.com/a.png 发给我')).toBeNull()
    expect(extractExplicitRemoteImageSendPath('不要把 /tmp/a.png 发给我')).toBeNull()
    expect(extractExplicitRemoteImageSendPath('把 /tmp/a.pdf 发给我')).toBeNull()
    expect(extractExplicitRemoteImageSendPath('把 /tmp/a.png 和 /tmp/b.jpg 发给我')).toBeNull()
  })
})
