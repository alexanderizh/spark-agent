/**
 * @module memory-writer.evolution.test
 *
 * 真实 DB 测试：writer 演化执行路径（UPDATE/DELETE/NOOP/ADD 落库）。
 * 用 mock MemoryEvolutionService 注入预设 verdict，验证 writer 的 invalidateEntry/updateEntry
 * 对 SQLite + 文件的实际效果（含 FTS 同步、bi-temporal 失效、## History 追加）。
 *
 * 需 better-sqlite3 Node ABI（见 storage-tests-better-sqlite3-abi 记忆）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  SparkDatabase,
  MemoryRepository,
  MemorySearchRepository,
  MemoryCandidateRepository,
} from '@spark/storage'
import type { MemoryEntryInsert } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryWriterService } from './memory-writer.service.js'
import type { MemoryCandidate } from './memory-writer.service.js'
import type { MemoryEvolutionService, EvolutionVerdict } from './memory-evolution.service.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/** 造一个返回固定 verdict 的 mock evolution service */
function mockEvolution(verdict: EvolutionVerdict): MemoryEvolutionService {
  return {
    decide: async () => verdict,
  } as unknown as MemoryEvolutionService
}

describe('MemoryWriterService evolution execution (real DB)', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let store: MemoryStoreService
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-writer-evo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'workspace'))
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedEntry(overrides: Partial<MemoryEntryInsert> = {}): MemoryEntryInsert {
    return {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: 'seed-entry',
      description: 'seed description',
      file_path: '',
      confidence: 0.9,
      hit_count: 3,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
      ...overrides,
    }
  }

  function makeWriter(verdict: EvolutionVerdict): MemoryWriterService {
    return new MemoryWriterService(
      repo,
      store,
      () => null, // settings 默认启用
      async () => '[]', // callLLM 不用（maybeWriteFromTurn 不走，直接调 processCandidate）
      mockEvolution(verdict),
    )
  }

  it('NOOP verdict → nothing written', async () => {
    const writer = makeWriter({ decision: 'NOOP', targetId: null, reason: 'dup' })
    // 直接测 processCandidate（绕过抽取）：用类型断言访问 private 方法
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'noop-cand',
      description: 'a noop candidate',
      body: 'body',
      confidence: 0.9,
    }
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')
    expect(repo.countByScope('user', null)).toBe(0)
  })

  it('【S2.5/N3】UPDATE verdict：新版本置信度独立评估，允许下降不继承旧高分', async () => {
    // 旧条目 0.95（曾经的高置信），纠正候选 0.7 —— 修复前 Math.max 保持 0.95，
    // 用户纠正的独立评估被旧分数淹没；修复后新版本 = 候选自身值 0.7
    const target = repo.insert(
      seedEntry({ name: 'deploy-target', description: '部署到 A 平台', confidence: 0.95 }),
      '部署目标：A 平台。',
    )
    const writer = makeWriter({
      decision: 'UPDATE',
      targetId: target.id,
      reason: '用户纠正：已迁到 B 平台',
    })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'deploy-correction',
      description: '部署到 B 平台（用户纠正）',
      body: '部署目标改为 B。',
      confidence: 0.7,
    }
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')

    const updated = repo.getById(target.id)!
    expect(updated.confidence).toBe(0.7) // 独立评估，不继承 0.95
    expect(updated.version).toBe(2)
    // 被覆盖版本已进 revision 历史（S2.2），纠正可追溯
    expect(updated.description).toBe(candidate.description)
  })

  it('DELETE verdict → target invalidated (invalid_at set), excluded from search', async () => {
    const target = repo.insert(
      seedEntry({ name: 'old-stack', description: '项目用 webpack 构建' }),
      '项目用 webpack 构建的正文',
    )
    expect(searchRepo.searchBm25('webpack')).toHaveLength(1)

    const writer = makeWriter({ decision: 'DELETE', targetId: target.id, reason: '已迁到 vite' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'migration-note',
      description: '我们已从 webpack 迁到 vite',
      body: 'body',
      confidence: 0.9,
    }
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')

    // target 失效（不物理删除），FTS 移除
    const updated = repo.getById(target.id)!
    expect(updated.invalid_at).not.toBeNull()
    expect(updated.archived).toBe(0) // 失效 ≠ 归档
    expect(searchRepo.searchBm25('webpack')).toHaveLength(0)
    // 候选本身未写入（DELETE 不留存候选）；target 失效后不再计入"有效"配额
    expect(repo.countByScope('user', null)).toBe(0)
    // 但行仍在（含失效），可通过 includeInvalid 查看
    expect(repo.listByScope('user', null, { includeInvalid: true })).toHaveLength(1)
  })

  it('UPDATE verdict → target description/body updated, hit_count preserved, History appended, FTS re-indexed', async () => {
    // 经 store 正常建条（file_path 指向真实文件，模拟生产 ADD 后的 UPDATE）
    const targetId = `usr_${Math.random().toString(36).slice(2, 10)}`
    const targetPath = store.getFilePath('user', null, targetId)
    await store.writeFile({
      meta: {
        id: targetId,
        scope: 'user',
        scopeRef: null,
        type: 'user',
        name: 'stack',
        description: '旧的描述 webpack',
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 7,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: '旧的正文内容 webpack',
    })
    const target = repo.insert(
      seedEntry({
        id: targetId,
        name: 'stack',
        description: '旧的描述 webpack',
        hit_count: 7,
        file_path: targetPath,
      }),
    )
    expect(searchRepo.searchBm25('webpack')).toHaveLength(1)

    const writer = makeWriter({ decision: 'UPDATE', targetId: target.id, reason: 'refined' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'stack-v2',
      description: '全新的描述 vite',
      body: '全新正文 vite',
      confidence: 0.95,
    }
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')

    // 同 id，描述更新，hit_count/created_at 保留
    const updated = repo.getById(target.id)!
    expect(updated.id).toBe(target.id)
    expect(updated.description).toBe('全新的描述 vite')
    expect(updated.hit_count).toBe(7) // 保留
    expect(updated.created_at).toBe(target.created_at)
    expect(updated.updated_at).toBeGreaterThanOrEqual(target.updated_at)

    // FTS 重建：新描述 'vite' 可搜（注：旧文本仍出现在 ## History 区段，故 'webpack' 也命中——这是预期）
    expect(searchRepo.searchBm25('vite')).toHaveLength(1)
    const viteHit = searchRepo.searchBm25('vite')[0]!
    expect(viteHit.entry.description).toBe('全新的描述 vite') // 描述字段已更新

    // 文件 ## History 区段追加了旧正文
    const fileBody = await store.readFile(updated.file_path)
    expect(fileBody).toContain('## History')
    expect(fileBody).toContain('旧的正文内容 webpack')
    expect(fileBody).toContain('全新正文 vite')
  })

  it('ADD verdict → new entry written', async () => {
    const writer = makeWriter({ decision: 'ADD', targetId: null, reason: 'new fact' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'feedback',
      name: 'new-fb',
      description: '一条全新反馈',
      body: 'body',
      confidence: 0.9,
    }
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')
    expect(repo.countByScope('user', null)).toBe(1)
    expect(repo.listByScope('user', null)[0]!.name).toBe('new-fb')
  })

  it('DELETE on already-invalidated target → idempotent (no error)', async () => {
    const target = repo.insert(seedEntry({ name: 'tgt' }))
    repo.update(target.id, { invalid_at: Date.now() })
    const writer = makeWriter({ decision: 'DELETE', targetId: target.id, reason: 'x' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'c',
      description: 'd',
      body: 'b',
      confidence: 0.9,
    }
    // 不应抛错
    await (
      writer as unknown as {
        processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
      }
    ).processCandidate(candidate, null, 'sess')
  })

  it('【审查修复·P2-A】同一冲突反复演化只征集一条候选（征集正文不嵌时间戳，digest 稳定）', async () => {
    const candidateRepo = new MemoryCandidateRepository(db)
    // 手动记忆（author_role=manual_user）：UPDATE 目标属"用户明确表达"，走 defer 转候选
    const manual = await makeWriter({ decision: 'NOOP', targetId: null, reason: 'x' }).manualWrite({
      scope: 'user',
      type: 'user',
      name: 'manual-pref',
      description: '偏好 A',
      body: '偏好 A 的正文。',
      scopeRef: null,
    })
    const writer = new MemoryWriterService(
      repo,
      store,
      () => null,
      async () => '[]',
      mockEvolution({ decision: 'UPDATE', targetId: manual.id, reason: '用户改为 B' }),
      undefined, // entityRepo 缺省（显式 undefined 走默认参数，下同）
      undefined, // commitService 缺省：由 repo+store 内部构造真实提交原语
      candidateRepo,
    )
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'pref-correction',
      description: '改为 B（用户纠正）',
      body: '新正文：偏好 B。',
      confidence: 0.8,
    }
    const run = (): Promise<void> =>
      (
        writer as unknown as {
          processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
        }
      ).processCandidate(candidate, null, 'sess')

    // 同一冲突演化两轮：修复前征集即合成含时间戳的 History → digest 每轮必变
    // → 候选累积两条（并挤占每 scope 20 条容量）；修复后 digest 稳定仅一条
    await run()
    await run()
    const pending = candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })
    expect(pending).toHaveLength(1)

    // 征集暂存正文 = 演化建议原文（History 段由 confirmUpdate 确认落库时才合成）
    const payload = candidateRepo.parsePayload(pending[0]!)
    expect(payload?.action).toBe('update')
    expect(payload?.targetId).toBe(manual.id)
    expect(payload?.body).not.toContain('## History')

    // 目标未被自动改动（defer 生效：等用户裁决）
    expect(repo.getById(manual.id)!.description).toBe('偏好 A')
  })

  it('【审查修复·P2-A】同 digest 候选已被用户拒绝：第二轮冲突不得自动执行（rejected 裁决不可推翻）', async () => {
    const candidateRepo = new MemoryCandidateRepository(db)
    const manual = await makeWriter({ decision: 'NOOP', targetId: null, reason: 'x' }).manualWrite({
      scope: 'user',
      type: 'user',
      name: 'manual-pref-rj',
      description: '偏好 A',
      body: '偏好 A 的正文（rejected 保护测试）。',
      scopeRef: null,
    })
    const writer = new MemoryWriterService(
      repo,
      store,
      () => null,
      async () => '[]',
      mockEvolution({ decision: 'UPDATE', targetId: manual.id, reason: '用户改为 C' }),
      undefined,
      undefined,
      candidateRepo,
    )
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'pref-correction-rj',
      description: '改为 C（用户纠正）',
      body: '新正文：偏好 C。',
      confidence: 0.8,
    }
    const run = (): Promise<void> =>
      (
        writer as unknown as {
          processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
        }
      ).processCandidate(candidate, null, 'sess')

    // 第一轮征集 pending，用户明确拒绝该 update 提议
    await run()
    const firstRow = candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })[0]
    expect(firstRow).toBeDefined()
    if (firstRow == null) throw new Error('unreachable: asserted single pending row')
    candidateRepo.reject(firstRow.id)

    // 第二轮同冲突：digest 命中 rejected 行。修复前降级自动执行（inserted:false
    // 无视 status → return false → 直接改写用户保住的目标）；修复后跳过自动
    // 写入（与「转候选等确认」同语义），用户裁决维持
    await run()
    const targetRow = repo.getById(manual.id)
    expect(targetRow?.description).toBe('偏好 A')
    expect(candidateRepo.listByStatus('rejected', { scope: 'user', scopeRef: null })).toHaveLength(
      1,
    )
    expect(candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })).toHaveLength(
      0,
    )
  })

  it('【审查修复·P2-A】DELETE 提议被拒后：同 digest 再冲突不得自动失效目标（digest=目标正文天然稳定）', async () => {
    const candidateRepo = new MemoryCandidateRepository(db)
    const manual = await makeWriter({ decision: 'NOOP', targetId: null, reason: 'x' }).manualWrite({
      scope: 'user',
      type: 'user',
      name: 'manual-keep',
      description: '保留我',
      body: '用户明确要保留的正文（delete rejected 保护测试）。',
      scopeRef: null,
    })
    const writer = new MemoryWriterService(
      repo,
      store,
      () => null,
      async () => '[]',
      mockEvolution({ decision: 'DELETE', targetId: manual.id, reason: '已过时' }),
      undefined,
      undefined,
      candidateRepo,
    )
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'evolve-suggest-del',
      description: '演化建议删除',
      body: '（DELETE 候选暂存正文取目标自身正文，与演化建议无关）',
      confidence: 0.7,
    }
    const run = (): Promise<void> =>
      (
        writer as unknown as {
          processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void>
        }
      ).processCandidate(candidate, null, 'sess')

    // 第一轮征集 pending delete 提议 → 用户拒绝（保住该记忆）
    await run()
    const firstRow = candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })[0]
    expect(firstRow).toBeDefined()
    if (firstRow == null) throw new Error('unreachable: asserted single pending row')
    expect(candidateRepo.parsePayload(firstRow)?.action).toBe('delete')
    candidateRepo.reject(firstRow.id)

    // 第二轮同冲突：delete 候选 digest 由目标 name/description/body 构成，目标
    // 未变则逐字节相同 → 命中 rejected 行。修复前会静默自动失效用户明确保住
    // 的记忆；修复后跳过，目标保持有效
    await run()
    const kept = repo.getById(manual.id)
    expect(kept?.invalid_at).toBeNull()
    expect(candidateRepo.listByStatus('rejected', { scope: 'user', scopeRef: null })).toHaveLength(
      1,
    )
  })
})
