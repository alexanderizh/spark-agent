import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
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

export class CodexCliExecutor {
  private listeners = new Set<Listener>()
  private child: ChildProcessWithoutNullStreams | null = null

  onEvent(listener: Listener): void {
    this.listeners.add(listener)
  }

  offEvent(listener: Listener): void {
    this.listeners.delete(listener)
  }

  cancel(): void {
    this.child?.kill('SIGTERM')
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'spark-codex-'))
    const outputFile = path.join(tempDir, 'last-message.txt')
    const prompt = buildCodexPrompt(userMessage, config)
    const args = buildCodexArgs(config, outputFile)
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
      const result = await this.runCodex(args, prompt, makeBase, config.workspaceRootPath)
      if (result.exitCode !== 0) {
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

      const finalMessage =
        (await readLastMessage(outputFile)) ||
        result.assistantText ||
        extractFallbackText(result.stdout)
      if (!result.assistantCompleteEmitted && finalMessage.length > 0) {
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
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private runCodex(
    args: string[],
    prompt: string,
    makeBase: () => EventBase,
    cwd: string,
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
          env: process.env,
          shell: process.platform === 'win32',
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

            const delta = extractCodexDeltaText(parsed)
            if (delta.length > 0) {
              assistantText += delta
              this.emit({
                ...makeBase(),
                type: 'assistant_message',
                mode: 'delta',
                content: delta,
                provider: 'codex',
                isFinal: false,
                segmentId: `codex-${makeBase().turnId}`,
              })
              continue
            }

            const completedText = extractCodexCompletedAgentText(parsed)
            if (completedText.length > 0) {
              assistantText = completedText
              assistantCompleteEmitted = true
              this.emit({
                ...makeBase(),
                type: 'assistant_message',
                mode: 'complete',
                content: completedText,
                provider: 'codex',
                // The CLI can emit item.completed before the process has fully exited.
                // Keep the message streaming until agent_status=completed to avoid a
                // second "running" placeholder bubble in the chat UI.
                isFinal: false,
                segmentId: `codex-${makeBase().turnId}`,
              })
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
    for (const listener of this.listeners) listener(event)
  }
}

function buildCodexArgs(config: SDKExecutorConfig, outputFile: string): string[] {
  const args = [
    'exec',
    '--json',
    '--output-last-message',
    outputFile,
    '-C',
    config.workspaceRootPath,
    '--skip-git-repo-check',
  ]
  if (!config.useLocalConfig && config.model.trim().length > 0) {
    args.push('--model', config.model)
  }
  args.push(...mapCodexPermissionArgs(config.permissionMode))
  for (const dir of config.additionalDirectories ?? []) {
    args.push('--add-dir', dir)
  }
  for (const attachment of config.attachments ?? []) {
    if (attachment.type === 'image') args.push('--image', attachment.path)
  }
  for (const item of buildCodexMcpConfigArgs(config.mcpServers)) {
    args.push('-c', item)
  }
  return args
}

function getCodexCliCandidates(): string[] {
  return process.platform === 'win32'
    ? ['codex.cmd', 'codex.exe', 'codex.bat', 'codex.ps1', 'codex']
    : ['codex']
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

function mapCodexPermissionArgs(mode: SDKExecutorConfig['permissionMode']): string[] {
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
  return [
    userMessage,
    '',
    'User-selected attachments:',
    ...lines,
    '',
    'Use the available file tools to inspect these file paths when they are relevant.',
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
    if (server.url != null) {
      result.push(`mcp_servers.${name}.url=${tomlString(server.url)}`)
      if (server.headers != null) {
        for (const [key, value] of Object.entries(server.headers)) {
          result.push(`mcp_servers.${name}.headers.${sanitizeConfigKey(key)}=${tomlString(value)}`)
        }
      }
      continue
    }
    if (server.command == null) continue
    result.push(`mcp_servers.${name}.command=${tomlString(server.command)}`)
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

function sanitizeConfigKey(value: string): string {
  const key = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return key.length > 0 ? key : 'server'
}

function tomlString(value: string): string {
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
  if (itemType === 'agent_reasoning') return `Codex reasoning ${status}`
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

function extractCodexDeltaText(obj: Record<string, unknown>): string {
  const type = typeof obj.type === 'string' ? obj.type : ''
  if (!/delta|updated|stream/i.test(type)) return ''
  return findTextFromKeys(obj, ['delta', 'text_delta', 'content_delta']) ?? ''
}

function extractCodexCompletedAgentText(obj: Record<string, unknown>): string {
  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type !== 'item.completed' && type !== 'response.output_text.done') return ''
  const item = obj.item
  if (item != null && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>
    if (
      record.type === 'agent_message' ||
      record.type === 'assistant_message' ||
      record.type === 'message'
    ) {
      return findText(record.text) ?? findText(record.content) ?? ''
    }
  }
  return findTextFromKeys(obj, ['text', 'content']) ?? ''
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
