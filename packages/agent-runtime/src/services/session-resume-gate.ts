/**
 * SDK Resume gate（W4.3 B-1）：把 session-resume.ts 的纯函数 + 常量封装成 class，
 * 由 SessionService 注入并通过实例方法调用。允许未来注入：telemetry / 灰度 / 配置覆盖。
 *
 * 配套 shim `./session-resume.ts` 保留 module-level 函数（仅做 re-export），
 * 外部单测和上层调用保持原 API 不变。
 */

import crypto from 'node:crypto'

export type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'

export interface ResumeSafeParams {
  providerType: string
  apiEndpoint?: string
  model: string
  agentAdapter: AgentAdapterKind
}

export interface ResumeGateConfig {
  enabled?: boolean
  allowedAdapterKinds?: ReadonlySet<AgentAdapterKind>
  allowedModelPrefixes?: readonly string[]
  allowedProviderTypes?: ReadonlySet<string>
  allowedHostnames?: ReadonlySet<string>
}

const DEFAULT_ALLOWED_ADAPTERS: ReadonlySet<AgentAdapterKind> = new Set(['claude', 'claude-sdk'])
const DEFAULT_ALLOWED_MODELS: readonly string[] = ['claude']
const DEFAULT_ALLOWED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])
const DEFAULT_ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(['api.anthropic.com'])

export class ResumeGateManager {
  private readonly enabled: boolean
  private readonly allowedAdapterKinds: ReadonlySet<AgentAdapterKind>
  private readonly allowedModelPrefixes: readonly string[]
  private readonly allowedProviderTypes: ReadonlySet<string>
  private readonly allowedHostnames: ReadonlySet<string>

  constructor(config: ResumeGateConfig = {}) {
    this.enabled = config.enabled ?? true
    this.allowedAdapterKinds = config.allowedAdapterKinds ?? DEFAULT_ALLOWED_ADAPTERS
    this.allowedModelPrefixes = config.allowedModelPrefixes ?? DEFAULT_ALLOWED_MODELS
    this.allowedProviderTypes = config.allowedProviderTypes ?? DEFAULT_ALLOWED_PROVIDERS
    this.allowedHostnames = config.allowedHostnames ?? DEFAULT_ALLOWED_HOSTNAMES
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  isSafe(params: ResumeSafeParams): boolean {
    if (!this.enabled) return false
    if (!this.allowedAdapterKinds.has(params.agentAdapter)) return false
    if (!this.allowedModelPrefixes.some((p) => params.model.toLowerCase().startsWith(p))) return false
    if (!this.allowedProviderTypes.has(params.providerType)) return false
    if (params.apiEndpoint == null || params.apiEndpoint.length === 0) return true

    try {
      const url = new URL(params.apiEndpoint)
      return this.allowedHostnames.has(url.hostname)
    } catch {
      return false
    }
  }

  makeRuntimeSessionId(
    sessionId: string,
    providerProfileId: string,
    model: string,
    agentAdapter: AgentAdapterKind,
    turnId?: string,
  ): string {
    const hash = crypto
      .createHash('sha256')
      .update([sessionId, providerProfileId, model, agentAdapter, turnId ?? 'stable'].join('\0'))
      .digest()
    hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40
    hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
    const hex = hash.subarray(0, 16).toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}

const defaultGate = new ResumeGateManager()

/** 默认实例的 isSafe，兼容历史 module-level 名字。 */
export function isSdkResumeSafe(params: ResumeSafeParams): boolean {
  return defaultGate.isSafe(params)
}

/** 默认实例的 makeRuntimeSessionId，兼容历史 module-level 名字。 */
export function makeSdkRuntimeSessionId(
  sessionId: string,
  providerProfileId: string,
  model: string,
  agentAdapter: AgentAdapterKind,
  turnId?: string,
): string {
  return defaultGate.makeRuntimeSessionId(sessionId, providerProfileId, model, agentAdapter, turnId)
}
