import { describe, expect, it } from 'vitest'
import { formatReplyForHost } from './session.service.js'

describe('formatReplyForHost', () => {
  it('includes member identity so batch results can be matched to agents', () => {
    const text = formatReplyForHost({
      taskId: 'task-1',
      memberAgentId: 'new-agent',
      memberName: '新Agent',
      state: 'completed',
      content: 'analysis done',
      usage: { durationMs: 120 },
    })

    expect(text).toContain('member=新Agent (new-agent)')
    expect(text).toContain('state=completed')
    expect(text).toContain('analysis done')
  })
})
