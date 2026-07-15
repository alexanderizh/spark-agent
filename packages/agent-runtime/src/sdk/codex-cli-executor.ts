import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import { extractCodexCompactionEvent } from './codex-compaction-event.js'
import { toCodexReasoningEffort, type CodexReasoningEffort } from './reasoning-effort.js'
import { StreamTerminalizer } from './stream-terminalizer.js'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from './types.js'

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }
type CodexRunResult = {
  exitCode: number
  stdout: string
  stderr: string
  assistantText: string
  assistantCompleteEmitted: boolean
  failureMessage: string
}
type CodexProgressState = {
  lastProgressText: string
}
type CodexTempProfile = {
  name: string
  filePath: string
}

// 流式解析的累积状态：Codex CLI 的 `exec --json` 在 item.started/updated/completed
// 事件里携带的是「累积全文」（item.text），而不是 delta。需要自己用前缀切片算出
// 每一帧的新增后缀，才能像 SDK 那样逐段流式。参考 teamagentx 的 appendContent/appendThinking。
type CodexStreamState = {
  content: string
  thinking: string
  currentTextSegmentId: string | null
  textSegmentCounter: number
  completedTextBySegmentId: Map<string, string>
  completedTextOrder: string[]
  // 一旦本次 turn 中发生过工具调用，agent_message 累积的中间过程文本就应清空，
  // 下一帧 agent_message 被视作新的最终回答段落（与参考实现一致）。
  toolCalledSinceContent: boolean
  emittedToolCallIds: Set<string>
  activeCommandOutputById: Map<string, string>
}

export class CodexCliExecutor {
  private listeners = new Set<Listener>()
  private child: ChildProcessWithoutNullStreams | null = null
  private streamTerminalizer: StreamTerminalizer | null = null
  private cancelled = false

  onEvent(listener: Listener): void {
    this.listeners.add(listener)
  }

  offEvent(listener: Listener): void {
    this.listeners.delete(listener)
  }

