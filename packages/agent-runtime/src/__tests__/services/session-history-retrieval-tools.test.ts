/**
 * 单元测试：SessionHistoryRetrievalTools 参数校验与会话绑定。
 *
 * 仓库层语义（分页/预算/检索）在 storage 包的
 * session-history.repository.test.ts 覆盖；这里只验证控制器门面：
 *   - 空 sessionId 拒绝（会话身份只能来自运行时注入）
 *   - mode:'event' 的 turnId/seq 校验与未命中报错
 *   - 参数透传与响应组装（mode 回填）
 */
import { describe, expect, it, vi } from 'vitest'
import { SessionHistoryRetrievalTools } from '../../services/session/session-history-retrieval-tools.js'
import type { SessionHistoryRepository } from '@spark/storage'

function createTools() {
  const repo: Pick<
    SessionHistoryRepository,
    'listTurnTimeline' | 'readTurns' | 'readEvent' | 'searchEvents'
  > = {
    listTurnTimeline: vi.fn(() => ({ turns: [], nextCursor: null, hasMore: false })),
    readTurns: vi.fn(() => ({ turns: [], nextCursor: null, hasMore: false })),
    readEvent: vi.fn(() => null),
    searchEvents: vi.fn(() => ({ hits: [] })),
  }
  return { tools: new SessionHistoryRetrievalTools(repo as unknown as SessionHistoryRepository), repo }
}

describe('SessionHistoryRetrievalTools', () => {
  it('rejects an empty session id', () => {
    const { tools } = createTools()
    expect(() => tools.list('  ', {})).toThrow('Current session id is unavailable')
    expect(() => tools.read('', { mode: 'turns' })).toThrow('Current session id is unavailable')
    expect(() => tools.search(' ', { query: 'x' })).toThrow('Current session id is unavailable')
  })

  it('validates mode:event params and reports missing events', () => {
    const { tools } = createTools()
    expect(() => tools.read('s1', { mode: 'event', turnId: '', seq: 1 })).toThrow('turnId')
    expect(() =>
      tools.read('s1', {
        mode: 'event',
        turnId: 't1',
        seq: Number.NaN,
      }),
    ).toThrow('seq')
    expect(() => tools.read('s1', { mode: 'event', turnId: 't1', seq: -1 })).toThrow('seq')
    expect(() => tools.read('s1', { mode: 'event', turnId: 't1', seq: 3 })).toThrow('未找到指定事件')
  })

  it('returns event payloads with the mode discriminator', () => {
    const { tools, repo } = createTools()
    vi.mocked(repo.readEvent).mockReturnValueOnce({
      seq: 3,
      eventType: 'tool_result',
      role: 'tool',
      toolName: 'Bash',
      content: 'output',
      truncated: false,
      turnId: 't1',
    })
    const response = tools.read('s1', { mode: 'event', turnId: 't1', seq: 3 })
    expect(response).toEqual({
      mode: 'event',
      event: {
        seq: 3,
        eventType: 'tool_result',
        role: 'tool',
        toolName: 'Bash',
        content: 'output',
        truncated: false,
        turnId: 't1',
      },
    })
  })

  it('forwards normalized params to the repository for turns/search', () => {
    const { tools, repo } = createTools()
    tools.read('s1', { mode: 'turns', turnLimit: 4, order: 'asc' })
    expect(repo.readTurns).toHaveBeenCalledWith({
      sessionId: 's1',
      turnLimit: 4,
    })

    tools.search('s1', { query: '  keyword  ', eventTypes: ['tool_call', 'bogus_type'], limit: 5 })
    // 事件类型合法性由仓库层过滤（HISTORY_EVENT_TYPES 白名单），控制器原样透传
    expect(repo.searchEvents).toHaveBeenCalledWith({
      sessionId: 's1',
      query: 'keyword',
      eventTypes: ['tool_call', 'bogus_type'],
      limit: 5,
    })

    expect(() => tools.search('s1', { query: '' })).toThrow('query')
  })
})
