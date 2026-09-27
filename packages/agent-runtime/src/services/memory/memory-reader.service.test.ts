/**
 * @module memory-reader.service.test
 *
 * 单元测试：MemoryReaderService
 *
 * 覆盖：
 *   - 三层记忆加载与 XML 拼装
 *   - token 超限时按 type 优先级裁剪 (feedback > user > project > reference)
 *   - recall_memory 工具实现（完整正文 + bumpHit）
 *   - settings.enabled=false 时返回空 block
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryReaderService } from './memory-reader.service.js'
import { MemoryRepository } from '@spark/storage'
import { SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

describe('MemoryReaderService', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let store: MemoryStoreService
  let reader: MemoryReaderService
  let testDir: string
  let settings: Record<string, Record<string, unknown>> = { memory: { enabled: true } }

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-reader-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), '..', 'storage', 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    repo = new MemoryRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'workspace'))
    settings = { memory: { enabled: true } }

    reader = new MemoryReaderService(repo, store, (cat: string, key: string) => {
      const catObj = settings[cat]
      return catObj?.[key] ?? null
    })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  async function seedMemory(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
    type: 'user' | 'feedback' | 'project' | 'reference',
    name: string,
    description: string,
  ): Promise<string> {
    const prefix = scope === 'user' ? 'usr' : scope === 'project' ? 'prj' : 'agt'
    const id = `${prefix}_${name.replace(/\s/g, '')}`
    const filePath = store.getFilePath(scope, scopeRef, id)

    await store.writeFile({
      meta: {
        id,
        scope,
        scopeRef,
        type,
        name,
        description,
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: `Body for ${name}`,
    })

    repo.insert({
      id,
      scope,
      scope_ref: scopeRef,
      type,
      name,
      description,
      file_path: filePath,
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })

    return id
  }

  describe('loadForSession', () => {
    it('should return empty block when no memories exist', async () => {
      const result = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })
      expect(result.block).toBe('')
      expect(result.injectedIds).toHaveLength(0)
    })

    it('should return empty block when memory is disabled', async () => {
      settings.memory!.enabled = false
      await seedMemory('user', null, 'feedback', 'test-mem', 'Test')

      const result = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })
      expect(result.block).toBe('')
    })

    it('should load and render all three scope layers', async () => {
      await seedMemory('user', null, 'feedback', 'user-fb', 'User feedback')
      await seedMemory('project', 'ws-1', 'project', 'proj-ctx', 'Project context')
      await seedMemory('agent', 'agent-1', 'user', 'agent-who', 'Agent who')

      const result = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })

      expect(result.block).toContain('# Long-term Memory')
      expect(result.block).toContain('<user-memory>')
      expect(result.block).toContain('<project-memory')
      expect(result.block).toContain('<agent-memory>')
      expect(result.block).toContain('recall_memory')
      expect(result.injectedIds).toHaveLength(3)
    })

    it('should trim by type priority when token budget exceeded', async () => {
      // 设置极小的 token 预算
      settings.memory!.maxInjectTokens = 80 // 大约只能容纳 1-2 条

      // 按 type 插入多类型记忆
      await seedMemory(
        'user',
        null,
        'reference',
        'ref-mem',
        'Reference memory with some longer description text',
      )
      await seedMemory('user', null, 'project', 'proj-mem', 'Project memory description')
      await seedMemory('user', null, 'user', 'user-mem', 'User memory description')
      await seedMemory('user', null, 'feedback', 'fb-mem', 'Feedback memory desc')

      const result = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })

      // feedback 优先级最高，应首先保留
      expect(result.injectedIds).toContain('usr_fb-mem')
      // reference 优先级最低，大概率被裁掉
      expect(result.droppedCount).toBeGreaterThan(0)
    })

    it('should sort by updated_at (not hit_count) and stay byte-stable across bumpHit', async () => {
      // 缓存前缀稳定性：feedback 排序只依赖 updated_at（bumpHit 不刷 updated_at），
      // agent 调 recall_memory 命中计数变化不得引起下一轮注入 block 字节漂移。
      const id1 = await seedMemory('user', null, 'feedback', 'older-rule', 'Older rule')
      const id2 = await seedMemory('user', null, 'feedback', 'newer-rule', 'Newer rule')

      // 强制 id1 的 updated_at 晚于 id2（update 总是刷新 updated_at），保证断言确定性
      await new Promise((resolve) => setTimeout(resolve, 5))
      repo.update(id1, { confidence: 0.95 })

      const first = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })

      // updated_at 新的（id1）排前，与 hit_count 无关
      expect(first.injectedIds[0]).toBe(id1)

      // bumpHit（recall_memory 副作用）后渲染逐字节不变、顺序不变
      repo.bumpHit(id2)
      repo.bumpHit(id2)
      const second = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })
      expect(second.block).toBe(first.block)
      expect(second.injectedIds).toEqual(first.injectedIds)
    })
  })

  describe('recall', () => {
    it('should return full markdown body and bump hit count', async () => {
      const id = await seedMemory('user', null, 'feedback', 'test-recall', 'Test recall')

      const result = await reader.recall(id, { allowedScopes: [{ scope: 'user', scopeRef: null }] })
      expect(result.error).toBeUndefined()
      expect(result.content).toContain('Body for test-recall')

      // hit_count should be incremented
      const row = repo.getById(id)!
      expect(row.hit_count).toBe(1)
    })

    it('should return error for non-existent id', async () => {
      const result = await reader.recall('nonexistent')
      expect(result.error).toContain('not found')
    })

    it('should return error for archived entry', async () => {
      const id = await seedMemory('user', null, 'feedback', 'archived-mem', 'Archived')
      repo.archive(id)

      const result = await reader.recall(id, { allowedScopes: [{ scope: 'user', scopeRef: null }] })
      expect(result.error).toContain('archived')
    })

    // ─── S0 反例固定（E7）→ S1A.2 已修复（2026-09-27 反转） ──────────────
    // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1A.2。
    // 原 fails 用例：recall(id) 只拒 archived，任意会话可读任意 scope 条目。
    // S1A.2 修复（accessContext 参数 + 缺省拒绝 + isEntryInScopes 统一校验）
    // 后反转为 it。
    describe('S1A.2 已修复（原 S0/E7 反例）：recall 访问上下文', () => {
      it('无访问上下文时 recall 拒绝（缺省 deny）', async () => {
        const id = await seedMemory('user', null, 'feedback', 'no-context-mem', 'No context')

        const result = await reader.recall(id)
        expect(result.error).toBeDefined()
        expect(result.error).toContain('denied')
        // 拒绝时不得计入命中
        expect(repo.getById(id)!.hit_count).toBe(0)
      })

      it('以 user scope 身份 recall project scope 条目拒绝', async () => {
        const projectId = await seedMemory(
          'project',
          'ws-a',
          'project',
          'cross-scope-mem',
          'Cross scope',
        )

        // 模拟"非该项目会话"的调用：目标条目属 ws-a，调用方仅允许 user scope
        const result = await reader.recall(projectId, {
          allowedScopes: [{ scope: 'user', scopeRef: null }],
          caller: 'test:user-only',
        })
        expect(result.error).toContain('denied')
      })

      it('以 B 项目身份 recall A 项目条目拒绝', async () => {
        const idA = await seedMemory('project', 'ws-a', 'project', 'proj-a-mem', 'Project A')

        const result = await reader.recall(idA, {
          allowedScopes: [
            { scope: 'user', scopeRef: null },
            { scope: 'project', scopeRef: 'ws-b' },
          ],
          caller: 'test:ws-b',
        })
        expect(result.error).toContain('denied')
      })

      it('Host 允许范围（user+project+agent）内正常读取（验收矩阵：Team Member/Host 正常读取）', async () => {
        const userId = await seedMemory('user', null, 'feedback', 'host-user-mem', 'User scope')
        const prjId = await seedMemory(
          'project',
          'ws-a',
          'project',
          'host-prj-mem',
          'Project scope',
        )
        const agtId = await seedMemory(
          'agent',
          'agent-1',
          'feedback',
          'host-agt-mem',
          'Agent scope',
        )
        const hostScopes = [
          { scope: 'user' as const, scopeRef: null },
          { scope: 'project' as const, scopeRef: 'ws-a' },
          { scope: 'agent' as const, scopeRef: 'agent-1' },
        ]

        for (const id of [userId, prjId, agtId]) {
          const result = await reader.recall(id, { allowedScopes: hostScopes, caller: 'test:host' })
          expect(result.error).toBeUndefined()
        }
        expect(repo.getById(userId)!.hit_count).toBe(1)
      })

      it('Member 以自身 agentId scope 读取自身记忆正常（不因 Host 身份丢失而误拒）', async () => {
        const memberId = await seedMemory(
          'agent',
          'member-9',
          'feedback',
          'member-own-mem',
          'Member own',
        )

        const result = await reader.recall(memberId, {
          allowedScopes: [
            { scope: 'user', scopeRef: null },
            { scope: 'agent', scopeRef: 'member-9' },
          ],
          caller: 'test:member-9',
        })
        expect(result.error).toBeUndefined()
        expect(result.content).toContain('Body for member-own-mem')
      })

      it('本 scope 正常读取并 bumpHit（正确行为固化，修复后不得回归）', async () => {
        const id = await seedMemory('user', null, 'feedback', 'in-scope-mem', 'In scope')

        const result = await reader.recall(id, {
          allowedScopes: [{ scope: 'user', scopeRef: null }],
        })
        expect(result.error).toBeUndefined()
        expect(result.content).toContain('Body for in-scope-mem')
        expect(repo.getById(id)!.hit_count).toBe(1)
      })
    })

    // ─── S1B.1 读取守卫（方案 B）：content_hash 校验 ──────────────────────
    // 依据主计划 §3.1/§3.3：外部工具（旧 CLI）覆盖托管正文、或 CAS 失配留下的
    // 孤儿快照，都会使文件正文与 DB content_hash 失配 —— recall 拒绝采信并报
    // 不完整，不用任意同名 Markdown 冒充权威正文。
    describe('S1B.1 读取守卫：正文哈希失配拒绝', () => {
      it('文件被外部覆盖后 recall 拒绝（hash mismatch），不返回错配正文', async () => {
        const id = await seedMemory('user', null, 'feedback', 'guard-mem', 'Guard')
        // 建立守卫：经 repo.update（带 body）刷新 content_hash
        const before = repo.getById(id)!
        repo.update(id, { description: 'Guard desc' }, 'Body for guard-mem')
        expect(repo.getById(id)!.content_hash).not.toBeNull()
        expect(repo.getById(id)!.version).toBe(before.version + 1)

        // 外部覆盖文件（旧 CLI 写入自己的格式）
        const { writeFileSync } = await import('fs')
        writeFileSync(
          repo.getById(id)!.file_path,
          '---\nid: hacked\n---\n\n被外部工具覆盖的内容',
          'utf-8',
        )

        const result = await reader.recall(id, {
          allowedScopes: [{ scope: 'user', scopeRef: null }],
        })
        expect(result.error).toContain('incomplete')
        expect(result.content).toBe('')
        // 拒绝时不得计入命中
        expect(repo.getById(id)!.hit_count).toBe(0)
      })

      it('content_hash 为 NULL 的存量条目跳过校验（渐进建立守卫）', async () => {
        const id = await seedMemory('user', null, 'feedback', 'legacy-mem', 'Legacy')
        expect(repo.getById(id)!.content_hash).toBeNull()

        const result = await reader.recall(id, {
          allowedScopes: [{ scope: 'user', scopeRef: null }],
        })
        expect(result.error).toBeUndefined()
      })
    })
  })
})
