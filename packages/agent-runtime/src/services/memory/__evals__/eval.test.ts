/**
 * @module memory eval
 *
 * 确定性黄金评测集 runner（真实 DB，需 better-sqlite3 Node ABI）。
 *
 * 跑 gate-cases（写入闸门 + 演化执行）+ search-cases（FTS 召回），每个用例断言期望结果。
 * 汇总 gate precision（正确 outcome 数/总数）+ search recall（期望命中数/总数），
 * 作为后续 prompt/逻辑改动的回归门槛。确定性逻辑应长期保持 100%。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, MemoryRepository, MemorySearchRepository, MemoryEntityRepository } from '@spark/storage'
import type { MemoryEntryInsert } from '@spark/storage'
import { MemoryStoreService } from '../memory-store.service.js'
import { MemoryWriterService } from '../memory-writer.service.js'
import type { MemoryCandidate } from '../memory-writer.service.js'
import { MemoryEvolutionService } from '../memory-evolution.service.js'
import type { EvolutionVerdict } from '../memory-evolution.service.js'
import { gateCases } from './gate-cases.js'
import { searchCases } from './search-cases.js'
import type { GateCase, GateOutcome, SearchCase } from './types.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const WORKSPACE_ID = 'ws-eval'
const AGENT_ID = 'agt-eval'

/** outcome 归一：rejected-* 与 noop 都算"无变化"（DB 层面均无副作用） */
type NormalizedOutcome = 'written' | 'updated' | 'invalidated' | 'no-change'
function normalize(o: GateOutcome): NormalizedOutcome {
  if (o === 'written' || o === 'updated' || o === 'invalidated') return o
  return 'no-change' // noop + rejected-* + rejected-transient + rejected-confidence + rejected-sensitive
}

function scopeRefFor(scope: MemoryCandidate['scope']): string | null {
  if (scope === 'project') return WORKSPACE_ID
  if (scope === 'agent') return AGENT_ID
  return null
}

