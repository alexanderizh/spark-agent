import { describe, expect, it } from 'vitest'
import { runProcess } from '../../src/tools/workspace/process.js'
import { ToolExecutionError } from '../../src/tools/execution-error.js'

describe('process failure diagnostics', () => {
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
