import { describe, expect, it, vi } from 'vitest'

import { deliverRemoteTurnReply, type RemoteTurnReplyTransport } from './remoteTurnReply.js'

function createHarness(delivered: boolean) {
  const transport: RemoteTurnReplyTransport = {
    finishTurnFeedback: vi.fn(async () => delivered),
    sendReply: vi.fn(async () => undefined),
  }
  const target = { connectionId: 'connection-1', externalId: '42', attachments: [] }
  return { transport, target }
}

describe('deliverRemoteTurnReply', () => {
  it('reuses the streamed message for a text answer', async () => {
    const { transport, target } = createHarness(true)
    await deliverRemoteTurnReply(transport, 'turn-1', target, ' 最终回答 ')
    expect(transport.finishTurnFeedback).toHaveBeenCalledWith('turn-1', '最终回答')
    expect(transport.sendReply).not.toHaveBeenCalled()
  })

  it('sends a normal reply when the preview was not delivered', async () => {
    const { transport, target } = createHarness(false)
    await deliverRemoteTurnReply(transport, 'turn-1', target, '最终回答')
    expect(transport.sendReply).toHaveBeenCalledWith('connection-1', '42', '最终回答', [])
  })

  it('sends only images when the final text already occupies the preview', async () => {
    const { transport, target } = createHarness(true)
    const attachments = [{ type: 'image' as const, path: '/tmp/image.png' }]
    await deliverRemoteTurnReply(transport, 'turn-1', { ...target, attachments }, '最终回答')
    expect(transport.sendReply).toHaveBeenCalledWith('connection-1', '42', '', attachments)
  })

  it('uses normal delivery for Markdown images', async () => {
    const { transport, target } = createHarness(false)
    await deliverRemoteTurnReply(transport, 'turn-1', target, '图片 ![截图](/tmp/image.png)')
    expect(transport.finishTurnFeedback).toHaveBeenCalledWith('turn-1', undefined)
    expect(transport.sendReply).toHaveBeenCalled()
  })
})
