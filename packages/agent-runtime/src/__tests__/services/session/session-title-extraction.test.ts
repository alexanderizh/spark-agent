import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  EventRepository,
  ProviderProfileRepository,
  SessionRepository,
  SparkDatabase,
} from '@spark/storage'

/**
 * 重命名弹窗「提取标题」测试（session:extract-title）：
 *
 * - 纯函数 pickTitleSourceFromDialogueEvents：标题素材选取规则
 *   （按轮次均匀取样、隐藏轮次安全展示正文、displayContent 优先、assistant-only 回退）。
 * - extractSessionTitle 集成：模型解析链（会话模型 → Provider 默认模型）、
 *   不可用码映射。
 */

const generateTitleMock = vi.hoisted(() => vi.fn())
const keystoreGetSecret = vi.hoisted(() => vi.fn(async () => 'test-api-key'))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: keystoreGetSecret,
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('../../../services/session-title-generator.js', () => ({
  generateSessionTitle: generateTitleMock,
}))

import {
  extractSessionTitle,
  pickTitleSourceFromDialogueEvents,
} from '../../../services/session/session-title-extraction.js'
import type { AgentEvent } from '@spark/protocol'

const SESSION_ID = 'sess-extract-title'

function userEvent(overrides: {
  seq: number
  content: string
  turnId?: string
  turnSource?: 'scheduled_task' | 'command_follow_up'
  userMessageVisibility?: 'hidden'
  userMessageDisplayContent?: string
}): AgentEvent {
  return {
    id: `evt-u-${overrides.seq}`,
    type: 'user_message',
    sessionId: SESSION_ID,
    turnId: overrides.turnId ?? `turn-${overrides.seq}`,
    timestamp: new Date(2026, 0, 1, overrides.seq).toISOString(),
    seq: overrides.seq,
    content: overrides.content,
    ...(overrides.turnSource != null ? { turnSource: overrides.turnSource } : {}),
    ...(overrides.userMessageVisibility != null
      ? { userMessageVisibility: overrides.userMessageVisibility }
      : {}),
    ...(overrides.userMessageDisplayContent != null
      ? { userMessageDisplayContent: overrides.userMessageDisplayContent }
      : {}),
  } as AgentEvent
}

function assistantEvent(
  seq: number,
  content: string,
  turnId = `turn-${Math.max(0, seq - 1)}`,
): AgentEvent {
  return {
    id: `evt-a-${seq}`,
    type: 'assistant_message',
    sessionId: SESSION_ID,
    turnId,
    timestamp: new Date(2026, 0, 1, seq).toISOString(),
    seq,
    mode: 'complete',
    content,
    provider: 'claude',
    isFinal: true,
  } as AgentEvent
}

