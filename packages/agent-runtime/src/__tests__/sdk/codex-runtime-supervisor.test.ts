import { describe, expect, it, vi } from 'vitest'
import { CodexAppServerRuntimeSupervisor } from '../../sdk/codex-app-server/codex-runtime-supervisor.js'
import type { ManagedCodexRuntime } from '../../sdk/codex-app-server/codex-runtime-supervisor.js'
import {
  createCodexAppServerRuntimeFingerprint,
  createCodexAppServerThreadFingerprint,
} from '../../sdk/codex-app-server/codex-app-server-runtime.js'

class FakeRuntime implements ManagedCodexRuntime {
  hasExited = false
  readonly dispose = vi.fn(async () => undefined)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('CodexAppServerRuntimeSupervisor', () => {
  it('runtime fingerprint 稳定且不会包含环境秘密明文', () => {
    const first = createCodexAppServerRuntimeFingerprint({
      executablePath: '/runtime/codex',
      env: { Z_VAR: 'last', SECRET_TOKEN: 'do-not-log', A_VAR: 'first' },
    })
    const second = createCodexAppServerRuntimeFingerprint({
      executablePath: '/runtime/codex',
      env: { A_VAR: 'first', SECRET_TOKEN: 'do-not-log', Z_VAR: 'last' },
    })
    expect(first).toBe(second)
    expect(first).not.toContain('do-not-log')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('thread fingerprint 递归稳定且不会暴露 MCP 配置秘密', () => {
    const first = createCodexAppServerThreadFingerprint({
      cwd: '/workspace',
      model: 'gpt-test',
      config: {
        mcp_servers: {
          alpha: { env: { SECRET_TOKEN: 'do-not-persist' }, command: 'node' },
        },
        web_search: 'disabled',
      },
    })
    const second = createCodexAppServerThreadFingerprint({
      config: {
        web_search: 'disabled',
        mcp_servers: {
          alpha: { command: 'node', env: { SECRET_TOKEN: 'do-not-persist' } },
        },
      },
      model: 'gpt-test',
      cwd: '/workspace',
    })
    expect(first).toBe(second)
    expect(first).not.toContain('do-not-persist')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('thread fingerprint 忽略 turn 级权限，但保留 MCP 等会话隔离配置', () => {
    const fullAccess = createCodexAppServerThreadFingerprint({
      cwd: '/workspace',
      model: 'gpt-test',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      config: {
        approvals_reviewer: 'auto_review',
        sandbox_workspace_write: { network_access: true, writable_roots: ['/extra'] },
        mcp_servers: { alpha: { command: 'node' } },
      },
    })
    const onRequest = createCodexAppServerThreadFingerprint({
      cwd: '/workspace',
      model: 'gpt-test',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      config: {
        sandbox_workspace_write: { network_access: false },
        mcp_servers: { alpha: { command: 'node' } },
      },
    })
    const changedMcp = createCodexAppServerThreadFingerprint({
      cwd: '/workspace',
      model: 'gpt-test',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      config: {
        mcp_servers: { beta: { command: 'node' } },
      },
    })

    expect(fullAccess).toBe(onRequest)
    expect(changedMcp).not.toBe(onRequest)
  })

  it('同 session 的并发 acquire 合并启动，并在前一 lease release 后复用', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({ idleTtlMs: 60_000 })
    const gate = deferred<FakeRuntime>()
    const create = vi.fn(() => gate.promise)
    const firstPromise = supervisor.acquire('session-1', 'fp-1', create)
    const secondPromise = supervisor.acquire('session-1', 'fp-1', create)
    const runtime = new FakeRuntime()
    gate.resolve(runtime)

    const first = await firstPromise
    expect(first.warm).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
    let secondResolved = false
    void secondPromise.then(() => {
      secondResolved = true
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)

    await first.release()
    const second = await secondPromise
    expect(second.runtime).toBe(runtime)
    expect(second.warm).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    await second.release()
    await supervisor.dispose()
  })

  it('fingerprint 变化会销毁旧 runtime 并创建新实例', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({ idleTtlMs: 60_000 })
    const firstRuntime = new FakeRuntime()
    const first = await supervisor.acquire('session-1', 'fp-1', async () => firstRuntime)
    await first.release()
    const secondRuntime = new FakeRuntime()
    const second = await supervisor.acquire('session-1', 'fp-2', async () => secondRuntime)

    expect(firstRuntime.dispose).toHaveBeenCalledTimes(1)
    expect(second.runtime).toBe(secondRuntime)
    expect(second.warm).toBe(false)
    await second.release()
    await supervisor.dispose()
  })

  it('已退出 runtime 在下一次 acquire 时失效并重建', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({ idleTtlMs: 60_000 })
    const dead = new FakeRuntime()
    const first = await supervisor.acquire('session-1', 'fp-1', async () => dead)
    await first.release()
    dead.hasExited = true
    const replacement = new FakeRuntime()
    const second = await supervisor.acquire('session-1', 'fp-1', async () => replacement)
    expect(dead.dispose).toHaveBeenCalledTimes(1)
    expect(second.runtime).toBe(replacement)
    await second.release()
    await supervisor.dispose()
  })

  it('显式 invalidate 原子摘除并销毁 runtime', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({ idleTtlMs: 60_000 })
    const runtime = new FakeRuntime()
    const lease = await supervisor.acquire('session-1', 'fp-1', async () => runtime)
    await lease.release({ invalidate: true })
    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    expect(supervisor.activeRuntimeCount()).toBe(0)
    await supervisor.dispose()
  })

  it('TTL 到期回收 idle runtime', async () => {
    vi.useFakeTimers()
    try {
      const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({ idleTtlMs: 100 })
      const runtime = new FakeRuntime()
      const lease = await supervisor.acquire('session-1', 'fp-1', async () => runtime)
      await lease.release()
      await vi.advanceTimersByTimeAsync(100)
      expect(runtime.dispose).toHaveBeenCalledTimes(1)
      expect(supervisor.activeRuntimeCount()).toBe(0)
      await supervisor.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('超过上限时回收最久未使用的 idle runtime', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>({
      idleTtlMs: 60_000,
      maxRuntimes: 2,
    })
    const firstRuntime = new FakeRuntime()
    const secondRuntime = new FakeRuntime()
    const thirdRuntime = new FakeRuntime()
    const first = await supervisor.acquire('session-1', 'fp', async () => firstRuntime)
    await first.release()
    const second = await supervisor.acquire('session-2', 'fp', async () => secondRuntime)
    await second.release()
    const third = await supervisor.acquire('session-3', 'fp', async () => thirdRuntime)

    expect(firstRuntime.dispose).toHaveBeenCalledTimes(1)
    expect(secondRuntime.dispose).not.toHaveBeenCalled()
    await third.release()
    await supervisor.dispose()
  })

  it('启动失败不污染缓存，下一次 acquire 可重试', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>()
    await expect(
      supervisor.acquire('session-1', 'fp', async () => {
        throw new Error('spawn failed')
      }),
    ).rejects.toThrow('spawn failed')
    const runtime = new FakeRuntime()
    const lease = await supervisor.acquire('session-1', 'fp', async () => runtime)
    expect(lease.runtime).toBe(runtime)
    await lease.release()
    await supervisor.dispose()
  })

  it('dispose 关闭所有 runtime、唤醒 waiter，并拒绝后续 acquire', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor<FakeRuntime>()
    const runtime = new FakeRuntime()
    const lease = await supervisor.acquire('session-1', 'fp', async () => runtime)
    const waiting = supervisor.acquire('session-1', 'fp', async () => new FakeRuntime())
    await supervisor.dispose()

    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    await expect(waiting).rejects.toThrow('disposed')
    await expect(
      supervisor.acquire('session-2', 'fp', async () => new FakeRuntime()),
    ).rejects.toThrow('disposed')
    await lease.release()
  })
})
