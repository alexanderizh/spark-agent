// @vitest-environment jsdom

/**
 * 远程会话发送反馈：乐观气泡（发送中 / 失败重发）与等待响应指示器。
 *
 * 为什么必须有这层测试：这两个元素是「发送后到目标端首字到达」之间唯一的界面
 * 反馈，此前该窗口内界面毫无变化（用户反馈「半天出不来、没有 loading」）。
 * 纯函数判据在 remoteEventMerge.test.ts，这里验 props → 真实 DOM 的映射与交互。
 *
 * 另覆盖消息操作栏的左右归属：远程视图一轮被拆成十几段，操作栏绝对定位贴在
 * 本条下沿，靠左会压在下一段左边缘上与正文抢视线（用户反馈要求靠右）。
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteMessageList, type RemotePendingUserView } from './RemoteMessageList'

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => vi.fn().mockResolvedValue({ opened: true }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteMessageList 发送反馈', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: {
    pendingUser?: RemotePendingUserView | null
    awaitingResponse?: boolean
    onRetryPendingUser?: () => void
  }): void {
    act(() => {
      root.render(<RemoteMessageList items={[]} deviceId="device-1" running={false} {...props} />)
    })
  }

  it('sending：立即渲染乐观气泡与「发送中…」', () => {
    render({
      pendingUser: { text: '拉下最新代码', attachments: [], status: 'sending' },
    })

    const bubble = container.querySelector('.rc-msg-user--pending')
    expect(bubble).not.toBeNull()
    expect(bubble?.querySelector('.rc-text')?.textContent).toBe('拉下最新代码')
    const state = container.querySelector('.rc-send-state')
    expect(state?.textContent).toContain('发送中')
    // 发送中不可点击重试（没有失败态可重试）
    expect((state as HTMLButtonElement | null)?.disabled).toBe(true)
  })

  it('failed：显示失败原因，点击整行触发重试', () => {
    const onRetry = vi.fn()
    render({
      pendingUser: {
        text: '拉下最新代码',
        attachments: [],
        status: 'failed',
        error: '连接已断开',
      },
      onRetryPendingUser: onRetry,
    })

    const state = container.querySelector('.rc-send-state')
    expect(state?.classList.contains('is-failed')).toBe(true)
    expect(state?.textContent).toContain('连接已断开')
    expect(state?.textContent).toContain('点击重试')

    act(() => {
      ;(state as HTMLButtonElement).click()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('sent：气泡保留但不显示状态行（等事件回流交棒）', () => {
    render({
      pendingUser: { text: '拉下最新代码', attachments: [], status: 'sent' },
    })

    expect(container.querySelector('.rc-msg-user--pending')).not.toBeNull()
    expect(container.querySelector('.rc-send-state')).toBeNull()
  })

  it('queued：状态行显示「已加入队列」，不可点击（没有可重试的东西）', () => {
    render({
      pendingUser: { text: '在吗', attachments: [], status: 'sent', queued: true },
    })

    expect(container.querySelector('.rc-msg-user--pending')).not.toBeNull()
    const state = container.querySelector('.rc-send-state')
    expect(state).not.toBeNull()
    expect(state?.classList.contains('is-queued')).toBe(true)
    expect(state?.textContent).toContain('已加入队列')
    // 队列态是 span 不是 button：点了也不该有任何动作
    expect(state?.tagName.toLowerCase()).toBe('span')
  })

  it('awaitingResponse：渲染三点等待指示', () => {
    render({ awaitingResponse: true })

    const awaiting = container.querySelector('.rc-msg-awaiting')
    expect(awaiting?.textContent).toContain('等待响应')
    expect(awaiting?.querySelectorAll('.rc-awaiting-dots i')).toHaveLength(3)
  })

  it('两者皆无：不渲染任何附加节点', () => {
    render({})

    expect(container.querySelector('.rc-msg-user--pending')).toBeNull()
    expect(container.querySelector('.rc-msg-awaiting')).toBeNull()
    expect(container.querySelector('.rc-send-state')).toBeNull()
  })

  it('纯附件消息（text 为空）也渲染气泡，不出现空段落', () => {
    render({
      pendingUser: { text: '', attachments: [], status: 'sending' },
    })

    expect(container.querySelector('.rc-msg-user--pending')).not.toBeNull()
    expect(container.querySelector('.rc-text')).toBeNull()
  })

  it('助手与用户消息的操作栏都靠右（msg-hover-right）', () => {
    act(() => {
      root.render(
        <RemoteMessageList
          deviceId="device-1"
          running={false}
          onReuseUserMessage={() => undefined}
          items={[
            {
              kind: 'user',
              id: 'u1',
              seq: 1,
              turnId: 't0',
              text: '帮我看下这段代码',
              attachments: [],
            },
            {
              kind: 'assistant',
              id: 'a1',
              seq: 2,
              turnId: 't1',
              text: '看完了，问题在第三行',
              streaming: false,
            },
          ]}
        />,
      )
    })

    const bars = container.querySelectorAll('.msg-hover-bar')
    expect(bars).toHaveLength(2)
    bars.forEach((bar) => {
      expect(bar.classList.contains('msg-hover-right')).toBe(true)
      expect(bar.classList.contains('msg-hover-left')).toBe(false)
    })
  })

  it('shows timestamps in both user and assistant action bars', () => {
    act(() => {
      root.render(
        <RemoteMessageList
          deviceId="device-1"
          items={[
            {
              kind: 'user',
              id: 'u-time',
              seq: 1,
              turnId: 'turn-1',
              text: 'question',
              attachments: [],
              timestamp: '2026-11-20T10:30:00.000Z',
            },
            {
              kind: 'assistant',
              id: 'a-time',
              seq: 2,
              turnId: 'turn-1',
              text: 'answer',
              streaming: false,
              timestamp: '2026-11-20T10:31:00.000Z',
            },
          ]}
        />,
      )
    })

    const times = Array.from(container.querySelectorAll('.msg-hover-time'))
    expect(times).toHaveLength(2)
    expect(times.every((time) => (time.textContent ?? '').trim().length > 0)).toBe(true)
  })

  it('keeps the final answer after the collapsed activity row', () => {
    act(() => {
      root.render(
        <RemoteMessageList
          deviceId="device-1"
          items={[
            { kind: 'user', id: 'u1', seq: 1, turnId: 'turn-1', text: 'question', attachments: [] },
            {
              kind: 'activity',
              id: 'activity-1',
              seq: 2,
              steps: [
                {
                  kind: 'tool',
                  id: 'tool-1',
                  seq: 2,
                  toolName: 'bash',
                  status: 'success',
                  result: 'done',
                },
              ],
            },
            {
              kind: 'assistant',
              id: 'a1',
              seq: 3,
              turnId: 'turn-1',
              text: 'final answer',
              streaming: false,
            },
          ]}
        />,
      )
    })

    const timeline = Array.from(container.querySelectorAll('.rc-turn-collapse, .rc-msg-assistant'))
    expect(timeline.map((item) => item.classList.contains('rc-turn-collapse'))).toEqual([
      true,
      false,
    ])
  })

  it('生成中的助手分段不挂操作栏（按钮会随正文增长位移）', () => {
    act(() => {
      root.render(
        <RemoteMessageList
          deviceId="device-1"
          running
          items={[
            {
              kind: 'assistant',
              id: 'a1',
              seq: 1,
              turnId: 't1',
              text: '正在写',
              streaming: true,
            },
          ]}
        />,
      )
    })

    expect(container.querySelector('.rc-msg-assistant')).not.toBeNull()
    expect(container.querySelector('.msg-hover-bar')).toBeNull()
  })
})
