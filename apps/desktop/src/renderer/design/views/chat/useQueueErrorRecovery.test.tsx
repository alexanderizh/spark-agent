// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionId } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { ERROR_CONTINUE_INSTRUCTION } from './ChatErrorRetry'
import { useQueueErrorRecovery } from './useQueueErrorRecovery'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  resumeQueue: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.resumeQueue }),
}))

const failedMessages: UIMessage[] = [
  {
    id: 'user-failed',
    turnId: 'turn-failed',
    role: 'user',
    status: 'completed',
    blocks: [{ kind: 'text', content: 'retry this', isStreaming: false }],
    attachments: [{ type: 'file', path: '/tmp/spec.md', name: 'spec.md' }],
    usage: null,
    eventIds: ['user-failed'],
  },
]

/** 失败轮 assistant 消息：blocks 可注入文本/工具调用/文件变更等产出证据。 */
function failedAssistantMessage(blocks: UIMessage['blocks']): UIMessage {
  return {
    id: 'assistant-failed',
    turnId: 'turn-failed',
    role: 'assistant',
    status: 'error',
    blocks: [
      ...blocks,
      { kind: 'error', code: 'HTTP_500', message: 'upstream down', retryable: true },
    ],
    usage: null,
    eventIds: ['assistant-failed'],
  }
}

function Harness(props: {
  sessionId?: SessionId
  messages?: UIMessage[]
  dispatchRetry: ReturnType<typeof vi.fn>
  refreshQueueState: ReturnType<typeof vi.fn>
  onPauseCleared: ReturnType<typeof vi.fn>
}) {
  const recovery = useQueueErrorRecovery({
    sessionId: props.sessionId ?? ('00000000-0000-4000-8000-000000000001' as SessionId),
    pause: {
      reason: 'turn_error',
      failedTurnId: 'turn-failed',
      pausedAt: '2026-09-05T00:00:00.000Z',
    },
    messages: props.messages ?? failedMessages,
    getCurrentRuntimePatch: () => ({
      providerProfileId: '00000000-0000-4000-8000-000000000002',
      modelId: 'model-current',
      cliSparkOverride: {
        providerProfileId: '00000000-0000-4000-8000-000000000003',
        modelId: 'spark-model-current',
      },
      agentId: 'agent-not-overridden',
    }),
    dispatchRetry: props.dispatchRetry,
    refreshQueueState: props.refreshQueueState,
    onPauseCleared: props.onPauseCleared,
    showWarning: vi.fn(),
    showError: vi.fn(),
  })

  return (
    <div
      data-testid="recovery"
      data-recovering={recovery.recovering ?? ''}
      data-can-retry={recovery.canRetry ? 'true' : 'false'}
    >
      <button type="button" data-testid="retry" onClick={() => void recovery.retry()}>
        retry
      </button>
      <button type="button" data-testid="resume" onClick={() => void recovery.resume()}>
        resume
      </button>
    </div>
  )
}

