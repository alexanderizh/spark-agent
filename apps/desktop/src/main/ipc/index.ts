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
import { dialog } from 'electron'
import { createLogger } from '@spark/shared'
import { ProviderProfileRepository, RulesRepository, WorkspaceRepository, PermissionProfileRepository, ModelProfileRepository, McpServerRepository, SkillRepository } from '@spark/storage'
import { ProviderService, RulesService, SessionService, WorkspaceService, PermissionService, ModelService, McpService, SkillService } from '@spark/agent-runtime'
import type { WorkspaceInfo } from '@spark/protocol'
import type { SessionEventHandler } from '@spark/agent-runtime'
import { getDatabase } from '../db.js'

const log = createLogger('ipc:register')

function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

function getModelService(): ModelService {
  return new ModelService(new ModelProfileRepository(getDatabase()))
}

function getMcpService(): McpService {
  return new McpService(new McpServerRepository(getDatabase()))
}

function getSkillService(): SkillService {
  return new SkillService(new SkillRepository(getDatabase()))
}

function getRulesService(): RulesService {
  return new RulesService(new RulesRepository(getDatabase()))
}

let _permissionService: PermissionService | null = null
function getPermissionService(): PermissionService {
  if (_permissionService == null) {
    _permissionService = new PermissionService(new PermissionProfileRepository(getDatabase()))
  }
  return _permissionService
}

