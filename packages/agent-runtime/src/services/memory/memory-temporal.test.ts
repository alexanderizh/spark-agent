/**
 * @module memory-temporal.test
 *
 * 单元测试：valid_until 精度/时区表达（S2.6 / N5）+ 到期读取语义（N5/N7）。
 *
 * N5：下月起改用新地址 → 旧值有效期到本月底（本地日结束，exclusive），
 *      本月仍适用、下月不再作为当前事实。
 * N7：到期（旧临时约束）后不自动恢复 —— 默认列表/检索不再返回；按 id 的
 *      recall 返回带历史标注；长期条目（无 valid_until）不受影响仍可召回。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRepository, MemorySearchRepository, SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryWriterService } from './memory-writer.service.js'
import { MemoryReaderService } from './memory-reader.service.js'
import { resolveValidUntil, localDayEndExclusive, describeValidUntil } from './memory-temporal.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('memory-temporal（S2.6 时效语义）', () => {
  describe('resolveValidUntil（精度/时区规范化）', () => {
    it('instant：完整 ISO 时间直接换算', () => {
      const r = resolveValidUntil({
        validUntil: '2026-10-01T00:00:00Z',
        precision: 'instant',
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.untilMs).toBe(Date.UTC(2026, 9, 1))
      expect(r.meta.precision).toBe('instant')
    })

    it('instant：非法时间表达结构化拒绝', () => {
      const r = resolveValidUntil({ validUntil: '下个月', precision: 'instant' })
      expect(r.ok).toBe(false)
    })

    it('date：本地日结束（exclusive）换算 —— 上海时区', () => {
      // 2026-09-30 上海（UTC+8，无 DST）：次日 00:00 = 2026-09-30T16:00:00Z
      expect(localDayEndExclusive('2026-09-30', 'Asia/Shanghai')).toBe(
        Date.UTC(2026, 8, 30, 16, 0, 0),
      )
      const r = resolveValidUntil({
        validUntil: '2026-09-30',
        precision: 'date',
        timezone: 'Asia/Shanghai',
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.untilMs).toBe(Date.UTC(2026, 8, 30, 16, 0, 0))
      expect(r.meta).toEqual({ precision: 'date', timezone: 'Asia/Shanghai' })
    })

    it('date：DST 时区（纽约 3 月春令时边界）换算正确', () => {
      // 2026-03-08 是美国春令时日（2:00 跳 3:00）。次日 00:00（3/9）在 EDT（-4h）
      // = 2026-03-09T04:00:00Z
      expect(localDayEndExclusive('2026-03-08', 'America/New_York')).toBe(
        Date.UTC(2026, 2, 9, 4, 0, 0),
      )
    })

    it('date：非法日期与时区结构化拒绝（不捏造）', () => {
      expect(localDayEndExclusive('2026-02-30', 'Asia/Shanghai')).toBeNull()
      expect(localDayEndExclusive('2026-13-01', 'Asia/Shanghai')).toBeNull()
      expect(localDayEndExclusive('2026-10-01', 'Not/AZone')).toBeNull()
      const r = resolveValidUntil({ validUntil: '10月', precision: 'date' })
      expect(r.ok).toBe(false)
    })

    it('describeValidUntil：date 精度按原始时区展示最后适用日', () => {
      const untilMs = Date.UTC(2026, 8, 30, 16, 0, 0)
      const text = describeValidUntil(
        untilMs,
        JSON.stringify({ precision: 'date', timezone: 'Asia/Shanghai' }),
      )
      expect(text).toContain('2026-09-30')
      expect(text).toContain('Asia/Shanghai')
      expect(text).toContain('按日精度')
    })
  })

  describe('到期读取语义（N5/N7，真实 DB）', () => {
    let db: SparkDatabase
    let repo: MemoryRepository
    let searchRepo: MemorySearchRepository
    let store: MemoryStoreService
    let writer: MemoryWriterService
    let reader: MemoryReaderService
    let testDir: string

    beforeEach(() => {
      testDir = join(
        tmpdir(),
        `spark-temporal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      mkdirSync(testDir, { recursive: true })
      db = new SparkDatabase(join(testDir, 'test.db'))
      db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
      repo = new MemoryRepository(db)
      searchRepo = new MemorySearchRepository(db)
      store = new MemoryStoreService(testDir, join(testDir, 'ws'))
      writer = new MemoryWriterService(
        repo,
        store,
        () => null,
        async () => '[]',
      )
      reader = new MemoryReaderService(repo, store, () => null)
    })

    afterEach(() => {
      db.close()
      rmSync(testDir, { recursive: true, force: true })
    })

    it('N5：旧地址有效期到本月底 —— 本月仍适用，到期不再作为当前事实', async () => {
      // 手工创建：旧部署地址，有效期至本月底（上海，按日）——相对当前时间
      // 未来 → 仍是当前事实。日期动态取本月最后一天（00:00 CST = 前一日
      // 16:00Z），避免硬编码日历日随时间流逝腐烂（曾硬编码 2026-09-30，
      // 过期后该用例恒挂）。注：仅在 UTC 月末最后 8 小时内跑会踩边界。
      const now = new Date()
      const endOfMonthMs = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        0,
        16,
        0,
        0,
      )
      const endOfMonthDate = new Date(endOfMonthMs).toISOString().slice(0, 10)
      const r = await writer.manualWrite({
        scope: 'user',
        type: 'reference',
        name: 'deploy-address-old',
        description: '部署地址：旧机房（月底前适用）',
        body: '部署目标：旧机房 A（月底前适用，下月迁新址）',
        scopeRef: null,
        validUntil: { validUntil: endOfMonthDate, precision: 'date', timezone: 'Asia/Shanghai' },
      })
      expect(r.valid_until).toBe(endOfMonthMs)
      expect(r.valid_until_meta).toContain('"date"')
      // 本月（未到期）：列表可见 + FTS 可检索
      expect(repo.listByScope('user', null).some((e) => e.id === r.id)).toBe(true)
      expect(searchRepo.searchBm25('旧机房')).toHaveLength(1)

      // 推进到到期之后：直接把 valid_until 改到过去（等价时间流逝）
      db.raw
        .prepare('UPDATE memory_entry SET valid_until = ? WHERE id = ?')
        .run(Date.now() - 1000, r.id)
      // N5/N7：到期不作为当前事实 —— 列表默认不含、检索不返回
      expect(repo.listByScope('user', null).some((e) => e.id === r.id)).toBe(false)
      expect(searchRepo.searchBm25('旧机房')).toHaveLength(0)
      // 含失效视图（审计/历史）仍可见 —— 到期 ≠ 删除
      const audit = repo.listByScope('user', null, { includeInvalid: true })
      expect(audit.some((e) => e.id === r.id)).toBe(true)

      // N10：按 id recall 返回带历史标注（不当当前事实）
      const recalled = await reader.recall(r.id, {
        allowedScopes: [{ scope: 'user', scopeRef: null }],
        caller: 'test',
      })
      expect(recalled.error).toBeUndefined()
      expect(recalled.content).toContain('有效期已结束')
      expect(recalled.content).toContain('旧机房')
    })

    it('N7：长期条目（无有效期）不受到期语义影响，仍可召回', async () => {
      const longTerm = await writer.manualWrite({
        scope: 'user',
        type: 'feedback',
        name: 'long-term-pref',
        description: '长期偏好：回复用中文',
        body: '长期偏好：所有回复使用中文。',
        scopeRef: null,
      })
      expect(longTerm.valid_until).toBeNull()
      expect(repo.listByScope('user', null).some((e) => e.id === longTerm.id)).toBe(true)
      const recalled = await reader.recall(longTerm.id, {
        allowedScopes: [{ scope: 'user', scopeRef: null }],
        caller: 'test',
      })
      expect(recalled.content).toContain('中文')
      expect(recalled.content).not.toContain('有效期已结束')
    })

    it('非法有效期输入结构化拒绝（VALIDATION_FAILED），不落库', async () => {
      await expect(
        writer.manualWrite({
          scope: 'user',
          type: 'reference',
          name: 'bad-temporal',
          description: '非法有效期',
          body: '正文',
          scopeRef: null,
          validUntil: { validUntil: '2026-02-30', precision: 'date' },
        }),
      ).rejects.toThrow('有效期设置无效')
      expect(repo.findByName('user', null, 'bad-temporal')).toBeNull()
    })
  })
})
