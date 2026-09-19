import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { Agent } from '../../src/sdk/agent.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { collectEvents } from '../helpers.js'
import type { AgentEvent } from '../../src/events/schema.js'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('view_image tool pipeline', () => {
  it('attaches the viewed image to the next request as a tool_result image', async () => {
    const base = createDeterministicEnv(
      [toolCall('view-1', 'view_image', { path: 'shot.png' }), text('It is a spark logo.')],
      { viewImageBytes: PNG_BYTES },
    )
    const agent = Agent.open({ cwd: '/ws', env: base })
    const session = await agent.newSession({ permissionMode: 'auto' })
    await session.turn('look at shot.png')

    // The follow-up request (step 2) must carry the image next to the
    // tool_result message.
    const secondRequest = base.fixtures.model.requests[1]
    expect(secondRequest).toBeDefined()
    const toolResult = secondRequest?.messages.find((message) => message.role === 'tool_result')
    expect(toolResult?.role === 'tool_result' && toolResult.imageParts).toHaveLength(1)
    expect(toolResult?.role === 'tool_result' && toolResult.imageParts?.[0]?.mediaType).toBe(
      'image/png',
    )
    expect(toolResult?.role === 'tool_result' && toolResult.imageParts?.[0]?.base64).toBeTruthy()

    const events: AgentEvent[] = await collectEvents(session)
    const result = events.find((event) => event.type === 'tool.result')
    expect(result?.type === 'tool.result' && result.ok).toBe(true)
  })

  it('encodes the tool image for Anthropic next to the tool_result block', async () => {
    const { toAnthropicRequest } = await import('../../src/llm/anthropic/messages.js')
    const request = {
      system: [{ id: 'base', content: 'You are Spark.', stability: 'stable' as const }],
      messages: [
        {
          role: 'tool_result' as const,
          callId: 'view-1',
          tool: 'view_image',
          ok: true,
          content: 'Image view: shot.png',
          sourceSeqs: [2],
          imageParts: [{ mediaType: 'image/png', base64: 'cG5n' }],
        },
      ],
      tools: [],
      maxTokens: 1024,
      metadata: { sessionId: 's1' },
    }
    const encoded = toAnthropicRequest(request, 'claude-test', true)
    const userBlocks =
      (encoded.messages as { content: { type?: string }[] }[]).at(-1)?.content ?? []
    expect(userBlocks.some((block) => block.type === 'tool_result')).toBe(true)
    expect(userBlocks.some((block) => block.type === 'image')).toBe(true)
  })

  it('encodes the tool image for OpenAI as a following user message', async () => {
    const { toOpenAiRequest } = await import('../../src/llm/openai/responses.js')
    const request = {
      system: [{ id: 'base', content: 'You are Spark.', stability: 'stable' as const }],
      messages: [
        {
          role: 'tool_result' as const,
          callId: 'view-1',
          tool: 'view_image',
          ok: true,
          content: 'Image view: shot.png',
          sourceSeqs: [2],
          imageParts: [{ mediaType: 'image/png', base64: 'cG5n' }],
        },
      ],
      tools: [],
      maxTokens: 1024,
      metadata: { sessionId: 's1' },
    }
    const encoded = toOpenAiRequest(request, 'gpt-test')
    const input = encoded.input as { type?: string; role?: string }[]
    expect(input.some((item) => item.type === 'function_call_output')).toBe(true)
    const imageMessage = input.find((item) => item.role === 'user')
    expect(imageMessage).toBeDefined()
  })
})
