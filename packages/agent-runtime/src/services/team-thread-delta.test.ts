/**
 * 团队线程增量回流 + team_thread_read 格式化的纯函数单测。
 *
 * 覆盖：
 *  - formatPeerBroadcastDelta：过滤发起者自己发的、无消息返回 null、含 team_thread_read 指引。
 *  - formatThreadMessageBrowse：超长正文截断 + messageId 指引；短正文原样。
 *  - formatThreadMessageFull：完整呈现不截断，且带 id 便于二次定位。
 */
import { describe, it, expect } from 'vitest'
import {
  formatPeerBroadcastDelta,
  formatThreadMessageBrowse,
  formatThreadMessageFull,
} from './session.service.js'
import type { TeamThreadMessageRow } from '@spark/storage'

function msg(overrides: Partial<TeamThreadMessageRow> = {}): TeamThreadMessageRow {
  return {
    id: 'm1',
    discussion_id: 'd1',
    sender_agent_id: 'backend',
    target_agent_id: null,
    round_index: 0,
    kind: 'peer_message',
    content: 'hello team',
    dispatch_id: null,
    delivery: null,
    created_at: new Date(0).toISOString(),
    ...overrides,
  }
}

describe('formatPeerBroadcastDelta', () => {
  it('returns null when there is nothing others posted', () => {
    expect(formatPeerBroadcastDelta([], 'frontend')).toBeNull()
    // 只有发起者自己发的 → 过滤后为空 → null
    expect(
      formatPeerBroadcastDelta([msg({ sender_agent_id: 'frontend' })], 'frontend'),
    ).toBeNull()
  })

  it('surfaces broadcasts other members posted during the call, excluding the caller', () => {
    const delta = formatPeerBroadcastDelta(
      [
        msg({ id: 'b1', sender_agent_id: 'backend', content: 'my detailed intro' }),
        msg({ id: 'f1', sender_agent_id: 'frontend', content: 'my own note' }),
      ],
      'frontend',
    )
    expect(delta).not.toBeNull()
    expect(delta).toContain('backend')
    expect(delta).toContain('my detailed intro')
    // 发起者自己那条不回流
    expect(delta).not.toContain('my own note')
    // 指引成员读全文
    expect(delta).toContain('team_thread_read')
  })
})

describe('formatThreadMessageBrowse', () => {
  it('keeps short content intact and shows the id', () => {
    const line = formatThreadMessageBrowse(msg({ id: 'x1', content: 'short' }))
    expect(line).toContain('id=x1')
    expect(line).toContain('short')
    expect(line).not.toContain('省略')
  })

  it('truncates long content and points at team_thread_read(messageId)', () => {
    const long = 'B'.repeat(5000)
    const line = formatThreadMessageBrowse(msg({ id: 'x2', content: long }))
    expect(line.length).toBeLessThan(long.length)
    expect(line).toContain('省略')
    expect(line).toContain('team_thread_read(messageId: "x2")')
  })
})

describe('formatThreadMessageFull', () => {
  it('renders the whole content untruncated with id and metadata', () => {
    const long = 'C'.repeat(5000)
    const out = formatThreadMessageFull(msg({ id: 'x3', content: long, target_agent_id: 'frontend' }))
    expect(out).toContain('id: x3')
    expect(out).toContain('→ frontend')
    expect(out).toContain(long) // 全文，不截断
    expect(out).not.toContain('省略')
  })
})
