import { describe, expect, it, vi } from 'vitest'
import { CodexAppServerClient } from '../../sdk/codex-app-server/codex-app-server-client.js'

describe('CodexAppServerClient process lifecycle', () => {
  it('spawn error 立即标记 transport exited，dispose 不再进入 2 秒等待', async () => {
    const onExit = vi.fn()
    const client = CodexAppServerClient.spawn({
      executablePath: '/spark-tests/missing-codex-app-server-binary',
      onNotification: vi.fn(),
      onServerRequest: vi.fn(),
      onExit,
    })

    await expect(client.waitUntilSpawned(1_000)).rejects.toThrow()
    expect(client.hasExited).toBe(true)
    expect(client.exitedCode()).toEqual({ code: null, signal: null })
    expect(onExit).toHaveBeenCalledTimes(1)
    await client.dispose()
  })
})
