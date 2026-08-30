import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { StdioTransport } from '../../mcp/transport/stdio-transport.js'

describe('StdioTransport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not access a cleared process from the delayed force-kill callback', async () => {
    vi.useFakeTimers()

    const kill = vi.fn().mockReturnValue(true)
    const childProcess = {
      killed: false,
      stdin: { end: vi.fn() },
      kill,
    } as unknown as ChildProcess
    const transport = new StdioTransport({
      type: 'stdio',
      command: 'unused',
      args: [],
    })

    ;(transport as unknown as { process: ChildProcess | null }).process = childProcess

    await transport.disconnect()

    expect(() => vi.advanceTimersByTime(3000)).not.toThrow()
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })
})
