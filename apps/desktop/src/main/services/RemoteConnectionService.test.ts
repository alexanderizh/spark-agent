import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteConnectionConfig } from '@spark/protocol'

import {
  RemoteConnectionService,
  buildFeishuCard,
  buildTelegramBotCommands,
  parseWebhookBody,
} from './RemoteConnectionService.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('buildFeishuCard', () => {
  it('keeps Markdown content in a rich-text card even without actions', () => {
    const card = buildFeishuCard({
      title: '模型列表',
      text: '**主模型**\n\n1. GPT\n2. Claude\n\n`/use-model 1`',
    }) as {
      header: { title: { content: string } }
      elements: Array<{ tag: string; text?: { tag: string; content: string } }>
    }

    expect(card.header.title.content).toBe('模型列表')
    expect(card.elements).toHaveLength(1)
    expect(card.elements[0]?.text).toEqual({
      tag: 'lark_md',
      content: '**主模型**\n\n1. GPT\n2. Claude\n\n`/use-model 1`',
    })
  })

  it('keeps actions as the last card section', () => {
    const card = buildFeishuCard({
      text: '选择模型',
      actions: [{ label: '切换 1', command: '/use-model 1', style: 'primary' }],
    }) as { elements: Array<{ tag: string; actions?: unknown[] }> }

    expect(card.elements.at(-1)).toEqual({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '切换 1' },
          type: 'primary',
          value: { command: '/use-model 1' },
        },
      ],
    })
  })

  it('does not truncate long Feishu action commands', () => {
    const command = `/use-model ${'model-id-'.repeat(30)}`
    const card = buildFeishuCard({
      text: '选择模型',
      actions: [{ label: '长模型 ID', command }],
    }) as { elements: Array<{ actions?: Array<{ value: { command: string } }> }> }

    expect(card.elements.at(-1)?.actions?.[0]?.value.command).toBe(command)
  })
})

