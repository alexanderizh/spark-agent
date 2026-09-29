/**
 * @module wiki-s2.e2e.test
 *
 * S2 出口验收（抽取管道）：对话 → 候选 →（用户确认）→ 页面 + 溯源。
 *
 * 全部断言基于真实 DB（migration 112 + 113）与真实文件系统；模型调用被替换为
 * 可注入的假实现（**不联网**），因此这里验证的是管道语义而不是模型质量：
 *   - 触发闸门（§9.6：manual 默认开、milestone 默认开、idle/schedule 默认关）；
 *   - 增量水位线（失败不推进、成功才推进、重复蒸馏不重复征集）；
 *   - 严格解析（turnIndex 不在采样集合内 → 作废）；
 *   - 人审门（模型自称确认无效；digest 失配拒绝；确认后正文原文落库）；
 *   - 溯源绑定（wiki_source 落到页面，来源轮次可回溯）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventRepository, SessionRepository, SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createWikiServiceStack, type WikiServiceStack } from './wiki-service-stack.js'
import type {
  WikiExtractionModelCall,
  WikiExtractionTargetResolver,
} from './wiki-extraction.service.js'

const LONG_USER =
  '我们线上 SQLite 的 FTS5 contentless 表在增量更新时检索不到新行，需要定位根因并修复。'
const LONG_ASSISTANT =
  '根因是 contentless 表不存原文，增量更新必须显式 DELETE 旧行再 INSERT 新行，' +
  '否则同事务里的 FTS 索引会和外表不一致，后续查询直接漏数据。修复方式见下面的迁移脚本。'

/** 一条合法候选的模型输出（turnIndex=1 对应采样第一轮）。 */
function modelOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      kind: 'experience',
      title: 'contentless FTS 增量更新必须显式 DELETE',
      summary: 'contentless 表不存原文，增量更新要显式清理旧行。',
      body: '## 是什么\ncontentless 表只存索引。\n\n## 为什么\n省空间。\n\n## 怎么做\n先 DELETE 再 INSERT。',
      tags: ['sqlite', 'fts'],
      confidence: 0.86,
      rationale: '根因清晰且可复用',
      turnIndex: 1,
      excerpt: 'contentless 不会自动清旧行',
      ...overrides,
    },
  ])
}

