/**
 * Session resume 兼容层 shim（W4.3 B-1）。
 *
 * 真实实现已迁到 `./session-resume-gate.ts` 的 `ResumeGateManager` class。
 * 本文件保留 module-level 函数 / 常量 / 类型重导出，供历史单测和老调用继续工作。
 * SessionService 内部统一走 `this.resumeGate.xxx(...)`。
 */

import type { AgentAdapterKind, ResumeSafeParams } from './session-resume-gate.js'
import { defaultResumeGate } from './session-resume-gate.js'

export type { AgentAdapterKind, ResumeGateConfig, ResumeSafeParams } from './session-resume-gate.js'

// SDK resume 已启用（D-09）。严格白名单默认配置：仅原生 Anthropic + Claude 模型 +
// api.anthropic.com endpoint 走 resume；其余 provider 继续 fresh session。
// 失败兜底：claude-sdk-executor 已实现熔断器 + 自动 fallback fresh session。
// 真机灰度监控点：context_events 表的 SDK_RESUME_CIRCUIT_OPEN 计数。
export const ENABLE_CLAUDE_SDK_RESUME = true as const

export function isSdkResumeSafe(params: ResumeSafeParams): boolean {
  return defaultResumeGate.isSafe(params)
}

export function makeSdkRuntimeSessionId(
  sessionId: string,
  providerProfileId: string,
  model: string,
  agentAdapter: AgentAdapterKind,
  turnId?: string,
): string {
  return defaultResumeGate.makeRuntimeSessionId(sessionId, providerProfileId, model, agentAdapter, turnId)
}
