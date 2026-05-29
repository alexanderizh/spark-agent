/**
 * Claude Agent SDK Executor
 *
 * Wraps @anthropic-ai/claude-agent-sdk to provide a full agent execution
 * engine that leverages Claude Code's battle-tested tools (Read, Edit, Bash,
 * Grep, Glob), agent loop, checkpoint system, and MCP integration.
 *
 * This executor is the Claude execution path,
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
import type { AgentEvent, AgentStatusValue } from '@spark/protocol'
import { createLogger, resolveModelContextWindow, resolveSoftContextLimit, resolveSoftContextLimitForWindow } from '@spark/shared'
import { AgentEventEmitter } from '../core/event-emitter.js'
import { mapSDKMessageToEvents } from './event-mapper.js'
import { mapPermissionMode, mergeToolPermissions, mapReasoningEffort } from './permission-mapper.js'
import type { SDKExecutorConfig, SDKMessage, SDKPermissionResult, SDKQueryFunction, SDKQueryOptions, SDKResultMessage, SDKSettings } from './types.js'

type SDKModule = { query: SDKQueryFunction }

const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
const log = createLogger('claude-sdk-executor')

const SDK_HOST_TOOL_INSTRUCTIONS = [
  'SDK host tool rules:',
  '- When using AskUserQuestion, every question must include an options array with 2-4 choices. Each option must include label and description. Do not ask open-ended questions through AskUserQuestion.',
  '- AskUserQuestion option previews may be HTML fragments; keep them self-contained when included.',
  '- ExitPlanMode plans are rendered as Markdown for the user, so provide the plan text directly in the plan field.',
].join('\n')

const ENV_BLOCKLIST_PREFIXES = ['ANTHROPIC_', 'CLAUDE_'] as const
const DEFAULT_SDK_MAX_TURNS = 80
const DEFAULT_MAX_TURN_EXTENSION_RETRIES = 2
const DEFAULT_MAX_TURN_EXTENSION_CAP = 500

let sdkModule: SDKModule | null = null
let sdkLoadAttempted = false

function buildIsolatedRuntimeEnv(apiKey: string, apiEndpoint?: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue
    if (ENV_BLOCKLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  env.ANTHROPIC_API_KEY = apiKey
  if (apiEndpoint != null) env.ANTHROPIC_BASE_URL = apiEndpoint
  return env
}

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
      softLimitTokens: softContextLimit(config.model, config.contextWindowTokens),
      contextWindowTokens: contextWindow(config.model, config.contextWindowTokens),
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
    const sdkSessionId = config.sdkSessionId ?? sessionId

    let terminalStatusEmitted = false
    const emitTerminalStatus = (status: AgentStatusValue): void => {
      terminalStatusEmitted = true
      this.emitter.emit({
        ...makeBase(),
        type: 'agent_status',
        status,
      })
    }

    // Build SDK options
    const runtimeEnv = buildIsolatedRuntimeEnv(config.apiKey, config.apiEndpoint)
    const settings: SDKSettings = {
      model: config.model,
      env: runtimeEnv,
      permissions: {
        defaultMode: mergedPerms.permissionMode,
        ...(mergedPerms.allowedTools.length > 0 ? { allow: mergedPerms.allowedTools } : {}),
        ...(mergedPerms.disallowedTools.length > 0 ? { deny: mergedPerms.disallowedTools } : {}),
      },
    }

    let maxTurns = normalizePositiveInt(config.maxTurnCount, DEFAULT_SDK_MAX_TURNS, 1000)
    const maxTurnExtensionRetries = normalizeNonNegativeInt(config.maxTurnExtensionRetries, DEFAULT_MAX_TURN_EXTENSION_RETRIES, 10)
    const maxTurnExtensionCap = normalizePositiveInt(config.maxTurnExtensionCap, DEFAULT_MAX_TURN_EXTENSION_CAP, 1000)
    let extensionAttempts = 0
    let prompt = userMessage
    let resumeExistingSession = config.continueSession === true

    while (true) {
      const options: SDKQueryOptions = {
        abortController: this.abortController,
        model: config.model,
        cwd: config.workspaceRootPath,
        ...(claudeCodeExecutable != null ? { pathToClaudeCodeExecutable: claudeCodeExecutable } : {}),
        env: runtimeEnv,
        settings,
        settingSources: ['project'],
        persistSession: true,
        debug: true,
        stderr: (data: string) => {
          const text = data.trim()
          if (text.length === 0) return
          log.debug('Claude Code stderr', {
            sparkSessionId: sessionId,
            sdkSessionId,
            output: text,
          })
        },

        // Use Claude Code's built-in system prompt as base, append our customizations
        systemPrompt: systemPrompt != null
          ? { type: 'preset', preset: 'claude_code', append: systemPrompt }
          : { type: 'preset', preset: 'claude_code' },

        permissionMode: mergedPerms.permissionMode,
        ...(mergedPerms.allowedTools.length > 0 ? { allowedTools: mergedPerms.allowedTools } : {}),
        ...(mergedPerms.disallowedTools.length > 0 ? { disallowedTools: mergedPerms.disallowedTools } : {}),
        ...(config.mcpServers != null ? { mcpServers: config.mcpServers } : {}),
        skills: config.nativeSkills ?? [],
        toolConfig: {
          askUserQuestion: { previewFormat: 'html' },
        },

        maxTurns,
        ...(config.maxBudgetUsd != null ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        effort: mapReasoningEffort(config.reasoningEffort),
        ...(resumeExistingSession ? { resume: sdkSessionId } : { sessionId: sdkSessionId }),

        includePartialMessages: true,
        enableFileCheckpointing: config.enableCheckpoints ?? false,

        // Map Spark approval callback to SDK permission callback when Spark needs
        // extra policy on top of the SDK's native permission mode.
        ...(config.approvalCallback != null && shouldUseSparkPermissionCallback(config.permissionMode) ? {
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
            callbackOptions,
          ): Promise<SDKPermissionResult> => {
            try {
              // Handle AskUserQuestion specially - it needs user interaction
              if (isAskUserQuestionTool(toolName)) {
                const questionCallback = config.questionCallback
                if (questionCallback != null) {
                  // Extract questions from input
                  const questions = extractQuestionsFromInput(input)
                  // Wait for user to answer questions
                  const answers = await questionCallback(sessionId, questions)
                  // Return the answers as updated input
                  return allowTool(answers, callbackOptions.toolUseID, 'user_temporary')
                }
                // If no questionCallback, deny with helpful message
                return denyTool('AskUserQuestion requires user interaction but no questionCallback was provided', callbackOptions.toolUseID)
              }

              if (isAlwaysAllowedControlTool(toolName)) {
                return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
              }
              if (config.permissionMode === 'claude-auto-edits' && isEditTool(toolName)) {
                return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
              }
              const approvalCallback = config.approvalCallback
              if (approvalCallback == null) return denyTool('Permission check failed', callbackOptions.toolUseID)
              const allowed = await approvalCallback(sessionId, toolName, input)
              return allowed
                ? allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                : denyTool('User denied tool execution', callbackOptions.toolUseID)
            } catch {
              return denyTool('Permission check failed', callbackOptions.toolUseID)
            }
          },
        } : {}),
      }

      log.debug('SDK query options prepared', {
        sparkSessionId: sessionId,
        sdkSessionId,
        mode: resumeExistingSession ? 'resume' : 'fresh',
        model: config.model,
        apiEndpoint: config.apiEndpoint ?? null,
        resume: options.resume ?? null,
        sessionId: options.sessionId ?? null,
        permissionMode: options.permissionMode ?? null,
        settingsModel: typeof options.settings === 'string' ? null : options.settings?.model ?? null,
        settingsBaseUrl: typeof options.settings === 'string' ? null : options.settings?.env?.ANTHROPIC_BASE_URL ?? null,
        settingSources: options.settingSources ?? null,
        envAnthropicBaseUrl: options.env?.ANTHROPIC_BASE_URL ?? null,
        envHasAnthropicApiKey: typeof options.env?.ANTHROPIC_API_KEY === 'string' && options.env.ANTHROPIC_API_KEY.length > 0,
        cwd: options.cwd ?? null,
        maxTurns: options.maxTurns ?? null,
        maxTurnExtensionAttempt: extensionAttempts,
      })

      try {
        const queryResult = sdk.query({ prompt, options })
        let maxTurnsResult: SDKResultMessage | null = null

        for await (const message of queryResult) {
          if (this.abortController.signal.aborted) break
          if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
            log.debug('Claude Code init message received', {
              sparkSessionId: sessionId,
              sdkSessionId,
              initModel: message.model,
              initPermissionMode: message.permissionMode,
              initCwd: message.cwd,
              initTools: Array.isArray(message.tools) ? message.tools.length : null,
            })
          }

          if (isMaxTurnsResultMessage(message)) {
            maxTurnsResult = message
          }

          const events = mapSDKMessageToEvents(message, ctx)
          for (const event of events) {
            if (maxTurnsResult === message && event.type !== 'usage_update' && event.type !== 'checkpoint') {
              continue
            }
            if (event.type === 'agent_status' && isTerminalAgentStatus(event.status)) {
              terminalStatusEmitted = true
            }
            this.emitter.emit(event)
          }
        }

        if (this.abortController.signal.aborted) {
          this.emitter.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'ABORTED',
            message: 'Turn cancelled by user',
            retryable: false,
          })
          if (!terminalStatusEmitted) emitTerminalStatus('cancelled')
          return
        }

        if (maxTurnsResult != null) {
          const nextMaxTurns = Math.min(maxTurnExtensionCap, maxTurns * 2)
          if (extensionAttempts < maxTurnExtensionRetries && nextMaxTurns > maxTurns) {
            extensionAttempts += 1
            this.emitter.emit({
              ...makeBase(),
              type: 'agent_status',
              status: 'thinking',
              message: `Reached maximum turns (${maxTurns}); automatically extending to ${nextMaxTurns} (retry ${extensionAttempts}/${maxTurnExtensionRetries}).`,
            })
            maxTurns = nextMaxTurns
            prompt = buildMaxTurnContinuationPrompt()
            resumeExistingSession = true
            continue
          }

          this.emitter.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'MAX_ITERATIONS',
            message: buildMaxTurnLimitMessage(maxTurns, extensionAttempts),
            retryable: false,
            rawError: maxTurnsResult.errors?.join('; ') ?? maxTurnsResult.subtype,
          })
          if (!terminalStatusEmitted) emitTerminalStatus('error')
          return
        }

        if (!terminalStatusEmitted) emitTerminalStatus('completed')
        return
      } catch (err) {
        if (this.abortController.signal.aborted) {
          this.emitter.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'ABORTED',
            message: 'Turn cancelled by user',
            retryable: false,
          })
          if (!terminalStatusEmitted) emitTerminalStatus('cancelled')
          return
        }

        this.emitter.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'SDK_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
          rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        if (!terminalStatusEmitted) emitTerminalStatus('error')
        throw err
      }
    }
  }
}

function isTerminalAgentStatus(status: AgentStatusValue): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled' || status === 'idle'
}

function isMaxTurnsResultMessage(message: SDKMessage): message is SDKResultMessage {
  return message.type === 'result' && (message as SDKResultMessage).subtype === 'error_max_turns'
}

function normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(max, Math.floor(value)))
}

function buildMaxTurnContinuationPrompt(): string {
  return [
    'Continue the previous task from the point where the agent stopped because it reached the max-turn limit.',
    'Do not repeat completed work. Inspect the current workspace state if needed, continue the remaining steps, and finish with a concise status update.',
  ].join('\n')
}

function buildMaxTurnLimitMessage(maxTurns: number, extensionAttempts: number): string {
  if (extensionAttempts === 0) {
    return `Reached maximum number of turns (${maxTurns}). Review progress and choose whether to continue.`
  }
  const noun = extensionAttempts === 1 ? 'extension' : 'extensions'
  return `Reached maximum number of turns (${maxTurns}) after ${extensionAttempts} automatic ${noun}. Review progress and choose whether to continue.`
}

function buildCompositeSystemPrompt(config: SDKExecutorConfig): string | undefined {
  const sections: string[] = [SDK_HOST_TOOL_INSTRUCTIONS]

  if (config.skillSystemPrompt?.trim()) {
    sections.push(config.skillSystemPrompt)
  }

  if (config.systemPrompt?.trim()) {
    sections.push(config.systemPrompt)
  }

  return sections.join('\n\n')
}

function allowTool(
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  decisionClassification: SDKPermissionResult['decisionClassification'],
): SDKPermissionResult {
  return {
    behavior: 'allow',
    updatedInput: input,
    ...(toolUseID != null ? { toolUseID } : {}),
    ...(decisionClassification != null ? { decisionClassification } : {}),
  }
}

function denyTool(message: string, toolUseID: string | undefined): SDKPermissionResult {
  return {
    behavior: 'deny',
    message,
    ...(toolUseID != null ? { toolUseID } : {}),
    decisionClassification: 'user_reject',
  }
}

function isAlwaysAllowedControlTool(toolName: string): boolean {
  const normalized = toolName.replace(/-/g, '_').toLowerCase()
  return normalized === 'exitplanmode'
    || normalized === 'exit_plan_mode'
    || normalized === 'enterplanmode'
    || normalized === 'enter_plan_mode'
  // Note: AskUserQuestion is NOT always allowed - it needs user interaction
  // to provide answers. It's handled separately in canUseTool callback.
}

function isAskUserQuestionTool(toolName: string): boolean {
  const normalized = toolName.replace(/-/g, '_').toLowerCase()
  return normalized === 'askuserquestion' || normalized === 'ask_user_question'
}

/**
 * Extract questions from AskUserQuestion tool input.
 * The input format follows SDK's AskUserQuestion schema:
 * { questions: [{ question, header, options: [{ label, description, preview }] }] }
 */
