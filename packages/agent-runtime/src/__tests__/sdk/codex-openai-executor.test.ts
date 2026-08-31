import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexOpenAIExecutor } from '../../sdk/codex-openai-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const openAIConstructor = vi.hoisted(() => vi.fn())
const chatCreate = vi.hoisted(() => vi.fn())
const temporaryDirectories = new Set<string>()

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x73, 0x70, 0x61, 0x72, 0x6b,
])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x73, 0x70, 0x61, 0x72, 0x6b])
const GIF_BYTES = Buffer.from('GIF89aspark', 'ascii')
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

vi.mock('openai', () => ({
  default: openAIConstructor.mockImplementation(() => ({
    chat: { completions: { create: chatCreate } },
  })),
}))

async function* streamFrom(events: unknown[]) {
  for (const event of events) yield event
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'sk-test',
    apiEndpoint: 'https://provider.example.com/v1/',
    model: 'provider-chat-model',
    workspaceRootPath: process.cwd(),
    permissionMode: 'codex-default',
    systemPrompt: 'System context',
    skillSystemPrompt: 'Skill catalog',
    codexApiKind: 'chat',
    ...overrides,
  }
}

async function createTemporaryFile(name: string, data: Uint8Array): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-openai-chat-image-'))
  temporaryDirectories.add(directory)
  const filePath = path.join(directory, name)
  await writeFile(filePath, data)
  return filePath
}

async function createSparseTemporaryFile(name: string, bytes: number): Promise<string> {
  const filePath = await createTemporaryFile(name, PNG_BYTES)
  await truncate(filePath, bytes)
  return filePath
}

