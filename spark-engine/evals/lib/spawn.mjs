import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'

const OUTPUT_CAP = 2_000_000

/**
 * Runs a command and captures bounded stdout/stderr.
 * On POSIX the child is a process-group leader so a timeout kills the group.
 */
export function runCommand(command, args, options) {
  const timeoutMs = options.timeoutMs ?? 30_000
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let truncated = false
    const take = (chunk, target) => {
      const text = chunk.toString('utf8')
      if (target === 'stdout') {
        if (stdout.length < OUTPUT_CAP) stdout += text.slice(0, OUTPUT_CAP - stdout.length)
      } else if (stderr.length < OUTPUT_CAP) {
        stderr += text.slice(0, OUTPUT_CAP - stderr.length)
      }
      if (stdout.length >= OUTPUT_CAP || stderr.length >= OUTPUT_CAP) truncated = true
    }
    child.stdout.on('data', (chunk) => take(chunk, 'stdout'))
    child.stderr.on('data', (chunk) => take(chunk, 'stderr'))
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      killChild(child)
    }, timeoutMs)
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        stdout,
        stderr: error ? `${stderr}${error.message}\n` : stderr,
        timedOut,
        truncated,
      })
    }
    child.on('error', (error) => finish(1, error))
    child.on('close', (code) => finish(code ?? 1))
  })
}

function killChild(child) {
  if (child.pid === undefined) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // The process already exited between the timeout and the signal.
    }
  }
}
