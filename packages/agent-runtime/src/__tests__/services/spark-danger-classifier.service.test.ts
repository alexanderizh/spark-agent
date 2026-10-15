import type { DangerClassifierInput, DangerVerdict } from '@spark/agent'
import { describe, expect, it } from 'vitest'

import type { ModelService } from '../../services/model.service.js'
import {
  createSparkDangerClassifierFromComplete,
} from '../../services/spark-danger-classifier.service.js'

/**
 * spark-auto 危险分类器单测：注入假 complete，覆盖 JSON 形态、重试语义、
 * fail-closed 降级与取消路径。mock 模式对齐 auto-router 分流器测试。
 */

function makeInput(overrides?: Partial<DangerClassifierInput>): DangerClassifierInput {
  return {
    tool: 'bash',
    args: { command: 'find / -name "*.log" -delete' },
    command: 'find / -name "*.log" -delete',
    cwd: '/workspace/demo',
    sessionId: 'engine-session-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

interface CompleteCall {
  prompt: string
  opts: Parameters<ModelService['complete']>[1]
}

type CompleteResult = Awaited<ReturnType<ModelService['complete']>>

/** 脚本耗尽后重复最后一个结果（对齐分流器 mock 的「持续失败」语义）。 */
function makeComplete(results: CompleteResult[]): {
  calls: CompleteCall[]
  complete: ModelService['complete']
} {
  const calls: CompleteCall[] = []
  const queue = [...results]
  let last: CompleteResult | undefined
  return {
    calls,
    complete: async (prompt, opts) => {
      calls.push({ prompt, opts })
      const next = queue.shift()
      if (next !== undefined) last = next
      if (last == null) throw new Error('no scripted complete result')
      return last
    },
  }
}

function firstCall(calls: CompleteCall[]): CompleteCall {
  const call = calls[0]
  if (call == null) throw new Error('expected at least one complete call')
  return call
}

const OK = (text: string): CompleteResult => ({ available: true, text })
const FAIL = (reason: string): CompleteResult => ({ available: false, reason })

describe('spark danger classifier', () => {
  it('parses a plain JSON verdict and forwards model params verbatim', async () => {
    const { calls, complete } = makeComplete([
      OK('{"verdict":"dangerous","reason":"命令会删除全盘日志文件"}'),
    ])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    const input = makeInput()
    const verdict = await classifier.classify(input)

    expect(verdict).toEqual({ kind: 'dangerous', reason: '命令会删除全盘日志文件' })
    expect(calls).toHaveLength(1)
    const { opts, prompt } = firstCall(calls)
    expect(opts?.sessionId).toBe('spark-danger:s-1')
    expect(opts?.maxTokens).toBe(128)
    expect(opts?.timeoutMs).toBe(8000)
    expect(opts?.maxRetries).toBe(1)
    expect(opts?.abortSignal).toBe(input.signal)
    expect(prompt).toContain('/workspace/demo')
    expect(prompt).toContain('find / -name "*.log" -delete')
  })

  it('parses a fenced JSON verdict as safe', async () => {
    const { complete } = makeComplete([
      OK('前置说明\n```json\n{"verdict":"safe","reason":"常规构建命令"}\n```\n'),
    ])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    await expect(classifier.classify(makeInput())).resolves.toEqual({
      kind: 'safe',
    })
  })

  it('defaults the reason when the model omits it on a dangerous verdict', async () => {
    const { complete } = makeComplete([OK('{"verdict":"dangerous"}')])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    await expect(classifier.classify(makeInput())).resolves.toEqual({
      kind: 'dangerous',
      reason: '模型判定命令存在风险',
    })
  })

  it('degrades to fail-closed dangerous after two malformed responses', async () => {
    const { calls, complete } = makeComplete([OK('这不是 JSON'), OK('{"verdict":"也许"}')])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    const verdict = await classifier.classify(makeInput())

    expect(verdict).toEqual({ kind: 'dangerous', reason: '安全审查服务暂不可用，请人工确认' })
    expect(calls).toHaveLength(2)
    // 第二次尝试强调只输出 JSON。
    expect(calls[1]?.prompt).toContain('只输出')
  })

  it('stops retrying on deterministic 4xx failures (single call)', async () => {
    const { calls, complete } = makeComplete([FAIL('HTTP 401: Unauthorized')])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    const verdict = await classifier.classify(makeInput())

    expect(verdict).toEqual({ kind: 'dangerous', reason: '安全审查服务暂不可用，请人工确认' })
    expect(calls).toHaveLength(1)
  })

  it('retries transient failures twice before the fail-closed verdict', async () => {
    const { calls, complete } = makeComplete([FAIL('HTTP timeout after 8000ms')])
    const classifier = createSparkDangerClassifierFromComplete({
      complete,
      sessionId: 's-1',
      timeoutMs: 4000,
    })
    const verdict = await classifier.classify(makeInput())

    expect(verdict.kind).toBe('dangerous')
    expect(calls).toHaveLength(2)
    expect(firstCall(calls).opts?.timeoutMs).toBe(4000)
  })

  it('returns unavailable without calling the model when the turn is already aborted', async () => {
    const { calls, complete } = makeComplete([OK('{"verdict":"safe"}')])
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })
    const controller = new AbortController()
    controller.abort()

    await expect(
      classifier.classify(makeInput({ signal: controller.signal })),
    ).resolves.toMatchObject({ kind: 'unavailable' })
    expect(calls).toHaveLength(0)
  })

  it('returns unavailable when the turn aborts between attempts', async () => {
    const controller = new AbortController()
    const calls: CompleteCall[] = []
    const complete: ModelService['complete'] = async (prompt, opts) => {
      calls.push({ prompt, opts })
      controller.abort()
      return FAIL('HTTP timeout after 8000ms')
    }
    const classifier = createSparkDangerClassifierFromComplete({ complete, sessionId: 's-1' })

    await expect(
      classifier.classify(makeInput({ signal: controller.signal })),
    ).resolves.toMatchObject({ kind: 'unavailable' })
    expect(calls).toHaveLength(1)
  })
})
