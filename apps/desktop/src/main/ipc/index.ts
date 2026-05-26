/**
 * IPC Handlers 注册入口
 *
 * 将所有 IPC channel handlers 注册到 ipcMain
 * 在应用启动时（main/index.ts）调用 registerAllIpcHandlers()
 *
 * 每个 handler 通过 typedIpcHandle() 注册，自动获得：
 *   - 类型安全的 request/response
 *   - zod schema 校验
 *   - 统一错误处理
 */

import { typedIpcHandle } from './typed-ipc.js'
import { createLogger } from '@spark/shared'
import type { SessionId } from '@spark/protocol'

/** 生成 branded SessionId */
function newSessionId(): SessionId {
  return crypto.randomUUID() as SessionId
}

const log = createLogger('ipc:register')

/**
 * 注册所有 IPC handlers
 *
 * 在 main/index.ts 的 initializeApp() 中调用
 *
 * 当前已注册的 handlers：
 *   - session:* — 会话管理（P1-07 实现）
 *   - provider:* — Provider 配置（P1-09 实现）
 *   - workspace:* — 工作区管理（P2-01 实现）
 */
export function registerAllIpcHandlers(): void {
  log.info('Registering IPC handlers...')

  // ─── Session Handlers ──────────────────────────────────────────────────
  // P1-07 完整实现，当前为骨架

  typedIpcHandle('session:create', async (req) => {
    // TODO: 调用 SessionService.create()
    log.info(`session:create requested, providerProfileId=${req.providerProfileId}`)
    return {
      sessionId: newSessionId(),
      createdAt: new Date().toISOString(),
    }
  })

  typedIpcHandle('session:send-turn', async (req) => {
    // TODO: 调用 SessionService.sendTurn()
    log.info(`session:send-turn requested, sessionId=${req.sessionId}`)
    return {
      turnId: crypto.randomUUID(),
      started: true,
    }
  })

  typedIpcHandle('session:cancel', async (req) => {
    // TODO: 调用 SessionService.cancel()
    log.info(`session:cancel requested, sessionId=${req.sessionId}`)
    return { cancelled: true }
  })

  typedIpcHandle('session:get-history', async (req) => {
    // TODO: 调用 SessionEventStore.query()
    log.info(`session:get-history requested, sessionId=${req.sessionId}`)
    return { events: [], hasMore: false }
  })

  typedIpcHandle('session:list', async (_req) => {
    // TODO: 调用 SessionService.list()
    log.info('session:list requested')
    return { sessions: [], total: 0 }
  })

  // ─── Provider Handlers ─────────────────────────────────────────────────
  // P1-09 完整实现，当前为骨架

  typedIpcHandle('provider:list', async (_req) => {
    // TODO: 调用 ProviderService.list()
    log.info('provider:list requested')
    return { profiles: [] }
  })

  typedIpcHandle('provider:create', async (req) => {
    // TODO: 调用 ProviderService.create()
    // 注意：req.apiKey 在此处为明文，需立即存入 Keychain
    log.info(`provider:create requested, provider=${req.provider}, name=${req.name}`)
    return {
      profile: {
        id: crypto.randomUUID(),
        name: req.name,
        provider: req.provider,
        model: req.model,
        keystoreRef: `${req.provider}-${crypto.randomUUID()}`,
        isDefault: req.isDefault ?? false,
        createdAt: new Date().toISOString(),
      },
    }
  })

  typedIpcHandle('provider:update', async (req) => {
    // TODO: 调用 ProviderService.update()
    log.info(`provider:update requested, id=${req.id}`)
    return {
      profile: {
        id: req.id,
        name: req.name ?? 'Updated Profile',
        provider: 'unknown',
        model: req.model ?? 'unknown',
        keystoreRef: `ref-${req.id}`,
        isDefault: req.isDefault ?? false,
        createdAt: new Date().toISOString(),
      },
    }
  })

  typedIpcHandle('provider:delete', async (req) => {
    // TODO: 调用 ProviderService.delete()
    log.info(`provider:delete requested, id=${req.id}`)
    return { deleted: true }
  })

  typedIpcHandle('provider:health-check', async (req) => {
    // TODO: 调用 ProviderService.healthCheck()
    log.info(`provider:health-check requested, id=${req.id}`)
    return { healthy: true }
  })

  // ─── Workspace Handlers ────────────────────────────────────────────────
  // P2-01 完整实现，当前为骨架

  typedIpcHandle('workspace:open', async (req) => {
    // TODO: 调用 WorkspaceService.open()
    log.info(`workspace:open requested, rootPath=${req.rootPath ?? 'new'}`)
    return {
      workspace: {
        id: crypto.randomUUID(),
        name: 'New Workspace',
        rootPath: req.rootPath ?? '/tmp/workspace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  })

  typedIpcHandle('workspace:get-current', async (_req) => {
    // TODO: 调用 WorkspaceService.getCurrent()
    log.info('workspace:get-current requested')
    return { workspace: null }
  })

  typedIpcHandle('workspace:close', async (req) => {
    // TODO: 调用 WorkspaceService.close()
    log.info(`workspace:close requested, workspaceId=${req.workspaceId}`)
    return { closed: true }
  })

  log.info('All IPC handlers registered')
}
