// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolAuditLedgerRow, ToolAuditStats, ToolAuditStatus } from '@spark/protocol'
import { ChatInspectorToolLog } from './ChatInspectorToolLog'
import {
  TOOL_AUDIT_FILTERABLE_STATUSES,
  TOOL_AUDIT_STATUS_CLASS,
  TOOL_AUDIT_STATUS_LABEL,
} from './ToolLogTimelineRow'
import { ToastProvider } from './Toast'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EMPTY_STATS: ToolAuditStats = {
  total: 0,
  byStatus: { ok: 0, error: 0, denied: 0, timeout: 0, cancelled: 0, stale: 0, running: 0 },
  bySource: {
    'sdk-builtin': 0,
    mcp: 0,
    'custom-tool': 0,
    'tool-package': 0,
    connector: 0,
    workflow: 0,
    hook: 0,
    test: 0,
  },
  byTool: [],
  p50Ms: null,
  p95Ms: null,
  totalBytes: 0,
  timeRange: null,
}

/** 挂载 window.spark.invoke mock；listHandler 允许用例注入 list 通道行为。 */
function mockSparkInvoke(listHandler: (input: unknown) => unknown) {
  const invoke = vi.fn((channel: string, input: unknown) => {
    if (channel === 'tool-audit:list') return Promise.resolve(listHandler(input))
    if (channel === 'tool-audit:stats') return Promise.resolve(EMPTY_STATS)
    if (channel === 'tool-audit:verify-chain') {
      return Promise.resolve({ chainSessionId: 'session-1', ok: true, checkedCount: 0 })
    }
    return Promise.resolve({})
  })
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: { on: vi.fn(() => vi.fn()), invoke },
  })
  return invoke
}

