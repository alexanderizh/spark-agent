/**
 * S1B.5 同步最小切片 — memory 分类版本与失效语义测试。
 *
 * 覆盖：
 * - 上行：isArchived 停止折叠 invalid_at；version/invalidAt/supersededBy 传递；
 *   新字段过 sync-policy 白名单（createSafeSyncItem 不拒绝）
 * - 下行 tombstone：早于本地更新 → 保留本地；晚于本地 → 走生命周期服务
 *   删行 + 删文件 + 刷投影（E3 同类残留不在同步路径复现）
 * - 下行条目：旧响应（updatedAt 早于本地）不覆盖；新条目恢复失效语义并对齐
 *   version（收敛不变量）；旧云端条目（无新字段）兼容应用
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AccountSyncCategoryResult, AccountSyncItem } from '@spark/protocol'
import { MemoryRepository, MemoryRevisionRepository, SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from '@spark/agent-runtime'
import { AccountSyncAdapters } from './sync-adapters.js'
import { createSafeSyncItem } from './sync-policy.js'

const T0 = new Date('2026-09-26T00:00:00Z').getTime()
const T1 = new Date('2026-09-27T01:00:00Z').getTime()
const T2 = new Date('2026-09-27T02:00:00Z').getTime()
const T3 = new Date('2026-09-27T03:00:00Z').getTime()

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 构造 memory 分类的下行 value（字段与上行投影同构，可按需覆盖） */
function memoryValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'mem-a',
    scope: 'user',
    scopeRef: null,
    type: 'user',
    name: '同步记忆',
    description: '来自云端的描述',
    body: '云端正文内容',
    confidence: 0.8,
    isArchived: false,
    createdAt: iso(T0),
    updatedAt: iso(T2),
    ...overrides,
  }
}

/** 经过 createSafeSyncItem 的规范化条目（与 sanitizeCanonicalResult 同路径，
 *  同时验证新字段在白名单内不被拒绝） */
function safeItem(id: string, updatedAt: number, value: Record<string, unknown>): AccountSyncItem {
  const result = createSafeSyncItem('memory', { id, updatedAt: iso(updatedAt), value })
  if (result.item == null) {
    throw new Error(`item rejected by sync policy: ${result.skipped?.reasonCode ?? 'unknown'}`)
  }
  return result.item
}

function categoryResult(records: AccountSyncItem[]): AccountSyncCategoryResult {
  return {
    category: 'memory',
    schemaVersion: 1,
    revision: 1,
    records,
    hashes: {},
    stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
    skippedItems: [],
  }
}

