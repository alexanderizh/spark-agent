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
import { dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '@spark/shared'
import { isCommand, parseCommand } from '@spark/agent-runtime'
import { EventRepository, ProviderProfileRepository, RulesRepository, SessionRepository, WorkspaceRepository, PermissionProfileRepository, ModelProfileRepository, McpServerRepository, SkillRepository } from '@spark/storage'
import { ProviderService, RulesService, SessionService, WorkspaceService, PermissionService, ModelService, McpService, SkillService, SkillRegistryService } from '@spark/agent-runtime'
import type { WorkspaceInfo } from '@spark/protocol'
import type { SessionEventHandler, ApprovalHandler } from '@spark/agent-runtime'
import { getDatabase } from '../db.js'

const log = createLogger('ipc:register')
const execFileAsync = promisify(execFile)

function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

function getModelService(): ModelService {
  return new ModelService(new ModelProfileRepository(getDatabase()))
}

let _mcpService: McpService | null = null
function getMcpService(): McpService {
  if (_mcpService == null) {
    _mcpService = new McpService(new McpServerRepository(getDatabase()))
  }
  return _mcpService
}

function getSkillService(): SkillService {
  return new SkillService(new SkillRepository(getDatabase()))
}

let _skillRegistryService: SkillRegistryService | null = null
function getSkillRegistryService(): SkillRegistryService {
  if (_skillRegistryService == null) {
    _skillRegistryService = new SkillRegistryService(getDatabase())
    _skillRegistryService.initialize()
  }
  return _skillRegistryService
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
    const onApproval: ApprovalHandler = (sessionId, toolName, toolInput) => {
      return getPermissionService().requestApproval(sessionId, toolName, toolInput, (req) => {
        pushStreamEvent('stream:permission:approval-request', req)
      })
    }
    const onApprovalCancel = (sessionId: string) => {
      getPermissionService().cancelPendingApprovals(sessionId)
    }
    _sessionService = new SessionService(getDatabase(), onEvent, onApproval, onApprovalCancel)
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

  typedIpcHandle('session:search', async (req) => {
    log.info(`session:search requested, query="${req.query}"`)
    return getSessionService().searchSessions(req)
  })

  typedIpcHandle('session:update', async (req) => {
    log.info(`session:update requested, sessionId=${req.sessionId}`)
    return getSessionService().updateSession(req)
  })

  typedIpcHandle('session:delete', async (req) => {
    log.info(`session:delete requested, sessionId=${req.sessionId}`)
    return getSessionService().deleteSession(req.sessionId)
  })

  typedIpcHandle('session:set-max-iterations', async (req) => {
    log.info(`session:set-max-iterations sessionId=${req.sessionId} max=${req.maxIterations}`)
    getSessionService().setMaxIterations(req.sessionId, req.maxIterations)
    return { applied: req.maxIterations }
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
    const workspace = await getWorkspaceService().openWorkspace(rootPath, req.create?.name, {
      create: req.create != null,
    })
    return {
      workspace: toWorkspaceInfo(workspace),
    }
  })

  typedIpcHandle('workspace:get-current', async (_req) => {
    log.info('workspace:get-current requested')
    const workspace = getWorkspaceService().getCurrent()
    return { workspace: workspace == null ? null : toWorkspaceInfo(workspace) }
  })

  typedIpcHandle('workspace:list', async (req) => {
    log.info('workspace:list requested')
    const service = getWorkspaceService()
    const listParams = req.includeArchived === undefined ? {} : { includeArchived: req.includeArchived }
    return {
      workspaces: service.listWorkspaces(req.limit, req.offset, listParams).map(toWorkspaceInfo),
      total: service.countWorkspaces(listParams),
    }
  })

  typedIpcHandle('workspace:update', async (req) => {
    log.info(`workspace:update requested, workspaceId=${req.workspaceId}`)
    const workspace = getWorkspaceService().updateWorkspace(req.workspaceId, {
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.pinned !== undefined ? { pinnedAt: req.pinned ? new Date().toISOString() : null } : {}),
      ...(req.archived !== undefined ? { archivedAt: req.archived ? new Date().toISOString() : null } : {}),
    })
    return { workspace: toWorkspaceInfo(workspace) }
  })

  typedIpcHandle('workspace:delete', async (req) => {
    log.info(`workspace:delete requested, workspaceId=${req.workspaceId}`)
    const sessionRepo = new SessionRepository(getDatabase())
    const eventRepo = new EventRepository(getDatabase())
    const deletedSessionIds = sessionRepo.deleteByWorkspaceId(req.workspaceId)
    for (const sessionId of deletedSessionIds) {
      eventRepo.deleteBySession(sessionId)
    }
    const deleted = getWorkspaceService().deleteWorkspace(req.workspaceId)
    return { deleted, deletedSessionIds }
  })

  typedIpcHandle('workspace:open-folder', async (req) => {
    log.info(`workspace:open-folder requested, workspaceId=${req.workspaceId}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    shell.showItemInFolder(workspace.root_path)
    return { opened: true }
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

  typedIpcHandle('workspace:list-branches', async (req) => {
    log.info(`workspace:list-branches requested, workspaceId=${req.workspaceId}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    return getWorkspaceBranches(workspace.root_path)
  })

  typedIpcHandle('workspace:switch-branch', async (req) => {
    log.info(`workspace:switch-branch requested, workspaceId=${req.workspaceId}, branch=${req.branch}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    await execFileAsync('git', ['switch', req.branch], { cwd: workspace.root_path })
    const result = await getWorkspaceBranches(workspace.root_path)
    if (result.currentBranch == null) {
      throw new Error('Unable to determine current git branch after switch')
    }
    return { currentBranch: result.currentBranch, branches: result.branches }
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

  typedIpcHandle('permission:approval-respond', async (req) => {
    const ok = getPermissionService().resolveApproval(req.requestId, req.decision)
    return { ok }
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

  typedIpcHandle('mcp:start-server', async (req) => {
    log.info(`mcp:start-server requested, serverId=${req.serverId}`)
    await getMcpService().startServer(req.serverId)
    const status = getMcpService().getServerStatus(req.serverId)
    return { started: true, toolCount: status.toolCount }
  })

  typedIpcHandle('mcp:stop-server', async (req) => {
    log.info(`mcp:stop-server requested, serverId=${req.serverId}`)
    await getMcpService().stopServer(req.serverId)
    return { stopped: true }
  })

  typedIpcHandle('mcp:server-status', async (req) => {
    log.info(`mcp:server-status requested, serverId=${req.serverId}`)
    const status = getMcpService().getServerStatus(req.serverId)
    return status
  })

  typedIpcHandle('mcp:server-tools', async (req) => {
    log.info(`mcp:server-tools requested, serverId=${req.serverId}`)
    const tools = getMcpService().getServerTools(req.serverId)
    return { tools }
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

  typedIpcHandle('skill:detail', async (req) => {
    const detail = getSkillService().getSkillDetail(req.id)
    return { detail }
  })

  typedIpcHandle('skill:toggle', async (req) => {
    const skill = getSkillService().toggleSkill(req.id)
    return { skill }
  })

  typedIpcHandle('skill:search', async (req) => {
    const skills = getSkillService().searchSkills(req.query)
    return { skills }
  })

  typedIpcHandle('skill:execute', async (req) => {
    const svc = getSkillService()
    const systemPrompt = svc.buildSkillSystemPrompt(req.skillId, req.params ?? {})
    if (!systemPrompt) throw new Error(`Skill not found: ${req.skillId}`)
    const requiredTools = svc.getLoader().getRequiredTools(req.skillId)
    return { systemPrompt, requiredTools }
  })

  // ─── Skill Registry Handlers (Skill Store) ─────────────────────────────

  typedIpcHandle('skill-registry:list', async (_req) => {
    const registries = getSkillRegistryService().listRegistries()
    return { registries }
  })

  typedIpcHandle('skill-registry:update', async (req) => {
    log.info(`skill-registry:update requested, id=${req.id}`)
    const fields: { enabled?: boolean; configJson?: string } = {}
    if (req.enabled !== undefined) fields.enabled = req.enabled
    if (req.configJson !== undefined) fields.configJson = req.configJson
    const registry = getSkillRegistryService().updateRegistry(req.id, fields)
    return { registry }
  })

  typedIpcHandle('skill-registry:search', async (req) => {
    log.info(`skill-registry:search requested, query="${req.query}", registryId=${req.registryId ?? 'all'}`)
    return getSkillRegistryService().search(req)
  })

  typedIpcHandle('skill-registry:featured', async (req) => {
    log.info(`skill-registry:featured requested, registryId=${req.registryId ?? 'all'}`)
    const skills = await getSkillRegistryService().featured(req)
    return { skills }
  })

  typedIpcHandle('skill-registry:install', async (req) => {
    log.info(`skill-registry:install requested, remoteSkillId=${req.remoteSkillId}, registryId=${req.registryId}`)
    const skill = await getSkillRegistryService().install(req)
    return { skill }
  })

  typedIpcHandle('skill-registry:uninstall', async (req) => {
    log.info(`skill-registry:uninstall requested, localSkillId=${req.localSkillId}`)
    const success = getSkillRegistryService().uninstall(req.localSkillId)
    return { success }
  })

  typedIpcHandle('skill-registry:categories', async (req) => {
    log.info(`skill-registry:categories requested, registryId=${req.registryId}`)
    const categories = await getSkillRegistryService().categories(req.registryId)
    return { categories }
  })

  typedIpcHandle('skill:import-file', async (_req) => {
    // TODO: T-12 Skill 包导入/导出
    throw new Error('Not implemented yet: skill:import-file')
  })

  typedIpcHandle('skill:import-directory', async (_req) => {
    // TODO: T-12 Skill 包导入/导出
    throw new Error('Not implemented yet: skill:import-directory')
  })

  typedIpcHandle('skill:export', async (_req) => {
    // TODO: T-12 Skill 包导入/导出
    throw new Error('Not implemented yet: skill:export')
  })

  typedIpcHandle('skill:export-batch', async (_req) => {
    // TODO: T-12 Skill 包导入/导出
    throw new Error('Not implemented yet: skill:export-batch')
  })

  // ─── Command Handlers ───────────────────────────────────────────────────────

  typedIpcHandle('command:execute', async (req) => {
    log.info(`command:execute requested, sessionId=${req.sessionId}, message=${req.message}`)
    const cmdResult = await getSessionService().executeCommand({ sessionId: req.sessionId, message: req.message })
    if (!cmdResult.isCommand) {
      return { success: false, message: '输入不是有效的斜杠命令' }
    }
    return cmdResult.result
  })

  typedIpcHandle('command:list', async (_req) => {
    const commands = getSessionService().listCommands()
    return { commands }
  })

  typedIpcHandle('command:parse', async (req) => {
    if (!isCommand(req.message)) return { isCommand: false }
    const parsed = parseCommand(req.message)
    if (parsed == null) return { isCommand: false }
    return { isCommand: true, name: parsed.name, args: parsed.args, flags: parsed.flags }
  })

  log.info('All IPC handlers registered')
}

function toWorkspaceInfo(workspace: {
  id: string
  name: string
  root_path: string
  created_at: string
  updated_at: string
  pinned_at: string | null
  archived_at: string | null
}): WorkspaceInfo {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.root_path,
    pinnedAt: workspace.pinned_at,
    archivedAt: workspace.archived_at,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
  }
}

async function getWorkspaceBranches(rootPath: string): Promise<{ currentBranch: string | null; branches: string[] }> {
  try {
    const [current, branches] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: rootPath }),
      execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: rootPath }),
    ])
    const branchList = branches.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    const currentBranch = current.stdout.trim() || branchList[0] || null
    return { currentBranch, branches: branchList }
  } catch {
    return { currentBranch: null, branches: [] }
  }
}
