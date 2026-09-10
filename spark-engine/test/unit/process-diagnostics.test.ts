import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../src/tools/workspace/process.js'
import { ToolExecutionError } from '../../src/tools/execution-error.js'

describe('process failure diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retains a bounded prefix even when the first chunk exceeds the limit', async () => {
    const outcome = runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(10000))'],
      {
        cwd: process.cwd(),
        signal: new AbortController().signal,
        maxOutputBytes: 100,
      },
    )
    await expect(outcome).rejects.toMatchObject({
      output: 'x'.repeat(100),
      message: expect.stringContaining('100 bytes'),
    })
  })

  it('isolates output observer exceptions from process completion', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      cwd: process.cwd(),
      signal: new AbortController().signal,
      onOutput: () => {
        throw new Error('observer failed')
      },
    })
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' })
  })

  it('does not leak a POSIX process-group EPERM as an uncaught cleanup failure', async () => {
    if (process.platform === 'win32') return
    const originalKill = process.kill.bind(process)
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid < 0) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      }
      return originalKill(pid, signal)
    })
    const outcome = runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(10000))'],
      {
        cwd: process.cwd(),
        signal: new AbortController().signal,
        maxOutputBytes: 100,
      },
    )
    await expect(outcome).rejects.toMatchObject({
      output: 'x'.repeat(100),
      message: expect.stringContaining('100 bytes'),
    })
  })

  it('retains output when a process terminates from a signal', async () => {
    const outcome = runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("diagnostic", () => process.kill(process.pid, "SIGTERM"))'],
      {
        cwd: process.cwd(),
        signal: new AbortController().signal,
      },
    )
    await expect(outcome).rejects.toBeInstanceOf(ToolExecutionError)
    await expect(outcome).rejects.toMatchObject({ output: 'diagnostic' })
  })
})
