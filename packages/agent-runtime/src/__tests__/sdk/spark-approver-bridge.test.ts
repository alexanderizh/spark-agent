import { describe, expect, it } from 'vitest'

import { HostBridgeApprover, toEngineDecision } from '../../sdk/spark-engine/approver-bridge.js'
import type { PermissionRequest } from '@spark/agent'

describe('toEngineDecision', () => {
  it('boolean true → allow once；false → deny', () => {
    expect(toEngineDecision(true)).toEqual({ decision: 'allow', grantScope: 'once' })
    expect(toEngineDecision(false)).toEqual({
      decision: 'deny',
      reason: 'User denied tool execution',
    })
  })

  it('SDKApprovalResult：scope project/global 收敛为 session', () => {
    expect(toEngineDecision({ allowed: true })).toEqual({ decision: 'allow', grantScope: 'once' })
    expect(toEngineDecision({ allowed: true, scope: 'session' })).toEqual({
      decision: 'allow',
      grantScope: 'session',
    })
    expect(toEngineDecision({ allowed: true, scope: 'project' })).toEqual({
      decision: 'allow',
      grantScope: 'session',
    })
    expect(toEngineDecision({ allowed: true, scope: 'global' })).toEqual({
      decision: 'allow',
      grantScope: 'session',
    })
    expect(toEngineDecision({ allowed: false })).toEqual({
      decision: 'deny',
      reason: 'User denied tool execution',
    })
  })
})

function makeRequest(): PermissionRequest {
  return {
    requestId: 'req-1',
    call: {
      callId: 'call-1',
      name: 'write',
      args: { path: 'a.ts', content: 'x' },
      definition: { name: 'write' },
    },
    argsPreview: 'write a.ts',
    allowedGrantScopes: ['once', 'session'],
  } as unknown as PermissionRequest
}

describe('HostBridgeApprover', () => {
  it('ask 透传 sessionId/工具名/args，并映射 allow 结果', async () => {
    const seen: Array<{ sid: string; tool: string; input: Record<string, unknown> }> = []
    const approver = new HostBridgeApprover('sess-1', async (sid, tool, input) => {
      seen.push({ sid, tool, input })
      return { allowed: true, scope: 'session' }
    })
    const decision = await approver.ask(makeRequest(), new AbortController().signal)
    expect(decision).toEqual({ decision: 'allow', grantScope: 'session' })
    expect(seen).toEqual([{ sid: 'sess-1', tool: 'write', input: { path: 'a.ts', content: 'x' } }])
  })

  it('deny 结果携带原因', async () => {
    const approver = new HostBridgeApprover('sess-1', async () => false)
    const decision = await approver.ask(makeRequest(), new AbortController().signal)
    expect(decision).toEqual({ decision: 'deny', reason: 'User denied tool execution' })
  })

  it('非对象 args 归一为空 record（不抛异常）', async () => {
    const approver = new HostBridgeApprover('sess-1', async (_sid, _tool, input) => {
      expect(input).toEqual({})
      return true
    })
    const request = { ...makeRequest(), call: { ...makeRequest().call, args: 'not-object' } }
    const decision = await approver.ask(
      request as unknown as PermissionRequest,
      new AbortController().signal,
    )
    expect(decision.decision).toBe('allow')
  })

  it('signal 已中止：直接抛 abort 错误，不调用回调', async () => {
    let called = false
    const approver = new HostBridgeApprover('sess-1', async () => {
      called = true
      return true
    })
    const controller = new AbortController()
    controller.abort()
    await expect(approver.ask(makeRequest(), controller.signal)).rejects.toThrow()
    expect(called).toBe(false)
  })

  it('等待中中止：竞速抛 abort 错误', async () => {
    const approver = new HostBridgeApprover(
      'sess-1',
      () => new Promise(() => {}) as Promise<boolean>,
    )
    const controller = new AbortController()
    const pending = approver.ask(makeRequest(), controller.signal)
    setTimeout(() => controller.abort(), 5)
    await expect(pending).rejects.toThrow()
  })
})