describe('pickTitleSourceFromDialogueEvents', () => {
  it('按时间均匀取多轮可见用户消息和对应 assistant 回复', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({ seq: 0, content: '第一轮问题' }),
      assistantEvent(1, '第一轮回复'),
      userEvent({ seq: 2, content: '第二轮问题' }),
      assistantEvent(3, '第二轮回复'),
      userEvent({ seq: 4, content: '第三轮问题' }),
      assistantEvent(5, '第三轮回复'),
      userEvent({ seq: 6, content: '第四轮问题' }),
      assistantEvent(7, '第四轮回复'),
      userEvent({ seq: 8, content: '第五轮问题' }),
      assistantEvent(9, '第五轮回复'),
    ])
    expect(source).toEqual({
      userMessage:
        '[第1轮用户]\n第一轮问题\n\n[第2轮用户]\n第二轮问题\n\n[第4轮用户]\n第四轮问题\n\n[第5轮用户]\n第五轮问题',
      assistantMessage:
        '[第1轮助手]\n第一轮回复\n\n[第2轮助手]\n第二轮回复\n\n[第4轮助手]\n第四轮回复\n\n[第5轮助手]\n第五轮回复',
    })
  })

  it('隐藏轮次（定时任务/command follow-up）及其 assistant 回复整体跳过', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '[Scheduled Task Context] 内部指令',
        userMessageVisibility: 'hidden',
      }),
      assistantEvent(1, '定时任务执行完成'),
      userEvent({ seq: 2, content: '用户真正的第一条消息' }),
      assistantEvent(3, '后续回复'),
    ])
    expect(source).toEqual({
      userMessage: '[第1轮用户]\n用户真正的第一条消息',
      assistantMessage: '[第1轮助手]\n后续回复',
    })
  })

  it('定时任务隐藏轮次使用安全展示正文，并保留同轮 assistant 回复', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '[Scheduled Task Context] 包含内部调度信息的完整提示词',
        turnSource: 'scheduled_task',
        userMessageVisibility: 'hidden',
        userMessageDisplayContent: '每小时推送两道高级前端面试题',
      }),
      assistantEvent(1, '已生成本期 React 与浏览器方向面试题'),
    ])

    expect(source).toEqual({
      userMessage: '[第1轮用户]\n每小时推送两道高级前端面试题',
      assistantMessage: '[第1轮助手]\n已生成本期 React 与浏览器方向面试题',
    })
    expect(source?.userMessage).not.toContain('内部调度信息')
  })

  it('隐藏轮次的安全展示正文为空时不回退到内部提示词', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '[Scheduled Task Context] 不能进入标题素材',
        turnSource: 'scheduled_task',
        userMessageVisibility: 'hidden',
        userMessageDisplayContent: '   ',
      }),
      assistantEvent(1, '同轮回复也应被排除'),
    ])

    expect(source).toBeNull()
  })

  it('非定时任务的隐藏轮次即使带展示正文也不参与标题提取', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '命令内部提示词',
        turnSource: 'command_follow_up',
        userMessageVisibility: 'hidden',
        userMessageDisplayContent: '不应参与提取的命令摘要',
      }),
      assistantEvent(1, '同轮回复也应被排除'),
    ])

    expect(source).toBeNull()
  })

  it('优先使用 userMessageDisplayContent 作为用户消息正文', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '原始长文本被包装后的模型输入',
        userMessageDisplayContent: '面向用户的展示正文',
      }),
      assistantEvent(1, '回复'),
    ])
    expect(source?.userMessage).toBe('[第1轮用户]\n面向用户的展示正文')
  })

  it('旧版远程会话提取标题时不采样内置提示词', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content:
          '【远程 Telegram 会话】当前回复会直接发送回 Telegram。若生成截图、图片或其他文件，请调用 mcp__spark_files__present_files 提交真实文件；不要只在文字里说“已发送/见上方”。\n\n浏览器截图发给我',
      }),
    ])
    expect(source?.userMessage).toBe('[第1轮用户]\n浏览器截图发给我')
  })

  it('展示正文为空时回退到原始用户消息', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({
        seq: 0,
        content: '原始用户消息',
        userMessageDisplayContent: '   ',
      }),
    ])
    expect(source?.userMessage).toBe('[第1轮用户]\n原始用户消息')
  })

  it('没有 user_message 时使用可见 turn_prompt_snapshot 作为用户正文', () => {
    const source = pickTitleSourceFromDialogueEvents([
      {
        id: 'evt-snapshot',
        type: 'turn_prompt_snapshot',
        sessionId: SESSION_ID,
        turnId: 'snapshot-turn',
        timestamp: new Date(2026, 0, 1, 0).toISOString(),
        seq: 0,
        userMessage: '模型实际收到的用户正文',
        systemPromptSections: [],
        model: 'gpt-test',
        adapterKind: 'spark',
        permissionMode: 'auto',
        toolCount: 0,
      },
      assistantEvent(1, '回复', 'snapshot-turn'),
    ] as AgentEvent[])
    expect(source).toEqual({
      userMessage: '[第1轮用户]\n模型实际收到的用户正文',
      assistantMessage: '[第1轮助手]\n回复',
    })
  })

  it('只有隐藏 turn_prompt_snapshot 时使用安全展示正文', () => {
    const source = pickTitleSourceFromDialogueEvents([
      {
        id: 'evt-scheduled-snapshot',
        type: 'turn_prompt_snapshot',
        sessionId: SESSION_ID,
        turnId: 'scheduled-snapshot-turn',
        timestamp: new Date(2026, 0, 1, 0).toISOString(),
        seq: 0,
        userMessage: '[Scheduled Task Context] 内部提示词',
        userMessageVisibility: 'hidden',
        userMessageDisplayContent: '检查部署状态并汇报',
        turnSource: 'scheduled_task',
        systemPromptSections: [],
        model: 'gpt-test',
        adapterKind: 'spark',
        permissionMode: 'auto',
        toolCount: 0,
      },
      assistantEvent(1, '部署状态正常', 'scheduled-snapshot-turn'),
    ] as AgentEvent[])

    expect(source).toEqual({
      userMessage: '[第1轮用户]\n检查部署状态并汇报',
      assistantMessage: '[第1轮助手]\n部署状态正常',
    })
  })

  it('没有可见用户消息时回退到 assistant 正文', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({ seq: 0, content: '内部指令', userMessageVisibility: 'hidden' }),
      assistantEvent(1, '回复', 'assistant-only'),
    ])
    expect(source).toEqual({
      userMessage: '[第1轮助手]\n回复',
      assistantMessage: '',
    })
  })

  it('没有任何可见正文时返回 null', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({ seq: 0, content: '内部指令', userMessageVisibility: 'hidden' }),
    ])
    expect(source).toBeNull()
  })
})

