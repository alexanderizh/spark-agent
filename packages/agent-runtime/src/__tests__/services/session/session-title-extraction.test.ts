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
 *   （首条可见用户消息 + 首条 assistant 回复、隐藏消息跳过、displayContent 优先）。
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
  userMessageVisibility?: 'hidden'
  userMessageDisplayContent?: string
}): AgentEvent {
  return {
    id: `evt-u-${overrides.seq}`,
    type: 'user_message',
    sessionId: SESSION_ID,
    turnId: `turn-${overrides.seq}`,
    timestamp: new Date(2026, 0, 1, overrides.seq).toISOString(),
    seq: overrides.seq,
    content: overrides.content,
    ...(overrides.userMessageVisibility != null
      ? { userMessageVisibility: overrides.userMessageVisibility }
      : {}),
    ...(overrides.userMessageDisplayContent != null
      ? { userMessageDisplayContent: overrides.userMessageDisplayContent }
      : {}),
  } as AgentEvent
}

function assistantEvent(seq: number, content: string): AgentEvent {
  return {
    id: `evt-a-${seq}`,
    type: 'assistant_message',
    sessionId: SESSION_ID,
    turnId: `turn-${seq}`,
    timestamp: new Date(2026, 0, 1, seq).toISOString(),
    seq,
    mode: 'complete',
    content,
    provider: 'claude',
    isFinal: true,
  } as AgentEvent
}

describe('pickTitleSourceFromDialogueEvents', () => {
  it('取首条可见用户消息 + 首条 assistant 回复', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({ seq: 0, content: '帮我优化首页布局' }),
      assistantEvent(1, '好的，我来分析当前布局。'),
      userEvent({ seq: 2, content: '第二个问题' }),
      assistantEvent(3, '第二条回复'),
    ])
    expect(source).toEqual({
      userMessage: '帮我优化首页布局',
      assistantMessage: '好的，我来分析当前布局。',
    })
  })

  it('隐藏消息（定时任务/command follow-up）不作为标题来源', () => {
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
      userMessage: '用户真正的第一条消息',
      assistantMessage: '定时任务执行完成',
    })
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
    expect(source?.userMessage).toBe('面向用户的展示正文')
  })

  it('没有可见用户消息时返回 null', () => {
    const source = pickTitleSourceFromDialogueEvents([
      userEvent({ seq: 0, content: '内部指令', userMessageVisibility: 'hidden' }),
      assistantEvent(1, '回复'),
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
    expect(call.userMessage).toBe('帮我把导出功能加上进度条')
    expect(call.assistantMessage).toBe('已为导出流程补充进度反馈。')
    expect(call.apiKey).toBe('test-api-key')
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