/** 展开折叠区块并冲刷延迟一拍的挂载加载（setTimeout(0) + 微任务）。 */
async function expandAndFlush(root: Root, container: HTMLDivElement) {
  const toggle = container.querySelector<HTMLButtonElement>(
    '.inspector-collapsible-section__toggle',
  )
  act(() => toggle?.click())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

/** 构造完整 ToolAuditLedgerRow（仅覆盖用例关心的字段）。 */
function makeAuditRow(
  overrides: Partial<ToolAuditLedgerRow> &
    Pick<ToolAuditLedgerRow, 'id' | 'ledgerSeq' | 'toolName'>,
): ToolAuditLedgerRow {
  return {
    correlationId: null,
    chainSessionId: 'session-1',
    prevHash: null,
    recordHash: null,
    finishedRecordHash: null,
    sessionId: 'session-1',
    turnId: null,
    projectId: null,
    agentId: null,
    workflowId: null,
    memberAgentId: null,
    dispatchId: null,
    hookId: null,
    hookRunId: null,
    toolId: null,
    sourceKind: 'sdk-builtin',
    invocationSource: 'model',
    mcpServerId: null,
    sourceId: 'src',
    packageId: null,
    engine: null,
    version: null,
    adapter: null,
    status: 'ok',
    startedAt: '2026-10-12T08:00:00.000Z',
    finishedAt: '2026-10-12T08:00:00.500Z',
    durationMs: 500,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    inputSha256: null,
    inputBytes: null,
    inputArtifactId: null,
    outputBytes: null,
    outputSha256: null,
    outputArtifactId: null,
    resultTruncated: false,
    resultArchived: false,
    ...overrides,
  }
}

describe('ChatInspectorToolLog', () => {
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

  it('空数据时展开显示「本轮尚无工具调用」引导空态', async () => {
    const invoke = mockSparkInvoke(() => ({ rows: [], hasMore: false }))
    await act(async () => {
      root.render(
        <ToastProvider>
          <ChatInspectorToolLog sessionId="session-1" />
        </ToastProvider>,
      )
    })
    await expandAndFlush(root, container)

    expect(container.textContent).toContain('本轮尚无工具调用')
    // 空态下不渲染时间线分组与「加载更早」
    expect(container.querySelector('.chat-toollog__group')).toBeNull()
    expect(container.querySelector('.chat-toollog__more')).toBeNull()
    // 首页拉取带 sessionId 与分页上限
    const listCall = invoke.mock.calls.find(([channel]) => channel === 'tool-audit:list')
    expect(listCall?.[1]).toEqual({ sessionId: 'session-1', limit: 100 })
  })

  it('list 未返回期间展示加载骨架（loading 态）', async () => {
    mockSparkInvoke(() => new Promise(() => {})) // 永不 resolve
    await act(async () => {
      root.render(
        <ToastProvider>
          <ChatInspectorToolLog sessionId="session-1" />
        </ToastProvider>,
      )
    })
    await expandAndFlush(root, container)

    const skeleton = container.querySelector('.chat-toollog__skeleton')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.chat-toollog__skeleton-row').length).toBe(3)
    expect(container.querySelector('.chat-toollog__group')).toBeNull()
  })

  it('有数据时按轮次分组渲染时间线（组头统计 + 行内工具名/徽标）', async () => {
    const base = {
      correlationId: null,
      chainSessionId: 'session-1',
      prevHash: null,
      recordHash: null,
      finishedRecordHash: null,
      projectId: null,
      agentId: null,
      workflowId: null,
      dispatchId: null,
      hookId: null,
      hookRunId: null,
      toolId: null,
      engine: null,
      version: null,
      adapter: null,
      errorCode: null,
      errorMessage: null,
      inputSha256: null,
      inputBytes: null,
      inputArtifactId: null,
      outputBytes: null,
      outputSha256: null,
      outputArtifactId: null,
      resultTruncated: false,
      resultArchived: false,
      sessionId: 'session-1',
    }
    mockSparkInvoke(() => ({
      rows: [
        {
          ...base,
          id: 'row-2',
          ledgerSeq: 2,
          turnId: 'turn-abcdef123',
          toolName: 'spark_wiki__wiki_search',
          sourceKind: 'mcp',
          invocationSource: 'model',
          mcpServerId: 'spark',
          status: 'ok',
          startedAt: '2026-10-12T08:00:02.000Z',
          finishedAt: '2026-10-12T08:00:02.500Z',
          durationMs: 500,
          retryCount: 0,
          sourceId: 'src',
        },
        {
          ...base,
          id: 'row-1',
          ledgerSeq: 1,
          turnId: 'turn-abcdef123',
          memberAgentId: 'researcher',
          toolName: 'Bash',
          sourceKind: 'sdk-builtin',
          invocationSource: 'model',
          mcpServerId: null,
          status: 'error',
          startedAt: '2026-10-12T08:00:00.000Z',
          finishedAt: '2026-10-12T08:00:01.000Z',
          durationMs: 1000,
          retryCount: 1,
          sourceId: 'src',
        },
      ],
      hasMore: false,
    }))
    await act(async () => {
      root.render(
        <ToastProvider>
          <ChatInspectorToolLog sessionId="session-1" />
        </ToastProvider>,
      )
    })
    await expandAndFlush(root, container)

    // 同轮次两条调用合并为一个分组，组头带调用数
    const groupHeads = container.querySelectorAll('.chat-toollog__group-head')
    expect(groupHeads.length).toBe(1)
    expect(groupHeads[0]?.textContent).toContain('2 次调用')
    expect(groupHeads[0]?.textContent).toContain('轮次 turn-abc')

    // 行按 ledger_seq 升序：Bash 在前，MCP 工具在后；来源/成员徽标到位
    const names = [...container.querySelectorAll('.chat-toollog-row__name')].map(
      (node) => node.textContent,
    )
    expect(names).toEqual(['Bash', 'spark_wiki__wiki_search'])
    expect(container.querySelector('.chat-toollog-badge.src-mcp')).not.toBeNull()
    expect(container.querySelector('.chat-toollog-badge.is-member')?.textContent).toContain(
      'researcher',
    )
    // 瀑布条以行内 style 输出几何
    const bars = container.querySelectorAll('.chat-toollog-row__bar')
    expect(bars.length).toBe(2)
    expect(bars[0]?.getAttribute('style')).toContain('left: 0%')
  })

  it('hasMore=false 时隐藏「加载更早」按钮（分页终止）', async () => {
    mockSparkInvoke(() => ({
      rows: [makeAuditRow({ id: 'row-1', ledgerSeq: 1, toolName: 'Read' })],
      hasMore: false,
    }))
    await act(async () => {
      root.render(
        <ToastProvider>
          <ChatInspectorToolLog sessionId="session-1" />
        </ToastProvider>,
      )
    })
    await expandAndFlush(root, container)

    // 行已渲染（底注在），但分页终止后不再出现「加载更早」
    expect(container.querySelector('.chat-toollog-row__name')?.textContent).toBe('Read')
    expect(container.querySelector('.chat-toollog__more')).toBeNull()
    // 过滤栏 chip = 「全部」+ 七状态
    expect(container.querySelectorAll('.chat-toollog__chip').length).toBe(8)
  })

  it('七状态 → label/class 映射完整（Record 键全覆盖且非空）', () => {
    const statuses: ToolAuditStatus[] = [
      'ok',
      'error',
      'denied',
      'timeout',
      'cancelled',
      'stale',
      'running',
    ]
    for (const status of statuses) {
      expect(TOOL_AUDIT_STATUS_LABEL[status]).toBeTruthy()
      expect(TOOL_AUDIT_STATUS_CLASS[status]).toBeTruthy()
    }
    expect(Object.keys(TOOL_AUDIT_STATUS_LABEL).sort()).toEqual([...statuses].sort())
    expect(Object.keys(TOOL_AUDIT_STATUS_CLASS).sort()).toEqual([...statuses].sort())
    // 过滤栏展示顺序覆盖同一状态全集
    expect([...TOOL_AUDIT_FILTERABLE_STATUSES].sort()).toEqual([...statuses].sort())
  })

  it('loadOlder 在途时切换过滤：旧响应不并入 rows（竞态回归）', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    const listRequests: Array<Record<string, unknown>> = []
    mockSparkInvoke((input) => {
      listRequests.push(input as Record<string, unknown>)
      return new Promise((resolve) => resolvers.push(resolve))
    })
    await act(async () => {
      root.render(
        <ToastProvider>
          <ChatInspectorToolLog sessionId="session-1" />
        </ToastProvider>,
      )
    })
    await expandAndFlush(root, container)

    // 首页：1 条 + hasMore=true，为「加载更早」留下游标
    await act(async () => {
      resolvers[0]?.({
        rows: [makeAuditRow({ id: 'row-a', ledgerSeq: 1, toolName: 'Read' })],
        hasMore: true,
        nextCursor: 1,
      })
    })
    const more = container.querySelector<HTMLButtonElement>('.chat-toollog__more')
    expect(more).not.toBeNull()
    act(() => more?.click()) // loadOlder 出发（list 第 2 次调用，悬置不 resolve）

    // 切换过滤（点击「失败」chip）→ loadFirstPage 携新序号出发（list 第 3 次调用）
    const errorChip = [
      ...container.querySelectorAll<HTMLButtonElement>('.chat-toollog__chip'),
    ].find((btn) => btn.textContent === '失败')
    expect(errorChip).toBeDefined()
    act(() => errorChip?.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(listRequests[2]?.status).toBe('error')

    // 新过滤的首页响应先落地
    await act(async () => {
      resolvers[2]?.({
        rows: [makeAuditRow({ id: 'row-new', ledgerSeq: 9, toolName: 'Grep' })],
        hasMore: false,
      })
    })
    expect(container.querySelector('.chat-toollog-row__name')?.textContent).toBe('Grep')

    // 在途的旧 loadOlder 响应后到：必须被序号守卫丢弃，不并入 rows
    await act(async () => {
      resolvers[1]?.({
        rows: [makeAuditRow({ id: 'row-stale', ledgerSeq: 5, toolName: 'StaleCall' })],
        hasMore: false,
      })
    })
    const names = [...container.querySelectorAll('.chat-toollog-row__name')].map(
      (node) => node.textContent,
    )
    expect(names).toEqual(['Grep'])
    expect(names).not.toContain('StaleCall')
  })
})
