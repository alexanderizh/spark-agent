import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { CodexAppServerExecutor } from '../../sdk/codex-app-server/codex-app-server-executor.js'
import { CodexAppServerRuntimeSupervisor } from '../../sdk/codex-app-server/codex-runtime-supervisor.js'
import type { CodexNativeThreadBinding, SDKExecutorConfig } from '../../sdk/types.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url))

function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

describe('Codex App Server persistent runtime', () => {
  it('权限切换逐 turn 生效且复用 loaded thread，不重复注入备用历史', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-persistent-as-test-'))
    const scenarioPath = join(dir, 'scenario.json')
    const journalPath = join(dir, 'journal.log')
    await writeFile(
      scenarioPath,
      JSON.stringify({
        steps: [
          {
            kind: 'notify',
            method: 'item/completed',
            params: {
              threadId: 'fake-thread-1',
              turnId: 'server-turn-1',
              item: { type: 'agentMessage', id: 'message-1', text: 'done' },
            },
          },
        ],
      }),
      'utf8',
    )
    const supervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })
    const firstMetrics = vi.fn()
    const secondMetrics = vi.fn()
    let persistedBinding: CodexNativeThreadBinding | null = null
    const baseConfig: SDKExecutorConfig = {
      apiKey: 'test-key',
      model: 'gpt-test',
      permissionMode: 'codex-full-access',
      workspaceRootPath: process.cwd(),
      systemPrompt: 'stable runtime instructions',
      resumeFallbackSystemPrompt: 'RECOVERY_HISTORY_SHOULD_ONLY_APPEAR_ON_FRESH_THREAD',
      codexNativeThreadBindingKey: 'binding-persistent',
      codexNativeThreadBindingObserver: (binding) => {
        persistedBinding = binding
      },
    }
    const createExecutor = () =>
      new CodexAppServerExecutor({
        executablePath: process.execPath,
        args: [FIXTURE, scenarioPath, journalPath],
        env: spawnEnv(),
        handshakeTimeoutMs: 10_000,
        runtimeSupervisor: supervisor,
      })

    try {
      await createExecutor().executeTurn('session-persistent', 'spark-turn-1', 'first', {
        ...baseConfig,
        runtimeMetricsObserver: firstMetrics,
      })
      await createExecutor().executeTurn('session-persistent', 'spark-turn-2', 'second', {
        ...baseConfig,
        permissionMode: 'codex-default',
        ...(persistedBinding != null ? { codexNativeThreadBindings: [persistedBinding] } : {}),
        runtimeMetricsObserver: secondMetrics,
      })
      await supervisor.dispose()

      const journal = (await readFile(journalPath, 'utf8'))
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              kind: string
              method?: string
              params?: {
                input?: Array<{ text?: string }>
                approvalPolicy?: string
                approvalsReviewer?: string
                sandboxPolicy?: Record<string, unknown>
              }
            },
        )
      expect(journal.filter((entry) => entry.kind === 'started')).toHaveLength(1)
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'initialize'),
      ).toHaveLength(1)
      expect(
        journal.filter((entry) => entry.kind === 'notification' && entry.method === 'initialized'),
      ).toHaveLength(1)
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'thread/start'),
      ).toHaveLength(1)
      const turnStarts = journal.filter(
        (entry) => entry.kind === 'request' && entry.method === 'turn/start',
      )
      expect(turnStarts).toHaveLength(2)
      expect(turnStarts[0]?.params?.input?.[0]?.text).toContain(
        'RECOVERY_HISTORY_SHOULD_ONLY_APPEAR_ON_FRESH_THREAD',
      )
      expect(turnStarts[1]?.params?.input?.[0]?.text).not.toContain(
        'RECOVERY_HISTORY_SHOULD_ONLY_APPEAR_ON_FRESH_THREAD',
      )
      expect(turnStarts[0]?.params).toMatchObject({
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      })
      expect(turnStarts[1]?.params).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      })
      expect(persistedBinding).toMatchObject({
        bindingKey: 'binding-persistent',
        threadId: 'fake-thread-1',
      })
      expect(firstMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ appServerRuntimeWarm: false }),
      )
      expect(secondMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          appServerRuntimeWarm: true,
          appServerThreadMode: 'loaded',
        }),
      )
    } finally {
      await supervisor.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('进程重启后仅用匹配 fingerprint 的真实 thread id 执行 thread/resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-native-resume-test-'))
    const scenarioPath = join(dir, 'scenario.json')
    const journalPath = join(dir, 'journal.log')
    await writeFile(scenarioPath, JSON.stringify({ steps: [] }), 'utf8')
    let persistedBinding: CodexNativeThreadBinding | null = null
    const baseConfig: SDKExecutorConfig = {
      apiKey: 'test-key',
      model: 'gpt-test',
      permissionMode: 'codex-default',
      workspaceRootPath: process.cwd(),
      resumeFallbackSystemPrompt: 'RECOVERY_HISTORY_AFTER_RESTART',
      codexNativeThreadBindingKey: 'binding-restart',
      codexNativeThreadBindingObserver: (binding) => {
        persistedBinding = binding
      },
    }
    const createExecutor = (supervisor: CodexAppServerRuntimeSupervisor) =>
      new CodexAppServerExecutor({
        executablePath: process.execPath,
        args: [FIXTURE, scenarioPath, journalPath],
        env: spawnEnv(),
        handshakeTimeoutMs: 10_000,
        runtimeSupervisor: supervisor,
      })
    const firstSupervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })
    const secondSupervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })

    try {
      await createExecutor(firstSupervisor).executeTurn(
        'session-restart',
        'spark-turn-1',
        'first',
        baseConfig,
      )
      await firstSupervisor.dispose()
      expect(persistedBinding).not.toBeNull()
      await createExecutor(secondSupervisor).executeTurn(
        'session-restart',
        'spark-turn-2',
        'second',
        {
          ...baseConfig,
          ...(persistedBinding != null ? { codexNativeThreadBindings: [persistedBinding] } : {}),
        },
      )
      await secondSupervisor.dispose()

      const journal = (await readFile(journalPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string; method?: string; params?: unknown })
      expect(journal.filter((entry) => entry.kind === 'started')).toHaveLength(2)
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'thread/start'),
      ).toHaveLength(1)
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'thread/resume'),
      ).toHaveLength(1)
    } finally {
      await firstSupervisor.dispose()
      await secondSupervisor.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fingerprint 失配时不 resume 旧 thread，并在 fresh turn 注入备用历史', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-native-mismatch-test-'))
    const scenarioPath = join(dir, 'scenario.json')
    const journalPath = join(dir, 'journal.log')
    await writeFile(scenarioPath, JSON.stringify({ steps: [] }), 'utf8')
    const supervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })
    const mismatchedBinding: CodexNativeThreadBinding = {
      bindingKey: 'binding-mismatch',
      threadId: 'stale-thread',
      runtimeFingerprint: 'a'.repeat(64),
      threadFingerprint: 'b'.repeat(64),
    }
    const executor = new CodexAppServerExecutor({
      executablePath: process.execPath,
      args: [FIXTURE, scenarioPath, journalPath],
      env: spawnEnv(),
      handshakeTimeoutMs: 10_000,
      runtimeSupervisor: supervisor,
    })

    try {
      await executor.executeTurn('session-mismatch', 'spark-turn-1', 'fresh', {
        apiKey: 'test-key',
        model: 'gpt-test',
        permissionMode: 'codex-default',
        workspaceRootPath: process.cwd(),
        resumeFallbackSystemPrompt: 'RECOVERY_HISTORY_FOR_FRESH_THREAD',
        codexNativeThreadBindingKey: mismatchedBinding.bindingKey,
        codexNativeThreadBindings: [mismatchedBinding],
        codexNativeThreadBindingObserver: () => undefined,
      })
      await supervisor.dispose()

      const journal = (await readFile(journalPath, 'utf8'))
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              kind: string
              method?: string
              params?: { input?: Array<{ text?: string }> }
            },
        )
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'thread/resume'),
      ).toHaveLength(0)
      expect(
        journal.filter((entry) => entry.kind === 'request' && entry.method === 'thread/start'),
      ).toHaveLength(1)
      expect(
        journal.find((entry) => entry.kind === 'request' && entry.method === 'turn/start')?.params
          ?.input?.[0]?.text,
      ).toContain('RECOVERY_HISTORY_FOR_FRESH_THREAD')
    } finally {
      await supervisor.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('同一 Spark session 的 Host 与 Team member 使用独立 lease key，不互等同一 runtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-runtime-scope-test-'))
    const scenarioPath = join(dir, 'scenario.json')
    const journalPath = join(dir, 'journal.log')
    await writeFile(scenarioPath, JSON.stringify({ steps: [{ kind: 'delay', ms: 30 }] }), 'utf8')
    const supervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })
    const createExecutor = () =>
      new CodexAppServerExecutor({
        executablePath: process.execPath,
        args: [FIXTURE, scenarioPath, journalPath],
        env: spawnEnv(),
        handshakeTimeoutMs: 10_000,
        runtimeSupervisor: supervisor,
      })
    const baseConfig: SDKExecutorConfig = {
      apiKey: 'test-key',
      model: 'gpt-test',
      permissionMode: 'codex-default',
      workspaceRootPath: process.cwd(),
    }

    try {
      await Promise.all([
        createExecutor().executeTurn('shared-session', 'host-turn', 'host', {
          ...baseConfig,
          codexRuntimeLeaseKey: 'host:shared-session',
        }),
        createExecutor().executeTurn('shared-session', 'member-turn', 'member', {
          ...baseConfig,
          codexRuntimeLeaseKey: 'member:shared-session:member-1',
        }),
      ])
      await supervisor.dispose()
      const journal = (await readFile(journalPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string })
      expect(journal.filter((entry) => entry.kind === 'started')).toHaveLength(2)
    } finally {
      await supervisor.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
