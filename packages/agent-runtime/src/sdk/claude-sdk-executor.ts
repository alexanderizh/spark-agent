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
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
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
import { StreamTerminalizer } from './stream-terminalizer.js'
import type {
  SDKApprovalResult,
  SDKExecutorConfig,
  SDKMcpServerConfig,
  SDKMessage,
  SDKPermissionRequestContext,
  SDKPermissionResult,
  SDKPermissionUpdate,
  SDKQuery,
  SDKQueryFunction,
  SDKQueryOptions,
  SDKQuestionRequestContext,
  SDKResultMessage,
  SDKSettings,
  SDKUserMessage,
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
  '- ExitPlanMode plans are rendered as Markdown for the user. Follow the plan-mode system message for where to write the plan (the CLI-designated plan file under `.claude/plans/`); you may also pass the plan text in the `plan` field and the host will use it as a fallback.',
  '- When you generate output artifacts (documents, exports, generated media such as .docx/.pdf/.xlsx/.pptx/images, etc.), write them inside the current workspace directory (the cwd) — e.g. the workspace root or a sensible output subfolder — using a relative or workspace-rooted path. Do NOT default to the user home directory or any location outside the workspace, unless the user explicitly asks for a specific path elsewhere. Files outside the workspace cannot be previewed/opened from the app and are not tracked as turn changes.',
].join('\n')

/**
 * 计划模式（claude-plan / SDK permissionMode:'plan'）专属告知提示词。
 *
 * 必须让 agent 清楚：当前是只读计划模式，唯一目标是产出一份可执行计划并停下等待
 * 审批。反复尝试 Edit/Bash/Write（非计划文件）只会被拦截，既浪费 turn 又让用户
 * 误以为卡死。审批通过后宿主会另起一个 auto-edits turn 执行，不需要本 turn 动手。
 */
const SDK_PLAN_MODE_INSTRUCTIONS = [
  '## PLAN MODE (read-only) — 你当前处于计划模式',
  '',
  '你的唯一目标：**调研 → 产出一份清晰的实施计划 → 调用 ExitPlanMode 提交 → 停下等待用户审批**。',
  '',
  '必须遵守：',
  '- 这是只读模式。**禁止**调用 Edit / Write（计划文件除外）/ MultiEdit / NotebookEdit / Bash / Task 去修改任何代码或配置——它们会被权限层拒绝。',
  '- 可以自由使用 Read / Glob / Grep / WebFetch / WebSearch / TodoRead 等只读工具充分调研。',
  '- 计划写进系统指定的计划文件（`.claude/plans/` 下的 markdown），不要写到业务代码里。CLI 会在系统消息里给出具体路径。',
  '- 计划内容用 markdown，包含：目标、分步实施步骤、涉及文件、风险/回滚要点。',
  '- 写完计划文件后调用 `ExitPlanMode` 提交。提交后 **立即停止**，不要再做任何工具调用——用户需要先看到计划并决定是否批准。',
  '',
  '审批流程：用户批准后，系统会自动切换到「自动编辑」模式并新起一个 turn 执行计划，你不需要、也不应该在本 turn 里动手实现。',
].join('\n')

const ENV_BLOCKLIST_PREFIXES = ['ANTHROPIC_', 'CLAUDE_'] as const
const DEFAULT_SDK_MAX_TURNS = 200
const DEFAULT_MAX_TURN_EXTENSION_RETRIES = 6
const DEFAULT_MAX_TURN_EXTENSION_CAP = 2000
const MAX_TURNS_ERROR_PATTERN = /reached\s+maximum\s+number\s+of\s+turns/i

type InteractivePrompt = {
  stream: AsyncIterable<SDKUserMessage>
  close: () => void
}

/**
 * The Agent SDK only supports host control requests (canUseTool, hooks,
 * setPermissionMode) while its input is in streaming mode. Keep the input
 * iterator open for the lifetime of the turn, then close it as soon as the
 * terminal result arrives.
 */
export function createInteractivePromptStream(
  prompt: string,
  signal?: AbortSignal,
): InteractivePrompt {
  let closed = false
  let resolveClosed: (() => void) | undefined
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const close = () => {
    if (closed) return
    closed = true
    resolveClosed?.()
  }
  if (signal?.aborted === true) close()
  else signal?.addEventListener('abort', close, { once: true })

  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        try {
          yield {
            type: 'user',
            session_id: '',
            parent_tool_use_id: null,
            message: { role: 'user', content: prompt },
          }
          await closedPromise
        } finally {
          signal?.removeEventListener('abort', close)
        }
      },
    },
    close,
  }
}

