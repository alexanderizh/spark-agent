import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_QQ_REMOTE_COMMANDS,
  DEFAULT_TELEGRAM_REMOTE_COMMANDS,
  type RemoteConnectionConfig,
} from '@spark/protocol'

import {
  RemoteConnectionService,
  buildFeishuCard,
  buildQqCommandPanelItems,
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
  it('keeps the Telegram callback source message ID for in-place pagination', () => {
    expect(
      parseWebhookBody('telegram', {
        callback_query: {
          id: 'callback-1',
          data: '/sessions --page 3',
          from: { id: 9, first_name: 'Tester' },
          message: { message_id: 88, chat: { id: 42 } },
        },
      }),
    ).toMatchObject({
      kind: 'message',
      externalId: '42',
      text: '/sessions --page 3',
      messageId: 'telegram:callback:callback-1',
      editMessageId: 88,
    })
  })

  it('edits the callback message instead of sending another pagination message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService({ get: () => null, set: () => undefined } as never)
    const connection = service.createBotDraft('telegram').connection
    connection.credentials.botToken = 'test-token'
    const sender = service as unknown as {
      sendTelegramMessage: (
        connection: RemoteConnectionConfig,
        externalId: string,
        message: {
          title: string
          text: string
          actions: Array<{ label: string; command: string }>
          editMessageId: number
        },
      ) => Promise<void>
    }

    await sender.sendTelegramMessage(connection, '42', {
      title: '主机会话 · 全部状态',
      text: '共 393 项 · 第 3/66 页',
      actions: [{ label: '下一页 ›', command: '/sessions --page 4' }],
      editMessageId: 88,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.telegram.org/bottest-token/editMessageText',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      chat_id: '42',
      message_id: 88,
      reply_markup: {
        inline_keyboard: [[{ text: '下一页 ›', callback_data: '/sessions --page 4' }]],
      },
    })
  })

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

  it('builds a QQ command panel with capability and 14-char name limits applied', () => {
    const items = buildQqCommandPanelItems({
      commandPrefix: '/',
      qqCommands: ['help', 'use_model', 'use-model', 'use-permission', 'use-reasoning', 'missing'],
      capabilities: {
        sendMessages: true,
        switchModel: true,
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

    // use-permission 展开后 15 字符超出面板名称上限被跳过；use_model 与 use-model 去重。
    expect(items.map((item) => item.name)).toEqual(['/help', '/use-model', '/use-reasoning'])
    for (const item of items) {
      expect(item.type).toBe('command')
      expect(item.name.length).toBeLessThanOrEqual(14)
      expect(item.desc.length).toBeLessThanOrEqual(30)
    }
  })

  it('keeps default QQ commands within the panel name limit with all capabilities on', () => {
    const items = buildQqCommandPanelItems({
      commandPrefix: '/',
      qqCommands: [...DEFAULT_QQ_REMOTE_COMMANDS],
      capabilities: {
        sendMessages: true,
        switchModel: true,
        switchSession: true,
        switchAgent: true,
        manageWorkspace: true,
        runCommands: true,
        approvePermissions: true,
        observeDesktop: true,
        controlDesktop: true,
        useInternalBrowser: true,
        transferFiles: true,
        manageRuntime: true,
        dangerousActions: true,
      },
    })

    expect(items.length).toBe(DEFAULT_QQ_REMOTE_COMMANDS.length)
    for (const item of items) expect(item.name.length).toBeLessThanOrEqual(14)
  })

  it('registers /start as the first native-menu command for new connections', () => {
    expect(DEFAULT_QQ_REMOTE_COMMANDS[0]).toBe('start')
    expect(DEFAULT_TELEGRAM_REMOTE_COMMANDS[0]).toBe('start')
    const items = buildQqCommandPanelItems({
      commandPrefix: '/',
      qqCommands: [...DEFAULT_QQ_REMOTE_COMMANDS],
      capabilities: {
        sendMessages: true,
        switchModel: true,
        switchSession: true,
        switchAgent: true,
        manageWorkspace: true,
        runCommands: true,
        approvePermissions: true,
        observeDesktop: true,
        controlDesktop: true,
        useInternalBrowser: true,
        transferFiles: true,
        manageRuntime: true,
        dangerousActions: true,
      },
    })
    expect(items.slice(0, 2).map((item) => item.name)).toEqual(['/start', '/help'])
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

  it('persists separate chat defaults and rejects a second chat using the same session', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const draft = service.createBotDraft('telegram').connection
    service.save({
      ...draft,
      defaultSessionId: 'legacy-session',
      allowedChatIds: ['chat-a', 'chat-b'],
    })
    expect(service.ensureRouteBinding(draft.id, 'chat-a').defaultSessionId).toBeUndefined()
    expect(service.ensureRouteBinding(draft.id, 'chat-b').defaultSessionId).toBeUndefined()
    service.updateRouteDefaults(draft.id, 'chat-a', {
      defaultSessionId: 'session-a',
      defaultModelId: 'model-a',
    })
    expect(() =>
      service.updateRouteDefaults(draft.id, 'chat-b', {
        defaultSessionId: 'session-a',
      }),
    ).toThrow('已绑定到其他远程聊天')
    service.updateRouteDefaults(draft.id, 'chat-b', {
      defaultSessionId: 'session-b',
      defaultModelId: 'model-b',
    })
    const reloaded = new RemoteConnectionService(settings as never)
    expect(reloaded.ensureRouteBinding(draft.id, 'chat-a')).toMatchObject({
      defaultSessionId: 'session-a',
      defaultModelId: 'model-a',
    })
    expect(reloaded.ensureRouteBinding(draft.id, 'chat-b')).toMatchObject({
      defaultSessionId: 'session-b',
      defaultModelId: 'model-b',
    })
  })

  it('migrates a legacy default session only for its sole known chat', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const draft = service.createBotDraft('telegram').connection
    service.save({ ...draft, defaultSessionId: 'legacy-session', allowedChatIds: ['chat-a'] })
    expect(service.ensureRouteBinding(draft.id, 'chat-a').defaultSessionId).toBe('legacy-session')
    expect(service.ensureRouteBinding(draft.id, 'chat-b').defaultSessionId).toBeUndefined()
  })
})

describe('clearDeletedProviderReferences', () => {
  it('清除连接与路由绑定中指向已删渠道的默认渠道引用，未命中时不写库', () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const service = new RemoteConnectionService(settings as never)
    const draft = service.createBotDraft('telegram').connection
    service.save({ ...draft, allowedChatIds: ['chat-a'] })
    service.updateConnectionDefaults(draft.id, { defaultProviderProfileId: 'deleted-p' })
    service.ensureRouteBinding(draft.id, 'chat-a')
    // 路由绑定继承连接默认渠道，两条引用都指向 deleted-p。

    const result = service.clearDeletedProviderReferences('deleted-p')
    expect(result).toEqual({ connections: 1, routes: 1 })
    const connection = service
      .list()
      .connections.find((item) => item.id === draft.id) as RemoteConnectionConfig
    expect(connection.defaultProviderProfileId).toBeUndefined()
    expect(
      connection.routeBindings?.find((item) => item.externalId === 'chat-a')
        ?.defaultProviderProfileId,
    ).toBeUndefined()
    // defaultModelId 等其余默认值不受影响（建会话时会按新渠道重新校验）。

    // 未命中不写库、零计数。
    const miss = service.clearDeletedProviderReferences('not-exist')
    expect(miss).toEqual({ connections: 0, routes: 0 })
  })
})