  cancel(): void {
    this.cancelled = true
    this.child?.kill('SIGTERM')
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    this.cancelled = false
    const tempDir = await mkdtemp(path.join(tmpdir(), 'spark-codex-'))
    if (this.cancelled) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      return
    }
    const outputFile = path.join(tempDir, 'last-message.txt')
    const prompt = buildCodexPrompt(buildCodexGoalPrompt(userMessage, config), config)
    let tempProfile: CodexTempProfile | null = null
    const streamTerminalizer = new StreamTerminalizer()
    this.streamTerminalizer = streamTerminalizer
    const makeBase = (): EventBase => ({
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    this.emit({
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
    this.emit({
      ...makeBase(),
      type: 'agent_status',
      status: 'thinking',
      message: 'Codex CLI is running',
    })
    this.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: Math.ceil(prompt.length / 3),
      softLimitTokens: resolveSoftContextLimit(config.model),
      contextWindowTokens: resolveModelContextWindow(config.model),
      compacted: false,
    })

    try {
      tempProfile = await writeCodexTempProfile(config)
      if (this.cancelled) return
      const args = buildCodexArgs(config, outputFile, tempProfile?.name)
      const result = await this.runCodex(args, prompt, makeBase, config.workspaceRootPath, config)
      if (result.exitCode !== 0) {
        for (const event of streamTerminalizer.finalize(makeBase)) this.emit(event)
        if (this.cancelled) {
          this.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'CODEX_CLI_CANCELLED',
            message: 'Codex CLI run was cancelled',
            retryable: false,
          })
          this.emit({
            ...makeBase(),
            type: 'agent_status',
            status: 'cancelled',
            message: 'Codex CLI cancelled',
          })
          return
        }
        const failureMessage =
          extractCodexFailureText(result.stdout, result.stderr) || result.failureMessage
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_CLI_ERROR',
          message:
            failureMessage.length > 0
              ? `Codex CLI failed: ${failureMessage}`
              : `Codex CLI exited with code ${result.exitCode}`,
          retryable: true,
          rawError: [failureMessage, result.stderr, result.stdout].filter(Boolean).join('\n\n'),
        })
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
          message: 'Codex CLI failed',
        })
        return
      }

      // 流式解析已通过 delta 把分片发给了前端；这里补发一条 isFinal=true 的 complete
      // 让前端 builder 收尾该 segment。优先用累积出来的文本（与已流式内容一致），
      // 仅在没有任何 agent_message 增量产出时回退到 --output-last-message 文件。
      const streamedText = result.assistantText
      const finalMessage =
        streamedText.length > 0
          ? streamedText
          : (await readLastMessage(outputFile)) || extractFallbackText(result.stdout)
      if (finalMessage.length > 0) {
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'complete',
          content: finalMessage,
          provider: 'codex',
          isFinal: true,
          segmentId: `codex-${turnId}`,
        })
      }
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: 'completed',
      })
    } catch (err) {
      for (const event of streamTerminalizer.finalize(makeBase)) this.emit(event)
      if (this.cancelled) {
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_CLI_CANCELLED',
          message: 'Codex CLI run was cancelled',
          retryable: false,
          rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'cancelled',
          message: 'Codex CLI cancelled',
        })
        return
      }
      this.emit({
        ...makeBase(),
        type: 'agent_error',
        code: 'CODEX_CLI_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: 'error',
        message: 'Codex CLI failed',
      })
      throw err
    } finally {
      this.child = null
      if (this.streamTerminalizer === streamTerminalizer) this.streamTerminalizer = null
      this.cancelled = false
      if (tempProfile != null) {
        await rm(tempProfile.filePath, { force: true }).catch(() => undefined)
      }
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private runCodex(
    args: string[],
    prompt: string,
    makeBase: () => EventBase,
    cwd: string,
    config: SDKExecutorConfig,
  ): Promise<CodexRunResult> {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let assistantText = ''
      let failureMessage = ''
      let assistantCompleteEmitted = false
      const progressState: CodexProgressState = { lastProgressText: '' }
      let terminalOutputEmitted = false
      let lineBuffer = ''
      let settled = false
      let candidateIndex = 0
      const candidates = getCodexCliCandidates()
      const streamState: CodexStreamState = {
        content: '',
        thinking: '',
        currentTextSegmentId: null,
        textSegmentCounter: 0,
        completedTextBySegmentId: new Map(),
        completedTextOrder: [],
        toolCalledSinceContent: false,
        emittedToolCallIds: new Set(),
        activeCommandOutputById: new Map(),
      }

      const startCandidate = (): void => {
        const command = candidates[candidateIndex]
        if (command == null) {
          settled = true
          reject(createCodexCliNotFoundError(candidates))
          return
        }
        const attemptIndex = candidateIndex

        const child = spawn(command, args, {
          cwd,
          env: {
            ...process.env,
            ...(config.codexCliProvider?.env ?? {}),
            // 用户在会话/项目级配置的自定义环境变量：注入 codex 子进程，供其 shell/工具引用真实值。
            ...(config.customEnv ?? {}),
            ...buildCodexMcpEnv(config.mcpServers),
          },
          shell: shouldSpawnWithShell(command),
          windowsHide: true,
        })
        this.child = child

        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stdout += text
          lineBuffer += text
          const lines = lineBuffer.split(/\r?\n/)
          lineBuffer = lines.pop() ?? ''
          for (const line of lines) {
            const parsed = parseCodexJsonLine(line)
            if (parsed == null) {
              terminalOutputEmitted =
                this.emitTerminalLine(line, 'stdout', makeBase) || terminalOutputEmitted
              continue
            }

            const errorText = extractCodexErrorText(parsed)
            if (errorText.length > 0) {
              failureMessage = errorText
              terminalOutputEmitted =
                this.emitTerminalLine(errorText, 'stderr', makeBase) || terminalOutputEmitted
              continue
            }

            // Codex CLI 的 exec --json 通过 item.* 事件携带累积全文，
            // 这里做前缀切片得到增量 delta，与 SDK 路径行为对齐。
            const outcome = dispatchCodexEvent(
              parsed,
              makeBase,
              streamState,
              config.model,
              (event) => this.emit(event),
            )
            if (outcome.emittedDelta) assistantText += outcome.emittedDelta
            if (outcome.markedComplete) {
              assistantText = getCompletedAssistantText(streamState) || assistantText
              assistantCompleteEmitted = true
            }
            if (outcome.handled) {
              terminalOutputEmitted = outcome.emittedTerminal || terminalOutputEmitted
              continue
            }

            this.emitCodexProgress(parsed, makeBase, progressState)
          }
        })
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stderr += text
          terminalOutputEmitted = true
          this.emit({
            ...makeBase(),
            type: 'terminal_output',
            toolCallId: `codex-cli-${makeBase().turnId}`,
            stream: 'stderr',
            data: text,
            isFinal: false,
          })
        })
        child.stdin.on('error', (err: NodeJS.ErrnoException) => {
          if (settled) return
          if (attemptIndex !== candidateIndex) return
          settled = true
          reject(err)
        })
        child.on('error', (err: NodeJS.ErrnoException) => {
          if (settled) return
          if (attemptIndex !== candidateIndex) return
          if (err.code === 'ENOENT' && stdout.length === 0 && stderr.length === 0) {
            candidateIndex += 1
            startCandidate()
            return
          }
          settled = true
          reject(err)
        })
        child.on('close', (code) => {
          if (settled) return
          if (attemptIndex !== candidateIndex) return
          settled = true
          const tail = lineBuffer.trim()
          if (tail.length > 0) {
            terminalOutputEmitted =
              this.emitTerminalLine(tail, 'stdout', makeBase) || terminalOutputEmitted
          }
          if (terminalOutputEmitted) {
            this.emit({
              ...makeBase(),
              type: 'terminal_output',
              toolCallId: `codex-cli-${makeBase().turnId}`,
              stream: 'stdout',
              data: '',
              isFinal: true,
              exitCode: code ?? 1,
            })
          }
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            assistantText,
            assistantCompleteEmitted,
            failureMessage,
          })
        })
        child.stdin.end(prompt)
      }

      startCandidate()
    })
  }

  private emitTerminalLine(
    line: string,
    stream: 'stdout' | 'stderr',
    makeBase: () => EventBase,
  ): boolean {
    const visible = line.trim()
    if (visible.length === 0) return false
    this.emit({
      ...makeBase(),
      type: 'terminal_output',
      toolCallId: `codex-cli-${makeBase().turnId}`,
      stream,
      data: `${visible}\n`,
      isFinal: false,
    })
    return true
  }

  private emitCodexProgress(
    obj: Record<string, unknown>,
    makeBase: () => EventBase,
    state: CodexProgressState,
  ): void {
    const text = summarizeCodexProgress(obj)
    if (text.length === 0 || text === state.lastProgressText) return
    state.lastProgressText = text
    this.emit({
      ...makeBase(),
      type: 'agent_thinking',
      mode: 'delta',
      content: `${text}\n`,
      segmentId: `codex-cli-progress-${makeBase().turnId}`,
    })
  }

  private emit(event: AgentEvent): void {
    this.streamTerminalizer?.observe(event)
    for (const listener of this.listeners) listener(event)
  }
}

