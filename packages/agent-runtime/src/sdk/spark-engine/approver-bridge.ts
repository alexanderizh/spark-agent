import { abortError, throwIfAborted } from '@spark/agent'
import type { Approver, PermissionDecision, PermissionRequest } from '@spark/agent'

import type { SDKApprovalResult, SDKExecutorConfig, SDKPermissionRequestContext } from '../types.js'

/**
 * Spark 引擎审批桥：引擎 Approver 接缝 → host approvalCallback。
 *
 * 复用既有审批体系（desktop 侧 permission service：规则判定 + ask 弹卡 + 超时收回），
 * spark 引擎 default 模式下 approval !== 'never' 的工具（write/edit/bash…）经此桥
 * 走与 claude 相同的用户审批链路。取消语义：引擎传入的 signal 中止时抛
 * AgentAbortError（引擎 kernel 口径），host 回调被放弃。
 */
export class HostBridgeApprover implements Approver {
  readonly #sessionId: string
  readonly #callback: NonNullable<SDKExecutorConfig['approvalCallback']>

  constructor(sessionId: string, callback: NonNullable<SDKExecutorConfig['approvalCallback']>) {
    this.#sessionId = sessionId
    this.#callback = callback
  }

  async ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    throwIfAborted(signal)
    const context: SDKPermissionRequestContext = {
      signal,
      toolUseID: request.call.callId,
      requestId: request.requestId,
    }
    const raw = await raceWithAbort(
      this.#callback(this.#sessionId, request.call.name, normalizeArgs(request.call.args), context),
      signal,
    )
    return toEngineDecision(raw)
  }
}

/** boolean | SDKApprovalResult → 引擎 PermissionDecision。 */
export function toEngineDecision(raw: boolean | SDKApprovalResult): PermissionDecision {
  if (raw === true) return { decision: 'allow', grantScope: 'once' }
  if (raw === false) return { decision: 'deny', reason: 'User denied tool execution' }
  if (!raw.allowed) return { decision: 'deny', reason: 'User denied tool execution' }
  // 引擎 grant 只有 once/session 两档；project/global 规则已在 host permission service
  // 层面生效，引擎侧收敛为 session（本轮会话内免再问）。
  const grantScope =
    raw.scope === 'session' || raw.scope === 'project' || raw.scope === 'global'
      ? 'session'
      : 'once'
  return { decision: 'allow', grantScope }
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  return args != null && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

/** 回调与 signal 竞速：中止时抛引擎口径的 AgentAbortError，且不泄漏监听器。 */
async function raceWithAbort(
  promise: Promise<boolean | SDKApprovalResult>,
  signal: AbortSignal,
): Promise<boolean | SDKApprovalResult> {
  if (signal.aborted) throw abortError(signal.reason)
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(abortError(signal.reason))
      },
      { once: true },
    )
  })
  // race 落败方（未被 await 的 rejection）在此吞掉，避免 unhandledRejection。
  void abortPromise.catch(() => {})
  try {
    return await Promise.race([promise, abortPromise])
  } catch (error) {
    if (signal.aborted) throw abortError(signal.reason)
    throw error
  }
}
