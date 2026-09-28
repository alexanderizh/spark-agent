import { spawn, type ChildProcess } from 'node:child_process'

const isWin = process.platform === 'win32'

export interface CliProbeResult {
  stdout: string
  stderr: string
}

/**
 * CLI 探测专用子进程运行器。
 *
 * 为什么不用 exec/execFile：Node 的 `timeout` 只 kill 直接子进程。Windows 上
 * `claude.cmd` 这类 npm shim 会派生 node 孙进程；超时杀掉 cmd.exe 后，孙进程
 * 仍然握着继承的 stdio 管道，'close' 事件永远不触发，promisify(exec) 的
 * promise 永不 settle —— provider:list 会被永久挂起，渲染端表现为
 * 「正在加载 Provider…」无限转圈。
 *
 * 这里改用 spawn + 显式超时，并做两层加固：
 * - Windows 用 `taskkill /T /F` 杀整棵进程树，其他平台直接 kill；
 * - 监听 'exit'（而非 'close'）完成 settle，即使 stdio 管道仍被残留的
 *   孙进程占用，也能按时返回。
 */
export function runCliProbe(
  command: string[],
  timeoutMs: number,
  options: { windowsVerbatimArguments?: boolean } = {},
): Promise<CliProbeResult> {
  return new Promise<CliProbeResult>((resolve, reject) => {
    const file = command[0]
    if (file == null || file.length === 0) {
      reject(new Error('cli-probe: empty command'))
      return
    }
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(file, command.slice(1), {
      windowsHide: true,
      ...(options.windowsVerbatimArguments === true && { windowsVerbatimArguments: true }),
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProcessTree(child)
      reject(new Error(`cli-probe: timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`cli-probe: exited with code ${code ?? 'null'}`))
      }
    })
  })
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid == null) return
  if (isWin) {
    // /T 连同子孙进程整棵杀掉；taskkill 对已退出的进程会失败，此时兜底 kill()。
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    })
    killer.on('error', () => {
      child.kill()
    })
  } else {
    child.kill('SIGKILL')
  }
}

/**
 * 给任意 promise 加整体死线：超时后以 rejection 收场，保证调用方必定 settle。
 * 用于 provider:list 的 CLI 探测兜底——任何预料之外的挂起都不允许把 IPC
 * 永久卡死。
 */
export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}: deadline of ${timeoutMs}ms exceeded`))
    }, timeoutMs)
  })
  return Promise.race([
    promise.finally(() => {
      if (timer != null) clearTimeout(timer)
    }),
    deadline,
  ])
}