function buildCodexArgs(
  config: SDKExecutorConfig,
  outputFile: string,
  profileName?: string,
): string[] {
  const args = [
    'exec',
    '--json',
    '--output-last-message',
    outputFile,
    '-C',
    config.workspaceRootPath,
    '--skip-git-repo-check',
  ]
  if (profileName != null) args.splice(1, 0, '-p', profileName)
  if (!config.useLocalConfig && config.model.trim().length > 0) {
    args.push('--model', config.model)
  }
  args.push(...mapCodexPermissionArgs(config.permissionMode, config.unattended))
  for (const dir of config.additionalDirectories ?? []) {
    args.push('--add-dir', dir)
  }
  for (const attachment of config.attachments ?? []) {
    if (attachment.type === 'image') args.push('--image', attachment.path)
  }
  return args
}

async function writeCodexTempProfile(config: SDKExecutorConfig): Promise<CodexTempProfile | null> {
  const items = buildCodexProfileConfigItems(config)
  if (items.length === 0) return null
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex')
  await mkdir(codexHome, { recursive: true })
  const name = `spark-${randomUUID()}`
  const filePath = path.join(codexHome, `${name}.config.toml`)
  await writeFile(filePath, `${items.join('\n')}\n`, 'utf8')
  return { name, filePath }
}

function buildCodexProfileConfigItems(config: SDKExecutorConfig): string[] {
  const items = [
    ...(config.goal?.mode === 'codex-native' ? ['features.goals=true'] : []),
    ...buildCodexModelProviderConfigArgs(config),
    ...buildCodexMcpConfigArgs(config.mcpServers),
  ]
  const effort = mapCodexReasoningEffort(config.reasoningEffort)
  if (effort != null) {
    items.push(`model_reasoning_effort=${tomlString(effort)}`)
  }
  items.push(`model_reasoning_summary='concise'`)
  items.push('show_raw_agent_reasoning=true')
  items.push('hide_agent_reasoning=false')
  items.push(`sandbox_workspace_write.network_access=${config.networkAccessEnabled ?? false}`)
  const webSearchMode =
    config.webSearchMode ?? (config.webSearchEnabled === true ? 'live' : 'disabled')
  items.push(`web_search=${tomlString(webSearchMode)}`)
  return items
}

function buildCodexModelProviderConfigArgs(config: SDKExecutorConfig): string[] {
  const provider = config.codexCliProvider
  if (provider == null) return []
  const id = sanitizeConfigKey(provider.id)
  const result = [
    `model_provider=${tomlString(id)}`,
    `model_providers.${id}.wire_api=${tomlString(provider.wireApi)}`,
  ]
  if (provider.name != null && provider.name.trim().length > 0) {
    result.push(`model_providers.${id}.name=${tomlString(provider.name.trim())}`)
  }
  if (provider.baseUrl != null && provider.baseUrl.trim().length > 0) {
    result.push(
      `model_providers.${id}.base_url=${tomlString(provider.baseUrl.trim().replace(/\/+$/, ''))}`,
    )
  }
  if (provider.envKey != null && provider.envKey.trim().length > 0) {
    result.push(`model_providers.${id}.env_key=${tomlString(provider.envKey.trim())}`)
  }
  return result
}

/**
 * 把 Spark 的 reasoningEffort 档位映射成 Codex CLI 接受的值。
 * Codex CLI 没有 `minimal`（降级 low）和 `max`（封顶 xhigh）。
 * 与 teamagentx getCodexReasoningEffort (codex-sdk.executor.ts:281-294) 一致。
 */
function mapCodexReasoningEffort(
  effort: SDKExecutorConfig['reasoningEffort'],
): CodexReasoningEffort | null {
  return toCodexReasoningEffort(effort) ?? null
}

function getCodexCliCandidates(): string[] {
  return process.platform === 'win32'
    ? ['codex.exe', 'codex', 'codex.cmd', 'codex.bat', 'codex.ps1']
    : ['codex']
}

function shouldSpawnWithShell(command: string): boolean {
  if (process.platform !== 'win32') return false
  return /\.(?:cmd|bat|ps1)$/i.test(command)
}