describe('useQueueErrorRecovery', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.resumeQueue.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('retries the failed payload without mutating the current composer draft', async () => {
    const dispatchRetry = vi.fn(async () => undefined)
    const refreshQueueState = vi.fn(async () => undefined)
    act(() => {
      root.render(
        <Harness
          dispatchRetry={dispatchRetry}
          refreshQueueState={refreshQueueState}
          onPauseCleared={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    })

    expect(dispatchRetry).toHaveBeenCalledWith({
      text: 'retry this',
      attachments: [expect.objectContaining({ path: '/tmp/spec.md', name: 'spec.md' })],
      sessionReferences: [],
    })
    expect(refreshQueueState).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001')
  })

  it('sends the continue instruction instead of resending when the failed turn has text output', async () => {
    const dispatchRetry = vi.fn(async () => undefined)
    act(() => {
      root.render(
        <Harness
          messages={[...failedMessages, failedAssistantMessage([
            { kind: 'text', content: '已完成一半', isStreaming: false },
          ])]}
          dispatchRetry={dispatchRetry}
          refreshQueueState={vi.fn(async () => undefined)}
          onPauseCleared={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    })

    // 继续指令不带失败轮附件（原输入已在会话历史中，重复投递会污染上下文）。
    expect(dispatchRetry).toHaveBeenCalledWith({
      text: ERROR_CONTINUE_INSTRUCTION,
      attachments: [],
      sessionReferences: [],
    })
  })

  it('sends the continue instruction when the failed turn only has tool/file output', async () => {
    const dispatchRetry = vi.fn(async () => undefined)
    act(() => {
      root.render(
        <Harness
          messages={[...failedMessages, failedAssistantMessage([
            {
              kind: 'tool_call',
              toolCallId: 'tool-1',
              toolName: 'Bash',
              toolInput: { command: 'ls' },
              status: 'success',
              output: 'ok',
              error: undefined,
              durationMs: 5,
            },
            { kind: 'file_change', changeType: 'modify', path: '/tmp/a.ts', diff: '+1' },
          ])]}
          dispatchRetry={dispatchRetry}
          refreshQueueState={vi.fn(async () => undefined)}
          onPauseCleared={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    })

    expect(dispatchRetry).toHaveBeenCalledTimes(1)
    expect(dispatchRetry).toHaveBeenCalledWith({
      text: ERROR_CONTINUE_INSTRUCTION,
      attachments: [],
      sessionReferences: [],
    })
  })

  it('falls back to resending the original message when the failed turn produced nothing', async () => {
    const dispatchRetry = vi.fn(async () => undefined)
    // 首个用例的时间线（无 assistant 产出）即回落场景，这里显式带上空产出 assistant 消息。
    act(() => {
      root.render(
        <Harness
          messages={[...failedMessages, failedAssistantMessage([])]}
          dispatchRetry={dispatchRetry}
          refreshQueueState={vi.fn(async () => undefined)}
          onPauseCleared={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    })

    expect(dispatchRetry).toHaveBeenCalledWith({
      text: 'retry this',
      attachments: [expect.objectContaining({ path: '/tmp/spec.md' })],
      sessionReferences: [],
    })
  })

  it('relaxes canRetry when the original message is unrestorable but the turn has output', async () => {
    const dispatchRetry = vi.fn(async () => undefined)
    // 隐藏内部轮：原消息重发载荷不可还原（旧逻辑 canRetry=false），但失败轮有产出，
    // 继续指令仍可安全续跑（canRetry 放宽为两者任一可用）。
    const hiddenTurnMessages: UIMessage[] = [
      {
        id: 'user-hidden',
        turnId: 'turn-failed',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
        usage: null,
        eventIds: ['user-hidden'],
        userMessageVisibility: 'hidden',
      },
      failedAssistantMessage([{ kind: 'text', content: '已完成一半', isStreaming: false }]),
    ]
    act(() => {
      root.render(
        <Harness
          messages={hiddenTurnMessages}
          dispatchRetry={dispatchRetry}
          refreshQueueState={vi.fn(async () => undefined)}
          onPauseCleared={vi.fn()}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="recovery"]')?.getAttribute('data-can-retry'),
    ).toBe('true')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    })

    expect(dispatchRetry).toHaveBeenCalledWith({
      text: ERROR_CONTINUE_INSTRUCTION,
      attachments: [],
      sessionReferences: [],
    })
  })

  it('resumes with only the current model-routing selection', async () => {
    mocks.resumeQueue.mockResolvedValue({ resumed: true, queuedTurns: [] })
    const refreshQueueState = vi.fn(async () => undefined)
    const onPauseCleared = vi.fn()
    act(() => {
      root.render(
        <Harness
          dispatchRetry={vi.fn(async () => undefined)}
          refreshQueueState={refreshQueueState}
          onPauseCleared={onPauseCleared}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="resume"]')?.click()
    })

    expect(mocks.resumeQueue).toHaveBeenCalledWith({
      sessionId: '00000000-0000-4000-8000-000000000001',
      runtimePatch: {
        providerProfileId: '00000000-0000-4000-8000-000000000002',
        modelId: 'model-current',
        cliSparkOverride: {
          providerProfileId: '00000000-0000-4000-8000-000000000003',
          modelId: 'spark-model-current',
        },
      },
    })
    expect(onPauseCleared).toHaveBeenCalledOnce()
  })

  it('does not let an earlier session clear a later session recovery state', async () => {
    const resolvers: Array<(value: { resumed: boolean; queuedTurns: [] }) => void> = []
    mocks.resumeQueue.mockImplementation(
      () =>
        new Promise<{ resumed: boolean; queuedTurns: [] }>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    const commonProps = {
      dispatchRetry: vi.fn(async () => undefined),
      refreshQueueState: vi.fn(async () => undefined),
      onPauseCleared: vi.fn(),
    }
    const sessionA = '00000000-0000-4000-8000-000000000001' as SessionId
    const sessionB = '00000000-0000-4000-8000-000000000004' as SessionId

    act(() => root.render(<Harness {...commonProps} sessionId={sessionA} />))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="resume"]')?.click())
    act(() => root.render(<Harness {...commonProps} sessionId={sessionB} />))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="resume"]')?.click())

    expect(resolvers).toHaveLength(2)
    await act(async () => resolvers[0]?.({ resumed: true, queuedTurns: [] }))
    expect(
      container.querySelector('[data-testid="recovery"]')?.getAttribute('data-recovering'),
    ).toBe('resume')

    await act(async () => resolvers[1]?.({ resumed: true, queuedTurns: [] }))
    expect(
      container.querySelector('[data-testid="recovery"]')?.getAttribute('data-recovering'),
    ).toBe('')
  })
})
