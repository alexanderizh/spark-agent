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
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_CLI_ERROR',
          message: `Codex CLI exited with code ${result.exitCode}`,
          retryable: true,
          rawError: result.stderr || result.stdout,
        })
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
          message: 'Codex CLI failed',
        })
        return
      }

      const finalMessage = (await readLastMessage(outputFile)) || extractFallbackText(result.stdout)
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
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        cwd,
        env: process.env,
        windowsHide: true,
      })
      this.child = child
      let stdout = ''
      let stderr = ''
      let settled = false

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stdout += text
        this.emitCodexJsonlAsTerminal(text, 'stdout', makeBase)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        this.emit({
          ...makeBase(),
          type: 'terminal_output',
          toolCallId: `codex-cli-${makeBase().turnId}`,
          stream: 'stderr',
          data: text,
          isFinal: false,
        })
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        reject(err)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        this.emit({
          ...makeBase(),
          type: 'terminal_output',
          toolCallId: `codex-cli-${makeBase().turnId}`,
          stream: 'stdout',
          data: '',
          isFinal: true,
          exitCode: code ?? 1,
        })
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })
      child.stdin.end(prompt)
    })
  }

  private emitCodexJsonlAsTerminal(
    text: string,
    stream: 'stdout' | 'stderr',
    makeBase: () => EventBase,
  ): void {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
    const visible = lines
      .map((line) => summarizeCodexJsonLine(line))
      .filter((line) => line.length > 0)
      .join('\n')
    if (!visible) return
    this.emit({
      ...makeBase(),
      type: 'terminal_output',
      toolCallId: `codex-cli-${makeBase().turnId}`,
      stream,
      data: `${visible}\n`,
      isFinal: false,
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

function summarizeCodexJsonLine(line: string): string {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : 'event'
    const text = findText(obj)
    return text != null && text.trim().length > 0
      ? `[codex:${type}] ${text.trim()}`
      : `[codex:${type}]`
  } catch {
    return line
  }
}

function extractFallbackText(stdout: string): string {
  const lines = stdout.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = findTextFromLine(lines[i] ?? '')
    if (text.trim().length > 0) return text.trim()
  }
  return stdout.trim()
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
    const parts = value.map(findText).filter((part): part is string => part != null && part.length > 0)
    return parts.length > 0 ? parts.join('\n') : null
  }
  const record = value as Record<string, unknown>
  for (const key of ['text', 'content', 'message', 'result', 'summary']) {
    const found = findText(record[key])
    if (found != null && found.length > 0) return found
  }
  return null
}
