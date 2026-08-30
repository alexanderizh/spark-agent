#!/usr/bin/env node
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { governMcpToolResult } from './tool-result-artifact-store.mjs'

const WORKSPACE_ROOT = process.env.SPARK_WORKSPACE_ROOT || ''
const SERVER_NAME = process.env.SPARK_TOOL_RESULT_SERVER_NAME || 'upstream'
const TOOL_RESULT_ENVELOPE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['kind', 'version', 'status', 'preview', 'artifact', 'continuation'],
  properties: {
    kind: { const: 'spark.tool_result_envelope' },
    version: { const: 1 },
    toolName: { type: 'string' },
    toolCallId: { type: 'string' },
    status: { type: 'string' },
    preview: { type: 'object' },
    artifact: { type: 'object' },
    continuation: { type: ['object', 'null'] },
  },
}

function main() {
  const upstreamConfig = readUpstreamConfig()
  const upstream = spawn(upstreamConfig.command, upstreamConfig.args, {
    cwd: upstreamConfig.cwd,
    env: { ...process.env, ...upstreamConfig.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pendingToolCalls = new Map()
  const pendingToolLists = new Set()
  let terminating = false

  upstream.stderr.pipe(process.stderr)
  upstream.once('error', (error) => {
    writeDiagnostic(`无法启动上游 MCP：${formatError(error)}`)
    process.exitCode = 1
  })

  const downstreamInput = readline.createInterface({ input: process.stdin, terminal: false })
  downstreamInput.on('line', (line) => {
    const message = parseJsonRpcLine(line, '下游')
    if (message != null) {
      if (message.method === 'tools/call' && isRequestId(message.id)) {
        const toolName = message.params?.name
        if (typeof toolName === 'string' && toolName.length > 0) {
          pendingToolCalls.set(requestIdKey(message.id), toolName)
        }
      } else if (message.method === 'tools/list' && isRequestId(message.id)) {
        pendingToolLists.add(requestIdKey(message.id))
      } else if (message.method === 'notifications/cancelled') {
        const requestId = message.params?.requestId
        if (isRequestId(requestId)) {
          const key = requestIdKey(requestId)
          pendingToolCalls.delete(key)
          pendingToolLists.delete(key)
        }
      }
    }
    if (!upstream.stdin.destroyed) upstream.stdin.write(`${line}\n`)
  })
  downstreamInput.once('close', () => {
    if (!upstream.stdin.destroyed) upstream.stdin.end()
  })

  const upstreamOutput = readline.createInterface({ input: upstream.stdout, terminal: false })
  upstreamOutput.on('line', (line) => {
    const message = parseJsonRpcLine(line, '上游')
    if (message == null) return

    let outgoing = message
    if (isJsonRpcResponse(message)) {
      const key = requestIdKey(message.id)
      if (pendingToolLists.delete(key) && Object.hasOwn(message, 'result')) {
        outgoing = { ...message, result: governToolsListResult(message.result) }
      }
      const toolName = pendingToolCalls.get(key)
      pendingToolCalls.delete(key)
      if (toolName != null && Object.hasOwn(message, 'result')) {
        try {
          outgoing = {
            ...message,
            result: governMcpToolResult(message.result, {
              workspaceRoot: WORKSPACE_ROOT,
              toolName: `mcp__${SERVER_NAME}__${toolName}`,
            }),
          }
        } catch (error) {
          writeDiagnostic(`工具结果治理失败，已透传原始结果：${formatError(error)}`)
        }
      }
    }
    process.stdout.write(`${JSON.stringify(outgoing)}\n`)
  })

  upstream.once('exit', (code, signal) => {
    if (terminating) return
    if (signal != null) writeDiagnostic(`上游 MCP 因信号 ${signal} 退出。`)
    process.exit(code ?? (signal == null ? 0 : 1))
  })

  const terminate = (signal) => {
    if (terminating) return
    terminating = true
    downstreamInput.close()
    upstreamOutput.close()
    if (!upstream.killed) upstream.kill(signal)
    const fallback = setTimeout(() => process.exit(0), 1_000)
    fallback.unref()
  }
  process.once('SIGINT', () => terminate('SIGINT'))
  process.once('SIGTERM', () => terminate('SIGTERM'))
}

function readUpstreamConfig() {
  const encoded = process.env.SPARK_TOOL_RESULT_UPSTREAM_CONFIG || ''
  if (!encoded) throw new Error('Missing SPARK_TOOL_RESULT_UPSTREAM_CONFIG')
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid upstream MCP config')
  }
  if (typeof value.command !== 'string' || value.command.length === 0) {
    throw new Error('Upstream MCP config requires a stdio command')
  }
  if (value.url != null || (value.type != null && value.type !== 'stdio')) {
    throw new Error('Tool result proxy only supports stdio MCP servers')
  }
  return {
    command: value.command,
    args: Array.isArray(value.args) ? value.args.filter((item) => typeof item === 'string') : [],
    env: normalizeStringRecord(value.env),
    cwd: typeof value.cwd === 'string' && value.cwd.length > 0 ? value.cwd : undefined,
  }
}

function governToolsListResult(value) {
  if (!isRecord(value) || !Array.isArray(value.tools)) return value
  return {
    ...value,
    tools: value.tools.map((tool) => {
      if (!isRecord(tool) || !isRecord(tool.outputSchema)) return tool
      const outputSchema = tool.outputSchema
      return {
        ...tool,
        outputSchema: {
          type: 'object',
          ...(typeof outputSchema.$schema === 'string' ? { $schema: outputSchema.$schema } : {}),
          ...(isRecord(outputSchema.$defs) ? { $defs: outputSchema.$defs } : {}),
          ...(isRecord(outputSchema.definitions) ? { definitions: outputSchema.definitions } : {}),
          anyOf: [outputSchema, TOOL_RESULT_ENVELOPE_OUTPUT_SCHEMA],
        },
      }
    }),
  }
}

function normalizeStringRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry) => typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  )
}

function parseJsonRpcLine(line, direction) {
  try {
    const value = JSON.parse(line)
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('消息不是 JSON 对象')
    }
    return value
  } catch (error) {
    const action = direction === '上游' ? '已丢弃' : '无法跟踪但仍会透传'
    writeDiagnostic(`${direction}输出包含非 JSON-RPC 行，${action}：${formatError(error)}`)
    return null
  }
}

function isRequestId(value) {
  return typeof value === 'string' || typeof value === 'number'
}

function isJsonRpcResponse(message) {
  return (
    isRequestId(message.id) &&
    typeof message.method !== 'string' &&
    (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
  )
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function requestIdKey(value) {
  return `${typeof value}:${String(value)}`
}

function formatError(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

function writeDiagnostic(message) {
  process.stderr.write(`[spark-tool-result-governor] ${message}\n`)
}

try {
  main()
} catch (error) {
  writeDiagnostic(formatError(error))
  process.exit(1)
}