function createCodexCliNotFoundError(candidates: string[]): Error {
  const suffix =
    process.platform === 'win32'
      ? ' On Windows, install Codex CLI globally and make sure the npm global bin directory is available in PATH.'
      : ' Install Codex CLI and make sure it is available in PATH.'
  const err = new Error(`Codex CLI executable not found. Tried: ${candidates.join(', ')}.${suffix}`)
  err.name = 'CodexCliNotFoundError'
  return err
}

function mapCodexPermissionArgs(
  mode: SDKExecutorConfig['permissionMode'],
  unattended: boolean | undefined,
): string[] {
  // Codex CLI currently exposes only the all-or-nothing bypass flag for
  // suppressing approvals. Scheduled unattended runs must never block waiting
  // for input, so force the non-interactive path when automation requests it.
  if (unattended === true) {
    return ['--dangerously-bypass-approvals-and-sandbox']
  }
  switch (mode) {
    case 'codex-full-access':
      return ['--dangerously-bypass-approvals-and-sandbox']
    case 'codex-auto-review':
      return ['--sandbox', 'workspace-write']
    default:
      return ['--sandbox', 'workspace-write']
  }
}

function buildCodexPrompt(userMessage: string, config: SDKExecutorConfig): string {
  const sections = [
    config.skillSystemPrompt != null && config.skillSystemPrompt.trim().length > 0
      ? `# Spark Skills\n${config.skillSystemPrompt}`
      : '',
    config.systemPrompt != null && config.systemPrompt.trim().length > 0
      ? `# Spark Runtime Context\n${config.systemPrompt}`
      : '',
    buildMcpPrompt(config.mcpServers),
    buildPromptWithAttachments(userMessage, config.attachments),
  ].filter((section) => section.trim().length > 0)
  return sections.join('\n\n')
}

function buildPromptWithAttachments(
  userMessage: string,
  attachments: SDKTurnAttachment[] | undefined,
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
    'Use the available file tools to inspect these file paths when they are relevant.',
    ...(hasDirectory
      ? [
          'Directory attachments are context references: explore them with file tools only when relevant, do not auto-read every file.',
        ]
      : []),
  ].join('\n')
}

function buildMcpPrompt(mcpServers: Record<string, SDKMcpServerConfig> | undefined): string {
  const names = Object.keys(mcpServers ?? {})
  if (names.length === 0) return ''
  return [
    '# MCP Servers',
    'The following MCP servers have been configured for Codex CLI when supported:',
    ...names.map((name) => `- ${name}`),
  ].join('\n')
}

function buildCodexMcpConfigArgs(
  mcpServers: Record<string, SDKMcpServerConfig> | undefined,
): string[] {
  const result: string[] = []
  for (const [rawName, server] of Object.entries(mcpServers ?? {})) {
    if (server.type === 'sdk') continue
    const name = sanitizeConfigKey(rawName)
    const approvalMode = codexDefaultToolsApprovalMode(rawName)
    if (server.url != null) {
      const bearerEnvVar = codexBearerTokenEnvVarName(rawName, server)
      const httpHeaders = codexStaticHttpHeaders(server)
      result.push(`mcp_servers.${name}.url=${tomlString(server.url)}`)
      if (approvalMode != null) {
        result.push(`mcp_servers.${name}.default_tools_approval_mode=${tomlString(approvalMode)}`)
      }
      if (bearerEnvVar != null) {
        result.push(`mcp_servers.${name}.bearer_token_env_var=${tomlString(bearerEnvVar)}`)
      }
      for (const [key, value] of Object.entries(httpHeaders)) {
        result.push(
          `mcp_servers.${name}.http_headers.${sanitizeConfigKey(key)}=${tomlString(value)}`,
        )
      }
      continue
    }
    if (server.command == null) continue
    result.push(`mcp_servers.${name}.command=${tomlString(server.command)}`)
    if (approvalMode != null) {
      result.push(`mcp_servers.${name}.default_tools_approval_mode=${tomlString(approvalMode)}`)
    }
    if (server.args != null) result.push(`mcp_servers.${name}.args=${tomlArray(server.args)}`)
    if (server.cwd != null) result.push(`mcp_servers.${name}.cwd=${tomlString(server.cwd)}`)
    if (server.env != null) {
      for (const [key, value] of Object.entries(server.env)) {
        result.push(`mcp_servers.${name}.env.${sanitizeConfigKey(key)}=${tomlString(value)}`)
      }
    }
  }
  return result
}

function codexDefaultToolsApprovalMode(rawName: string): 'approve' | null {
  return rawName.startsWith('spark_') ? 'approve' : null
}

function buildCodexMcpEnv(
  mcpServers: Record<string, SDKMcpServerConfig> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [rawName, server] of Object.entries(mcpServers ?? {})) {
    const token = codexBearerToken(server)
    if (token == null) continue
    env[codexBearerTokenEnvVar(rawName)] = token
  }
  return env
}

function codexBearerTokenEnvVarName(rawName: string, server: SDKMcpServerConfig): string | null {
  return codexBearerToken(server) != null ? codexBearerTokenEnvVar(rawName) : null
}

