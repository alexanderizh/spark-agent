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
import { app, dialog, shell, Notification } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createLogger, deriveTeamAvatar } from '@spark/shared'
import { isCommand, parseCommand } from '@spark/agent-runtime'
import {
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SessionRepository,
  WorkspaceRepository,
  PermissionProfileRepository,
  ModelProfileRepository,
  McpServerRepository,
  SkillRepository,
  SettingsRepository,
  UsageLedgerRepository,
  ContextPreferenceRepository,
  AgentRepository,
  WorkflowRepository,
  TeamDispatchRepository,
} from '@spark/storage'
import type { AgentItem as StorageAgentItem, WorkflowItem as StorageWorkflowItem } from '@spark/storage'
import {
  ProviderService,
  RulesService,
  RuleCompositionEngine,
  SessionService,
  WorkspaceService,
  PermissionService,
  ModelService,
  McpService,
  SkillService,
  SkillRegistryService,
  SettingsService,
  UsageLedgerService,
  RuntimeCompositionService,
} from '@spark/agent-runtime'
import type {
  CommandParseResponse,
  SessionAgentAdapter,
  SessionPermissionMode,
  WorkspaceInfo,
  HookNode,
  PlaywrightInstallProgress,
  ManagedAgent,
  WorkflowItem as ProtocolWorkflowItem,
  WorkflowGraph,
  ProviderExportPayload,
  TeamModeConfig,
  TeamMemberCard,
  TeamA2ATask,
  TeamA2AReply,
} from '@spark/protocol'
import type {
  SessionEventHandler,
  ApprovalHandler,
  SessionQueueChangedHandler,
  QuestionHandler,
  HookTriggerHandler,
  SessionRenamedHandler,
} from '@spark/agent-runtime'
import { getFileWatcherService } from '../services/FileWatcherService.js'
import { toSafeFileUrl } from '../services/SafeFileProtocol.js'
import { getUpdateService } from '../services/UpdateService.js'
import { detectExternalTools, openProjectInTool } from '../services/ExternalToolService.js'
import { checkSdkIntegrity, installSdk } from '../services/SdkIntegrityService.js'
import {
  getShellEnvironmentStatus,
  recheckRuntimeTools,
} from '../services/ShellEnvironmentService.js'
import {
  detectIntegrity,
  installMcp,
  installBrowser,
  invalidateCache,
} from '../services/PlaywrightIntegrityService.js'
import {
  ensureRegistered,
  readRegistration,
  setEnabled as setPlaywrightEnabled,
} from '../services/PlaywrightMcpRegistration.js'
import {
  openView,
  closeView,
  setVisible,
  captureView,
  isViewOpen,
  getCdpEndpoint,
  bindLifecycle as bindBrowserViewLifecycle,
} from '../services/BrowserAutomationViewService.js'
import {
  openPopOutWindow,
  closePopOutWindow,
  isPopOutOpen,
} from '../services/PopOutBrowserService.js'
import { getDatabase, getDatabasePath } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { applyHunkPatch } from '../services/FilePatchService.js'

const log = createLogger('ipc:register')
const execFileAsync = promisify(execFile)
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'
const NO_PROJECT_WORKSPACE_NAME = '不使用项目'

function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

function getModelService(): ModelService {
  return new ModelService(new ModelProfileRepository(getDatabase()))
}

function getPersistentProjectsDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

function getPersistentNoProjectRootPath(): string {
  return path.join(getPersistentProjectsDir(), 'no-project')
}

