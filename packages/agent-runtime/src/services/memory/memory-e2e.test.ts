/**
 * @module memory-e2e.test
 *
 * 端到端测试剧本 — Agent 记忆系统 Phase 1 MVP
 *
 * 对应开发文档 §六 的 12 步手测剧本，适配为自动化集成测试。
 * 使用真实 SQLite + 文件系统，覆盖从写入到读取到注入的完整链路。
 *
 * 注意：本测试不依赖 LLM 调用（使用 mock），验证的是整个管线的数据流转。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, MemoryRepository, SettingsRepository } from '@spark/storage'
import { MemoryWriterService, type LLMCallFn } from './memory-writer.service.js'
import { MemoryReaderService } from './memory-reader.service.js'
import { MemoryStoreService } from './memory-store.service.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Memory System — E2E', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let settingsRepo: SettingsRepository
  let store: MemoryStoreService
  let testDir: string
  let workspaceDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-e2e-${Date.now()}`)
    workspaceDir = join(testDir, 'workspace')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(workspaceDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), '..', 'storage', 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    repo = new MemoryRepository(db)
    settingsRepo = new SettingsRepository(db)
    store = new MemoryStoreService(testDir, workspaceDir)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 构建 mock LLM 返回值：将候选数组序列化为 LLM 响应字符串 */
  function candidateResponse(items: unknown[]): string {
    return JSON.stringify(items)
  }

  /** 创建 mock LLM，支持多次不同返回 */
  function mockLLM(responses: string[]): LLMCallFn {
    let callIndex = 0
    return async () => {
      const response = responses[callIndex] ?? '[]'
      callIndex++
      return response
    }
  }

  /** 创建 writer */
  function createWriter(llm: LLMCallFn): MemoryWriterService {
    return new MemoryWriterService(
      repo,
      store,
      (cat, key) => settingsRepo.get(cat, key),
      llm,
    )
  }

  /** 创建 reader */
  function createReader(): MemoryReaderService {
    return new MemoryReaderService(
      repo,
      store,
      (cat, key) => settingsRepo.get(cat, key),
    )
  }

  // ─── Step 1~3: 首次对话产生 user 记忆 ───────────────────────────────

  describe('Step 1~3: 首次对话 → 产生 user 记忆', () => {
    it('should extract and persist user identity from first conversation', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user',
        type: 'user',
        name: 'java-engineer',
        description: '用户是 Java 工程师，对 React 不熟，偏好先讨论再动手',
        body: '用户身份：Java 工程师，对 React 不熟。\n\n**Why:** 首次提及。\n**How to apply:** 代码示例可偏 Java 风格，React 概念需解释。',
        confidence: 0.95,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-a',
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        userMessage: '我是 Java 工程师，对 React 不熟，先讨论再动手',
        assistantMessage: '了解你的背景，我会...',
        recentSummary: '',
      })

      // 验证 SQLite
      const entries = repo.listByScope('user', null)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.name).toBe('java-engineer')
      expect(entries[0]!.type).toBe('user')
      expect(entries[0]!.confidence).toBeGreaterThanOrEqual(0.9)

      // 验证文件存在
      const fileContent = await store.readFile(entries[0]!.file_path)
      expect(fileContent).toContain('Java 工程师')
      expect(fileContent).toContain('**Why:**')
    })
  })

  // ─── Step 4~5: 新会话加载已有记忆 ───────────────────────────────────

  describe('Step 4~5: 新会话加载已有记忆', () => {
    it('should inject user memory into new session system prompt', async () => {
      // 先写入一条 user 记忆
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'user', name: 'java-engineer',
        description: '用户是 Java 工程师',
        body: 'Java 工程师。\n\n**Why:** 背景记录。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-a', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'I am Java engineer', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 模拟新会话 B 加载记忆
      const reader = createReader()
      const injection = await reader.loadForSession({
        workspaceId: 'ws-2', // 不同 workspace，但 user scope 应仍可见
        agentId: 'agent-2',
      })

      expect(injection.block).toContain('# Long-term Memory')
      expect(injection.block).toContain('<user-memory>')
      expect(injection.block).toContain('java-engineer')
      expect(injection.injectedIds).toHaveLength(1)
    })
  })

  // ─── Step 6~7: 反馈写入与跨会话生效 ─────────────────────────────────

  describe('Step 6~7: 反馈写入与跨会话生效', () => {
    it('should write feedback and include it in subsequent sessions', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'feedback', name: 'no-console-log',
        description: '禁止使用 console.log，统一用 logger',
        body: '禁止使用 console.log。\n\n**Why:** 团队规范。\n**How to apply:** 用 logger 替代。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-b', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: '以后写代码不要加 console.log，统一用我们的 logger',
        assistantMessage: '好的，我会注意',
        recentSummary: '',
      })

      // Session C: 新会话应加载 feedback
      const reader = createReader()
      const injection = await reader.loadForSession({
        workspaceId: 'ws-1', agentId: 'agent-1',
      })

      expect(injection.block).toContain('no-console-log')
      expect(injection.block).toContain('feedback')
    })
  })

  // ─── Step 8: Workspace 隔离 ─────────────────────────────────────────

  describe('Step 8: Workspace 隔离', () => {
    it('should not show project memories from other workspaces', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'project', type: 'project', name: 'team-mode-plan',
        description: 'Team Mode Phase 1 进行中',
        body: 'Team Mode Phase 1。\n\n**Why:** 项目规划。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-c', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'Team Mode Phase 1 进行中', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 在 ws-2 的新会话中，project 记忆不应出现
      const reader = createReader()
      const injection = await reader.loadForSession({
        workspaceId: 'ws-2', agentId: 'agent-1',
      })

      expect(injection.block).not.toContain('team-mode-plan')
    })
  })

  // ─── Step 10: 敏感词拦截 ────────────────────────────────────────────

  describe('Step 10: 敏感词拦截', () => {
    it('should reject memory containing API key', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'reference', type: 'reference', name: 'api-key-note',
        description: 'API key',
        body: 'The key is api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-d', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'note this key', assistantMessage: 'sure',
        recentSummary: '',
      })

      expect(repo.listByScope('reference', 'ws-1')).toHaveLength(0)
    })

    it('should reject manual write with sensitive content', async () => {
      const writer = createWriter(async () => '[]')
      await expect(writer.manualWrite({
        scope: 'user', scopeRef: null, type: 'reference',
        name: 'leak', description: 'leak',
        body: 'sk-fake1234567890abcdef1234567890',
        links: [],
      })).rejects.toThrow('敏感信息')
    })
  })

  // ─── Step 10.5: 瞬时数据拦截（Gate 0）─────────────────────────────────

  describe('Step 10.5: 瞬时数据拦截', () => {
    it('should reject transient memory (ISO date in name) — 场景:查天气存了今天日期', async () => {
      // 复现真实事故：用户问"今天天气"，agent 把"今天 2026-06-16"存进记忆
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'user',
        name: 'today-2026-06-16',
        description: '用户今天 2026-06-16 查询了天气',
        body: '用户今天查询了上海天气。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-tx', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: '今天上海天气怎么样？',
        assistantMessage: '今天上海晴，25 度。',
        recentSummary: '',
      })

      // 关键断言：记忆库为空
      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should reject transient memory (实时数据 + 中文日期)', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'user',
        name: 'shanghai-weather',
        description: '当前 2026年6月16日 上海实时温度 25 度',
        body: '上海当前温度 25 度。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-tx2', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: '上海现在多少度？',
        assistantMessage: '上海现在 25 度。',
        recentSummary: '',
      })

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should not affect stable long-term memory (java engineer)', async () => {
      // 正常反馈不应被 Gate 0 误伤
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'user',
        name: 'java-engineer',
        description: '用户是 Java 工程师',
        body: '用户身份：Java 工程师。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-stable', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'I am a Java engineer',
        assistantMessage: 'Got it.',
        recentSummary: '',
      })

      expect(repo.listByScope('user', null)).toHaveLength(1)
      expect(repo.listByScope('user', null)[0]!.name).toBe('java-engineer')
    })
  })

  // ─── Step 11: 配额淘汰 ──────────────────────────────────────────────

  describe('Step 11: 配额淘汰', () => {
    it('should auto-archive when quota exceeded', async () => {
      // 设置 user quota = 3
      settingsRepo.set('memory', 'quota', { user: 3, project: 200, agent: 50 })

      // 手动写入 3 条 user 记忆
      const writer = createWriter(async () => '[]')
      for (let i = 0; i < 3; i++) {
        await writer.manualWrite({
          scope: 'user', scopeRef: null, type: 'feedback',
          name: `mem-${i}`, description: `Memory ${i}`,
          body: `Body ${i}`, links: [],
        })
      }
      expect(repo.countByScope('user', null)).toBe(3)

      // 第 4 条应触发末位归档
      const writeWithLLM = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'feedback', name: 'mem-4',
        description: 'Memory 4', body: 'Body 4', confidence: 0.9,
      }])]))

      await writeWithLLM.maybeWriteFromTurn({
        sessionId: 'sess-e', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'New feedback', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 非 archived 仍为 3
      expect(repo.countByScope('user', null)).toBe(3)
      // 总数 4（1 条 archived）
      const all = repo.listByScope('user', null, { includeArchived: true })
      expect(all).toHaveLength(4)
      const archived = all.filter((e) => e.archived === 1)
      expect(archived).toHaveLength(1)
    })
  })

  // ─── Step 12: memory.enabled = false ────────────────────────────────

  describe('Step 12: 全局关闭记忆', () => {
    it('should return empty block and skip writing when disabled', async () => {
      settingsRepo.set('memory', 'enabled', false)

      const writer = createWriter(async () => candidateResponse([{
        scope: 'user', type: 'user', name: 'should-not-exist',
        description: 'Should not exist', body: 'Body', confidence: 0.9,
      }]))

      // 写入应被跳过
      await writer.maybeWriteFromTurn({
        sessionId: 'sess-f', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'Something', assistantMessage: 'Response',
        recentSummary: '',
      })
      expect(repo.countByScope('user', null)).toBe(0)

      // 读取应返回空
      const reader = createReader()
      const injection = await reader.loadForSession({
        workspaceId: 'ws-1', agentId: 'agent-1',
      })
      expect(injection.block).toBe('')
      expect(injection.injectedIds).toHaveLength(0)
    })
  })

  // ─── Recall 工具 ────────────────────────────────────────────────────

  describe('recall_memory 工具', () => {
    it('should return full markdown body and bump hit_count', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'feedback', name: 'prefer-arco',
        description: '偏好 Arco Design',
        body: '新增 UI 组件统一用 @arco-design/web-react。\n\n**Why:** 历史包袱。\n**How to apply:** 禁止引入 @radix-ui/*。',
        confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-g', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: '用 Arco 不要用 Radix', assistantMessage: 'OK',
        recentSummary: '',
      })

      const entries = repo.listByScope('user', null)
      expect(entries).toHaveLength(1)
      const id = entries[0]!.id

      const reader = createReader()
      const result = await reader.recall(id)

      expect(result.error).toBeUndefined()
      expect(result.content).toContain('@arco-design/web-react')
      expect(result.content).toContain('**Why:**')

      // hit_count 应增加
      const after = repo.getById(id)!
      expect(after.hit_count).toBe(1)
      expect(after.last_hit_at).not.toBeNull()
    })

    it('should return error for non-existent id', async () => {
      const reader = createReader()
      const result = await reader.recall('nonexistent')
      expect(result.error).toContain('not found')
    })

    it('should return error for archived id', async () => {
      const writer = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'feedback', name: 'to-archive',
        description: 'Will be archived', body: 'Body', confidence: 0.9,
      }])]))

      await writer.maybeWriteFromTurn({
        sessionId: 'sess-h', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'Note', assistantMessage: 'OK', recentSummary: '',
      })

      const id = repo.listByScope('user', null)[0]!.id
      repo.archive(id)

      const reader = createReader()
      const result = await reader.recall(id)
      expect(result.error).toContain('archived')
    })
  })

  // ─── 三层记忆注入格式验证 ──────────────────────────────────────────

  describe('三层记忆 XML 格式', () => {
    it('should render all three layers correctly', async () => {
      // 写 user 记忆
      const writer1 = createWriter(mockLLM([candidateResponse([{
        scope: 'user', type: 'user', name: 'user-who',
        description: 'Java 工程师', body: 'Body', confidence: 0.9,
      }])]))
      await writer1.maybeWriteFromTurn({
        sessionId: 's1', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'I am Java engineer', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 写 project 记忆
      const writer2 = createWriter(mockLLM([candidateResponse([{
        scope: 'project', type: 'project', name: 'proj-status',
        description: 'Phase 1 进行中', body: 'Body', confidence: 0.9,
      }])]))
      await writer2.maybeWriteFromTurn({
        sessionId: 's2', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'Phase 1 starts', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 写 agent 记忆
      const writer3 = createWriter(mockLLM([candidateResponse([{
        scope: 'agent', type: 'feedback', name: 'agent-style',
        description: 'Agent 风格偏好', body: 'Body', confidence: 0.9,
      }])]))
      await writer3.maybeWriteFromTurn({
        sessionId: 's3', workspaceId: 'ws-1', agentId: 'agent-1',
        userMessage: 'Keep concise', assistantMessage: 'OK',
        recentSummary: '',
      })

      // 验证注入格式
      const reader = createReader()
      const injection = await reader.loadForSession({
        workspaceId: 'ws-1', agentId: 'agent-1',
      })

      expect(injection.block).toContain('<user-memory>')
      expect(injection.block).toContain('<project-memory workspace="ws-1">')
      expect(injection.block).toContain('<agent-memory>')
      expect(injection.block).toContain('recall_memory')
      expect(injection.injectedIds).toHaveLength(3)
    })
  })
})