describe('remote delivery retry', () => {
  it('sendReply 在瞬态网络失败后按退避重试并恢复投递', async () => {
    vi.useFakeTimers()
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    let failures = 0
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/sendMessage') && failures < 2) {
        failures += 1
        throw new TypeError('fetch failed')
      }
      return new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    const pending = service.sendReply(connection.id, '42', 'hello')
    // 推进重试间隔（1s + 4s），让三次投递机会全部发生。
    await vi.advanceTimersByTimeAsync(6_000)
    await pending
    expect(failures).toBe(2)
    const sendCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/sendMessage'))
    expect(sendCalls).toHaveLength(3)
    // 恢复成功后连接不应残留投递失败状态。
    const saved = service
      .list()
      .connections.find((item) => item.id === connection.id) as RemoteConnectionConfig
    expect(saved.lastError).toBeUndefined()
  })

  it('sendReply 重试耗尽后把失败原因落到连接 lastError 并抛出', async () => {
    vi.useFakeTimers()
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    const pending = service.sendReply(connection.id, '42', 'hello')
    const assertion = expect(pending).rejects.toThrow('fetch failed')
    // 推进全部重试间隔（1s + 4s + 12s）。
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
    const saved = service
      .list()
      .connections.find((item) => item.id === connection.id) as RemoteConnectionConfig
    expect(saved.lastError ?? '').toContain('消息投递失败')
  })

  it('sendReply 对 4xx 业务错误不重试、直接失败', async () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":false}', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    await expect(service.sendReply(connection.id, '42', 'hello')).rejects.toThrow('400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('unauthorized inbound handling', () => {
  it('QQ 未配对消息回复中说明平台标识轮换，重新配对即可恢复', async () => {
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('bots.qq.com/app/getAppAccessToken')
        ? new Response('{"access_token":"tk","expires_in":3600}', { status: 200 })
        : new Response('{"ok":true}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('qq').connection
    service.save({
      ...connection,
      enabled: true,
      credentials: { qqBotAppId: 'app', qqBotSecret: 'secret' },
    })

    const handle = (
      service as unknown as {
        handleInboundMessage: (
          this: RemoteConnectionService,
          connection: RemoteConnectionConfig,
          message: { externalId: string; senderName: string; text: string },
        ) => Promise<void>
      }
    ).handleInboundMessage
    await handle.call(service, connection, {
      externalId: 'qq-user:NEWOPENID',
      senderName: 'user',
      text: '你好',
    })

    const body = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => String(url).includes('/v2/users/'))?.[1]?.body),
    ) as { content: string }
    expect(body.content).toContain('尚未绑定')
    expect(body.content).toContain('QQ 平台可能在更换设备、重装 QQ 或重新添加机器人后刷新用户标识')
  })
})