describe('remote command coverage', () => {
  it('parses Feishu image-only webhook events into image attachments', () => {
    expect(
      parseWebhookBody('feishu', {
        event: {
          message: {
            chat_id: 'oc_1',
            message_id: 'om_1',
            message_type: 'image',
            content: '{"image_key":"img_1"}',
          },
          sender: { sender_id: { open_id: 'ou_1' } },
        },
      }),
    ).toMatchObject({
      kind: 'message',
      externalId: 'oc_1',
      text: '请识别并说明这张图片。',
      feishuImage: { messageId: 'om_1', fileKey: 'img_1', resourceType: 'image' },
    })
  })

  it('sends QQ image as upload plus rich-media message', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-send-test-'))
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('getAppAccessToken'))
        return new Response('{"access_token":"token","expires_in":3600}')
      if (target.endsWith('/files')) return new Response('{"file_info":"info"}')
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const service = new RemoteConnectionService({
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never)
      const connection = service.createBotDraft('qq').connection
      service.save({
        ...connection,
        credentials: { qqBotAppId: 'app', qqBotSecret: 'secret' },
        capabilities: { ...connection.capabilities, transferFiles: true },
      })
      await service.sendReply(connection.id, 'qq-user:openid', '', [{ type: 'image', path: file }])
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        body: String(init?.body),
      }))
      expect(
        calls.some(
          (call) => call.url.endsWith('/files') && JSON.parse(call.body).srv_send_msg === false,
        ),
      ).toBe(true)
      expect(
        calls.some(
          (call) =>
            call.url.endsWith('/messages') &&
            JSON.parse(call.body).msg_type === 7 &&
            JSON.parse(call.body).media.file_info === 'info',
        ),
      ).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('reports that a QQ image was not sent when file transfer is disabled', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-disabled-image-test-'))
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('getAppAccessToken'))
        return new Response('{"access_token":"token","expires_in":3600}')
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const service = new RemoteConnectionService({
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never)
      const connection = service.createBotDraft('qq').connection
      service.save({
        ...connection,
        credentials: { qqBotAppId: 'app', qqBotSecret: 'secret' },
        capabilities: { ...connection.capabilities, transferFiles: false },
      })
      await service.sendReply(connection.id, 'qq-user:openid', '图片已发送，请查收。', [
        { type: 'image', path: file },
      ])
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        body: String(init?.body),
      }))
      expect(calls.some((call) => call.url.endsWith('/files'))).toBe(false)
      const sent = calls.find((call) => call.url.endsWith('/messages'))
      expect(sent).toBeDefined()
      expect(JSON.parse(sent?.body ?? '{}').content).toContain('图片未发送')
      expect(JSON.parse(sent?.body ?? '{}').content).not.toContain('图片已发送')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('sends Feishu attachment as native image message', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-send-test-'))
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('tenant_access_token'))
        return new Response('{"tenant_access_token":"token","expire":3600}')
      if (target.endsWith('/images')) return new Response('{"code":0,"data":{"image_key":"img_1"}}')
      return new Response('{"code":0}')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const service = new RemoteConnectionService({
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never)
      const connection = service.createBotDraft('feishu').connection
      service.save({
        ...connection,
        credentials: { appId: 'app', appSecret: 'secret' },
        capabilities: { ...connection.capabilities, transferFiles: true },
      })
      await service.sendReply(connection.id, 'oc_chat', '', [{ type: 'image', path: file }])
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('im/v1/messages?'))
      expect(JSON.parse(String(send?.[1]?.body))).toMatchObject({
        msg_type: 'image',
        content: '{"image_key":"img_1"}',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('streams Telegram output by sending once and editing the same message', async () => {
    vi.useFakeTimers()
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/sendMessage')
              ? { ok: true, result: { message_id: 77 } }
              : { ok: true, result: true },
          ),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    service.startTurnFeedback('turn-1', connection.id, '42')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sendMessage'))).toBe(false)
    service.updateTurnFeedback('turn-1', { content: '第一行', mode: 'delta', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(1_100)
    service.updateTurnFeedback('turn-1', { content: '\n第二行', mode: 'delta', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(1_100)
    expect(await service.finishTurnFeedback('turn-1', '第一行\n第二行')).toBe(true)

    const streamCalls = fetchMock.mock.calls
      .filter(([url]) => /\/(?:sendMessage|editMessageText)$/u.test(String(url)))
      .map(([url, init]) => ({
        method: String(url).split('/').at(-1),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }))
    expect(streamCalls).toEqual([
      {
        method: 'sendMessage',
        body: {
          chat_id: '42',
          text: '第一行',
          disable_web_page_preview: true,
          parse_mode: 'HTML',
        },
      },
      {
        method: 'editMessageText',
        body: {
          chat_id: '42',
          message_id: 77,
          text: '第一行\n第二行',
          disable_web_page_preview: true,
          parse_mode: 'HTML',
        },
      },
    ])
  })

  it('renders Markdown as Telegram HTML and falls back only when entity parsing fails', async () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":false,"description":"Bad Request: can\'t parse entities"}', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    await service.sendReply(connection.id, '42', '**加粗** 和 `代码`')

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      text: '<b>加粗</b> 和 <code>代码</code>',
      parse_mode: 'HTML',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      text: '**加粗** 和 `代码`',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).not.toHaveProperty('parse_mode')
  })

  it('acknowledges a Telegram message with an eyes reaction and typing status', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService({ get: () => null, set: () => undefined } as never)
    const connection = service.createBotDraft('telegram').connection
    connection.credentials.botToken = 'test-token'
    const feedback = service as unknown as {
      sendProcessingFeedback: (
        connection: RemoteConnectionConfig,
        externalId: string,
        messageId: string,
      ) => Promise<void>
    }

    await feedback.sendProcessingFeedback(connection, '42', 'telegram:7')

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    }))
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          url: 'https://api.telegram.org/bottest-token/sendChatAction',
          body: { chat_id: '42', action: 'typing' },
        },
        {
          url: 'https://api.telegram.org/bottest-token/setMessageReaction',
          body: {
            chat_id: '42',
            message_id: 7,
            reaction: [{ type: 'emoji', emoji: '👀' }],
          },
        },
      ]),
    )
  })

  it('does not react to a Telegram callback query as if it were a message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService({ get: () => null, set: () => undefined } as never)
    const connection = service.createBotDraft('telegram').connection
    connection.credentials.botToken = 'test-token'
    const feedback = service as unknown as {
      sendProcessingFeedback: (
        connection: RemoteConnectionConfig,
        externalId: string,
        messageId: string,
      ) => Promise<void>
    }

    await feedback.sendProcessingFeedback(connection, '42', 'telegram:callback:7')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.telegram.org/bottest-token/sendChatAction',
    )
  })

  it('keeps Telegram image metadata and uses the caption as the session prompt', () => {
    expect(
      parseWebhookBody('telegram', {
        message: {
          message_id: 7,
          chat: { id: 42 },
          caption: '看看这张图',
          photo: [
            { file_id: 'small', width: 90, height: 90 },
            { file_id: 'large', file_unique_id: 'photo-1', width: 1280, height: 720 },
          ],
        },
      }),
    ).toMatchObject({
      kind: 'message',
      externalId: '42',
      text: '看看这张图',
      messageId: 'telegram:7',
      inboundImages: [{ fileId: 'large', fileUniqueId: 'photo-1' }],
    })
  })

  it('builds a native Telegram command menu with normalized, permitted commands', () => {
    const commands = buildTelegramBotCommands({
      telegramCommands: ['/new-session', 'new_session', 'use-model', 'use_model'],
      capabilities: {
        sendMessages: true,
        switchModel: false,
        switchSession: true,
        switchAgent: true,
        manageWorkspace: true,
        runCommands: true,
        approvePermissions: true,
        observeDesktop: true,
        controlDesktop: false,
        useInternalBrowser: true,
        transferFiles: true,
        manageRuntime: true,
        dangerousActions: false,
      },
    })

    expect(commands.map((command) => command.command)).toEqual(['new_session'])
  })

  it('covers project, session, channel, model, reasoning, and permission workflows', () => {
    const service = new RemoteConnectionService({} as never)
    const names = new Set(service.getCommandCatalog().map((command) => command.name))
    for (const name of [
      'projects',
      'add-project',
      'use-project',
      'sessions',
      'new-session',
      'use-session',
      'channels',
      'use-channel',
      'models',
      'use-model',
      'reasoning',
      'use-reasoning',
      'permissions',
      'use-permission',
    ]) {
      expect(names.has(name), `missing /${name}`).toBe(true)
    }
  })

  it('enables safe runtime controls and permission selection for new connections', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const draft = service.createBotDraft('telegram').connection
    expect(draft.capabilities.manageRuntime).toBe(true)
    expect(draft.capabilities.approvePermissions).toBe(true)
    expect(draft.capabilities.dangerousActions).toBe(false)
  })

  it('rejects accidental cross-connection session binding', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const telegram = service.createBotDraft('telegram').connection
    service.save({ ...telegram, defaultSessionId: 'session-shared' })
    const qq = service.createBotDraft('qq').connection
    expect(() => service.save({ ...qq, defaultSessionId: 'session-shared' })).toThrow(
      '为避免渠道、历史和运行配置混淆',
    )
  })

  it('allows session sharing only when every connection opts in', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const telegram = service.createBotDraft('telegram').connection
    service.save({ ...telegram, defaultSessionId: 'session-shared', allowSharedSession: true })
    const qq = service.createBotDraft('qq').connection
    const saved = service.save({
      ...qq,
      defaultSessionId: 'session-shared',
      allowSharedSession: true,
    })
    expect(saved.defaultSessionId).toBe('session-shared')
    expect(saved.allowSharedSession).toBe(true)
  })

  it('can explicitly clear an existing default session binding', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const draft = service.createBotDraft('telegram').connection
    const bound = service.save({ ...draft, defaultSessionId: 'session-1' })
    const unbound = service.save({ ...bound, defaultSessionId: null })
    expect(unbound.defaultSessionId).toBeUndefined()
  })
})