describe('memory eval', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let store: MemoryStoreService
  let testDir: string
  const gateResults: Array<{ id: string; ok: boolean; expected: GateOutcome; got: NormalizedOutcome }> = []
  const searchResults: Array<{ id: string; recallOk: boolean; exactOk: boolean }> = []

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'eval.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)
    store = new MemoryStoreService(testDir, testDir)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  // ─── 写入闸门评测 ────────────────────────────────────────────────────
  describe('写入闸门 (gate-cases)', () => {
    for (const c of gateCases) {
      it(`${c.id}: ${c.desc}`, async () => {
        // seed existing
        for (const e of c.existing ?? []) {
          const filePath = store.getFilePath(e.row.scope, e.row.scope_ref, e.row.id)
          await store.writeFile(
            {
              meta: {
                id: e.row.id, scope: e.row.scope, scopeRef: e.row.scope_ref, type: e.row.type,
                name: e.row.name, description: e.row.description, confidence: e.row.confidence,
                createdAt: Date.now(), updatedAt: Date.now(), hitCount: e.row.hit_count,
                lastHitAt: e.row.last_hit_at, sourceSessionId: e.row.source_session_id,
                links: [], archived: false,
              },
              body: e.body ?? '',
            },
          )
          repo.insert(e.row, e.body)
        }

        // mock callLLM 返回单候选；mock evolution（若提供）
        const callLLM = async () => JSON.stringify([stripForLlm(c.candidate)])
        let evolutionService: MemoryEvolutionService | null = null
        if (c.evolution) {
          const targetId =
            c.evolution.targetIndex != null && c.existing
              ? (c.existing[c.evolution.targetIndex]?.row.id ?? null)
              : null
          const verdict: EvolutionVerdict = {
            decision: c.evolution.decision,
            targetId,
            reason: 'eval-mock',
          }
          evolutionService = { decide: async () => verdict } as unknown as MemoryEvolutionService
        }
        const entityRepo = new MemoryEntityRepository(db)
        const writer = new MemoryWriterService(repo, store, () => null, callLLM, evolutionService, entityRepo)
        await writer.maybeWriteFromTurn({
          sessionId: 'sess-eval',
          workspaceId: WORKSPACE_ID,
          agentId: AGENT_ID,
          userMessage: '',
          assistantMessage: '',
          recentSummary: '',
        })

        // 判定 outcome
        const scopeRef = scopeRefFor(c.candidate.scope)
        const newEntry = repo.findByName(c.candidate.scope, scopeRef, c.candidate.name)
        let got: NormalizedOutcome = 'no-change'
        if (newEntry) {
          got = 'written'
        } else if (c.evolution?.targetIndex != null && c.existing?.[c.evolution.targetIndex]) {
          const target = repo.getById(c.existing[c.evolution.targetIndex]!.row.id)
          if (target?.invalid_at != null) got = 'invalidated'
          else if (target && target.description === c.candidate.description && target.description !== c.existing[c.evolution.targetIndex]!.row.description) got = 'updated'
        }
        const expected = normalize(c.expect.outcome)
        const ok = got === expected
        gateResults.push({ id: c.id, ok, expected: c.expect.outcome, got })
        expect(got, `${c.id}: expected ${expected}, got ${got}`).toBe(expected)
      })
    }
  })

  // ─── 检索召回评测 ────────────────────────────────────────────────────
  describe('检索召回 (search-cases)', () => {
    for (const c of searchCases as SearchCase[]) {
      it(`${c.id}: ${c.desc}`, () => {
        // seed（直接 repo.insert 传 body，FTS 索引 name+description+body）
        for (const s of c.seed) {
          repo.insert(s.row as MemoryEntryInsert, s.body)
        }
        const hits = searchRepo
          .searchBm25(c.query, {
            scopes: [{ scope: 'user', scopeRef: null }],
            ...(c.opts?.type != null ? { type: c.opts.type } : {}),
            limit: c.opts?.limit ?? 20,
          })
          .map((h) => h.entry.id)
        const hitSet = new Set(hits)
        const expectedSet = new Set(c.expectIds)
        // recall：期望集 ⊆ 实际召回集
        const recallOk = c.expectIds.every((id) => hitSet.has(id))
        // exact：实际召回集 == 期望集（若要求）
        const exactOk = c.expectExact ? hits.length === c.expectIds.length && [...expectedSet].every((id) => hitSet.has(id)) : true
        searchResults.push({ id: c.id, recallOk, exactOk })
        expect(recallOk, `${c.id}: recall fail — expected ${JSON.stringify(c.expectIds)} ⊆ got ${JSON.stringify(hits)}`).toBe(true)
        if (c.expectExact) expect(exactOk, `${c.id}: exact fail — got ${JSON.stringify(hits)}`).toBe(true)
      })
    }
  })

  // ─── 汇总报告 ────────────────────────────────────────────────────────
  describe('汇总', () => {
    it('precision/recall 报告（非断言，仅展示）', () => {
      const gatePass = gateResults.filter((r) => r.ok).length
      const searchPass = searchResults.filter((r) => r.recallOk && r.exactOk).length
      const report = [
        `\n═══ 记忆评测汇总 ═══`,
        `gate:   ${gatePass}/${gateResults.length} precision = ${gateResults.length ? ((gatePass / gateResults.length) * 100).toFixed(1) : '0'}%`,
        `search: ${searchPass}/${searchResults.length} recall    = ${searchResults.length ? ((searchPass / searchResults.length) * 100).toFixed(1) : '0'}%`,
      ]
      if (gateResults.some((r) => !r.ok)) report.push('gate 失败:', ...gateResults.filter((r) => !r.ok).map((r) => `  ${r.id}: expected ${r.expected} got ${r.got}`))
      if (searchResults.some((r) => !r.recallOk || !r.exactOk)) report.push('search 失败:', ...searchResults.filter((r) => !r.recallOk || !r.exactOk).map((r) => `  ${r.id}`))
      // eslint-disable-next-line no-console
      console.log(report.join('\n'))
      // 确定性评测：应全绿（任何失败上面 it 已断言抛错）
      expect(gatePass).toBe(gateResults.length)
      expect(searchPass).toBe(searchResults.length)
    })
  })
})

/** 候选转 LLM JSON 格式（去 TypeScript 专属字段） */
function stripForLlm(c: MemoryCandidate): Record<string, unknown> {
  return { scope: c.scope, type: c.type, name: c.name, description: c.description, body: c.body, confidence: c.confidence, ...(c.entities != null ? { entities: c.entities } : {}), ...(c.links != null ? { links: c.links } : {}) }
}