function isWithinDirectory(targetPath: string, directory: string): boolean {
  const relative = path.relative(directory, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isTemporaryWorkspaceRoot(rootPath: string): boolean {
  const resolved = path.resolve(rootPath)
  const appTempDir = path.resolve(app.getPath('temp'))
  return isWithinDirectory(resolved, appTempDir)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureNoProjectWorkspacePath(workspaceId: string): Promise<void> {
  const repo = new WorkspaceRepository(getDatabase())
  const workspace = repo.get(workspaceId)
  if (workspace == null || workspace.name !== NO_PROJECT_WORKSPACE_NAME) return

  const workspaceService = getWorkspaceService()
  const currentRoot = path.resolve(workspace.root_path)
  const desiredRoot = getPersistentNoProjectRootPath()
  const currentExists = await pathExists(currentRoot)
  const shouldRelocate = currentRoot !== desiredRoot && (!currentExists || isTemporaryWorkspaceRoot(currentRoot))

  if (shouldRelocate) {
    await fs.mkdir(getPersistentProjectsDir(), { recursive: true })
    const updated = await workspaceService.relocateWorkspace(workspace.id, {
      rootPath: desiredRoot,
      relocatedFrom: [currentRoot],
    })
    log.info(`Relocated no-project workspace ${workspace.id} to persistent path ${updated.root_path}`)
    return
  }

  if (!currentExists) {
    await fs.mkdir(currentRoot, { recursive: true })
    log.info(`Recreated missing no-project workspace directory: ${currentRoot}`)
  }
}

/**
 * Ensure the persistent no-project workspace directory exists on disk,
 * even if no no-project workspace record has been created in the DB yet.
 * This prevents "directory does not exist" errors on first app launch.
 *
 * Uses a module-level flag to skip redundant fs.mkdir calls after the first
 * successful invocation — safe because ensureNoProjectWorkspacePath() still
 * guards against runtime directory deletion for existing DB workspaces.
 */
let _noProjectDirEnsured = false
export async function ensureNoProjectDirectoryExists(): Promise<void> {
  if (_noProjectDirEnsured) return
  const projectsDir = getPersistentProjectsDir()
  const noProjectDir = getPersistentNoProjectRootPath()
  try {
    await fs.mkdir(projectsDir, { recursive: true })
    await fs.mkdir(noProjectDir, { recursive: true })
    _noProjectDirEnsured = true
    log.info(`Ensured no-project directory: ${noProjectDir}`)
  } catch (err) {
    log.warn(`Failed to ensure no-project directory: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function ensureSessionWorkspacePaths(sessionId: string): Promise<void> {
  const sessionRepo = new SessionRepository(getDatabase())
  const session = sessionRepo.get(sessionId)
  if (session == null) return
  const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
  await Promise.all(workspaceIds.map((workspaceId) => ensureNoProjectWorkspacePath(workspaceId)))
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

function getAgentRepository(): AgentRepository {
  return new AgentRepository(getDatabase())
}

function getWorkflowRepository(): WorkflowRepository {
  return new WorkflowRepository(getDatabase())
}

function getRuntimeCompositionService(): RuntimeCompositionService {
  return new RuntimeCompositionService(
    new SkillRepository(getDatabase()),
    new SettingsRepository(getDatabase()),
  )
}

let _settingsService: SettingsService | null = null
function getSettingsService(): SettingsService {
  if (_settingsService == null) {
    _settingsService = new SettingsService(new SettingsRepository(getDatabase()))
  }
  return _settingsService
}

let _usageLedgerService: UsageLedgerService | null = null
function getUsageLedgerService(): UsageLedgerService {
  if (_usageLedgerService == null) {
    _usageLedgerService = new UsageLedgerService(new UsageLedgerRepository(getDatabase()))
  }
  return _usageLedgerService
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

function getSessionPermissionContext(sessionId: string): {
  projectId?: string
  workspaceIds?: string[]
} {
  const row = new SessionRepository(getDatabase()).get(sessionId)
  if (row == null) return {}
  let workspaceIds: string[] = []
  try {
    const parsed = JSON.parse(row.workspace_ids_json) as unknown
    if (Array.isArray(parsed)) {
      workspaceIds = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
  } catch {
    workspaceIds = []
  }
  return {
    projectId: row.project_id,
    workspaceIds,
  }
}

function applyRuntimePermissionDefaults<
  T extends {
    agentAdapter?: SessionAgentAdapter
    permissionMode?: SessionPermissionMode
  },
>(request: T): T {
  if (request.agentAdapter !== undefined && request.permissionMode !== undefined) return request
  const defaults = getRuntimePermissionDefaults()
  return {
    ...request,
    agentAdapter: request.agentAdapter ?? defaults.agentAdapter,
    permissionMode: request.permissionMode ?? defaults.permissionMode,
  }
}

function getRuntimePermissionDefaults(): {
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
} {
  const value = getSettingsService().get(
    RUNTIME_PERMISSION_SETTINGS_CATEGORY,
    RUNTIME_PERMISSION_SETTINGS_KEY,
  )
  const adapter = readRuntimeAgentAdapter(value)
  const permissionMode = readRuntimePermissionMode(value, adapter)
  return { agentAdapter: adapter, permissionMode }
}

function readRuntimeAgentAdapter(value: unknown): SessionAgentAdapter {
  if (value != null && typeof value === 'object' && 'adapter' in value) {
    const adapter = (value as { adapter?: unknown }).adapter
    if (adapter === 'claude' || adapter === 'claude-sdk' || adapter === 'codex') return adapter
  }
  return 'claude-sdk'
}

function readRuntimePermissionMode(
  value: unknown,
  adapter: SessionAgentAdapter,
): SessionPermissionMode {
  if (value != null && typeof value === 'object' && 'permissionMode' in value) {
    const mode = (value as { permissionMode?: unknown }).permissionMode
    if (typeof mode === 'string' && isPermissionModeForAdapter(mode, adapter)) return mode
  }
  return adapter === 'codex' ? 'codex-default' : 'claude-ask'
}

function isPermissionModeForAdapter(
  value: string,
  adapter: SessionAgentAdapter,
): value is SessionPermissionMode {
  if (adapter === 'codex') {
    return (
      value === 'codex-default' || value === 'codex-auto-review' || value === 'codex-full-access'
    )
  }
  return (
    value === 'claude-ask' ||
    value === 'claude-auto-edits' ||
    value === 'claude-plan' ||
    value === 'claude-auto' ||
    value === 'claude-bypass'
  )
}

let _workspaceService: WorkspaceService | null = null
function getWorkspaceService(): WorkspaceService {
  if (_workspaceService == null) {
    _workspaceService = new WorkspaceService(new WorkspaceRepository(getDatabase()))
  }
  return _workspaceService
}

let _sessionService: SessionService | null = null
let pendingQuestionResolvers = new Map<string, (answers: Record<string, unknown>) => void>()

function getSessionService(): SessionService {
  if (_sessionService == null) {
    const onEvent: SessionEventHandler = (event) => {
      pushStreamEvent('stream:session:agent-event', event)
    }
    const onApproval: ApprovalHandler = (sessionId, toolName, toolInput) => {
      const permissionContext = getSessionPermissionContext(sessionId)
      return getPermissionService().requestApproval(
        sessionId,
        toolName,
        toolInput,
        (req) => {
          pushStreamEvent('stream:permission:approval-request', req)
        },
        { forcePrompt: true, ...permissionContext },
      )
    }
    const onApprovalCancel = (sessionId: string) => {
      getPermissionService().cancelPendingApprovals(sessionId)
    }
    const onQueueChanged: SessionQueueChangedHandler = (snapshot) => {
      pushStreamEvent('stream:session:queue-changed', snapshot)
    }
    const onQuestion: QuestionHandler = async (sessionId, questions) => {
      return new Promise((resolve) => {
        const questionId = `${sessionId}:${Date.now()}`
        pendingQuestionResolvers.set(questionId, resolve)
        pushStreamEvent('stream:session:user-question', {
          questionId,
          sessionId,
          questions,
        })
      })
    }
    const onHookTrigger: HookTriggerHandler = (sessionId, node, context) => {
      // 异步触发 hook，不阻塞事件流
      triggerHook(sessionId, node, context).catch((err) => {
        log.warn(`Failed to trigger hook: ${String(err)}`)
      })
    }
    const onSessionRenamed: SessionRenamedHandler = (sessionId, title) => {
      pushStreamEvent('stream:session:renamed', { sessionId, title })
    }
    _sessionService = new SessionService(
      getDatabase(),
      onEvent,
      onApproval,
      onApprovalCancel,
      onQueueChanged,
      onQuestion,
      onHookTrigger,
      onSessionRenamed,
    )
  }
  return _sessionService
}

/** Resolve a pending user question with the provided answers */
export function resolveUserQuestion(questionId: string, answers: Record<string, unknown>): void {
  const resolver = pendingQuestionResolvers.get(questionId)
  if (resolver) {
    pendingQuestionResolvers.delete(questionId)
    resolver(answers)
  }
}

/**
 * 触发 Hook
 * 内部函数，用于在 SessionService 中触发 hook
 */
async function triggerHook(
  sessionId: string,
  node: HookNode,
  context?: { title?: string; body?: string },
): Promise<boolean> {
  try {
    // 直接调用 hook 逻辑（不通过 IPC）
    const hookConfigValue = getSettingsService().get('hooks', 'config')
    const globalHookConfig = parseHookConfig(hookConfigValue)
    const agentHookConfig = readAgentHookConfig(sessionId)
    const hookConfig = agentHookConfig.enabled ? agentHookConfig : globalHookConfig

    if (!hookConfig.enabled) {
      return false
    }

    const nodeConfig = hookConfig.nodes[node]
    if (!nodeConfig) {
      return false
    }

    let triggered = false

    // 播放提示音
    if (nodeConfig.sound) {
      try {
        shell.beep()
        triggered = true
      } catch (err) {
        log.warn(`Failed to play sound: ${String(err)}`)
      }
    }

    // 显示系统通知
    if (nodeConfig.notification) {
      try {
        const notificationTitle = context?.title ?? getNodeDefaultTitle(node)
        const notificationBody = context?.body ?? getNodeDefaultBody(node)
        showSystemNotification(notificationTitle, notificationBody)
        triggered = true
      } catch (err) {
        log.warn(`Failed to show notification: ${String(err)}`)
      }
    }

    return triggered
  } catch (err) {
    log.warn(`Failed to trigger hook: ${String(err)}`)
    return false
  }
}

function readAgentHookConfig(sessionId: string): HookConfigInternal {
  const session = new SessionRepository(getDatabase()).get(sessionId)
  if (session == null) return { ...DEFAULT_HOOK_CONFIG_INTERNAL, enabled: false }
  const agent = getAgentRepository().get(session.agent_id ?? 'code-agent')
  if (agent == null) return { ...DEFAULT_HOOK_CONFIG_INTERNAL, enabled: false }
  return parseHookConfig(agent.hookConfig, { ...DEFAULT_HOOK_CONFIG_INTERNAL, enabled: false })
}

export function registerAllIpcHandlers(): void {
  log.info('Registering IPC handlers...')

  // ─── Session Handlers ──────────────────────────────────────────────────

  typedIpcHandle('session:create', async (req) => {
    log.info(`session:create requested, providerProfileId=${req.providerProfileId}`)
    await ensureNoProjectDirectoryExists()
    return getSessionService().createSession(applyRuntimePermissionDefaults(req))
  })

  typedIpcHandle('session:send-turn', async (req) => {
    log.info(`session:send-turn requested, sessionId=${req.sessionId}`)
    await ensureNoProjectDirectoryExists()
    await ensureSessionWorkspacePaths(req.sessionId)
    return getSessionService().sendTurn({
      sessionId: req.sessionId,
      message: req.message,
      ...(req.providerProfileId !== undefined ? { providerProfileId: req.providerProfileId } : {}),
      ...(req.modelId !== undefined ? { modelId: req.modelId } : {}),
      ...(req.agentId !== undefined ? { agentId: req.agentId } : {}),
      ...(req.agentAdapter !== undefined ? { agentAdapter: req.agentAdapter } : {}),
      ...(req.permissionMode !== undefined ? { permissionMode: req.permissionMode } : {}),
      ...(req.chatMode !== undefined ? { chatMode: req.chatMode } : {}),
      ...(req.reasoningEffort !== undefined ? { reasoningEffort: req.reasoningEffort } : {}),
      ...(req.skillId != null ? { skillId: req.skillId } : {}),
      ...(req.skillParams != null ? { skillParams: req.skillParams } : {}),
      ...(req.attachments != null ? { attachments: req.attachments } : {}),
      ...(req.teamConfig != null ? { teamConfig: req.teamConfig } : {}),
    })
  })

  typedIpcHandle('session:get-queue', async (req) => {
    log.info(`session:get-queue requested, sessionId=${req.sessionId}`)
    return getSessionService().getQueueState(req)
  })

  typedIpcHandle('session:cancel-queued-turn', async (req) => {
    log.info(
      `session:cancel-queued-turn requested, sessionId=${req.sessionId}, turnId=${req.turnId}`,
    )
    return getSessionService().cancelQueuedTurn(req)
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

  typedIpcHandle('session:clear-events', async (req) => {
    log.info(`session:clear-events requested, sessionId=${req.sessionId}`)
    return getSessionService().clearEvents(req.sessionId)
  })

  typedIpcHandle('session:delete-message', async (req) => {
    log.info(
      `session:delete-message requested, sessionId=${req.sessionId} eventCount=${req.eventIds.length}`,
    )
    return getSessionService().deleteMessage(req.sessionId, req.eventIds)
  })

  typedIpcHandle('session:answer-question', async (req) => {
    log.info(`session:answer-question requested, questionId=${req.questionId}`)
    resolveUserQuestion(req.questionId, req.answers)
    return { ok: true }
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

  // ─── Provider Import/Export Handlers ─────────────────────────────────────
  //
  // 流程：
  //   - 内存构造 ExportPayload  → `provider:export`
  //   - 弹保存对话框写 .json     → `provider:export-to-file`（内部走 export 拿到 payload）
  //   - 弹打开对话框读 .json     → `provider:import-from-file`（只解析，不写库）
  //   - 真正写库                  → `provider:import`（让 UI 走预览/确认流程）
  //
  // 文件 IO 走 electron 的 dialog + node:fs/promises（不要用浏览器 File API）。
  // 解析失败、IO 失败、版本不匹配都返回友好错误，UI 弹 toast。

  typedIpcHandle('provider:export', async (req) => {
    const count = req.ids.length
    log.info(`provider:export requested, ids=${count}`)
    const payload = await getProviderService().exportProviders(req.ids)
    return { payload }
  })

  typedIpcHandle('provider:import', async (req) => {
    const total = req.payload.profiles.length
    log.info(`provider:import requested, mode=${req.mode}, profiles=${total}`)
    const result = await getProviderService().importProviders(req.payload, req.mode)
    log.info(
      `provider:import done, imported=${result.imported}, skipped=${result.skipped}, errors=${result.errors.length}`,
    )
    return result
  })

  typedIpcHandle('provider:export-to-file', async (req) => {
    const count = req.ids.length
    log.info(`provider:export-to-file requested, ids=${count}`)

    const payload = await getProviderService().exportProviders(req.ids)

    // 默认文件名：spark-agent-providers-YYYY-MM-DD.json
    const datePart = new Date().toISOString().slice(0, 10)
    const defaultName = `spark-agent-providers-${datePart}.json`

    const result = await dialog.showSaveDialog({
      title: '导出 Provider 配置',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePath == null || result.filePath.length === 0) {
      log.info('provider:export-to-file canceled by user')
      return { filePath: '', count: payload.profiles.length }
    }

    const fs = await import('node:fs/promises')
    try {
      const json = JSON.stringify(payload, null, 2)
      await fs.writeFile(result.filePath, json, 'utf-8')
      log.info(`provider:export-to-file wrote ${payload.profiles.length} profiles to ${result.filePath}`)
      return { filePath: result.filePath, count: payload.profiles.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`provider:export-to-file write failed: ${message}`)
      throw new Error(`写入文件失败：${message}`)
    }
  })

  typedIpcHandle('provider:import-from-file', async () => {
    log.info('provider:import-from-file requested')

    const result = await dialog.showOpenDialog({
      title: '选择 Provider 配置文件',
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      log.info('provider:import-from-file canceled by user')
      return { payload: null, filePath: '' }
    }

    const filePath = result.filePaths[0]!
    const fs = await import('node:fs/promises')

    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`provider:import-from-file read failed: ${message}`)
      throw new Error(`读取文件失败：${message}`)
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`provider:import-from-file parse failed: ${message}`)
      throw new Error(`JSON 解析失败：${message}`)
    }

    // 用 protocol 提供的 zod schema 做运行时校验，version 不匹配会抛 ZodError
    // typedIpcHandle 统一捕获后会返回给 UI
    const { ProviderExportPayloadSchema, PROVIDER_EXPORT_VERSION } = await import('@spark/protocol')
    const parsed = ProviderExportPayloadSchema.parse(json)

    log.info(
      `provider:import-from-file parsed ${parsed.profiles.length} profiles, version=${parsed.version}`,
    )
    // 二次确认：zod literal 已经校验过 version，但额外提示更友好
    if (parsed.version !== PROVIDER_EXPORT_VERSION) {
      log.info(`provider:import-from-file accepting older version ${parsed.version} (current: ${PROVIDER_EXPORT_VERSION})`)
    }

    return { payload: parsed as ProviderExportPayload, filePath }
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
    if (workspace != null) {
      await ensureNoProjectWorkspacePath(workspace.id)
    }
    const refreshed = workspace == null ? null : new WorkspaceRepository(getDatabase()).get(workspace.id)
    return { workspace: refreshed == null ? null : toWorkspaceInfo(refreshed) }
  })

  typedIpcHandle('workspace:list', async (req) => {
    log.info('workspace:list requested')
    const service = getWorkspaceService()
    const listParams =
      req.includeArchived === undefined ? {} : { includeArchived: req.includeArchived }
    const listed = service.listWorkspaces(req.limit, req.offset, listParams)
    await Promise.all(listed.map((workspace) => ensureNoProjectWorkspacePath(workspace.id)))
    const refreshed = service.listWorkspaces(req.limit, req.offset, listParams)
    return {
      workspaces: refreshed.map(toWorkspaceInfo),
      total: service.countWorkspaces(listParams),
    }
  })

  typedIpcHandle('workspace:update', async (req) => {
    log.info(`workspace:update requested, workspaceId=${req.workspaceId}`)
    const workspace = getWorkspaceService().updateWorkspace(req.workspaceId, {
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.pinned !== undefined
        ? { pinnedAt: req.pinned ? new Date().toISOString() : null }
        : {}),
      ...(req.archived !== undefined
        ? { archivedAt: req.archived ? new Date().toISOString() : null }
        : {}),
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
    log.info(
      `workspace:switch-branch requested, workspaceId=${req.workspaceId}, branch=${req.branch}`,
    )
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    await execFileAsync('git', ['switch', req.branch], { cwd: workspace.root_path })
    const result = await getWorkspaceBranches(workspace.root_path)
    if (result.currentBranch == null) {
      throw new Error('Unable to determine current git branch after switch')
    }
    return { currentBranch: result.currentBranch, branches: result.branches }
  })

  // ─── File Watcher Handlers ──────────────────────────────────────────────

  typedIpcHandle('workspace:watch-start', async (req) => {
    log.info(`workspace:watch-start requested, workspaceId=${req.workspaceId}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    const watcherService = getFileWatcherService()
    watcherService.start(req.workspaceId, workspace.root_path, req.ignorePatterns)
    return { watching: true }
  })

  typedIpcHandle('workspace:watch-stop', async (req) => {
    log.info(`workspace:watch-stop requested, workspaceId=${req.workspaceId}`)
    const stopped = getFileWatcherService().stop(req.workspaceId)
    return { stopped }
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

  typedIpcHandle('dialog:open-file', async (req) => {
    const result = await dialog.showOpenDialog({
      title: req.title ?? '选择文件',
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath }),
      properties: req.multiple === true ? ['openFile', 'multiSelections'] : ['openFile'],
      ...(req.filters ? { filters: req.filters } : {}),
    })

    return {
      canceled: result.canceled,
      ...(result.filePaths[0] === undefined ? {} : { filePath: result.filePaths[0] }),
      ...(result.filePaths.length > 0 ? { filePaths: result.filePaths } : {}),
    }
  })

  // ─── App Info Handlers ─────────────────────────────────────────────────────

  typedIpcHandle('app:get-info', async () => {
    return {
      appVersion: app.getVersion(),
      appName: app.getName(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      platform: `${process.platform} ${process.arch}`,
    }
  })

  // ─── App Paths Handlers ─────────────────────────────────────────────────────

  typedIpcHandle('app:get-temp-project-dir', async () => {
    // 持久化的项目目录：放在 userData 下，避免被 macOS/Linux 定期清理 /tmp
    const projectsDir = `${app.getPath('userData')}/projects`
    try {
      await import('node:fs/promises').then((fs) => fs.mkdir(projectsDir, { recursive: true }))
    } catch (err) {
      log.warn(`Failed to ensure projects dir: ${err instanceof Error ? err.message : String(err)}`)
    }
    return { tempDir: projectsDir }
  })

  typedIpcHandle('app:get-storage-stats', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const userDataPath = app.getPath('userData')
    const projectsDir = path.join(userDataPath, 'projects')
    const databasePath = getDatabasePath()

    const dirSize = async (dir: string): Promise<number> => {
      let total = 0
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          try {
            if (entry.isDirectory()) {
              total += await dirSize(full)
            } else if (entry.isFile()) {
              const st = await fs.stat(full)
              total += st.size
            }
          } catch {
            // 忽略权限/损坏文件
          }
        }
      } catch {
        // 目录不存在
      }
      return total
    }

    const fileSize = async (filePath: string): Promise<number> => {
      try {
        const st = await fs.stat(filePath)
        return st.size
      } catch {
        return 0
      }
    }

    const CACHE_DIRS = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Shared Dictionary',
      'blob_storage',
    ]
    let cacheBytes = 0
    for (const name of CACHE_DIRS) {
      cacheBytes += await dirSize(path.join(userDataPath, name))
    }

    const databaseBytes =
      (await fileSize(databasePath)) +
      (await fileSize(`${databasePath}-shm`)) +
      (await fileSize(`${databasePath}-wal`))

    const projectsBytes = await dirSize(projectsDir)

    return {
      userDataPath,
      projectsDir,
      databasePath,
      databaseBytes,
      cacheBytes,
      projectsBytes,
      totalBytes: databaseBytes + cacheBytes + projectsBytes,
    }
  })

  typedIpcHandle('app:clear-cache', async (req) => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const userDataPath = app.getPath('userData')

    // 1) 清 Electron / Chromium 缓存（不动 Cookies / Local Storage / Preferences）
    const CACHE_DIRS = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Shared Dictionary',
      'blob_storage',
    ]
    let clearedBytes = 0
    for (const name of CACHE_DIRS) {
      const full = path.join(userDataPath, name)
      try {
        const st = await fs.stat(full)
        if (st.isDirectory()) {
          const before = await (async function size(dir: string): Promise<number> {
            let t = 0
            try {
              const entries = await fs.readdir(dir, { withFileTypes: true })
              for (const e of entries) {
                const f = path.join(dir, e.name)
                try {
                  if (e.isDirectory()) t += await size(f)
                  else if (e.isFile()) t += (await fs.stat(f)).size
                } catch {}
              }
            } catch {}
            return t
          })(full)
          await fs.rm(full, { recursive: true, force: true })
          clearedBytes += before
        }
      } catch {
        // 不存在就跳过
      }
    }

    try {
      const { session } = await import('electron')
      await session.defaultSession.clearCache()
      await session.defaultSession.clearCodeCaches({})
    } catch (err) {
      log.warn(`session.clearCache failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 2) 可选：清掉临时项目目录里不再被任何 workspace 引用的孤儿目录
    let clearedOrphanProjects = false
    if (req.pruneOrphanProjects === true) {
      const projectsDir = path.join(userDataPath, 'projects')
      try {
        const workspaces = new WorkspaceRepository(getDatabase()).listAll(1000, 0, {
          includeArchived: true,
        })
        const referenced = new Set(workspaces.map((w) => w.root_path))
        const entries = await fs.readdir(projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const full = path.join(projectsDir, entry.name)
          if (referenced.has(full)) continue
          try {
            await fs.rm(full, { recursive: true, force: true })
            clearedOrphanProjects = true
          } catch (err) {
            log.warn(`prune orphan ${full} failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      } catch (err) {
        log.warn(`prune orphan projects scan failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { clearedBytes, clearedCache: true, clearedOrphanProjects }
  })

  typedIpcHandle('app:open-data-dir', async () => {
    const result = await shell.openPath(app.getPath('userData'))
    if (result !== '') {
      log.warn(`app:open-data-dir failed: ${result}`)
      return { opened: false }
    }
    return { opened: true }
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

  typedIpcHandle('rules:compose', async (req) => {
    log.info(`rules:compose requested, strategy=${req.conflictStrategy ?? 'override'}`)
    const engine = new RuleCompositionEngine(new RulesRepository(getDatabase()))
    return engine.compose(req)
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

  typedIpcHandle('permission:set-active-profile', async (req) => {
    getPermissionService().setActiveProfileId(req.profileId)
    return { activeProfileId: req.profileId }
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
    const servers = getMcpService().listServers(
      req.scope !== undefined ? { scope: req.scope } : undefined,
    )
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

  typedIpcHandle('skill:detect-local', async (req) => {
    const candidates = getSkillService().detectLocalSkills(req.searchRoots)
    return { candidates }
  })

  typedIpcHandle('skill-config:get', async (req) => {
    return getRuntimeCompositionService().getSkillConfig(req)
  })

  typedIpcHandle('skill-config:update', async (req) => {
    return getRuntimeCompositionService().updateSkillConfig(
      req.scope,
      req.scopeRef,
      req.skillIds,
      req.disabledSkillIds,
    )
  })

  typedIpcHandle('prompt-config:get', async (req) => {
    return getRuntimeCompositionService().getPromptConfig(req)
  })

  typedIpcHandle('prompt-config:update', async (req) => {
    return getRuntimeCompositionService().updatePromptConfig(req.scope, req.scopeRef, req.value)
  })

  // ─── Agent Management Handlers ────────────────────────────────────────

  typedIpcHandle('agent:list', async (req) => {
    const agents = getAgentRepository()
      .list(req.includeDisabled !== undefined ? { includeDisabled: req.includeDisabled } : {})
      .map(toManagedAgent)
    return { agents }
  })

  typedIpcHandle('agent:get', async (req) => {
    const agent = getAgentRepository().get(req.id)
    return { agent: agent != null ? toManagedAgent(agent) : null }
  })

  typedIpcHandle('agent:create', async (req) => {
    const agent = getAgentRepository().create(req)
    if (agent.prompt.trim().length > 0) {
      getRuntimeCompositionService().updatePromptConfig('agent', agent.id, {
        enabled: true,
        content: agent.prompt,
      })
    }
    if ((agent.skillIds.length > 0 || agent.disabledSkillIds.length > 0) && agent.id) {
      getRuntimeCompositionService().updateSkillConfig(
        'agent',
        agent.id,
        agent.skillIds,
        agent.disabledSkillIds,
      )
    }
    return { agent: toManagedAgent(agent) }
  })

  typedIpcHandle('agent:update', async (req) => {
    const { id, ...fields } = req
    const agent = getAgentRepository().update(id, fields)
    if (agent == null) throw new Error(`Agent not found: ${id}`)
    if (fields.prompt !== undefined) {
      getRuntimeCompositionService().updatePromptConfig('agent', agent.id, {
        enabled: agent.prompt.trim().length > 0,
        content: agent.prompt,
      })
    }
    if (fields.skillIds !== undefined || fields.disabledSkillIds !== undefined) {
      getRuntimeCompositionService().updateSkillConfig(
        'agent',
        agent.id,
        agent.skillIds,
        agent.disabledSkillIds,
      )
    }
    return { agent: toManagedAgent(agent) }
  })

  typedIpcHandle('agent:delete', async (req) => {
    const deleted = getAgentRepository().delete(req.id)
    return { deleted }
  })

  // ─── Team Mode Handlers ───────────────────────────────────────────────

  typedIpcHandle('team:update', async (req) => {
    log.info(`team:update requested, sessionId=${req.sessionId}, enabled=${req.config.enabled}`)
    new SessionRepository(getDatabase()).patchMetadata(req.sessionId, { team: req.config })
    return { config: req.config }
  })

  typedIpcHandle('team:list-members', async (req) => {
    const metadata = new SessionRepository(getDatabase()).getMetadata(req.sessionId)
    const team = (metadata.team ?? null) as Partial<TeamModeConfig> | null
    const hostAgentId = team?.hostAgentId ?? 'code-agent'
    const memberIds = new Set(team?.memberAgentIds ?? [])
    const agents = getAgentRepository().list({}).map(toManagedAgent)
    const toCard = (a: ManagedAgent): TeamMemberCard => ({
      agentId: a.id,
      name: a.name,
      description: a.description,
      builtIn: a.builtIn,
      providerProfileId: a.providerProfileId ?? null,
      modelId: a.modelId ?? null,
      avatar: deriveTeamAvatar(a.id, a.name),
      capabilitiesSummary: a.description.slice(0, 240),
    })
    const members = agents.filter((a) => a.id !== hostAgentId && memberIds.has(a.id)).map(toCard)
    const candidates = agents.filter((a) => a.id !== hostAgentId && !memberIds.has(a.id)).map(toCard)
    // 顺带返回完整 TeamModeConfig 供前端恢复会话状态（团队模式开关 / 嵌套深度等）
    const config: TeamModeConfig | null =
      team != null
        ? {
            enabled: team.enabled === true,
            hostAgentId,
            memberAgentIds: Array.from(memberIds),
            maxDepth: typeof team.maxDepth === 'number' ? team.maxDepth : 1,
            allowNesting: team.allowNesting === true,
          }
        : null
    return { hostAgentId, members, candidates, config }
  })

  typedIpcHandle('team:list-dispatches', async (req) => {
    const repo = new TeamDispatchRepository(getDatabase())
    const rows =
      req.turnId != null ? repo.listByTurn(req.turnId) : repo.listBySession(req.sessionId, req.limit ?? 50)
    const dispatches = rows.map((row) => ({
      id: row.id,
      state: row.state,
      hostAgentId: row.host_agent_id,
      memberAgentId: row.member_agent_id,
      task: JSON.parse(row.task_json) as TeamA2ATask,
      ...(row.reply_json != null ? { reply: JSON.parse(row.reply_json) as TeamA2AReply } : {}),
      startedAt: row.started_at,
      ...(row.ended_at != null ? { endedAt: row.ended_at } : {}),
    }))
    return { dispatches }
  })

  // ─── Workflow Handlers ────────────────────────────────────────────────

  typedIpcHandle('workflow:list', async (req) => {
    const workflows = getWorkflowRepository()
      .list({
        ...(req.scope !== undefined ? { scope: req.scope } : {}),
        ...(req.includeArchived !== undefined ? { includeArchived: req.includeArchived } : {}),
      })
      .map(toWorkflowItem)
    return { workflows }
  })

  typedIpcHandle('workflow:get', async (req) => {
    const workflow = getWorkflowRepository().get(req.id)
    return { workflow: workflow != null ? toWorkflowItem(workflow) : null }
  })

  typedIpcHandle('workflow:create', async (req) => {
    const { graph, ...fields } = req
    const workflow = getWorkflowRepository().create({
      ...fields,
      ...(graph !== undefined ? { graph: graph as unknown as Record<string, unknown> } : {}),
    })
    return { workflow: toWorkflowItem(workflow) }
  })

  typedIpcHandle('workflow:update', async (req) => {
    const { id, graph, ...fields } = req
    const workflow = getWorkflowRepository().update(id, {
      ...fields,
      ...(graph !== undefined ? { graph: graph as unknown as Record<string, unknown> } : {}),
    })
    if (workflow == null) throw new Error(`Workflow not found: ${id}`)
    return { workflow: toWorkflowItem(workflow) }
  })

  typedIpcHandle('workflow:delete', async (req) => {
    const agents = getAgentRepository().list({ includeDisabled: true })
    for (const agent of agents) {
      if (agent.workflowId === req.id && !agent.builtIn) {
        getAgentRepository().update(agent.id, { workflowId: null })
      }
    }
    const deleted = getWorkflowRepository().delete(req.id)
    return { deleted }
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
    log.info(
      `skill-registry:search requested, query="${req.query}", registryId=${req.registryId ?? 'all'}`,
    )
    return getSkillRegistryService().search(req)
  })

  typedIpcHandle('skill-registry:featured', async (req) => {
    log.info(`skill-registry:featured requested, registryId=${req.registryId ?? 'all'}`)
    const skills = await getSkillRegistryService().featured(req)
    return { skills }
  })

  typedIpcHandle('skill-registry:install', async (req) => {
    log.info(
      `skill-registry:install requested, remoteSkillId=${req.remoteSkillId}, registryId=${req.registryId}`,
    )
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

  typedIpcHandle('skill:import-file', async (req) => {
    log.info(`skill:import-file requested, filePath=${req.filePath}`)
    const skill = getSkillService().importFile(req.filePath)
    return { skill }
  })

  typedIpcHandle('skill:import-directory', async (req) => {
    const skill = getSkillService().importLocalDirectory(req.directoryPath, req.source)
    return { skills: [skill], failed: 0 }
  })

  typedIpcHandle('skill:import-batch-local', async (req) => {
    log.info(`skill:import-batch-local requested, count=${req.candidates.length}`)
    const result = getSkillService().importBatchLocal(req.candidates)
    return result
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
    const cmdResult = await getSessionService().executeCommandAsEvents({
      sessionId: req.sessionId,
      message: req.message,
    })
    if (!cmdResult.isCommand) {
      return { success: false, forwardToAgent: false }
    }
    if (cmdResult.forwardToAgent) {
      return { success: true, forwardToAgent: true }
    }
    const { session } = await getSessionService().updateSession({ sessionId: req.sessionId })
    return {
      success: true,
      forwardToAgent: false,
      inChat: true,
      started: cmdResult.started ?? false,
      session,
    }
  })

  typedIpcHandle('command:list', async (_req) => {
    const commands = getSessionService().listCommands()
    return { commands }
  })

  typedIpcHandle('command:parse', async (req) => {
    if (!isCommand(req.message)) return { isCommand: false }
    const parsed = parseCommand(req.message)
    if (parsed == null) return { isCommand: false }
    const response: CommandParseResponse = {
      isCommand: true,
      name: parsed.name,
      args: parsed.args,
      flags: parsed.flags,
      targets: parsed.targets,
    }
    if (parsed.subcommand != null) response.subcommand = parsed.subcommand
    if (parsed.freeText != null) response.freeText = parsed.freeText
    return response
  })

  // ─── Settings Handlers ─────────────────────────────────────────────────────

  typedIpcHandle('settings:get', async (req) => {
    const value = getSettingsService().get(req.category, req.key)
    return { value }
  })

  typedIpcHandle('settings:set', async (req) => {
    getSettingsService().set(req.category, req.key, req.value)
    return { ok: true }
  })

  typedIpcHandle('settings:get-category', async (req) => {
    const settings = getSettingsService().getByCategory(req.category)
    return { settings }
  })

  typedIpcHandle('settings:get-all', async (_req) => {
    const settings = getSettingsService().getAll()
    return { settings }
  })

  // ─── Usage Ledger Handlers ────────────────────────────────────────────────

  typedIpcHandle('usage:record', async (req) => {
    const params: Parameters<UsageLedgerService['record']>[0] = {
      sessionId: req.sessionId,
      providerId: req.providerId,
      modelId: req.modelId,
      inputTokens: req.inputTokens,
      outputTokens: req.outputTokens,
    }
    if (req.cacheReadTokens !== undefined) params.cacheReadTokens = req.cacheReadTokens
    if (req.cacheWriteTokens !== undefined) params.cacheWriteTokens = req.cacheWriteTokens
    if (req.costUsd !== undefined) params.costUsd = req.costUsd
    if (req.requestTimestamp !== undefined) params.requestTimestamp = req.requestTimestamp
    const id = getUsageLedgerService().record(params)
    return { id }
  })

  typedIpcHandle('usage:get-session', async (req) => {
    const summary = getUsageLedgerService().getSessionUsage(req.sessionId)
    return { summary }
  })

  typedIpcHandle('usage:get-dashboard', async (_req) => {
    return getUsageLedgerService().getDashboard()
  })

  typedIpcHandle('usage:get-by-date-range', async (req) => {
    const summary = getUsageLedgerService().getUsageByDateRange(req.startDate, req.endDate)
    const modelGroups = getUsageLedgerService().getModelUsageGrouped(req.startDate, req.endDate)
    const dailyGroups = getUsageLedgerService().getDailyUsageGrouped(req.startDate, req.endDate)
    return { summary, modelGroups, dailyGroups }
  })

  typedIpcHandle('usage:purge', async (req) => {
    const deletedCount = getUsageLedgerService().purgeOldRecords(req.olderThanDays)
    return { deletedCount }
  })

  // ─── Auto-Update Handlers ────────────────────────────────────────────────

  typedIpcHandle('update:check', async (_req) => {
    log.info('update:check requested')
    const status = await getUpdateService().checkForUpdates()
    return { status }
  })

  typedIpcHandle('update:download', async (_req) => {
    log.info('update:download requested')
    const started = await getUpdateService().downloadUpdate()
    return { started }
  })

  typedIpcHandle('update:install-restart', async (_req) => {
    log.info('update:install-restart requested')
    const willInstall = getUpdateService().installAndRestart()
    return { willInstall }
  })

  typedIpcHandle('update:get-status', async (_req) => {
    const status = getUpdateService().getStatus()
    return { status }
  })

  typedIpcHandle('update:settings', async (req) => {
    log.info(`update:settings requested: ${JSON.stringify(req)}`)
    const svc = getUpdateService()
    if (req.autoDownload !== undefined) {
      svc.setAutoDownload(req.autoDownload)
    }
    if (req.channel !== undefined) {
      svc.setChannel(req.channel)
    }
    return { ok: true }
  })

  // ─── External Tool Handlers ────────────────────────────────────────────

  typedIpcHandle('tool:detect', async (req) => {
    log.info(`tool:detect requested, kind=${req.kind ?? 'all'}`)
    const tools = await detectExternalTools(req.kind)
    return { tools }
  })

  typedIpcHandle('tool:open-project', async (req) => {
    log.info(`tool:open-project requested, toolId=${req.toolId}, rootPath=${req.rootPath}`)
    const opened = await openProjectInTool(req.toolId, req.rootPath)
    return { opened }
  })

  // ─── SDK Integrity Handlers ─────────────────────────────────────────────

  typedIpcHandle('sdk:integrity-check', async (req) => {
    log.info(`sdk:integrity-check requested, checkLatest=${req.checkLatest ?? false}`)
    const result = await checkSdkIntegrity(req)
    return result
  })

  typedIpcHandle('sdk:integrity-install', async (req) => {
    log.info(`sdk:integrity-install requested, packageName=${req.packageName}`)
    const result = await installSdk(req.packageName)
    return result
  })

  // Shell Environment & Runtime Detection
  typedIpcHandle('env:get-status', async () => {
    const status = await getShellEnvironmentStatus()
    return { status }
  })

  typedIpcHandle('env:recheck', async () => {
    const status = await recheckRuntimeTools()
    return { status }
  })

  // ─── Hook Handlers ─────────────────────────────────────────────────────

  /**
   * Hook 触发入口
   * 根据配置和节点类型，决定是否执行 sound 和 notification
   */
  typedIpcHandle('hook:trigger', async (req) => {
    const { sessionId, node, title, body } = req
    log.info(`hook:trigger requested, sessionId=${sessionId}, node=${node}`)

    // 从 settings 获取 hook 配置
    const hookConfigValue = getSettingsService().get('hooks', 'config')
    const hookConfig = parseHookConfig(hookConfigValue)

    // 如果 hook 系统未启用，直接返回
    if (!hookConfig.enabled) {
      return { triggered: false }
    }

    const nodeConfig = hookConfig.nodes[node]
    if (!nodeConfig) {
      return { triggered: false }
    }

    // 执行配置的 hooks
    let triggered = false

    // 播放提示音
    if (nodeConfig.sound) {
      try {
        shell.beep()
        triggered = true
        log.debug(`Hook sound triggered for node=${node}`)
      } catch (err) {
        log.warn(`Failed to play sound: ${String(err)}`)
      }
    }

    // 显示系统通知
    if (nodeConfig.notification) {
      try {
        const notificationTitle = title ?? getNodeDefaultTitle(node)
        const notificationBody = body ?? getNodeDefaultBody(node)
        showSystemNotification(notificationTitle, notificationBody)
        triggered = true
        log.debug(`Hook notification triggered for node=${node}`)
      } catch (err) {
        log.warn(`Failed to show notification: ${String(err)}`)
      }
    }

    return { triggered }
  })

  /**
   * 直接播放提示音（用于测试）
   */
  typedIpcHandle('hook:play-sound', async () => {
    try {
      shell.beep()
      return { played: true }
    } catch (err) {
      log.warn(`Failed to play sound: ${String(err)}`)
      return { played: false }
    }
  })

  /**
   * 直接显示系统通知（用于测试）
   */
  typedIpcHandle('hook:show-notification', async (req) => {
    try {
      showSystemNotification(req.title, req.body ?? '')
      return { shown: true }
    } catch (err) {
      log.warn(`Failed to show notification: ${String(err)}`)
      return { shown: false }
    }
  })

  // ─── Context Governor Handlers ─────────────────────────────────────────

  typedIpcHandle('context:list-preferences', async (req) => {
    log.info(`context:list-preferences requested, workspaceId=${req.workspaceId}`)
    const repo = new ContextPreferenceRepository(getDatabase())
    const rows = repo.list({
      workspaceId: req.workspaceId,
      ...(req.action !== undefined ? { action: req.action } : {}),
      enabledOnly: false,
    })
    const preferences = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      action: row.action,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    return { preferences }
  })

  typedIpcHandle('context:set-preference', async (req) => {
    log.info(`context:set-preference requested, workspaceId=${req.workspaceId}, filePath=${req.filePath}, action=${req.action}`)
    const repo = new ContextPreferenceRepository(getDatabase())
    const row = repo.upsert({
      id: crypto.randomUUID(),
      workspaceId: req.workspaceId,
      filePath: req.filePath,
      action: req.action,
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
    })
    return {
      preference: {
        id: row.id,
        workspaceId: row.workspace_id,
        filePath: row.file_path,
        action: row.action,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    }
  })

  typedIpcHandle('context:delete-preference', async (req) => {
    log.info(`context:delete-preference requested, id=${req.id}`)
    const repo = new ContextPreferenceRepository(getDatabase())
    const deleted = repo.delete(req.id)
    return { deleted }
  })

  // ─── File Patch Handlers ─────────────────────────────────────────────

  typedIpcHandle('file:apply-hunk-patch', async (req) => {
    log.info(`file:apply-hunk-patch requested, path=${req.filePath}, direction=${req.direction}`)
    const result = applyHunkPatch({
      workspaceRootPath: req.workspaceRootPath,
      filePath: req.filePath,
      hunkDiff: req.hunkDiff,
      direction: req.direction,
    })
    return result
  })

  // ─── File Open Handler ───────────────────────────────────────────────

  typedIpcHandle('file:open', async (req) => {
    const filePath = req.filePath
    if (!filePath || typeof filePath !== 'string') {
      return { opened: false, error: 'filePath is required' }
    }

    log.info(`file:open requested, path=${filePath}`)

    // shell.openPath opens the file with the OS default application based on
    // its extension/association. It returns a Promise that resolves to an
    // empty string on success, or an error message on failure.
    const errorMessage = await shell.openPath(filePath)
    if (errorMessage) {
      log.warn(`file:open failed, path=${filePath}, error=${errorMessage}`)
      return { opened: false, error: errorMessage }
    }
    return { opened: true }
  })

  // ─── File Save Image Handler ──────────────────────────────────────────
  //
  // 让用户把生成的图片（路径在 userData/.spark-artifacts/...）另存到本地。
  // 源文件必须在 safe-file 白名单目录下，与 safe-file 协议保持一致的安全约束。

  typedIpcHandle('file:save-image', async (req) => {
    const sourcePath = req.sourcePath
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { saved: false, savedPath: '', error: 'sourcePath is required' }
    }

    log.info(`file:save-image requested, sourcePath=${sourcePath}`)

    // 源文件必须存在
    if (!(await pathExists(sourcePath))) {
      return { saved: false, savedPath: '', error: '源文件不存在' }
    }

    // 源文件必须在 safe-file 白名单内（userData / temp）
    const resolvedSource = path.resolve(sourcePath)
    const userDataRoot = path.resolve(app.getPath('userData'))
    const tempRoot = path.resolve(app.getPath('temp'))
    const allowed =
      resolvedSource === userDataRoot ||
      resolvedSource.startsWith(userDataRoot + path.sep) ||
      resolvedSource === tempRoot ||
      resolvedSource.startsWith(tempRoot + path.sep)
    if (!allowed) {
      log.warn(`file:save-image rejected: source outside allowed roots, path=${sourcePath}`)
      return { saved: false, savedPath: '', error: '源文件不在允许范围内' }
    }

    // 弹保存对话框
    const sourceBaseName = path.basename(sourcePath)
    const suggestedName = req.suggestedFileName ?? sourceBaseName
    const defaultDir = req.defaultDirectory ?? app.getPath('downloads')

    const result = await dialog.showSaveDialog({
      title: '保存图片',
      defaultPath: path.join(defaultDir, suggestedName),
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return { saved: false, savedPath: '' }
    }

    try {
      // 用 copyFile 而不是 rename，源文件不应该被搬走
      await fs.copyFile(sourcePath, result.filePath)
      log.info(`file:save-image wrote ${sourcePath} -> ${result.filePath}`)
      return { saved: true, savedPath: result.filePath }
    } catch (err) {
      log.error(`file:save-image failed, source=${sourcePath}, err=${String(err)}`)
      return { saved: false, savedPath: '', error: String(err) }
    }
  })

  typedIpcHandle('file:save-pasted-image', async (req) => {
    const dataUrl = req.dataUrl?.trim()
    if (!dataUrl) {
      throw new Error('dataUrl is required')
    }

    const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/)
    if (match == null) {
      throw new Error('Invalid image data URL')
    }

    const mimeType = (match[1] ?? req.mimeType ?? 'image/png').toLowerCase()
    const base64Payload = match[2]
    if (base64Payload == null || base64Payload.length === 0) {
      throw new Error('Clipboard image is empty')
    }
    const buffer = Buffer.from(base64Payload, 'base64')
    if (buffer.length === 0) {
      throw new Error('Clipboard image is empty')
    }

    const extension =
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/gif'
            ? 'gif'
            : mimeType === 'image/bmp'
              ? 'bmp'
              : mimeType === 'image/tiff'
                ? 'tiff'
                : mimeType === 'image/heic'
                  ? 'heic'
                  : mimeType === 'image/heif'
                    ? 'heif'
                    : 'png'

    const rootDir = path.join(app.getPath('temp'), 'spark-agent-pasted-images')
    await fs.mkdir(rootDir, { recursive: true })
    const baseName = (req.suggestedBaseName?.trim() || 'pasted-image').replace(/[^a-zA-Z0-9._-]+/g, '-')
    const fileName = `${baseName}-${crypto.randomUUID()}.${extension}`
    const filePath = path.join(rootDir, fileName)
    await fs.writeFile(filePath, buffer)
    return { filePath, fileName }
  })

  typedIpcHandle('file:prepare-image-preview', async (req) => {
    const sourcePath = req.sourcePath?.trim()
    if (!sourcePath) {
      throw new Error('sourcePath is required')
    }
    if (!(await pathExists(sourcePath))) {
      throw new Error('源文件不存在')
    }

    const resolvedSource = path.resolve(sourcePath)
    const userDataRoot = path.resolve(app.getPath('userData'))
    const tempRoot = path.resolve(app.getPath('temp'))
    const alreadyAllowed =
      resolvedSource === userDataRoot ||
      resolvedSource.startsWith(userDataRoot + path.sep) ||
      resolvedSource === tempRoot ||
      resolvedSource.startsWith(tempRoot + path.sep)

    if (alreadyAllowed) {
      return {
        filePath: resolvedSource,
        fileName: path.basename(resolvedSource),
        fileUrl: toSafeFileUrl(resolvedSource),
      }
    }

    const previewRoot = path.join(app.getPath('temp'), 'spark-agent-image-previews')
    await fs.mkdir(previewRoot, { recursive: true })
    const extension = path.extname(resolvedSource) || '.png'
    const baseName = path.basename(resolvedSource, extension).replace(/[^a-zA-Z0-9._-]+/g, '-')
    const fileName = `${baseName || 'preview'}-${crypto.randomUUID()}${extension}`
    const filePath = path.join(previewRoot, fileName)
    await fs.copyFile(resolvedSource, filePath)
    return {
      filePath,
      fileName,
      fileUrl: toSafeFileUrl(filePath),
    }
  })

  // ─── Playwright Browser Automation Handlers ──────────────────────────

  typedIpcHandle('playwright:status', async () => {
    return buildPlaywrightStatus()
  })

  typedIpcHandle('playwright:install', async (req) => {
    log.info(`playwright:install requested, target=${req.target}`)
    let lastPercent: number | null = null
    const emitInstallProgress = (
      patch: Partial<PlaywrightInstallProgress> & Pick<PlaywrightInstallProgress, 'state' | 'message'>,
    ) => {
      pushStreamEvent('stream:playwright:install-progress', {
        target: req.target,
        percent: patch.percent ?? lastPercent,
        logLine: patch.logLine ?? null,
        ...patch,
      })
    }
    emitInstallProgress({
      state: 'starting',
      percent: 0,
      message: req.target === 'browser' ? '准备下载内置 Chromium' : '准备安装 Playwright MCP',
    })
    const onLog = (line: string) => {
      const text = line.trim()
      if (text.length === 0) return
      log.info(`[playwright-install] ${text}`)
      const percentMatch = text.match(/(\d+(?:\.\d+)?)%/)
      const parsedPercent = percentMatch != null ? Number(percentMatch[1]) : null
      if (parsedPercent != null && Number.isFinite(parsedPercent)) {
        lastPercent = Math.max(0, Math.min(100, parsedPercent))
      }
      const lower = text.toLowerCase()
      const state: PlaywrightInstallProgress['state'] =
        req.target === 'browser' && (lower.includes('download') || lower.includes('chromium'))
          ? 'downloading'
          : lower.includes('install') || lower.includes('add')
            ? 'installing'
            : 'verifying'
      emitInstallProgress({
        state,
        message: req.target === 'browser' ? '正在下载内置 Chromium' : '正在安装 Playwright MCP',
        logLine: text,
      })
    }
    const result =
      req.target === 'mcp'
        ? await installMcp(onLog)
        : await installBrowser(onLog)
    // Refresh state after install completes
    detectIntegrity()
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    emitInstallProgress({
      state: result.success ? 'done' : 'error',
      percent: result.success ? 100 : lastPercent,
      message: result.message,
      logLine: result.message,
    })
    return result
  })

  typedIpcHandle('playwright:reset-config', async () => {
    log.info('playwright:reset-config requested')
    // Don't wire Electron CDP into MCP — Electron exposes multiple targets
    // (main window + side-panel webview + automation view) and Playwright
    // can't reliably pick the right one. Let MCP launch its own Chromium.
    ensureRegistered(getDatabase(), { force: true, cdpEndpoint: null })
    invalidateCache()
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true }
  })

  typedIpcHandle('playwright:set-mode', async (req) => {
    log.info(`playwright:set-mode requested, mode=${req.mode}`)
    ensureRegistered(getDatabase(), {
      mode: req.mode,
      cdpEndpoint: null,
    })
    // headless mode hides the embedded window if it's currently open
    if (req.mode === 'headless' && isViewOpen()) {
      setVisible(false)
    } else if (req.mode === 'headful' && isViewOpen()) {
      setVisible(true)
    }
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true, mode: req.mode }
  })

  typedIpcHandle('playwright:set-enabled', async (req) => {
    log.info(`playwright:set-enabled requested, enabled=${req.enabled}`)
    setPlaywrightEnabled(getDatabase(), req.enabled)
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true, enabled: req.enabled }
  })

  typedIpcHandle('playwright:open-view', async (req) => {
    log.info(`playwright:open-view requested, url=${req.url ?? '(default)'}`)
    const result = await openView(req.url != null ? { url: req.url } : {})
    // Embedded view is a manual user feature — do NOT wire its CDP into MCP
    // (Electron CDP target selection is unreliable). Agent uses its own browser.
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true, cdpEndpoint: result.cdpEndpoint }
  })

  typedIpcHandle('playwright:close-view', async () => {
    log.info('playwright:close-view requested')
    closeView()
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true }
  })

  typedIpcHandle('playwright:capture-view', async () => {
    return captureView()
  })

  // ─── Pop-out Browser Window Handlers ──────────────────────────────
  typedIpcHandle('browser:pop-out', async (req) => {
    log.info('browser:pop-out requested')
    await openPopOutWindow(req.url != null ? { url: req.url } : {})
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true }
  })

  typedIpcHandle('browser:pop-in', async () => {
    log.info('browser:pop-in requested')
    closePopOutWindow()
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true }
  })

  // ─── Window Control Handlers ─────────────────────────────────────────────

  typedIpcHandle('window:minimize', async () => {
    const win = getMainWindow()
    if (win) win.minimize()
    return { success: !!win }
  })

  typedIpcHandle('window:maximize', async () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
        return { success: true, maximized: false }
      }
      win.maximize()
      return { success: true, maximized: true }
    }
    return { success: false, maximized: false }
  })

  typedIpcHandle('window:close', async () => {
    const win = getMainWindow()
    if (win) win.close()
    return { success: !!win }
  })

  typedIpcHandle('window:is-maximized', async () => {
    const win = getMainWindow()
    return { maximized: win ? win.isMaximized() : false }
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

function toManagedAgent(agent: StorageAgentItem): ManagedAgent {
  return {
    ...agent,
    agentAdapter:
      agent.agentAdapter === 'claude' ||
      agent.agentAdapter === 'claude-sdk' ||
      agent.agentAdapter === 'codex'
        ? agent.agentAdapter
        : 'claude-sdk',
    permissionMode: isProtocolPermissionMode(agent.permissionMode)
      ? agent.permissionMode
      : 'claude-ask',
    reasoningEffort: isProtocolReasoning(agent.reasoningEffort)
      ? agent.reasoningEffort
      : 'medium',
  }
}

function toWorkflowItem(workflow: StorageWorkflowItem): ProtocolWorkflowItem {
  return {
    ...workflow,
    graph: toWorkflowGraph(workflow.graph),
  }
}

function toWorkflowGraph(value: Record<string, unknown>): WorkflowGraph {
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
        if (node == null || typeof node !== 'object') return []
        const record = node as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id : ''
        if (!id) return []
        const kind = typeof record.kind === 'string' ? record.kind : 'agent'
        return [{
          id,
          kind: isWorkflowNodeKind(kind) ? kind : 'agent',
          title: typeof record.title === 'string' ? record.title : id,
          x: typeof record.x === 'number' ? record.x : 80,
          y: typeof record.y === 'number' ? record.y : 80,
          config:
            record.config != null && typeof record.config === 'object'
              ? (record.config as Record<string, unknown>)
              : {},
        }]
      })
    : []
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
        if (edge == null || typeof edge !== 'object') return []
        const record = edge as Record<string, unknown>
        const from = typeof record.from === 'string' ? record.from : ''
        const to = typeof record.to === 'string' ? record.to : ''
        if (!from || !to) return []
        return [{
          id: typeof record.id === 'string' ? record.id : `${from}-${to}`,
          from,
          to,
        }]
      })
    : []
  return { nodes, edges }
}

function isProtocolPermissionMode(value: string): value is ManagedAgent['permissionMode'] {
  return (
    value === 'claude-ask' ||
    value === 'claude-auto-edits' ||
    value === 'claude-plan' ||
    value === 'claude-auto' ||
    value === 'claude-bypass' ||
    value === 'codex-default' ||
    value === 'codex-auto-review' ||
    value === 'codex-full-access'
  )
}

function isProtocolReasoning(value: string): value is ManagedAgent['reasoningEffort'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

function isWorkflowNodeKind(kind: string): kind is ProtocolWorkflowItem['graph']['nodes'][number]['kind'] {
  return (
    kind === 'input' ||
    kind === 'agent' ||
    kind === 'skill' ||
    kind === 'tool' ||
    kind === 'mcp' ||
    kind === 'approval' ||
    kind === 'review' ||
    kind === 'artifact'
  )
}

async function getWorkspaceBranches(
  rootPath: string,
): Promise<{ currentBranch: string | null; branches: string[] }> {
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

// ─── Hook Helper Functions ─────────────────────────────────────────────────

type HookNodeConfig = { sound: boolean; notification: boolean }
type HookConfigInternal = {
  enabled: boolean
  nodes: Record<HookNode, HookNodeConfig>
}

const DEFAULT_HOOK_CONFIG_INTERNAL: HookConfigInternal = {
  enabled: true,
  nodes: {
    permission_request: { sound: true, notification: true },
    ask_user_question: { sound: true, notification: true },
    session_end: { sound: true, notification: true },
    session_fail: { sound: true, notification: true },
  },
}

function parseHookConfig(
  value: unknown,
  defaults: HookConfigInternal = DEFAULT_HOOK_CONFIG_INTERNAL,
): HookConfigInternal {
  if (value == null || typeof value !== 'object') {
    return defaults
  }
  try {
    const config = value as Partial<HookConfigInternal>
    return {
      enabled: config.enabled ?? defaults.enabled,
      nodes: {
        ...defaults.nodes,
        ...(config.nodes ?? {}),
      },
    }
  } catch {
    return defaults
  }
}

function getNodeDefaultTitle(node: HookNode): string {
  switch (node) {
    case 'permission_request':
      return 'Spark Agent - 权限请求'
    case 'ask_user_question':
      return 'Spark Agent - 需要您的输入'
    case 'session_end':
      return 'Spark Agent - 任务完成'
    case 'session_fail':
      return 'Spark Agent - 任务失败'
    default:
      return 'Spark Agent'
  }
}

function getNodeDefaultBody(node: HookNode): string {
  switch (node) {
    case 'permission_request':
      return 'Agent 正在请求您的审批'
    case 'ask_user_question':
      return 'Agent 需要您提供更多信息'
    case 'session_end':
      return '当前任务已完成'
    case 'session_fail':
      return '任务执行出错，请检查'
    default:
      return ''
  }
}

function showSystemNotification(title: string, body: string): void {
  // 检查系统是否支持通知
  if (!Notification.isSupported()) {
    log.warn('System notifications are not supported on this platform')
    return
  }

  const notification = new Notification({
    title,
    body,
    silent: true, // 不播放系统默认声音（我们已经单独处理 sound）
  })

  notification.on('click', () => {
    // 点击通知时聚焦窗口
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  notification.show()
}

// ─── Playwright Status Builder ───────────────────────────────────────────

/**
 * Build a full Playwright status response by combining integrity detection,
 * MCP registration state, and browser view runtime state.
 */
function buildPlaywrightStatus(): import('@spark/protocol').PlaywrightStatusResponse {
  const integrity = detectIntegrity()
  const registration = readRegistration(getDatabase())
  return {
    mcpInstalled: integrity.mcpInstalled,
    mcpVersion: integrity.mcpVersion,
    playwrightInstalled: integrity.playwrightInstalled,
    browserReady: integrity.browserReady,
    browserSource: integrity.browserSource,
    mcpRegistered: registration.registered,
    mcpEnabled: registration.enabled,
    mode: registration.mode,
    viewOpen: isViewOpen(),
    cdpEndpoint: getCdpEndpoint(),
    lastError: integrity.lastError,
  }
}