describe('AccountSyncAdapters memory（S1B.5 版本与失效语义）', () => {
  let db: SparkDatabase
  let testDir: string
  let testHome: string
  let memories: MemoryRepository
  let store: MemoryStoreService
  let adapters: AccountSyncAdapters

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-sync-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    testHome = join(testDir, 'home')
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    memories = new MemoryRepository(db)
    store = new MemoryStoreService(testHome)
    adapters = new AccountSyncAdapters(
      db,
      (home, workspace) => new MemoryStoreService(home ?? testHome, workspace),
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 落一条本地记忆（行 + 真实文件），返回文件路径 */
  async function seedLocalEntry(
    overrides: Partial<{
      id: string
      name: string
      body: string
      updatedAt: number
      archived: number
      invalidAt: number | null
      supersededBy: string | null
      version: number
    }> = {},
  ): Promise<string> {
    const id = overrides.id ?? 'mem-local-1'
    const updatedAt = overrides.updatedAt ?? T1
    const filePath = await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'user',
        name: overrides.name ?? '本地记忆',
        description: '本地描述',
        confidence: 0.8,
        createdAt: T0,
        updatedAt,
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: overrides.body ?? '本地正文',
    })
    memories.insert(
      {
        id,
        scope: 'user',
        scope_ref: null,
        type: 'user',
        name: overrides.name ?? '本地记忆',
        description: '本地描述',
        file_path: filePath,
        confidence: 0.8,
        hit_count: 0,
        last_hit_at: null,
        source_session_id: null,
        archived: overrides.archived ?? 0,
      },
      overrides.body ?? '本地正文',
    )
    db.raw
      .prepare(
        'UPDATE memory_entry SET updated_at = ?, version = ?, invalid_at = ?, superseded_by = ? WHERE id = ?',
      )
      .run(
        updatedAt,
        overrides.version ?? 1,
        overrides.invalidAt ?? null,
        overrides.supersededBy ?? null,
        id,
      )
    return filePath
  }

  describe('上行 collect', () => {
    it('失效条目不再折叠为 isArchived，独立传递 invalidAt/supersededBy/version', async () => {
      await seedLocalEntry({
        id: 'mem-invalid-1',
        invalidAt: T1,
        supersededBy: 'mem-new-1',
        version: 3,
      })

      const collected = await adapters.collect('memory')
      const record = collected.records.find((item) => item.id === 'mem-invalid-1')
      expect(record).toBeDefined()
      expect(record?.deleted).toBe(false)
      // 停止折叠：失效 ≠ 归档
      expect(record?.value?.isArchived).toBe(false)
      // 失效语义独立传递（S1B.5 核心）
      expect(record?.value?.invalidAt).toBe(iso(T1))
      expect(record?.value?.supersededBy).toBe('mem-new-1')
      expect(record?.value?.version).toBe(3)
      // 新字段在白名单内：条目未被 skip
      expect(collected.skippedItems.some((item) => item.id === 'mem-invalid-1')).toBe(false)
    })

    it('纯归档条目 isArchived=true 且 invalidAt=null（不携带失效语义）', async () => {
      await seedLocalEntry({ id: 'mem-archived-1', archived: 1, version: 2 })

      const collected = await adapters.collect('memory')
      const record = collected.records.find((item) => item.id === 'mem-archived-1')
      expect(record?.value?.isArchived).toBe(true)
      expect(record?.value?.invalidAt).toBeNull()
      expect(record?.value?.supersededBy).toBeNull()
      expect(record?.value?.version).toBe(2)
    })
  })

  describe('下行 tombstone', () => {
    it('tombstone 早于本地最后写入 → 保留本地，不删行不删文件', async () => {
      const filePath = await seedLocalEntry({ id: 'mem-a', updatedAt: T2 })

      // 云端删除发生在 T1（早于本地 T2 更新）——离线期间本地更新过
      const result = await adapters.apply(
        categoryResult([{ id: 'mem-a', updatedAt: iso(T1), deleted: true }]),
        new Set(),
      )

      // 保留是预期防御，不是失败
      expect(result.errorCodes).toEqual([])
      expect(memories.getById('mem-a')).not.toBeNull()
      expect(existsSync(filePath)).toBe(true)
    })

    it('tombstone 晚于本地最后写入 → 删行、删文件并刷新 MEMORY.md 投影', async () => {
      await seedLocalEntry({ id: 'mem-keep', updatedAt: T0 })
      const deletedPath = await seedLocalEntry({ id: 'mem-gone', updatedAt: T1 })
      // 预置投影：两条都在（删除后应整体重写为只剩 mem-keep）
      await store.updateIndexFile('user', null, [
        { name: '保留条目', description: '', id: 'mem-keep' },
        { name: '将被删除', description: '', id: 'mem-gone' },
      ])
      const indexPath = join(testHome, 'memory', 'user', 'MEMORY.md')

      const result = await adapters.apply(
        categoryResult([{ id: 'mem-gone', updatedAt: iso(T3), deleted: true }]),
        new Set(),
      )

      expect(result.errorCodes).toEqual([])
      expect(memories.getById('mem-gone')).toBeNull()
      expect(existsSync(deletedPath)).toBe(false)
      expect(existsSync(indexPath)).toBe(true)
      expect(readFileSync(indexPath, 'utf-8')).toContain('mem-keep')
      expect(readFileSync(indexPath, 'utf-8')).not.toContain('mem-gone')
    })

    it('tombstone 重放幂等：目标已删后再次应用同一 tombstone 无副作用', async () => {
      // 场景：首轮应用失败（如投影刷新中断）后 baseHashes 未推进，
      // 下轮同步服务端重发同一 tombstone —— 行已不存在时静默成功
      await seedLocalEntry({ id: 'mem-replay', updatedAt: T1 })
      const first = await adapters.apply(
        categoryResult([{ id: 'mem-replay', updatedAt: iso(T3), deleted: true }]),
        new Set(),
      )
      expect(first.errorCodes).toEqual([])
      expect(memories.getById('mem-replay')).toBeNull()

      // 服务端重放（例如 ack 丢失后的重试）
      const replay = await adapters.apply(
        categoryResult([{ id: 'mem-replay', updatedAt: iso(T3), deleted: true }]),
        new Set(),
      )
      expect(replay.errorCodes).toEqual([])
      expect(memories.getById('mem-replay')).toBeNull()
    })

    it('【S2.4】同步条目含敏感信息 → 拒绝落库并计入 SYNC_MEMORY_SENSITIVE', async () => {
      const result = await adapters.apply(
        categoryResult([
          safeItem('mem-clean', T2, memoryValue({ id: 'mem-clean', name: '干净记忆' })),
          safeItem(
            'mem-secret',
            T2,
            memoryValue({
              id: 'mem-secret',
              name: '含密钥记忆',
              // 通用赋值形态：过 sync-policy 的 token 前缀扫描（sk-/ghp- 等），
              // 但命中 sanitizer 的 password 赋值模式 —— 验证 applyMemory 二道防线
              description: '数据库凭据 password=hunter2s3cret 请记住',
            }),
          ),
        ]),
        new Set(),
      )

      expect(result.errorCodes).toContain('SYNC_MEMORY_SENSITIVE')
      expect(memories.getById('mem-clean')).not.toBeNull()
      expect(memories.getById('mem-secret')).toBeNull()
    })

    it('【审查修复】tombstone 删除同时物理清理 revision 历史与派生边（不留悬挂行）', async () => {
      await seedLocalEntry({ id: 'mem-hist', updatedAt: T1, version: 2 })
      // 模拟该条目曾更新过：预置一条 revision 历史与一条派生边
      const revisions = new MemoryRevisionRepository(db)
      revisions.insertRevision({
        memoryId: 'mem-hist',
        version: 1,
        type: 'user',
        name: '本地记忆',
        description: '本地描述',
        body: '被覆盖的旧正文',
        contentHash: 'deadbeef',
        confidence: 0.8,
        authorRole: 'host_agent',
        sourceEventId: null,
        validFrom: T0,
        supersededAt: T1,
        kind: 'update',
        successorId: null,
        note: null,
      })
      revisions.insertDerivation('mem-hist', 'mem-other', 'elevate')

      const result = await adapters.apply(
        categoryResult([{ id: 'mem-hist', updatedAt: iso(T3), deleted: true }]),
        new Set(),
      )

      expect(result.errorCodes).toEqual([])
      expect(memories.getById('mem-hist')).toBeNull()
      // 修复前：lifecycle 未接 revisionRepo，revision 与派生边残留为悬挂行
      const revisionRows = db.raw
        .prepare('SELECT COUNT(*) AS n FROM memory_revision WHERE memory_id = ?')
        .get('mem-hist') as { n: number }
      const derivationRows = db.raw
        .prepare(
          'SELECT COUNT(*) AS n FROM memory_derivation WHERE source_id = ? OR derived_id = ?',
        )
        .get('mem-hist', 'mem-hist') as { n: number }
      expect(revisionRows.n).toBe(0)
      expect(derivationRows.n).toBe(0)
    })
  })

  describe('下行条目应用', () => {
    it('旧响应（updatedAt 早于本地最后写入）不覆盖当前状态', async () => {
      await seedLocalEntry({
        id: 'mem-a',
        name: '本地较新名称',
        body: '本地较新正文',
        updatedAt: T2,
      })

      const result = await adapters.apply(
        categoryResult([
          safeItem(
            'mem-a',
            T1,
            memoryValue({ id: 'mem-a', name: '云端旧名称', body: '云端旧正文' }),
          ),
        ]),
        new Set(),
      )

      // 跳过是预期防御，不计入 errorCodes
      expect(result.errorCodes).toEqual([])
      const row = memories.getById('mem-a')
      expect(row?.name).toBe('本地较新名称')
      // readFile 返回 render 追加尾部换行的正文
      expect((await store.readFile(row!.file_path)).trimEnd()).toBe('本地较新正文')
    })

    it('新条目恢复失效语义并对齐远端 version（收敛不变量）', async () => {
      const result = await adapters.apply(
        categoryResult([
          safeItem(
            'mem-remote-1',
            T2,
            memoryValue({
              id: 'mem-remote-1',
              version: 5,
              invalidAt: iso(T1),
              supersededBy: 'mem-newer',
            }),
          ),
        ]),
        new Set(),
      )

      expect(result.errorCodes).toEqual([])
      const row = memories.getById('mem-remote-1')
      expect(row).not.toBeNull()
      expect(row?.invalid_at).toBe(T1)
      expect(row?.superseded_by).toBe('mem-newer')
      // version 对齐远端计数：应用后再上行的投影与服务端 canonical 一致
      expect(row?.version).toBe(5)
      // 文件已落盘（readFile 返回 render 追加尾部换行的正文）
      expect((await store.readFile(row!.file_path)).trimEnd()).toBe('云端正文内容')
    })

    it('旧云端条目（无 version/invalidAt/supersededBy 字段）兼容应用为有效条目', async () => {
      const legacyValue = memoryValue({ id: 'mem-legacy-1' })
      delete legacyValue.version
      delete legacyValue.invalidAt
      delete legacyValue.supersededBy

      const result = await adapters.apply(
        categoryResult([safeItem('mem-legacy-1', T2, legacyValue)]),
        new Set(),
      )

      expect(result.errorCodes).toEqual([])
      const row = memories.getById('mem-legacy-1')
      expect(row).not.toBeNull()
      expect(row?.invalid_at).toBeNull()
      expect(row?.superseded_by).toBeNull()
      // 无 version → 不对齐，保留本地 insert 计数
      expect(row?.version).toBe(1)
    })

    it('远端较新的有效版本恢复本地已失效条目（invalid_at 重置）', async () => {
      await seedLocalEntry({ id: 'mem-a', invalidAt: T1, version: 2, updatedAt: T1 })

      const result = await adapters.apply(
        categoryResult([safeItem('mem-a', T3, memoryValue({ id: 'mem-a', version: 3 }))]),
        new Set(),
      )

      expect(result.errorCodes).toEqual([])
      const row = memories.getById('mem-a')
      expect(row?.invalid_at).toBeNull()
      expect(row?.superseded_by).toBeNull()
      expect(row?.version).toBe(3)
      expect(row?.updated_at).toBe(T3)
    })
  })
})