describe('telegram inbound voice', () => {
  const OGG_BYTES = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)])

  function buildVoiceFetchMock(): ReturnType<typeof vi.fn> {
    return vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('/getFile')) {
        return new Response('{"ok":true,"result":{"file_path":"voice/file_0.oga"}}')
      }
      if (target.includes('/file/bot')) return new Response(OGG_BYTES)
      return new Response('{"ok":true,"result":{"message_id":1}}')
    })
  }

  async function createVoiceService(options?: {
    transcriber?: {
      transcribe: (input: { audioPath: string; mimeType?: string }) => Promise<
        | { kind: 'ok'; text: string; engine: 'local' | 'cloud' }
        | { kind: 'failed'; message: string }
      >
    }
    transferFiles?: boolean
    inboundHandler?: (message: { text: string }) => Promise<void>
  }) {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-voice-inbound-'))
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_c: string, _k: string, v: unknown) => {
        stored = v
      },
    }
    const fetchMock = buildVoiceFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(
      settings as never,
      attachmentRoot,
      options?.transcriber,
    )
    const connection = service.createBotDraft('telegram').connection
    service.save({
      ...connection,
      enabled: true,
      allowedChatIds: ['chat-1'],
      credentials: { botToken: 'test-token' },
      capabilities: { ...connection.capabilities, transferFiles: options?.transferFiles ?? true },
    })
    if (options?.inboundHandler != null) {
      ;(
        service as unknown as {
          inboundHandler: (message: { text: string }) => Promise<void>
        }
      ).inboundHandler = options.inboundHandler
    }
    return { service, connection, fetchMock }
  }

  const callHandleInbound = async (
    service: RemoteConnectionService,
    connection: RemoteConnectionConfig,
    message: Record<string, unknown>,
  ) =>
    (
      service as unknown as {
        handleInboundMessage: (
          this: RemoteConnectionService,
          connection: RemoteConnectionConfig,
          message: Record<string, unknown>,
        ) => Promise<void>
      }
    ).handleInboundMessage.call(service, connection, message)

  it('parseWebhookBody 把语音消息解析为带 inboundVoice 的 message', () => {
    const parsed = parseWebhookBody('telegram', {
      message: {
        message_id: 7,
        chat: { id: 1001 },
        from: { username: 'alice' },
        voice: { file_id: 'vf1', file_unique_id: 'vu1', duration: 8, file_size: 4096 },
      },
    })
    expect(parsed).toMatchObject({
      kind: 'message',
      externalId: '1001',
      text: '请转写并处理这条语音消息。',
      inboundVoice: { fileId: 'vf1', fileUniqueId: 'vu1', durationSec: 8 },
    })
  })

  it('转写成功后以 [语音] 前缀进入会话', async () => {
    const received: string[] = []
    const { service, connection } = await createVoiceService({
      transcriber: {
        transcribe: async () => ({ kind: 'ok', text: '今天天气不错', engine: 'local' }),
      },
      inboundHandler: async (message) => {
        received.push(message.text)
      },
    })

    await callHandleInbound(service, connection, {
      externalId: 'chat-1',
      senderName: 'alice',
      text: '请转写并处理这条语音消息。',
      inboundVoice: { fileId: 'vf1', fileUniqueId: 'vu1', durationSec: 8 },
    })

    expect(received).toEqual(['[语音] 今天天气不错'])
  })

  it('本地与云端均不可用时把原因与配置指引回传远程端，不进入会话', async () => {
    const received: string[] = []
    const { service, connection, fetchMock } = await createVoiceService({
      transcriber: {
        transcribe: async () => ({
          kind: 'failed',
          message:
            '本地转写：离线识别模型（SenseVoice）未安装\n云端转写：未配置任何多媒体渠道\n\n配置指引：\n· 本地（推荐）：…\n· 云端兜底：…',
        }),
      },
      inboundHandler: async (message) => {
        received.push(message.text)
      },
    })

    await callHandleInbound(service, connection, {
      externalId: 'chat-1',
      senderName: 'alice',
      text: '请转写并处理这条语音消息。',
      inboundVoice: { fileId: 'vf1', fileUniqueId: 'vu1' },
    })

    expect(received).toEqual([])
    const sentBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(([, init]) => String(init?.body))
    expect(
      sentBodies.some((body) => body.includes('离线识别模型') && body.includes('配置指引')),
    ).toBe(true)
  })

  it('未启用传输文件能力时提示开启，不进入会话', async () => {
    const received: string[] = []
    const { service, connection, fetchMock } = await createVoiceService({
      transferFiles: false,
      inboundHandler: async (message) => {
        received.push(message.text)
      },
    })

    await callHandleInbound(service, connection, {
      externalId: 'chat-1',
      senderName: 'alice',
      text: '请转写并处理这条语音消息。',
      inboundVoice: { fileId: 'vf1' },
    })

    expect(received).toEqual([])
    const sentBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(([, init]) => String(init?.body))
    expect(sentBodies.some((body) => body.includes('传输文件'))).toBe(true)
  })
})