function extractQuestionsFromInput(input: Record<string, unknown>): Array<{
  question: string
  header: string
  options: Array<{ label: string; description?: string; preview?: string }>
}> {
  const questions = input.questions
  if (!Array.isArray(questions)) {
    // Single question format: { question, header, options }
    const question = typeof input.question === 'string' ? input.question : ''
    const header = typeof input.header === 'string' ? input.header : ''
    const options = normalizeQuestionOptions(input.options)
    if (question && options.length > 0) {
      return [{ question, header, options }]
    }
    return []
  }

  return questions
    .map((q: unknown) => {
      if (typeof q !== 'object' || q == null) return null
      const qObj = q as Record<string, unknown>
      const question = typeof qObj.question === 'string' ? qObj.question : ''
      const header = typeof qObj.header === 'string' ? qObj.header : ''
      const options = normalizeQuestionOptions(qObj.options)
      if (!question || options.length === 0) return null
      return { question, header, options }
    })
    .filter((q): q is NonNullable<typeof q> => q != null)
}

function normalizeQuestionOptions(options: unknown): Array<{ label: string; description?: string; preview?: string }> {
  if (!Array.isArray(options)) return []
  return options
    .map((opt: unknown) => {
      if (typeof opt !== 'object' || opt == null) return null
      const optObj = opt as Record<string, unknown>
      const label = typeof optObj.label === 'string' ? optObj.label : ''
      if (!label) return null
      const hasDescription = typeof optObj.description === 'string'
      const hasPreview = typeof optObj.preview === 'string'
      return {
        label,
        ...(hasDescription ? { description: optObj.description as string } : {}),
        ...(hasPreview ? { preview: optObj.preview as string } : {}),
      }
    })
    .filter((opt): opt is NonNullable<typeof opt> => opt != null)
}

function shouldUseSparkPermissionCallback(permissionMode: SDKExecutorConfig['permissionMode']): boolean {
  return permissionMode !== 'claude-auto'
    && permissionMode !== 'claude-bypass'
    && permissionMode !== 'codex-full-access'
}

function isEditTool(toolName: string): boolean {
  return toolName === 'Edit'
    || toolName === 'Write'
    || toolName === 'MultiEdit'
    || toolName === 'NotebookEdit'
    || toolName === 'edit_file'
    || toolName === 'write_file'
    || toolName === 'multi_edit'
    || toolName === 'apply_patch'
}

function estimateSDKPromptTokens(userMessage: string, config: SDKExecutorConfig): number {
  const chars = [
    userMessage,
    config.systemPrompt ?? '',
    config.skillSystemPrompt ?? '',
  ].join('\n').length
  return Math.ceil(chars / 3)
}

function contextWindow(model: string, configuredContextWindow?: number): number {
  return configuredContextWindow !== undefined ? configuredContextWindow : resolveModelContextWindow(model)
}

function softContextLimit(model: string, configuredContextWindow?: number): number {
  return configuredContextWindow !== undefined ? resolveSoftContextLimitForWindow(configuredContextWindow) : resolveSoftContextLimit(model)
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
