import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const MAX_BUFFERED_BYTES = 200_000  // 每路最多缓存这么多字节，超出则环形丢弃旧数据
const MAX_RETURN_BYTES = 50_000

interface BackgroundTask {
  id: string
  command: string
  cwd: string
  proc: ChildProcess
  startedAt: number
  stoppedAt: number | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  /** stdout 环形缓冲（仅保留最后 MAX_BUFFERED_BYTES 字节） */
  stdoutBuf: string
  stdoutBytes: number
  /** stderr 同上 */
  stderrBuf: string
  stderrBytes: number
  /** 用于 monitor 增量读取的游标 */
  stdoutReadOffset: number
  stderrReadOffset: number
}

const tasks = new Map<string, BackgroundTask>()

/** 启动一个后台任务，返回 task_id（由 bash 工具在 runInBackground: true 时调用） */
export function startBackgroundTask(command: string, cwd: string): { id: string } {
  const id = randomUUID()
  const proc = spawn('bash', ['-c', command], {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    uid: undefined,
    gid: undefined,
    detached: false,
  })

  const task: BackgroundTask = {
    id,
    command,
    cwd,
    proc,
    startedAt: Date.now(),
    stoppedAt: null,
    exitCode: null,
    signal: null,
    stdoutBuf: '',
    stdoutBytes: 0,
    stderrBuf: '',
    stderrBytes: 0,
    stdoutReadOffset: 0,
    stderrReadOffset: 0,
  }

  proc.stdout?.on('data', (chunk: Buffer) => appendBuf(task, 'stdout', chunk.toString('utf-8')))
  proc.stderr?.on('data', (chunk: Buffer) => appendBuf(task, 'stderr', chunk.toString('utf-8')))
  proc.on('close', (code, signal) => {
    task.stoppedAt = Date.now()
    task.exitCode = code
    task.signal = signal
  })
  proc.on('error', (err) => {
    task.stoppedAt = Date.now()
    task.exitCode = -1
    appendBuf(task, 'stderr', `[spawn error] ${err.message}\n`)
  })

  tasks.set(id, task)
  return { id }
}

function appendBuf(task: BackgroundTask, stream: 'stdout' | 'stderr', data: string): void {
  if (stream === 'stdout') {
    task.stdoutBuf += data
    task.stdoutBytes += data.length
    if (task.stdoutBuf.length > MAX_BUFFERED_BYTES) {
      const drop = task.stdoutBuf.length - MAX_BUFFERED_BYTES
      task.stdoutBuf = task.stdoutBuf.slice(drop)
      task.stdoutReadOffset = Math.max(0, task.stdoutReadOffset - drop)
    }
  } else {
    task.stderrBuf += data
    task.stderrBytes += data.length
    if (task.stderrBuf.length > MAX_BUFFERED_BYTES) {
      const drop = task.stderrBuf.length - MAX_BUFFERED_BYTES
      task.stderrBuf = task.stderrBuf.slice(drop)
      task.stderrReadOffset = Math.max(0, task.stderrReadOffset - drop)
    }
  }
}

export function listBackgroundTasks(): Array<{ id: string; command: string; running: boolean; exitCode: number | null; uptimeMs: number }> {
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    command: t.command,
    running: t.stoppedAt == null,
    exitCode: t.exitCode,
    uptimeMs: (t.stoppedAt ?? Date.now()) - t.startedAt,
  }))
}

export function stopBackgroundTask(id: string, signal: NodeJS.Signals = 'SIGTERM'): { stopped: boolean; reason?: string } {
  const task = tasks.get(id)
  if (task == null) return { stopped: false, reason: 'task not found' }
  if (task.stoppedAt != null) return { stopped: false, reason: 'task already exited' }
  try {
    task.proc.kill(signal)
    return { stopped: true }
  } catch (err) {
    return { stopped: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * monitor — Read incremental output from a background task.
 */
export const monitorTool: RegisteredTool = {
  definition: {
    name: 'monitor',
    description:
      'Read the latest output (since last monitor call) from a background task started by bash with runInBackground:true. ' +
      'Also returns running/exit status. Use action:"stop" to terminate the task, action:"list" to enumerate all tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'stop', 'list'], description: 'Default "read"' },
        taskId: { type: 'string', description: 'Required for read/stop' },
        signal: { type: 'string', description: 'Signal to send when stopping (default SIGTERM)' },
      },
    },
  },
  async execute(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const action = (input['action'] as string | undefined) ?? 'read'

    if (action === 'list') {
      return { status: 'success', output: { tasks: listBackgroundTasks() }, durationMs: Date.now() - start }
    }

    const taskId = String(input['taskId'] ?? '')
    if (taskId.length === 0) {
      return { status: 'error', error: 'taskId is required for action=' + action, durationMs: Date.now() - start }
    }

    if (action === 'stop') {
      const signal = (input['signal'] as NodeJS.Signals | undefined) ?? 'SIGTERM'
      const res = stopBackgroundTask(taskId, signal)
      if (!res.stopped) return { status: 'error', error: res.reason ?? 'failed to stop', durationMs: Date.now() - start }
      return { status: 'success', output: { stopped: true, signal }, durationMs: Date.now() - start }
    }

    // action === 'read'
    const task = tasks.get(taskId)
    if (task == null) {
      return { status: 'error', error: 'task not found', durationMs: Date.now() - start }
    }

    const stdoutDelta = task.stdoutBuf.slice(task.stdoutReadOffset)
    const stderrDelta = task.stderrBuf.slice(task.stderrReadOffset)
    task.stdoutReadOffset = task.stdoutBuf.length
    task.stderrReadOffset = task.stderrBuf.length

    const truncate = (s: string) => s.length > MAX_RETURN_BYTES ? s.slice(s.length - MAX_RETURN_BYTES) + '\n...<truncated head>' : s

    return {
      status: 'success',
      output: {
        taskId,
        running: task.stoppedAt == null,
        exitCode: task.exitCode,
        signal: task.signal,
        uptimeMs: (task.stoppedAt ?? Date.now()) - task.startedAt,
        stdout: truncate(stdoutDelta),
        stderr: truncate(stderrDelta),
        totalBytes: { stdout: task.stdoutBytes, stderr: task.stderrBytes },
      },
      durationMs: Date.now() - start,
    }
  },
}
