import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ProviderProfileRepository, SessionRepository, SparkDatabase } from '@spark/storage'

/**
 * 命令会话首轮标题精炼的智能路由支持（2026-09-29）。
 *
 * 既有 skill-command-title-refinement.test.ts 覆盖完整命令链路（需拉起 SDK 栈），
 * 本文件只锁「模型解析链」这一改动点：router 会话（无可直连凭据、model_id 为空）
 * 必须从 router 配置挑到标题模型并完成精炼，普通渠道行为不变。
 */

const generateTitleMock = vi.hoisted(() => vi.fn())

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-api-key'),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('../../../services/session-title-generator.js', () => ({
  generateSessionTitle: generateTitleMock,
}))

import { initializeCommandSessionTitle } from '../../../services/session/session-command-title-refinement.js'

const SESSION_ID = 'sess-command-title-router'

describe('initializeCommandSessionTitle · 模型解析链', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    generateTitleMock.mockReset()
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-command-title-router-'))
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

  function seedRouter(): void {
    new ProviderProfileRepository(db).create({
      id: 'router-main',
      providerType: 'auto-router',
      name: 'Main Router',
      config: {
        kind: 'auto-router',
        version: 1,
        adapter: 'codex',
        dispatcher: { providerProfileId: 'provider-dispatcher', modelId: 'dispatcher-model' },
        executors: [
          {
            id: 'e-balanced',
            providerProfileId: 'provider-balanced',
            modelId: 'balanced-model',
            intensity: 'balanced',
            enabled: true,
          },
        ],
        fallbackIntensity: 'balanced',
      },
      keystoreRef: '',
    })
    new ProviderProfileRepository(db).create({
      id: 'provider-dispatcher',
      providerType: 'openai',
      name: 'Dispatcher Provider',
      config: { defaultModel: 'dispatcher-default', modelIds: [] },
      keystoreRef: 'key-dispatcher',
    })
    new ProviderProfileRepository(db).create({
      id: 'provider-balanced',
      providerType: 'openai',
      name: 'Balanced Provider',
      config: { defaultModel: 'balanced-default', modelIds: [] },
      keystoreRef: 'key-balanced',
    })
  }

  it('智能路由会话用分流器模型完成标题精炼', async () => {
    seedRouter()
    // router 会话 model_id 按协议恒为空串。
    seedSession({ providerProfileId: 'router-main', modelId: '' })
    generateTitleMock.mockResolvedValue('导出进度条优化')
    const renamed = vi.fn()

    initializeCommandSessionTitle({
      db,
      sessionId: SESSION_ID,
      userMessage: '帮我把导出功能加上进度条，要有百分比和剩余时间',
      onSessionRenamed: renamed,
    })
    // 即时派生标题同步落库，精炼是异步的：等微任务链走完再断言。
    await vi.waitFor(() => expect(generateTitleMock).toHaveBeenCalledTimes(1))

    const call = generateTitleMock.mock.calls[0]?.[0] as {
      model?: string
      providerType?: string
      userMessage?: string
    }
    expect(call.model).toBe('dispatcher-model')
    expect(call.providerType).toBe('openai')
    expect(call.userMessage).toBe('帮我把导出功能加上进度条，要有百分比和剩余时间')
    await vi.waitFor(() =>
      expect(new SessionRepository(db).get(SESSION_ID)?.title).toBe('导出进度条优化'),
    )
    expect(renamed).toHaveBeenCalledWith(SESSION_ID, '导出进度条优化')
  })

  it('普通渠道仍按会话模型 → Provider 默认模型解析', async () => {
    new ProviderProfileRepository(db).create({
      id: 'provider-openai',
      providerType: 'openai',
      name: 'OpenAI Provider',
      config: { defaultModel: 'gpt-default', modelIds: ['gpt-default'] },
      keystoreRef: 'key-openai',
    })
    seedSession({ providerProfileId: 'provider-openai', modelId: 'gpt-session' })
    generateTitleMock.mockResolvedValue('导出功能优化')

    initializeCommandSessionTitle({
      db,
      sessionId: SESSION_ID,
      userMessage: '帮我把导出功能加上进度条',
    })
    await vi.waitFor(() => expect(generateTitleMock).toHaveBeenCalledTimes(1))

    expect((generateTitleMock.mock.calls[0]?.[0] as { model?: string }).model).toBe('gpt-session')
  })

  it('智能路由无可用候选时静默保留本地派生标题', async () => {
    new ProviderProfileRepository(db).create({
      id: 'router-main',
      providerType: 'auto-router',
      name: 'Broken Router',
      config: {
        kind: 'auto-router',
        version: 1,
        adapter: 'codex',
        dispatcher: { providerProfileId: 'provider-gone', modelId: 'dispatcher-model' },
        executors: [],
        fallbackIntensity: 'balanced',
      },
      keystoreRef: '',
    })
    seedSession({ providerProfileId: 'router-main', modelId: '' })

    initializeCommandSessionTitle({
      db,
      sessionId: SESSION_ID,
      userMessage: '帮我把导出功能加上进度条，要有百分比和剩余时间',
    })
    // 22 字符 < SESSION_TITLE_MAX_LENGTH(40)：本地派生标题就是原文，不被截断。
    await vi.waitFor(() =>
      expect(new SessionRepository(db).get(SESSION_ID)?.title).toBe(
        '帮我把导出功能加上进度条，要有百分比和剩余时间',
      ),
    )
    expect(generateTitleMock).not.toHaveBeenCalled()
  })
})
