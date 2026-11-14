import { describe, expect, it } from 'vitest'
import {
  INITIAL_REMOTE_SIDEBAR_TRACKER,
  decideRemoteSidebarAction,
  type RemoteSidebarAutoTracker,
} from './remoteSidebarAutoCollapse'

const state = (wasRemoteView: boolean, autoCollapsed: boolean): RemoteSidebarAutoTracker => ({
  wasRemoteView,
  autoCollapsed,
})

describe('decideRemoteSidebarAction', () => {
  it('进入远程视图：菜单展开着 → 折叠，并记住是自己折的', () => {
    const result = decideRemoteSidebarAction(true, false, INITIAL_REMOTE_SIDEBAR_TRACKER)
    expect(result.action).toBe('collapse')
    expect(result.next).toEqual(state(true, true))
  })

  it('进入远程视图：菜单本来就折着 → 不动，也不欠一次恢复', () => {
    const result = decideRemoteSidebarAction(true, true, INITIAL_REMOTE_SIDEBAR_TRACKER)
    expect(result.action).toBe('none')
    expect(result.next).toEqual(state(true, false))
  })

  it('折叠后 effect 再跑一轮不会来回抖（下一轮必须是 none）', () => {
    const first = decideRemoteSidebarAction(true, false, INITIAL_REMOTE_SIDEBAR_TRACKER)
    // 执行 collapse 后 sidebarHidden 变 true，effect 因依赖变化重跑
    const second = decideRemoteSidebarAction(true, true, first.next)
    expect(second.action).toBe('none')
    expect(second.next).toEqual(state(true, true))
    // 再跑第三轮仍然稳定
    const third = decideRemoteSidebarAction(true, true, second.next)
    expect(third.action).toBe('none')
  })

  it('用户在远程视图里自己展开菜单 → 交出所有权，之后离开不会乱展开', () => {
    const expanded = decideRemoteSidebarAction(true, false, state(true, true))
    expect(expanded.action).toBe('none')
    expect(expanded.next).toEqual(state(true, false))

    const leave = decideRemoteSidebarAction(false, false, expanded.next)
    expect(leave.action).toBe('none')
  })

  it('离开远程视图：恢复自己折的那次', () => {
    const result = decideRemoteSidebarAction(false, true, state(true, true))
    expect(result.action).toBe('restore')
    expect(result.next).toEqual(INITIAL_REMOTE_SIDEBAR_TRACKER)
  })

  it('离开远程视图：用户自己折的保持折着', () => {
    const result = decideRemoteSidebarAction(false, true, state(true, false))
    expect(result.action).toBe('none')
    expect(result.next).toEqual(INITIAL_REMOTE_SIDEBAR_TRACKER)
  })

  it('完全不相关的视图切换（chat → settings）不会有任何动作', () => {
    expect(decideRemoteSidebarAction(false, false, INITIAL_REMOTE_SIDEBAR_TRACKER).action).toBe(
      'none',
    )
    expect(decideRemoteSidebarAction(false, true, INITIAL_REMOTE_SIDEBAR_TRACKER).action).toBe(
      'none',
    )
  })

  it('完整的进出流程：进 → 折 → 出 → 展开，末态回到展开且记忆干净', () => {
    let tracker = INITIAL_REMOTE_SIDEBAR_TRACKER
    let hidden = false

    let step = decideRemoteSidebarAction(true, hidden, tracker)
    tracker = step.next
    if (step.action === 'collapse') hidden = true
    expect(hidden).toBe(true)

    step = decideRemoteSidebarAction(true, hidden, tracker)
    tracker = step.next
    expect(step.action).toBe('none')

    step = decideRemoteSidebarAction(false, hidden, tracker)
    tracker = step.next
    if (step.action === 'restore') hidden = false
    expect(hidden).toBe(false)
    expect(tracker).toEqual(INITIAL_REMOTE_SIDEBAR_TRACKER)

    step = decideRemoteSidebarAction(false, hidden, tracker)
    expect(step.action).toBe('none')
  })
})
