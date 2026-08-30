import type { CodexRuntimeRestartResult, CodexRuntimeSupervisorDiagnostics } from '@spark/protocol'
import { persistentCodexRuntimePolicy } from '@spark/agent-runtime'
import { typedIpcHandle } from './typed-ipc.js'

export interface CodexRuntimeDiagnosticsBackend {
  getDiagnostics(): Promise<CodexRuntimeSupervisorDiagnostics | null>
  restartIdle(): Promise<CodexRuntimeRestartResult | null>
}

export function registerCodexRuntimeIpc(backend: CodexRuntimeDiagnosticsBackend): void {
  typedIpcHandle('codex-runtime:diagnostics', async () => {
    const policy = persistentCodexRuntimePolicy()
    return {
      ...policy,
      diagnostics: policy.enabled ? await backend.getDiagnostics() : null,
    }
  })

  typedIpcHandle('codex-runtime:restart-idle', async () => {
    const policy = persistentCodexRuntimePolicy()
    return {
      enabled: policy.enabled,
      result: policy.enabled ? await backend.restartIdle() : null,
    }
  })
}
