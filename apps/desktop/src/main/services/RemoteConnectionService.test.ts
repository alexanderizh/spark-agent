import { describe, expect, it } from 'vitest'

import {
  RemoteConnectionService,
  buildFeishuCard,
  buildTelegramBotCommands,
  parseWebhookBody,
} from './RemoteConnectionService.js'

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
})
