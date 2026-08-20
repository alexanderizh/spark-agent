import { createHash } from 'node:crypto'
import type {
  AppServerClientInfo,
  AppServerThreadParamsBase,
  JsonRpcErrorShape,
} from './app-server-protocol.js'
import {
  CodexAppServerClient,
  CodexAppServerProcessExitedError,
} from './codex-app-server-client.js'
import { CodexAppServerRouter } from './codex-app-server-router.js'
import {
  readCodexRuntimeProcessStats,
  type CodexRuntimeProcessStats,
} from './codex-runtime-process-stats.js'

export interface CodexAppServerRuntimeOptions {
  executablePath: string
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  handshakeTimeoutMs?: number | undefined
  clientInfo: AppServerClientInfo
  onProtocolError?: ((error: Error) => void) | undefined
}

export interface CodexAppServerStartupMetrics {
  spawnMs: number
  initializeMs: number
}

/**
 * 一个已完成 initialize/initialized 的 Codex App Server transport。
 * thread/turn 生命周期由 executor 与 router 管理；本类只拥有进程级资源。
 */
export class CodexAppServerRuntime {
  private readonly loadedThreads = new Map<
    string,
    { threadFingerprint: string; threadId: string }
  >()

  private constructor(
    readonly client: CodexAppServerClient,
    readonly router: CodexAppServerRouter,
    readonly startupMetrics: CodexAppServerStartupMetrics,
  ) {}

  static async start(options: CodexAppServerRuntimeOptions): Promise<CodexAppServerRuntime> {
    const router = new CodexAppServerRouter({
      onHandlerError: options.onProtocolError,
      onUnroutedServerRequest: respondToUnroutedServerRequest,
    })
    const spawnStartedAt = performance.now()
    const client = CodexAppServerClient.spawn({
      executablePath: options.executablePath,
      args: options.args,
      env: options.env,
      onProtocolError: options.onProtocolError,
      onNotification: (method, params) => router.handleNotification(method, params),
      onServerRequest: (method, params, respond, reject) =>
        router.handleServerRequest(method, params, respond, reject),
      onExit: (code, signal, stderrTail) => {
        router.handleTransportFailure(
          new CodexAppServerProcessExitedError(code, signal, stderrTail),
        )
      },
    })
    try {
      await client.waitUntilSpawned(options.handshakeTimeoutMs ?? 15_000)
      const spawnMs = roundedElapsed(spawnStartedAt)
      const initializeStartedAt = performance.now()
      await client.initialize(options.clientInfo, options.handshakeTimeoutMs ?? 15_000)
      const initializeMs = roundedElapsed(initializeStartedAt)
      return new CodexAppServerRuntime(client, router, { spawnMs, initializeMs })
    } catch (error) {
      await client.dispose().catch(() => undefined)
      throw error
    }
  }

  get hasExited(): boolean {
    return this.client.hasExited
  }

  findLoadedThread(bindingKey: string, threadFingerprint: string): string | null {
    const binding = this.loadedThreads.get(bindingKey)
    return binding?.threadFingerprint === threadFingerprint ? binding.threadId : null
  }

  rememberLoadedThread(bindingKey: string, threadFingerprint: string, threadId: string): void {
    this.loadedThreads.set(bindingKey, { threadFingerprint, threadId })
  }

  async dispose(): Promise<void> {
    await this.client.dispose()
  }

  async getDiagnostics(): Promise<
    (CodexRuntimeProcessStats & { loadedThreadCount: number }) | null
  > {
    const stats = await readCodexRuntimeProcessStats(this.client.processId)
    return stats == null ? null : { ...stats, loadedThreadCount: this.loadedThreads.size }
  }
}

/** 进程复用 fingerprint：秘密只参与单向摘要，永不进入日志或诊断字段。 */
export function createCodexAppServerRuntimeFingerprint(input: {
  executablePath: string
  args?: readonly string[] | undefined
  env?: Readonly<Record<string, string>> | undefined
}): string {
  const stable = {
    executablePath: input.executablePath,
    args: [...(input.args ?? ['app-server'])],
    env: Object.entries(input.env ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

/**
 * thread 级 fingerprint：只包含无法由 `turn/start` 安全覆盖的 thread 配置。
 * 权限、sandbox roots 与网络策略是 0.149.0 官方 sticky turn 配置，切换时不应强制
 * 新建 native thread；每轮由 executor 显式覆盖。原始 MCP/env/header 仍只参与摘要。
 */
export function createCodexAppServerThreadFingerprint(params: AppServerThreadParamsBase): string {
  const {
    sandbox: _sandbox,
    approvalPolicy: _approvalPolicy,
    approvalsReviewer: _approvalsReviewer,
    config,
    ...stableThreadParams
  } = params
  const {
    approvals_reviewer: _configApprovalsReviewer,
    sandbox_workspace_write: _sandboxWorkspaceWrite,
    ...stableConfig
  } = config ?? {}
  return createHash('sha256')
    .update(
      stableJson({
        ...stableThreadParams,
        ...(config == null ? {} : { config: stableConfig }),
      }),
    )
    .digest('hex')
}

export function isPersistentCodexRuntimeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SPARK_CODEX_PERSISTENT_RUNTIME === '1'
}

function respondToUnroutedServerRequest(
  method: string,
  _params: unknown,
  respond: (result: unknown) => void,
  reject: (error: JsonRpcErrorShape) => void,
): void {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
    case 'execCommandApproval':
      respond({ decision: 'deny' })
      return
    case 'item/permissions/requestApproval':
      respond({ permissions: { fileSystem: null, network: null }, scope: 'turn' })
      return
    case 'item/tool/requestUserInput':
      respond({ answers: {} })
      return
    case 'mcpServer/elicitation/request':
      respond({ action: 'cancel' })
      return
    default:
      reject({ code: -32601, message: `spark client does not support ${method}` })
  }
}

function roundedElapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForStableJson(item))
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForStableJson(entry)]),
  )
}
