import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { CodeToolSpec, CustomToolRecord } from '@spark/protocol'
import { resolveRuntimeToolPath } from '../session-mcp-tooling-helpers.js'
import { CustomToolError } from './custom-tool-errors.js'
import type { ExecutorContext, ExecutorResult } from './custom-tool-executor.js'
import { validateToolInput } from './custom-tool-input-validator.js'

const WORKER_PROTOCOL_VERSION = 1
const MAX_PROTOCOL_LINE_BYTES = 12 * 1024 * 1024
const MAX_LOG_BYTES = 64 * 1024

type WorkerFrame =
  | {
      protocolVersion: 1
      type: 'broker_request'
      requestId: string
      capability: 'tools.call'
      toolId: string
      input: unknown
    }
  | { protocolVersion: 1; type: 'log'; level: string; text: string }
  | { protocolVersion: 1; type: 'result'; requestId: string; output: unknown; bytes: number }
  | { protocolVersion: 1; type: 'error' | 'fatal'; requestId?: string; message: string }

function resolveStandaloneNode(): string {
  const configured = process.env.SPARK_STANDALONE_NODE?.trim()
  if (configured != null && configured.length > 0 && existsSync(configured)) return configured
  if (process.versions.electron == null) return process.execPath
  throw new CustomToolError(
    'EXECUTION_FAILED',
    '独立 Node 运行时不可用，无法执行代码工具；请在设置 → 完整性中修复运行时',
  )
}

function asObject(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CustomToolError('EXECUTION_FAILED', '依赖工具输入必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function serializeOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2)
  return serialized === undefined ? 'null' : serialized
}

function writeFrame(child: ChildProcessWithoutNullStreams, frame: unknown): void {
  child.stdin.write(`${JSON.stringify(frame)}\n`)
}

export async function executeCodeTool(
  record: CustomToolRecord & { type: 'code'; spec: CodeToolSpec },
  input: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const validatedInput = validateToolInput(record.inputSchema, input)
  const runnerPath = resolveRuntimeToolPath('custom-tool-worker-runner.mjs')
  if (runnerPath == null) {
    throw new CustomToolError('EXECUTION_FAILED', '代码工具 Worker Host 未打包或已损坏')
  }
  const nodePath = resolveStandaloneNode()
  const allowedTools = new Set(record.spec.permissions.toolIds)
  const startedAt = performance.now()
  const child = spawn(
    nodePath,
    [
      '--permission',
      `--allow-fs-read=${runnerPath}`,
      '--experimental-vm-modules',
      `--max-old-space-size=${record.spec.limits.memoryMb}`,
      runnerPath,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        NODE_NO_WARNINGS: '1',
        ...(process.platform === 'win32' && process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
    },
  )

  let stdoutBuffer = ''
  let stderr = ''
  let logs = ''
  let settled = false

  return await new Promise<ExecutorResult>((resolve, reject) => {
    const cleanup = (): void => {
      ctx.signal.removeEventListener('abort', abort)
      child.stdout.removeAllListeners()
      child.stderr.removeAllListeners()
      child.removeAllListeners()
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!child.killed) child.kill()
      reject(error)
    }
    const succeed = (frame: Extract<WorkerFrame, { type: 'result' }>): void => {
      if (settled) return
      settled = true
      cleanup()
      child.stdin.end()
      const text = serializeOutput(frame.output)
      resolve({
        text,
        meta: {
          durationMs: Math.max(0, performance.now() - startedAt),
          bytes: frame.bytes,
          truncated: false,
        },
      })
    }
    const abort = (): void => {
      fail(new CustomToolError('EXECUTION_FAILED', '代码工具执行已取消或超时'))
    }

    const handleFrame = async (frame: WorkerFrame): Promise<void> => {
      if (frame.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        fail(new CustomToolError('EXECUTION_FAILED', '代码工具 Worker 协议版本不兼容'))
        return
      }
      if (frame.type === 'log') {
        if (logs.length < MAX_LOG_BYTES) logs += `${frame.level}: ${frame.text}\n`
        return
      }
      if (frame.type === 'result') {
        succeed(frame)
        return
      }
      if (frame.type === 'error' || frame.type === 'fatal') {
        fail(
          new CustomToolError(
            'EXECUTION_FAILED',
            `${frame.message}${logs.trim().length > 0 ? `\nWorker 日志：\n${logs.trim()}` : ''}`,
          ),
        )
        return
      }
      if (frame.type !== 'broker_request') {
        fail(new CustomToolError('EXECUTION_FAILED', '代码工具 Worker 返回了未知协议帧'))
        return
      }
      if (frame.capability !== 'tools.call') {
        writeFrame(child, {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'broker_response',
          requestId: frame.requestId,
          ok: false,
          message: 'Unsupported worker capability',
        })
        return
      }
      if (!allowedTools.has(frame.toolId)) {
        writeFrame(child, {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'broker_response',
          requestId: frame.requestId,
          ok: false,
          message: `工具 ${frame.toolId} 未在代码工具权限白名单中`,
        })
        return
      }
      if (ctx.invokeTool == null) {
        writeFrame(child, {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'broker_response',
          requestId: frame.requestId,
          ok: false,
          message: '当前执行上下文不支持组合调用其他工具',
        })
        return
      }
      try {
        const output = await ctx.invokeTool(frame.toolId, asObject(frame.input))
        writeFrame(child, {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'broker_response',
          requestId: frame.requestId,
          ok: true,
          output,
        })
      } catch (error) {
        writeFrame(child, {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'broker_response',
          requestId: frame.requestId,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    ctx.signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => fail(new CustomToolError('EXECUTION_FAILED', error.message)))
    child.once('exit', (code, signal) => {
      if (settled) return
      fail(
        new CustomToolError(
          'EXECUTION_FAILED',
          `代码工具 Worker 异常退出（code=${String(code)}, signal=${String(signal)}）${
            stderr.trim().length > 0 ? `：${stderr.trim()}` : ''
          }`,
        ),
      )
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_LOG_BYTES) stderr += chunk.slice(0, MAX_LOG_BYTES - stderr.length)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      if (Buffer.byteLength(stdoutBuffer) > MAX_PROTOCOL_LINE_BYTES) {
        fail(new CustomToolError('EXECUTION_FAILED', '代码工具 Worker 协议帧超过大小上限'))
        return
      }
      let newline = stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line.trim().length > 0) {
          try {
            void handleFrame(JSON.parse(line) as WorkerFrame)
          } catch (error) {
            fail(
              new CustomToolError(
                'EXECUTION_FAILED',
                `代码工具 Worker 返回了无效协议帧：${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
            )
            return
          }
        }
        newline = stdoutBuffer.indexOf('\n')
      }
    })

    writeFrame(child, {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      type: 'invoke',
      requestId: `invoke:${record.id}`,
      toolId: record.id,
      source: record.spec.runtime.source,
      input: validatedInput,
      maxOutputBytes: record.spec.limits.maxOutputBytes,
    })
  })
}