describe('outbound voice delivery', () => {
  it('Telegram: 音频附件走 sendAudio 投递而非留在桌面会话', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-tg-out-voice-'))
    const file = path.join(root, '静夜思-朗诵.mp3')
    await fs.writeFile(file, Buffer.from('mp3'))
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true,"result":{}}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const service = new RemoteConnectionService({
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never)
      const connection = service.createBotDraft('telegram').connection
      service.save({
        ...connection,
        credentials: { botToken: 'test-token' },
        capabilities: { ...connection.capabilities, transferFiles: true },
      })
      await service.sendReply(connection.id, '42', '语音已生成。', [
        { type: 'file', path: file },
      ])
      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(urls.some((url) => url.includes('/sendAudio'))).toBe(true)
      expect(urls.some((url) => url.includes('/sendMessage'))).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('QQ: SILK 语音走 file_type=3 富媒体上传并 msg_type=7 发送', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const { encode } = await import('silk-wasm')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-out-voice-'))
    const silk = Buffer.from((await encode(new Int16Array(480), 24_000)).data)
    const file = path.join(root, 'voice.slk')
    await fs.writeFile(file, silk)
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('getAppAccessToken'))
        return new Response('{"access_token":"token","expires_in":3600}')
      if (target.endsWith('/files')) return new Response('{"file_info":"voice-info"}')
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
      await service.sendReply(connection.id, 'qq-user:openid', '语音已生成。', [
        { type: 'file', path: file },
      ])
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        body: String(init?.body),
      }))
      const upload = calls.find((call) => call.url.endsWith('/files'))
      expect(upload).toBeDefined()
      expect(JSON.parse(upload?.body ?? '{}').file_type).toBe(3)
      // 文本（msg_type 0）与语音（msg_type 7）都会命中 /messages，须挑出语音那条
      const voiceSend = calls.find(
        (call) => call.url.endsWith('/messages') && /"msg_type":7/.test(call.body),
      )
      expect(voiceSend).toBeDefined()
      expect(JSON.parse(voiceSend?.body ?? '{}')).toMatchObject({
        msg_type: 7,
        media: { file_info: 'voice-info' },
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('QQ: 未启用传输文件时语音被拦截并返回提示', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-voice-blocked-'))
    const file = path.join(root, 'voice.mp3')
    await fs.writeFile(file, Buffer.from('mp3'))
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
      await service.sendReply(connection.id, 'qq-user:openid', '语音已生成。', [
        { type: 'file', path: file },
      ])
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        body: String(init?.body),
      }))
      expect(calls.some((call) => call.url.endsWith('/files'))).toBe(false)
      const sent = calls.find((call) => call.url.endsWith('/messages'))
      expect(JSON.parse(sent?.body ?? '{}').content).toContain('语音未发送')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('feishu inbound voice', () => {
  it('parseWebhookBody 把 audio 消息解析为带 feishuVoice 的 message', () => {
    const parsed = parseWebhookBody('feishu', {
      event: {
        message: {
          chat_id: 'oc_1',
          message_id: 'om_1',
          message_type: 'audio',
          content: '{"file_key":"file_v2_1"}',
        },
        sender: { sender_id: { open_id: 'ou_1' } },
      },
    })
    expect(parsed).toMatchObject({
      kind: 'message',
      externalId: 'oc_1',
      text: '请转写并处理这条语音消息。',
      feishuVoice: { messageId: 'om_1', fileKey: 'file_v2_1' },
    })
  })

  it('SILK 无关：飞书 OGG 语音下载转写后以 [语音] 前缀进入会话', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-in-voice-'))
    const OGG_BYTES = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)])
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = String(url)
      if (target.includes('tenant_access_token/internal'))
        return new Response('{"tenant_access_token":"t-1","expire":3600}')
      if (target.includes('/resources/')) return new Response(OGG_BYTES)
      return new Response('{"code":0}')
    })
    vi.stubGlobal('fetch', fetchMock)
    const received: string[] = []
    const service = new RemoteConnectionService(
      {
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never,
      attachmentRoot,
      {
        transcribe: async () => ({ kind: 'ok', text: '飞书语音内容', engine: 'local' }),
      },
    )
    const connection = service.createBotDraft('feishu').connection
    service.save({
      ...connection,
      enabled: true,
      allowedChatIds: ['oc_1'],
      credentials: { appId: 'app', appSecret: 'secret' },
      capabilities: { ...connection.capabilities, transferFiles: true },
    })
    ;(
      service as unknown as {
        inboundHandler: (message: { text: string }) => Promise<void>
      }
    ).inboundHandler = async (message) => {
      received.push(message.text)
    }

    await (
      service as unknown as {
        handleInboundMessage: (
          this: RemoteConnectionService,
          connection: RemoteConnectionConfig,
          message: Record<string, unknown>,
        ) => Promise<void>
      }
    ).handleInboundMessage.call(service, connection, {
      externalId: 'oc_1',
      senderName: 'ou_1',
      text: '请转写并处理这条语音消息。',
      feishuVoice: { messageId: 'om_1', fileKey: 'file_v2_1' },
    })

    expect(received).toEqual(['[语音] 飞书语音内容'])
    await fs.rm(attachmentRoot, { recursive: true, force: true })
  })
})

