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

    reader = new MemoryReaderService(
      repo,
      store,
      (cat: string, key: string) => {
        const catObj = settings[cat]
        return catObj?.[key] ?? null
      },
    )
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
        id, scope, scopeRef, type, name, description,
        confidence: 0.9, createdAt: Date.now(), updatedAt: Date.now(),
        hitCount: 0, lastHitAt: null, sourceSessionId: null, links: [], archived: false,
      },
      body: `Body for ${name}`,
    })

    repo.insert({
      id, scope, scope_ref: scopeRef, type, name, description, file_path: filePath,
      confidence: 0.9, hit_count: 0, last_hit_at: null,
      source_session_id: null, archived: 0,
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
      await seedMemory('user', null, 'reference', 'ref-mem', 'Reference memory with some longer description text')
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

    it('should sort by hit_count within same type', async () => {
      // 两条同 type，不同 hit_count
      const id1 = await seedMemory('user', null, 'feedback', 'low-hit', 'Low hit')
      const id2 = await seedMemory('user', null, 'feedback', 'high-hit', 'High hit')

      // 手动 bump high-hit
      repo.bumpHit(id2)
      repo.bumpHit(id2)
      repo.bumpHit(id2)

      const result = await reader.loadForSession({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      })

      // high-hit 应排在 low-hit 前面
      const idx1 = result.injectedIds.indexOf(id1)
      const idx2 = result.injectedIds.indexOf(id2)
      expect(idx2).toBeLessThan(idx1)
    })
  })

  describe('recall', () => {
    it('should return full markdown body and bump hit count', async () => {
      const id = await seedMemory('user', null, 'feedback', 'test-recall', 'Test recall')

      const result = await reader.recall(id)
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

      const result = await reader.recall(id)
      expect(result.error).toContain('archived')
    })
  })
})
