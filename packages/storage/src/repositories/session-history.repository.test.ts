import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { EventRepository } from './event.repository.js'
import { SessionHistoryRepository } from './session-history.repository.js'
import { SessionRepository } from './session.repository.js'

function createDatabase(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'history.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

interface AddEventInput {
  id: string
  sessionId: string
  turnId: string
  seq: number
  type: string
  mode?: 'delta' | 'complete'
  content?: string
  status?: string
  userMessageVisibility?: 'visible' | 'hidden'
  userMessageDisplayContent?: string
  toolName?: string
  toolCallId?: string
  toolInput?: Record<string, unknown>
  output?: unknown
  error?: string
  changeType?: string
  path?: string
  summary?: string
}

function addEvent(events: EventRepository, input: AddEventInput): void {
  events.insert({
    id: input.id,
    sessionId: input.sessionId,
    turnId: input.turnId,
    eventType: input.type,
    eventJson: JSON.stringify({
      id: input.id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      seq: input.seq,
      type: input.type,
      ...(input.mode != null ? { mode: input.mode } : {}),
      ...(input.content != null ? { content: input.content } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.userMessageVisibility != null
        ? { userMessageVisibility: input.userMessageVisibility }
        : {}),
      ...(input.userMessageDisplayContent != null
        ? { userMessageDisplayContent: input.userMessageDisplayContent }
        : {}),
      ...(input.toolName != null ? { toolName: input.toolName } : {}),
      ...(input.toolCallId != null ? { toolCallId: input.toolCallId } : {}),
      ...(input.toolInput != null ? { toolInput: input.toolInput } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.error != null ? { error: input.error } : {}),
      ...(input.changeType != null ? { changeType: input.changeType } : {}),
      ...(input.path != null ? { path: input.path } : {}),
      ...(input.summary != null ? { summary: input.summary } : {}),
    }),
  })
}

describe('SessionHistoryRepository', () => {
  let db: SparkDatabase
  let testDir: string
  let sessions: SessionRepository
  let events: EventRepository
  let history: SessionHistoryRepository

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-session-history-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
    db = createDatabase(testDir)
    sessions = new SessionRepository(db)
    events = new EventRepository(db)
    history = new SessionHistoryRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedSession(sessionId: string): void {
    sessions.create({
      id: sessionId,
      kind: 'chat',
      title: `session-${sessionId}`,
      status: 'idle',
      projectId: 'project-1',
    })
  }

  it('readTurns returns full-fidelity content including tool call input and output', () => {
    seedSession('s1')
    addEvent(events, {
      id: 'e0', sessionId: 's1', turnId: 't1', seq: 0, type: 'user_message',
      content: '列出 src 目录',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's1', turnId: 't1', seq: 1, type: 'tool_call',
      toolName: 'Bash', toolCallId: 'call-1', toolInput: { command: 'ls src', description: '列出目录' },
    })
    addEvent(events, {
      id: 'e2', sessionId: 's1', turnId: 't1', seq: 2, type: 'tool_result',
      toolName: 'Bash', toolCallId: 'call-1', status: 'success', output: 'main.ts\nutils.ts',
    })
    addEvent(events, {
      id: 'e3', sessionId: 's1', turnId: 't1', seq: 3, type: 'assistant_message',
      mode: 'complete', content: 'src 下有两个文件',
    })
    addEvent(events, {
      id: 'e4', sessionId: 's1', turnId: 't1', seq: 4, type: 'agent_status', status: 'completed',
    })

    const page = history.readTurns({ sessionId: 's1' })
    expect(page.turns).toHaveLength(1)
    const turn = page.turns[0]!
    expect(turn.turnId).toBe('t1')
    expect(turn.partial).toBe(false)
    expect(turn.events.map((event) => event.eventType)).toEqual([
      'user_message', 'tool_call', 'tool_result', 'assistant_message', 'agent_status',
    ])
    const [user, call, result, assistant, status] = turn.events
    expect(user!.content).toBe('列出 src 目录')
    expect(user!.role).toBe('user')
    expect(call!.toolName).toBe('Bash')
    expect(call!.content).toContain('"command":"ls src"')
    expect(result!.content).toContain('[success] output: main.ts\nutils.ts')
    expect(assistant!.role).toBe('assistant')
    expect(status!.content).toContain('turn ended: completed')
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('excludes hidden user messages, delta rows, and turn prompt snapshots', () => {
    seedSession('s2')
    addEvent(events, {
      id: 'e0', sessionId: 's2', turnId: 't1', seq: 0, type: 'user_message',
      content: '可见提问',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's2', turnId: 't1', seq: 1, type: 'user_message',
      userMessageVisibility: 'hidden', content: '内部续跑提示', userMessageDisplayContent: '(内部)',
    })
    addEvent(events, {
      id: 'e2', sessionId: 's2', turnId: 't1', seq: 2, type: 'assistant_message',
      mode: 'delta', content: '流式碎片',
    })
    addEvent(events, {
      id: 'e3', sessionId: 's2', turnId: 't1', seq: 3, type: 'turn_prompt_snapshot',
      content: 'system-prompt-should-not-leak',
    })
    addEvent(events, {
      id: 'e4', sessionId: 's2', turnId: 't1', seq: 4, type: 'assistant_message',
      mode: 'complete', content: '最终回答',
    })

    const page = history.readTurns({ sessionId: 's2' })
    const types = page.turns[0]!.events.map((event) => event.eventType)
    expect(types).toEqual(['user_message', 'assistant_message'])
    expect(JSON.stringify(page)).not.toContain('system-prompt-should-not-leak')
    expect(JSON.stringify(page)).not.toContain('内部续跑提示')

    // 检索同样不命中被排除的内容
    const hits = history.searchEvents({ sessionId: 's2', query: '内部续跑' })
    expect(hits.hits).toHaveLength(0)
  })

  it('passes tool result envelopes through untouched', () => {
    seedSession('s3')
    const envelope = {
      kind: 'spark.tool_result_envelope',
      version: 1,
      toolName: 'Bash',
      preview: 'head of output',
      artifact: { artifactId: 'a'.repeat(64), bytes: 12345 },
    }
    addEvent(events, {
      id: 'e0', sessionId: 's3', turnId: 't1', seq: 0, type: 'tool_result',
      toolName: 'Bash', status: 'success', output: envelope,
    })

    const page = history.readTurns({ sessionId: 's3' })
    const content = page.turns[0]!.events[0]!.content
    expect(content).toContain('spark.tool_result_envelope')
    expect(content).toContain('a'.repeat(64))
  })

  it('includes context compaction events in read and search', () => {
    seedSession('s4')
    addEvent(events, {
      id: 'e0', sessionId: 's4', turnId: 't1', seq: 0, type: 'context_compaction',
      summary: '早期讨论了迁移方案 v2',
    })
    const page = history.readTurns({ sessionId: 's4' })
    const event = page.turns[0]!.events[0]!
    expect(event.eventType).toBe('context_compaction')
    expect(event.role).toBe('system')
    expect(event.content).toContain('迁移方案 v2')

    const hits = history.searchEvents({ sessionId: 's4', query: '迁移方案' })
    expect(hits.hits).toHaveLength(1)
    expect(hits.hits[0]!.snippet).toContain('迁移方案 v2')
  })

  it('isolates queries to the requested session', () => {
    seedSession('s5a')
    seedSession('s5b')
    addEvent(events, {
      id: 'e0', sessionId: 's5a', turnId: 't1', seq: 0, type: 'user_message', content: '会话 A',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's5b', turnId: 't2', seq: 0, type: 'user_message', content: '会话 B',
    })

    expect(history.readTurns({ sessionId: 's5a' }).turns[0]!.events[0]!.content).toBe('会话 A')
    expect(history.readTurns({ sessionId: 's5b' }).turns[0]!.events[0]!.content).toBe('会话 B')
    expect(history.searchEvents({ sessionId: 's5a', query: '会话 B' }).hits).toHaveLength(0)
    // 其他会话的 turnId+seq 定点读取不可达
    expect(
      history.readEvent({ sessionId: 's5a', turnId: 't2', seq: 0 }),
    ).toBeNull()
  })

  it('paginates asc across turns without duplication or omission', () => {
    seedSession('s6')
    const expected: string[] = []
    let seq = 0
    for (let turnIndex = 0; turnIndex < 6; turnIndex += 1) {
      addEvent(events, {
        id: `u${turnIndex}`, sessionId: 's6', turnId: `turn-${turnIndex}`, seq,
        type: 'user_message', content: `第 ${turnIndex} 轮提问`,
      })
      expected.push(`u${turnIndex}`)
      seq += 1
      for (let toolIndex = 0; toolIndex < 3; toolIndex += 1) {
        addEvent(events, {
          id: `t${turnIndex}-${toolIndex}`, sessionId: 's6', turnId: `turn-${turnIndex}`, seq,
          type: 'tool_result', toolName: 'Read', status: 'success',
          output: `turn-${turnIndex} output-${toolIndex}`,
        })
        expected.push(`t${turnIndex}-${toolIndex}`)
        seq += 1
      }
      addEvent(events, {
        id: `a${turnIndex}`, sessionId: 's6', turnId: `turn-${turnIndex}`, seq,
        type: 'assistant_message', mode: 'complete', content: `第 ${turnIndex} 轮回答`,
      })
      expected.push(`a${turnIndex}`)
      seq += 1
    }

    const collected: string[] = []
    let cursor: number | undefined
    let pages = 0
    for (;;) {
      const page = history.readTurns({ sessionId: 's6', turnLimit: 2, ...(cursor != null ? { cursor } : {}) })
      pages += 1
      for (const turn of page.turns) {
        for (const event of turn.events) collected.push(eventIdBySeq(event.seq))
      }
      if (!page.hasMore || page.nextCursor == null) break
      cursor = page.nextCursor
      if (pages > 20) throw new Error('pagination did not terminate')
    }
    expect(pages).toBeGreaterThan(1)
    expect(collected).toEqual(expected)
  })

  function eventIdBySeq(seq: number): string {
    // 由 seed 顺序反查 id：u/a/t 前缀已含轮次信息，这里直接复用 seq→事件行
    const row = events.queryAllBySession('s6').find((event) => event.seq === seq)
    return JSON.parse(row!.event_json).id as string
  }

  it('paginates desc from the newest end and walks back without duplication', () => {
    seedSession('s7')
    for (let turnIndex = 0; turnIndex < 3; turnIndex += 1) {
      addEvent(events, {
        id: `u${turnIndex}`, sessionId: 's7', turnId: `turn-${turnIndex}`, seq: turnIndex * 2,
        type: 'user_message', content: `提问 ${turnIndex}`,
      })
      addEvent(events, {
        id: `a${turnIndex}`, sessionId: 's7', turnId: `turn-${turnIndex}`, seq: turnIndex * 2 + 1,
        type: 'assistant_message', mode: 'complete', content: `回答 ${turnIndex}`,
      })
    }

    const first = history.readTurns({ sessionId: 's7', order: 'desc', turnLimit: 1 })
    // desc 首页取最新轮，但轮内事件仍按时间正序呈现
    expect(first.turns).toHaveLength(1)
    expect(first.turns[0]!.turnId).toBe('turn-2')
    expect(first.turns[0]!.events.map((event) => event.seq)).toEqual([4, 5])

    const second = history.readTurns({
      sessionId: 's7', order: 'desc', turnLimit: 1, cursor: first.nextCursor!,
    })
    expect(second.turns[0]!.turnId).toBe('turn-1')
    const third = history.readTurns({
      sessionId: 's7', order: 'desc', turnLimit: 1, cursor: second.nextCursor!,
    })
    expect(third.turns[0]!.turnId).toBe('turn-0')
    expect(third.hasMore).toBe(false)
  })

  it('truncates oversized items and continues a budget-cut turn on the next page', () => {
    seedSession('s8')
    const long = 'x'.repeat(9_000)
    for (let index = 0; index < 4; index += 1) {
      addEvent(events, {
        id: `r${index}`, sessionId: 's8', turnId: 't1', seq: index,
        type: 'tool_result', toolName: 'Bash', status: 'success', output: long,
      })
    }
    addEvent(events, {
      id: 'u0', sessionId: 's8', turnId: 't2', seq: 4, type: 'user_message', content: '下一轮',
    })

    const first = history.readTurns({ sessionId: 's8' })
    const firstTurn = first.turns[0]!
    expect(firstTurn.turnId).toBe('t1')
    // 页预算 24k / 单条 8k：前 3 条放满，第 4 条触发截断标记
    expect(firstTurn.events).toHaveLength(3)
    expect(firstTurn.partial).toBe(true)
    expect(firstTurn.events.every((event) => event.truncated && event.content.length === 8_000)).toBe(true)
    expect(first.hasMore).toBe(true)

    const second = history.readTurns({ sessionId: 's8', cursor: first.nextCursor! })
    // 下一页无缝续读：同轮第 4 条 + 后续轮次
    const seqs = second.turns.flatMap((turn) => turn.events.map((event) => event.seq))
    expect(seqs).toEqual([3, 4])
  })

  it('reads a single event in full via readEvent', () => {
    seedSession('s9')
    addEvent(events, {
      id: 'e0', sessionId: 's9', turnId: 't1', seq: 0, type: 'tool_result',
      toolName: 'Bash', status: 'success', output: 'y'.repeat(9_000),
    })
    const event = history.readEvent({ sessionId: 's9', turnId: 't1', seq: 0 })
    expect(event).not.toBeNull()
    expect(event!.content.length).toBeGreaterThan(8_000)
    expect(event!.truncated).toBe(false)

    // 不在检索范围内 / 不存在的事件返回 null
    addEvent(events, {
      id: 'e1', sessionId: 's9', turnId: 't1', seq: 1, type: 'turn_prompt_snapshot',
      content: 'secret-prompt',
    })
    expect(history.readEvent({ sessionId: 's9', turnId: 't1', seq: 1 })).toBeNull()
    expect(history.readEvent({ sessionId: 's9', turnId: 't1', seq: 99 })).toBeNull()
  })

  it('searches across messages, tool inputs, outputs and file paths', () => {
    seedSession('s10')
    addEvent(events, {
      id: 'e0', sessionId: 's10', turnId: 't1', seq: 0, type: 'user_message',
      content: '帮我修复 Router 组件',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's10', turnId: 't1', seq: 1, type: 'tool_call',
      toolName: 'Edit', toolInput: { file_path: '/src/Router.tsx' },
    })
    addEvent(events, {
      id: 'e2', sessionId: 's10', turnId: 't1', seq: 2, type: 'tool_result',
      toolName: 'Edit', status: 'success', output: 'edited /src/Router.tsx',
    })
    addEvent(events, {
      id: 'e3', sessionId: 's10', turnId: 't1', seq: 3, type: 'file_change',
      changeType: 'modify', path: '/src/Router.tsx',
    })

    const messageHits = history.searchEvents({ sessionId: 's10', query: 'Router 组件' }).hits
    expect(messageHits).toHaveLength(1)
    expect(messageHits[0]!.eventType).toBe('user_message')

    const pathHits = history.searchEvents({ sessionId: 's10', query: 'Router.tsx' }).hits
    expect(pathHits.length).toBeGreaterThanOrEqual(3)
    expect(pathHits.some((hit) => hit.eventType === 'tool_call')).toBe(true)
    expect(pathHits.some((hit) => hit.eventType === 'tool_result')).toBe(true)
    expect(pathHits.some((hit) => hit.eventType === 'file_change')).toBe(true)

    // 事件类型过滤
    const onlyCalls = history.searchEvents({
      sessionId: 's10', query: 'Router.tsx', eventTypes: ['tool_call'],
    }).hits
    expect(onlyCalls).toHaveLength(1)
    expect(onlyCalls[0]!.toolName).toBe('Edit')
    expect(onlyCalls[0]!.snippet).toContain('Router.tsx')
  })

  it('escapes LIKE wildcards in search queries', () => {
    seedSession('s11')
    addEvent(events, {
      id: 'e0', sessionId: 's11', turnId: 't1', seq: 0, type: 'user_message', content: '进度 50%',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's11', turnId: 't1', seq: 1, type: 'user_message', content: '进度 50x',
    })
    addEvent(events, {
      id: 'e2', sessionId: 's11', turnId: 't1', seq: 2, type: 'user_message', content: 'a_b 与 axb',
    })

    expect(history.searchEvents({ sessionId: 's11', query: '50%' }).hits).toHaveLength(1)
    expect(history.searchEvents({ sessionId: 's11', query: 'a_b' }).hits).toHaveLength(1)
    expect(history.searchEvents({ sessionId: 's11', query: 'a_b' }).hits[0]!.snippet).toContain('a_b 与 axb')
  })

  it('rejects empty and oversized search queries', () => {
    seedSession('s12')
    expect(() => history.searchEvents({ sessionId: 's12', query: '' })).toThrow()
    expect(() =>
      history.searchEvents({ sessionId: 's12', query: 'x'.repeat(201) }),
    ).toThrow()
  })

  it('lists turn timeline with overview fields and desc pagination', () => {
    seedSession('s13')
    addEvent(events, {
      id: 'e0', sessionId: 's13', turnId: 't1', seq: 0, type: 'user_message',
      content: '第一轮：介绍需求',
    })
    addEvent(events, {
      id: 'e1', sessionId: 's13', turnId: 't1', seq: 1, type: 'tool_call',
      toolName: 'Read', toolInput: { path: '/a' },
    })
    addEvent(events, {
      id: 'e2', sessionId: 's13', turnId: 't1', seq: 2, type: 'tool_call',
      toolName: 'Grep', toolInput: { pattern: 'x' },
    })
    addEvent(events, {
      id: 'e3', sessionId: 's13', turnId: 't1', seq: 3, type: 'context_compaction',
      summary: 'compact here',
    })
    addEvent(events, {
      id: 'e4', sessionId: 's13', turnId: 't2', seq: 4, type: 'user_message',
      content: '第二轮',
    })

    const timeline = history.listTurnTimeline({ sessionId: 's13' })
    expect(timeline.turns).toHaveLength(2)
    const first = timeline.turns[0]!
    expect(first.turnId).toBe('t1')
    expect(first.userMessageHead).toBe('第一轮：介绍需求')
    expect(first.messageCount).toBe(1)
    expect(first.toolCallCount).toBe(2)
    expect(first.toolNames).toEqual(['Read', 'Grep'])
    expect(first.hasCompaction).toBe(true)
    expect(first.firstSeq).toBe(0)
    expect(first.lastSeq).toBe(3)

    // desc 从最新轮开始，可继续翻页
    const desc = history.listTurnTimeline({ sessionId: 's13', order: 'desc', limit: 1 })
    expect(desc.turns.map((turn) => turn.turnId)).toEqual(['t2'])
    expect(desc.hasMore).toBe(true)
    const next = history.listTurnTimeline({
      sessionId: 's13', order: 'desc', limit: 1, cursor: desc.nextCursor!,
    })
    expect(next.turns.map((turn) => turn.turnId)).toEqual(['t1'])
    expect(next.hasMore).toBe(false)
  })

  it('timeline and search ignore sessions without history events', () => {
    seedSession('s14')
    expect(history.listTurnTimeline({ sessionId: 's14' }).turns).toHaveLength(0)
    expect(history.readTurns({ sessionId: 's14' }).turns).toHaveLength(0)
    expect(history.searchEvents({ sessionId: 's14', query: '任意' }).hits).toHaveLength(0)
  })
})