describe('Wiki S2 e2e（抽取管道 / 人审门 / 增量水位线）', () => {
  let db: SparkDatabase
  let stack: WikiServiceStack
  let dir: string
  let sessionId: string
  let calls: WikiExtractionModelCall
  let resolveTarget: WikiExtractionTargetResolver
  let lastPrompt: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-wiki-s2-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))

    sessionId = 'sess_e2e'
    new SessionRepository(db).create({
      id: sessionId,
      kind: 'chat',
      title: '定位 FTS 问题',
      status: 'idle',
      projectId: 'prj_1',
      workspaceIds: [],
      agentAdapter: 'claude',
      agentId: 'agent_1',
      permissionMode: 'default',
      chatMode: 'agent',
      reasoningEffort: 'medium',
    })
    appendTurn(db, sessionId, 't1', LONG_USER, LONG_ASSISTANT)

    lastPrompt = ''
    // 假模型从 prompt 里读真实轮次编号：强制溯源要求 turnIndex 必须落在本次
    // 采样集合内，写死编号会让第二批采样全部判废（那正是管道该有的行为）。
    calls = async (params) => {
      lastPrompt = params.prompt
      const matched = /\[第(\d+)轮\]/.exec(params.prompt)
      return modelOutput(matched != null ? { turnIndex: Number(matched[1]) } : {})
    }
    // 测试环境没有 Keychain：渠道解析与模型调用都换成可注入实现，
    // 这样验证的是管道语义（闸门 / 增量 / 解析 / 人审）而不是渠道可用性。
    resolveTarget = async () => ({
      ok: true as const,
      target: {
        providerType: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-haiku-test',
      },
    })
    stack = makeStack({ extractionCallModel: calls })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** 当前生效的设置（默认策略：manual/milestone 开，其余关）。 */
  function settingsOf(category: string, key: string): unknown {
    if (category !== 'wiki') return undefined
    switch (key) {
      case 'extract/manual':
        return true
      case 'extract/milestone':
        return true
      case 'extract/enabled':
        return false
      case 'extract/idle':
        return false
      case 'extract/schedule':
        return false
      case 'candidate/ttlDays':
        return 14
      case 'candidate/maxPending':
        return 200
      case 'extract/modelProfile':
        return ''
      default:
        return undefined
    }
  }

  /** 构造服务栈（默认注入假渠道 + 默认设置；可按需覆盖）。 */
  function makeStack(overrides: {
    extractionCallModel?: WikiExtractionModelCall
    settingsGet?: (category: string, key: string) => unknown
    extractionResolveTarget?: WikiExtractionTargetResolver
  }): WikiServiceStack {
    return createWikiServiceStack({
      db,
      appHomeDir: dir,
      settingsGet: overrides.settingsGet ?? ((category, key) => settingsOf(category, key)),
      extractionCallModel: overrides.extractionCallModel ?? calls,
      extractionResolveTarget: overrides.extractionResolveTarget ?? resolveTarget,
    })
  }

  // ─── 触发闸门 ──────────────────────────────────────────────────────

  it('manual 触发默认放行并产出候选', async () => {
    const receipt = await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(true)
    expect(receipt.inserted).toBe(1)
    expect(receipt.sampledTurns).toBe(1)

    const pending = stack.candidateRepo.listByStatus('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.scope).toBe('user')
    expect(pending[0]!.space_id).toBeNull()
  })

  it('milestone 触发默认放行', async () => {
    const receipt = await stack.extractionService.distill({ sessionId, trigger: 'milestone' })
    expect(receipt.ok).toBe(true)
    expect(receipt.inserted).toBe(1)
  })

  it('idle / schedule 默认关闭（总闸未开）', async () => {
    const idle = await stack.extractionService.distill({ sessionId, trigger: 'idle' })
    expect(idle.ok).toBe(false)
    if (!idle.ok) expect(idle.reason).toBe('disabled')

    const schedule = await stack.extractionService.distill({ sessionId, trigger: 'schedule' })
    expect(schedule.ok).toBe(false)
    if (!schedule.ok) expect(schedule.reason).toBe('disabled')
  })

  it('manual 被设置关掉后同样拒绝（不绕过总闸）', async () => {
    const blocked = makeStack({
      settingsGet: (category, key) =>
        key === 'extract/manual' ? false : settingsOf(category, key),
    })
    const receipt = await blocked.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe('disabled')
  })

  // ─── 增量水位线 ────────────────────────────────────────────────────

  it('增量：第二次蒸馏只喂新增轮次', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(lastPrompt).toContain('[第1轮]')

    appendTurn(db, sessionId, 't2', LONG_USER, LONG_ASSISTANT)
    const receipt = await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(true)
    expect(lastPrompt).toContain('[第2轮]')
    expect(lastPrompt).not.toContain('[第1轮]')
  })

  it('模型失败不推进水位线，重试可重跑同一批轮次', async () => {
    const failing = makeStack({ extractionCallModel: async () => null })
    const failed = await failing.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toBe('model_failed')
    expect(stack.extractionStateRepo.watermark(sessionId)).toBe(0)

    const retried = await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(retried.ok).toBe(true)
    expect(retried.inserted).toBe(1)
    expect(stack.extractionStateRepo.watermark(sessionId)).toBe(1)
  })

  it('无新增有意义轮次时不调模型（不烧钱）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    let called = 0
    const counting = makeStack({
      extractionCallModel: async (params) => {
        called += 1
        return calls(params)
      },
    })
    const receipt = await counting.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(true)
    expect(receipt.sampledTurns).toBe(0)
    expect(receipt.inserted).toBe(0)
    expect(called).toBe(0)
  })

  // ─── 严格解析 ──────────────────────────────────────────────────────

  it('turnIndex 不在采样集合内的输出整批判废（无来源不入库）', async () => {
    const bogus = makeStack({ extractionCallModel: async () => modelOutput({ turnIndex: 99 }) })
    const receipt = await bogus.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe('invalid_output')
    expect(stack.candidateRepo.countPending('user', null)).toBe(0)
  })

  it('非 JSON 输出判废并记录原因', async () => {
    const bogus = makeStack({
      extractionCallModel: async () => '这段对话很有价值，建议记下来',
    })
    const receipt = await bogus.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe('invalid_output')
    expect(stack.extractionStateRepo.get(sessionId)?.last_error).toBe('not_json')
  })

  // ─── 人审门与晋级 ──────────────────────────────────────────────────

  it('确认：按 payload 原文落库为页面 + 绑定溯源 + 候选回填', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    const payload = stack.candidateRepo.parsePayload(candidate)!

    const confirmed = await stack.candidateService.confirm({
      id: candidate.id,
      digest: candidate.content_digest,
    })
    expect(confirmed.ok).toBe(true)
    const pageId = confirmed.pageId!
    expect(pageId).toBeTruthy()

    // 正文按原文落库（不是摘要、不是改写版）
    const read = await stack.pageService.readFull(pageId)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.body).toBe(payload.body)
    expect(read.page.title).toBe(payload.title)
    expect(read.page.author_role).toBe('extraction')

    // 溯源：来源轮次与依据片段都落到页面上
    const sources = stack.sourceRepo.listByPage(pageId)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.session_id).toBe(sessionId)
    expect(sources[0]!.turn_index).toBe(1)
    expect(sources[0]!.excerpt).toBe(payload.sources[0]!.excerpt)

    // 候选回填页面 id，状态 confirmed
    const after = stack.candidateRepo.getById(candidate.id)!
    expect(after.status).toBe('confirmed')
    expect(after.page_id).toBe(pageId)
    expect(after.decided_via).toBe('user_ipc')
  })

  it('digest 失配拒绝确认（所见即所存）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    const result = await stack.candidateService.confirm({
      id: candidate.id,
      digest: '0'.repeat(32),
    })
    expect(result.ok).toBe(false)
    expect(stack.candidateRepo.getById(candidate.id)!.status).toBe('pending')
  })

  it('拒绝：候选 rejected，不产生页面', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    expect(stack.candidateService.reject(candidate.id).ok).toBe(true)
    expect(stack.candidateRepo.getById(candidate.id)!.status).toBe('rejected')
    expect(stack.candidateService.list('pending').items).toHaveLength(0)
  })

  it('确认到指定空间：正文落该空间，而不是默认空间', async () => {
    const space = await stack.writeService.createSpace({ scope: 'user', name: '指定空间' })
    expect(space.ok).toBe(true)
    if (!space.ok) return

    await stack.extractionService.distill({
      sessionId,
      trigger: 'manual',
      spaceId: space.row.id,
    })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    expect(candidate.space_id).toBe(space.row.id)

    const confirmed = await stack.candidateService.confirm({
      id: candidate.id,
      digest: candidate.content_digest,
      spaceId: space.row.id,
    })
    expect(confirmed.ok).toBe(true)
    const page = stack.pageRepo.getById(confirmed.pageId!)!
    expect(page.space_id).toBe(space.row.id)
  })

  it('无既有空间时确认兜底新建默认空间（不留"已确认但无页面"死角）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    const confirmed = await stack.candidateService.confirm({
      id: candidate.id,
      digest: candidate.content_digest,
    })
    expect(confirmed.ok).toBe(true)
    const page = stack.pageRepo.getById(confirmed.pageId!)!
    const space = stack.spaceRepo.getById(page.space_id)!
    expect(space.name).toBe('我的知识库')
    expect(space.scope).toBe('user')
  })

  // ─── 去重与列表 ────────────────────────────────────────────────────

  it('同摘要重复蒸馏不重复征集（另一段会话产出同内容知识）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })

    // 另建一段内容等价的会话：模型同样产出那条候选，但同 scope 同摘要已被征集过。
    const otherSession = 'sess_e2e_dup'
    new SessionRepository(db).create({
      id: otherSession,
      kind: 'chat',
      title: '另一个 FTS 问题',
      status: 'idle',
      projectId: 'prj_1',
      workspaceIds: [],
      agentAdapter: 'claude',
      agentId: 'agent_1',
      permissionMode: 'default',
      chatMode: 'agent',
      reasoningEffort: 'medium',
    })
    appendTurn(db, otherSession, 't1', LONG_USER, LONG_ASSISTANT)

    const receipt = await stack.extractionService.distill({
      sessionId: otherSession,
      trigger: 'manual',
    })
    expect(receipt.ok).toBe(true)
    expect(receipt.inserted).toBe(0)
    expect(receipt.duplicates).toBe(1)
    expect(stack.candidateRepo.countPending('user', null)).toBe(1)
  })

  it('候选区列表携带 digest 与依据（UI 确认绑定所需）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const list = stack.candidateService.list('pending')
    expect(list.items).toHaveLength(1)
    const item = list.items[0]!
    expect(item.digest).toMatch(/^[a-f0-9]{32}$/)
    expect(item.sources).toHaveLength(1)
    expect(item.sources[0]!.turnIndex).toBe(1)
    expect(item.kind).toBe('experience')
    expect(list.pendingTotal).toBe(1)
  })

  it('候选 payload 损坏时列表跳过该行（不把损坏数据透给 UI）', async () => {
    await stack.extractionService.distill({ sessionId, trigger: 'manual' })
    const candidate = stack.candidateRepo.listByStatus('pending')[0]!
    db.raw
      .prepare(`UPDATE wiki_candidate SET payload_json = ? WHERE id = ?`)
      .run('{ broken', candidate.id)
    const list = stack.candidateService.list('pending')
    expect(list.items).toHaveLength(0)
  })

  it('会话不存在时返回结构化失败而不是抛异常', async () => {
    const receipt = await stack.extractionService.distill({
      sessionId: 'sess_missing',
      trigger: 'manual',
    })
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe('dialogue_empty')
  })

  it('没有可用抽取渠道时返回 no_provider（不抛到主链路）', async () => {
    // 渠道解析失败（模拟 Keychain 取不到 key）→ no_provider，不抛到主链路
    const noChannel = makeStack({
      extractionResolveTarget: async () => ({ ok: false as const, code: 'provider_no_api_key' }),
    })
    const receipt = await noChannel.extractionService.distill({ sessionId, trigger: 'manual' })
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe('no_provider')
  })
})

let eventSeq = 0

/** 追加一轮对话事件（user_message + assistant_message complete）。 */
function appendTurn(
  db: SparkDatabase,
  sessionId: string,
  turnId: string,
  user: string,
  assistant: string,
): void {
  const repo = new EventRepository(db)
  const base = Date.now()
  eventSeq += 2
  const eventIdPrefix = `${sessionId}_${turnId}`
  const events: AgentEvent[] = [
    {
      type: 'user_message',
      id: `${eventIdPrefix}_u`,
      turnId,
      timestamp: new Date(base).toISOString(),
      seq: eventSeq - 1,
      content: user,
    } as unknown as AgentEvent,
    {
      type: 'assistant_message',
      id: `${eventIdPrefix}_a`,
      turnId,
      timestamp: new Date(base + 1).toISOString(),
      seq: eventSeq,
      mode: 'complete',
      content: assistant,
      isFinal: true,
    } as unknown as AgentEvent,
  ]
  for (const event of events) {
    repo.insert({
      id: event.id,
      sessionId,
      turnId,
      eventType: event.type,
      eventJson: JSON.stringify(event),
    })
  }
}
