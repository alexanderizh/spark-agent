import { describe, expect, it } from 'vitest'
import { TurnRegistry } from '../../services/session/turn-registry.js'
import type { ActiveExecution } from '../../sdk/engine-executor.js'

/** 最小执行器桩：TurnRegistry 只依赖 cancel 语义（ActiveExecution = Pick<EngineExecutor,'cancel'>）。 */
function stubExecutor(id: string): ActiveExecution & { id: string } {
  return { id, cancel: () => {} }
}

describe('TurnRegistry（W2-D1 所有权收编）', () => {
  it('启动簿记：beginStarting 登记，finishStarting 仅摘除本人登记并解除取消标记', () => {
    const registry = new TurnRegistry()
    registry.beginStarting('s1', 't1')
    expect(registry.isSessionStarting('s1')).toBe(true)
    expect(registry.getStartingTurnId('s1')).toBe('t1')
    expect(registry.inflightSessionCount()).toBe(1)

    // starting 窗口内被取消：finishStarting 应连带解除取消标记（turn 到此终结）。
    registry.markTurnCancelled('t1')
    registry.finishStarting('s1', 't1')
    expect(registry.isSessionStarting('s1')).toBe(false)
    expect(registry.getStartingTurnId('s1')).toBeUndefined()
    expect(registry.isTurnCancelled('t1')).toBe(false)
    expect(registry.inflightSessionCount()).toBe(0)
  })

  it('finishStarting 的 turnId 守卫：不摘除已被新登记覆盖的 starting', () => {
    const registry = new TurnRegistry()
    registry.beginStarting('s1', 't1')
    registry.beginStarting('s1', 't2') // 同会话新起跑覆盖旧登记
    registry.finishStarting('s1', 't1') // 旧 turn 的收尾不得误摘新登记
    expect(registry.getStartingTurnId('s1')).toBe('t2')
    expect(registry.isSessionStarting('s1')).toBe(true)
  })

  it('注册与回收守恒：releaseExecutorIfOwned 拒绝旧执行器回收新所有权', () => {
    const registry = new TurnRegistry()
    const oldExecutor = stubExecutor('old')
    const newExecutor = stubExecutor('new')
    registry.registerExecutor('s1', 't1', oldExecutor)
    expect(registry.isActiveExecutor('s1', oldExecutor)).toBe(true)

    // 旧 executor 未回收前被新 executor 顶替（异常但防御的现状语义）。
    registry.registerExecutor('s1', 't2', newExecutor)
    expect(registry.releaseExecutorIfOwned('s1', 't1', oldExecutor)).toBe(false)
    expect(registry.hasActiveSession('s1')).toBe(true)
    expect(registry.executorFor('s1')).toBe(newExecutor)

    // 正当所有者回收：释放并摘除指向本 turn 的 runningTurnIds。
    expect(registry.releaseExecutorIfOwned('s1', 't2', newExecutor)).toBe(true)
    expect(registry.hasActiveSession('s1')).toBe(false)
    expect(registry.runningTurnId('s1')).toBeUndefined()
  })

  it('forceRelease：无条件摘除（cancelTurn 语义优先于守恒）', () => {
    const registry = new TurnRegistry()
    const executor = stubExecutor('e1')
    registry.registerExecutor('s1', 't1', executor)
    registry.forceRelease('s1', 't1')
    expect(registry.hasActiveSession('s1')).toBe(false)
    expect(registry.runningTurnId('s1')).toBeUndefined()
  })

  it('并发计数恒等式：loops 与 starting 过渡态合并计入', () => {
    const registry = new TurnRegistry()
    expect(registry.inflightSessionCount()).toBe(0)
    registry.beginStarting('s1', 't1')
    registry.registerExecutor('s2', 't2', stubExecutor('e2'))
    expect(registry.inflightSessionCount()).toBe(2)
    registry.finishStarting('s1', 't1')
    expect(registry.inflightSessionCount()).toBe(1)
  })

  it('执行追踪与 dispose：trackedExecutions 快照 + clearAll 清空全部所有权', async () => {
    const registry = new TurnRegistry()
    const executor = stubExecutor('e1')
    let resolveExecution: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
      resolveExecution = resolve
    })
    registry.registerExecutor('s1', 't1', executor)
    registry.trackExecution(executor, { sessionId: 's1', promise })

    const tracked = registry.trackedExecutions()
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.sessionId).toBe('s1')

    registry.untrackExecution(executor)
    expect(registry.trackedExecutions()).toHaveLength(0)

    // dispose：cancel 全部执行器并清空（此后事件闸门判定必然拒绝）。
    registry.trackExecution(executor, { sessionId: 's1', promise })
    expect(registry.snapshotExecutors()).toEqual([executor])
    registry.clearAll()
    expect(registry.hasActiveSession('s1')).toBe(false)
    expect(registry.isSessionStarting('s1')).toBe(false)
    expect(registry.trackedExecutions()).toHaveLength(0)
    expect(registry.isActiveExecutor('s1', executor)).toBe(false)
    resolveExecution()
    await promise
  })

  it('只读视图：activeLoops / cancelledTurns 可读不可写（类型层）且反映内部状态', () => {
    const registry = new TurnRegistry()
    const executor = stubExecutor('e1')
    registry.registerExecutor('s1', 't1', executor)
    registry.markTurnCancelled('t9')
    expect(registry.activeLoops.get('s1')).toBe(executor)
    expect(registry.activeLoops.size).toBe(1)
    expect(registry.cancelledTurns.has('t9')).toBe(true)
    // shouldAcceptSessionExecutorEvent 的组合判定与内部状态一致。
    expect(registry.isTurnCancelled('t1')).toBe(false)
    expect(registry.isActiveExecutor('s1', executor)).toBe(true)
  })
})
