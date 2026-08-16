import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ProviderProfileRepository, SessionRepository, SparkDatabase } from '@spark/storage'

/**
 * goal 会话标题精炼集成测试 —— 生产实测（0.10.10）暴露的结构性断链修复锁：
 *
 * `/goal <objective>` 走 executeCommandAsEvents，不经过 dispatchTurn 的
 * firstTurnTitleContext 捕获；renderer 用 objective 文本直接命名会话（截断规则
 * 与 deriveSessionTitle 不一致）。修复后 setGoal 内主动补挂一次精炼
 * （refineGoalSessionTitleAsync），守卫将「标题是 objective 前缀截断」视为派生态放行。
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

vi.mock('../../services/debug-log-server.service.js', () => ({
  getDebugLogServer: () => ({ start: async () => 43123 }),
}))

vi.mock('../../services/session-title-generator.js', () => ({
  generateSessionTitle: generateTitleMock,
}))

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
const { fakeEngineCalls, queueFakeEngineScript, resetFakeEngineHarness } =
  await import('../sdk/fake-engine-executor.js')

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('goal 会话标题精炼（/goal 命令路径）', () => {
  let db: SparkDatabase
  let testDir: string
  let sessionId: string
  let service: InstanceType<typeof SessionService>
  let sessionRepo: SessionRepository

  beforeEach(async () => {
    resetFakeEngineHarness()
    generateTitleMock.mockReset()
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-goal-title-'))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-goal-title',
      providerType: 'openai',
      name: 'Goal Title Provider',
      config: { defaultModel: 'gpt-5.6-luna', modelIds: ['gpt-5.6-luna'] },
      keystoreRef: 'key-goal-title',
      isDefault: true,
    })

    service = new SessionService(db, () => {})
    const created = await service.createSession({
      providerProfileId: 'provider-goal-title',
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

  const OBJECTIVE = '官网项目的首页在大屏下首屏内容区被限制得太小，需要优化布局'

  it('renderer 用 objective 截断命名后，setGoal 触发 LLM 精炼并覆盖为语义标题', async () => {
    generateTitleMock.mockResolvedValue('官网大屏布局优化')
    // 模拟 renderer 命名：objective 的前 30 字截断（无省略号，与 truncateTitle 规则不同）
    sessionRepo.updateTitle(sessionId, OBJECTIVE.slice(0, 30))
    // 契约起草 turn 的执行器剧本：一条完整 assistant 消息 + 正常终态
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: '验收契约草稿……', isFinal: true }],
      terminalStatus: 'completed',
    })

    await service.setGoal({ sessionId, objective: OBJECTIVE, mode: 'spark-loop' })

    await waitUntil(
      () => sessionRepo.get(sessionId)?.title === '官网大屏布局优化',
      5000,
      'goal session title refinement',
    )
    expect(generateTitleMock).toHaveBeenCalledTimes(1)
    const call = generateTitleMock.mock.calls[0]?.[0] as { userMessage?: string; model?: string }
    expect(call.userMessage).toBe(OBJECTIVE)
    expect(call.model).toBe('gpt-5.6-luna')
  })

  it('标题已被用户手动改名时，setGoal 的精炼被守卫拦截、不覆盖', async () => {
    generateTitleMock.mockResolvedValue('不应出现的标题')
    sessionRepo.updateTitle(sessionId, '我手动改的名字')
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: '验收契约草稿……', isFinal: true }],
      terminalStatus: 'completed',
    })

    await service.setGoal({ sessionId, objective: OBJECTIVE, mode: 'spark-loop' })
    // 精炼是 fire-and-forget：给足窗口后断言标题未被改写
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(sessionRepo.get(sessionId)?.title).toBe('我手动改的名字')
  })

  it('apiKey 解析为空（local CLI / 托管密钥缺失场景）时静默跳过精炼', async () => {
    // 覆盖 refineGoalSessionTitleAsync 的防御分支：resolveProviderApiKey 返回空
    // （典型为 local CLI provider 或托管密钥恢复失败）时不发起精炼、不影响主流程
    keystoreGetSecret.mockResolvedValueOnce('')
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: '验收契约草稿……', isFinal: true }],
      terminalStatus: 'completed',
    })

    await service.setGoal({ sessionId, objective: OBJECTIVE, mode: 'spark-loop' })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(generateTitleMock).not.toHaveBeenCalled()
  })

  it('preserves /goal command attachments and passes them to the contract draft turn', async () => {
    const attachmentPath = path.join(testDir, 'goal-reference.txt')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(attachmentPath, 'reference')
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'draft contract', isFinal: true }],
      terminalStatus: 'completed',
    })

    const result = await service.executeCommandAsEvents({
      sessionId,
      message: '/goal use the attached reference',
      attachments: [{ type: 'file', path: attachmentPath }],
    })

    expect(result.isCommand).toBe(true)
    await waitUntil(() => fakeEngineCalls().length > 0, 5000, 'goal contract draft turn')

    const calls = fakeEngineCalls()
    expect(calls[0]?.config.attachments).toEqual([
      expect.objectContaining({ type: 'file', path: attachmentPath }),
    ])
    const history = await service.getHistory({ sessionId, limit: 20 })
    const commandUserMessage = history.events.find(
      (event) =>
        event.type === 'user_message' && event.content === '/goal use the attached reference',
    )
    expect(commandUserMessage).toEqual(
      expect.objectContaining({
        attachments: [{ type: 'file', path: attachmentPath }],
      }),
    )
  })
})
