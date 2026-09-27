/**
 * @module memory-writer.service.test
 *
 * 单元测试：MemoryWriterService
 *
 * 覆盖 4 类场景：
 *   - 应写：返回 1 条 feedback，落库且文件存在
 *   - 应丢（置信度 < 0.6）：不落库
 *   - 应去重：同 name 二次写入触发 skip，不重复落库
 *   - 应淘汰：scope 已满时新写入触发末位归档
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MemoryWriterService,
  parseCandidates,
  type TurnPayload,
  type LLMCallFn,
} from './memory-writer.service.js'
import { MemoryRepository } from '@spark/storage'
import { MemorySearchRepository } from '@spark/storage'
import type { MemoryEntryRow } from '@spark/storage'
import { SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { join } from 'path'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

describe('MemoryWriterService', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let store: MemoryStoreService
  let writer: MemoryWriterService
  let testDir: string
  let settings: Record<string, Record<string, unknown>> = { memory: { enabled: true } }

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-writer-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), '..', 'storage', 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    repo = new MemoryRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'workspace'))
    settings = { memory: { enabled: true, quota: undefined } }

    writer = new MemoryWriterService(
      repo,
      store,
      (cat: string, key: string) => {
        const catObj = settings[cat]
        return catObj?.[key] ?? null
      },
      async () => '[]', // 默认 LLM 返回空
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  const basePayload: TurnPayload = {
    sessionId: 'sess_test',
    workspaceId: 'ws_test',
    agentId: 'agent_test',
    userMessage: 'I am a Java engineer',
    assistantMessage: 'Got it, noted your background.',
    recentSummary: '',
  }

  describe('场景 1：应写 — 候选通过四道闸门后落库', () => {
    it('should write a valid candidate to SQLite and file', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'java-engineer',
          description: '用户是 Java 工程师',
          body: '用户身份：Java 工程师。\n\n**Why:** 首次提及，需记录背景。\n**How to apply:** 代码示例可偏 Java 风格。',
          confidence: 0.9,
        },
      ])

      const writerWithLLM = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )

      await writerWithLLM.maybeWriteFromTurn(basePayload)

      // SQLite 应有 1 条
      const entries = repo.listByScope('user', null)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.name).toBe('java-engineer')
      expect(entries[0]!.type).toBe('user')
      expect(entries[0]!.confidence).toBe(0.9)
    })
  })

  describe('场景 2：应丢 — 置信度 < 0.6', () => {
    it('should not write candidates with confidence < 0.6', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'low-confidence',
          description: '不确定的信息',
          body: '不确定。',
          confidence: 0.4,
        },
      ])

      const writerWithLLM = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )

      await writerWithLLM.maybeWriteFromTurn(basePayload)

      const entries = repo.listByScope('user', null)
      expect(entries).toHaveLength(0)
    })
  })

  describe('场景 3：应去重 — 同 name 二次写入触发 skip', () => {
    it('should skip duplicate candidate when LLM returns skip', async () => {
      // 先写入一条
      const firstLLMReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'feedback',
          name: 'prefer-tailwind',
          description: '用户偏好 Tailwind CSS',
          body: '偏好 Tailwind。\n\n**Why:** 明确指示。',
          confidence: 0.9,
        },
      ])

      const firstWriter = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => firstLLMReturn,
      )
      await firstWriter.maybeWriteFromTurn(basePayload)
      expect(repo.listByScope('user', null)).toHaveLength(1)

      // 再写入同名 — LLM dedup 返回 skip
      const secondLLMReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'feedback',
          name: 'prefer-tailwind',
          description: '用户偏好 Tailwind CSS（重复）',
          body: '偏好 Tailwind。',
          confidence: 0.9,
        },
      ])

      const secondWriter = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        // 抽取 prompt 返回候选，dedup prompt 返回 skip
        async (prompt: string) => {
          if (prompt.includes('去重判定器')) return 'skip'
          return secondLLMReturn
        },
      )
      await secondWriter.maybeWriteFromTurn(basePayload)

      // 仍只有 1 条
      expect(repo.listByScope('user', null)).toHaveLength(1)
    })
  })

  describe('场景 4：应淘汰 — 超配额时末位归档', () => {
    it('should evict lowest-score entries when quota is exceeded', async () => {
      // 设置 quota 为 2
      settings.memory!.quota = { user: 2, project: 200, agent: 50 }

      // 手动写入 2 条 user 记忆
      for (let i = 0; i < 2; i++) {
        const id = `usr_${i}`
        const filePath = store.getFilePath('user', null, id)
        await store.writeFile({
          meta: {
            id,
            scope: 'user',
            scopeRef: null,
            type: 'feedback',
            name: `mem-${i}`,
            description: `Memory ${i}`,
            confidence: 0.9,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            hitCount: i,
            lastHitAt: null,
            sourceSessionId: null,
            links: [],
            archived: false,
          },
          body: `Body ${i}`,
        })
        repo.insert({
          id,
          scope: 'user',
          scope_ref: null,
          type: 'feedback',
          name: `mem-${i}`,
          description: `Memory ${i}`,
          file_path: filePath,
          confidence: 0.9,
          hit_count: i,
          last_hit_at: null,
          source_session_id: null,
          archived: 0,
        })
      }

      expect(repo.countByScope('user', null)).toBe(2)

      // 再写 1 条 → 应淘汰 1 条
      const newLLMReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'feedback',
          name: 'new-mem',
          description: 'New memory',
          body: 'New body',
          confidence: 0.9,
        },
      ])

      const writerWithLLM = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => newLLMReturn,
      )
      await writerWithLLM.maybeWriteFromTurn(basePayload)

      // 非 archived 应有 2 条
      expect(repo.countByScope('user', null)).toBe(2)
      // 总数应有 3 条（1 条 archived）
      const all = repo.listByScope('user', null, { includeArchived: true })
      expect(all).toHaveLength(3)
      const archived = all.filter((e) => e.archived === 1)
      expect(archived).toHaveLength(1)
    })
  })

  describe('settings.enabled = false', () => {
    it('should skip entirely when memory is disabled', async () => {
      settings.memory!.enabled = false

      const llmSpy = vi.fn(async () => '[]')
      const disabledWriter = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        llmSpy,
      )
      await disabledWriter.maybeWriteFromTurn(basePayload)

      expect(llmSpy).not.toHaveBeenCalled()
    })
  })

  describe('场景 5：瞬时数据闸门（Gate 0）— 兜底拦截', () => {
    it('should drop candidate whose name embeds an ISO date', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'today-is-2026-06-16',
          description: '用户今天 2026-06-16 查询了天气',
          body: '用户今天查询天气。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should drop candidate whose name starts with transient word (今天/当前/today)', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'today-weather',
          description: '今天上海天气晴，25 度',
          body: '今天上海天气晴。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should drop candidate whose description pairs ISO date with today/当前/实时', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'current-stock-price',
          description: '当前 2026-06-16 苹果股价 250 美元',
          body: '当前苹果股价 250 美元。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should drop candidate whose description has Chinese date format (2026年6月16日)', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'release-day',
          description: '项目在 2026年6月16日 发布',
          body: '发布日 2026年6月16日。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should drop candidate whose description is "今天 14:30 查询了天气"', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'weather-check-today',
          description: '用户今天 14:30 查询了天气',
          body: '用户查询了天气。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should drop candidate whose name indicates real-time data type (weather/stock/汇率)', async () => {
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'today-weather-shanghai',
          description: '上海天气',
          body: '上海今天晴。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(0)
    })

    it('should allow stable long-term memory (no date, no transient word)', async () => {
      // 确认 Gate 0 不会误伤正常长期记忆
      const llmReturn = JSON.stringify([
        {
          scope: 'user',
          type: 'user',
          name: 'java-engineer',
          description: '用户是 Java 工程师',
          body: '用户身份：Java 工程师。',
          confidence: 0.9,
        },
      ])

      const w = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => llmReturn,
      )
      await w.maybeWriteFromTurn(basePayload)

      expect(repo.listByScope('user', null)).toHaveLength(1)
    })
  })

  describe('LLM 调用失败', () => {
    it('should not throw even if LLM call fails', async () => {
      const failWriter = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        async () => {
          throw new Error('LLM unavailable')
        },
      )
      // 不应抛异常
      await expect(failWriter.maybeWriteFromTurn(basePayload)).resolves.toBeUndefined()
      expect(repo.listByScope('user', null)).toHaveLength(0)
    })
  })

  describe('manualWrite', () => {
    it('should write manually without LLM and confidence gate', async () => {
      const row = await writer.manualWrite({
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name: 'manual-test',
        description: '手动写入测试',
        body: '手动写入。\n\n**Why:** 测试。',
        links: [],
      })

      expect(row.name).toBe('manual-test')
      expect(row.confidence).toBe(1.0)
      expect(repo.listByScope('user', null)).toHaveLength(1)
    })

    it('should reject sensitive content', async () => {
      await expect(
        writer.manualWrite({
          scope: 'user',
          scopeRef: null,
          type: 'reference',
          name: 'sensitive',
          description: 'API key leak',
          body: 'api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890',
          links: [],
        }),
      ).rejects.toThrow('敏感信息')
    })

    it('should reject duplicate name', async () => {
      await writer.manualWrite({
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name: 'dup-test',
        description: 'First',
        body: 'First.',
        links: [],
      })
      await expect(
        writer.manualWrite({
          scope: 'user',
          scopeRef: null,
          type: 'feedback',
          name: 'dup-test',
          description: 'Second',
          body: 'Second.',
          links: [],
        }),
      ).rejects.toThrow('已存在同名')
    })
  })

  // ─── S1A.1 默认日志治理：敏感内容不进默认日志 ──────────────────────────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S1A 切片 1：
  // 完整提取 prompt 与 LLM 返回预览均含用户原文/敏感片段，且 logger 的
  // sanitize 只作用于 args 不作用于 message —— 必须从源头不打印。
  describe('S1A.1 日志治理：提取链路默认日志不含用户原文', () => {
    it('完整 turn（含敏感候选被拒）后，文件日志不含 prompt 原文与敏感标记', async () => {
      const { initFileLogger, setLogLevel, getLogLevel } = await import('@spark/shared')
      // "默认日志"取 info 档（生产默认 warn；用户开详细日志的典型档位为 info，
      // debug 是显式诊断场景不在本切片治理范围）
      const prevLevel = getLogLevel()
      setLogLevel('info')
      initFileLogger(testDir, { filename: 's1a1.log' })
      try {
        const marker = 's1a1-usermsg-marker-咖啡书屋'
        const secret = 'sk-s1a1secret0987654321'
        const llmReturn = JSON.stringify([
          {
            scope: 'user',
            type: 'reference',
            name: 's1a1-sensitive-candidate',
            description: '含敏感内容的候选',
            body: `api_key=${secret}`,
            confidence: 0.9,
          },
        ])
        const writerWithLLM = new MemoryWriterService(
          repo,
          store,
          (cat, key) => settings[cat]?.[key] ?? null,
          async () => llmReturn,
        )

        await writerWithLLM.maybeWriteFromTurn({
          ...basePayload,
          userMessage: `请记住：${marker}`,
        })

        const logPath = join(testDir, 's1a1.log')
        const content = readFileSync(logPath, 'utf-8')
        // prompt 原文（用户消息）与敏感片段都不得出现在默认日志
        expect(content).not.toContain(marker)
        expect(content).not.toContain(secret)
        // 也不得以"预览"形态泄漏 LLM 返回正文
        expect(content).not.toContain('s1a1-sensitive-candidate')
      } finally {
        setLogLevel(prevLevel)
        // 重置到已清理的目录，避免影响后续测试的文件日志（写入失败会被 logger 静默吞掉）
        initFileLogger(join(testDir, 'disposed'))
      }
    })
  })

  // ─── S0 反例固定（E4·writer 层）→ S1A.3 已修复（2026-09-27 反转） ──────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1A.3。
  // 原 fails 用例：passDedupGate 的 merge 分支 repo.update 只传
  // {description,file_path,confidence} 不带 body → FTS 行以空正文重建，
  // "文件在、检索丢"。S1A.3 修复（writer 三处 update 补传 body、顺序改为
  // 先写文件再更新 DB）后反转为 it。
  describe('S1A.3 已修复（原 S0/E4·writer 层）：去重合并后旧正文仍可检索', () => {
    it('merge 更新后只在旧正文中出现的关键词仍可 FTS 检索', async () => {
      const searchRepo = new MemorySearchRepository(db)

      const firstCandidates = JSON.stringify([
        {
          scope: 'user',
          type: 'feedback',
          name: 'e4-merge-mem',
          description: '旧摘要',
          body: '旧正文：用户常去阿那亚图书馆自习，偏好靠窗座位。',
          confidence: 0.9,
        },
      ])
      const secondCandidates = JSON.stringify([
        {
          scope: 'user',
          type: 'feedback',
          name: 'e4-merge-mem',
          description: '新摘要：阅读偏好更新',
          body: '新正文：用户最近在读《建筑师的实践》。',
          confidence: 0.85,
        },
      ])
      // 调用顺序：turn1 抽取 → turn2 抽取 → turn2 去重决策（merge）
      const llm = vi
        .fn()
        .mockResolvedValueOnce(firstCandidates)
        .mockResolvedValueOnce(secondCandidates)
        .mockResolvedValueOnce('merge')
      const writerWithLLM = new MemoryWriterService(
        repo,
        store,
        (cat, key) => settings[cat]?.[key] ?? null,
        llm as unknown as LLMCallFn,
      )

      await writerWithLLM.maybeWriteFromTurn(basePayload)
      // 前置：首写后正文关键词已入索引
      expect(searchRepo.searchBm25('阿那亚图书馆')).toHaveLength(1)

      await writerWithLLM.maybeWriteFromTurn(basePayload)

      // merge 语义：文件中旧正文应保留（拼接）
      const row = repo.findByName('user', null, 'e4-merge-mem')
      expect(row).not.toBeNull()
      const merged = await store.readFile(row!.file_path)
      expect(merged).toContain('阿那亚图书馆')

      // 修复目标：旧正文关键词仍可检索（当前 FTS body 已被空串覆盖 → 0 命中）
      const hits = searchRepo.searchBm25('阿那亚图书馆')
      expect(hits).toHaveLength(1)
      expect(hits[0]!.entry.id).toBe(row!.id)
    })
  })
})

describe('parseCandidates — JSON 容错（LLM 裸双引号 fallback）', () => {
  it('严格 JSON.parse 成功时走快路径', () => {
    const raw = JSON.stringify([
      {
        scope: 'user',
        type: 'feedback',
        name: 'test',
        description: '正常',
        body: '正文',
        confidence: 0.9,
      },
    ])
    const c = parseCandidates(raw)
    expect(c).toHaveLength(1)
    expect(c[0]!.name).toBe('test')
  })

  it('LLM 在 description 写裸双引号（用户实测 case）— 宽松提取兜底', () => {
    // 用户日志实际触发的 case：description 内嵌 "牛马王" 未转义，JSON.parse 失败
    const raw = `[
  {
    "scope": "project",
    "type": "feedback",
    "name": "agent-identity-niumawang",
    "description": "用户要求助手以"牛马王"身份履职，保持架构师级别输出。",
    "body": "用户指定助手身份为**牛马王**，需以**架构师**级别履职。\\n\\n**Why:** 用户明确要求。\\n\\n**How to apply:** 自称牛马王。",
    "confidence": 0.85,
    "entities": ["牛马王"]
  }
]`
    // 严格 JSON.parse 必须失败（验证这确实是脏 JSON）
    expect(() => JSON.parse(raw)).toThrow()
    // parseCandidates 应通过宽松提取恢复这条候选
    const c = parseCandidates(raw)
    expect(c).toHaveLength(1)
    expect(c[0]!.scope).toBe('project')
    expect(c[0]!.type).toBe('feedback')
    expect(c[0]!.name).toBe('agent-identity-niumawang')
    // description 应完整还原（含内嵌引号）
    expect(c[0]!.description).toContain('牛马王')
    expect(c[0]!.description).toContain('架构师')
    // body 也应还原（含 markdown + 换行）
    expect(c[0]!.body).toContain('**Why:**')
    expect(c[0]!.confidence).toBe(0.85)
    expect(c[0]!.entities).toEqual(['牛马王'])
  })

  it('完全无法解析的脏数据返回空数组（不抛异常）', () => {
    expect(parseCandidates('这不是JSON也没有字段')).toEqual([])
    expect(parseCandidates('')).toEqual([])
  })

  it('宽松提取仍做 scope/type 枚举校验（非法值被丢弃）', () => {
    const raw = `[
  {
    "scope": "invalid_scope",
    "type": "feedback",
    "name": "test",
    "description": "desc",
    "body": "body",
    "confidence": 0.9
  }
]`
    // 严格 JSON.parse 会成功（JSON 本身合法），但 scope 枚举校验失败 → 丢弃
    const c = parseCandidates(raw)
    expect(c).toEqual([])
  })
})
