import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { FakeModel, text, toolCall } from '@spark/agent'
import type { LlmService } from '@spark/agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentEvent } from '@spark/protocol'

import {
  SparkEngineExecutor,
  setSparkLlmFactoryForTests,
} from '../../sdk/spark-engine/spark-engine-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

/**
 * Spark 引擎执行器集成测试：FakeModel（spark-engine reply-dsl）驱动完整 turn，
 * 覆盖工具循环、事件映射终态、ledger 续跑（openSession 重放）与路由失败兜底。
 * dataRoot 全部落临时目录，不触碰 ~/.spark。
 */

let root = ''
let workspaceRoot = ''

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'spark-executor-test-'))
  workspaceRoot = path.join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(path.join(workspaceRoot, 'a.ts'), 'export const answer = 42;\n')
})

afterEach(() => {
  setSparkLlmFactoryForTests(null)
  rmSync(root, { recursive: true, force: true })
})

function collectEvents(executor: SparkEngineExecutor): AgentEvent[] {
  const events: AgentEvent[] = []
  executor.onEvent((event) => events.push(event))
  return events
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'sk-test',
    model: 'test-model',
    workspaceRootPath: workspaceRoot,
    permissionMode: 'spark-bypass',
    sparkUpstreamProtocol: 'anthropic-messages',
    sparkDataRoot: path.join(root, 'ledger'),
    ...overrides,
  }
}

function scriptFactory(
  script: ReturnType<typeof text>[],
): (config: SDKExecutorConfig) => LlmService {
  return () => new FakeModel(script)
}

describe('SparkEngineExecutor', () => {
  it('完整 turn：文本 + 工具循环 + 终态 completed + sessionId 上报', async () => {
    const script = [
      toolCall('call-1', 'read', { path: 'a.ts' }, { text: '我先读取文件。' }),
      text('已读取 a.ts，答案是 42。'),
    ]
    setSparkLlmFactoryForTests(scriptFactory(script))
    const observed: string[] = []
    const executor = new SparkEngineExecutor()
    const events = collectEvents(executor)

    await executor.executeTurn(
      'sess-1',
      'turn-1',
      '读取 a.ts 并回答',
      makeConfig({
        sparkSessionIdObserver: (id) => {
          observed.push(id)
        },
      }),
    )

    expect(observed).toHaveLength(1)
    // 引擎 ledger id 形如 session_<uuid>。
    expect(observed[0]).toMatch(/^session_[0-9a-f-]{36}$/i)

    expect(events.filter((e) => e.type === 'tool_call' && e.toolName === 'read')).toHaveLength(1)
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolResults[0]).toMatchObject({ status: 'success' })
    const completes = events.filter((e) => e.type === 'assistant_message' && e.mode === 'complete')
    expect(completes.length).toBeGreaterThanOrEqual(2)
    expect(completes.some((e) => e.type === 'assistant_message' && e.content.includes('42'))).toBe(
      true,
    )
    expect(events.some((e) => e.type === 'usage_update')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'agent_status', status: 'completed' })
  })

  it('续跑：sdkSessionId + continueSession 走 openSession，ledger sessionId 保持不变', async () => {
    // turn 1：新会话
    setSparkLlmFactoryForTests(scriptFactory([text('第一轮回答。')]))
    let ledgerSessionId = ''
    const executor1 = new SparkEngineExecutor()
    collectEvents(executor1)
    await executor1.executeTurn(
      'sess-1',
      'turn-1',
      '你好',
      makeConfig({
        sparkSessionIdObserver: (id) => {
          ledgerSessionId = id
        },
      }),
    )

    // turn 2：新执行器实例（每 turn 新建，契约），带 sdkSessionId 续跑
    setSparkLlmFactoryForTests(scriptFactory([text('续跑回答。')]))
    const observed2: string[] = []
    const executor2 = new SparkEngineExecutor()
    const events2 = collectEvents(executor2)
    await executor2.executeTurn(
      'sess-1',
      'turn-2',
      '继续',
      makeConfig({
        sdkSessionId: ledgerSessionId,
        continueSession: true,
        sparkSessionIdObserver: (id) => {
          observed2.push(id)
        },
      }),
    )

    // openSession 重放：上报的仍是同一 ledger 会话 id（newSession 会产生新 id）
    expect(observed2).toEqual([ledgerSessionId])
    expect(events2.at(-1)).toMatchObject({ type: 'agent_status', status: 'completed' })
  })

  it('路由失败（缺 apiKey）：agent_error + error 终态，不抛异常', async () => {
    const executor = new SparkEngineExecutor()
    const events = collectEvents(executor)
    await executor.executeTurn('sess-1', 'turn-1', '你好', makeConfig({ apiKey: '' }))

    const error = events.find((e) => e.type === 'agent_error')
    expect(error).toMatchObject({ code: 'spark_route_unresolvable' })
    expect(events.at(-1)).toMatchObject({ type: 'agent_status', status: 'error' })
  })

  it('引擎异常（fake script 耗尽）：兜底 error 终态，不抛异常', async () => {
    setSparkLlmFactoryForTests(scriptFactory([]))
    const executor = new SparkEngineExecutor()
    const events = collectEvents(executor)
    await executor.executeTurn('sess-1', 'turn-1', '你好', makeConfig())

    const statuses = events.filter((e) => e.type === 'agent_status')
    expect(statuses.at(-1)).toMatchObject({ status: 'error' })
  })
})
