import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const sdkFactory = vi.hoisted(() => ({
  load: vi.fn(),
}))

vi.mock('../sdk/claude-sdk-executor.js', () => ({
  loadSdkMcpFactory: sdkFactory.load,
}))

import { canvasJsonSchemaToZodShape, createCanvasMcpServer } from './canvas-mcp-server.js'

describe('canvas MCP schema conversion', () => {
  it('preserves oneOf object branches and rejects guessed workflow fields', () => {
    const shape = canvasJsonSchemaToZodShape({
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          items: {
            oneOf: [
              {
                type: 'object',
                required: ['ref', 'role', 'type', 'title'],
                additionalProperties: false,
                properties: {
                  ref: { type: 'string' },
                  role: { type: 'string', enum: ['input'] },
                  type: { type: 'string', enum: ['image', 'prompt'] },
                  title: { type: 'string' },
                },
              },
              {
                type: 'object',
                required: ['ref', 'role', 'operation', 'dependsOn'],
                additionalProperties: false,
                properties: {
                  ref: { type: 'string' },
                  role: { type: 'string', enum: ['operation'] },
                  operation: { type: 'string', enum: ['image_compose'] },
                  dependsOn: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string' },
                  },
                },
              },
            ],
          },
        },
      },
    })
    const parser = z.object(shape)

    expect(
      parser.safeParse({
        nodes: [{ ref: 'image', role: 'input', type: 'image', title: '参考图' }],
      }).success,
    ).toBe(true)
    expect(
      parser.safeParse({
        nodes: [
          {
            type: 'input',
            inputType: 'image',
            title: '参考图',
            placeholder: true,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      parser.safeParse({
        nodes: [
          {
            ref: 'compose',
            role: 'operation',
            operation: 'image_compose',
            dependsOn: [0, 1],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('honors additionalProperties false and array constraints', () => {
    const parser = z.object(
      canvasJsonSchemaToZodShape({
        type: 'object',
        required: ['values'],
        properties: {
          values: {
            type: 'array',
            minItems: 2,
            uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
          config: {
            type: 'object',
            additionalProperties: false,
            properties: { enabled: { type: 'boolean' } },
          },
        },
      }),
    )

    expect(parser.safeParse({ values: ['a'] }).success).toBe(false)
    expect(parser.safeParse({ values: ['a', 'a'] }).success).toBe(false)
    expect(
      parser.safeParse({ values: ['a', 'b'], config: { enabled: true, guessed: 1 } }).success,
    ).toBe(false)
  })
})

describe('canvas MCP tool results', () => {
  beforeEach(() => {
    sdkFactory.load.mockResolvedValue({
      createSdkMcpServer: (options: unknown) => options,
      tool: (
        name: string,
        description: string,
        shape: Record<string, unknown>,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => ({ name, description, shape, handler }),
    })
  })

  it('returns non-empty content even when a renderer tool returns undefined', async () => {
    const server = (await createCanvasMcpServer({
      sessionId: 'session-1',
      bridge: { callTool: vi.fn().mockResolvedValue(undefined) },
      toolSchemas: [
        {
          name: 'canvas_noop',
          description: 'test',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })) as unknown as {
      tools: Array<{ handler: (args: Record<string, unknown>) => Promise<any> }>
    }

    const handler = server.tools[0]?.handler
    expect(handler).toBeDefined()
    if (handler == null) throw new Error('canvas_noop handler is missing')
    const result = await handler({})

    expect(result.content[0].text).toContain('执行完成')
    expect(result.structuredContent).toEqual({ ok: true })
  })
})