let sdkModule: SDKModule | null = null
let sdkLoadAttempted = false

/** Shared circuit breaker for SDK resume attempts across all sessions. */
const resumeCircuitBreaker = new ResumeCircuitBreaker()

/** Access the shared circuit breaker (for testing / session service integration). */
export function getResumeCircuitBreaker(): ResumeCircuitBreaker {
  return resumeCircuitBreaker
}

/**
 * 读取宿主 `claude` CLI 的 `~/.claude/settings.json` 中的 `env` 块。
 *
 * `claude` CLI 启动子进程前会把 settings.json 里的 env 注入进自己的进程；很多用户
 * （尤其用第三方中转的）把 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 写在这里
 * 而非 shell rc 文件，所以 `process.env` 里看不到这些值。"本地 CLI" provider 要复用
 * 宿主认证，就必须显式合并这块 env，否则 SDK 默认走 api.anthropic.com 拿不到 key → 401。
 */
function loadClaudeSettingsEnv(): Record<string, string> {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    if (!existsSync(settingsPath)) return {}
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { env?: Record<string, unknown> }
    if (raw.env == null || typeof raw.env !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.env)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch (err) {
    log.warn(`Failed to read ~/.claude/settings.json env block: ${(err as Error).message}`)
    return {}
  }
}