describe('qq inbound voice', () => {
  it('parseWebhookBody 把群语音事件解析为带 qqVoice 的 message', () => {
    const parsed = parseWebhookBody('qq', {
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'msg-1',
        group_openid: 'g1',
        author: { member_openid: 'm1' },
        content: '',
        attachments: [
          {
            url: 'https://groupteam.cdn.qq.com/v1/slkd',
            content_type: 'audio',
            filename: 'voice.slk',
            size: 2048,
          },
        ],
      },
    })
    expect(parsed).toMatchObject({
      kind: 'message',
      externalId: 'qq-group:g1',
      text: '请转写并处理这条语音消息。',
      qqVoice: { url: 'https://groupteam.cdn.qq.com/v1/slkd', filename: 'voice.slk' },
    })
  })

  it('SILK 语音解码转写后以 [语音] 前缀进入会话', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const { encode } = await import('silk-wasm')
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-in-voice-'))
    // QQ 变体：0x02 前缀 + #!SILK
    const silk = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from((await encode(new Int16Array(480), 24_000)).data),
    ])
    let stored: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(silk))
    vi.stubGlobal('fetch', fetchMock)
    const received: string[] = []
    const service = new RemoteConnectionService(
      {
        get: () => stored,
        set: (_c: string, _k: string, v: unknown) => {
          stored = v
        },
      } as never,
      attachmentRoot,
      {
        transcribe: async () => ({ kind: 'ok', text: 'QQ 语音内容', engine: 'local' }),
      },
    )
    const connection = service.createBotDraft('qq').connection
    service.save({
      ...connection,
      enabled: true,
      allowedChatIds: ['qq-group:g1'],
      credentials: { qqBotAppId: 'app', qqBotSecret: 'secret' },
      capabilities: { ...connection.capabilities, transferFiles: true },
    })
    ;(
      service as unknown as {
        inboundHandler: (message: { text: string }) => Promise<void>
      }
    ).inboundHandler = async (message) => {
      received.push(message.text)
    }

    await (
      service as unknown as {
        handleInboundMessage: (
          this: RemoteConnectionService,
          connection: RemoteConnectionConfig,
          message: Record<string, unknown>,
        ) => Promise<void>
      }
    ).handleInboundMessage.call(service, connection, {
      externalId: 'qq-group:g1',
      senderName: 'm1',
      text: '请转写并处理这条语音消息。',
      qqVoice: { url: 'https://groupteam.cdn.qq.com/v1/slkd', filename: 'voice.slk' },
    })

    expect(received).toEqual(['[语音] QQ 语音内容'])
    await fs.rm(attachmentRoot, { recursive: true, force: true })
  })
})

describe('turn feedback draft', () => {
  it('getTurnFeedbackDraft 返回流式积累的草稿，未开始或空草稿返回 null', async () => {
    vi.useFakeTimers()
    let stored: unknown = null
    const settings = {
      get: () => stored,
      set: (_category: string, _key: string, value: unknown) => {
        stored = value
      },
    }
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{"ok":true,"result":{"message_id":9}}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new RemoteConnectionService(settings as never)
    const connection = service.createBotDraft('telegram').connection
    service.save({ ...connection, credentials: { botToken: 'test-token' } })

    expect(service.getTurnFeedbackDraft('turn-x')).toBeNull()
    service.startTurnFeedback('turn-x', connection.id, '42')
    service.updateTurnFeedback('turn-x', { content: '部分回答', mode: 'delta', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(1_100)
    expect(service.getTurnFeedbackDraft('turn-x')).toBe('部分回答')
    await service.finishTurnFeedback('turn-x')
    expect(service.getTurnFeedbackDraft('turn-x')).toBeNull()
  })
})
