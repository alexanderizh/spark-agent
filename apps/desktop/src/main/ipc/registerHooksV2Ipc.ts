/**
 * Hook V2 IPC 注册（设计方案 §14）。
 *
 * 通道语义见 packages/protocol/src/hooks-v2.ts；管理逻辑集中在
 * agent-runtime 的 HookManagementService，这里只做薄接线。
 * 运行时依赖（数据库 + SessionService 访问器）由 ipc/index.ts 注入，
 * 避免与 ipc/index.ts 形成模块循环。
 */

import { HookManagementService } from '@spark/agent-runtime'
import type { HookSystemV2Deps } from '../hooks/hook-system-v2.js'
import { getHookSystemV2 } from '../hooks/hook-system-v2.js'
import { typedIpcHandle } from './typed-ipc.js'

export interface RegisterHooksV2IpcOptions {
  getDeps: () => HookSystemV2Deps
}

export function registerHooksV2Ipc(options: RegisterHooksV2IpcOptions): void {
  const resolveManagement = (): HookManagementService =>
    getHookSystemV2(options.getDeps()).management

  typedIpcHandle('hookV2:list-definitions', async (request) => ({
    definitions: resolveManagement().listDefinitions(request.eventName),
  }))

  typedIpcHandle('hookV2:create-definition', async (request) => ({
    definition: resolveManagement().createDefinition(request.definition),
  }))

  typedIpcHandle('hookV2:update-definition', async (request) => {
    const result = resolveManagement().updateDefinition(request.id, request.patch)
    return {
      definition: result.definition,
      invalidatedBindings: result.invalidatedBindings,
    }
  })

  typedIpcHandle('hookV2:delete-definition', async (request) =>
    resolveManagement().deleteDefinition(request.id),
  )

  typedIpcHandle('hookV2:validate-definition', async (request) =>
    resolveManagement().validateDefinition(request.definition),
  )

  typedIpcHandle('hookV2:list-bindings', async (request) => ({
    bindings: resolveManagement().listBindings(request),
  }))

  typedIpcHandle('hookV2:upsert-binding', async (request) => ({
    binding: resolveManagement().upsertBinding(request.binding),
  }))

  typedIpcHandle('hookV2:list-effective', async (request) => ({
    items: resolveManagement().listEffective(request.sessionId),
  }))

  typedIpcHandle('hookV2:list-runs', async (request) => ({
    runs: resolveManagement().listRuns(request),
  }))

  typedIpcHandle('hookV2:get-run', async (request) => ({
    run: resolveManagement().getRun(request.id),
  }))

  typedIpcHandle('hookV2:retry-run', async (request) => ({
    run: resolveManagement().retryRun(request.id),
  }))

  typedIpcHandle('hookV2:cancel-run', async (request) => ({
    run: resolveManagement().cancelPendingRun(request.id),
  }))

  typedIpcHandle('hookV2:get-system-status', async () => ({
    enabled: resolveManagement().getSystemEnabled(),
  }))

  typedIpcHandle('hookV2:set-enabled', async (request) => ({
    // 走运行时组装根：关闭时尽力取消运行中动作并暂停领取（设计方案 §10.1）。
    enabled: getHookSystemV2(options.getDeps()).setSystemEnabled(request.enabled),
  }))

  typedIpcHandle('hookV2:list-tool-candidates', async () => ({
    candidates: await getHookSystemV2(options.getDeps()).listToolCandidates(),
  }))

  typedIpcHandle('hookV2:preview', async (request) =>
    resolveManagement().preview(request.definition, request.sampleEnvelope),
  )
}
