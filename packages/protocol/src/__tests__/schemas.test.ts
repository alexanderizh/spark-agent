import { describe, expect, it } from 'vitest'
import { SessionCreateRequestSchema } from '../schemas/index.js'

describe('IPC schemas', () => {
  it('does not hard-code runtime permission defaults during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
    })

    expect(request.agentAdapter).toBeUndefined()
    expect(request.permissionMode).toBeUndefined()
    expect(request.chatMode).toBe('agent')
    expect(request.reasoningEffort).toBe('medium')
  })
})