function codexBearerToken(server: SDKMcpServerConfig): string | null {
  const auth = findHeader(server.headers, 'authorization')
  if (auth == null) return null
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return match?.[1]?.trim() || null
}

function codexStaticHttpHeaders(server: SDKMcpServerConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (key.toLowerCase() === 'authorization' && /^Bearer\s+/i.test(value.trim())) continue
    out[key] = value
  }
  return out
}

function findHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (headers == null) return null
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return null
}

function codexBearerTokenEnvVar(rawName: string): string {
  const suffix = rawName
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return `SPARK_MCP_${suffix.length > 0 ? suffix : 'SERVER'}_BEARER_TOKEN`
}

function sanitizeConfigKey(value: string): string {
  const key = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return key.length > 0 ? key : 'server'
}

function tomlString(value: string): string {
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`
  return JSON.stringify(value)
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`
}

async function readLastMessage(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, 'utf8')).trim()
  } catch {
    return ''
  }
}

function parseCodexJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function summarizeCodexProgress(obj: Record<string, unknown>): string {
  const type = typeof obj.type === 'string' ? obj.type : 'event'
  switch (type) {
    case 'thread.started':
      return 'Codex CLI thread started'
    case 'turn.started':
      return 'Codex CLI turn started'
    case 'turn.completed':
      return 'Codex CLI turn completed'
    case 'item.started':
      return summarizeCodexItem(obj, 'started')
    case 'item.completed':
      return summarizeCodexItem(obj, 'completed')
    default:
      return ''
  }
}

function summarizeCodexItem(obj: Record<string, unknown>, status: string): string {
  const item = obj.item
  if (item == null || typeof item !== 'object' || Array.isArray(item)) {
    return `Codex item ${status}`
  }
  const record = item as Record<string, unknown>
  const itemType = typeof record.type === 'string' ? record.type : 'item'
  // agent_message / reasoning / agent_reasoning 已由 dispatchCodexEvent
  // 转成真实增量流式输出，不会再走到这里；这里只对工具类 item 做摘要。
  if (itemType === 'tool_call') {
    const name = typeof record.name === 'string' ? record.name : 'tool'
    return `Codex tool ${name} ${status}`
  }
  if (itemType === 'command_execution') return `Codex command ${status}`
  return `Codex ${itemType} ${status}`
}

function extractFallbackText(stdout: string): string {
  const lines = stdout.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = findTextFromLine(lines[i] ?? '')
    if (text.trim().length > 0) return text.trim()
  }
  return stdout.trim()
}

function extractCodexFailureText(stdout: string, stderr: string): string {
  const stderrLines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const networkLine = [...stderrLines]
    .reverse()
    .find((line) => /os error 10013|websocket|responses|api\.openai\.com/i.test(line))
  if (networkLine != null) return normalizeCodexCliErrorText(networkLine)

  const stdoutLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = stdoutLines.length - 1; i >= 0; i--) {
    const parsed = parseCodexJsonLine(stdoutLines[i] ?? '')
    if (parsed == null) continue
    const errorText = extractCodexErrorText(parsed)
    if (errorText.length > 0) return errorText
  }

  const lastStderr = stderrLines.at(-1)
  if (lastStderr != null) return normalizeCodexCliErrorText(lastStderr)
  return ''
}

function extractCodexErrorText(obj: Record<string, unknown>): string {
  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type !== 'error' && type !== 'turn.failed') return ''

  const directMessage = findTextFromKeys(obj, ['message'])
  if (directMessage != null && directMessage.trim().length > 0) {
    return normalizeCodexCliErrorText(directMessage)
  }

  const error = obj.error
  if (error != null && typeof error === 'object' && !Array.isArray(error)) {
    const nestedMessage = findTextFromKeys(error, ['message', 'error'])
    if (nestedMessage != null && nestedMessage.trim().length > 0) {
      return normalizeCodexCliErrorText(nestedMessage)
    }
  }

  return ''
}

function normalizeCodexCliErrorText(value: string): string {
  return value.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+ERROR\s+\S+:\s*/i, '').trim()
}

function findTextFromLine(line: string): string {
  try {
    return findText(JSON.parse(line)) ?? ''
  } catch {
    return line
  }
}

function findText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value == null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    const parts = value
      .map(findText)
      .filter((part): part is string => part != null && part.length > 0)
    return parts.length > 0 ? parts.join('\n') : null
  }
  const record = value as Record<string, unknown>
  for (const key of ['text', 'content', 'message', 'result', 'summary']) {
    const found = findText(record[key])
    if (found != null && found.length > 0) return found
  }
  return null
}

type DispatchOutcome = {
  handled: boolean
  /** 本次事件新增的 assistant 文本增量（已通过 emit 发出） */
  emittedDelta: string
  /** 是否已把当前累积文本标记为「段落完成」 */
  markedComplete: boolean
  /** 是否额外产生了 terminal_output（保留兼容） */
  emittedTerminal: boolean
}

