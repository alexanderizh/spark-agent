import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ProviderProfileRepository,
  SessionRepository,
  SkillRepository,
  SparkDatabase,
} from '@spark/storage'

const generateTitleMock = vi.hoisted(() => vi.fn())
const keystoreGetSecret = vi.hoisted(() => vi.fn(async () => 'test-api-key'))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: keystoreGetSecret,
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('../../services/debug-log-server.service.js', () => ({
  getDebugLogServer: () => ({ start: async () => 43123 }),
}))

vi.mock('../../services/session-title-generator.js', () => ({
  generateSessionTitle: generateTitleMock,
}))

vi.mock('../../sdk/codex-app-server/codex-app-server-runtime.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../sdk/codex-app-server/codex-app-server-runtime.js')>()
  return { ...actual, isPersistentCodexRuntimeEnabled: () => false }
})

vi.mock('../../sdk/index.js', async () => {
  const { FakeEngineExecutor } = await import('../sdk/fake-engine-executor.js')
  return {
    isSDKAvailable: vi.fn(async () => true),
    loadSdkMcpFactory: vi.fn(async () => ({
      createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
        type: 'sdk',
        name: opts.name,
        instance: { tools: opts.tools },
      }),
      tool: (name: string) => ({ name, handler: () => {} }),
    })),
    getResumeCircuitBreaker: vi.fn(() => ({
      recordSuccess: () => {},
      recordFailure: () => {},
      shouldSkipResume: () => false,
    })),
    ClaudeSDKExecutor: FakeEngineExecutor,
    CodexSdkExecutor: FakeEngineExecutor,
    CodexCliExecutor: FakeEngineExecutor,
    CodexOpenAIExecutor: FakeEngineExecutor,
    CodexAppServerExecutor: FakeEngineExecutor,
  }
})

const { SessionService } = await import('../../services/session.service.js')
const { queueFakeEngineScript, resetFakeEngineHarness } =
  await import('../sdk/fake-engine-executor.js')

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('首条 Skill 命令的会话标题精炼', () => {
  let db: SparkDatabase
  let testDir: string
  let sessionId: string
  let service: InstanceType<typeof SessionService>
  let sessionRepo: SessionRepository

  beforeEach(async () => {
    resetFakeEngineHarness()
    generateTitleMock.mockReset()
    keystoreGetSecret.mockReset()
    keystoreGetSecret.mockResolvedValue('test-api-key')
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-skill-command-title-'))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-skill-title',
      providerType: 'openai',
      name: 'Skill Title Provider',
      config: { defaultModel: 'gpt-5.6-luna', modelIds: ['gpt-5.6-luna'] },
      keystoreRef: 'key-skill-title',
      isDefault: true,
    })
    new SkillRepository(db).create({
      id: 'local:linked:imagegen-test',
      scope: 'user',
      name: 'codex-cli-imagegen',
      version: '1.0.0',
      rootPath: testDir,
      manifestJson: JSON.stringify({
        description: '通过 Codex CLI 生成或编辑图片',
        systemPrompt: 'Use image generation for the requested task.',
        tags: ['image'],
      }),
    })

    service = new SessionService(db, () => {})
    const created = await service.createSession({
      providerProfileId: 'provider-skill-title',
      modelId: 'gpt-5.6-luna',
      agentAdapter: 'codex',
    })
    sessionId = created.sessionId
    sessionRepo = new SessionRepository(db)
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

  it('先按任务正文即时命名，再用当前 Provider 异步精炼', async () => {
    let resolveGeneratedTitle: ((title: string) => void) | undefined
    generateTitleMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveGeneratedTitle = resolve
        }),
    )
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: '已生成图片。', isFinal: true }],
      terminalStatus: 'completed',
    })

    const task = '将图中小猫动漫化，将新图发给我'
    const result = await service.executeCommandAsEvents({
      sessionId,
      message: `/codex-cli-imagegen ${task}`,
    })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: true })
    expect(sessionRepo.get(sessionId)?.title).toBe(task)
    await waitUntil(() => generateTitleMock.mock.calls.length === 1, 5000, 'title request')
    const call = generateTitleMock.mock.calls[0]?.[0] as { userMessage?: string }
    expect(call.userMessage).toBe(task)

    resolveGeneratedTitle?.('小猫动漫化图片生成')
    await waitUntil(
      () => sessionRepo.get(sessionId)?.title === '小猫动漫化图片生成',
      5000,
      'refined title',
    )
  })

  it('异步精炼完成前用户已手动改名时不覆盖', async () => {
    let resolveGeneratedTitle: ((title: string) => void) | undefined
    generateTitleMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveGeneratedTitle = resolve
        }),
    )
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: '处理中。', isFinal: true }],
      terminalStatus: 'completed',
    })

    await service.executeCommandAsEvents({
      sessionId,
      message: '/codex-cli-imagegen 把照片改成动漫风格',
    })
    await waitUntil(() => generateTitleMock.mock.calls.length === 1, 5000, 'title request')
    sessionRepo.updateTitle(sessionId, '我手动命名的图片任务')

    resolveGeneratedTitle?.('动漫风格照片生成')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(sessionRepo.get(sessionId)?.title).toBe('我手动命名的图片任务')
  })

  it('纯控制命令不触发标题生成', async () => {
    const result = await service.executeCommandAsEvents({ sessionId, message: '/status' })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    expect(sessionRepo.get(sessionId)?.title).toBe('新会话')
    expect(generateTitleMock).not.toHaveBeenCalled()
  })
})
