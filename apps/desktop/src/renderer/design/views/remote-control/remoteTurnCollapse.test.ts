import { describe, expect, it } from 'vitest'
import type { RemoteTimelineItem } from './remoteEventMerge'
import { projectRemoteTurnCollapse, splitRemoteTurns } from './remoteTurnCollapse'

function user(id: string, seq: number, text = '问一句'): RemoteTimelineItem {
  return { kind: 'user', id, seq, turnId: 't1', text, attachments: [] }
}

function assistant(id: string, seq: number, text = '正文'): RemoteTimelineItem {
  return { kind: 'assistant', id, seq, turnId: 'turn-1', text, streaming: false }
}

function activity(id: string, seq: number, statuses: Array<'success' | 'error'> = ['success']) {
  return {
    kind: 'activity' as const,
    id,
    seq,
    steps: statuses.map((status, index) => ({
      kind: 'tool' as const,
      id: `${id}-${index}`,
      seq,
      toolName: 'bash',
      status,
      result: null,
    })),
  } satisfies RemoteTimelineItem
}

function files(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'files', id, seq, files: [{ path: '/tmp/report.html', title: 'report.html' }] }
}

describe('projectRemoteTurnCollapse', () => {
  it('处理完的一轮只留最后一段正文，中间正文与活动段收起', () => {
    const items = [user('u1', 1), assistant('a1', 2), activity('act', 3), assistant('a2', 4)]
    const projection = projectRemoteTurnCollapse(items, { finished: true })
    expect(projection.canCollapse).toBe(true)
    expect(projection.hiddenCount).toBe(2)
    expect(projection.visible.map((item) => item.id)).toEqual(['u1', 'a2'])
  })

  it('运行中的那一轮保持展开（实时进展不能被收起来）', () => {
    const items = [user('u1', 1), assistant('a1', 2), activity('act', 3), assistant('a2', 4)]
    expect(projectRemoteTurnCollapse(items, { finished: false })).toMatchObject({
      canCollapse: false,
      hiddenCount: 0,
    })
  })

  it('只有一段正文的轮次不出现折叠条（收了也没变化，只是多一行）', () => {
    const items = [user('u1', 1), assistant('a1', 2)]
    expect(projectRemoteTurnCollapse(items, { finished: true }).canCollapse).toBe(false)
  })

  it('一轮只跑了工具就中断（没有正文总结）时不折叠，否则会只剩一条空折叠条', () => {
    const items = [user('u1', 1), activity('act', 2)]
    expect(projectRemoteTurnCollapse(items, { finished: true }).canCollapse).toBe(false)
  })

  it('有错误提示时整轮不折叠：报错必须留在折叠外', () => {
    const items = [
      user('u1', 1),
      assistant('a1', 2),
      { kind: 'notice', id: 'n1', seq: 3, text: '目标端中断', tone: 'error' } as RemoteTimelineItem,
      assistant('a2', 4),
    ]
    expect(projectRemoteTurnCollapse(items, { finished: true }).canCollapse).toBe(false)
  })

  it('产物卡片始终可见，失败工具数透出给折叠条', () => {
    const items = [
      user('u1', 1),
      assistant('a1', 2),
      files('f1', 3),
      activity('act', 4, ['success', 'error']),
      assistant('a2', 5),
    ]
    const projection = projectRemoteTurnCollapse(items, { finished: true })
    expect(projection.visible.map((item) => item.id)).toEqual(['u1', 'f1', 'a2'])
    expect(projection.hiddenCount).toBe(2)
    expect(projection.hiddenFailures).toBe(1)
  })

  it('正文之间的连续多段一起算总结（目标端把一个 turn 拆成好几条正文）', () => {
    const items = [
      user('u1', 1),
      assistant('a1', 2),
      activity('act', 3),
      assistant('a2', 4),
      assistant('a3', 5),
    ]
    const projection = projectRemoteTurnCollapse(items, { finished: true })
    expect(projection.visible.map((item) => item.id)).toEqual(['u1', 'a2', 'a3'])
  })
})

describe('splitRemoteTurns', () => {
  it('用户消息开启新回合，其余归属上一回合', () => {
    const items = [user('u1', 1), assistant('a1', 2), user('u2', 3), assistant('a2', 4)]
    const turns = splitRemoteTurns(items)
    expect(turns.map((turn) => turn.items.map((item) => item.id))).toEqual([
      ['u1', 'a1'],
      ['u2', 'a2'],
    ])
    expect(turns.map((turn) => turn.startIndex)).toEqual([0, 2])
  })

  it('时间线以助手内容开头（历史只取到半轮）时单独成段', () => {
    const turns = splitRemoteTurns([assistant('a0', 1), user('u1', 2), assistant('a1', 3)])
    expect(turns).toHaveLength(2)
    expect(turns[0]?.items.map((item) => item.id)).toEqual(['a0'])
  })

  it('空时间线没有回合', () => {
    expect(splitRemoteTurns([])).toEqual([])
  })
})
