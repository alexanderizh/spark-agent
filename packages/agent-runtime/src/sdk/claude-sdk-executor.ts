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
import type { AgentEvent, AgentStatusValue, UserQuestionOption, UserQuestionPrompt } from '@spark/protocol'
import {
  createLogger,
  resolveModelContextWindow,
  resolveSoftContextLimit,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'
import { AgentEventEmitter } from '../core/event-emitter.js'
import { mapSDKMessageToEvents } from './event-mapper.js'
import { mapPermissionMode, mergeToolPermissions, mapReasoningEffort } from './permission-mapper.js'
import type {
  SDKExecutorConfig,
  SDKMcpServerConfig,
  SDKMessage,
  SDKPermissionResult,
  SDKQueryFunction,
  SDKQueryOptions,
  SDKResultMessage,
  SDKSettings,
} from './types.js'
import { classifyResumeError, ResumeCircuitBreaker } from './types.js'

type SDKModule = { query: SDKQueryFunction }

const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
const log = createLogger('claude-sdk-executor')

const SDK_HOST_TOOL_INSTRUCTIONS = [
  'SDK host tool rules:',
  '- When using AskUserQuestion, prefer structured prompts. Use `type: "single_choice"` with 2-5 clear options for fast decisions, or `type: "text"` when the user must type a custom answer.',
  '- For single-choice questions, include concise labels and descriptions. If canned options may not fit, set `allowOther: true` or mark an option with `allowsFreeText: true`.',
  '- AskUserQuestion option previews may be HTML fragments; keep them self-contained when included.',
  '- ExitPlanMode plans are rendered as Markdown for the user, so provide the plan text directly in the plan field.',
].join('\n')

const ENV_BLOCKLIST_PREFIXES = ['ANTHROPIC_', 'CLAUDE_'] as const
const DEFAULT_SDK_MAX_TURNS = 80
const DEFAULT_MAX_TURN_EXTENSION_RETRIES = 2
const DEFAULT_MAX_TURN_EXTENSION_CAP = 500

let sdkModule: SDKModule | null = null
let sdkLoadAttempted = false

/** Shared circuit breaker for SDK resume attempts across all sessions. */
const resumeCircuitBreaker = new ResumeCircuitBreaker()

/** Access the shared circuit breaker (for testing / session service integration). */
export function getResumeCircuitBreaker(): ResumeCircuitBreaker {
  return resumeCircuitBreaker
}

function buildIsolatedRuntimeEnv(
  apiKey: string,
  model: string,
  apiEndpoint?: string,
  tierModels?: { haiku?: string | undefined; sonnet?: string | undefined; opus?: string | undefined },
  useLocalConfig?: boolean,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue
    // Local CLI 模式下保留宿主机的 ANTHROPIC_*/CLAUDE_* 环境，让 SDK 透明继承
    // OAuth 凭证、自定义 base url、模型偏好等本地 claude CLI 配置。
    if (!useLocalConfig && ENV_BLOCKLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  if (useLocalConfig === true) {
    // 不覆写任何 ANTHROPIC_*；SDK 会回落到 ~/.claude/.credentials.json 或宿主环境。
    return env
  }
  env.ANTHROPIC_API_KEY = apiKey
  if (apiEndpoint != null) env.ANTHROPIC_BASE_URL = apiEndpoint
  // Map Claude tier slots: prefer per-tier override, fall back to provider's
  // single configured model. Without this, SDK-spawned subagents (which default
  // to the Haiku tier) would request an Anthropic model ID the third-party
  // provider doesn't expose, producing 400 invalid_model.
  const haiku = tierModels?.haiku?.trim() || model
  const sonnet = tierModels?.sonnet?.trim() || model
  const opus = tierModels?.opus?.trim() || model
  env.ANTHROPIC_MODEL = model
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus
  env.ANTHROPIC_SMALL_FAST_MODEL = haiku
  return env
}

async function loadSDK(): Promise<SDKModule | null> {
  if (sdkLoadAttempted) return sdkModule
  sdkLoadAttempted = true
  try {
    sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as SDKModule
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

/** in-process MCP 工具定义的处理器返回值（CallToolResult 的子集） */
export interface SdkMcpToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: unknown
  isError?: boolean
}

/** 从已加载的 Claude Agent SDK 暴露 in-process MCP server 工厂（createSdkMcpServer + tool）。
 *  用于 Team Mode 的 spark_team 工具——它需要在同进程内直接回调 dispatcher，
 *  因此必须用 SDK 的 in-process server（区别于 spark_image 的 stdio 子进程）。
 *  SDK 不可用时返回 null。 */
export async function loadSdkMcpFactory(): Promise<{
  createSdkMcpServer: (opts: { name: string; version?: string; tools: unknown[] }) => SDKMcpServerConfig
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<SdkMcpToolResult>,
  ) => unknown
} | null> {
  const sdk = (await loadSDK()) as
    | (SDKModule & {
        createSdkMcpServer?: (opts: { name: string; version?: string; tools: unknown[] }) => SDKMcpServerConfig
        tool?: (
          name: string,
          description: string,
          inputSchema: Record<string, unknown>,
          handler: (args: Record<string, unknown>, extra: unknown) => Promise<SdkMcpToolResult>,
        ) => unknown
      })
    | null
  if (sdk?.createSdkMcpServer == null || sdk.tool == null) return null
  return { createSdkMcpServer: sdk.createSdkMcpServer, tool: sdk.tool }
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
    const promptWithAttachments = buildPromptWithAttachments(userMessage, config.attachments)
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
      ...(config.attachments != null && config.attachments.length > 0
        ? {
            attachments: config.attachments.map((attachment) => ({
              type: attachment.type,
              path: attachment.path,
              name: attachment.name,
            })),
          }
        : {}),
    })

    this.emitter.emit({
      ...makeBase(),
      type: 'agent_status',
      status: 'thinking',
    })
    this.emitter.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: estimateSDKPromptTokens(promptWithAttachments, config),
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
    const runtimeEnv = buildIsolatedRuntimeEnv(
      config.apiKey,
      config.model,
      config.apiEndpoint,
      {
        haiku: config.haikuModel,
        sonnet: config.sonnetModel,
        opus: config.opusModel,
      },
      config.useLocalConfig === true,
    )
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
    const maxTurnExtensionRetries = normalizeNonNegativeInt(
      config.maxTurnExtensionRetries,
      DEFAULT_MAX_TURN_EXTENSION_RETRIES,
      10,
    )
    const maxTurnExtensionCap = normalizePositiveInt(
      config.maxTurnExtensionCap,
      DEFAULT_MAX_TURN_EXTENSION_CAP,
      1000,
    )
    let extensionAttempts = 0
    let prompt = promptWithAttachments
    let resumeExistingSession = config.continueSession === true

    while (true) {
      // Resolve sdkSessionId from config each iteration (resume recovery may update it)
      const sdkSessionId = config.sdkSessionId ?? sessionId
      const options: SDKQueryOptions = {
        abortController: this.abortController,
        model: config.model,
        cwd: config.workspaceRootPath,
        ...(claudeCodeExecutable != null
          ? { pathToClaudeCodeExecutable: claudeCodeExecutable }
          : {}),
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
        systemPrompt:
          systemPrompt != null
            ? { type: 'preset', preset: 'claude_code', append: systemPrompt }
            : { type: 'preset', preset: 'claude_code' },

        permissionMode: mergedPerms.permissionMode,
        ...(mergedPerms.allowedTools.length > 0 ? { allowedTools: mergedPerms.allowedTools } : {}),
        ...(mergedPerms.disallowedTools.length > 0
          ? { disallowedTools: mergedPerms.disallowedTools }
          : {}),
        ...(config.mcpServers != null ? { mcpServers: config.mcpServers } : {}),
        skills: config.nativeSkills ?? [],
        toolConfig: {
          askUserQuestion: { previewFormat: 'html' },
        },

        maxTurns,
        ...(config.maxBudgetUsd != null ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        effort: mapReasoningEffort(config.reasoningEffort),
        ...(resumeExistingSession ? { resume: sdkSessionId } : { sessionId: sdkSessionId }),
        ...(config.additionalDirectories != null && config.additionalDirectories.length > 0
          ? { additionalDirectories: config.additionalDirectories }
          : {}),

        includePartialMessages: true,
        enableFileCheckpointing: config.enableCheckpoints ?? false,

        // Map Spark callbacks to SDK permission callback when Spark needs extra
        // policy, or when AskUserQuestion needs to pause for user answers.
        ...((config.questionCallback != null ||
          (config.approvalCallback != null &&
            shouldUseSparkPermissionCallback(config.permissionMode)))
          ? {
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
                      // Return SDK-compatible answers keyed by question text.
                      return allowTool(
                        buildAskUserQuestionInputWithAnswers(input, questions, answers),
                        callbackOptions.toolUseID,
                        'user_temporary',
                      )
                    }
                    // If no questionCallback, deny with helpful message
                    return denyTool(
                      'AskUserQuestion requires user interaction but no questionCallback was provided',
                      callbackOptions.toolUseID,
                    )
                  }

                  if (isAlwaysAllowedControlTool(toolName)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  if (!shouldUseSparkPermissionCallback(config.permissionMode)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  if (config.permissionMode === 'claude-auto-edits' && isEditTool(toolName)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  const approvalCallback = config.approvalCallback
                  if (approvalCallback == null)
                    return denyTool('Permission check failed', callbackOptions.toolUseID)
                  const allowed = await approvalCallback(sessionId, toolName, input)
                  return allowed
                    ? allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                    : denyTool('User denied tool execution', callbackOptions.toolUseID)
                } catch {
                  return denyTool('Permission check failed', callbackOptions.toolUseID)
                }
              },
            }
          : {}),
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
        settingsModel:
          typeof options.settings === 'string' ? null : (options.settings?.model ?? null),
        settingsBaseUrl:
          typeof options.settings === 'string'
            ? null
            : (options.settings?.env?.ANTHROPIC_BASE_URL ?? null),
        settingSources: options.settingSources ?? null,
        envAnthropicBaseUrl: options.env?.ANTHROPIC_BASE_URL ?? null,
        envHasAnthropicApiKey:
          typeof options.env?.ANTHROPIC_API_KEY === 'string' &&
          options.env.ANTHROPIC_API_KEY.length > 0,
        cwd: options.cwd ?? null,
        maxTurns: options.maxTurns ?? null,
        maxTurnExtensionAttempt: extensionAttempts,
        attachmentCount: config.attachments?.length ?? 0,
        additionalDirectories: options.additionalDirectories ?? null,
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
            if (
              maxTurnsResult === message &&
              event.type !== 'usage_update' &&
              event.type !== 'checkpoint'
            ) {
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
        // Record resume success if this was a resumed session
        if (resumeExistingSession) {
          resumeCircuitBreaker.recordSuccess(sessionId)
        }
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

        // ── Resume Recovery ────────────────────────────────────────────
        // If this was a resume attempt and the error is a recoverable
        // resume failure (e.g., session already in use, session expired),
        // automatically fall back to a fresh session instead of failing.
        if (resumeExistingSession) {
          const classification = classifyResumeError(err)
          if (classification.isResumeError && resumeCircuitBreaker.isResumeAllowed(sessionId)) {
            const circuitOpen = resumeCircuitBreaker.recordFailure(sessionId)
            log.warn('SDK resume failed, falling back to fresh session', {
              sparkSessionId: sessionId,
              sdkSessionId,
              classification: classification.reason,
              circuitOpen,
              failureCount: resumeCircuitBreaker.getFailureCount(sessionId),
            })

            // Emit telemetry event for the resume failure and recovery
            this.emitter.emit({
              ...makeBase(),
              type: 'agent_status',
              status: 'thinking',
              message: `Session resume failed (${classification.reason}), retrying with a fresh session…`,
            })

            // Switch to fresh session mode and retry
            resumeExistingSession = false
            const freshSessionId = `${sdkSessionId}-fresh-${Date.now()}`
            // Overwrite config.sdkSessionId for the fresh attempt
            config = { ...config, sdkSessionId: freshSessionId }
            // Reset terminal status since we're retrying
            terminalStatusEmitted = false
            continue
          }

          if (classification.isResumeError && !resumeCircuitBreaker.isResumeAllowed(sessionId)) {
            log.error('SDK resume circuit breaker open, giving up', {
              sparkSessionId: sessionId,
              sdkSessionId,
              failureCount: resumeCircuitBreaker.getFailureCount(sessionId),
            })
            this.emitter.emit({
              ...makeBase(),
              type: 'agent_error',
              code: 'SDK_RESUME_CIRCUIT_OPEN',
              message: `Session resume has failed ${resumeCircuitBreaker.getFailureCount(sessionId)} consecutive times. Starting a new session is recommended.`,
              retryable: false,
              rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            })
            if (!terminalStatusEmitted) emitTerminalStatus('error')
            throw err
          }
        }

        // Record success if we got here on a non-resume error (the break
        // didn't happen because the turn simply failed for other reasons)
        if (resumeExistingSession) {
          resumeCircuitBreaker.recordSuccess(sessionId)
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

function buildPromptWithAttachments(
  userMessage: string,
  attachments: SDKExecutorConfig['attachments'],
): string {
  if (attachments == null || attachments.length === 0) return userMessage
  const lines = attachments.map((attachment, index) => {
    const size = attachment.sizeBytes != null ? `, size=${attachment.sizeBytes} bytes` : ''
    return `${index + 1}. type=${attachment.type}, name=${attachment.name}${size}, path=${attachment.path}`
  })
  return [
    userMessage,
    '',
    'User-selected attachments:',
    ...lines,
    '',
    'Use the Read tool to inspect these file paths when they are relevant to the request.',
    'For image attachments, use Read on the path so the SDK can inspect the image content.',
  ].join('\n')
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
  return (
    normalized === 'exitplanmode' ||
    normalized === 'exit_plan_mode' ||
    normalized === 'enterplanmode' ||
    normalized === 'enter_plan_mode'
  )
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
function extractQuestionsFromInput(input: Record<string, unknown>): UserQuestionPrompt[] {
  const questions = input.questions
  if (!Array.isArray(questions)) {
    const normalized = normalizeQuestionPrompt(input)
    return normalized == null ? [] : [normalized]
  }

  return questions
    .map((q: unknown) => {
      if (typeof q !== 'object' || q == null) return null
      return normalizeQuestionPrompt(q as Record<string, unknown>)
    })
    .filter((q): q is NonNullable<typeof q> => q != null)
}

function buildAskUserQuestionInputWithAnswers(
  input: Record<string, unknown>,
  questions: UserQuestionPrompt[],
  answerPayload: Record<string, unknown>,
): Record<string, unknown> {
  const answerMap = normalizeAskUserQuestionAnswers(questions, answerPayload)
  const annotations = normalizeAskUserQuestionAnnotations(questions, answerPayload)

  return {
    ...input,
    answers: answerMap,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    ...(answerPayload.cancelled === true ? { cancelled: true } : {}),
    ...(answerPayload.declined === true ? { declined: true } : {}),
    ...(typeof answerPayload.reason === 'string' ? { reason: answerPayload.reason } : {}),
  }
}

function normalizeAskUserQuestionAnswers(
  questions: UserQuestionPrompt[],
  answerPayload: Record<string, unknown>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  const rawAnswers = answerPayload.answers

  for (const [index, question] of questions.entries()) {
    const rawAnswer = findRawQuestionAnswer(rawAnswers, question, index)
    const answerText = extractQuestionAnswerText(rawAnswer)
    const fallbackText =
      answerPayload.cancelled === true || answerPayload.declined === true || isSkippedAnswer(rawAnswer)
        ? '用户拒绝回答'
        : ''
    answers[question.question] = answerText || fallbackText
  }

  return answers
}

function normalizeAskUserQuestionAnnotations(
  questions: UserQuestionPrompt[],
  answerPayload: Record<string, unknown>,
): Record<string, { preview?: string; notes?: string }> {
  const annotations: Record<string, { preview?: string; notes?: string }> = {}
  const rawAnswers = answerPayload.answers

  for (const [index, question] of questions.entries()) {
    const rawAnswer = findRawQuestionAnswer(rawAnswers, question, index)
    if (typeof rawAnswer !== 'object' || rawAnswer == null) continue
    const answer = rawAnswer as Record<string, unknown>
    const annotation: { preview?: string; notes?: string } = {}
    if (typeof answer.preview === 'string') annotation.preview = answer.preview
    if (typeof answer.otherText === 'string' && answer.otherText.trim().length > 0) {
      annotation.notes = answer.otherText
    } else if (answer.skipped === true || answer.declined === true) {
      annotation.notes = '用户跳过或拒绝回答该问题。'
    }
    if (Object.keys(annotation).length > 0) annotations[question.question] = annotation
  }

  return annotations
}

function findRawQuestionAnswer(
  rawAnswers: unknown,
  question: UserQuestionPrompt,
  index: number,
): unknown {
  if (Array.isArray(rawAnswers)) {
    return rawAnswers.find((rawAnswer, rawIndex) => {
      if (typeof rawAnswer !== 'object' || rawAnswer == null) return rawIndex === index
      const answer = rawAnswer as Record<string, unknown>
      return (
        answer.id === question.id ||
        answer.question === question.question ||
        answer.index === index ||
        rawIndex === index
      )
    })
  }

  if (typeof rawAnswers === 'object' && rawAnswers != null) {
    const answerMap = rawAnswers as Record<string, unknown>
    return (
      answerMap[question.question] ??
      (question.id != null ? answerMap[question.id] : undefined) ??
      answerMap[String(index)]
    )
  }

  return undefined
}

function extractQuestionAnswerText(rawAnswer: unknown): string {
  if (typeof rawAnswer === 'string') return rawAnswer
  if (typeof rawAnswer !== 'object' || rawAnswer == null) return ''

  const answer = rawAnswer as Record<string, unknown>
  const candidates = [answer.answer, answer.text, answer.optionLabel, answer.optionValue, answer.value]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return ''
}

function isSkippedAnswer(rawAnswer: unknown): boolean {
  if (typeof rawAnswer !== 'object' || rawAnswer == null) return false
  const answer = rawAnswer as Record<string, unknown>
  return answer.skipped === true || answer.declined === true
}

function normalizeQuestionOptions(
  options: unknown,
): UserQuestionOption[] {
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
        ...(typeof optObj.value === 'string' ? { value: optObj.value } : {}),
        ...(optObj.allowsFreeText === true ? { allowsFreeText: true } : {}),
        ...(typeof optObj.freeTextPlaceholder === 'string'
          ? { freeTextPlaceholder: optObj.freeTextPlaceholder }
          : {}),
      }
    })
    .filter((opt): opt is NonNullable<typeof opt> => opt != null)
}

function normalizeQuestionPrompt(questionInput: Record<string, unknown>): UserQuestionPrompt | null {
  const question = typeof questionInput.question === 'string' ? questionInput.question : ''
  if (!question) return null

  const rawType = questionInput.type
  const normalizedType =
    rawType === 'text' || rawType === 'single_choice'
      ? rawType
      : Array.isArray(questionInput.options)
        ? 'single_choice'
        : 'text'

  const options = normalizeQuestionOptions(questionInput.options)
  if (normalizedType === 'single_choice' && options.length === 0) return null

  return {
    ...(typeof questionInput.id === 'string' ? { id: questionInput.id } : {}),
    question,
    header: typeof questionInput.header === 'string' ? questionInput.header : '',
    type: normalizedType,
    ...(questionInput.required === false ? { required: false } : { required: true }),
    ...(typeof questionInput.placeholder === 'string' ? { placeholder: questionInput.placeholder } : {}),
    ...(questionInput.multiline === true ? { multiline: true } : {}),
    ...(questionInput.allowSkip === true ? { allowSkip: true } : {}),
    ...(questionInput.allowOther === true ? { allowOther: true } : {}),
    ...(typeof questionInput.otherOptionLabel === 'string'
      ? { otherOptionLabel: questionInput.otherOptionLabel }
      : {}),
    ...(typeof questionInput.otherPlaceholder === 'string'
      ? { otherPlaceholder: questionInput.otherPlaceholder }
      : {}),
    ...(options.length > 0 ? { options } : {}),
  }
}

function shouldUseSparkPermissionCallback(
  permissionMode: SDKExecutorConfig['permissionMode'],
): boolean {
  return (
    permissionMode !== 'claude-auto' &&
    permissionMode !== 'claude-bypass' &&
    permissionMode !== 'codex-full-access'
  )
}

function isEditTool(toolName: string): boolean {
  return (
    toolName === 'Edit' ||
    toolName === 'Write' ||
    toolName === 'MultiEdit' ||
    toolName === 'NotebookEdit' ||
    toolName === 'edit_file' ||
    toolName === 'write_file' ||
    toolName === 'multi_edit' ||
    toolName === 'apply_patch'
  )
}

function estimateSDKPromptTokens(userMessage: string, config: SDKExecutorConfig): number {
  const chars = [userMessage, config.systemPrompt ?? '', config.skillSystemPrompt ?? ''].join(
    '\n',
  ).length
  return Math.ceil(chars / 3)
}

function contextWindow(model: string, configuredContextWindow?: number): number {
  return configuredContextWindow !== undefined
    ? configuredContextWindow
    : resolveModelContextWindow(model)
}

function softContextLimit(model: string, configuredContextWindow?: number): number {
  return configuredContextWindow !== undefined
    ? resolveSoftContextLimitForWindow(configuredContextWindow)
    : resolveSoftContextLimit(model)
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
  const report = (
    typeof process.report?.getReport === 'function' ? process.report.getReport() : null
  ) as { header?: { glibcVersionRuntime?: string } } | null
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
      'Claude Agent SDK (@anthropic-ai/claude-agent-sdk) is not installed or failed to load. ' +
        'Install it with: pnpm add @anthropic-ai/claude-agent-sdk.',
    )
    this.name = 'SDKNotAvailableError'
  }
}