let _workspaceService: WorkspaceService | null = null
function getWorkspaceService(): WorkspaceService {
  if (_workspaceService == null) {
    _workspaceService = new WorkspaceService(new WorkspaceRepository(getDatabase()))
  }
  return _workspaceService
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

  typedIpcHandle('workspace:open', async (req) => {
    const rootPath = req.rootPath ?? req.create?.rootPath
    if (rootPath == null) {
      throw new Error('workspace:open requires rootPath')
    }

    log.info(`workspace:open requested, rootPath=${rootPath}`)
    const workspace = await getWorkspaceService().openWorkspace(rootPath, req.create?.name)
    return {
      workspace: toWorkspaceInfo(workspace),
    }
  })

  typedIpcHandle('workspace:get-current', async (_req) => {
    log.info('workspace:get-current requested')
    const workspace = getWorkspaceService().getCurrent()
    return { workspace: workspace == null ? null : toWorkspaceInfo(workspace) }
  })

  typedIpcHandle('workspace:close', async (req) => {
    log.info(`workspace:close requested, workspaceId=${req.workspaceId}`)
    getWorkspaceService().closeWorkspace()
    return { closed: true }
  })

  typedIpcHandle('workspace:list-directory', async (req) => {
    log.info(`workspace:list-directory requested, workspaceId=${req.workspaceId}`)
    const entries = await getWorkspaceService().listDirectoryTree(req.workspaceId, {
      ...(req.path !== undefined && { path: req.path }),
      ...(req.maxDepth !== undefined && { maxDepth: req.maxDepth }),
    })
    return { entries }
  })

  // ─── Native Dialog Handlers ─────────────────────────────────────────────

  typedIpcHandle('dialog:open-directory', async (req) => {
    const result = await dialog.showOpenDialog({
      title: req.title ?? '选择工作区目录',
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath }),
      properties: ['openDirectory', 'createDirectory'],
    })

    return {
      canceled: result.canceled,
      ...(result.filePaths[0] === undefined ? {} : { filePath: result.filePaths[0] }),
    }
  })

  // ─── Rules Handlers ─────────────────────────────────────────────────────

  typedIpcHandle('rules:list', async (req) => {
    log.info(`rules:list requested, scope=${req.scope ?? 'all'}`)
    const rules = getRulesService().list(req)
    return { rules }
  })

  typedIpcHandle('rules:create', async (req) => {
    log.info(`rules:create requested, scope=${req.scope}, name=${req.name}`)
    const rule = getRulesService().create(req)
    return { rule }
  })

  typedIpcHandle('rules:update', async (req) => {
    log.info(`rules:update requested, id=${req.id}`)
    const rule = getRulesService().update(req.id, {
      ...(req.name !== undefined && { name: req.name }),
      ...(req.content !== undefined && { content: req.content }),
      ...(req.priority !== undefined && { priority: req.priority }),
      ...(req.enabled !== undefined && { enabled: req.enabled }),
    })
    return { rule }
  })

  typedIpcHandle('rules:delete', async (req) => {
    log.info(`rules:delete requested, id=${req.id}`)
    const success = getRulesService().delete(req.id)
    return { success }
  })

  // ─── Permission Handlers ────────────────────────────────────────────────────

  typedIpcHandle('permission:list-profiles', async (_req) => {
    return getPermissionService().listProfiles()
  })

  typedIpcHandle('permission:create-profile', async (req) => {
    const profile = getPermissionService().createProfile(req)
    return { profile }
  })

  typedIpcHandle('permission:delete-profile', async (req) => {
    const success = getPermissionService().deleteProfile(req.id)
    return { success }
  })

  typedIpcHandle('permission:update-sandbox', async (req) => {
    const profile = getPermissionService().updateSandbox(req.profileId, req.sandboxLevel)
    return { profile }
  })

  typedIpcHandle('permission:update-rule', async (req) => {
    const rule = getPermissionService().updateRule(req.profileId, req.action, req.mode)
    return { rule }
  })

  // ─── Model Handlers ─────────────────────────────────────────────────────────

  typedIpcHandle('model:list', async (req) => {
    const svc = getModelService()
    let models = svc.list(req.providerId !== undefined ? { providerId: req.providerId } : undefined)
    if (models.length === 0) {
      const providers = await getProviderService().listProviders()
      svc.seedDefaultModels(providers.map((p) => ({ id: p.id, provider: p.provider })))
      models = svc.list(req.providerId !== undefined ? { providerId: req.providerId } : undefined)
    }
    return { models }
  })

  typedIpcHandle('model:create', async (req) => {
    const model = getModelService().create(req)
    return { model }
  })

  typedIpcHandle('model:update', async (req) => {
    const { id, ...fields } = req
    const model = getModelService().update(id, fields)
    return { model }
  })

  typedIpcHandle('model:delete', async (req) => {
    const deleted = getModelService().delete(req.id)
    return { deleted }
  })

  // ─── MCP Handlers ───────────────────────────────────────────────────────────

  typedIpcHandle('mcp:list', async (req) => {
    const servers = getMcpService().listServers(req.scope !== undefined ? { scope: req.scope } : undefined)
    return { servers }
  })

  typedIpcHandle('mcp:create', async (req) => {
    const server = getMcpService().createServer(req)
    return { server }
  })

  typedIpcHandle('mcp:update', async (req) => {
    const { id, ...fields } = req
    const server = getMcpService().updateServer(id, fields)
    return { server }
  })

  typedIpcHandle('mcp:delete', async (req) => {
    const success = getMcpService().deleteServer(req.id)
    return { success }
  })

  // ─── Skill Handlers ─────────────────────────────────────────────────────────

  typedIpcHandle('skill:list', async (req) => {
    const svc = getSkillService()
    svc.ensureBuiltInSkills()
    const skills = svc.listSkills(req.scope !== undefined ? { scope: req.scope } : undefined)
    return { skills }
  })

  typedIpcHandle('skill:create', async (req) => {
    const skill = getSkillService().createSkill(req)
    return { skill }
  })

  typedIpcHandle('skill:update', async (req) => {
    const { id, ...fields } = req
    const skill = getSkillService().updateSkill(id, fields)
    return { skill }
  })

  typedIpcHandle('skill:delete', async (req) => {
    const success = getSkillService().deleteSkill(req.id)
    return { success }
  })

  log.info('All IPC handlers registered')
}

function toWorkspaceInfo(workspace: {
  id: string
  name: string
  root_path: string
  created_at: string
  updated_at: string
}): WorkspaceInfo {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.root_path,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
  }
}
