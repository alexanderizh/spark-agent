/**
 * Claude Agent SDK Executor
 *
 * Wraps @anthropic-ai/claude-agent-sdk to provide a full agent execution
 * engine that leverages Claude Code's battle-tested tools (Read, Edit, Bash,
 * Grep, Glob), agent loop, checkpoint system, and MCP integration.
 *
 * This executor REPLACES our own AgentLoop + ToolRegistry when selected,
 * delegating all tool execution, permission handling, and agent reasoning
 * to the SDK. Spark's role becomes:
 *   - Session & UI management
 *   - System prompt composition (rules + skills + context)
 *   - MCP server configuration passthrough
 *   - Permission mode mapping
 *   - Event stream translation (SDK messages → Spark AgentEvent)
 *   - Usage tracking & cost recording
 *
 * The SDK's query() returns an AsyncGenerator<SDKMessage>. We iterate it,
 * map each message to Spark AgentEvents, and emit them through our event
 * system so the existing UI renders correctly.
 *
 * When the SDK is unavailable (not installed), the executor throws
 * SDKNotAvailableError and SessionService fails the turn with SDK_REQUIRED.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { sep } from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import { AgentEventEmitter } from '../core/event-emitter.js'
import { mapSDKMessageToEvents } from './event-mapper.js'
import { mapPermissionMode, mergeToolPermissions, mapReasoningEffort } from './permission-mapper.js'
import type { SDKExecutorConfig, SDKMessage, SDKQueryFunction, SDKQueryOptions } from './types.js'

type SDKModule = { query: SDKQueryFunction }

const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

let sdkModule: SDKModule | null = null
let sdkLoadAttempted = false

async function loadSDK(): Promise<SDKModule | null> {
  if (sdkLoadAttempted) return sdkModule
  sdkLoadAttempted = true
  try {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk') as SDKModule
    return sdkModule
  } catch {
    sdkModule = null
    return null
  }
}

export async function isSDKAvailable(): Promise<boolean> {
  const sdk = await loadSDK()
  return sdk != null
}

export function resetSDKLoadState(): void {
  sdkLoadAttempted = false
  sdkModule = null
}

export class ClaudeSDKExecutor {
  private emitter = new AgentEventEmitter()
  private abortController: AbortController | null = null

  onEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.on(listener)
  }

  offEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.off(listener)
  }

  cancel(): void {
    this.abortController?.abort()
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const sdk = await loadSDK()
    if (sdk == null) {
      throw new SDKNotAvailableError()
    }

    this.abortController = new AbortController()
    const ctx = { sessionId, turnId, toolNamesById: new Map<string, string>() }
    const makeBase = () => ({
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    // Emit user message
    this.emitter.emit({
      ...makeBase(),
      type: 'user_message',
      content: userMessage,
    })

    this.emitter.emit({
      ...makeBase(),
      type: 'agent_status',
      status: 'thinking',
    })
    this.emitter.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: estimateSDKPromptTokens(userMessage, config),
      softLimitTokens: softContextLimit(config.model),
      contextWindowTokens: contextWindow(config.model),
      compacted: false,
    })

    // Build permission config
    const permConfig = mapPermissionMode(config.permissionMode)
    const mergedPerms = mergeToolPermissions(
      permConfig,
      config.allowedTools,
      config.disallowedTools,
    )

    // Build composite system prompt
    const systemPrompt = buildCompositeSystemPrompt(config)
    const claudeCodeExecutable = resolveClaudeCodeExecutable()

    // Build SDK options
    const options: SDKQueryOptions = {
      abortController: this.abortController,
      model: config.model,
      cwd: config.workspaceRootPath,
      ...(claudeCodeExecutable != null ? { pathToClaudeCodeExecutable: claudeCodeExecutable } : {}),
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: config.apiKey,
        ...(config.apiEndpoint != null ? { ANTHROPIC_BASE_URL: config.apiEndpoint } : {}),
      },

      // Use Claude Code's built-in system prompt as base, append our customizations
      systemPrompt: systemPrompt != null
        ? { type: 'preset', preset: 'claude_code', append: systemPrompt }
        : { type: 'preset', preset: 'claude_code' },

      permissionMode: mergedPerms.permissionMode,
      ...(mergedPerms.allowedTools.length > 0 ? { allowedTools: mergedPerms.allowedTools } : {}),
      ...(mergedPerms.disallowedTools.length > 0 ? { disallowedTools: mergedPerms.disallowedTools } : {}),
      ...(config.mcpServers != null ? { mcpServers: config.mcpServers } : {}),

      maxTurns: config.maxTurnCount ?? 25,
      ...(config.maxBudgetUsd != null ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
      effort: mapReasoningEffort(config.reasoningEffort),
      sessionId,
      ...(config.continueSession === true ? { continue: true } : {}),

      includePartialMessages: true,
      enableFileCheckpointing: config.enableCheckpoints ?? false,

      // Map Spark approval callback to SDK permission callback
      ...(config.approvalCallback != null ? {
        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>,
        ): Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }> => {
          try {
            const allowed = await config.approvalCallback!(sessionId, toolName, input)
            return allowed
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'User denied tool execution' }
          } catch {
            return { behavior: 'deny', message: 'Permission check failed' }
          }
        },
      } : {}),
    }

    try {
      const queryResult = sdk.query({ prompt: userMessage, options })

      for await (const message of queryResult) {
        if (this.abortController.signal.aborted) break

        const events = mapSDKMessageToEvents(message, ctx)
        for (const event of events) {
          this.emitter.emit(event)
        }
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'ABORTED',
          message: 'Turn cancelled by user',
          retryable: false,
        })
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'cancelled',
        })
      } else {
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'SDK_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
          rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
        })
      }
    }
  }
}

function buildCompositeSystemPrompt(config: SDKExecutorConfig): string | undefined {
  const sections: string[] = []

  if (config.skillSystemPrompt?.trim()) {
    sections.push(config.skillSystemPrompt)
  }

  if (config.systemPrompt?.trim()) {
    sections.push(config.systemPrompt)
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}

function estimateSDKPromptTokens(userMessage: string, config: SDKExecutorConfig): number {
  const chars = [
    userMessage,
    config.systemPrompt ?? '',
    config.skillSystemPrompt ?? '',
  ].join('\n').length
  return Math.ceil(chars / 3)
}

function contextWindow(model: string): number {
  return resolveModelContextWindow(model)
}

function softContextLimit(model: string): number {
  return resolveSoftContextLimit(model)
}

function resolveClaudeCodeExecutable(): string | undefined {
  const require = createRequire(import.meta.url)
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'

  for (const packageName of getClaudeNativePackageCandidates()) {
    try {
      const resolved = require.resolve(`${packageName}/${binaryName}`)
      const unpacked = toAsarUnpackedPath(resolved)
      if (existsSync(unpacked)) return unpacked
      if (existsSync(resolved)) return resolved
    } catch {
      // Try the next platform package candidate.
    }
  }

  return undefined
}

function getClaudeNativePackageCandidates(): string[] {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux') {
    const glibcFirst = [
      `${CLAUDE_AGENT_SDK_PACKAGE}-linux-${arch}`,
      `${CLAUDE_AGENT_SDK_PACKAGE}-linux-${arch}-musl`,
    ]
    return isMuslRuntime() ? [...glibcFirst].reverse() : glibcFirst
  }

  return [`${CLAUDE_AGENT_SDK_PACKAGE}-${platform}-${arch}`]
}

function isMuslRuntime(): boolean {
  if (process.platform !== 'linux') return false
  const report = (typeof process.report?.getReport === 'function'
    ? process.report.getReport()
    : null) as { header?: { glibcVersionRuntime?: string } } | null
  return report != null && report.header?.glibcVersionRuntime === undefined
}

function toAsarUnpackedPath(filePath: string): string {
  const asarSegment = `${sep}app.asar${sep}`
  if (!filePath.includes(asarSegment)) return filePath
  return filePath.replace(asarSegment, `${sep}app.asar.unpacked${sep}`)
}

export class SDKNotAvailableError extends Error {
  constructor() {
    super(
      'Claude Agent SDK (@anthropic-ai/claude-agent-sdk) is not installed or failed to load. '
      + 'Install it with: pnpm add @anthropic-ai/claude-agent-sdk.',
    )
    this.name = 'SDKNotAvailableError'
  }
}