describe('CodexOpenAIExecutor', () => {
  beforeEach(() => {
    openAIConstructor.mockClear()
    chatCreate.mockReset()
  })

  afterEach(async () => {
    const directories = [...temporaryDirectories]
    temporaryDirectories.clear()
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('streams Chat Completions directly without starting the Codex SDK', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        { choices: [{ delta: { content: 'A' } }] },
        { choices: [{ delta: { content: 'B' } }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ]),
    )

    const events: Array<{ type: string; mode?: string; content?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({ type: event.type, mode: event.mode, content: event.content })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(openAIConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://provider.example.com/v1',
    })
    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'provider-chat-model',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: expect.stringContaining('System context') }],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual([
      { type: 'assistant_message', mode: 'delta', content: 'A' },
      { type: 'assistant_message', mode: 'delta', content: 'B' },
      { type: 'assistant_message', mode: 'complete', content: 'AB' },
    ])
  })

  it('sends image attachments as Base64 image_url parts without exposing local paths', async () => {
    const imagePath = await createTemporaryFile('selected.png', PNG_BYTES)
    const invocationObserver = vi.fn()
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'I see it' } }] }]))
    const localAttachmentPaths: string[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'user_message') {
        localAttachmentPaths.push(...(event.attachments ?? []).map((attachment) => attachment.path))
      }
    })

    await executor.executeTurn(
      'session-1',
      'turn-image',
      'Describe this image',
      makeConfig({
        attachments: [
          { type: 'image', path: imagePath, name: 'selected.png', sizeBytes: PNG_BYTES.length },
        ],
        invocationObserver,
      }),
    )

    const request = chatCreate.mock.calls[0]?.[0] as
      | { messages: Array<{ content: unknown }> }
      | undefined
    const content = request?.messages[0]?.content as
      | Array<{ type: string; text?: string; image_url?: { url: string } }>
      | undefined
    expect(content).toEqual([
      { type: 'text', text: expect.stringContaining('Describe this image') },
      {
        type: 'image_url',
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      },
    ])
    expect(content?.[0]?.text).not.toContain(imagePath)
    const dataUrl = content?.[1]?.image_url?.url ?? ''
    expect(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')).toEqual(PNG_BYTES)

    const observedInvocation = JSON.stringify(invocationObserver.mock.calls)
    expect(observedInvocation).toContain('data:image/png;base64,[redacted]')
    expect(observedInvocation).not.toContain(imagePath)
    expect(observedInvocation).not.toContain(PNG_BYTES.toString('base64'))
    expect(localAttachmentPaths).toEqual([imagePath])
  })

  it('preserves image order while keeping ordinary file attachments in the text ledger', async () => {
    const firstImagePath = await createTemporaryFile('first.png', PNG_BYTES)
    const secondImagePath = await createTemporaryFile('second.jpg', JPEG_BYTES)
    const thirdImagePath = await createTemporaryFile('third.webp', WEBP_BYTES)
    const fourthImagePath = await createTemporaryFile('fourth.gif', GIF_BYTES)
    const filePath = '/tmp/notes.txt'
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-mixed',
      'Compare the images with the notes',
      makeConfig({
        attachments: [
          { type: 'image', path: firstImagePath, name: 'first.png' },
          { type: 'file', path: filePath, name: 'notes.txt' },
          { type: 'image', path: secondImagePath, name: 'second.jpg' },
          { type: 'image', path: thirdImagePath, name: 'third.webp' },
          { type: 'image', path: fourthImagePath, name: 'fourth.gif' },
        ],
      }),
    )

    const content = (
      chatCreate.mock.calls[0]?.[0] as {
        messages: Array<{
          content: Array<{ type: string; text?: string; image_url?: { url: string } }>
        }>
      }
    ).messages[0]?.content
    expect(content?.[0]?.text).toContain(filePath)
    expect(content?.[0]?.text).not.toContain(firstImagePath)
    expect(content?.[0]?.text).not.toContain(secondImagePath)
    expect(content?.[0]?.text).not.toContain(thirdImagePath)
    expect(content?.[0]?.text).not.toContain(fourthImagePath)
    expect(content?.slice(1).map((part) => part.image_url?.url.split(';', 1)[0])).toEqual([
      'data:image/png',
      'data:image/jpeg',
      'data:image/webp',
      'data:image/gif',
    ])
  })

  it('keeps multimodal user content intact across Chat tool-call rounds', async () => {
    const imagePath = await createTemporaryFile('tool-input.png', PNG_BYTES)
    const invoke = vi.fn(async () => ({ ok: true }))
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-image',
                      function: { name: 'package_acme_inspect', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(streamFrom([{ choices: [{ delta: { content: 'Done' } }] }]))

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-image-tool',
      'Inspect this image',
      makeConfig({
        attachments: [{ type: 'image', path: imagePath, name: 'tool-input.png' }],
        openAIChatTools: [
          {
            name: 'package_acme_inspect',
            description: 'Inspect metadata',
            inputSchema: { type: 'object' },
            risk: 'read',
            invoke,
          },
        ],
      }),
    )

    expect(chatCreate).toHaveBeenCalledTimes(2)
    const secondRequest = chatCreate.mock.calls[1]?.[0] as
      | { messages: Array<{ role: string; content: unknown }> }
      | undefined
    expect(secondRequest?.messages[0]?.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image_url' })]),
    )
    expect(secondRequest?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('rejects unreadable, unsupported, empty, malformed, and oversized images before the API call', async () => {
    const emptyImagePath = await createTemporaryFile('empty.png', new Uint8Array())
    const malformedImagePath = await createTemporaryFile('malformed.png', Buffer.from('not-png'))
    const oversizedImagePath = await createSparseTemporaryFile(
      'oversized.png',
      20 * 1024 * 1024 + 1,
    )
    const cases = [
      {
        attachment: { type: 'image' as const, path: '/tmp/missing.png', name: 'missing.png' },
        message: 'could not be read',
      },
      {
        attachment: {
          type: 'image' as const,
          path: '/tmp/unsupported.bmp',
          name: 'unsupported.bmp',
        },
        message: 'unsupported format',
      },
      {
        attachment: { type: 'image' as const, path: emptyImagePath, name: 'empty.png' },
        message: 'between 1 byte and 20MB',
      },
      {
        attachment: { type: 'image' as const, path: malformedImagePath, name: 'malformed.png' },
        message: 'does not match',
      },
      {
        attachment: { type: 'image' as const, path: oversizedImagePath, name: 'oversized.png' },
        message: 'between 1 byte and 20MB',
      },
    ]

    for (const testCase of cases) {
      chatCreate.mockClear()
      const invocationObserver = vi.fn()
      const errors: string[] = []
      const executor = new CodexOpenAIExecutor()
      executor.onEvent((event) => {
        if (event.type === 'agent_error') errors.push(event.message)
      })
      await expect(
        executor.executeTurn(
          'session-1',
          'turn-invalid-image',
          'Read this',
          makeConfig({ attachments: [testCase.attachment], invocationObserver }),
        ),
      ).rejects.toThrow(testCase.message)
      expect(chatCreate).not.toHaveBeenCalled()
      expect(invocationObserver).not.toHaveBeenCalled()
      expect(errors).toEqual([expect.stringContaining(testCase.message)])
    }
  })

  it('rejects image attachments over the combined 50MB limit before reading them', async () => {
    const imagePaths = await Promise.all([
      createSparseTemporaryFile('one.png', 18 * 1024 * 1024),
      createSparseTemporaryFile('two.png', 18 * 1024 * 1024),
      createSparseTemporaryFile('three.png', 18 * 1024 * 1024),
    ])

    await expect(
      new CodexOpenAIExecutor().executeTurn(
        'session-1',
        'turn-total-limit',
        'Read these',
        makeConfig({
          attachments: imagePaths.map((imagePath) => ({
            type: 'image' as const,
            path: imagePath,
            name: path.basename(imagePath),
          })),
        }),
      ),
    ).rejects.toThrow('50MB combined size limit')
    expect(chatCreate).not.toHaveBeenCalled()
  })

  it('executes standard Chat Completions tools and returns tool results to the model', async () => {
    const invoke = vi.fn(async (input: Record<string, unknown>) => ({ echoed: input }))
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: { name: 'package_acme_echo', arguments: '{"value":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '42}' } }],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(streamFrom([{ choices: [{ delta: { content: 'Tool finished' } }] }]))

    const events: Array<{ type: string; status?: string; toolName?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_call') {
        events.push({ type: event.type, toolName: event.toolName })
      } else if (event.type === 'tool_result') {
        events.push({ type: event.type, status: event.status, toolName: event.toolName })
      }
    })
    await executor.executeTurn(
      'session-1',
      'turn-tools',
      'use the tool',
      makeConfig({
        openAIChatTools: [
          {
            name: 'package_acme_echo',
            description: 'Echo input',
            inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
            risk: 'read',
            invoke,
          },
        ],
      }),
    )

    expect(invoke).toHaveBeenCalledWith({ value: 42 })
    expect(chatCreate).toHaveBeenCalledTimes(2)
    expect(chatCreate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({ name: 'package_acme_echo' }),
          }),
        ],
      }),
    )
    expect(chatCreate.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'call-1',
            content: JSON.stringify({ result: { echoed: { value: 42 } } }),
          }),
        ]),
      }),
    )
    expect(events).toEqual([
      { type: 'tool_call', toolName: 'package_acme_echo' },
      { type: 'tool_result', status: 'success', toolName: 'package_acme_echo' },
    ])
  })

  it('rejects unbounded streamed tool arguments before invoking package code', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    chatCreate.mockResolvedValue(
      streamFrom([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-oversized',
                    function: {
                      name: 'package_acme_echo',
                      arguments: 'x'.repeat(1024 * 1024 + 1),
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    )

    await expect(
      new CodexOpenAIExecutor().executeTurn(
        'session-1',
        'turn-oversized-arguments',
        'use the tool',
        makeConfig({
          openAIChatTools: [
            {
              name: 'package_acme_echo',
              description: 'Echo input',
              inputSchema: { type: 'object', properties: {} },
              risk: 'read',
              invoke,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/tool arguments exceeded 1048576 bytes/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns a bounded JSON summary for oversized tool results', async () => {
    const invoke = vi.fn(async () => ({ payload: '你'.repeat(800_000) }))
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-large-result',
                      function: { name: 'package_acme_large', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(streamFrom([{ choices: [{ delta: { content: 'Handled summary' } }] }]))

    const outputs: unknown[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_result' && event.status === 'success') outputs.push(event.output)
    })
    await executor.executeTurn(
      'session-1',
      'turn-large-result',
      'use the tool',
      makeConfig({
        openAIChatTools: [
          {
            name: 'package_acme_large',
            description: 'Return a large result',
            inputSchema: { type: 'object', properties: {} },
            risk: 'read',
            invoke,
          },
        ],
      }),
    )

    const secondRequest = chatCreate.mock.calls[1]?.[0] as
      | { messages: Array<{ role: string; content?: string }> }
      | undefined
    const toolMessage = secondRequest?.messages.find((message) => message.role === 'tool')
    const providerPayload = JSON.parse(toolMessage?.content ?? '{}') as {
      result?: { truncated?: boolean; originalBytes?: number; preview?: string }
    }
    expect(providerPayload.result).toMatchObject({
      truncated: true,
      originalBytes: expect.any(Number),
    })
    expect(Buffer.byteLength(toolMessage?.content ?? '', 'utf8')).toBeLessThan(100_000)
    expect(outputs).toEqual([
      expect.objectContaining({ truncated: true, originalBytes: expect.any(Number) }),
    ])
    expect(JSON.stringify(outputs)).not.toContain('你'.repeat(100_000))
  })

  it('converts non-serializable tool output into a bounded tool error and continues', async () => {
    const invoke = vi.fn(async () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      return circular
    })
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-circular',
                      function: { name: 'package_acme_circular', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(streamFrom([{ choices: [{ delta: { content: 'Recovered' } }] }]))

    const statuses: string[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_result') statuses.push(event.status)
      if (event.type === 'agent_status') statuses.push(event.status)
    })
    await executor.executeTurn(
      'session-1',
      'turn-circular',
      'use the tool',
      makeConfig({
        openAIChatTools: [
          {
            name: 'package_acme_circular',
            description: 'Return a circular result',
            inputSchema: { type: 'object', properties: {} },
            risk: 'read',
            invoke,
          },
        ],
      }),
    )

    const secondRequest = chatCreate.mock.calls[1]?.[0] as
      | { messages: Array<{ role: string; content?: string }> }
      | undefined
    const toolMessage = secondRequest?.messages.find((message) => message.role === 'tool')
    expect(JSON.parse(toolMessage?.content ?? '{}')).toMatchObject({
      error: expect.stringContaining('circular'),
    })
    expect(statuses).toContain('error')
    expect(statuses).toContain('completed')
  })

  it('denies write-capable tools when interactive approval is unavailable', async () => {
    const invoke = vi.fn(async () => ({ changed: true }))
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-write',
                      function: { name: 'package_acme_write', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(streamFrom([{ choices: [{ delta: { content: 'Write denied' } }] }]))

    const results: Array<{ status: string; error?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_result') {
        results.push({
          status: event.status,
          ...(event.error != null ? { error: event.error } : {}),
        })
      }
    })
    await executor.executeTurn(
      'session-1',
      'turn-write-denied',
      'change data',
      makeConfig({
        openAIChatTools: [
          {
            name: 'package_acme_write',
            description: 'Write data',
            inputSchema: { type: 'object', properties: {} },
            risk: 'low-write',
            invoke,
          },
        ],
      }),
    )

    expect(invoke).not.toHaveBeenCalled()
    expect(results).toEqual([
      {
        status: 'denied',
        error: 'Write-capable Chat Completions tool requires interactive approval',
      },
    ])
  })

  it('treats approval callback failures as a denied write call and continues the turn', async () => {
    const invoke = vi.fn(async () => ({ changed: true }))
    const approvalCallback = vi.fn(async () => {
      throw new Error('approval UI unavailable')
    })
    chatCreate
      .mockResolvedValueOnce(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-write-fallback',
                      function: { name: 'package_acme_write', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        streamFrom([{ choices: [{ delta: { content: 'Approval failed safely' } }] }]),
      )

    const statuses: string[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_result') statuses.push(event.status)
      if (event.type === 'agent_status') statuses.push(event.status)
    })
    await executor.executeTurn(
      'session-1',
      'turn-write-fallback',
      'change data',
      makeConfig({
        approvalCallback,
        openAIChatTools: [
          {
            name: 'package_acme_write',
            description: 'Write data',
            inputSchema: { type: 'object', properties: {} },
            risk: 'high-write',
            invoke,
          },
        ],
      }),
    )

    expect(approvalCallback).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
    expect(statuses).toContain('denied')
    expect(statuses).toContain('completed')
  })

  it('reports usage from the terminal Chat Completions chunk', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        { choices: [{ delta: { content: 'Done' } }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
      ]),
    )

    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'usage_update') {
        usage.push({ inputTokens: event.inputTokens, outputTokens: event.outputTokens })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(usage).toEqual([{ inputTokens: 12, outputTokens: 4 }])
  })

  it('sends the real OpenAI Fast mode service tier only when enabled', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-fast',
      'hello',
      makeConfig({ fastMode: true }),
    )
    expect(chatCreate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ service_tier: 'fast' }))

    chatCreate.mockClear()
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))
    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-standard',
      'hello',
      makeConfig({ fastMode: false }),
    )
    expect(chatCreate.mock.calls[0]?.[0]).not.toHaveProperty('service_tier')
  })

  it('reports cached prompt tokens as cacheHitTokens when prompt_tokens_details is present', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        {
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 80 },
          },
        },
      ]),
    )

    const usage: Array<{ inputTokens: number; cacheHitTokens?: number }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'usage_update') {
        usage.push({
          inputTokens: event.inputTokens,
          ...(event.cacheHitTokens != null ? { cacheHitTokens: event.cacheHitTokens } : {}),
        })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    // OpenAI 口径：cached_tokens 是 prompt_tokens 的子集，直接透传为 cacheHitTokens
    expect(usage).toEqual([{ inputTokens: 100, cacheHitTokens: 80 }])
  })

  it('omits cacheHitTokens when prompt_tokens_details is absent (unmeasured, not zero)', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        {
          choices: [],
          usage: { prompt_tokens: 30, completion_tokens: 2 },
        },
      ]),
    )

    const usage: Array<{ inputTokens: number; hasCacheField: boolean }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'usage_update') {
        usage.push({ inputTokens: event.inputTokens, hasCacheField: event.cacheHitTokens != null })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    // 缺省（未度量）与 0（已度量零命中）必须在事件负载层可区分，展示层才能区分。
    expect(usage).toEqual([{ inputTokens: 30, hasCacheField: false }])
  })

  it('places the stable runtime context before the volatile skill catalog in the prompt', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))

    await new CodexOpenAIExecutor().executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    const body = chatCreate.mock.calls[0]?.[0] as
      | { messages: Array<{ content: string }> }
      | undefined
    const prompt = body?.messages[0]?.content ?? ''
    // 内容逐字保留，仅段序调整：稳定段在前、易变 skill 段在后（缓存前缀稳定性）
    expect(prompt).toContain('# Spark Runtime Context\nSystem context')
    expect(prompt).toContain('# Spark Skills\nSkill catalog')
    expect(prompt.indexOf('# Spark Runtime Context')).toBeLessThan(prompt.indexOf('# Spark Skills'))
  })

  it('captures a redacted direct-chat invocation for diagnostics', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))
    const invocationObserver = vi.fn()

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ invocationObserver }),
    )

    expect(invocationObserver).toHaveBeenCalledWith({
      transport: 'openai-chat',
      request: expect.objectContaining({
        endpoint: 'https://provider.example.com/v1/chat/completions',
        credentials: '[redacted]',
      }),
    })
    expect(JSON.stringify(invocationObserver.mock.calls)).not.toContain('sk-test')
  })

  it('accepts a full Chat Completions URL without duplicating the path', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))
    const invocationObserver = vi.fn()

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        apiEndpoint: 'https://provider.example.com/v1/chat/completions',
        invocationObserver,
      }),
    )

    expect(openAIConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://provider.example.com/v1',
    })
    expect(invocationObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          endpoint: 'https://provider.example.com/v1/chat/completions',
        }),
      }),
    )
  })

  it('cancels the direct Chat request without emitting an uncaught error', async () => {
    chatCreate.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })

    const statuses: string[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_status') statuses.push(event.status)
    })
    const turn = executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())
    executor.cancel()
    await expect(turn).resolves.toBeUndefined()

    expect(statuses).toContain('cancelled')
  })
})