/**
 * 解析 Codex CLI `exec --json` 的一行 JSON 事件，按 item.* 事件里的 item.type
 * 分流为 agent_message / reasoning / 工具调用，并对累积文本做前缀切片得到增量 delta。
 *
 * Codex CLI 的协议与 OpenAI Responses SDK 流式不同：它不在 delta 事件里发增量，
 * 而是在 item.started/updated/completed 里反复带「累积全文」。所以这里需要维护
 * streamState.content / thinking，按前缀比较算出新增后缀。参考 teamagentx 的
 * appendContent / appendThinking (codex-sdk.executor.ts:2028-2051)。
 */
function dispatchCodexEvent(
  obj: Record<string, unknown>,
  makeBase: () => EventBase,
  state: CodexStreamState,
  model: string,
  emit: (event: AgentEvent) => void,
): DispatchOutcome {
  const type = typeof obj.type === 'string' ? obj.type : ''
  const outcome: DispatchOutcome = {
    handled: false,
    emittedDelta: '',
    markedComplete: false,
    emittedTerminal: false,
  }

  const compactEvent = extractCodexCompactionEvent(obj, 'codex_cli', makeBase())
  if (compactEvent != null) {
    emit(compactEvent)
    outcome.handled = true
    return outcome
  }

  if (type === 'thread.started' || type === 'turn.started') {
    outcome.handled = true
    return outcome
  }

  // turn.completed 携带 usage，转成 usage_update（与 SDK 路径对齐）。
  if (type === 'turn.completed') {
    const usage = obj.usage
    if (usage != null && typeof usage === 'object' && !Array.isArray(usage)) {
      const u = usage as Record<string, unknown>
      const inputTokens = readNumber(u.input_tokens) ?? readNumber(u.prompt_tokens) ?? 0
      const outputTokens = readNumber(u.output_tokens) ?? readNumber(u.completion_tokens) ?? 0
      const cacheHitTokens = readNumber(u.cached_input_tokens) ?? 0
      const reasoningOutputTokens = readNumber(u.reasoning_output_tokens) ?? 0
      emit({
        ...makeBase(),
        type: 'usage_update',
        provider: 'codex',
        model,
        inputTokens,
        outputTokens,
        cacheHitTokens,
        reasoningOutputTokens,
      })
    }
    outcome.handled = true
    return outcome
  }

  if (type === 'response.output_text.delta') {
    const delta = typeof obj.delta === 'string' ? obj.delta : ''
    if (delta.length > 0) {
      if (state.toolCalledSinceContent) {
        completeCurrentTextSegment(state)
        resetCurrentTextSegment(state)
        state.toolCalledSinceContent = false
      }
      const segmentId = currentTextSegmentId(state, makeBase().turnId)
      state.content += delta
      emit({
        ...makeBase(),
        type: 'assistant_message',
        mode: 'delta',
        content: delta,
        provider: 'codex',
        isFinal: false,
        segmentId,
      })
      outcome.emittedDelta = delta
    }
    outcome.handled = true
    return outcome
  }

  if (
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_text.delta'
  ) {
    const delta = typeof obj.delta === 'string' ? obj.delta : ''
    if (delta.length > 0) {
      state.thinking += delta
      emit({
        ...makeBase(),
        type: 'agent_thinking',
        mode: 'delta',
        content: delta,
        segmentId: `codex-cli-thinking-${makeBase().turnId}`,
      })
    }
    outcome.handled = true
    return outcome
  }

  // 只有 item.* 事件携带 item 对象。
  if (
    type !== 'item.started' &&
    type !== 'item.updated' &&
    type !== 'completed' &&
    type !== 'item.completed'
  ) {
    return outcome
  }
  const item = obj.item
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return outcome
  const record = item as Record<string, unknown>
  const itemType = typeof record.type === 'string' ? record.type : ''
  const isComplete = type === 'item.completed' || type === 'completed'

  if (itemType === 'agent_message' || itemType === 'assistant_message' || itemType === 'message') {
    // 上一段之后若发生过工具调用，此条消息视为新的最终段落，先清空旧累积。
    if (state.toolCalledSinceContent) {
      completeCurrentTextSegment(state)
      resetCurrentTextSegment(state)
      state.toolCalledSinceContent = false
    }
    const segmentId = currentTextSegmentId(state, makeBase().turnId)
    const text = (findText(record.text) ?? findText(record.content) ?? '').replace(/\r?\n$/, '')
    const delta = computeDelta(text, state.content)
    if (delta.length > 0) {
      emit({
        ...makeBase(),
        type: 'assistant_message',
        mode: 'delta',
        content: delta,
        provider: 'codex',
        isFinal: false,
        segmentId,
      })
      outcome.emittedDelta = delta
    }
    state.content = text.length > 0 ? text : state.content
    if (isComplete) {
      completeCurrentTextSegment(state)
      emit({
        ...makeBase(),
        type: 'assistant_message',
        mode: 'complete',
        content: state.completedTextBySegmentId.get(segmentId) ?? state.content,
        provider: 'codex',
        isFinal: false,
        segmentId,
      })
      outcome.markedComplete = true
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'reasoning' || itemType === 'agent_reasoning') {
    const text = (findText(record.text) ?? '').replace(/\r?\n$/, '')
    const delta = computeDelta(text, state.thinking)
    if (delta.length > 0) {
      emit({
        ...makeBase(),
        type: 'agent_thinking',
        mode: 'delta',
        content: delta,
        segmentId: `codex-thinking-${makeBase().turnId}`,
      })
    }
    state.thinking = text.length > 0 ? text : state.thinking
    outcome.handled = true
    return outcome
  }

  if (itemType === 'mcp_tool_call') {
    state.toolCalledSinceContent = true
    const id = typeof record.id === 'string' ? record.id : `mcp-${makeBase().seq}`
    const server = typeof record.server === 'string' ? record.server : 'unknown'
    const tool = typeof record.tool === 'string' ? record.tool : 'unknown'
    const toolName = `mcp__${server}__${tool}`
    if (!state.emittedToolCallIds.has(id)) {
      state.emittedToolCallIds.add(id)
      const toolInput =
        record.arguments != null &&
        typeof record.arguments === 'object' &&
        !Array.isArray(record.arguments)
          ? (record.arguments as Record<string, unknown>)
          : {}
      emit({
        ...makeBase(),
        type: 'tool_call',
        toolCallId: id,
        toolName,
        toolInput,
        source: 'mcp',
        mcpServerId: server,
      })
    }
    if (isComplete) {
      const failed = record.status === 'failed' || record.error != null
      emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: id,
        toolName,
        status: failed ? 'error' : 'success',
        ...(failed
          ? { error: findText(record.error) ?? 'MCP tool failed' }
          : { output: record.result ?? null }),
      })
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'command_execution') {
    state.toolCalledSinceContent = true
    const id = typeof record.id === 'string' ? record.id : `cmd-${makeBase().turnId}`
    if (!state.emittedToolCallIds.has(id)) {
      state.emittedToolCallIds.add(id)
      emit({
        ...makeBase(),
        type: 'tool_call',
        toolCallId: id,
        toolName: 'bash',
        toolInput: { command: readCommandExecutionCommand(record) },
        source: 'builtin',
      })
    }
    const aggregatedOutput = readCommandExecutionOutput(record)
    const previousOutput = state.activeCommandOutputById.get(id) ?? ''
    const delta = computeDelta(aggregatedOutput, previousOutput)
    if (delta.length > 0) {
      emit({
        ...makeBase(),
        type: 'terminal_output',
        toolCallId: id,
        stream: 'stdout',
        data: delta,
        isFinal: false,
      })
    }
    state.activeCommandOutputById.set(id, aggregatedOutput)
    if (isComplete) {
      const exitCode = readNumber(record.exit_code) ?? (record.status === 'completed' ? 0 : 1)
      emit({
        ...makeBase(),
        type: 'terminal_output',
        toolCallId: id,
        stream: 'stdout',
        data: '',
        isFinal: true,
        exitCode: exitCode ?? 1,
      })
      const failed =
        record.status === 'failed' || record.error != null || (exitCode != null && exitCode !== 0)
      emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: id,
        toolName: 'bash',
        status: failed ? 'error' : 'success',
        output: aggregatedOutput,
        ...(failed
          ? { error: (readToolError(record) ?? aggregatedOutput) || 'Command failed' }
          : {}),
      })
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'tool_call') {
    state.toolCalledSinceContent = true
    const id = typeof record.id === 'string' ? record.id : `tool-${makeBase().turnId}`
    const toolName =
      typeof record.name === 'string' && record.name.trim().length > 0 ? record.name : 'tool'
    if (!state.emittedToolCallIds.has(id)) {
      state.emittedToolCallIds.add(id)
      emit({
        ...makeBase(),
        type: 'tool_call',
        toolCallId: id,
        toolName,
        toolInput: normalizeCliToolInput(record),
        source: 'builtin',
      })
    }
    if (isComplete) {
      const failed = record.status === 'failed' || record.error != null
      emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: id,
        toolName,
        status: failed ? 'error' : 'success',
        ...(failed
          ? { error: readToolError(record) ?? 'Tool failed' }
          : { output: readToolResult(record) }),
      })
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'web_search') {
    state.toolCalledSinceContent = true
    const id = typeof record.id === 'string' ? record.id : `web-search-${makeBase().turnId}`
    if (!state.emittedToolCallIds.has(id)) {
      state.emittedToolCallIds.add(id)
      emit({
        ...makeBase(),
        type: 'tool_call',
        toolCallId: id,
        toolName: 'web_search',
        toolInput: { query: readWebSearchQuery(record) },
        source: 'builtin',
      })
    }
    if (isComplete) {
      const failed = record.status === 'failed' || record.error != null
      emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: id,
        toolName: 'web_search',
        status: failed ? 'error' : 'success',
        ...(failed
          ? { error: readToolError(record) ?? 'Web search failed' }
          : { output: readToolResult(record) }),
      })
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'file_change') {
    state.toolCalledSinceContent = true
    if (isComplete && record.status === 'completed' && Array.isArray(record.changes)) {
      for (const change of record.changes) {
        if (change == null || typeof change !== 'object' || Array.isArray(change)) continue
        const item = change as Record<string, unknown>
        if (typeof item.path !== 'string') continue
        emit({
          ...makeBase(),
          type: 'file_change',
          path: item.path,
          changeType: mapCliPatchKind(item.kind),
        })
      }
    }
    outcome.handled = true
    return outcome
  }

  if (itemType === 'todo_list') {
    state.toolCalledSinceContent = true
    const id = typeof record.id === 'string' ? record.id : `todo-${makeBase().turnId}`
    const todos = Array.isArray(record.items) ? record.items : []
    if (!state.emittedToolCallIds.has(id)) {
      state.emittedToolCallIds.add(id)
      emit({
        ...makeBase(),
        type: 'tool_call',
        toolCallId: id,
        toolName: 'todo_write',
        toolInput: { todos },
        source: 'builtin',
      })
    }
    emit({
      ...makeBase(),
      type: 'tool_result',
      toolCallId: id,
      toolName: 'todo_write',
      status: 'success',
      output: { todos },
    })
    outcome.handled = true
    return outcome
  }

  if (itemType === 'error') {
    const message = findText(record.message) ?? 'Codex CLI item failed'
    emit({
      ...makeBase(),
      type: 'agent_error',
      code: 'CODEX_CLI_ITEM_ERROR',
      message,
      retryable: true,
      rawError: message,
    })
    outcome.handled = true
    return outcome
  }

  return outcome
}