describe('extractSessionTitle', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    generateTitleMock.mockReset()
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-session-extract-title-'))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      /* db already closed */
    }
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* Windows 句柄延迟释放时的残留目录交给系统临时区清理 */
    }
  })

  function seedSession(params: { providerProfileId?: string; modelId?: string }): void {
    new SessionRepository(db).create({
      id: SESSION_ID,
      kind: 'chat',
      title: '新会话',
      status: 'idle',
      projectId: '',
      ...(params.providerProfileId != null ? { providerProfileId: params.providerProfileId } : {}),
      ...(params.modelId != null ? { modelId: params.modelId } : {}),
    })
  }

  function seedDialogue(): void {
    const eventRepo = new EventRepository(db)
    eventRepo.insert({
      id: 'evt-1',
      sessionId: SESSION_ID,
      turnId: 'turn-1',
      eventType: 'user_message',
      eventJson: JSON.stringify(userEvent({ seq: 1, content: '帮我把导出功能加上进度条' })),
    })
    eventRepo.insert({
      id: 'evt-2',
      sessionId: SESSION_ID,
      turnId: 'turn-1',
      eventType: 'assistant_message',
      eventJson: JSON.stringify(assistantEvent(2, '已为导出流程补充进度反馈。')),
    })
  }

  it('用会话模型提取标题并返回', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-extract',
      providerType: 'openai',
      name: 'Extract Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-extract',
    })
    seedSession({ providerProfileId: 'provider-extract', modelId: 'gpt-session' })
    seedDialogue()
    generateTitleMock.mockResolvedValue('导出进度条优化')

    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })

    expect(result).toEqual({ ok: true, title: '导出进度条优化' })
    expect(generateTitleMock).toHaveBeenCalledTimes(1)
    const call = generateTitleMock.mock.calls[0]?.[0] as {
      model?: string
      userMessage?: string
      assistantMessage?: string
      apiKey?: string
    }
    expect(call.model).toBe('gpt-session')
    expect(call.userMessage).toBe('[第1轮用户]\n帮我把导出功能加上进度条')
    expect(call.assistantMessage).toBe('[第1轮助手]\n已为导出流程补充进度反馈。')
    expect(call.apiKey).toBe('test-api-key')
  })

  it('从持久化的定时任务隐藏轮次提取安全展示正文', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-extract',
      providerType: 'openai',
      name: 'Extract Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-extract',
    })
    seedSession({ providerProfileId: 'provider-extract', modelId: 'gpt-session' })
    const eventRepo = new EventRepository(db)
    eventRepo.insert({
      id: 'evt-scheduled-user',
      sessionId: SESSION_ID,
      turnId: 'turn-scheduled',
      eventType: 'user_message',
      eventJson: JSON.stringify(
        userEvent({
          seq: 1,
          content: '[Scheduled Task Context] 内部调度提示词',
          turnId: 'turn-scheduled',
          turnSource: 'scheduled_task',
          userMessageVisibility: 'hidden',
          userMessageDisplayContent: '每小时推送两道高级前端面试题',
        }),
      ),
    })
    eventRepo.insert({
      id: 'evt-scheduled-assistant',
      sessionId: SESSION_ID,
      turnId: 'turn-scheduled',
      eventType: 'assistant_message',
      eventJson: JSON.stringify(
        assistantEvent(2, '本期涵盖 React Fiber 与浏览器事件循环', 'turn-scheduled'),
      ),
    })
    generateTitleMock.mockResolvedValue('高级前端面试题学习')

    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })

    expect(result).toEqual({ ok: true, title: '高级前端面试题学习' })
    const call = generateTitleMock.mock.calls[0]?.[0] as {
      userMessage?: string
      assistantMessage?: string
    }
    expect(call.userMessage).toBe('[第1轮用户]\n每小时推送两道高级前端面试题')
    expect(call.userMessage).not.toContain('内部调度提示词')
    expect(call.assistantMessage).toBe('[第1轮助手]\n本期涵盖 React Fiber 与浏览器事件循环')
  })

  it('会话未指定模型时回退 Provider 默认模型', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-extract',
      providerType: 'openai',
      name: 'Extract Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-extract',
    })
    seedSession({ providerProfileId: 'provider-extract' })
    seedDialogue()
    generateTitleMock.mockResolvedValue('默认模型标题')

    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })

    expect(result).toEqual({ ok: true, title: '默认模型标题' })
    expect((generateTitleMock.mock.calls[0]?.[0] as { model?: string }).model).toBe('gpt-default')
  })

  it('会话不存在时返回 session_not_found', async () => {
    const result = await extractSessionTitle({ db, sessionId: 'sess-missing' })
    expect(result).toEqual({ ok: false, code: 'session_not_found' })
  })

  it('会话未配置 Provider 时返回 provider_missing', async () => {
    seedSession({})
    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })
    expect(result).toEqual({ ok: false, code: 'provider_missing' })
  })

  it('本地 CLI Provider（无 keystore_ref）返回 provider_no_api_key', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-local-cli',
      providerType: 'anthropic',
      name: 'Local CLI Provider',
      config: { defaultModel: 'claude-sonnet-5', modelIds: ['claude-sonnet-5'] },
      keystoreRef: '',
    })
    seedSession({ providerProfileId: 'provider-local-cli', modelId: 'claude-sonnet-5' })
    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })
    expect(result).toEqual({ ok: false, code: 'provider_no_api_key' })
  })

  it('会话没有可提取对话时返回 dialogue_empty', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-extract',
      providerType: 'openai',
      name: 'Extract Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-extract',
    })
    seedSession({ providerProfileId: 'provider-extract', modelId: 'gpt-session' })
    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })
    expect(result).toEqual({ ok: false, code: 'dialogue_empty' })
  })

  it('模型返回空标题时返回 title_empty', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-extract',
      providerType: 'openai',
      name: 'Extract Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-extract',
    })
    seedSession({ providerProfileId: 'provider-extract', modelId: 'gpt-session' })
    seedDialogue()
    generateTitleMock.mockResolvedValue(null)

    const result = await extractSessionTitle({ db, sessionId: SESSION_ID })
    expect(result).toEqual({ ok: false, code: 'title_empty' })
  })
})
