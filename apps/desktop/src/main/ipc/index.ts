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

import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'
import { createLogger } from '@spark/shared'
import { ProviderProfileRepository } from '@spark/storage'
import { ProviderService, SessionService } from '@spark/agent-runtime'
import type { SessionEventHandler } from '@spark/agent-runtime'
import { getDatabase } from '../db.js'

const log = createLogger('ipc:register')

function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

let _sessionService: SessionService | null = null
function getSessionService(): SessionService {
  if (_sessionService == null) {
    const onEvent: SessionEventHandler = (event) => {
      pushStreamEvent('stream:session:agent-event', event)
    }
    _sessionService = new SessionService(getDatabase(), onEvent)
  }
  return _sessionService
}

export function registerAllIpcHandlers(): void {
  log.info('Registering IPC handlers...')

  // ─── Session Handlers ──────────────────────────────────────────────────

  typedIpcHandle('session:create', async (req) => {
    log.info(`session:create requested, providerProfileId=${req.providerProfileId}`)
    return getSessionService().createSession(req)
  })

  typedIpcHandle('session:send-turn', async (req) => {
    log.info(`session:send-turn requested, sessionId=${req.sessionId}`)
    return getSessionService().sendTurn({ sessionId: req.sessionId, message: req.message })
  })

  typedIpcHandle('session:cancel', async (req) => {
    log.info(`session:cancel requested, sessionId=${req.sessionId}`)
    return getSessionService().cancelTurn(req.sessionId)
  })

  typedIpcHandle('session:get-history', async (req) => {
    log.info(`session:get-history requested, sessionId=${req.sessionId}`)
    return getSessionService().getHistory(req)
  })

  typedIpcHandle('session:list', async (req) => {
    log.info('session:list requested')
    return getSessionService().listSessions(req)
  })

  // ─── Provider Handlers ─────────────────────────────────────────────────
  // P1-09 完整实现，当前为骨架

  typedIpcHandle('provider:list', async (_req) => {
    const profiles = await getProviderService().listProviders()
    return { profiles }
  })

  typedIpcHandle('provider:create', async (req) => {
    log.info(`provider:create requested, provider=${req.provider}, name=${req.name}`)
    const profile = await getProviderService().createProvider(req)
    return { profile }
  })

  typedIpcHandle('provider:update', async (req) => {
    log.info(`provider:update requested, id=${req.id}`)
    const profile = await getProviderService().updateProvider(req)
    return { profile }
  })

  typedIpcHandle('provider:delete', async (req) => {
    log.info(`provider:delete requested, id=${req.id}`)
    await getProviderService().deleteProvider(req.id)
    return { deleted: true }
  })

  typedIpcHandle('provider:health-check', async (req) => {
    log.info(`provider:health-check requested, id=${req.id}`)
    return getProviderService().healthCheck(req.id)
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