function buildIsolatedRuntimeEnv(
  apiKey: string,
  model: string,
  apiEndpoint?: string,
  tierModels?: { haiku?: string | undefined; sonnet?: string | undefined; opus?: string | undefined },
  useLocalConfig?: boolean,
  customEnv?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue
    // Local CLI 模式下保留宿主机的 ANTHROPIC_*/CLAUDE_* 环境，让 SDK 透明继承
    // OAuth 凭证、自定义 base url、模型偏好等本地 claude CLI 配置。
    if (!useLocalConfig && ENV_BLOCKLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  // 用户在会话/项目级配置的自定义环境变量：覆盖继承自宿主进程的同名值。
  // 注入在 ANTHROPIC_* 认证键之前，确保下方设置的认证/模型键始终权威，不被误覆盖。
  if (customEnv != null) {
    for (const [k, v] of Object.entries(customEnv)) {
      if (k.length > 0) env[k] = v
    }
  }
  if (useLocalConfig === true) {
    // 合并 ~/.claude/settings.json 里的 env 块（宿主 CLI 的中转 token / base url 通常写在这里）。
    // 进程环境优先级更高 —— 如果用户在 shell 里显式 export 过同名变量，不覆盖。
    const settingsEnv = loadClaudeSettingsEnv()
    for (const [k, v] of Object.entries(settingsEnv)) {
      if (env[k] == null) env[k] = v
    }
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
  private cancelRequested = false

  /**
   * Live permission mode — can be updated mid-turn via `setPermissionMode()`.
   * The `canUseTool` callback reads this on every invocation so that a
   * permission-mode switch in the UI takes effect immediately.
   */
  private livePermissionMode: SDKExecutorConfig['permissionMode'] | null = null
  private activeQuery: SDKQuery | null = null

  onEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.on(listener)
  }

  offEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.off(listener)
  }

  cancel(): void {
    this.cancelRequested = true
    this.abortController?.abort()
    try {
      if (typeof this.activeQuery?.close === 'function') this.activeQuery.close()
    } catch (error) {
      log.warn('Failed to force-close Claude SDK query during cancellation', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Hot-swap the permission mode for the **currently executing** turn.
   * Takes effect on the next `canUseTool` callback — i.e. the very next
   * tool invocation the SDK agent performs.
   */
  async setPermissionMode(mode: SDKExecutorConfig['permissionMode']): Promise<void> {
    this.livePermissionMode = mode
    const sdkMode = mapPermissionMode(mode).permissionMode
    const activeQuery = this.activeQuery
    let nativeUpdated = false
    if (typeof activeQuery?.setPermissionMode === 'function') {
      try {
        await activeQuery.setPermissionMode(sdkMode)
        nativeUpdated = true
      } catch (error) {
        log.warn('SDK permission mode update failed; local policy fallback remains active', {
          mode,
          sdkMode,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    log.info('Live permission mode updated', { mode, sdkMode, nativeUpdated })
  }

  /**
   * Rewind tracked files to their state at a specific SDK user-message (a
   * checkpoint anchor captured during a host turn with file checkpointing on).
   *
   * Resumes the recorded SDK session and invokes the SDK's control method
   * `Query.rewindFiles(userMessageId)`. We do NOT iterate the async generator —
   * iterating would run a fresh agent turn; we only want the control request.
   *
   * Fully degraded: any thrown error (SDK unavailable, resume failure, control
   * request rejection) is caught and surfaced as `{ canRewind: false, error }`
   * so callers can render a clear "cannot restore" message instead of crashing.
   *
   * NOTE: rewindFiles-on-resumed-query lifecycle needs runtime verification
   * against a live SDK session (no API key locally). The happy path (resume →
   * rewindFiles → dispose) cannot be exercised in CI / this environment.
   */
  async rewindFiles(params: {
    apiKey: string
    model: string
    workspaceRootPath: string
    sdkSessionId: string
    apiEndpoint?: string
    userMessageId: string
    dryRun?: boolean
  }): Promise<{
    canRewind: boolean
    error?: string
    filesChanged?: string[]
    insertions?: number
    deletions?: number
  }> {
    log.info('rewindFiles: attempt', {
      sdkSessionId: params.sdkSessionId,
      userMessageId: params.userMessageId,
      dryRun: params.dryRun ?? false,
    })
    try {
      const sdk = await loadSDK()
      if (sdk == null) {
        return { canRewind: false, error: new SDKNotAvailableError().message }
      }

      // Minimal runtime env mirroring run(): just authentication + model, no
      // tier-model fan-out, MCP servers, system prompt or tools — we are not
      // running a turn, only resuming to issue the rewind control request.
      const runtimeEnv = buildIsolatedRuntimeEnv(
        params.apiKey,
        params.model,
        params.apiEndpoint,
      )
      const claudeCodeExecutable = resolveClaudeCodeExecutable()
      const options: SDKQueryOptions = {
        model: params.model,
        cwd: params.workspaceRootPath,
        env: runtimeEnv,
        ...(claudeCodeExecutable != null
          ? { pathToClaudeCodeExecutable: claudeCodeExecutable }
          : {}),
        resume: params.sdkSessionId,
        enableFileCheckpointing: true,
      }

      // Do NOT iterate the generator — that would execute a turn. We only issue
      // the rewindFiles control request against the resumed session.
      const query = sdk.query({ prompt: ' ', options }) as SDKQuery & {
        rewindFiles?: (
          userMessageId: string,
          options?: { dryRun?: boolean },
        ) => Promise<{
          canRewind: boolean
          error?: string
          filesChanged?: string[]
          insertions?: number
          deletions?: number
        }>
      }

      try {
        if (typeof query.rewindFiles !== 'function') {
          return {
            canRewind: false,
            error: 'SDK query does not support rewindFiles (CLI too old).',
          }
        }
        const result = await query.rewindFiles(params.userMessageId, {
          dryRun: params.dryRun ?? false,
        })
        log.info('rewindFiles: result', {
          canRewind: result.canRewind,
          filesChanged: result.filesChanged?.length ?? 0,
        })
        return result
      } finally {
        // Dispose the query so the underlying Claude Code CLI subprocess
        // terminates. Prefer interrupt() (a declared Query control method) to
        // signal the streaming session to stop; fall back to the AsyncGenerator
        // return(). Both are best-effort — ignore dispose errors.
        try {
          await query.interrupt()
        } catch {
          // ignore
        }
        try {
          await query.return?.(undefined)
        } catch {
          // ignore
        }
      }
    } catch (err) {
      log.warn('rewindFiles: error', {
        error: err instanceof Error ? err.message : String(err),
      })
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    this.cancelRequested = false
    const abortController = new AbortController()
    this.abortController = abortController
    const sdk = await loadSDK()
    if (this.cancelRequested || abortController.signal.aborted) return
    if (sdk == null) {
      throw new SDKNotAvailableError()
    }

    this.livePermissionMode = config.permissionMode
    const ctx = { sessionId, turnId, toolNamesById: new Map<string, string>() }
    const streamTerminalizer = new StreamTerminalizer()
    const promptWithAttachments = buildPromptWithAttachments(buildSparkGoalPrompt(userMessage, config), config.attachments)
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
    const useSparkCanUseTool = shouldInstallSparkCanUseTool(config)
    // Bare allowedTools bypass the SDK canUseTool callback. When Spark owns
    // permissions, keep those auto-allow decisions inside our callback instead.
    const { sdkAllowedTools, callbackAllowedTools } = splitAllowedToolsForCanUseTool(
      mergedPerms.allowedTools,
      useSparkCanUseTool,
    )

    // Build composite system prompt
    const systemPrompt = buildCompositeSystemPrompt(config)
    const claudeCodeExecutable = resolveClaudeCodeExecutable()

    let terminalStatusEmitted = false
    const emitTerminalStatus = (status: AgentStatusValue): void => {
      if (terminalStatusEmitted) return
      terminalStatusEmitted = true
      this.emitter.emit({
        ...makeBase(),
        type: 'agent_status',
        status,
      })
    }
    const emitStreamCompletions = (): void => {
      for (const event of streamTerminalizer.finalize(makeBase)) this.emitter.emit(event)
    }

    // Immediately emit cancellation events when abort fires,
    // so the UI updates instantly instead of waiting for the
    // async generator to yield its next message.
    const onAbort = (): void => {
      emitStreamCompletions()
      this.emitter.emit({
        ...makeBase(),
        type: 'agent_error',
        code: 'ABORTED',
        message: 'Turn cancelled by user',
        retryable: false,
      })
      emitTerminalStatus('cancelled')
    }
    abortController.signal.addEventListener('abort', onAbort, { once: true })

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
      config.customEnv,
    )
    // 本地 CLI 模式下 config.model 是占位符 "claude cli"（仅 UI 显示用），不能透传给 SDK
    // —— 真正的模型由宿主 ~/.claude/settings.json 里的 ANTHROPIC_MODEL 决定，
    // 已在 runtimeEnv 里合并好。优先读 env，回落到 config.model。
    const effectiveModel =
      config.useLocalConfig === true
        ? runtimeEnv.ANTHROPIC_MODEL ?? runtimeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ?? config.model
        : config.model
    const settings: SDKSettings = {
      model: effectiveModel,
      env: runtimeEnv,
      permissions: {
        defaultMode: mergedPerms.permissionMode,
        ...(sdkAllowedTools.length > 0 ? { allow: sdkAllowedTools } : {}),
        ...(mergedPerms.disallowedTools.length > 0 ? { deny: mergedPerms.disallowedTools } : {}),
      },
    }

    let maxTurns = normalizePositiveInt(config.maxTurnCount, DEFAULT_SDK_MAX_TURNS, 5000)
    const maxTurnExtensionRetries = normalizeNonNegativeInt(
      config.maxTurnExtensionRetries,
      DEFAULT_MAX_TURN_EXTENSION_RETRIES,
      20,
    )
    const maxTurnExtensionCap = normalizePositiveInt(
      config.maxTurnExtensionCap,
      DEFAULT_MAX_TURN_EXTENSION_CAP,
      5000,
    )
    let extensionAttempts = 0
    let prompt = promptWithAttachments
    let resumeExistingSession = config.continueSession === true

    while (true) {
      // Resolve sdkSessionId from config each iteration (resume recovery may update it)
      const sdkSessionId = config.sdkSessionId ?? sessionId
      const options: SDKQueryOptions = {
        abortController,
        model: effectiveModel,
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
        ...(mergedPerms.permissionMode === 'bypassPermissions'
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(sdkAllowedTools.length > 0 ? { allowedTools: sdkAllowedTools } : {}),
        ...(mergedPerms.disallowedTools.length > 0
          ? { disallowedTools: mergedPerms.disallowedTools }
          : {}),
        ...(config.mcpServers != null ? { mcpServers: config.mcpServers } : {}),
        strictMcpConfig: true,
        forwardSubagentText: true,
        agentProgressSummaries: true,
        // Spark owns workflow/team orchestration. Keep the SDK's ultracode keyword
        // trigger from starting a second, invisible orchestration layer.
        disableWorkflows: true,
        workflowKeywordTriggerEnabled: false,
        ...buildApplicationHooks(config, sessionId),
        ...buildElicitationHandler(config, sessionId),
        // 本地技能插件（托管技能目录）→ 启用 SDK 原生技能发现 + 渐进式披露。
        ...(config.skillPlugins != null && config.skillPlugins.length > 0
          ? { plugins: config.skillPlugins.map((p) => ({ type: 'local' as const, path: p })) }
          : {}),
        // 技能上下文过滤：有托管插件时放行全部（已在插件目录内按"启用"过滤）；
        // 否则省略该选项（走 skills_load 工具路径），不要传 [] —— 空数组会关闭全部技能。
        ...(config.nativeSkills != null ? { skills: config.nativeSkills } : {}),
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
        // The callback reads `this.livePermissionMode` on every invocation so
        // that a mid-turn permission-mode switch takes effect immediately.
        ...(useSparkCanUseTool
          ? {
              canUseTool: async (
                toolName: string,
                input: Record<string, unknown>,
                callbackOptions,
              ): Promise<SDKPermissionResult> => {
                // Snapshot the live permission mode for this invocation
                const currentMode = this.livePermissionMode ?? config.permissionMode
                try {
                  // Handle AskUserQuestion specially - it needs user interaction
                  if (isAskUserQuestionTool(toolName)) {
                    if (config.unattended === true) {
                      return denyTool(
                        'AskUserQuestion is disabled during unattended automation runs',
                        callbackOptions.toolUseID,
                      )
                    }
                    const questionCallback = config.questionCallback
                    if (questionCallback != null) {
                      // Extract questions from input
                      const questions = extractQuestionsFromInput(input)
                      // Wait for user to answer questions
                      const questionContext: SDKQuestionRequestContext = {
                        questionId: callbackOptions.toolUseID,
                        requestId: callbackOptions.requestId,
                        signal: callbackOptions.signal,
                      }
                      const answers = await questionCallback(sessionId, questions, questionContext)
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

                  // EnterPlanMode / ExitPlanMode 等控制工具的处理。
                  // 关键：plan 模式下 ExitPlanMode 代表「计划已写好，请审批」。这里不能
                  // 直接 allow——allow 会被 CLI 解释为「用户已批准退出计划模式」，agent
                  // 会立刻在同一个 turn 里开始改代码。deny 则让 agent 停下来等待真正的
                  // 用户审批（plan_proposed 事件已由 event-mapper 从 tool_use 块发出）。
                  if (isExitPlanModeTool(toolName)) {
                    if (currentMode === 'claude-plan') {
                      return denyTool(
                        'Plan submitted and presented to the user for approval. ' +
                          'Stop here — do NOT attempt any edits, Bash, or further tool calls. ' +
                          'Wait for the user to approve or reject the plan before proceeding.',
                        callbackOptions.toolUseID,
                      )
                    }
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  if (isAlwaysAllowedControlTool(toolName)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  if (callbackAllowedTools.has(toolName)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  if (!shouldUseSparkPermissionCallback(currentMode)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  // Plan mode is read-only: file edits MUST NOT execute until the user
                  // approves the plan (which switches the mode to claude-auto-edits and
                  // starts a fresh turn). Deny outright instead of routing to the inline
                  // approval callback, otherwise a single inline "allow" would let the
                  // agent mutate code while the plan is still pending approval.
                  // 例外：写到计划文件（~/.claude/plans/ 或 <cwd>/.claude/plans/）的
                  // Write/Edit 必须放行——新版 CLI 计划协议要求 agent 先落盘计划再
                  // ExitPlanMode，否则计划永远产不出来。
                  if (currentMode === 'claude-plan' && isEditTool(toolName)) {
                    if (isPlanFileInput(input)) {
                      return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                    }
                    return denyTool(
                      'Plan mode is read-only — file edits are blocked until you approve the plan. ' +
                        'Write your plan to the plan file, then call ExitPlanMode and wait for approval.',
                      callbackOptions.toolUseID,
                    )
                  }
                  if (currentMode === 'claude-auto-edits' && isEditTool(toolName)) {
                    return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
                  }
                  const approvalCallback = config.approvalCallback
                  if (approvalCallback == null)
                    return denyTool('Permission check failed', callbackOptions.toolUseID)
                  const approval = normalizeApprovalResult(
                    await approvalCallback(sessionId, toolName, input, callbackOptions),
                  )
                  return approval.allowed
                    ? allowTool(
                        input,
                        callbackOptions.toolUseID,
                        approval.scope != null && approval.scope !== 'once'
                          ? 'user_permanent'
                          : 'user_temporary',
                        scopePermissionUpdates(callbackOptions.suggestions, approval.scope),
                      )
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

      const interactivePrompt = createInteractivePromptStream(prompt, abortController.signal)
      try {
        const queryResult = sdk.query({ prompt: interactivePrompt.stream, options })
        let maxTurnsResult: SDKResultMessage | null = null

        this.activeQuery = queryResult
        try {
          for await (const message of queryResult) {
            if (abortController.signal.aborted) break
            if (message.type === 'result') interactivePrompt.close()
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

            // 注：checkpoint 还原点由 SessionService 的内容快照方案产出（见 checkpoint-content.service），
            // 不再从 SDK user-message uuid 发锚点——SDK 文件 checkpoint 跨会话 resume 取不到（已证伪）。

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
              if (
                event.type === 'agent_error' ||
                (event.type === 'agent_status' && isTerminalAgentStatus(event.status))
              ) {
                emitStreamCompletions()
              }
              if (event.type === 'agent_status' && isTerminalAgentStatus(event.status)) {
                terminalStatusEmitted = true
              }
              streamTerminalizer.observe(event)
              this.emitter.emit(event)
            }
          }
        } finally {
          interactivePrompt.close()
          if (this.activeQuery === queryResult) this.activeQuery = null
        }

        if (abortController.signal.aborted) {
          // Cancellation events already emitted by the abort signal listener.
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

          emitStreamCompletions()
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
        interactivePrompt.close()
        if (abortController.signal.aborted) {
          // Cancellation events already emitted by the abort signal listener.
          return
        }

        // ── Max-Turns Exception Recovery ───────────────────────────────
        // Some SDK paths surface `error_max_turns` as a thrown exception
        // instead of an `error_max_turns` result message. Detect that here
        // and run the same auto-extension logic so the user does not have
        // to manually re-send the message.
        const errMessage = err instanceof Error ? err.message : String(err)
        if (MAX_TURNS_ERROR_PATTERN.test(errMessage)) {
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
            terminalStatusEmitted = false
            continue
          }

          emitStreamCompletions()
          this.emitter.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'MAX_ITERATIONS',
            message: buildMaxTurnLimitMessage(maxTurns, extensionAttempts),
            retryable: false,
            rawError: errMessage,
          })
          if (!terminalStatusEmitted) emitTerminalStatus('error')
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
            emitStreamCompletions()
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

        emitStreamCompletions()
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

  // 计划模式告知提示词：让 agent 明确知道自己处于只读计划模式，应该先做什么、
  // 不能做什么、什么时候该停。没有这段提示时 agent 会反复尝试 Edit/Bash（全部
  // 被 plan 模式拦截），既浪费 turn 又让用户以为卡住了。
  if (config.permissionMode === 'claude-plan') {
    sections.push(SDK_PLAN_MODE_INSTRUCTIONS)
  }

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
  const hasDirectory = attachments.some((attachment) => attachment.type === 'directory')
  return [
    userMessage,
    '',
    'User-selected attachments:',
    ...lines,
    '',
    'Use the Read tool to inspect these file paths when they are relevant to the request.',
    'For image attachments, use Read on the path so the SDK can inspect the image content.',
    ...(hasDirectory
      ? [
          'Directory attachments are context references: explore them with file tools only when relevant, do not auto-read every file.',
        ]
      : []),
  ].join('\n')
}

function allowTool(
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  decisionClassification: SDKPermissionResult['decisionClassification'],
  updatedPermissions?: SDKPermissionUpdate[],
): SDKPermissionResult {
  return {
    behavior: 'allow',
    updatedInput: input,
    ...(updatedPermissions != null && updatedPermissions.length > 0
      ? { updatedPermissions }
      : {}),
    ...(toolUseID != null ? { toolUseID } : {}),
    ...(decisionClassification != null ? { decisionClassification } : {}),
  }
}

function normalizeApprovalResult(result: boolean | SDKApprovalResult): SDKApprovalResult {
  return typeof result === 'boolean' ? { allowed: result } : result
}

function buildApplicationHooks(
  config: SDKExecutorConfig,
  sessionId: string,
): Pick<SDKQueryOptions, 'hooks'> | Record<string, never> {
  const callback = config.applicationHookCallback
  if (callback == null) return {}
  return {
    hooks: {
      PermissionRequest: [
        {
          hooks: [
            async (input) => {
              try {
                await callback(sessionId, 'permission_request', {
                  title: 'Spark Agent - 权限请求',
                  body: `Claude 请求使用 ${input.tool_name}`,
                })
              } catch (error) {
                log.warn('Application permission hook failed', {
                  sessionId,
                  toolName: input.tool_name,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
              return { continue: true }
            },
          ],
        },
      ],
    },
  }
}

interface ElicitationField {
  key: string
  schema: Record<string, unknown>
  prompt: UserQuestionPrompt
}

function buildElicitationHandler(
  config: SDKExecutorConfig,
  sessionId: string,
): Pick<SDKQueryOptions, 'onElicitation'> | Record<string, never> {
  const questionCallback = config.questionCallback
  if (questionCallback == null || config.unattended === true) return {}
  return {
    onElicitation: async (request, options) => {
      if (options.signal.aborted) return { action: 'cancel' }
      if (request.mode !== 'form') return { action: 'decline' }
      const fields = elicitationFields(request.requestedSchema, request.serverName)
      if (fields.length === 0) return { action: 'decline' }
      const answerPayload = await questionCallback(
        sessionId,
        fields.map((field) => field.prompt),
        {
          ...(request.elicitationId != null ? { questionId: request.elicitationId } : {}),
          signal: options.signal,
        },
      )
      if (answerPayload.cancelled === true || answerPayload.declined === true) {
        return { action: 'decline' }
      }
      const content: Record<string, unknown> = {}
      for (const [index, field] of fields.entries()) {
        const rawAnswer = findRawQuestionAnswer(answerPayload.answers, field.prompt, index)
        const value = elicitationAnswerValue(rawAnswer, field.schema)
        if (value === undefined && field.prompt.required === true) {
          return { action: 'decline' }
        }
        if (value !== undefined) content[field.key] = value
      }
      return { action: 'accept', content }
    },
  }
}

function elicitationFields(
  requestedSchema: Record<string, unknown> | undefined,
  serverName: string,
): ElicitationField[] {
  const properties = requestedSchema?.properties
  if (typeof properties !== 'object' || properties == null || Array.isArray(properties)) return []
  const required = new Set(
    Array.isArray(requestedSchema?.required)
      ? requestedSchema.required.filter((key): key is string => typeof key === 'string')
      : [],
  )
  const fields: ElicitationField[] = []
  for (const [key, rawSchema] of Object.entries(properties)) {
    if (typeof rawSchema !== 'object' || rawSchema == null || Array.isArray(rawSchema)) continue
    const schema = rawSchema as Record<string, unknown>
    const title = typeof schema.title === 'string' && schema.title.trim().length > 0
      ? schema.title
      : key
    const description = typeof schema.description === 'string' ? schema.description : ''
    const enumValues = Array.isArray(schema.enum) ? schema.enum : []
    const isArrayEnum =
      schema.type === 'array' &&
      typeof schema.items === 'object' &&
      schema.items != null &&
      !Array.isArray(schema.items) &&
      Array.isArray((schema.items as Record<string, unknown>).enum)
    const choices = isArrayEnum
      ? ((schema.items as Record<string, unknown>).enum as unknown[])
      : enumValues
    const options: UserQuestionOption[] = choices.map((value) => ({
      label: String(value),
      ...(description.length > 0 ? { description } : {}),
    }))
    fields.push({
      key,
      schema,
      prompt: {
        id: key,
        question: title,
        header: serverName.slice(0, 24),
        type: options.length > 0 ? (isArrayEnum ? 'multi_choice' : 'single_choice') : 'text',
        required: required.has(key),
        ...(description.length > 0 && options.length === 0 ? { placeholder: description } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(isArrayEnum ? { multiSelect: true } : {}),
        ...(!required.has(key) ? { allowSkip: true } : {}),
      },
    })
  }
  return fields
}

function elicitationAnswerValue(
  rawAnswer: unknown,
  schema: Record<string, unknown>,
): unknown {
  const answerRecord =
    typeof rawAnswer === 'object' && rawAnswer != null && !Array.isArray(rawAnswer)
      ? (rawAnswer as Record<string, unknown>)
      : null
  const rawValue =
    answerRecord?.value ?? answerRecord?.answer ?? answerRecord?.text ?? rawAnswer
  if (rawValue == null || rawValue === '') return undefined
  if (schema.type === 'array') {
    if (Array.isArray(rawValue)) return rawValue
    return String(rawValue)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  const text = typeof rawValue === 'string' ? rawValue : String(rawValue)
  if (schema.type === 'boolean') return text.toLowerCase() === 'true'
  if (schema.type === 'number' || schema.type === 'integer') {
    const numeric = Number(text)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.find((value) => String(value) === text) ?? text
  }
  return text
}

function scopePermissionUpdates(
  suggestions: SDKPermissionRequestContext['suggestions'],
  scope: SDKApprovalResult['scope'],
): SDKPermissionUpdate[] | undefined {
  if (suggestions == null || suggestions.length === 0 || scope == null || scope === 'once') {
    return undefined
  }
  const destination = {
    session: 'session',
    project: 'projectSettings',
    global: 'userSettings',
  }[scope] as SDKPermissionUpdate['destination']
  return suggestions.map((suggestion) => ({ ...suggestion, destination }))
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
    normalized === 'enterplanmode' ||
    normalized === 'enter_plan_mode'
  )
  // Note: ExitPlanMode is NOT here — it has plan-mode-specific handling
  // (deny in plan mode to wait for real user approval). See isExitPlanModeTool.
  // Note: AskUserQuestion is NOT always allowed - it needs user interaction
  // to provide answers. It's handled separately in canUseTool callback.
}

function isExitPlanModeTool(toolName: string): boolean {
  const normalized = toolName.replace(/-/g, '_').toLowerCase()
  return normalized === 'exitplanmode' || normalized === 'exit_plan_mode'
}

/**
 * 判断一次 Write/Edit 调用是否指向计划文件。
 *
 * 新版 Claude Code CLI 的计划模式要求 agent 把计划写到 plan 文件，默认目录是
 * ~/.claude/plans/（可被 plansDirectory 改成项目相对路径 <cwd>/.claude/plans/）。
 * canUseTool 在 plan 模式下默认拦截所有编辑工具，必须把计划文件写入放行，
 * 否则 agent 无法落盘计划 → ExitPlanMode 取不到计划 → 计划弹不出来。
 */
function isPlanFileInput(input: Record<string, unknown>): boolean {
  const raw = input?.file_path ?? input?.filePath ?? input?.path
  if (typeof raw !== 'string') return false
  return raw.includes('.claude/plans/') || raw.endsWith('-plan.md') || raw.endsWith('/plan.md')
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
  const isMultiSelect =
    questionInput.multiSelect === true ||
    rawType === 'multi_choice'
  const normalizedType =
    rawType === 'text' || rawType === 'single_choice' || rawType === 'multi_choice'
      ? rawType
      : Array.isArray(questionInput.options)
        ? 'single_choice'
        : 'text'
  const finalType: 'single_choice' | 'multi_choice' | 'text' =
    isMultiSelect && Array.isArray(questionInput.options) && normalizedType !== 'text'
      ? 'multi_choice'
      : normalizedType === 'multi_choice' && !Array.isArray(questionInput.options)
        ? 'text'
        : normalizedType

  const options = normalizeQuestionOptions(questionInput.options)
  if ((finalType === 'single_choice' || finalType === 'multi_choice') && options.length === 0) {
    return null
  }

  return {
    ...(typeof questionInput.id === 'string' ? { id: questionInput.id } : {}),
    question,
    header: typeof questionInput.header === 'string' ? questionInput.header : '',
    type: finalType,
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
    ...(isMultiSelect ? { multiSelect: true } : {}),
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

function shouldInstallSparkCanUseTool(config: SDKExecutorConfig): boolean {
  return (
    config.unattended === true ||
    config.questionCallback != null ||
    (config.approvalCallback != null && shouldUseSparkPermissionCallback(config.permissionMode))
  )
}

function splitAllowedToolsForCanUseTool(
  allowedTools: string[],
  useSparkCanUseTool: boolean,
): { sdkAllowedTools: string[]; callbackAllowedTools: Set<string> } {
  if (!useSparkCanUseTool) {
    return { sdkAllowedTools: allowedTools, callbackAllowedTools: new Set() }
  }
  const sdkAllowedTools: string[] = []
  const callbackAllowedTools = new Set<string>()
  for (const tool of allowedTools) {
    if (tool.length === 0) continue
    if (tool.includes('(')) {
      sdkAllowedTools.push(tool)
    } else {
      callbackAllowedTools.add(tool)
    }
  }
  return { sdkAllowedTools, callbackAllowedTools }
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


function buildSparkGoalPrompt(userMessage: string, config: SDKExecutorConfig): string {
  if (config.goal == null || config.goal.mode !== 'spark-loop') return userMessage
  const criteria = config.goal.successCriteria?.length ? config.goal.successCriteria.map((item) => `- ${item}`).join('\n') : '- Infer verifiable success criteria from the objective.'
  const progress = config.goal.progressLog?.slice(-8).map((entry) => `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`).join('\n') || '- No prior progress.'
  return [
    'Spark Goal Loop Contract:',
    `Goal ID: ${config.goal.id}`,
    `Objective: ${config.goal.objective}`,
    'Success criteria:',
    criteria,
    'Recent progress:',
    progress,
    '',
    userMessage,
    '',
    'End with a fenced spark-goal-status block containing status, phase, summary, evidence, and next_step.',
  ].join('\n')
}