/**
 * Codex 带的是累积全文，用前缀比较算出新增后缀。若新文本不是旧文本的前缀
 * （例如模型重写了上一段），则整段重发。
 */
function computeDelta(next: string, prev: string): string {
  if (next.length === 0) return ''
  if (next.startsWith(prev)) return next.slice(prev.length)
  return next
}

function currentTextSegmentId(state: CodexStreamState, turnId: string): string {
  if (state.currentTextSegmentId == null) {
    state.textSegmentCounter += 1
    state.currentTextSegmentId = `codex-${turnId}-text-${state.textSegmentCounter}`
  }
  return state.currentTextSegmentId
}

function completeCurrentTextSegment(state: CodexStreamState): void {
  const segmentId = state.currentTextSegmentId
  if (segmentId == null || state.content.trim().length === 0) return
  if (!state.completedTextBySegmentId.has(segmentId)) state.completedTextOrder.push(segmentId)
  state.completedTextBySegmentId.set(segmentId, state.content)
}

function resetCurrentTextSegment(state: CodexStreamState): void {
  state.content = ''
  state.currentTextSegmentId = null
}

function getCompletedAssistantText(state: CodexStreamState): string {
  return state.completedTextOrder
    .map((id) => state.completedTextBySegmentId.get(id) ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
}

function normalizeCliToolInput(record: Record<string, unknown>): Record<string, unknown> {
  const input = record.arguments ?? record.input
  if (input != null && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  return {}
}

function readToolResult(record: Record<string, unknown>): unknown {
  if ('result' in record) return record.result ?? null
  if ('output' in record) return record.output ?? null
  return null
}

function readToolError(record: Record<string, unknown>): string | null {
  const direct = findText(record.error)
  if (direct != null && direct.length > 0) return direct
  const fallback = findText(record.result)
  return fallback != null && fallback.length > 0 ? fallback : null
}

function readCommandExecutionCommand(record: Record<string, unknown>): string {
  return findText(record.command) ?? ''
}

function readCommandExecutionOutput(record: Record<string, unknown>): string {
  return (
    findText(record.aggregated_output) ?? findText(record.output) ?? findText(record.result) ?? ''
  )
}

function readWebSearchQuery(record: Record<string, unknown>): string {
  return findText(record.query) ?? ''
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10)
  return null
}

function mapCliPatchKind(value: unknown): 'create' | 'delete' | 'modify' {
  if (value === 'add') return 'create'
  if (value === 'delete') return 'delete'
  return 'modify'
}

function findTextFromKeys(value: unknown, keys: string[]): string | null {
  if (value == null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTextFromKeys(item, keys)
      if (found != null && found.length > 0) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const found = findText(record[key])
    if (found != null && found.length > 0) return found
  }
  for (const key of ['item', 'data', 'response', 'message', 'content']) {
    const found = findTextFromKeys(record[key], keys)
    if (found != null && found.length > 0) return found
  }
  return null
}

function buildCodexGoalPrompt(userMessage: string, config: SDKExecutorConfig): string {
  const goal = config.goal
  if (goal == null) return userMessage
  if (goal.mode === 'codex-native') {
    if (goal.control === 'pause') return '/goal pause'
    if (goal.control === 'resume') return '/goal resume'
    if (goal.control === 'clear') return '/goal clear'
    return `/goal ${goal.objective}\n\n${userMessage}`
  }
  const progress =
    goal.progressLog
      ?.slice(-8)
      .map(
        (entry) =>
          `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`,
      )
      .join('\n') || '- No prior progress.'
  return [
    'Spark Goal Loop Contract:',
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    'Recent progress:',
    progress,
    '',
    userMessage,
    '',
    'End with a fenced spark-goal-status block containing status, phase, summary, evidence, and next_step.',
  ].join('\n')
}
