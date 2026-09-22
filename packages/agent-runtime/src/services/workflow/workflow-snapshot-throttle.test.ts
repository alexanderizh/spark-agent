/**
 * M4 快照节流器测试（fake timers）：间隔内 working 快照合并（只保留最新）+
 * trailing 补写、间隔外立即写、终态快照必达且取消 pending、intervalMs=0 不节流。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowSnapshotWriteThrottle } from './workflow-snapshot-throttle.js'
import type { WorkflowRunSnapshot } from '../workflow-executor.js'

function workingSnapshot(tag: string): WorkflowRunSnapshot {
  return {
    status: 'working',
    state: { tag },
    executions: [],
    atomicExecutions: [],
    completedNodeIds: [tag],
    skippedNodeIds: [],
    runningNodeIds: [],
  }
}

function terminalSnapshot(status: 'completed' | 'failed' | 'canceled'): WorkflowRunSnapshot {
  return {
    status,
    state: {},
    executions: [],
    atomicExecutions: [],
    completedNodeIds: [],
    skippedNodeIds: [],
    runningNodeIds: [],
  }
}

describe('WorkflowSnapshotWriteThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首份 working 快照立即落库', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 2_000 })
    const persisted: string[] = []
    throttle.offer(workingSnapshot('a'), (snap) => persisted.push(String(snap.state.tag)))
    expect(persisted).toEqual(['a'])
    expect(throttle.persistCount).toBe(1)
  })

  it('间隔内的 working 快照被合并（跳过中间，只留最新）并在到期时 trailing 补写', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 2_000 })
    const persisted: string[] = []
    throttle.offer(workingSnapshot('a'), (snap) => persisted.push(String(snap.state.tag)))
    vi.advanceTimersByTime(100)
    throttle.offer(workingSnapshot('b'), (snap) => persisted.push(String(snap.state.tag)))
    vi.advanceTimersByTime(100)
    throttle.offer(workingSnapshot('c'), (snap) => persisted.push(String(snap.state.tag)))
    // 间隔内：b/c 均未落库
    expect(persisted).toEqual(['a'])
    expect(throttle.persistCount).toBe(1)
    // 到期：只补写最新一份（c），b 被合并跳过
    vi.advanceTimersByTime(1_800)
    expect(persisted).toEqual(['a', 'c'])
    expect(throttle.persistCount).toBe(2)
  })

  it('trailing 补写后重新起算间隔（下一份 working 快照在下一个窗口落库）', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 2_000 })
    const persisted: string[] = []
    throttle.offer(workingSnapshot('a'), (snap) => persisted.push(String(snap.state.tag)))
    vi.advanceTimersByTime(500)
    throttle.offer(workingSnapshot('b'), (snap) => persisted.push(String(snap.state.tag)))
    vi.advanceTimersByTime(1_500) // trailing b 落库（t=2000）
    expect(persisted).toEqual(['a', 'b'])
    vi.advanceTimersByTime(1_000) // t=3000，距 b 落库 1000 < 2000
    throttle.offer(workingSnapshot('c'), (snap) => persisted.push(String(snap.state.tag)))
    expect(persisted).toEqual(['a', 'b'])
    vi.advanceTimersByTime(1_000) // t=4000，c trailing 落库
    expect(persisted).toEqual(['a', 'b', 'c'])
  })

  it('终态快照立即落库且不受节流影响（pending 被取消、不被旧数据覆盖）', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 2_000 })
    const persisted: Array<{ tag: string; status: string }> = []
    const persist = (snap: WorkflowRunSnapshot): void => {
      persisted.push({ tag: String(snap.state.tag ?? ''), status: snap.status })
    }
    throttle.offer(workingSnapshot('a'), persist)
    vi.advanceTimersByTime(100)
    throttle.offer(workingSnapshot('pending-latest'), persist) // 进入 trailing 待写
    expect(persisted).toEqual([{ tag: 'a', status: 'working' }])
    // 终态到达：立即写，pending 的 working 快照被取消
    throttle.offer(terminalSnapshot('completed'), persist)
    expect(persisted).toEqual([
      { tag: 'a', status: 'working' },
      { tag: '', status: 'completed' },
    ])
    expect(throttle.persistCount).toBe(2)
    // trailing timer 到期后不再写任何东西（终态已落库）
    vi.advanceTimersByTime(5_000)
    expect(persisted.length).toBe(2)
    expect(throttle.persistCount).toBe(2)
  })

  it('终态快照本身到达时节流间隔未满也立即写', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 60_000 })
    const persisted: string[] = []
    throttle.offer(terminalSnapshot('failed'), (snap) => persisted.push(snap.status))
    expect(persisted).toEqual(['failed'])
    expect(throttle.persistCount).toBe(1)
  })

  it('intervalMs=0：全部立即写（不节流，行为与现状一致）', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 0 })
    const persisted: string[] = []
    for (const tag of ['a', 'b', 'c']) {
      throttle.offer(workingSnapshot(tag), (snap) => persisted.push(String(snap.state.tag)))
    }
    expect(persisted).toEqual(['a', 'b', 'c'])
    expect(throttle.persistCount).toBe(3)
  })

  it('flush 写出 trailing 待写；dispose 后迟到的快照直接落库', () => {
    const throttle = new WorkflowSnapshotWriteThrottle({ intervalMs: 2_000 })
    const persisted: string[] = []
    const persist = (snap: WorkflowRunSnapshot): void => {
      persisted.push(String(snap.state.tag ?? snap.status))
    }
    throttle.offer(workingSnapshot('a'), persist)
    vi.advanceTimersByTime(100)
    throttle.offer(workingSnapshot('pending'), persist)
    expect(persisted).toEqual(['a'])
    throttle.flush()
    expect(persisted).toEqual(['a', 'pending'])
    // flush 后 timer 已清，再推进不再重复写
    vi.advanceTimersByTime(5_000)
    expect(persisted.length).toBe(2)
    throttle.dispose()
    throttle.offer(terminalSnapshot('canceled'), persist)
    expect(persisted).toEqual(['a', 'pending', 'canceled'])
  })

  it('可注入时钟与调度器（脱离 fake timers 的确定性控制）', () => {
    let now = 10_000
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    const throttle = new WorkflowSnapshotWriteThrottle({
      intervalMs: 1_000,
      now: () => now,
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
      cancel: () => undefined,
    })
    const persisted: string[] = []
    throttle.offer(workingSnapshot('a'), (snap) => persisted.push(String(snap.state.tag)))
    now += 100
    throttle.offer(workingSnapshot('b'), (snap) => persisted.push(String(snap.state.tag)))
    expect(persisted).toEqual(['a'])
    expect(scheduled.length).toBe(1)
    expect(scheduled[0]?.delay).toBe(900)
    now += 900
    scheduled[0]?.callback()
    expect(persisted).toEqual(['a', 'b'])
  })
})
