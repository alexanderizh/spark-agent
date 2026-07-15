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
import {
  buildCanvasMediaProviderPrompt,
  buildCanvasRuntimeRequest,
  buildCanvasSystemPrompt,
} from './canvas-prompt-runtime.js'
import {
  buildCanvasTextRawResponse,
  resolveCanvasTextTokenBudget,
} from './canvasTextTaskDiagnostics.js'
import { PendingUserQuestionStore } from './user-question-store.js'
import { getCanvasHostBridge } from '../canvas-host-bridge.js'
import { getCanvasWindowService } from '../services/CanvasWindowService.js'
import {
  isSessionServiceShutdownStarted,
  registerSessionServiceForShutdown,
} from '../session-service-shutdown.js'
import { app, clipboard, dialog, shell, Notification, screen } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createLogger,
  deriveTeamAvatar,
  normalizeEduAssetUrl,
  setLogLevel,
  initFileLogger,
  readLogTail,
  clearLogFile,
  getLogInfo,
  SparkError,
} from '@spark/shared'
import { getAppSkillsManager } from '../services/AppSkillsManager.js'
import { HistoryImportService } from '../services/HistoryImport/HistoryImportService.js'
import type { ImportProviderResolution } from '../services/HistoryImport/HistoryImportService.js'
import { registerAuthIpc } from '../services/Auth/registerAuthIpc.js'
import { isCommand, parseCommand } from '@spark/agent-runtime'
import {
  EventRepository,
  ProviderProfileRepository,
  MediaModelManifestRepository,
  MediaGenerationTaskRepository,
  CanvasProjectRepository,
  CanvasSnapshotRepository,
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
  TeamDefinitionRepository,
  DEFAULT_MAX_DISCUSSION_ROUNDS,
  ScheduledTaskRepository,
  TaskExecutionRepository,
  MemoryRepository,
  MemoryEntityRepository,
  MemorySearchRepository,
} from '@spark/storage'
import type {
  AgentItem as StorageAgentItem,
  WorkflowItem as StorageWorkflowItem,
  AgentTeamItem as StorageAgentTeamItem,
  MemoryEntryRow,
} from '@spark/storage'
import {
  ProviderService,
  resolveProviderApiKeyForProfile,
  RulesService,
  RuleCompositionEngine,
  SessionService,
  WorkspaceService,
  GitWorktreeService,
  generateWorktreeName,
  sanitizeBranchSlug,
  PermissionService,
  ModelService,
  McpService,
  SkillService,
  SkillRegistryService,
  SettingsService,
  UsageLedgerService,
  RuntimeCompositionService,
  MediaRouterService,
  MediaModelCatalogService,
  MediaTaskRuntimeService,
  CanvasTextProviderError,
  generateCanvasText,
  resolveProfileMediaModels,
  MemoryStoreService,
  MemoryWriterService,
  EmbeddingService,
} from '@spark/agent-runtime'
import type {
  MediaProviderProfile as MediaProviderProfileRuntime,
  MediaTaskRecord,
  MediaProviderError,
} from '@spark/agent-runtime'
import * as keystore from '@spark/shared/keystore'
import { ScheduledTaskService } from '@spark/agent-runtime'
import type { TaskExecutorFn } from '@spark/agent-runtime'
import { compileMediaRequest } from '@spark/agent-runtime'
import type {
  CommandParseResponse,
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
  WorkspaceInfo,
  HookNode,
  PlaywrightInstallProgress,
  ManagedAgent,
  WorkflowItem as ProtocolWorkflowItem,
  WorkflowGraph,
  WorkflowOrientation,
  ProviderExportPayload,
  ScheduledTaskExportPayload,
  TeamModeConfig,
  TeamMemberCard,
  ManagedTeam,
  TeamA2ATask,
  TeamA2AReply,
  HistoryImportSource,
  HistoryImportProgress,
  CanvasMediaModelSummary,
  ProviderIconConfig,
  CanvasMediaTaskCreateResponse,
  CanvasTextTaskCreateResponse,
  BoardTask,
  BoardComment,
  BoardTaskAttachment,
  MediaModelManifest,
  ProviderProfile,
  MemoryEntry,
  MemoryScope,
  MemoryType,
  SkillInstallJobSource,
  SkillInstallStatusItem,
  FfmpegInstallProgress,
  VideoProcessRequest,
  VideoProcessResponse,
  VideoProcessProgress,
} from '@spark/protocol'
import type {
  CanvasAssetDownloadBatchResultItem,
  PermissionApprovalDecision,
  SessionListResponse,
  SystemNotificationNavigateRequest,
} from '@spark/protocol'
import { MediaModelManifestSchema, isAutoRouterProvider } from '@spark/protocol'
import { McpOAuthService } from '../services/mcp-oauth/McpOAuthService.js'
import type {
  SessionEventHandler,
  ApprovalHandler,
  SessionQueueChangedHandler,
  QuestionHandler,
  HookTriggerHandler,
  SessionRenamedHandler,
  PlatformConfigChangedHandler,
  BrowserAutomationMcpProvider,
} from '@spark/agent-runtime'
import { getFileWatcherService } from '../services/FileWatcherService.js'
import { isSafeFilePathAllowed, toSafeFileUrl } from '../services/SafeFileProtocol.js'
import { isPathStrictlyInsideRoot } from '../services/CanvasProjectPath.js'
import { getUpdateService } from '../services/UpdateService.js'
import { detectExternalTools, openProjectInTool } from '../services/ExternalToolService.js'
import { checkSdkIntegrity, installSdk } from '../services/SdkIntegrityService.js'
import { getTerminalService } from '../services/TerminalService.js'
import { registerTerminalIpc } from './registerTerminalIpc.js'
import { registerPlatformModelIpc } from '../services/PlatformModel/registerPlatformModelIpc.js'
import {
  getGitExecErrorMessage,
  getWorkspaceBranches,
  getWorkspaceGitFileDiff,
  getWorkspaceGitStatus,
  pushWorkspaceBranch,
  tryGitStdout,
} from './workspace-git-status.js'
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
  detectFfmpegIntegrity,
  installFfmpeg,
  getCachedFfmpegIntegrity,
} from '../services/FfmpegIntegrityService.js'
import { handleVideoProcess } from '../services/videoProcessHandler.js'
import {
  ensureRegistered,
  readRegistration,
  setEnabled as setPlaywrightEnabled,
} from '../services/PlaywrightMcpRegistration.js'
import { getBrowserBridgeServer } from '../services/BrowserBridgeServer.js'
import { RemoteConnectionService } from '../services/RemoteConnectionService.js'
import type { RemoteInboundMessage } from '../services/RemoteConnectionService.js'
import { registerGitHubConnectorIpc } from '../services/GitHubConnector/registerGitHubConnectorIpc.js'
import { getDatabase, getDatabasePath } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { getWindowForIpcSender } from './window-controls.js'
import { applyHunkPatch } from '../services/FilePatchService.js'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

const log = createLogger('ipc:register')
const execFileAsync = promisify(execFile)
const AUTO_WINDOW_WIDTH_TOLERANCE = 12
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'
const NO_PROJECT_WORKSPACE_NAME = '不使用项目'
const skillInstallStatusByKey = new Map<string, SkillInstallStatusItem>()

function skillInstallStatusKey(source: SkillInstallJobSource, slug: string): string {
  return `${source}:${slug}`
}

function setSkillInstallStatus(status: SkillInstallStatusItem): void {
  skillInstallStatusByKey.set(skillInstallStatusKey(status.source, status.slug), status)
}

function updateSkillInstallProgress(
  source: SkillInstallJobSource,
  slug: string,
  downloaded: number,
  total: number,
): void {
  const existing = skillInstallStatusByKey.get(skillInstallStatusKey(source, slug))
  setSkillInstallStatus({
    slug,
    source,
    state: 'installing',
    downloaded,
    total,
    updatedAt: new Date().toISOString(),
    ...(existing?.skillId ? { skillId: existing.skillId } : {}),
    ...(existing?.skillName ? { skillName: existing.skillName } : {}),
  })
}

function resolveBrowserAutomationMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/browser-automation-mcp-server.mjs'),
    path.resolve(here, '../tools/browser-automation-mcp-server.mjs'),
    path.resolve(here, '../../../../packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs'),
    path.resolve(process.cwd(), '../packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs'),
    path.resolve(process.resourcesPath ?? '', 'tools/browser-automation-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const browserAutomationMcpProvider: BrowserAutomationMcpProvider = async (sessionId, workspaceRootPath) => {
  const remoteConnection = getRemoteConnectionService()
    .list()
    .connections.find((connection) => connection.defaultSessionId === sessionId)
  if (remoteConnection != null && remoteConnection.capabilities.useInternalBrowser !== true) {
    log.info(`spark_browser disabled for remote session=${sessionId} connection=${remoteConnection.id}`)
    return null
  }
  const serverPath = resolveBrowserAutomationMcpServerPath()
  if (serverPath == null) {
    log.warn('spark_browser MCP server script not found')
    return null
  }
  const bridge = getBrowserBridgeServer()
  const port = await bridge.start()
  bridge.allowSid(sessionId)
  return {
    type: 'stdio',
    command: process.execPath,
    args: [serverPath],
    cwd: workspaceRootPath,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      SPARK_BROWSER_PORT: String(port),
      SPARK_BROWSER_SID: sessionId,
    },
  }
}

let autoWindowWidthState: { baselineWidth: number; managedWidth: number } | null = null

type ConfigChangedScope = 'provider' | 'model' | 'agent' | 'team' | 'skill' | 'mcp' | 'workflow' | 'rule' | 'prompt'
type ConfigChangedAction = 'create' | 'update' | 'delete' | 'import'

function pushConfigChanged(
  scope: ConfigChangedScope,
  action: ConfigChangedAction,
  id?: string,
): void {
  pushStreamEvent('stream:config:changed', {
    scope,
    action,
    ...(id !== undefined ? { id } : {}),
  })
}

function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

function getModelService(): ModelService {
  return new ModelService(new ModelProfileRepository(getDatabase()))
}

/** MediaRouterService 单例（无状态，可安全复用） */
let mediaRouterService: MediaRouterService | null = null
function getMediaRouterService(): MediaRouterService {
  if (mediaRouterService == null) mediaRouterService = new MediaRouterService()
  return mediaRouterService
}

/** 多媒体模型能力清单服务（seed 内置 manifest，供画布/工具查询） */
let mediaModelCatalogService: MediaModelCatalogService | null = null
let mediaModelCatalogSeeded = false
function getMediaModelCatalogService(): MediaModelCatalogService {
  if (mediaModelCatalogService == null) {
    mediaModelCatalogService = new MediaModelCatalogService(
      new MediaModelManifestRepository(getDatabase()),
    )
  }
  if (!mediaModelCatalogSeeded) {
    mediaModelCatalogService.seedBuiltinManifests()
    mediaModelCatalogSeeded = true
  }
  return mediaModelCatalogService
}

let mediaTaskRuntimeService: MediaTaskRuntimeService | null = null
function getMediaTaskRuntimeService(): MediaTaskRuntimeService {
  if (mediaTaskRuntimeService == null) {
    mediaTaskRuntimeService = new MediaTaskRuntimeService(
      new MediaGenerationTaskRepository(getDatabase()),
      getMediaRouterService(),
    )
  }
  return mediaTaskRuntimeService
}

/** 画布多媒体产物默认落盘根目录 */
function getDefaultCanvasMediaDir(): string {
  return path.join(app.getPath('userData'), '.spark-artifacts', 'media')
}

type CanvasAssetKind = 'image' | 'audio' | 'video' | 'file'

const CANVAS_SETTINGS_CATEGORY = 'canvas'
const CANVAS_SETTINGS_KEY = 'data'

function getCanvasSettingsValue(): { projectsRootPath?: string } {
  const raw = getSettingsService().get(CANVAS_SETTINGS_CATEGORY, CANVAS_SETTINGS_KEY)
  if (raw && typeof raw === 'object') return raw as { projectsRootPath?: string }
  return {}
}

function getDefaultCanvasProjectsRoot(): string {
  const configured = getCanvasSettingsValue().projectsRootPath?.trim()
  return configured
    ? path.resolve(configured)
    : path.join(app.getPath('userData'), 'canvas-projects')
}

function sanitizeCanvasPathSegment(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (cleaned || fallback).slice(0, 80)
}

function canvasAssetSubdir(kind: CanvasAssetKind | undefined): string {
  if (kind === 'image') return 'images'
  if (kind === 'video') return 'videos'
  if (kind === 'audio') return 'audio'
  return 'files'
}

function extensionFromMimeType(
  mimeType: string | undefined,
  kind: CanvasAssetKind | undefined,
): string {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg')) return kind === 'audio' ? 'mp3' : 'mpg'
  if (mime.includes('wav')) return 'wav'
  if (kind === 'video') return 'mp4'
  if (kind === 'audio') return 'mp3'
  if (kind === 'image') return 'png'
  return 'bin'
}

function guessAssetKindFromPath(filePath: string): CanvasAssetKind {
  const ext = path.extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.heic', '.heif'].includes(ext))
    return 'image'
  if (['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) return 'video'
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'].includes(ext)) return 'audio'
  return 'file'
}

function decodeSafeFileUrl(url: string | undefined): string | null {
  if (!url?.startsWith('safe-file://')) return null
  try {
    const rest = url.slice('safe-file://'.length)
    const slashIdx = rest.indexOf('/')
    if (slashIdx < 0) return null
    const encoded = rest.slice(slashIdx + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    return path.isAbsolute(decoded) ? decoded : null
  } catch {
    return null
  }
}

async function ensureCanvasProjectDirectory(input: {
  projectId: string
  title?: string
  parentDirectory?: string
  rootPath?: string | null
}): Promise<{ rootPath: string; created: boolean; assetsDir: string; snapshotsDir: string }> {
  const existing = input.rootPath?.trim()
  const rootPath = existing
    ? path.resolve(existing)
    : path.join(
        path.resolve(input.parentDirectory?.trim() || getDefaultCanvasProjectsRoot()),
        `${sanitizeCanvasPathSegment(input.title, 'canvas-project')}-${input.projectId}`,
      )
  let created = false
  try {
    await fs.access(rootPath)
  } catch {
    created = true
  }
  const assetsDir = path.join(rootPath, 'assets')
  const snapshotsDir = path.join(rootPath, 'snapshots')
  await fs.mkdir(path.join(assetsDir, 'images'), { recursive: true })
  await fs.mkdir(path.join(assetsDir, 'videos'), { recursive: true })
  await fs.mkdir(path.join(assetsDir, 'audio'), { recursive: true })
  await fs.mkdir(path.join(assetsDir, 'files'), { recursive: true })
  await fs.mkdir(path.join(rootPath, 'thumbnails'), { recursive: true })
  await fs.mkdir(path.join(rootPath, 'tasks'), { recursive: true })
  await fs.mkdir(path.join(rootPath, 'exports'), { recursive: true })
  await fs.mkdir(snapshotsDir, { recursive: true })
  return { rootPath, created, assetsDir, snapshotsDir }
}

async function ensureCanvasProjectDirectoryById(
  projectId: string,
  rootPath?: string | null,
  title?: string,
): Promise<{ rootPath: string; created: boolean; assetsDir: string; snapshotsDir: string }> {
  const row = getCanvasProjectRepo().get(projectId)
  return ensureCanvasProjectDirectory({
    projectId,
    title: title ?? row?.title ?? projectId,
    rootPath: rootPath ?? row?.root_path ?? null,
  })
}

/**
 * 判断 rootPath 是否严格位于 canvas-projects 根目录之下。
 *
 * 仅这一层校验通过才允许删除 —— 防止 root_path 被篡改或迁移残留时
 * 误删用户其他目录（如 userData 根、用户主目录）。
 *
 * 纯路径比较逻辑见 {@link CanvasProjectPath.isPathStrictlyInsideRoot}（已抽出便于单测）。
 */
export function isInsideCanvasProjectsRoot(rootPath: string | null | undefined): boolean {
  return isPathStrictlyInsideRoot(rootPath, getDefaultCanvasProjectsRoot())
}

/**
 * 递归删除画布项目目录。
 *
 * 安全约束：rootPath 必须位于 canvas-projects 根之下（{@link isInsideCanvasProjectsRoot}），
 * 否则拒绝删除。文件系统错误不抛出 —— DB 删除仍要继续，仅日志记录失败。
 * 返回是否实际移除了目录（不存在视为未移除）。
 */
async function removeCanvasProjectDirectory(
  rootPath: string | null | undefined,
): Promise<boolean> {
  if (!isInsideCanvasProjectsRoot(rootPath)) {
    if (rootPath && rootPath.trim()) {
      log.warn(
        `canvas:project:delete refused to remove path outside projects root: ${rootPath}`,
      )
    }
    return false
  }
  const resolved = path.resolve(rootPath!.trim())
  try {
    await fs.access(resolved)
  } catch {
    return false // 目录不存在，视为无需删除
  }
  try {
    await fs.rm(resolved, { recursive: true, force: true })
    return true
  } catch (err) {
    log.error(`canvas:project:delete failed to remove project directory: ${resolved}`, err)
    return false
  }
}

function parseDataUrl(
  dataUrl: string,
  fallbackMimeType?: string,
): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/)
  if (match == null) throw new Error('Invalid data URL')
  const mimeType = (match[1] ?? fallbackMimeType ?? 'application/octet-stream').toLowerCase()
  const payload = match[2]
  if (!payload) throw new Error('Data URL is empty')
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.length === 0) throw new Error('Data URL is empty')
  return { buffer, mimeType }
}

async function writeCanvasAssetDataUrl(input: {
  projectId: string
  projectRootPath?: string | null
  dataUrl: string
  mimeType?: string
  suggestedBaseName?: string
  type?: CanvasAssetKind
}): Promise<{ filePath: string; fileName: string; relativePath: string }> {
  const parsed = parseDataUrl(input.dataUrl, input.mimeType)
  const kind =
    input.type ??
    (parsed.mimeType.startsWith('image/')
      ? 'image'
      : parsed.mimeType.startsWith('video/')
        ? 'video'
        : parsed.mimeType.startsWith('audio/')
          ? 'audio'
          : 'file')
  const directory = await ensureCanvasProjectDirectoryById(input.projectId, input.projectRootPath)
  const fileName = `${sanitizeCanvasPathSegment(input.suggestedBaseName, 'asset')}-${crypto.randomUUID()}.${extensionFromMimeType(parsed.mimeType, kind)}`
  const relativePath = path.join('assets', canvasAssetSubdir(kind), fileName)
  const filePath = path.join(directory.rootPath, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, parsed.buffer)
  return { filePath, fileName, relativePath }
}

async function copyCanvasAssetToProject(input: {
  projectId: string
  projectRootPath?: string | null
  sourcePath?: string
  sourceUrl?: string
  suggestedBaseName?: string
  type?: CanvasAssetKind
}): Promise<{
  copied: boolean
  filePath?: string
  fileName?: string
  relativePath?: string
  error?: string
}> {
  const decodedSource = decodeSafeFileUrl(input.sourceUrl)
  const sourcePath = input.sourcePath ?? decodedSource ?? undefined
  if (!sourcePath) return { copied: false, error: 'sourcePath is required' }
  const resolvedSource = path.resolve(sourcePath)
  try {
    const stat = await fs.stat(resolvedSource)
    if (!stat.isFile()) return { copied: false, error: 'source is not a file' }
    const directory = await ensureCanvasProjectDirectoryById(input.projectId, input.projectRootPath)
    if (
      resolvedSource === directory.rootPath ||
      resolvedSource.startsWith(directory.rootPath + path.sep)
    ) {
      return {
        copied: false,
        filePath: resolvedSource,
        fileName: path.basename(resolvedSource),
        relativePath: path.relative(directory.rootPath, resolvedSource),
      }
    }
    const kind = input.type ?? guessAssetKindFromPath(resolvedSource)
    const ext = path.extname(resolvedSource) || `.${extensionFromMimeType(undefined, kind)}`
    const fileName = `${sanitizeCanvasPathSegment(input.suggestedBaseName ?? path.basename(resolvedSource, ext), 'asset')}-${crypto.randomUUID()}${ext}`
    const relativePath = path.join('assets', canvasAssetSubdir(kind), fileName)
    const filePath = path.join(directory.rootPath, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.copyFile(resolvedSource, filePath)
    return { copied: true, filePath, fileName, relativePath }
  } catch (err) {
    return { copied: false, error: err instanceof Error ? err.message : String(err) }
  }
}

type CanvasAssetDownloadKind = CanvasAssetKind | 'text' | 'prompt'

type CanvasAssetDownloadSource =
  | { kind: 'file'; sourcePath: string }
  | { kind: 'buffer'; buffer: Buffer; mimeType?: string }

type CanvasMigratedAssetRef = {
  id?: string
  url?: string
  thumbnailUrl?: string
  storageKey?: string
}

function kindFromCanvasDownloadType(
  type: CanvasAssetDownloadKind | undefined,
): CanvasAssetKind | undefined {
  if (type === 'image' || type === 'audio' || type === 'video' || type === 'file') return type
  return undefined
}

function fileExtensionFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return path.extname(parsed.pathname)
  } catch {
    return path.extname(url.split(/[?#]/)[0] ?? '')
  }
}

function ensureFileNameExtension(
  value: string | undefined,
  input: {
    mimeType?: string | null
    type?: CanvasAssetDownloadKind
    sourcePath?: string
    sourceUrl?: string
  },
): string {
  const baseName = sanitizeCanvasPathSegment(value?.replace(/\.[^.]+$/, ''), 'canvas-asset')
  const existingExt =
    path.extname(value ?? '') ||
    path.extname(input.sourcePath ?? '') ||
    fileExtensionFromUrl(input.sourceUrl)
  const ext =
    existingExt ||
    `.${extensionFromMimeType(input.mimeType ?? undefined, kindFromCanvasDownloadType(input.type))}`
  return `${baseName}${ext}`
}

function canvasAssetDownloadFilters(
  type: CanvasAssetDownloadKind | undefined,
): Electron.FileFilter[] {
  if (type === 'image') {
    return [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: '所有文件', extensions: ['*'] },
    ]
  }
  if (type === 'video') {
    return [
      { name: '视频', extensions: ['mp4', 'mov', 'webm', 'm4v'] },
      { name: '所有文件', extensions: ['*'] },
    ]
  }
  if (type === 'audio') {
    return [
      { name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
      { name: '所有文件', extensions: ['*'] },
    ]
  }
  if (type === 'text' || type === 'prompt') {
    return [
      { name: '文本', extensions: ['txt', 'md'] },
      { name: '所有文件', extensions: ['*'] },
    ]
  }
  return [{ name: '所有文件', extensions: ['*'] }]
}

async function resolveCanvasAssetDownloadSource(input: {
  sourcePath?: string
  sourceUrl?: string
  contentText?: string
  mimeType?: string | null
}): Promise<CanvasAssetDownloadSource> {
  const decodedPath = decodeSafeFileUrl(input.sourceUrl)
  const sourcePath = input.sourcePath ?? decodedPath ?? undefined
  if (sourcePath) {
    const resolvedSource = path.resolve(sourcePath)
    const stat = await fs.stat(resolvedSource)
    if (!stat.isFile()) throw new Error('源文件不是文件')
    if (!isSafeFilePathAllowed(resolvedSource)) throw new Error('源文件不在允许范围内')
    return { kind: 'file', sourcePath: resolvedSource }
  }

  const sourceUrl = input.sourceUrl?.trim()
  if (sourceUrl?.startsWith('data:')) {
    const parsed = parseDataUrl(sourceUrl, input.mimeType ?? undefined)
    return { kind: 'buffer', buffer: parsed.buffer, mimeType: parsed.mimeType }
  }

  if (sourceUrl?.startsWith('http://') || sourceUrl?.startsWith('https://')) {
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`下载远程资产失败：HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error('远程资产为空')
    const mimeType = response.headers.get('content-type') ?? input.mimeType ?? undefined
    return {
      kind: 'buffer',
      buffer,
      ...(mimeType !== undefined ? { mimeType } : {}),
    }
  }

  if (input.contentText != null) {
    const mimeType = input.mimeType ?? 'text/plain'
    return {
      kind: 'buffer',
      buffer: Buffer.from(input.contentText, 'utf8'),
      mimeType,
    }
  }

  throw new Error('资产没有可下载内容')
}

/**
 * 批量下载时为文件名去重：若 baseName 已在 used 中，在扩展名前插入 -1/-2/… 序号，
 * 直到不冲突。比较统一走小写以兼容大小写不敏感的文件系统。
 */
function dedupeBatchFileName(baseName: string, used: Set<string>): string {
  const lowerBase = baseName.toLowerCase()
  if (!used.has(lowerBase)) return baseName
  const dotIndex = baseName.lastIndexOf('.')
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : ''
  let seq = 1
  let candidate: string
  let candidateLower: string
  do {
    candidate = `${stem}-${seq}${ext}`
    candidateLower = candidate.toLowerCase()
    seq += 1
  } while (used.has(candidateLower))
  return candidate
}

function collectCanvasSnapshotLocalPaths(snapshot: any): Set<string> {
  const paths = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) return
    const decoded = decodeSafeFileUrl(value)
    if (decoded) paths.add(path.resolve(decoded))
    else if (path.isAbsolute(value)) paths.add(path.resolve(value))
  }
  for (const asset of Array.isArray(snapshot?.assets) ? snapshot.assets : []) {
    add(asset?.storageKey)
    add(asset?.thumbnailKey)
    add(asset?.url)
    add(asset?.thumbnailUrl)
    add(asset?.metadata?.filePath)
  }
  for (const node of Array.isArray(snapshot?.nodes) ? snapshot.nodes : []) {
    add(node?.data?.url)
    add(node?.data?.thumbnailUrl)
  }
  return paths
}

function rewriteCanvasSnapshotRootPaths(value: unknown, fromRoot: string, toRoot: string): unknown {
  if (typeof value === 'string') {
    const decoded = decodeSafeFileUrl(value)
    if (decoded && path.resolve(decoded).startsWith(fromRoot + path.sep)) {
      return toSafeFileUrl(path.join(toRoot, path.relative(fromRoot, path.resolve(decoded))))
    }
    if (path.isAbsolute(value) && path.resolve(value).startsWith(fromRoot + path.sep)) {
      return path.join(toRoot, path.relative(fromRoot, path.resolve(value)))
    }
    return value
  }
  if (Array.isArray(value))
    return value.map((item) => rewriteCanvasSnapshotRootPaths(item, fromRoot, toRoot))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      rewriteCanvasSnapshotRootPaths(child, fromRoot, toRoot),
    ]),
  )
}

async function writeCanvasProjectPackageFiles(input: {
  projectId: string
  rootPath: string
  snapshotJson: string
  exportedAt?: string
}): Promise<void> {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const parsed = JSON.parse(input.snapshotJson)
  const snapshot =
    parsed?.kind === 'spark.canvas.project' && parsed.snapshot ? parsed.snapshot : parsed
  if (snapshot?.project) snapshot.project.rootPath = input.rootPath
  const payload = {
    kind: 'spark.canvas.project',
    version: 2,
    exportedAt,
    app: 'Spark-Agent',
    projectRootPath: input.rootPath,
    snapshot,
  }
  const directory = await ensureCanvasProjectDirectory({
    projectId: input.projectId,
    title: snapshot?.project?.title,
    rootPath: input.rootPath,
  })
  await fs.writeFile(
    path.join(directory.rootPath, 'project.json'),
    JSON.stringify(payload, null, 2),
    'utf-8',
  )
  await fs.writeFile(
    path.join(directory.snapshotsDir, 'latest.json'),
    JSON.stringify(snapshot, null, 2),
    'utf-8',
  )
  const stamp = exportedAt.replace(/[:.]/g, '-')
  await fs.writeFile(
    path.join(directory.snapshotsDir, `${stamp}.json`),
    JSON.stringify(snapshot, null, 2),
    'utf-8',
  )
}

/** Canvas 持久化 Repository（SQLite-backed，见 migration 027） */
function getCanvasProjectRepo(): CanvasProjectRepository {
  return new CanvasProjectRepository(getDatabase())
}
function getCanvasSnapshotRepo(): CanvasSnapshotRepository {
  return new CanvasSnapshotRepository(getDatabase())
}

/**
 * 解析所有已启用且声明了多媒体能力的 provider，附带从 Keychain 读取的 apiKey。
 * 失败的（无 key / 无能力）静默跳过。
 */
async function resolveCanvasMediaProviders(): Promise<MediaProviderProfileRuntime[]> {
  const profiles = await getProviderService().listProviders()
  const catalog = getMediaModelCatalogService()
  const result: MediaProviderProfileRuntime[] = []
  for (const profile of profiles) {
    const caps = profile.mediaCapabilities ?? []
    const mediaModelManifests = resolveProfileMediaModels(profile, catalog, {
      enabledOnly: true,
    }).map((resolved) => resolved.manifest)
    const isMediaModel =
      profile.modelType === 'image' ||
      profile.modelType === 'voice' ||
      profile.modelType === 'video'
    if (!isMediaModel && caps.length === 0 && mediaModelManifests.length === 0) continue
    if (!profile.keystoreRef) continue
    try {
      const apiKey = await resolveProviderApiKeyForProfile(profile)
      if (!apiKey || apiKey.trim().length === 0) continue
      result.push({
        id: profile.id,
        name: profile.name,
        defaultModel: profile.defaultModel,
        ...(profile.modelIds ? { modelIds: profile.modelIds } : {}),
        ...(profile.apiEndpoint ? { apiEndpoint: profile.apiEndpoint } : {}),
        mediaProvider: profile.mediaProvider ?? null,
        mediaApiType: profile.mediaApiType ?? 'auto',
        mediaCapabilities: caps,
        ...(mediaModelManifests.length > 0 ? { mediaModelManifests } : {}),
        ...(profile.mediaDefaults ? { mediaDefaults: profile.mediaDefaults } : {}),
        apiKey,
      })
    } catch {
      // 单个 provider 解析失败不阻断整体
    }
  }
  return result
}

function toCanvasMediaModelSummary(
  manifest: MediaModelManifest,
  options?: {
    providerProfileId?: string
    providerName?: string
    providerIcon?: ProviderIconConfig
    effectiveModelId?: string
    defaults?: Record<string, unknown>
    enabled?: boolean
  },
): CanvasMediaModelSummary {
  const capabilities = manifest.capabilities.map((capability) => {
    const item: CanvasMediaModelSummary['capabilities'][number] = {
      id: capability.id,
      label: capability.label,
      input: capability.input,
      output: capability.output,
      paramSchema: capability.paramSchema,
    }
    if (capability.defaults !== undefined) item.defaults = capability.defaults
    return item
  })
  const summary: CanvasMediaModelSummary = {
    manifestId: manifest.id,
    providerKind: manifest.providerKind,
    modelId: manifest.modelId,
    effectiveModelId: options?.effectiveModelId ?? manifest.modelId,
    displayName: manifest.displayName,
    domains: manifest.domains,
    invocationMode: manifest.invocation.mode,
    capabilities,
    sourceUrls: manifest.docs.sourceUrls,
    enabled: options?.enabled !== false,
  }
  if (options?.providerProfileId !== undefined)
    summary.providerProfileId = options.providerProfileId
  if (options?.providerName !== undefined) summary.providerName = options.providerName
  if (options?.providerIcon !== undefined) summary.providerIcon = options.providerIcon
  if (options?.defaults !== undefined) summary.defaults = options.defaults
  return summary
}

function profileMediaModelSummaries(
  profile: ProviderProfile,
  catalog: MediaModelCatalogService,
  filters?: { capability?: string; providerKind?: string; enabledOnly?: boolean },
): CanvasMediaModelSummary[] {
  // 解析（含自定义 ref 合成、modelIds 回退守卫）下沉到 agent-runtime 的纯函数，
  // 这里只负责把解析结果映射成画布 IPC 摘要。
  return resolveProfileMediaModels(profile, catalog, filters).map((resolved) => {
    const options: Parameters<typeof toCanvasMediaModelSummary>[1] = {
      providerProfileId: profile.id,
      providerName: profile.name,
      ...(profile.providerIcon ? { providerIcon: profile.providerIcon } : {}),
      effectiveModelId: resolved.effectiveModelId,
      enabled: resolved.enabled,
    }
    if (resolved.defaults !== undefined) options.defaults = resolved.defaults
    return toCanvasMediaModelSummary(resolved.manifest, options)
  })
}

/** 把图片文件读取为 data URL，供 renderer 预览（仅小图，限制 2MB） */
async function readImagePreviewDataUrl(
  filePath: string,
  mimeType: string | undefined,
): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > 2 * 1024 * 1024) return undefined
    const buffer = await fs.readFile(filePath)
    const mime = mimeType ?? 'image/png'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return undefined
  }
}

async function canvasResponseFromMediaTaskRecord(
  record: MediaTaskRecord,
): Promise<CanvasMediaTaskCreateResponse> {
  const assets: CanvasMediaTaskCreateResponse['assets'] = await Promise.all(
    record.assets.map(async (asset) => {
      const base = {
        type: asset.type,
        ...(asset.filePath != null ? { filePath: asset.filePath } : {}),
        ...(asset.url != null ? { url: normalizeEduAssetUrl(asset.url) } : {}),
        ...(asset.mimeType != null ? { mimeType: asset.mimeType } : {}),
        ...(asset.width != null ? { width: asset.width } : {}),
        ...(asset.height != null ? { height: asset.height } : {}),
        ...(asset.durationMs != null ? { durationMs: asset.durationMs } : {}),
        ...(asset.contentText != null ? { contentText: asset.contentText } : {}),
      }
      if (asset.type === 'image' && asset.filePath) {
        const previewDataUrl = await readImagePreviewDataUrl(asset.filePath, asset.mimeType)
        if (previewDataUrl) return { ...base, previewDataUrl }
      }
      return base
    }),
  )
  const status: NonNullable<CanvasMediaTaskCreateResponse['status']> =
    record.status === 'succeeded'
      ? 'succeeded'
      : record.status === 'pending'
        ? 'running'
        : record.status
  return {
    runtimeTaskId: record.id,
    status,
    providerProfileId: record.providerProfileId ?? '',
    provider: record.providerKind ?? '',
    model: record.modelId ?? '',
    mode: record.mode ?? 'sync',
    assets,
    ...(record.requestId != null ? { requestId: record.requestId } : {}),
    ...(record.rawResponse != null ? { rawResponse: record.rawResponse } : {}),
    ...(record.requestCall != null ? { requestCall: record.requestCall } : {}),
    ...(record.error != null ? { error: record.error } : {}),
  }
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

// ─── Board Task Store (shared with MCP platform bridge) ─────────────────────

const BOARD_TASKS_FILE = path.join(homedir(), '.spark-agent', 'board-tasks.json')
const BOARD_ATTACHMENTS_DIR = path.join(path.dirname(BOARD_TASKS_FILE), 'board-attachments')

interface BoardTaskRecord {
  id: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'done' | 'accepted' | 'closed' | 'bug-fix'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee: string
  project: string
  tags: string[]
  dueDate: string
  processingAgent: string
  acceptanceCriteria: string
  testAgent: string
  commentsJson: string
  attachmentsJson: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 安全 parse JSON 字段，失败返回 fallback */
function safeParseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** BoardTaskRecord（内部存储，comments/attachments 为 JSON 字符串）→ protocol BoardTask（对象） */
function boardRecordToTask(r: BoardTaskRecord): BoardTask {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assignee: r.assignee,
    project: r.project,
    tags: r.tags,
    dueDate: r.dueDate,
    processingAgent: r.processingAgent,
    acceptanceCriteria: r.acceptanceCriteria,
    testAgent: r.testAgent,
    comments: safeParseJson<BoardComment[]>(r.commentsJson, []),
    attachments: safeParseJson<BoardTaskAttachment[]>(r.attachmentsJson, []),
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  }
}

function readBoardTasks(): BoardTaskRecord[] {
  try {
    if (!existsSync(BOARD_TASKS_FILE)) return []
    const raw: Array<Record<string, unknown>> = JSON.parse(readFileSync(BOARD_TASKS_FILE, 'utf-8'))
    let needsMigration = false
    const tasks = raw.map((t, i) => {
      if (t.sortOrder == null || typeof t.sortOrder !== 'number') {
        needsMigration = true
        return { ...t, sortOrder: i * 100 } as unknown as BoardTaskRecord
      }
      return t as unknown as BoardTaskRecord
    })
    if (needsMigration) writeBoardTasks(tasks)
    return tasks
  } catch {
    return []
  }
}

function writeBoardTasks(tasks: BoardTaskRecord[]): void {
  const dir = path.dirname(BOARD_TASKS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(BOARD_TASKS_FILE, JSON.stringify(tasks), 'utf-8')
}

function boardTaskUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function getBoardTaskAttachmentDir(taskId: string): string {
  return path.join(BOARD_ATTACHMENTS_DIR, taskId)
}

function isWithinBoardTaskAttachmentDir(taskId: string, targetPath: string): boolean {
  return isWithinDirectory(path.resolve(targetPath), path.resolve(getBoardTaskAttachmentDir(taskId)))
}

function sanitizeBoardAttachmentBaseName(value: string | undefined, fallback: string): string {
  return sanitizeCanvasPathSegment(value?.replace(/\.[^.]+$/, ''), fallback)
}

async function persistBoardAttachment(
  taskId: string,
  attachment: BoardTaskAttachment,
): Promise<BoardTaskAttachment> {
  const candidatePaths = [
    attachment.path?.trim(),
    attachment.previewPath?.trim(),
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index)

  let sourcePath: string | null = null
  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      sourcePath = candidatePath
      break
    }
  }
  if (sourcePath == null) return attachment

  const resolvedSource = path.resolve(sourcePath)
  if (isWithinBoardTaskAttachmentDir(taskId, resolvedSource)) {
    return attachment.type === 'image'
      ? { ...attachment, path: resolvedSource, previewPath: resolvedSource }
      : { ...attachment, path: resolvedSource }
  }

  const targetDir = getBoardTaskAttachmentDir(taskId)
  await fs.mkdir(targetDir, { recursive: true })
  const ext =
    path.extname(attachment.name ?? '') ||
    path.extname(resolvedSource) ||
    (attachment.type === 'image' ? '.png' : '')
  const baseName = sanitizeBoardAttachmentBaseName(
    attachment.name ?? path.basename(resolvedSource),
    attachment.type === 'image' ? 'board-image' : 'board-file',
  )
  const storedPath = path.join(targetDir, `${baseName}-${crypto.randomUUID()}${ext}`)
  await fs.copyFile(resolvedSource, storedPath)

  return attachment.type === 'image'
    ? { ...attachment, path: storedPath, previewPath: storedPath }
    : { ...attachment, path: storedPath }
}

async function persistBoardAttachments(
  taskId: string,
  attachments: BoardTaskAttachment[] | undefined,
): Promise<BoardTaskAttachment[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return []
  return Promise.all(attachments.map((attachment) => persistBoardAttachment(taskId, attachment)))
}

async function removeBoardTaskAttachments(taskId: string): Promise<void> {
  try {
    await fs.rm(getBoardTaskAttachmentDir(taskId), { recursive: true, force: true })
  } catch (err) {
    log.warn(`Failed to remove board attachments for task ${taskId}: ${String(err)}`)
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
  const shouldRelocate =
    currentRoot !== desiredRoot && (!currentExists || isTemporaryWorkspaceRoot(currentRoot))

  if (shouldRelocate) {
    await fs.mkdir(getPersistentProjectsDir(), { recursive: true })
    const updated = await workspaceService.relocateWorkspace(workspace.id, {
      rootPath: desiredRoot,
      relocatedFrom: [currentRoot],
    })
    log.info(
      `Relocated no-project workspace ${workspace.id} to persistent path ${updated.root_path}`,
    )
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
    log.warn(
      `Failed to ensure no-project directory: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function ensureSessionWorkspacePaths(sessionId: string): Promise<void> {
  const sessionRepo = new SessionRepository(getDatabase())
  const session = sessionRepo.get(sessionId)
  if (session == null) return
  const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
  await Promise.all(workspaceIds.map((workspaceId) => ensureNoProjectWorkspacePath(workspaceId)))
}

/**
 * Look up the no-project workspace id by name ('不使用项目').
 *
 * Used as a fallback when a scheduled task has no workspaceId set, so triggered
 * sessions land in the same default workspace as ad-hoc chats and remain visible
 * in the session sidebar. Returns null if no such workspace exists yet.
 */
function getNoProjectWorkspaceId(): string | null {
  const rows = new WorkspaceRepository(getDatabase()).listAll(100, 0, { includeArchived: true })
  const found = rows.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME)
  return found?.id ?? null
}

let _mcpService: McpService | null = null
export function getMcpService(): McpService {
  if (_mcpService == null) {
    _mcpService = new McpService(new McpServerRepository(getDatabase()), getMcpOAuthService())
  }
  return _mcpService
}


let _mcpOAuthService: McpOAuthService | null = null
function getMcpOAuthService(): McpOAuthService {
  if (_mcpOAuthService == null) {
    _mcpOAuthService = new McpOAuthService({ get: (id) => { const row = new McpServerRepository(getDatabase()).get(id); return row == null ? null : { id: row.id, configJson: row.config_json } } })
  }
  return _mcpOAuthService
}


function extractMcpOAuthStaticClient(configJson: string): { configJson: string; clientId?: string; clientSecret?: string; hasClientSecret: boolean } {
  try {
    const config = JSON.parse(configJson) as Record<string, unknown>
    const auth = config.auth != null && typeof config.auth === 'object' ? config.auth as Record<string, unknown> : null
    if (auth?.type !== 'oauth2') return { configJson, hasClientSecret: false }
    const clientId = typeof auth.clientId === 'string' ? auth.clientId : undefined
    const clientSecret = typeof auth.clientSecret === 'string' ? auth.clientSecret : undefined
    if (clientSecret != null) delete auth.clientSecret
    if (clientSecret != null || auth.hasClientSecret != null) auth.hasClientSecret = clientSecret != null && clientSecret.length > 0
    return { configJson: JSON.stringify(config), ...(clientId != null ? { clientId } : {}), ...(clientSecret != null ? { clientSecret } : {}), hasClientSecret: clientSecret != null && clientSecret.length > 0 }
  } catch {
    return { configJson, hasClientSecret: false }
  }
}

function getSkillService(): SkillService {
  const { bundledDir } = getAppSkillsManager()
  return new SkillService(new SkillRepository(getDatabase()), bundledDir)
}

/**
 * 用当前已启用的技能重建 SDK 原生托管插件目录。
 * 仅纳入磁盘上真实存在 SKILL.md 的技能（内置/用户/软链/已落盘市场技能）。
 */
export function rebuildManagedSkillsPlugin(): void {
  try {
    const manager = getAppSkillsManager()
    const enabled = getSkillService()
      .listSkills()
      .filter((s) => s.enabled && s.rootPath != null && !s.rootPath.includes('://'))
      .map((s) => ({ name: s.name, rootPath: s.rootPath }))
    manager.buildManagedPluginDir(enabled)
  } catch (err) {
    log.warn(`rebuildManagedSkillsPlugin failed: ${String(err)}`)
  }
}

/**
 * 应用启动时初始化技能系统：
 *   1. 自动软链宿主机 ~/.claude|~/.codex 技能到 _links 并登记入库（默认可用）
 *   2. 登记/刷新内置技能
 *   3. 重建 SDK 原生托管插件目录
 *   4. 把托管插件目录注入 SessionService，启用 Claude 原生渐进式披露
 */
export function initializeAppSkills(): void {
  try {
    const manager = getAppSkillsManager()
    const skillService = getSkillService()

    // 1. 内置技能登记/刷新（先做，保证 builtin:* 行存在，参与后续去重的"规范名"集合）
    skillService.ensureBuiltInSkills()

    // 2. 宿主机 Claude/Codex 技能自动软链 + 登记（默认启用）
    const hostLinks = manager.autoImportHostSkills()
    for (const link of hostLinks) {
      try {
        skillService.importLocalDirectory(link.linkPath, 'linked')
      } catch (err) {
        log.warn(`Failed to register host skill ${link.linkPath}: ${String(err)}`)
      }
    }

    // 3. 清理重复的宿主软链行（与内置/已装/本地导入同名，或软链彼此同名）
    const pruned = skillService.pruneDuplicateLinkedSkills()

    // 4. 重建托管插件目录（仅含去重后的已启用技能）
    rebuildManagedSkillsPlugin()

    // 5. 注入插件目录（Claude 原生渐进式披露）
    getSessionService().setSkillsPluginDir(manager.managedPluginDir)
    // 6. 注入用户技能落盘目录：bridge（agent 经 MCP skills_install）安装技能时据此落盘真实磁盘，
    //    否则 SkillRegistryService 会回落虚拟 registry:// 路径，导致 agent 装了也用不上。
    getSessionService().setUserSkillsDir(manager.userDir)
    log.info(
      `App skills initialized: ${hostLinks.length} host skill(s) linked, ${pruned} duplicate(s) pruned`,
    )
  } catch (err) {
    log.warn(`initializeAppSkills failed: ${String(err)}`)
  }
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

let _remoteConnectionService: RemoteConnectionService | null = null
let _remoteConnectionChangeHookRegistered = false
function getRemoteConnectionService(): RemoteConnectionService {
  if (_remoteConnectionService == null) {
    _remoteConnectionService = new RemoteConnectionService(getSettingsService())
  }
  if (!_remoteConnectionChangeHookRegistered) {
    _remoteConnectionChangeHookRegistered = true
    _remoteConnectionService.onChange((event) => {
      pushStreamEvent('stream:remote:changed', event)
    })
  }
  return _remoteConnectionService
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
    const binaryDir = path.join(app.getPath('userData'), 'bin')
    _skillRegistryService = new SkillRegistryService(
      getDatabase(),
      getAppSkillsManager().userDir,
      binaryDir,
    )
    _skillRegistryService.initialize()
  }
  return _skillRegistryService
}

function getRulesService(): RulesService {
  return new RulesService(new RulesRepository(getDatabase()))
}

let _scheduledTaskService: ScheduledTaskService | null = null
/**
 * 供系统托盘菜单（Tray）使用：列出最近活跃会话。
 *
 * 与 IPC handler `session:list` 共享同一 SessionService 实例，避免重复初始化；
 * 默认取 8 条、按 updatedAt 倒序。
 */
export async function getRecentSessionsForTray(
  limit = 8,
): Promise<SessionListResponse['sessions']> {
  const result = await getSessionService().listSessions({ includeArchived: false, limit })
  return result.sessions
}

export function getScheduledTaskService(): ScheduledTaskService {
  if (_scheduledTaskService == null) {
    _scheduledTaskService = new ScheduledTaskService(
      new ScheduledTaskRepository(getDatabase()),
      new TaskExecutionRepository(getDatabase()),
    )
    // Inject executor: creates a session and sends the prompt
    _scheduledTaskService.setExecutor(scheduledTaskExecutor)
  }
  return _scheduledTaskService
}

/**
 * 把定时任务表单的 permissionMode ('auto' / 'bypass') 映射到会话级别的
 * SessionPermissionMode；非法值返回 undefined，让 createSession / sendTurn
 * 各自回退到 agent / 运行时默认。
 */
function mapTaskPermissionMode(
  mode: string | null | undefined,
  adapter: SessionAgentAdapter,
): SessionPermissionMode | undefined {
  if (mode == null || mode === '') return undefined
  // 已经是合法的 SessionPermissionMode，直接透传
  if (
    mode === 'claude-ask' ||
    mode === 'claude-auto-edits' ||
    mode === 'claude-plan' ||
    mode === 'claude-auto' ||
    mode === 'claude-bypass' ||
    mode === 'codex-default' ||
    mode === 'codex-auto-review' ||
    mode === 'codex-full-access'
  ) {
    return mode
  }
  if (mode === 'bypass') return adapter === 'codex' ? 'codex-full-access' : 'claude-bypass'
  if (mode === 'auto') return adapter === 'codex' ? 'codex-auto-review' : 'claude-auto'
  return undefined
}

/**
 * 解析定时任务的执行配置。优先级：
 *   1. 用户在任务里挑了 modelId → 用挑的 model，并定位到拥有这个 model 的 provider
 *   2. 否则用户挑了 agentId → 用 agent 自带的 model / provider
 *   3. 都没挑 → 解析默认 agent，沿用它的 provider / model
 *
 * 这样可以避免之前"executor 永远使用 defaultProfile 导致 provider 和 model 错配"
 * 的问题（例如挑了 OpenAI 的模型，但 defaultProfile 是 Anthropic，结果模型被 SDK
 * 当成 Anthropic 的请求或者被本地 CLI 兜底覆盖）。
 */
async function resolveScheduledTaskRuntime(params: {
  agentId: string | null | undefined
  modelId: string | null | undefined
}): Promise<{
  providerProfileId: string
  modelId: string | undefined
  agentId: string | undefined
  agentAdapter: SessionAgentAdapter
}> {
  const providerService = getProviderService()
  const agentRepo = getAgentRepository()
  const profiles = await providerService.listProviders()
  if (profiles.length === 0) {
    throw new Error('No provider profile available for scheduled task execution')
  }

  let providerProfileId: string | null = null
  let modelId: string | null = params.modelId ?? null
  const agentId: string | null = params.agentId ?? null
  let agentAdapterHint: SessionAgentAdapter | null = null

  // 1. 任务里挑了 modelId：找拥有这个 model 的 provider
  if (modelId) {
    const owner = profiles.find((p) => p.defaultModel === modelId || p.modelIds.includes(modelId!))
    if (owner) providerProfileId = owner.id
  }

  // 2. 任务里挑了 agentId：补全 provider / model
  if (agentId) {
    const agent = agentRepo.get(agentId)
    if (agent != null) {
      if (modelId == null && agent.modelId != null) modelId = agent.modelId
      if (providerProfileId == null && agent.providerProfileId != null) {
        providerProfileId = agent.providerProfileId
      }
      if (agent.agentAdapter === 'claude' || agent.agentAdapter === 'claude-sdk') {
        agentAdapterHint = 'claude-sdk'
      } else if (agent.agentAdapter === 'codex') {
        agentAdapterHint = 'codex'
      }
    }
  }

  // 3. 兜底：沿用默认 agent + 默认 provider
  if (providerProfileId == null) {
    const def = profiles.find((p) => p.isDefault) ?? profiles[0]
    if (def == null) throw new Error('No provider profile available')
    providerProfileId = def.id
  }

  // 确认 providerProfileId 真的存在；不存在则回退到默认
  if (!profiles.some((p) => p.id === providerProfileId)) {
    const def = profiles.find((p) => p.isDefault) ?? profiles[0]
    providerProfileId = def?.id ?? providerProfileId
  }

  const runtimeDefaults = getRuntimePermissionDefaults()
  return {
    providerProfileId: providerProfileId!,
    modelId: modelId ?? undefined,
    agentId: agentId ?? undefined,
    agentAdapter: agentAdapterHint ?? runtimeDefaults.agentAdapter,
  }
}

/** Executor function injected into ScheduledTaskService for running tasks */
const scheduledTaskExecutor: TaskExecutorFn = async (params) => {
  const sessionService = getSessionService()
  const sessionRepo = new SessionRepository(getDatabase())

  // 按 user-selected model > agent's model > default 的优先级解析 provider/model
  const runtime = await resolveScheduledTaskRuntime({
    agentId: params.agentId,
    modelId: params.modelId,
  })

  // Fall back to the no-project workspace so triggered sessions stay visible
  // in the session sidebar even when the task didn't specify one.
  const workspaceId = params.workspaceId ?? getNoProjectWorkspaceId() ?? undefined

  // agentAdapter / permissionMode：仅在解析到 agent 自身 adapter（非 runtime 兜底）时显式传，
  // 其余情况交给 createSession 按 agent.agentAdapter/permissionMode 回退，避免 runtime 默认覆盖 agent 配置。
  const isAgentAdapterFromAgent = runtime.agentId != null && params.agentId != null
  const explicitAgentAdapter = isAgentAdapterFromAgent ? runtime.agentAdapter : undefined
  // mapTaskPermissionMode 仅在用户/任务显式指定时返回非 undefined；其余情况不传，让 createSession 按 agent 回退。
  const explicitPermissionMode = mapTaskPermissionMode(params.permissionMode, runtime.agentAdapter)

  // Create a new session for this execution
  await ensureNoProjectDirectoryExists()
  const created = await sessionService.createSession({
    providerProfileId: runtime.providerProfileId,
    ...(runtime.modelId != null ? { modelId: runtime.modelId } : {}),
    ...(runtime.agentId != null ? { agentId: runtime.agentId } : {}),
    ...(workspaceId != null ? { workspaceId } : {}),
    ...(explicitAgentAdapter != null ? { agentAdapter: explicitAgentAdapter } : {}),
    ...(explicitPermissionMode != null ? { permissionMode: explicitPermissionMode } : {}),
    title: `[⏰] ${params.taskName}`,
  })

  // Notify renderer to refresh session list (same as session:create IPC handler)
  pushStreamEvent('stream:session:created', {
    sessionId: created.sessionId,
    session: created.session,
  })
  // 让 ScheduledTaskService 立即拿到 sessionId（运行 turn 之前），
  // 这样 runNow 可以在 turn 还在跑时就把 sessionId 返回给前端用于跳转。
  params.onSessionCreated?.(created.sessionId)

  // Send the prompt as a turn（session 已持久化 provider/model/adapter/permission，
  // sendTurn 会从 session 读回，无需重复传 agentAdapter/permissionMode）
  sessionRepo.patchMetadata(created.sessionId, {
    automation: {
      source: 'scheduled-task',
      unattended: true,
    },
  })

  try {
    const result = await sessionService.sendTurn({
      sessionId: created.sessionId,
      message: params.promptTemplate,
      providerProfileId: runtime.providerProfileId,
      ...(runtime.modelId != null ? { modelId: runtime.modelId } : {}),
      ...(runtime.agentId != null ? { agentId: runtime.agentId } : {}),
    })

    return {
      sessionId: created.sessionId,
      output: `Turn ${result.turnId} started`,
    }
  } finally {
    sessionRepo.patchMetadata(created.sessionId, { automation: null })
  }
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
    agentId?: string
  },
>(request: T): T {
  if (request.agentAdapter !== undefined && request.permissionMode !== undefined) return request

  // 感知 agent：传了 agentId 且该 agent 自身已有 agentAdapter/permissionMode 时，
  // 不用 runtime 默认覆盖——交给 createSession 内部按 agent 回退（避免 runtime 默认阻断 agent 配置）。
  if (request.agentId != null && request.agentId.length > 0) {
    const agent = getAgentRepository().get(request.agentId)
    if (agent != null) {
      const agentHasAdapter =
        request.agentAdapter !== undefined ||
        (agent.agentAdapter != null && agent.agentAdapter !== '')
      const agentHasPermission =
        request.permissionMode !== undefined ||
        (agent.permissionMode != null && agent.permissionMode !== '')
      if (agentHasAdapter && agentHasPermission) {
        return request
      }
      const defaults = getRuntimePermissionDefaults()
      return {
        ...request,
        ...(request.agentAdapter === undefined && !agentHasAdapter
          ? { agentAdapter: defaults.agentAdapter }
          : {}),
        ...(request.permissionMode === undefined && !agentHasPermission
          ? { permissionMode: defaults.permissionMode }
          : {}),
      }
    }
  }

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
const pendingUserQuestions = new PendingUserQuestionStore({
  onRequest: (request) => {
    pushStreamEvent('stream:session:user-question', request)
  },
  onClose: (request, reason) => {
    pushStreamEvent('stream:session:user-question-closed', {
      questionId: request.questionId,
      sessionId: request.sessionId,
      reason,
    })
  },
})
const remoteTurnTargets = new Map<string, { connectionId: string; externalId: string }>()

function registerRemoteTurn(
  turnId: string,
  target: { connectionId: string; externalId: string },
): void {
  remoteTurnTargets.set(turnId, target)
  if (remoteTurnTargets.size > 500) {
    const oldest = remoteTurnTargets.keys().next().value
    if (oldest != null) remoteTurnTargets.delete(oldest)
  }
}

function handleRemoteTurnEvent(event: Parameters<SessionEventHandler>[0]): void {
  const target = remoteTurnTargets.get(event.turnId)
  if (target == null) return
  if (event.type === 'assistant_message' && event.isFinal) {
    remoteTurnTargets.delete(event.turnId)
    const content = event.content.trim()
    if (content.length === 0) return
    void getRemoteConnectionService()
      .sendReply(target.connectionId, target.externalId, content)
      .catch((err) => {
        log.warn(`Failed to send remote assistant reply: ${String(err)}`)
      })
  } else if (event.type === 'agent_error') {
    remoteTurnTargets.delete(event.turnId)
    void getRemoteConnectionService()
      .sendReply(target.connectionId, target.externalId, `处理失败：${event.message}`)
      .catch((err) => {
        log.warn(`Failed to send remote error reply: ${String(err)}`)
      })
  }
}

async function sendRemoteTurnReplyFromHistory(
  sessionId: string,
  turnId: string,
  target: { connectionId: string; externalId: string },
): Promise<boolean> {
  const history = await getSessionService().getHistory({ sessionId, limit: 200 })
  const final = history.events.find(
    (event) =>
      event.turnId === turnId &&
      event.type === 'assistant_message' &&
      event.isFinal &&
      event.content.trim().length > 0,
  )
  if (final == null || final.type !== 'assistant_message') return false
  if (remoteTurnTargets.get(turnId) !== target) return true
  remoteTurnTargets.delete(turnId)
  await getRemoteConnectionService().sendReply(
    target.connectionId,
    target.externalId,
    final.content.trim(),
  )
  return true
}

function toSDKApprovalScope(
  decision: PermissionApprovalDecision | undefined,
): 'once' | 'session' | 'project' | 'global' | undefined {
  switch (decision) {
    case 'allow-once':
      return 'once'
    case 'allow-session':
      return 'session'
    case 'allow-project':
      return 'project'
    case 'allow-global':
      return 'global'
    default:
      return undefined
  }
}

function getSessionService(): SessionService {
  if (isSessionServiceShutdownStarted()) {
    throw new Error('Session service is shutting down')
  }
  if (_sessionService == null) {
    const onEvent: SessionEventHandler = (event) => {
      pushStreamEvent('stream:session:agent-event', event)
      handleRemoteTurnEvent(event)
    }
    const onApproval: ApprovalHandler = async (sessionId, toolName, toolInput, sdkContext) => {
      let selectedDecision: PermissionApprovalDecision | undefined
      const permissionContext = getSessionPermissionContext(sessionId)
      const allowed = await getPermissionService().requestApproval(
        sessionId,
        toolName,
        toolInput,
        (req) => {
          pushStreamEvent('stream:permission:approval-request', req)
        },
        {
          forcePrompt: true,
          ...permissionContext,
          sdkRequestId: sdkContext.requestId,
          onDecision: (decision) => {
            selectedDecision = decision
          },
        },
      )
      const scope = toSDKApprovalScope(selectedDecision)
      return {
        allowed,
        ...(scope != null ? { scope } : {}),
      }
    }
    const onApprovalCancel = (sessionId: string) => {
      getPermissionService().cancelPendingApprovals(sessionId)
      pendingUserQuestions.cancelSession(sessionId)
    }
    const onQueueChanged: SessionQueueChangedHandler = (snapshot) => {
      pushStreamEvent('stream:session:queue-changed', snapshot)
    }
    const onQuestion: QuestionHandler = async (sessionId, questions, context) => {
      return pendingUserQuestions.request({
        questionId: context.questionId ?? crypto.randomUUID(),
        sessionId,
        questions,
        ...(context.signal != null ? { signal: context.signal } : {}),
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
    // 平台资源（agent/team/provider/mcp/skill/workflow）通过 MCP 工具发生变更时，
    // 向渲染进程广播 stream:config:changed，使会话侧边栏、Agent 选择器等订阅方刷新。
    // 与本文件 typedIpcHandle('agent:create'/...) 等内部调用的 pushConfigChanged 同语义。
    const onPlatformConfigChanged: PlatformConfigChangedHandler = (scope, action, id) => {
      pushConfigChanged(scope, action, id)
      // bridge 通过 MCP 工具增删/切换技能（install/uninstall/toggle）后，
      // 原地重建 SDK 原生托管插件目录，使新装/启停的技能对当前及后续 session 的
      // Claude 原生渐进式披露立即可见（_plugin 为固定路径，每 turn 重新解析）。
      if (scope === 'skill') rebuildManagedSkillsPlugin()
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
      onPlatformConfigChanged,
      // 共享同一个 McpService 单例：UI 的 mcp:create/update/enable 走的就是
      // getMcpService()，boot 时也是在这个实例上调用 startAllEnabled()。若
      // SessionService 自建一份，agent 侧的 mcp_status / getServerStatus 会
      // 永远查到一个从未启动过连接的幽灵实例，无论真实服务器是否可用都报 disconnected。
      getMcpService(),
      getMcpOAuthService(),
    )
    registerSessionServiceForShutdown(_sessionService)
    // 接入画布 Agent 桥：仅当 session 已 attach 到画布弹窗时返回 MCP server
    _sessionService.setCanvasMcpProvider(getCanvasHostBridge().asMcpProvider())
    _sessionService.setBrowserAutomationMcpProvider(browserAutomationMcpProvider)
  }
  return _sessionService
}

/**
 * 按来源解析导入会话使用的 Provider / adapter：
 *   claude-code → 本地 Claude CLI provider（不可用则任一 anthropic / 默认 provider）
 *   codex       → 本地 Codex CLI provider（不可用则任一 openai / 默认 provider）
 */
async function resolveImportProvider(
  source: HistoryImportSource,
): Promise<ImportProviderResolution> {
  const svc = getProviderService()
  const profiles = await svc.listProviders()
  const pickFallback = (preferred: 'anthropic' | 'openai') =>
    profiles.find((p) => p.provider === preferred) ??
    profiles.find((p) => p.isDefault) ??
    profiles[0]

  if (source === 'claude-code') {
    let profileId: string | undefined
    if (await svc.isLocalCliAvailable()) {
      profileId = (await svc.ensureLocalCliProvider()).id
    } else {
      profileId = pickFallback('anthropic')?.id
    }
    if (profileId == null) throw new Error('没有可用的 Provider，请先在「Providers」中添加')
    return {
      providerProfileId: profileId,
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
    }
  }

  let profileId: string | undefined
  if (await svc.isLocalCodexCliAvailable()) {
    profileId = (await svc.ensureLocalCodexCliProvider()).id
  } else {
    profileId = pickFallback('openai')?.id
  }
  if (profileId == null) throw new Error('没有可用的 Provider，请先在「Providers」中添加')
  return { providerProfileId: profileId, agentAdapter: 'codex', permissionMode: 'codex-default' }
}

/** 构造一次性 HistoryImportService（可选进度回调） */
function createHistoryImportService(
  onProgress?: (progress: HistoryImportProgress) => void,
): HistoryImportService {
  const gitWorktreeService = new GitWorktreeService()
  return new HistoryImportService({
    db: getDatabase(),
    resolveProvider: resolveImportProvider,
    createSession: async (params) => {
      const created = await getSessionService().createSession({
        title: params.title,
        workspaceId: params.workspaceId,
        providerProfileId: params.providerProfileId,
        agentAdapter: params.agentAdapter,
        permissionMode: params.permissionMode,
        ...(params.modelId != null ? { modelId: params.modelId } : {}),
      })
      return { sessionId: created.sessionId }
    },
    // worktree 归一化：把 worktree cwd 推导为主仓库根，使 worktree 会话归并到主项目分组。
    // 非 git 目录或 git 不可用时返回 null，调用方回落到原始 cwd。
    resolveMainRepoRoot: async (cwd: string) => {
      try {
        return await gitWorktreeService.resolveMainRepoRoot(cwd)
      } catch {
        return null
      }
    },
    ...(onProgress != null ? { onProgress } : {}),
  })
}

/** Resolve a pending user question with the provided answers */
export function resolveUserQuestion(
  sessionId: string,
  questionId: string,
  answers: Record<string, unknown>,
): boolean {
  return pendingUserQuestions.resolve(sessionId, questionId, answers)
}

function getSessionNotificationTitle(sessionId: string, fallback: string): string {
  try {
    const title = new SessionRepository(getDatabase()).get(sessionId)?.title?.trim()
    return title != null && title.length > 0 ? title : fallback
  } catch (err) {
    log.warn(`Failed to resolve session notification title: ${String(err)}`)
    return fallback
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
        const fallbackTitle = context?.title ?? getNodeDefaultTitle(node)
        const notificationTitle = getSessionNotificationTitle(sessionId, fallbackTitle)
        const notificationBody = context?.body ?? getNodeDefaultBody(node)
        showSystemNotification(notificationTitle, notificationBody, { target: 'session', sessionId, reason: node })
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
  const agent = getAgentRepository().get(session.agent_id ?? 'platform-manager-agent')
  if (agent == null) return { ...DEFAULT_HOOK_CONFIG_INTERNAL, enabled: false }
  return parseHookConfig(agent.hookConfig, { ...DEFAULT_HOOK_CONFIG_INTERNAL, enabled: false })
}

function applyTelemetrySettings(value: unknown): void {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return
  const logLevel = (value as { logLevel?: unknown }).logLevel
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    setLogLevel(logLevel)
  }
}

function getStartupSettings(): { supported: boolean; openAtLogin: boolean; openAsHidden: boolean } {
  try {
    const settings = app.getLoginItemSettings()
    return {
      supported: true,
      openAtLogin: settings.openAtLogin,
      openAsHidden: settings.openAsHidden,
    }
  } catch (err) {
    log.warn(`Failed to read startup settings: ${String(err)}`)
    return { supported: false, openAtLogin: false, openAsHidden: false }
  }
}

function parseRemoteCommand(
  message: string,
  prefix: string,
): { name: string; args: string[]; text: string } {
  const trimmed = message.trim()
  const effectivePrefix = prefix.trim() || '/'
  const body = trimmed.startsWith(effectivePrefix)
    ? trimmed.slice(effectivePrefix.length).trim()
    : `send ${trimmed}`
  const [name = 'help', ...args] = body.split(/\s+/).filter(Boolean)
  return { name: name.toLowerCase(), args, text: body }
}

function formatRows(
  rows: Array<{ id: string; label: string; meta?: string }>,
  empty: string,
): string {
  if (rows.length === 0) return empty
  return rows
    .map(
      (row, index) =>
        `${index + 1}. ${row.label}\n   ${row.id}${row.meta != null ? ` · ${row.meta}` : ''}`,
    )
    .join('\n')
}

type RemoteSelectionRow = { id: string; label: string; meta?: string }
type RemoteSelectionKind = 'providers' | 'models' | 'agents' | 'sessions' | 'workspaces' | 'windows'

const REMOTE_SELECTION_CACHE_TTL_MS = 10 * 60_000
const remoteSelectionCache = new Map<string, { expiresAt: number; rows: RemoteSelectionRow[] }>()
const remoteAuditLog: Array<{
  at: string
  connectionId: string
  command: string
  ok: boolean
  target?: string
  error?: string
}> = []

function cacheRemoteSelection(
  connectionId: string,
  kind: RemoteSelectionKind,
  rows: RemoteSelectionRow[],
): void {
  remoteSelectionCache.set(`${connectionId}:${kind}`, {
    expiresAt: Date.now() + REMOTE_SELECTION_CACHE_TTL_MS,
    rows,
  })
  if (remoteSelectionCache.size > 200) {
    for (const [key, value] of remoteSelectionCache) {
      if (value.expiresAt < Date.now()) remoteSelectionCache.delete(key)
    }
  }
}

function getCachedRemoteSelection(
  connectionId: string,
  kind: RemoteSelectionKind,
): RemoteSelectionRow[] | null {
  const cached = remoteSelectionCache.get(`${connectionId}:${kind}`)
  if (cached == null || cached.expiresAt < Date.now()) return null
  return cached.rows
}

function quoteRemoteRows(rows: RemoteSelectionRow[]): string {
  return rows.map((row, index) => `${index + 1}. ${row.label} (${row.id})`).join('\n')
}

function resolveRemoteSelection(
  input: string,
  rows: RemoteSelectionRow[],
  options: { kindLabel: string; cachedRows?: RemoteSelectionRow[] | null },
): { ok: true; row: RemoteSelectionRow } | { ok: false; title: string; text: string } {
  const value = input.trim()
  if (value.length === 0) {
    return { ok: false, title: `缺少${options.kindLabel}`, text: `请输入序号、名称或 ID。` }
  }

  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1
    const source = options.cachedRows ?? rows
    if (options.cachedRows == null) {
      return {
        ok: false,
        title: '序号已过期',
        text: `请先发送 /${options.kindLabel === 'Provider' ? 'providers' : 'help'} 重新查看列表，再使用序号。`,
      }
    }
    const row = source[index]
    if (row == null) {
      return { ok: false, title: '序号不存在', text: `可用范围：1-${source.length}` }
    }
    return { ok: true, row }
  }

  const idMatch = rows.find((row) => row.id === value)
  if (idMatch != null) return { ok: true, row: idMatch }

  const normalized = value.toLocaleLowerCase()
  const nameMatches = rows.filter((row) => row.label.trim().toLocaleLowerCase() === normalized)
  const onlyNameMatch = nameMatches[0]
  if (nameMatches.length === 1 && onlyNameMatch != null) return { ok: true, row: onlyNameMatch }
  if (nameMatches.length > 1) {
    return {
      ok: false,
      title: `${options.kindLabel} 名称不唯一`,
      text: `请改用序号或 ID：\n${quoteRemoteRows(nameMatches)}`,
    }
  }

  const partialMatches = rows.filter((row) => row.label.toLocaleLowerCase().includes(normalized))
  const onlyPartialMatch = partialMatches[0]
  if (partialMatches.length === 1 && onlyPartialMatch != null)
    return { ok: true, row: onlyPartialMatch }
  if (partialMatches.length > 1) {
    return {
      ok: false,
      title: `${options.kindLabel} 匹配不唯一`,
      text: `请改用更完整名称、序号或 ID：\n${quoteRemoteRows(partialMatches.slice(0, 10))}`,
    }
  }

  return {
    ok: false,
    title: `未找到${options.kindLabel}`,
    text: `未找到：${value}。请发送对应列表命令查看可用项。`,
  }
}

function appendRemoteAudit(entry: Omit<(typeof remoteAuditLog)[number], 'at'>): void {
  remoteAuditLog.push({ at: new Date().toISOString(), ...entry })
  if (remoteAuditLog.length > 200) remoteAuditLog.splice(0, remoteAuditLog.length - 200)
}

async function createRemoteSession(
  connectionId: string,
  workspaceId?: string,
): Promise<{ sessionId: string; connectionName: string }> {
  const remoteService = getRemoteConnectionService()
  const connection = remoteService.list().connections.find((item) => item.id === connectionId)
  if (connection == null) throw new Error('远程连接不存在')
  const providers = await getProviderService().listProviders()
  const provider =
    connection.defaultProviderProfileId != null
      ? providers.find((item) => item.id === connection.defaultProviderProfileId)
      : (providers.find((item) => item.isDefault) ?? providers[0])
  if (provider == null) {
    throw new Error('没有可用 Provider，请先在设置中配置模型 Provider。')
  }
  await ensureNoProjectDirectoryExists()
  const defaults = getRuntimePermissionDefaults()
  const created = await getSessionService().createSession({
    providerProfileId: provider.id,
    ...(connection.defaultModelId != null ? { modelId: connection.defaultModelId } : {}),
    ...(connection.defaultAgentId != null ? { agentId: connection.defaultAgentId } : {}),
    agentAdapter: defaults.agentAdapter,
    permissionMode: defaults.permissionMode,
    ...(workspaceId != null ? { workspaceId } : {}),
    title: `远程会话 · ${connection.name}`,
  })
  pushStreamEvent('stream:session:created', {
    sessionId: created.sessionId,
    session: created.session,
  })
  remoteService.updateConnectionDefaults(connection.id, {
    defaultSessionId: created.sessionId,
    defaultProviderProfileId: provider.id,
  })
  return { sessionId: created.sessionId, connectionName: connection.name }
}

async function executeRemoteCommand(
  connectionId: string,
  message: string,
  explicitSessionId?: string,
): Promise<{ ok: boolean; title: string; text: string }> {
  const remoteService = getRemoteConnectionService()
  const store = remoteService.list()
  const connection = store.connections.find((item) => item.id === connectionId)
  if (connection == null)
    return { ok: false, title: '连接不存在', text: '请先在设置中创建远程连接。' }
  if (!connection.enabled) return { ok: false, title: '连接未启用', text: '请先启用该远程连接。' }

  const command = parseRemoteCommand(message, connection.commandPrefix)
  const sessionId = explicitSessionId ?? connection.defaultSessionId
  const requireCapability = (
    capability: keyof typeof connection.capabilities,
  ): { ok: boolean; title: string; text: string } | null => {
    if (connection.capabilities[capability]) return null
    return { ok: false, title: '功能未授权', text: `该连接没有启用 ${capability} 能力。` }
  }

  if (command.name === 'help') {
    const commands = remoteService.getCommandCatalog()
    const grouped = [
      ['会话', ['sessions', 'use-session', 'new-session']],
      ['模型', ['providers', 'use-provider', 'models', 'use-model']],
      ['Agent', ['agents', 'use-agent']],
      ['工作区', ['workspaces', 'open-workspace']],
      ['远程桌面', ['screen', 'windows', 'focus', 'click', 'type', 'hotkey']],
      ['运行时', ['progress', 'queue', 'history', 'cancel', 'stop']],
      ['消息', ['send']],
      ['系统', ['status', 'help']],
    ] as const
    const byName = new Map(commands.map((cmd) => [cmd.name, cmd]))
    return {
      ok: true,
      title: '远程命令',
      text:
        grouped
          .map(([group, names]) => {
            const lines = names
              .map((name) => byName.get(name))
              .filter((cmd): cmd is NonNullable<ReturnType<typeof byName.get>> => cmd != null)
              .map((cmd) => {
                const enabled =
                  cmd.capability === 'system' || connection.capabilities[cmd.capability]
                return `${enabled ? '·' : '·（未授权）'} ${cmd.usage} - ${cmd.description}`
              })
            return `${group}\n${lines.join('\n')}`
          })
          .join('\n\n') +
        '\n\n示例：/providers 后发送 /use-provider 2；也可发送 /use-provider 智谱 GLM Coding Plan 或完整 ID。',
    }
  }

  if (command.name === 'status') {
    const providers = await getProviderService().listProviders()
    const provider = providers.find((item) => item.id === connection.defaultProviderProfileId)
    const models = getModelService().list()
    const model = models.find((item) => item.id === connection.defaultModelId)
    const agent =
      connection.defaultAgentId != null ? getAgentRepository().get(connection.defaultAgentId) : null
    return {
      ok: true,
      title: connection.name,
      text: [
        `渠道：${connection.channel}`,
        `状态：${connection.status}`,
        `配对设备：${connection.pairedDevices.length}`,
        `默认会话：${connection.defaultSessionId ?? '未设置'}`,
        `默认 Provider：${provider != null ? `${provider.name} (${provider.id})` : (connection.defaultProviderProfileId ?? '未设置')}`,
        `默认模型：${model != null ? `${model.name} (${model.id})` : (connection.defaultModelId ?? '未设置')}`,
        `默认 Agent：${agent != null ? `${agent.name} (${agent.id})` : (connection.defaultAgentId ?? '未设置')}`,
      ].join('\n'),
    }
  }

  if (command.name === 'sessions') {
    const blocked = requireCapability('switchSession')
    if (blocked != null) return blocked
    const result = await getSessionService().listSessions({ includeArchived: false, limit: 12 })
    const rows = result.sessions.map((item) => ({
      id: item.id,
      label: item.title || '新会话',
      meta: `${item.status} · ${item.messageCount} 条消息`,
    }))
    cacheRemoteSelection(connection.id, 'sessions', rows)
    return {
      ok: true,
      title: '最近会话',
      text: formatRows(rows, '暂无会话'),
    }
  }

  if (command.name === 'use-session') {
    const blocked = requireCapability('switchSession')
    if (blocked != null) return blocked
    const target = command.args.join(' ')
    if (target == null)
      return { ok: false, title: '缺少 sessionId', text: '用法：/use-session <sessionId>' }
    const result = await getSessionService().listSessions({ includeArchived: false, limit: 12 })
    const rows = result.sessions.map((item) => ({
      id: item.id,
      label: item.title || '新会话',
      meta: `${item.status} · ${item.messageCount} 条消息`,
    }))
    const resolved = resolveRemoteSelection(target, rows, {
      kindLabel: '会话',
      cachedRows: getCachedRemoteSelection(connection.id, 'sessions'),
    })
    if (!resolved.ok) return resolved
    remoteService.updateConnectionDefaults(connection.id, { defaultSessionId: resolved.row.id })
    return { ok: true, title: '已切换默认会话', text: `${resolved.row.label}\n${resolved.row.id}` }
  }

  if (command.name === 'models') {
    const blocked = requireCapability('switchModel')
    if (blocked != null) return blocked
    const models = getModelService().list()
    const rows = models.map((item) => ({
      id: item.id,
      label: item.name,
      meta: item.enabled ? 'enabled' : 'disabled',
    }))
    cacheRemoteSelection(connection.id, 'models', rows)
    return {
      ok: true,
      title: '模型配置',
      text: formatRows(rows, '暂无模型配置'),
    }
  }

  if (command.name === 'providers') {
    const blocked = requireCapability('switchModel')
    if (blocked != null) return blocked
    const providers = await getProviderService().listProviders()
    const rows = providers.map((item) => ({ id: item.id, label: item.name, meta: item.provider }))
    cacheRemoteSelection(connection.id, 'providers', rows)
    return {
      ok: true,
      title: 'Provider 配置',
      text: formatRows(rows, '暂无 Provider'),
    }
  }

  if (command.name === 'agents') {
    const blocked = requireCapability('switchAgent')
    if (blocked != null) return blocked
    const agents = getAgentRepository().list({ includeDisabled: false }).map(toManagedAgent)
    const rows = agents.map((item) => ({ id: item.id, label: item.name, meta: item.agentAdapter }))
    cacheRemoteSelection(connection.id, 'agents', rows)
    return {
      ok: true,
      title: 'Agent',
      text: formatRows(rows, '暂无 Agent'),
    }
  }

  if (command.name === 'workspaces') {
    const blocked = requireCapability('manageWorkspace')
    if (blocked != null) return blocked
    const list = getWorkspaceService()
      .listWorkspaces(12, 0, { includeArchived: false })
      .map(toWorkspaceInfo)
    const rows = list.map((item) => ({ id: item.id, label: item.name, meta: item.rootPath }))
    cacheRemoteSelection(connection.id, 'workspaces', rows)
    return {
      ok: true,
      title: '工作区',
      text: formatRows(rows, '暂无工作区'),
    }
  }

  if (command.name === 'new-session') {
    const blocked = requireCapability('switchSession')
    if (blocked != null) return blocked
    const workspaceInput = command.args.join(' ')
    let workspaceId: string | undefined
    if (workspaceInput.length > 0) {
      const rows = getWorkspaceService()
        .listWorkspaces(12, 0, { includeArchived: false })
        .map(toWorkspaceInfo)
        .map((item) => ({ id: item.id, label: item.name, meta: item.rootPath }))
      const resolved = resolveRemoteSelection(workspaceInput, rows, {
        kindLabel: '工作区',
        cachedRows: getCachedRemoteSelection(connection.id, 'workspaces'),
      })
      if (!resolved.ok) return resolved
      workspaceId = resolved.row.id
    }
    const created = await createRemoteSession(connection.id, workspaceId)
    return { ok: true, title: '已新建默认会话', text: created.sessionId }
  }

  if (command.name === 'open-workspace') {
    const blocked = requireCapability('manageWorkspace')
    if (blocked != null) return blocked
    const rootPath = command.text.replace(/^open-workspace\s*/i, '').trim()
    if (rootPath.length === 0)
      return { ok: false, title: '缺少项目路径', text: '用法：/open-workspace <path>' }
    const workspace = await getWorkspaceService().openWorkspace(rootPath, undefined, {
      create: false,
    })
    return {
      ok: true,
      title: '已打开项目',
      text: `${workspace.name}\n${workspace.id}\n${workspace.root_path}`,
    }
  }

  if (
    command.name === 'use-model' ||
    command.name === 'use-provider' ||
    command.name === 'use-agent'
  ) {
    const capability = command.name === 'use-agent' ? 'switchAgent' : 'switchModel'
    const blocked = requireCapability(capability)
    if (blocked != null) return blocked
    const target = command.args.join(' ')
    if (target.length === 0)
      return { ok: false, title: '缺少目标 ID', text: `用法：/${command.name} <id>` }
    let resolved: { ok: true; row: RemoteSelectionRow } | { ok: false; title: string; text: string }
    if (command.name === 'use-provider') {
      const rows = (await getProviderService().listProviders()).map((item) => ({
        id: item.id,
        label: item.name,
        meta: item.provider,
      }))
      resolved = resolveRemoteSelection(target, rows, {
        kindLabel: 'Provider',
        cachedRows: getCachedRemoteSelection(connection.id, 'providers'),
      })
    } else if (command.name === 'use-model') {
      const rows = getModelService()
        .list()
        .map((item) => ({
          id: item.id,
          label: item.name,
          meta: item.enabled ? 'enabled' : 'disabled',
        }))
      resolved = resolveRemoteSelection(target, rows, {
        kindLabel: '模型',
        cachedRows: getCachedRemoteSelection(connection.id, 'models'),
      })
    } else {
      const rows = getAgentRepository()
        .list({ includeDisabled: false })
        .map(toManagedAgent)
        .map((item) => ({
          id: item.id,
          label: item.name,
          meta: item.agentAdapter,
        }))
      resolved = resolveRemoteSelection(target, rows, {
        kindLabel: 'Agent',
        cachedRows: getCachedRemoteSelection(connection.id, 'agents'),
      })
    }
    if (!resolved.ok) return resolved
    if (sessionId != null) {
      await getSessionService().updateSession({
        sessionId,
        ...(command.name === 'use-model' ? { modelId: resolved.row.id } : {}),
        ...(command.name === 'use-provider' ? { providerProfileId: resolved.row.id } : {}),
        ...(command.name === 'use-agent' ? { agentId: resolved.row.id } : {}),
      })
    }
    remoteService.updateConnectionDefaults(connection.id, {
      ...(command.name === 'use-model' ? { defaultModelId: resolved.row.id } : {}),
      ...(command.name === 'use-provider' ? { defaultProviderProfileId: resolved.row.id } : {}),
      ...(command.name === 'use-agent' ? { defaultAgentId: resolved.row.id } : {}),
    })
    return { ok: true, title: '已切换', text: `${resolved.row.label}\n${resolved.row.id}` }
  }

  if (command.name === 'progress' || command.name === 'queue') {
    const blocked = requireCapability('manageRuntime')
    if (blocked != null) return blocked
    if (sessionId == null)
      return { ok: false, title: '缺少默认会话', text: '请先使用 /use-session 绑定会话。' }
    const queue = getSessionService().getQueueState({ sessionId })
    return {
      ok: true,
      title: command.name === 'progress' ? '当前进度' : '队列',
      text: `运行中：${queue.running ? '是' : '否'}\n排队中：${queue.queuedTurns.length}\n${queue.queuedTurns.map((item, index) => `${index + 1}. ${item.turnId} · ${item.message.slice(0, 80)}`).join('\n') || '暂无排队消息'}`,
    }
  }

  if (command.name === 'history') {
    const blocked = requireCapability('manageRuntime')
    if (blocked != null) return blocked
    const rows = remoteAuditLog
      .filter((item) => item.connectionId === connection.id)
      .slice(-10)
      .reverse()
      .map(
        (item, index) =>
          `${index + 1}. ${item.at} · /${item.command} · ${item.ok ? '成功' : `失败：${item.error ?? '未知错误'}`}${item.target != null ? ` · ${item.target}` : ''}`,
      )
    return { ok: true, title: '远程审计', text: rows.join('\n') || '暂无远程命令记录' }
  }

  if (command.name === 'cancel' || command.name === 'stop') {
    const blocked = requireCapability('manageRuntime')
    if (blocked != null) return blocked
    if (sessionId == null)
      return { ok: false, title: '缺少默认会话', text: '请先使用 /use-session 绑定会话。' }
    const cancelled = await getSessionService().cancelTurn(sessionId)
    return { ok: true, title: cancelled.cancelled ? '已取消' : '没有可取消任务', text: sessionId }
  }

  if (command.name === 'screen' || command.name === 'windows') {
    const blocked = requireCapability('observeDesktop')
    if (blocked != null) return blocked
    const mainWindow = getMainWindow()
    const rows =
      mainWindow == null
        ? []
        : [
            {
              id: String(mainWindow.id),
              label: mainWindow.getTitle() || 'SparkWork',
              meta: mainWindow.isFocused() ? 'focused' : 'background',
            },
          ]
    cacheRemoteSelection(connection.id, 'windows', rows)
    return {
      ok: true,
      title: command.name === 'screen' ? '屏幕概览' : '窗口列表',
      text:
        rows.length > 0
          ? formatRows(rows, '暂无窗口')
          : '当前未找到可观察窗口。远程截图/图像回传将在后续渠道适配中启用。',
    }
  }

  if (['focus', 'click', 'type', 'hotkey'].includes(command.name)) {
    const blocked = requireCapability('controlDesktop')
    if (blocked != null) return blocked
    return {
      ok: false,
      title: '桌面控制需要原生适配',
      text: '已预留权限和命令入口；当前版本仅开放 /screen 与 /windows 观察能力，点击/输入/快捷键需接入平台级安全执行器后启用。',
    }
  }

  if (command.name === 'confirm') {
    const blocked = requireCapability('dangerousActions')
    if (blocked != null) return blocked
    return { ok: false, title: '暂无待确认动作', text: '当前没有等待远程确认的高危动作。' }
  }

  if (command.name === 'send') {
    const blocked = requireCapability('sendMessages')
    if (blocked != null) return blocked
    const text = command.text.replace(/^send\s*/i, '').trim()
    if (sessionId == null)
      return {
        ok: false,
        title: '缺少默认会话',
        text: '请先使用 /use-session <sessionId> 绑定会话。',
      }
    if (text.length === 0) return { ok: false, title: '消息为空', text: '用法：/send <message>' }
    const result = await getSessionService().sendTurn({
      sessionId,
      message: text,
      ...(connection.defaultProviderProfileId != null
        ? { providerProfileId: connection.defaultProviderProfileId }
        : {}),
      ...(connection.defaultModelId != null ? { modelId: connection.defaultModelId } : {}),
      ...(connection.defaultAgentId != null ? { agentId: connection.defaultAgentId } : {}),
    })
    return {
      ok: true,
      title: result.started ? '已发送' : '已加入队列',
      text: `turnId: ${result.turnId}`,
    }
  }

  appendRemoteAudit({
    connectionId: connection.id,
    command: command.name,
    ok: false,
    error: 'unknown-command',
  })
  return { ok: false, title: '未知命令', text: '发送 /help 查看可用命令。' }
}

async function handleRemoteInboundMessage(
  message: RemoteInboundMessage,
): Promise<{ title: string; text: string } | void> {
  const prefix = message.connection.commandPrefix.trim() || '/'
  const isCommandMessage = message.text.trim().startsWith(prefix)
  if (isCommandMessage) {
    if (!message.connection.capabilities.runCommands) {
      return { title: '功能未授权', text: '该连接没有启用远程命令能力。' }
    }
    const result = await executeRemoteCommand(
      message.connection.id,
      message.text,
      message.connection.defaultSessionId,
    )
    return { title: result.title, text: result.text }
  }

  if (!message.connection.capabilities.sendMessages) {
    return { title: '功能未授权', text: '该连接没有启用消息投递能力。' }
  }
  const sessionId =
    message.connection.defaultSessionId ??
    (await createRemoteSession(message.connection.id)).sessionId
  await ensureSessionWorkspacePaths(sessionId)

  const result = await getSessionService().sendTurn({
    sessionId,
    message: message.text,
    ...(message.connection.defaultProviderProfileId != null
      ? { providerProfileId: message.connection.defaultProviderProfileId }
      : {}),
    ...(message.connection.defaultModelId != null
      ? { modelId: message.connection.defaultModelId }
      : {}),
    ...(message.connection.defaultAgentId != null
      ? { agentId: message.connection.defaultAgentId }
      : {}),
  })
  const target = {
    connectionId: message.connection.id,
    externalId: message.externalId,
  }
  registerRemoteTurn(result.turnId, target)
  void sendRemoteTurnReplyFromHistory(sessionId, result.turnId, target).catch((err) => {
    log.warn(`Failed to send remote reply from history: ${String(err)}`)
  })
  return undefined
}

export function registerAllIpcHandlers(): void {
  log.info('Registering IPC handlers...')
  // 初始化文件日志：app.getPath('logs') 在 app.whenReady() 后才可用，
  // 而 registerAllIpcHandlers 恰在 ready 后被调用（见 main/index.ts），故此处安全。
  // 此后所有 createLogger 产出的日志会同时落盘到 <logs>/main.log，设置页可查看。
  try {
    initFileLogger(app.getPath('logs'))
  } catch (err) {
    log.warn(`Failed to init file logger: ${String(err)}`)
  }
  applyTelemetrySettings(getSettingsService().get('telemetry', 'data'))
  void getRemoteConnectionService()
    .startRuntime(handleRemoteInboundMessage)
    .catch((err) => {
      log.warn(`Failed to start remote runtime: ${String(err)}`)
    })

  // 启动时仅在宿主机存在对应 CLI 时补种内置本地 provider。
  // 失败仅记日志，不阻塞后续注册。
  void (async () => {
    const svc = getProviderService()
    if (await svc.isLocalCliAvailable()) {
      await svc.ensureLocalCliProvider()
    }
    if (await svc.isLocalCodexCliAvailable()) {
      await svc.ensureLocalCodexCliProvider()
    }
  })().catch((err) =>
    log.warn(
      `Failed to seed local CLI provider: ${err instanceof Error ? err.message : String(err)}`,
    ),
  )

  // ─── Canvas Agent Bridge ───────────────────────────────────────────────

  typedIpcHandle('canvas:window:open', async (req) => {
    return getCanvasWindowService().open(req)
  })

  typedIpcHandle('canvas:window:close-confirmed', async () => {
    return { success: getCanvasWindowService().closeAfterRendererGuard() }
  })

  typedIpcHandle('canvas:host-attach', async (req, event) => {
    const bridge = getCanvasHostBridge()
    log.info(
      `canvas:host-attach requested, sessionId=${req.sessionId} projectId=${req.projectId} toolSchemas=${req.toolSchemas.length}`,
    )
    bridge.setToolSchemas(req.toolSchemas)
    bridge.attach(req.sessionId, event.sender, req.projectId)
    return { ok: true } as const
  })

  typedIpcHandle('canvas:host-detach', async (req) => {
    log.info(`canvas:host-detach requested, sessionId=${req.sessionId}`)
    getCanvasHostBridge().detach(req.sessionId)
    return { ok: true } as const
  })

  typedIpcHandle('canvas:tool-result', async (req) => {
    log.info(
      `canvas:tool-result received, requestId=${req.requestId} ok=${req.ok}${req.ok ? '' : ` error=${req.error ?? '(none)'}`}`,
    )
    getCanvasHostBridge().handleToolResult({
      requestId: req.requestId,
      ok: req.ok,
      ...(req.result !== undefined ? { result: req.result } : {}),
      ...(req.error !== undefined ? { error: req.error } : {}),
    })
    return { ok: true } as const
  })

  typedIpcHandle('canvas:tool-ack', async (req) => {
    getCanvasHostBridge().handleToolAck(req.requestId)
    return { ok: true } as const
  })

  // ─── Session Handlers ──────────────────────────────────────────────────

  typedIpcHandle('session:create', async (req) => {
    log.info(`session:create requested, providerProfileId=${req.providerProfileId}`)
    await ensureNoProjectDirectoryExists()
    const created = await getSessionService().createSession(applyRuntimePermissionDefaults(req))
    pushStreamEvent('stream:session:created', {
      sessionId: created.sessionId,
      session: created.session,
    })
    return created
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
      ...(req.mentionAgentId != null ? { mentionAgentId: req.mentionAgentId } : {}),
      ...(req.interruptActive === true ? { interruptActive: true } : {}),
    })
  })

  typedIpcHandle('session:submit-turn', async (req) => {
    log.info(`session:submit-turn requested, sessionId=${req.sessionId}`)
    // 持久化接单不等待文件系统修复。准备工作与 DB 接单并行，SessionService
    // 只在准备 Promise settled 后起跑该 turn，因此不会牺牲旧路径迁移的正确性。
    const workspaceReady = Promise.all([
      ensureNoProjectDirectoryExists(),
      ensureSessionWorkspacePaths(req.sessionId),
    ]).catch((error) => {
      // 即使该 turn 因活跃 Goal/loop 先进入队列，准备 Promise 也必须就地收口，
      // 避免没有进入 startAfter 分支时产生 unhandled rejection。
      log.warn('session:submit-turn workspace preparation failed', {
        sessionId: req.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return getSessionService().submitTurn(
      {
        sessionId: req.sessionId,
        message: req.message,
        ...(req.providerProfileId !== undefined
          ? { providerProfileId: req.providerProfileId }
          : {}),
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
        ...(req.mentionAgentId != null ? { mentionAgentId: req.mentionAgentId } : {}),
        ...(req.interruptActive === true ? { interruptActive: true } : {}),
      },
      { startAfter: workspaceReady },
    )
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

  typedIpcHandle('session:send-queued-turn-now', async (req) => {
    log.info(
      `session:send-queued-turn-now requested, sessionId=${req.sessionId}, turnId=${req.turnId}`,
    )
    return getSessionService().sendQueuedTurnNow(req)
  })

  typedIpcHandle('session:cancel', async (req) => {
    log.info(`session:cancel requested, sessionId=${req.sessionId}`)
    return getSessionService().cancelTurn(req.sessionId)
  })

  typedIpcHandle('session:reject-plan', async (req) => {
    log.info(`session:reject-plan requested, sessionId=${req.sessionId}`)
    return getSessionService().rejectPlan(req.sessionId)
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
    // 关闭该 session 名下所有内置终端 PTY（killed count 已记入 service 日志）
    getTerminalService().disposeBySession(req.sessionId, { defer: true })
    return getSessionService().deleteSession(req.sessionId)
  })

  typedIpcHandle('session:set-max-iterations', async (req) => {
    log.info(`session:set-max-iterations sessionId=${req.sessionId} max=${req.maxIterations}`)
    getSessionService().setMaxIterations(req.sessionId, req.maxIterations)
    return { applied: req.maxIterations }
  })

  typedIpcHandle('session:set-goal', async (req) => {
    log.info(`session:set-goal requested, sessionId=${req.sessionId}`)
    return getSessionService().setGoal(req)
  })

  typedIpcHandle('session:get-goal', async (req) => {
    return getSessionService().getGoal(req.sessionId)
  })

  typedIpcHandle('session:goal-control', async (req) => {
    log.info(`session:goal-control requested, sessionId=${req.sessionId}, action=${req.action}`)
    return getSessionService().controlGoal(req)
  })

  typedIpcHandle('session:clear-events', async (req) => {
    log.info(`session:clear-events requested, sessionId=${req.sessionId}`)
    return getSessionService().clearEvents(req.sessionId)
  })

  typedIpcHandle('session:list-checkpoints', async (req) => {
    log.info(`session:list-checkpoints requested, sessionId=${req.sessionId}`)
    return { checkpoints: getSessionService().listCheckpoints(req.sessionId) }
  })

  typedIpcHandle('session:get-checkpoint-config', async (req) => {
    return {
      enabled: getSessionService().getSessionCheckpointEnabled(req.sessionId),
      available: await getSessionService().getSessionCheckpointAvailable(req.sessionId),
    }
  })

  typedIpcHandle('session:set-checkpoint-config', async (req) => {
    const ok = getSessionService().setSessionCheckpointEnabled(req.sessionId, req.enabled)
    return { ok, enabled: ok ? req.enabled : getSessionService().getSessionCheckpointEnabled(req.sessionId) }
  })

  typedIpcHandle('session:delete-message', async (req) => {
    log.info(
      `session:delete-message requested, sessionId=${req.sessionId} eventCount=${req.eventIds.length}`,
    )
    return getSessionService().deleteMessage(req.sessionId, req.eventIds)
  })

  typedIpcHandle('session:answer-question', async (req) => {
    log.info(
      `session:answer-question requested, sessionId=${req.sessionId} questionId=${req.questionId}`,
    )
    if (!resolveUserQuestion(req.sessionId, req.questionId, req.answers)) {
      throw new SparkError('NOT_FOUND', '该提问已结束或不属于当前会话，请刷新后重试。')
    }
    return { ok: true }
  })

  typedIpcHandle('session:list-pending-questions', async (req) => {
    return { questions: pendingUserQuestions.list(req.sessionId) }
  })

  // ─── Provider Handlers ─────────────────────────────────────────────────
  // P1-09 完整实现，当前为骨架

  typedIpcHandle('provider:list', async (_req) => {
    const svc = getProviderService()
    if (await svc.isLocalCliAvailable()) {
      await svc.ensureLocalCliProvider()
    }
    if (await svc.isLocalCodexCliAvailable()) {
      await svc.ensureLocalCodexCliProvider()
    }
    const profiles = await svc.listProviders()
    return { profiles }
  })

  typedIpcHandle('provider:get-api-key', async (req) => {
    const apiKey = await getProviderService().getProviderApiKey(req.id)
    return { apiKey }
  })

  typedIpcHandle('provider:create', async (req) => {
    log.info(`provider:create requested, provider=${req.provider}, name=${req.name}`)
    const profile = await getProviderService().createProvider(req)
    pushConfigChanged('provider', 'create', profile.id)
    return { profile }
  })

  typedIpcHandle('provider:update', async (req) => {
    log.info(`provider:update requested, id=${req.id}`)
    const profile = await getProviderService().updateProvider(req)
    pushConfigChanged('provider', 'update', profile.id)
    return { profile }
  })

  typedIpcHandle('provider:delete', async (req) => {
    log.info(`provider:delete requested, id=${req.id}`)
    await getProviderService().deleteProvider(req.id)
    pushConfigChanged('provider', 'delete', req.id)
    return { deleted: true }
  })

  typedIpcHandle('provider:health-check', async (req) => {
    log.info(`provider:health-check requested, id=${req.id}`)
    try {
      const result = await getProviderService().healthCheck(req.id)
      log.info(
        `provider:health-check completed, id=${req.id}, healthy=${result.healthy}, `
        + `latencyMs=${result.latencyMs ?? 'n/a'}`,
      )
      if (!result.healthy && result.errorMessage) {
        log.warn(`provider:health-check unhealthy, id=${req.id}, error="${result.errorMessage}"`)
      }
      return result
    } catch (err) {
      log.error(
        `provider:health-check failed, id=${req.id}, error=${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  })

  typedIpcHandle('provider:test-connection', async (req) => {
    log.info(
      `provider:test-connection requested, provider=${req.provider}, id=${req.id ?? '(draft)'}, `
      + `model=${req.defaultModel}`,
    )
    try {
      const result = await getProviderService().testConnection(req)
      log.info(
        `provider:test-connection completed, provider=${req.provider}, id=${req.id ?? '(draft)'}, `
        + `healthy=${result.healthy}, latencyMs=${result.latencyMs ?? 'n/a'}`,
      )
      if (!result.healthy && result.errorMessage) {
        log.warn(
          `provider:test-connection unhealthy, provider=${req.provider}, `
          + `id=${req.id ?? '(draft)'}, error="${result.errorMessage}"`,
        )
      }
      return result
    } catch (err) {
      log.error(
        `provider:test-connection failed, provider=${req.provider}, id=${req.id ?? '(draft)'}, `
        + `error=${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  })

  typedIpcHandle('provider:fetch-models', async (req) => {
    log.info(`provider:fetch-models requested, provider=${req.provider}, id=${req.id ?? '(draft)'}`)
    try {
      const models = await getProviderService().fetchModels(req)
      log.info(
        `provider:fetch-models completed, provider=${req.provider}, id=${req.id ?? '(draft)'}, `
        + `count=${models.length}`,
      )
      return { models }
    } catch (err) {
      log.error(
        `provider:fetch-models failed, provider=${req.provider}, id=${req.id ?? '(draft)'}, `
        + `error=${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  })

  // ─── Canvas Media Generation Handlers ────────────────────────────────────
  // 见 docs/multimedia-model-platform-adapters-design.md §8。
  // 真实 provider 调用只在主进程内进行，API key 不进入 renderer。

  typedIpcHandle('canvas:media-capabilities:list', async () => {
    const profiles = await getProviderService().listProviders()
    const catalog = getMediaModelCatalogService()
    const providers = profiles
      .map((profile) => {
        const isMediaModel =
          profile.modelType === 'image' ||
          profile.modelType === 'voice' ||
          profile.modelType === 'video'
        const caps = profile.mediaCapabilities ?? []
        const mediaModels = profileMediaModelSummaries(profile, catalog, { enabledOnly: true })
        if (
          (!isMediaModel && caps.length === 0 && mediaModels.length === 0) ||
          !profile.keystoreRef
        )
          return null
        return {
          providerProfileId: profile.id,
          name: profile.name,
          defaultModel: profile.defaultModel,
          mediaProvider: profile.mediaProvider ?? null,
          mediaApiType: profile.mediaApiType ?? null,
          mediaCapabilities: profile.mediaCapabilities ?? [],
          mediaModels,
        }
      })
      .filter((provider): provider is NonNullable<typeof provider> => provider != null)
    return { providers }
  })

  typedIpcHandle('canvas:media-models:list', async (req) => {
    const catalog = getMediaModelCatalogService()
    if (req.catalogOnly === true) {
      const models = catalog
        .list({
          ...(req.providerKind !== undefined ? { providerKind: req.providerKind } : {}),
          ...(req.capability !== undefined ? { capability: req.capability } : {}),
          enabledOnly: req.enabledOnly !== false,
        })
        .map((item) => {
          const manifest = catalog.describe(item.id)
          return manifest
            ? toCanvasMediaModelSummary(manifest, {
                effectiveModelId: item.modelId,
                enabled: item.enabled,
              })
            : null
        })
        .filter((model): model is CanvasMediaModelSummary => model != null)
      return { models }
    }
    const profiles = await getProviderService().listProviders()
    const models: CanvasMediaModelSummary[] = []
    const providerProfiles = req.providerProfileId
      ? profiles.filter((profile) => profile.id === req.providerProfileId)
      : profiles.filter((profile) => !!profile.keystoreRef)
    for (const profile of providerProfiles) {
      models.push(
        ...profileMediaModelSummaries(profile, catalog, {
          ...(req.capability !== undefined ? { capability: req.capability } : {}),
          ...(req.providerKind !== undefined ? { providerKind: req.providerKind } : {}),
          enabledOnly: req.enabledOnly !== false,
        }),
      )
    }
    return { models }
  })

  typedIpcHandle('canvas:media-models:describe', async (req) => {
    const catalog = getMediaModelCatalogService()
    let manifest = catalog.describe(req.manifestId)
    let model: CanvasMediaModelSummary | null = null
    if (req.providerProfileId) {
      const profiles = await getProviderService().listProviders()
      const profile = profiles.find((item) => item.id === req.providerProfileId)
      if (profile) {
        // Provider 引用可能携带完整自定义 Manifest；统一解析可同时覆盖目录与旧合成兜底。
        if (!manifest) manifest = resolveProfileMediaModels(profile, catalog, { enabledOnly: false })
          .find((item) => item.manifest.id === req.manifestId)?.manifest ?? null
        model =
          profileMediaModelSummaries(profile, catalog, { enabledOnly: false }).find(
            (item) => item.manifestId === req.manifestId,
          ) ?? null
      }
    }
    if (!manifest) return { manifest: null, model: null }
    return { manifest, model }
  })

  typedIpcHandle('canvas:media:prune-model-params', async (req) => {
    const catalog = getMediaModelCatalogService()
    let manifest = catalog.describe(req.manifestId)
    if (!manifest && req.providerProfileId) {
      const profiles = await getProviderService().listProviders()
      const profile = profiles.find((item) => item.id === req.providerProfileId)
      if (profile) {
        manifest =
          resolveProfileMediaModels(profile, catalog, { enabledOnly: false })
            .find((item) => item.manifest.id === req.manifestId)?.manifest ?? null
      }
    }
    if (!manifest) {
      return {
        prunedModelParams: req.modelParams,
        droppedParams: [],
        warnings: [],
        validationIssues: [],
        fallbackReason: `manifest ${req.manifestId} 未找到，跳过 contract 裁剪`,
      }
    }
    const capability = manifest.capabilities.find((cap) => cap.id === req.capabilityId)
    if (!capability) {
      return {
        prunedModelParams: req.modelParams,
        droppedParams: [],
        warnings: [],
        validationIssues: [],
        fallbackReason: `capability ${req.capabilityId} 不存在于 manifest ${req.manifestId}`,
      }
    }
    const result = compileMediaRequest({
      manifest,
      capability,
      modelId: manifest.modelId,
      input: {
        ...(req.modelParams !== undefined ? { modelParams: req.modelParams } : {}),
        ...(req.inputFiles !== undefined ? { inputFiles: req.inputFiles } : {}),
      },
      mode: 'canvas',
    })
    return {
      prunedModelParams: result.providerParams,
      droppedParams: result.droppedParams,
      warnings: result.warnings,
      validationIssues: result.validationIssues,
    }
  })

  typedIpcHandle('canvas:media:prune-model-params-by-inline-manifest', async (req) => {
    const parsed = MediaModelManifestSchema.safeParse(req.manifest)
    if (!parsed.success) {
      return {
        prunedModelParams: req.modelParams,
        droppedParams: [],
        warnings: [],
        validationIssues: [],
        fallbackReason: `manifest 校验失败：${parsed.error.issues.map((i) => i.message).join('; ')}`,
      }
    }
    const manifest = parsed.data
    const capability = manifest.capabilities.find((cap) => cap.id === req.capabilityId)
    if (!capability) {
      return {
        prunedModelParams: req.modelParams,
        droppedParams: [],
        warnings: [],
        validationIssues: [],
        fallbackReason: `capability ${req.capabilityId} 不存在于 inline manifest`,
      }
    }
    const result = compileMediaRequest({
      manifest,
      capability,
      modelId: manifest.modelId,
      input: {
        ...(req.modelParams !== undefined ? { modelParams: req.modelParams } : {}),
        ...(req.inputFiles !== undefined ? { inputFiles: req.inputFiles } : {}),
      },
      mode: 'canvas',
    })
    return {
      prunedModelParams: result.providerParams,
      droppedParams: result.droppedParams,
      warnings: result.warnings,
      validationIssues: result.validationIssues,
    }
  })

  typedIpcHandle('canvas:task:create-media', async (req) => {
    const taskRuntime = getMediaTaskRuntimeService()
    const resolvedProviders = await resolveCanvasMediaProviders()
    const providers = req.modelId
      ? resolvedProviders.map((provider) => {
          const shouldOverride =
            req.providerProfileId != null
              ? provider.id === req.providerProfileId
              : provider.modelIds?.includes(req.modelId ?? '') === true
          return shouldOverride ? { ...provider, defaultModel: req.modelId as string } : provider
        })
      : resolvedProviders
    const outputDir =
      req.outputDir && req.outputDir.trim().length > 0 ? req.outputDir : getDefaultCanvasMediaDir()
    log.info(
      `canvas:task:create-media requested, projectId=${req.projectId ?? '(n/a)'} clientTaskId=${req.clientTaskId ?? '(n/a)'} op=${req.operation} provider=${req.providerProfileId ?? '(auto)'} model=${req.modelId ?? '(auto)'} background=${req.waitForCompletion === false} inputFiles=${req.inputFiles?.length ?? 0}`,
    )
    // capability 由 router 按 operation 推导（input.capability 留空）
    try {
      const runtimeRequest = buildCanvasRuntimeRequest(req)
      const input = {
        operation: req.operation,
        ...(runtimeRequest.prompt || req.prompt != null
          ? {
              prompt: buildCanvasMediaProviderPrompt({
                userPrompt: runtimeRequest.prompt,
                ...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
              }),
            }
          : {}),
        ...(req.negativePrompt != null ? { negativePrompt: req.negativePrompt } : {}),
        ...(req.inputFiles != null
          ? {
              inputFiles: req.inputFiles.map((file) => ({
                type: file.type,
                ...(file.path != null ? { path: file.path } : {}),
                ...(file.url != null ? { url: file.url } : {}),
                ...(file.dataUrl != null ? { dataUrl: file.dataUrl } : {}),
                ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
                ...(file.role != null ? { role: file.role } : {}),
              })),
            }
          : {}),
        ...(req.modelParams != null ? { modelParams: req.modelParams } : {}),
        outputDir,
      }
      const options = {
        providers,
        ...(req.providerProfileId != null ? { providerProfileId: req.providerProfileId } : {}),
        ...(req.manifestId != null ? { manifestId: req.manifestId } : {}),
        ...(req.modelId != null ? { modelId: req.modelId } : {}),
      }
      if (req.waitForCompletion === false) {
        const task = taskRuntime.submitBackground(input, options, (record) => {
          if (record.status === 'running') return
          void canvasResponseFromMediaTaskRecord(record).then((response) => {
            pushStreamEvent('stream:canvas:media-task', {
              ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
              ...(req.clientTaskId !== undefined ? { clientTaskId: req.clientTaskId } : {}),
              runtimeTaskId: record.id,
              status: record.status === 'succeeded' ? 'succeeded' : record.status,
              response,
            })
          })
        })
        return canvasResponseFromMediaTaskRecord(task)
      }
      const task = await taskRuntime.submit(input, options)
      log.info(
        `canvas:task:create-media finished (sync), runtimeTaskId=${task.id} status=${task.status} assets=${task.assets.length}`,
      )
      return canvasResponseFromMediaTaskRecord(task)
    } catch (err) {
      const code = (err as MediaProviderError)?.code ?? 'provider_http_error'
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`canvas:task:create-media failed: ${code} ${message}`)
      const response: CanvasMediaTaskCreateResponse = {
        status: 'failed',
        providerProfileId: '',
        provider: '',
        model: '',
        mode: 'sync',
        assets: [],
        error: { code, message },
      }
      return response
    }
  })

  typedIpcHandle('canvas:task:generate-text', async (req) => {
    const fail = (
      code: string,
      message: string,
      extra: Partial<Omit<CanvasTextTaskCreateResponse, 'status' | 'text' | 'error'>> = {},
    ): CanvasTextTaskCreateResponse => ({
      status: 'failed',
      providerProfileId: extra.providerProfileId ?? '',
      provider: extra.provider ?? '',
      model: extra.model ?? '',
      text: '',
      ...(extra.rawResponse !== undefined ? { rawResponse: extra.rawResponse } : {}),
      ...(extra.requestCall !== undefined ? { requestCall: extra.requestCall } : {}),
      error: { code, message },
    })
    log.info(
      `canvas:task:generate-text requested, projectId=${req.projectId ?? '(n/a)'} clientTaskId=${req.clientTaskId ?? '(n/a)'} agentId=${req.agentId ?? '(n/a)'} provider=${req.providerProfileId ?? '(auto)'} model=${req.modelId ?? '(auto)'} background=${req.waitForCompletion === false} images=${(req.inputFiles ?? []).filter((f) => f.type === 'image').length}`,
    )
    const runTextGeneration = async (): Promise<CanvasTextTaskCreateResponse> => {
      const profiles = await getProviderService().listProviders()
      // 候选文本 provider：有密钥(keystoreRef + secret)，且非纯媒体(image/voice/video)
      const isTextProvider = (p: (typeof profiles)[number]) =>
        p.modelType === undefined || p.modelType === 'text' || p.modelType === 'multimodal'
      // 专属 agent：命中时用其人设 prompt 作 system，并在未显式指定 provider/model 时沿用 agent 绑定值
      const agent = req.agentId ? getAgentRepository().get(req.agentId) : null
      const agentPersona =
        agent && typeof agent.prompt === 'string' && agent.prompt.trim().length > 0
          ? agent.prompt.trim()
          : ''
      const preferredProviderId =
        req.providerProfileId ?? (agent?.providerProfileId ? agent.providerProfileId : null)
      const ordered = preferredProviderId
        ? profiles.filter((p) => p.id === preferredProviderId)
        : [...profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      let chosen: { profile: (typeof profiles)[number]; apiKey: string } | null = null
      for (const profile of ordered) {
        if (preferredProviderId == null && !isTextProvider(profile)) continue
        if (!profile.keystoreRef) continue
        try {
          const apiKey = await resolveProviderApiKeyForProfile(profile)
          if (apiKey && apiKey.trim().length > 0) {
            chosen = { profile, apiKey }
            break
          }
        } catch {
          // 跳过解析失败的 provider
        }
      }
      if (!chosen) {
        return fail(
          'provider_not_configured',
          '未找到可用的文本模型 Provider（需要已配置 API Key 的文本/通用模型）',
        )
      }
      const model =
        req.modelId?.trim() ||
        (agent?.modelId && agent.modelId.trim().length > 0 ? agent.modelId.trim() : '') ||
        chosen.profile.defaultModel
      // system 提示词：选了专属 agent 用其人设，否则用通用影视创作助手；反向提示词作为硬约束追加。
      const baseSystem =
        agentPersona || '你是影视创作助手。严格遵循用户指令，直接输出结果，不要解释过程。'
      const selectedSkillIds = Array.isArray(req.skillIds)
        ? req.skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      const skillPrompts = selectedSkillIds
        .map((skillId) => getSkillService().buildSkillSystemPrompt(skillId))
        .filter(
          (prompt): prompt is string => typeof prompt === 'string' && prompt.trim().length > 0,
        )
      const responseFormat =
        typeof req.modelParams?.responseFormat === 'string'
          ? req.modelParams.responseFormat
          : typeof req.modelParams?.response_format === 'string'
            ? req.modelParams.response_format
            : ''
      const jsonConstraint =
        responseFormat.toLowerCase() === 'json'
          ? '\n\n输出格式硬约束：只返回合法 JSON，不要 Markdown，不要代码块，不要额外解释。'
          : ''
      const runtimeRequest = buildCanvasRuntimeRequest(req)
      const system = buildCanvasSystemPrompt({
        capabilityPrompt: [req.systemPrompt, jsonConstraint].filter(Boolean).join('\n\n'),
        agentPrompt: baseSystem,
        skillPrompts,
        ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
      })
      const temperature =
        typeof req.modelParams?.temperature === 'number' ? req.modelParams.temperature : undefined
      const requestedMaxTokens =
        typeof req.modelParams?.maxTokens === 'number'
          ? req.modelParams.maxTokens
          : typeof req.modelParams?.max_tokens === 'number'
            ? req.modelParams.max_tokens
            : undefined
      const tokenBudget = resolveCanvasTextTokenBudget({
        requestedMaxTokens,
        providerMaxTokens: chosen.profile.maxTokens,
        providerContextWindow: chosen.profile.contextWindow,
        providerSupportsMillionContext: chosen.profile.supportsMillionContext,
        model,
        taskPipelineRole: req.taskPipelineRole,
        prompt: runtimeRequest.prompt,
      })
      const maxTokens = tokenBudget.maxTokens
      log.info(
        `canvas:task:generate-text budget, projectId=${req.projectId ?? '(n/a)'} clientTaskId=${req.clientTaskId ?? '(n/a)'} model=${model} maxTokens=${maxTokens ?? '(provider-default)'} source=${tokenBudget.source ?? 'unset'} providerContext=${tokenBudget.providerContextWindow ?? '(n/a)'} modelContext=${tokenBudget.modelContextWindow ?? '(n/a)'} modelMaxOutput=${tokenBudget.modelMaxOutputTokens ?? '(n/a)'} promptEstimate=${tokenBudget.promptTokensEstimate ?? '(n/a)'}`,
      )
      const rawReasoningEffort =
        typeof req.reasoningEffort === 'string'
          ? req.reasoningEffort
          : typeof req.modelParams?.reasoningEffort === 'string'
            ? req.modelParams.reasoningEffort
            : typeof req.modelParams?.reasoning_effort === 'string'
              ? req.modelParams.reasoning_effort
              : undefined
      const reasoningEffort = rawReasoningEffort != null && isProtocolReasoning(rawReasoningEffort)
        ? rawReasoningEffort
        : agent?.reasoningEffort != null && isProtocolReasoning(agent.reasoningEffort)
          ? agent.reasoningEffort
          : undefined
      const disableThinking = req.taskPipelineRole === 'shot' || responseFormat.toLowerCase() === 'json'
      const apiKind = chosen.profile.codexApiKind === 'responses' ? 'responses' : 'chat'
      let result: Awaited<ReturnType<typeof generateCanvasText>>
      try {
        result = await generateCanvasText({
          providerType: chosen.profile.provider,
          apiKind,
          apiKey: chosen.apiKey,
          ...(chosen.profile.apiEndpoint ? { apiEndpoint: chosen.profile.apiEndpoint } : {}),
          model,
          system,
          prompt: runtimeRequest.prompt,
          ...(runtimeRequest.images.length > 0 ? { images: runtimeRequest.images } : {}),
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { maxTokens } : {}),
          ...(reasoningEffort != null ? { reasoningEffort } : {}),
          ...(disableThinking ? { disableThinking: true } : {}),
          ...(responseFormat.toLowerCase() === 'json' ? { responseFormat: 'json' as const } : {}),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const requestCall = err instanceof CanvasTextProviderError ? err.requestCall : undefined
        const rawResponse = buildCanvasTextRawResponse({
          providerProfileId: chosen.profile.id,
          provider: chosen.profile.provider,
          providerName: chosen.profile.name,
          model,
          apiKind,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          skillIds: selectedSkillIds,
          relationManifest: runtimeRequest.relationManifest,
          taskPipelineRole: req.taskPipelineRole,
          effectiveMaxTokens: tokenBudget.maxTokens,
          maxTokensSource: tokenBudget.source,
          promptTokensEstimate: tokenBudget.promptTokensEstimate,
          providerMaxTokens: tokenBudget.providerMaxTokens,
          providerContextWindow: tokenBudget.providerContextWindow,
          modelContextWindow: tokenBudget.modelContextWindow,
          modelMaxOutputTokens: tokenBudget.modelMaxOutputTokens,
          ...(err instanceof CanvasTextProviderError
            ? {
                statusCode: err.statusCode,
                errorBody: err.responseBody,
              }
            : {}),
        })
        return fail(
          err instanceof CanvasTextProviderError ? err.code : 'text_generation_failed',
          message,
          {
            providerProfileId: chosen.profile.id,
            provider: chosen.profile.provider,
            model,
            ...(requestCall !== undefined ? { requestCall } : {}),
            rawResponse,
          },
        )
      }
      return {
        status: 'succeeded' as const,
        providerProfileId: chosen.profile.id,
        provider: chosen.profile.provider,
        model,
        text: result.text,
        ...(result.requestCall !== undefined ? { requestCall: result.requestCall } : {}),
        rawResponse: buildCanvasTextRawResponse({
          providerProfileId: chosen.profile.id,
          provider: chosen.profile.provider,
          providerName: chosen.profile.name,
          model,
          apiKind,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          skillIds: selectedSkillIds,
          relationManifest: runtimeRequest.relationManifest,
          taskPipelineRole: req.taskPipelineRole,
          outputText: result.text,
          effectiveMaxTokens: tokenBudget.maxTokens,
          maxTokensSource: tokenBudget.source,
          promptTokensEstimate: tokenBudget.promptTokensEstimate,
          providerMaxTokens: tokenBudget.providerMaxTokens,
          providerContextWindow: tokenBudget.providerContextWindow,
          modelContextWindow: tokenBudget.modelContextWindow,
          modelMaxOutputTokens: tokenBudget.modelMaxOutputTokens,
          providerFinishReason: result.finishReason,
          usage: result.usage,
          reasoningContentChars: result.reasoningContentChars,
        }),
      }
    }
    if (req.waitForCompletion === false) {
      void runTextGeneration()
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          log.warn(`canvas:task:generate-text failed (background path): ${message}`)
          return fail('text_generation_failed', message)
        })
        .then((response) => {
          log.info(
            `canvas:task:generate-text finished (background), status=${response.status} chars=${response.text.length}`,
          )
          pushStreamEvent('stream:canvas:text-task', {
            ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
            ...(req.clientTaskId !== undefined ? { clientTaskId: req.clientTaskId } : {}),
            status: response.status === 'succeeded' ? 'succeeded' : 'failed',
            response,
          })
        })
      return {
        status: 'running',
        providerProfileId: '',
        provider: '',
        model: '',
        text: '',
      }
    }
    try {
      const response = await runTextGeneration()
      log.info(
        `canvas:task:generate-text finished (sync), status=${response.status} provider=${response.provider} model=${response.model} chars=${response.text.length}`,
      )
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`canvas:task:generate-text failed (sync path): ${message}`)
      return fail('text_generation_failed', message)
    }
  })

  typedIpcHandle('canvas:task:cancel-media', async (req) => {
    log.info(`canvas:task:cancel-media requested, runtimeTaskId=${req.runtimeTaskId}`)
    const record = getMediaTaskRuntimeService().cancel(req.runtimeTaskId)
    if (!record) {
      log.warn(`canvas:task:cancel-media: task not found, runtimeTaskId=${req.runtimeTaskId}`)
      return {
        runtimeTaskId: req.runtimeTaskId,
        cancelled: false,
        status: null,
        error: {
          code: 'task_not_found',
          message: `Media task not found: ${req.runtimeTaskId}`,
        },
      }
    }
    log.info(
      `canvas:task:cancel-media resolved, runtimeTaskId=${record.id} status=${record.status} cancelled=${record.status === 'cancelled'}`,
    )
    return {
      runtimeTaskId: record.id,
      cancelled: record.status === 'cancelled',
      status: record.status,
    }
  })

  // ─── Canvas 持久化 Handlers（SQLite-backed 生产存储） ─────────────────────

  typedIpcHandle('canvas:snapshot:save', async (req) => {
    const snapshotRepo = getCanvasSnapshotRepo()
    const projectRepo = getCanvasProjectRepo()
    const directory = await ensureCanvasProjectDirectoryById(
      req.projectId,
      req.meta?.rootPath ?? null,
      req.meta?.title ?? req.projectId,
    )
    let snapshotJson = req.snapshotJson
    try {
      const snapshot = JSON.parse(req.snapshotJson)
      if (snapshot?.project) snapshot.project.rootPath = directory.rootPath
      snapshotJson = JSON.stringify(snapshot)
      await writeCanvasProjectPackageFiles({
        projectId: req.projectId,
        rootPath: directory.rootPath,
        snapshotJson,
      })
    } catch (err) {
      log.warn(`canvas:snapshot:save project files failed: ${String(err)}`)
    }
    projectRepo.upsert({
      id: req.projectId,
      title: req.meta?.title ?? req.projectId,
      ...(req.meta?.description !== undefined ? { description: req.meta.description } : {}),
      ...(req.meta?.status !== undefined ? { status: req.meta.status } : {}),
      ...(req.meta?.nodeCount !== undefined ? { nodeCount: req.meta.nodeCount } : {}),
      ...(req.meta?.assetCount !== undefined ? { assetCount: req.meta.assetCount } : {}),
      ...(req.meta?.taskCount !== undefined ? { taskCount: req.meta.taskCount } : {}),
      ...(req.meta?.coverAssetId !== undefined ? { coverAssetId: req.meta.coverAssetId } : {}),
      ...(req.meta?.coverUrl !== undefined ? { coverUrl: req.meta.coverUrl } : {}),
      ...(req.meta?.pinned !== undefined ? { pinned: req.meta.pinned } : {}),
      ...(req.meta?.pinnedAt !== undefined ? { pinnedAt: req.meta.pinnedAt } : {}),
      rootPath: directory.rootPath,
      lastOpenedAt: new Date().toISOString(),
    })
    snapshotRepo.save(req.projectId, 0, snapshotJson)
    return { saved: true, updatedAt: new Date().toISOString() }
  })

  typedIpcHandle('canvas:snapshot:load', async (req) => {
    const project = getCanvasProjectRepo().get(req.projectId)
    if (project?.root_path) {
      const latestPath = path.join(project.root_path, 'snapshots', 'latest.json')
      try {
        const snapshotJson = await fs.readFile(latestPath, 'utf-8')
        return { snapshotJson }
      } catch {
        // Directory snapshots are preferred but SQLite remains a compatibility fallback.
      }
    }
    const row = getCanvasSnapshotRepo().get(req.projectId)
    return { snapshotJson: row ? row.snapshot_json : null }
  })

  typedIpcHandle('canvas:project:list', async (req) => {
    const rows = getCanvasProjectRepo().list(0, req.includeDeleted === true)
    const projects = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      rootPath: row.root_path,
      coverUrl: row.cover_url ?? null,
      pinned: row.pinned === 1,
      pinnedAt: row.pinned_at,
      nodeCount: row.node_count,
      assetCount: row.asset_count,
      taskCount: row.task_count,
      lastOpenedAt: row.last_opened_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    return { projects }
  })

  typedIpcHandle('canvas:project:delete', async (req) => {
    // 读出 root_path 后再删除 DB 行：hardDelete 会移除该行，丢失路径。
    // 用户预期「删除」即彻底清理（含项目文件夹），软删/硬删均清理磁盘。
    const project = getCanvasProjectRepo().get(req.projectId)
    const rootPath = project?.root_path ?? null
    let directoryRemoved = false
    if (rootPath) {
      directoryRemoved = await removeCanvasProjectDirectory(rootPath)
    }
    if (req.hard) {
      getCanvasProjectRepo().hardDelete(req.projectId)
    } else {
      getCanvasProjectRepo().softDelete(req.projectId)
    }
    return { deleted: true, directoryRemoved }
  })

  typedIpcHandle('canvas:project:update-cover', async (req) => {
    // 直接覆盖 cover_url；前端负责把图片写入项目目录后传入 safe-file URL。
    // 传 null 清除封面（列表卡片回退到默认图标）。
    const repo = getCanvasProjectRepo()
    const existing = repo.get(req.projectId)
    if (!existing) throw new Error(`Canvas project not found: ${req.projectId}`)
    const updatedAt = new Date().toISOString()
    repo.upsert({
      id: existing.id,
      title: existing.title,
      description: existing.description,
      status: existing.status,
      coverAssetId: existing.cover_asset_id,
      coverUrl: req.coverUrl,
      nodeCount: existing.node_count,
      assetCount: existing.asset_count,
      taskCount: existing.task_count,
      rootPath: existing.root_path,
      lastOpenedAt: existing.last_opened_at,
      createdAt: existing.created_at,
    })
    return { coverUrl: req.coverUrl, updatedAt }
  })

  typedIpcHandle('canvas:project:default-root', async () => {
    const rootPath = getDefaultCanvasProjectsRoot()
    await fs.mkdir(rootPath, { recursive: true })
    return { rootPath }
  })

  typedIpcHandle('canvas:project:ensure-directory', async (req) => {
    const directory = await ensureCanvasProjectDirectory(req)
    const row = getCanvasProjectRepo().get(req.projectId)
    if (row) {
      getCanvasProjectRepo().upsert({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        coverAssetId: row.cover_asset_id,
        coverUrl: row.cover_url,
        nodeCount: row.node_count,
        assetCount: row.asset_count,
        taskCount: row.task_count,
        ...(row.pinned === 1 ? { pinned: true, pinnedAt: row.pinned_at } : { pinned: false }),
        lastOpenedAt: row.last_opened_at,
        createdAt: row.created_at,
        rootPath: directory.rootPath,
      })
    }
    return directory
  })

  typedIpcHandle('canvas:asset:write-data-url', async (req) => {
    return writeCanvasAssetDataUrl({
      projectId: req.projectId,
      projectRootPath: req.projectRootPath ?? null,
      dataUrl: req.dataUrl,
      ...(req.mimeType !== undefined ? { mimeType: req.mimeType } : {}),
      ...(req.suggestedBaseName !== undefined ? { suggestedBaseName: req.suggestedBaseName } : {}),
      ...(req.type !== undefined ? { type: req.type } : {}),
    })
  })

  typedIpcHandle('canvas:asset:copy-to-project', async (req) => {
    return copyCanvasAssetToProject({
      projectId: req.projectId,
      projectRootPath: req.projectRootPath ?? null,
      ...(req.sourcePath !== undefined ? { sourcePath: req.sourcePath } : {}),
      ...(req.sourceUrl !== undefined ? { sourceUrl: req.sourceUrl } : {}),
      ...(req.suggestedBaseName !== undefined ? { suggestedBaseName: req.suggestedBaseName } : {}),
      ...(req.type !== undefined ? { type: req.type } : {}),
    })
  })

  typedIpcHandle('canvas:asset:download', async (req) => {
    const suggestedFileName = ensureFileNameExtension(req.suggestedFileName, {
      ...(req.mimeType !== undefined ? { mimeType: req.mimeType } : {}),
      ...(req.type !== undefined ? { type: req.type } : {}),
      ...(req.sourcePath !== undefined ? { sourcePath: req.sourcePath } : {}),
      ...(req.sourceUrl !== undefined ? { sourceUrl: req.sourceUrl } : {}),
    })
    const defaultDirectory = req.defaultDirectory?.trim() || app.getPath('downloads')
    const result = await dialog.showSaveDialog({
      title: '下载项目资产',
      defaultPath: path.join(defaultDirectory, suggestedFileName),
      filters: canvasAssetDownloadFilters(req.type),
    })

    if (result.canceled || !result.filePath) return { saved: false }

    try {
      const source = await resolveCanvasAssetDownloadSource({
        ...(req.sourcePath !== undefined ? { sourcePath: req.sourcePath } : {}),
        ...(req.sourceUrl !== undefined ? { sourceUrl: req.sourceUrl } : {}),
        ...(req.contentText !== undefined ? { contentText: req.contentText } : {}),
        ...(req.mimeType !== undefined ? { mimeType: req.mimeType } : {}),
      })
      if (source.kind === 'file') await fs.copyFile(source.sourcePath, result.filePath)
      else await fs.writeFile(result.filePath, source.buffer)
      return { saved: true, savedPath: result.filePath }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn(`canvas:asset:download failed, target=${result.filePath}, error=${error}`)
      return { saved: false, error }
    }
  })

  typedIpcHandle('canvas:asset:download-batch', async (req) => {
    // 批量下载：只弹一次目录选择对话框，然后把所有资产写入该目录。
    // 文件名冲突时自动加序号（name-1.png / name-2.png），避免互相覆盖。
    const defaultDirectory = req.defaultDirectory?.trim() || app.getPath('downloads')
    const openResult = await dialog.showOpenDialog({
      title: `批量下载 ${req.items.length} 个资产到文件夹`,
      defaultPath: defaultDirectory,
      properties: ['openDirectory', 'createDirectory'],
    })
    const targetDirectory = openResult.filePaths[0]
    if (openResult.canceled || !targetDirectory) {
      return { canceled: true, succeeded: 0, failed: 0, results: [] }
    }
    // 先同步预分配每个资产的文件名（含冲突去重），避免 Promise.all 并发时
    // 两个 item 同时读到相同的 usedFileNames 状态、算出相同文件名而互相覆盖。
    const usedFileNames = new Set<string>()
    const plannedNames: string[] = req.items.map((item) => {
      const baseName = ensureFileNameExtension(item.suggestedFileName, {
        ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
        ...(item.type !== undefined ? { type: item.type } : {}),
        ...(item.sourcePath !== undefined ? { sourcePath: item.sourcePath } : {}),
        ...(item.sourceUrl !== undefined ? { sourceUrl: item.sourceUrl } : {}),
      })
      const candidateName = dedupeBatchFileName(baseName, usedFileNames)
      usedFileNames.add(candidateName.toLowerCase())
      return candidateName
    })

    const results: CanvasAssetDownloadBatchResultItem[] = await Promise.all(
      req.items.map(async (item, index): Promise<CanvasAssetDownloadBatchResultItem> => {
        try {
          const source = await resolveCanvasAssetDownloadSource({
            ...(item.sourcePath !== undefined ? { sourcePath: item.sourcePath } : {}),
            ...(item.sourceUrl !== undefined ? { sourceUrl: item.sourceUrl } : {}),
            ...(item.contentText !== undefined ? { contentText: item.contentText } : {}),
            ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
          })
          const targetPath = path.join(targetDirectory, plannedNames[index]!)
          if (source.kind === 'file') await fs.copyFile(source.sourcePath, targetPath)
          else await fs.writeFile(targetPath, source.buffer)
          return { index, saved: true, savedPath: targetPath }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          log.warn(`canvas:asset:download-batch item#${index} failed: ${error}`)
          return { index, saved: false, error }
        }
      }),
    )

    const succeeded = results.filter((item) => item.saved).length
    return {
      canceled: false,
      targetDirectory,
      succeeded,
      failed: results.length - succeeded,
      results,
    }
  })

  typedIpcHandle('canvas:project:export-package', async (req) => {
    const targetParent = req.targetParentDirectory?.trim()
      ? path.resolve(req.targetParentDirectory)
      : (
          await dialog.showOpenDialog({
            title: '选择 Canvas 项目包导出位置',
            properties: ['openDirectory', 'createDirectory'],
          })
        ).filePaths[0]
    if (!targetParent) return { exported: false }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const packageDir = path.join(
      targetParent,
      `${sanitizeCanvasPathSegment(req.title, 'canvas-project')}-${stamp}`,
    )
    await fs.mkdir(packageDir, { recursive: true })
    const sourceRoot = req.projectRootPath?.trim()
    if (sourceRoot) {
      try {
        await fs.cp(path.join(sourceRoot, 'assets'), path.join(packageDir, 'assets'), {
          recursive: true,
          force: true,
        })
      } catch {
        // Some legacy projects have no project-local assets yet; snapshot export still succeeds.
      }
    }
    let snapshotJson = req.snapshotJson
    if (sourceRoot) {
      try {
        const normalizedSourceRoot = path.resolve(sourceRoot)
        const rewritten = rewriteCanvasSnapshotRootPaths(
          JSON.parse(req.snapshotJson),
          normalizedSourceRoot,
          packageDir,
        )
        snapshotJson = JSON.stringify(rewritten)
      } catch {
        snapshotJson = req.snapshotJson
      }
    }
    await writeCanvasProjectPackageFiles({
      projectId: req.projectId,
      rootPath: packageDir,
      snapshotJson,
    })
    return { exported: true, directoryPath: packageDir }
  })

  typedIpcHandle('canvas:project:migrate-assets', async (req) => {
    const directory = await ensureCanvasProjectDirectoryById(
      req.projectId,
      req.projectRootPath ?? null,
    )
    const snapshot = JSON.parse(req.snapshotJson)
    const urlMap = new Map<string, string>()
    let movedAssets = 0
    let skippedAssets = 0
    const migrateRef = async (
      value: unknown,
      title: string | undefined,
      kind: CanvasAssetKind | undefined,
    ): Promise<string | null> => {
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.startsWith('data:') ||
        /^https?:\/\//i.test(value)
      ) {
        return null
      }
      const cached = urlMap.get(value)
      if (cached) return cached
      const sourcePath = decodeSafeFileUrl(value) ?? (path.isAbsolute(value) ? value : null)
      if (!sourcePath) return null
      if (path.resolve(sourcePath).startsWith(directory.rootPath + path.sep)) return null
      const copied = await copyCanvasAssetToProject({
        projectId: req.projectId,
        projectRootPath: directory.rootPath,
        sourcePath,
        ...(title !== undefined ? { suggestedBaseName: title } : {}),
        ...(kind !== undefined ? { type: kind } : {}),
      })
      if (!copied.filePath) {
        skippedAssets += 1
        return null
      }
      const nextUrl = toSafeFileUrl(copied.filePath)
      urlMap.set(value, nextUrl)
      urlMap.set(sourcePath, nextUrl)
      movedAssets += copied.copied ? 1 : 0
      return nextUrl
    }

    for (const asset of Array.isArray(snapshot.assets) ? snapshot.assets : []) {
      const kind =
        asset.type === 'audio' || asset.type === 'video' || asset.type === 'image'
          ? asset.type
          : 'file'
      const nextUrl = await migrateRef(
        asset.url ?? asset.storageKey ?? asset.metadata?.filePath,
        asset.title ?? asset.id,
        kind,
      )
      if (nextUrl) {
        const nextPath = decodeSafeFileUrl(nextUrl)
        asset.url = nextUrl
        asset.storageKey = nextPath
        asset.metadata = {
          ...(asset.metadata ?? {}),
          storageAdapter: 'local-file',
          filePath: nextPath,
        }
        if (kind === 'image') asset.thumbnailUrl = nextUrl
      }
      const nextThumbUrl = await migrateRef(
        asset.thumbnailUrl ?? asset.thumbnailKey,
        `${asset.title ?? asset.id}-thumb`,
        'image',
      )
      if (nextThumbUrl) {
        asset.thumbnailUrl = nextThumbUrl
        asset.thumbnailKey = decodeSafeFileUrl(nextThumbUrl)
      }
    }

    const assetById = new Map<string, CanvasMigratedAssetRef>(
      (Array.isArray(snapshot.assets) ? (snapshot.assets as unknown[]) : [])
        .filter((asset: unknown): asset is CanvasMigratedAssetRef => {
          return typeof asset === 'object' && asset != null && 'id' in asset
        })
        .map((asset) => [String(asset.id), asset]),
    )
    for (const node of Array.isArray(snapshot.nodes) ? snapshot.nodes : []) {
      const asset = node.assetId ? assetById.get(node.assetId) : null
      if (asset?.url) node.data = { ...(node.data ?? {}), url: asset.url }
      if (asset?.thumbnailUrl)
        node.data = { ...(node.data ?? {}), thumbnailUrl: asset.thumbnailUrl }
      if (asset?.storageKey && node.data?.url && urlMap.has(node.data.url)) {
        node.data.url = urlMap.get(node.data.url)
      }
    }
    if (snapshot.project) snapshot.project.rootPath = directory.rootPath
    const snapshotJson = JSON.stringify(snapshot)
    await writeCanvasProjectPackageFiles({
      projectId: req.projectId,
      rootPath: directory.rootPath,
      snapshotJson,
    })
    return { migrated: movedAssets > 0, movedAssets, skippedAssets, snapshotJson }
  })

  typedIpcHandle('canvas:project:cleanup-orphans', async (req) => {
    const root = getDefaultCanvasMediaDir()
    const used = new Set<string>()
    const rows = getDatabase()
      .raw.prepare('SELECT snapshot_json FROM canvas_snapshots')
      .all() as Array<{ snapshot_json: string }>
    for (const row of rows) {
      try {
        const snapshot = JSON.parse(row.snapshot_json)
        for (const item of collectCanvasSnapshotLocalPaths(snapshot)) used.add(item)
      } catch {
        // Skip malformed legacy snapshots.
      }
    }
    let scannedFiles = 0
    let deletedFiles = 0
    let deletedBytes = 0
    const visit = async (dir: string): Promise<void> => {
      let entries: Array<{
        name: string
        isDirectory: () => boolean
        isFile: () => boolean
      }>
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(full)
          continue
        }
        if (!entry.isFile()) continue
        scannedFiles += 1
        const resolved = path.resolve(full)
        if (used.has(resolved)) continue
        const st = await fs.stat(full)
        deletedFiles += 1
        deletedBytes += st.size
        if (req.dryRun !== true) await fs.unlink(full)
      }
    }
    await visit(root)
    return { deletedFiles, deletedBytes, scannedFiles, dryRun: req.dryRun === true }
  })
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
    if (result.imported > 0) pushConfigChanged('provider', 'import')
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
      log.info(
        `provider:export-to-file wrote ${payload.profiles.length} profiles to ${result.filePath}`,
      )
      return { filePath: result.filePath, count: payload.profiles.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`provider:export-to-file write failed: ${message}`)
      throw new Error(`写入文件失败：${message}`, { cause: err })
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
      throw new Error(`读取文件失败：${message}`, { cause: err })
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`provider:import-from-file parse failed: ${message}`)
      throw new Error(`JSON 解析失败：${message}`, { cause: err })
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
      log.info(
        `provider:import-from-file accepting older version ${parsed.version} (current: ${PROVIDER_EXPORT_VERSION})`,
      )
    }

    return { payload: parsed as ProviderExportPayload, filePath }
  })

  // ─── History Import Handlers ───────────────────────────────────────────
  // 检测 + 导入宿主机 Claude Code / Codex 对话历史。导入后写入标准 agent_events，
  // 运行时在 sendTurn 时从事件重建对话历史，因此天然可继续对话。

  typedIpcHandle('history-import:scan', async (req) => {
    log.info('history-import:scan requested')
    const svc = createHistoryImportService()
    return svc.scan(req.sources)
  })

  typedIpcHandle('history-import:preview', async (req) => {
    log.info(`history-import:preview requested, source=${req.source}`)
    const svc = createHistoryImportService()
    return svc.preview(req.source, req.filePath, req.limit ?? 20)
  })

  typedIpcHandle('history-import:import', async (req) => {
    log.info(`history-import:import requested, count=${req.selections.length}`)
    const svc = createHistoryImportService((progress) => {
      pushStreamEvent('stream:history-import:progress', progress)
    })
    const result = await svc.import(req.selections)
    log.info(
      `history-import:import done, imported=${result.imported}, skipped=${result.skipped}, failed=${result.failed}`,
    )
    return result
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
    const refreshed =
      workspace == null ? null : new WorkspaceRepository(getDatabase()).get(workspace.id)
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
    const deletedSessionIds = sessionRepo.deleteByWorkspaceId(req.workspaceId)
    for (const sessionId of deletedSessionIds) {
      getSessionService().cleanupSessionEventsInBackground(sessionId)
    }
    // 关闭该 workspace 名下所有内置终端 PTY
    getTerminalService().disposeByWorkspaceId(req.workspaceId, { defer: true })
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
    // 关闭 workspace 时同时杀掉该 workspace 名下所有内置终端 PTY
    getTerminalService().disposeByWorkspaceId(req.workspaceId, { defer: true })
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
    try {
      await execFileAsync('git', ['switch', req.branch], { cwd: workspace.root_path })
      const result = await getWorkspaceBranches(workspace.root_path)
      if (result.currentBranch == null) {
        throw new Error('Unable to determine current git branch after switch')
      }
      return { currentBranch: result.currentBranch, branches: result.branches }
    } catch (err) {
      throw new SparkError('GIT_OPERATION_FAILED', getGitExecErrorMessage(err, '切换分支失败'), {
        cause: err,
      })
    }
  })

  typedIpcHandle('workspace:git-status', async (req) => {
    log.info(`workspace:git-status requested, workspaceId=${req.workspaceId}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    return getWorkspaceGitStatus(workspace.root_path)
  })

  typedIpcHandle('workspace:git-file-diff', async (req) => {
    log.info(`workspace:git-file-diff requested, workspaceId=${req.workspaceId}, path=${req.path}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    return getWorkspaceGitFileDiff(workspace.root_path, req.path, req.untracked === true)
  })

  typedIpcHandle('workspace:git-check-ignore', async (req) => {
    if (!Array.isArray(req.paths) || req.paths.length === 0) return { ignoredPaths: [] }
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    // git check-ignore 对所有路径都不被忽略时退出码=1 → tryGitStdout catch 返回 null
    // 被忽略时退出码=0，stdout 用 -z 按 NUL 分隔列出被忽略路径
    const out = await tryGitStdout(workspace.root_path, ['check-ignore', '-z', '--', ...req.paths])
    if (out == null || out === '') return { ignoredPaths: [] }
    return {
      ignoredPaths: out
        .split('\0')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  })

  typedIpcHandle('workspace:git-commit', async (req) => {
    log.info(
      `workspace:git-commit requested, workspaceId=${req.workspaceId}, includeUnstaged=${req.includeUnstaged === true}, push=${req.push === true}`,
    )
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    const message = req.message.trim()
    if (message.length === 0) throw new SparkError('VALIDATION_FAILED', '提交信息不能为空')
    try {
      if (req.includeUnstaged === true) {
        await execFileAsync('git', ['add', '-A'], { cwd: workspace.root_path })
      }
      await execFileAsync('git', ['commit', '-m', message], { cwd: workspace.root_path })
      const sha = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: workspace.root_path,
      })
      let pushed = false
      if (req.push === true) {
        await pushWorkspaceBranch(workspace.root_path)
        pushed = true
      }
      return {
        committed: true,
        pushed,
        commitSha: sha.stdout.trim() || null,
        status: await getWorkspaceGitStatus(workspace.root_path),
      }
    } catch (err) {
      throw new SparkError('GIT_OPERATION_FAILED', getGitExecErrorMessage(err, '提交失败'), {
        cause: err,
      })
    }
  })

  typedIpcHandle('workspace:git-push', async (req) => {
    log.info(`workspace:git-push requested, workspaceId=${req.workspaceId}`)
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    try {
      await pushWorkspaceBranch(workspace.root_path)
      return { pushed: true, status: await getWorkspaceGitStatus(workspace.root_path) }
    } catch (err) {
      throw new SparkError('GIT_OPERATION_FAILED', getGitExecErrorMessage(err, '推送失败'), {
        cause: err,
      })
    }
  })

  typedIpcHandle('workspace:create-branch', async (req) => {
    log.info(
      `workspace:create-branch requested, workspaceId=${req.workspaceId}, branch=${req.branch}`,
    )
    const workspace = new WorkspaceRepository(getDatabase()).findByIdOrFail(req.workspaceId)
    const branch = req.branch.trim()
    if (branch.length === 0) throw new SparkError('VALIDATION_FAILED', '分支名称不能为空')
    if (branch.endsWith('/')) throw new SparkError('VALIDATION_FAILED', '分支名不能以“/”结尾。')
    try {
      await execFileAsync('git', ['check-ref-format', '--branch', branch], {
        cwd: workspace.root_path,
      })
      await execFileAsync('git', ['switch', '-c', branch], { cwd: workspace.root_path })
      const branches = await getWorkspaceBranches(workspace.root_path)
      if (branches.currentBranch == null) {
        throw new Error('Unable to determine current git branch after create')
      }
      return {
        currentBranch: branches.currentBranch,
        branches: branches.branches,
        status: await getWorkspaceGitStatus(workspace.root_path),
      }
    } catch (err) {
      throw new SparkError(
        'GIT_OPERATION_FAILED',
        getGitExecErrorMessage(err, '创建并检出分支失败'),
        { cause: err },
      )
    }
  })

  typedIpcHandle('workspace:list-worktrees', async (req) => {
    log.info(`workspace:list-worktrees requested, workspaceId=${req.workspaceId}`)
    const db = getDatabase()
    const wsRepo = new WorkspaceRepository(db)
    const sessionRepo = new SessionRepository(db)
    const workspace = wsRepo.findByIdOrFail(req.workspaceId)
    const git = new GitWorktreeService()
    try {
      const mainRepoRoot = await git.resolveMainRepoRoot(workspace.root_path)
      const baseBranch = await git.detectBaseBranch(mainRepoRoot)
      const raw = await git.listWorktrees(mainRepoRoot)
      const registered = wsRepo.findWorktreesByBaseRepo(mainRepoRoot)
      // 路径相等比较前统一 realpath 归一化，避免软链导致的失配（如 /var→/private/var）
      const byPath = new Map(registered.map((w) => [normalizeRealPath(w.root_path), w] as const))
      const currentPath = normalizeRealPath(workspace.root_path)
      // 一次性取已合并分支集合，避免逐 worktree spawn git
      const mergedBranches = new Set(await git.listMergedBranches(mainRepoRoot, baseBranch))

      const worktrees = raw.map((w) => {
        const matched = byPath.get(normalizeRealPath(w.path))
        let sessionTitle: string | undefined
        if (matched) {
          const { sessions } = sessionRepo.list({ workspaceId: matched.id, limit: 1 })
          sessionTitle = sessions[0]?.title
        }
        const isMerged = w.branch != null && !w.isMain ? mergedBranches.has(w.branch) : false
        return {
          path: w.path,
          branch: w.branch,
          head: w.head,
          isMain: w.isMain,
          isCurrent: normalizeRealPath(w.path) === currentPath,
          isMerged,
          ...(matched ? { workspaceId: matched.id } : {}),
          ...(sessionTitle ? { sessionTitle } : {}),
        }
      })
      return { isGitRepo: true, baseBranch, baseRepoRoot: mainRepoRoot, worktrees }
    } catch {
      return { isGitRepo: false, baseBranch: null, baseRepoRoot: null, worktrees: [] }
    }
  })

  typedIpcHandle('workspace:create-worktree', async (req) => {
    // 显式分支名优先；否则调用 LLM 根据任务生成（回退到任务 slug / 时间戳）
    const branch = req.branch?.trim() ? req.branch.trim() : await resolveWorktreeBranchName(req)
    log.info(`workspace:create-worktree requested, base=${req.baseWorkspaceId}, branch=${branch}`)
    const workspace = await getWorkspaceService().createWorktreeWorkspace({
      baseWorkspaceId: req.baseWorkspaceId,
      branch,
      ...(req.baseBranch !== undefined && { baseBranch: req.baseBranch }),
    })
    return { workspace: toWorkspaceInfo(workspace) }
  })

  typedIpcHandle('workspace:remove-worktree', async (req) => {
    log.info(`workspace:remove-worktree requested, workspaceId=${req.workspaceId}`)
    await getWorkspaceService().removeWorktreeWorkspace(req.workspaceId, {
      ...(req.force !== undefined && { force: req.force }),
    })
    return { removed: true }
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
    // allowDirectories=true：macOS 支持同一个对话框同时选择文件和目录；Windows/Linux
    // 同时传 openFile + openDirectory 会退化成目录选择器，导致用户点文件后无法完成选择。
    const canPickFilesAndDirectoriesTogether =
      req.allowDirectories === true && process.platform === 'darwin'
    const baseProperties: Array<'openFile' | 'openDirectory' | 'multiSelections'> =
      canPickFilesAndDirectoriesTogether
        ? ['openFile', 'openDirectory', 'multiSelections']
        : req.multiple === true || req.allowDirectories === true
          ? ['openFile', 'multiSelections']
          : ['openFile']
    const result = await dialog.showOpenDialog({
      title: req.title ?? '选择文件',
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath }),
      properties: baseProperties,
      ...(req.filters ? { filters: req.filters } : {}),
    })

    return {
      canceled: result.canceled,
      ...(result.filePaths[0] === undefined ? {} : { filePath: result.filePaths[0] }),
      ...(result.filePaths.length > 0 ? { filePaths: result.filePaths } : {}),
    }
  })

  // 路径类别探测：返回 'file' | 'directory' | 'absent'。供「添加相关文件或目录」前端判断选中项类别。
  typedIpcHandle('file:stat-kind', async (req) => {
    if (!existsSync(req.path)) return { kind: 'absent' as const }
    const stats = statSync(req.path)
    return { kind: stats.isDirectory() ? ('directory' as const) : ('file' as const) }
  })

  typedIpcHandle('dialog:save-file', async (req) => {
    const result = await dialog.showSaveDialog({
      title: req.title ?? '保存文件',
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath }),
      ...(req.filters ? { filters: req.filters } : {}),
    })

    return {
      canceled: result.canceled,
      ...(result.filePath === undefined ? {} : { filePath: result.filePath }),
    }
  })

  typedIpcHandle('file:write-text', async (req) => {
    await fs.writeFile(req.path, req.content, 'utf-8')
    return { success: true }
  })

  typedIpcHandle('file:read-text', async (req) => {
    const content = await fs.readFile(req.path, 'utf-8')
    return { content }
  })

  typedIpcHandle('clipboard:write-text', async (req) => {
    clipboard.writeText(req.text)
    return { success: true }
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

  typedIpcHandle('app:get-startup-settings', async () => {
    return getStartupSettings()
  })

  typedIpcHandle('app:set-startup-settings', async (req) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: req.openAtLogin,
        openAsHidden: req.openAsHidden ?? true,
      })
    } catch (err) {
      log.warn(`Failed to update startup settings: ${String(err)}`)
      throw err
    }
    return getStartupSettings()
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
    const canvasProjectsRoot = getDefaultCanvasProjectsRoot()
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
    const canvasProjectsBytes = await dirSize(canvasProjectsRoot)

    return {
      userDataPath,
      projectsDir,
      canvasProjectsRoot,
      databasePath,
      databaseBytes,
      cacheBytes,
      projectsBytes,
      canvasProjectsBytes,
      totalBytes: databaseBytes + cacheBytes + projectsBytes + canvasProjectsBytes,
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
                } catch {
                  // 缓存可能在统计过程中被 Chromium 并发删除，忽略该条目。
                }
              }
            } catch {
              // 无法读取的缓存目录按 0 字节处理，删除步骤仍会继续。
            }
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
            log.warn(
              `prune orphan ${full} failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } catch (err) {
        log.warn(
          `prune orphan projects scan failed: ${err instanceof Error ? err.message : String(err)}`,
        )
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
      svc.seedDefaultModels(
        providers
          .filter((provider) => !isAutoRouterProvider(provider))
          .map((p) => ({ id: p.id, provider: p.provider })),
      )
      models = svc.list(req.providerId !== undefined ? { providerId: req.providerId } : undefined)
    }
    return { models }
  })

  typedIpcHandle('model:create', async (req) => {
    const model = getModelService().create(req)
    pushConfigChanged('model', 'create', model.id)
    return { model }
  })

  typedIpcHandle('model:update', async (req) => {
    const { id, ...fields } = req
    const model = getModelService().update(id, fields)
    pushConfigChanged('model', 'update', id)
    return { model }
  })

  typedIpcHandle('model:delete', async (req) => {
    const deleted = getModelService().delete(req.id)
    if (deleted) pushConfigChanged('model', 'delete', req.id)
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
    const oauthClient = extractMcpOAuthStaticClient(req.configJson)
    const server = getMcpService().createServer({ ...req, configJson: oauthClient.configJson })
    if (oauthClient.clientId != null || oauthClient.clientSecret != null) {
      await getMcpOAuthService().saveStaticClient(server.id, oauthClient)
    }
    pushConfigChanged('mcp', 'create', server.id)
    return { server }
  })

  typedIpcHandle('mcp:update', async (req) => {
    const { id, ...fields } = req
    if (fields.configJson != null) {
      const oauthClient = extractMcpOAuthStaticClient(fields.configJson)
      fields.configJson = oauthClient.configJson
      if (oauthClient.clientId != null || oauthClient.clientSecret != null) {
        await getMcpOAuthService().saveStaticClient(id, oauthClient)
      }
    }
    const server = getMcpService().updateServer(id, fields)
    pushConfigChanged('mcp', 'update', id)
    return { server }
  })

  typedIpcHandle('mcp:delete', async (req) => {
    const success = getMcpService().deleteServer(req.id)
    if (success) pushConfigChanged('mcp', 'delete', req.id)
    return { success }
  })

  typedIpcHandle('mcp:start-server', async (req) => {
    log.info(`mcp:start-server requested, serverId=${req.serverId}`)
    await getMcpService().startServer(req.serverId)
    const status = getMcpService().getServerStatus(req.serverId)
    pushConfigChanged('mcp', 'update', req.serverId)
    return { started: true, toolCount: status.toolCount }
  })

  typedIpcHandle('mcp:stop-server', async (req) => {
    log.info(`mcp:stop-server requested, serverId=${req.serverId}`)
    await getMcpService().stopServer(req.serverId)
    pushConfigChanged('mcp', 'update', req.serverId)
    return { stopped: true }
  })

  typedIpcHandle('mcp:server-status', async (req) => {
    log.info(`mcp:server-status requested, serverId=${req.serverId}`)
    const status = getMcpService().getServerStatus(req.serverId)
    return status
  })

  typedIpcHandle('mcp:authorize', async (req) => {
    await getMcpOAuthService().authorize(req.serverId)
    try {
      await getMcpService().startServer(req.serverId)
    } catch (err) {
      log.warn(`mcp:authorize completed but reconnect failed, serverId=${req.serverId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    pushConfigChanged('mcp', 'update', req.serverId)
    return { authorized: true }
  })

  typedIpcHandle('mcp:deauthorize', async (req) => {
    await getMcpService().stopServer(req.serverId)
    await getMcpOAuthService().deauthorize(req.serverId)
    pushConfigChanged('mcp', 'update', req.serverId)
    return { deauthorized: true }
  })

  typedIpcHandle('mcp:auth-status', async (req) => {
    return { status: await getMcpOAuthService().getAuthStatus(req.serverId) }
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
    rebuildManagedSkillsPlugin()
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
    rebuildManagedSkillsPlugin()
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

  typedIpcHandle('env-config:get', async (req) => {
    return getRuntimeCompositionService().getEnvConfig(req)
  })

  typedIpcHandle('env-config:update', async (req) => {
    return getRuntimeCompositionService().updateEnvConfig(req.scope, req.scopeRef, req.value)
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
    pushConfigChanged('agent', 'create', agent.id)
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
    pushConfigChanged('agent', 'update', agent.id)
    return { agent: toManagedAgent(agent) }
  })

  typedIpcHandle('agent:delete', async (req) => {
    const deleted = getAgentRepository().delete(req.id)
    if (deleted) {
      pushConfigChanged('agent', 'delete', req.id)
      // 联动清理 agent_teams 中仍引用该 id 的 host / member，避免团队成员计数残留。
      // 平台桥接路径（agents.delete MCP）由 platform-bridge.agentDelete 自行处理。
      const teamRepo = new TeamDefinitionRepository(getDatabase())
      const teams = teamRepo.list({ includeDisabled: true })
      for (const team of teams) {
        const memberIndex = team.memberAgentIds.indexOf(req.id)
        const nextMembers = memberIndex >= 0
          ? team.memberAgentIds.filter((m) => m !== req.id)
          : team.memberAgentIds
        const hostWasDeleted = team.hostAgentId === req.id
        const nextHost = hostWasDeleted ? (nextMembers[0] ?? '') : team.hostAgentId
        const membersChanged = memberIndex >= 0 && nextMembers.length !== team.memberAgentIds.length
        const hostChanged = hostWasDeleted && nextHost !== team.hostAgentId
        if (!membersChanged && !hostChanged) continue
        teamRepo.update(team.id, { memberAgentIds: nextMembers, hostAgentId: nextHost })
        pushConfigChanged('team', 'update', team.id)
      }
    }
    return { deleted }
  })

  // ─── Agent Import/Export Handlers ─────────────────────────────────────────

  typedIpcHandle('agent:export-to-file', async (req) => {
    const count = req.ids.length
    log.info(`agent:export-to-file requested, ids=${count}`)

    const allAgents = getAgentRepository().list({ includeDisabled: true })
    const toExport = count > 0 ? allAgents.filter((a) => req.ids.includes(a.id)) : allAgents

    const payload: import('@spark/protocol').AgentExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: 'spark-agent',
      agents: toExport.map((a) => {
        const agent = toManagedAgent(a)
        return {
          name: agent.name,
          description: agent.description,
          agentAdapter: agent.agentAdapter,
          permissionMode: agent.permissionMode,
          reasoningEffort: agent.reasoningEffort,
          prompt: a.prompt,
          skillIds: a.skillIds,
          disabledSkillIds: a.disabledSkillIds,
          mcpServerIds: a.mcpServerIds,
          ruleIds: a.ruleIds,
          hookConfig: a.hookConfig,
          workflowId: a.workflowId ?? null,
          metadata: a.metadata,
        }
      }),
    }

    const datePart = new Date().toISOString().slice(0, 10)
    const defaultName = `spark-agent-export-${datePart}.json`

    const result = await dialog.showSaveDialog({
      title: '导出 Agent 配置',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePath == null || result.filePath.length === 0) {
      log.info('agent:export-to-file canceled by user')
      return { filePath: '', count: payload.agents.length }
    }

    const fs = await import('node:fs/promises')
    try {
      const json = JSON.stringify(payload, null, 2)
      await fs.writeFile(result.filePath, json, 'utf-8')
      log.info(`agent:export-to-file wrote ${payload.agents.length} agents to ${result.filePath}`)
      return { filePath: result.filePath, count: payload.agents.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`agent:export-to-file write failed: ${message}`)
      throw new Error(`写入文件失败：${message}`, { cause: err })
    }
  })

  typedIpcHandle('agent:import-from-file', async () => {
    log.info('agent:import-from-file requested')

    const result = await dialog.showOpenDialog({
      title: '选择 Agent 配置文件',
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      log.info('agent:import-from-file canceled by user')
      return { payload: null, filePath: '' }
    }

    const filePath = result.filePaths[0]!
    const fs = await import('node:fs/promises')

    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`agent:import-from-file read failed: ${message}`)
      throw new Error(`读取文件失败：${message}`, { cause: err })
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`agent:import-from-file parse failed: ${message}`)
      throw new Error(`JSON 解析失败：${message}`, { cause: err })
    }

    // Basic runtime validation
    if (
      typeof json !== 'object' ||
      json == null ||
      !('version' in json) ||
      !('agents' in json) ||
      !Array.isArray((json as Record<string, unknown>).agents)
    ) {
      throw new Error('无效的 Agent 配置文件格式')
    }

    const payload = json as import('@spark/protocol').AgentExportPayload
    log.info(
      `agent:import-from-file parsed ${payload.agents.length} agents, version=${payload.version}`,
    )

    return { payload, filePath }
  })

  // ─── Team Mode Handlers ───────────────────────────────────────────────

  typedIpcHandle('team:update', async (req) => {
    log.info(`team:update requested, sessionId=${req.sessionId}, enabled=${req.config.enabled}`)
    new SessionRepository(getDatabase()).patchMetadata(req.sessionId, { team: req.config })
    pushConfigChanged('team', 'update', req.sessionId)
    return { config: req.config }
  })

  typedIpcHandle('team:list-members', async (req) => {
    const metadata = new SessionRepository(getDatabase()).getMetadata(req.sessionId)
    const team = (metadata.team ?? null) as Partial<TeamModeConfig> | null
    const hostAgentId = team?.hostAgentId ?? 'platform-manager-agent'
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
    const candidates = agents
      .filter((a) => a.id !== hostAgentId && !memberIds.has(a.id))
      .map(toCard)
    // 顺带返回完整 TeamModeConfig 供前端恢复会话状态（团队模式开关 / 嵌套深度等）
    const config: TeamModeConfig | null =
      team != null
        ? {
            enabled: team.enabled === true,
            hostAgentId,
            memberAgentIds: Array.from(memberIds),
            maxDepth: typeof team.maxDepth === 'number' ? team.maxDepth : 1,
            allowNesting: team.allowNesting === true,
            maxDiscussionRounds:
              typeof team.maxDiscussionRounds === 'number'
                ? team.maxDiscussionRounds
                : DEFAULT_MAX_DISCUSSION_ROUNDS,
            enablePeerMessaging: team.enablePeerMessaging === true,
            ...(typeof team.teamId === 'string' && team.teamId.length > 0
              ? { teamId: team.teamId }
              : {}),
          }
        : null
    return { hostAgentId, members, candidates, config }
  })

  typedIpcHandle('team:list-dispatches', async (req) => {
    const repo = new TeamDispatchRepository(getDatabase())
    const rows =
      req.turnId != null
        ? repo.listByTurn(req.turnId)
        : repo.listBySession(req.sessionId, req.limit ?? 50)
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

  // ─── 长期团队定义 CRUD ──────────────────────────────────────────────────

  typedIpcHandle('team:list-defs', async (req) => {
    const repo = new TeamDefinitionRepository(getDatabase())
    const teams = repo
      .list(req.includeDisabled !== undefined ? { includeDisabled: req.includeDisabled } : {})
      .map(toManagedTeam)
    return { teams }
  })

  typedIpcHandle('team:get-def', async (req) => {
    const repo = new TeamDefinitionRepository(getDatabase())
    const team = repo.get(req.id)
    return { team: team != null ? toManagedTeam(team) : null }
  })

  typedIpcHandle('team:create-def', async (req) => {
    const repo = new TeamDefinitionRepository(getDatabase())
    const discussionSettings = req as typeof req & {
      maxDiscussionRounds?: number
      enablePeerMessaging?: boolean
    }
    // 自动剔除 hostAgentId 也在 memberAgentIds 中的情况（防"自调用自"）
    const memberIds = (req.memberAgentIds ?? []).filter((id) => id !== req.hostAgentId)
    const team = repo.create({
      name: req.name,
      ...(req.description !== undefined ? { description: req.description } : {}),
      hostAgentId: req.hostAgentId,
      memberAgentIds: memberIds,
      ...(req.maxDepth !== undefined ? { maxDepth: req.maxDepth } : {}),
      ...(req.allowNesting !== undefined ? { allowNesting: req.allowNesting } : {}),
      ...(req.prompt !== undefined ? { prompt: req.prompt } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.metadata !== undefined ? { metadata: req.metadata } : {}),
      ...(discussionSettings.maxDiscussionRounds !== undefined
        ? { maxDiscussionRounds: discussionSettings.maxDiscussionRounds }
        : {}),
      ...(discussionSettings.enablePeerMessaging !== undefined
        ? { enablePeerMessaging: discussionSettings.enablePeerMessaging }
        : {}),
    })
    pushConfigChanged('team', 'create', team.id)
    return { team: toManagedTeam(team) }
  })

  typedIpcHandle('team:update-def', async (req) => {
    const repo = new TeamDefinitionRepository(getDatabase())
    const discussionSettings = req as typeof req & {
      maxDiscussionRounds?: number
      enablePeerMessaging?: boolean
    }
    const existing = repo.get(req.id)
    if (existing == null) throw new Error(`Team ${req.id} not found`)
    // 解析新 host / members 后剔除 host 重叠
    const nextHost = req.hostAgentId ?? existing.hostAgentId
    let nextMembers: string[] | undefined
    if (req.memberAgentIds !== undefined) {
      nextMembers = req.memberAgentIds.filter((id) => id !== nextHost)
    } else if (req.hostAgentId !== undefined && req.hostAgentId !== existing.hostAgentId) {
      // 仅改 host 时也要把新 host 从原成员中移除
      nextMembers = existing.memberAgentIds.filter((id) => id !== nextHost)
    }
    const team = repo.update(req.id, {
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.hostAgentId !== undefined ? { hostAgentId: req.hostAgentId } : {}),
      ...(nextMembers !== undefined ? { memberAgentIds: nextMembers } : {}),
      ...(req.maxDepth !== undefined ? { maxDepth: req.maxDepth } : {}),
      ...(req.allowNesting !== undefined ? { allowNesting: req.allowNesting } : {}),
      ...(req.prompt !== undefined ? { prompt: req.prompt } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.metadata !== undefined ? { metadata: req.metadata } : {}),
      ...(discussionSettings.maxDiscussionRounds !== undefined
        ? { maxDiscussionRounds: discussionSettings.maxDiscussionRounds }
        : {}),
      ...(discussionSettings.enablePeerMessaging !== undefined
        ? { enablePeerMessaging: discussionSettings.enablePeerMessaging }
        : {}),
    })
    if (team == null) throw new Error(`Team ${req.id} not found after update`)
    pushConfigChanged('team', 'update', team.id)
    return { team: toManagedTeam(team) }
  })

  typedIpcHandle('team:delete-def', async (req) => {
    const repo = new TeamDefinitionRepository(getDatabase())
    const existing = repo.get(req.id)
    if (existing == null) return { deleted: false }
    if (existing.builtIn) throw new Error('内置团队不可删除，可在编辑面板停用或修改配置')
    const deleted = repo.delete(req.id)
    if (deleted) pushConfigChanged('team', 'delete', req.id)
    return { deleted }
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

  // ─── Installable Skill Catalog（内置可安装技能卡片） ───────────────────

  typedIpcHandle('skill:list-installable', async () => {
    const items = getSkillRegistryService().listInstallableCatalog()
    return { items }
  })

  typedIpcHandle('skill:install-status', async () => ({
    installations: [...skillInstallStatusByKey.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  }))

  typedIpcHandle('skill:install-catalog', async (req) => {
    log.info(`skill:install-catalog requested, slug=${req.slug}`)
    const service = getSkillRegistryService()
    updateSkillInstallProgress('catalog', req.slug, 0, 0)
    try {
      // 用 catalog 条目的 slug 作为进度推送标识；主→渲染流式推送下载进度
      const skill = await service.installFromCatalog(req.slug, (downloaded, total) => {
        updateSkillInstallProgress('catalog', req.slug, downloaded, total)
        pushStreamEvent('stream:skill:install-progress', {
          slug: req.slug,
          source: 'catalog',
          downloaded,
          total,
        })
      })
      const existing = skillInstallStatusByKey.get(skillInstallStatusKey('catalog', req.slug))
      setSkillInstallStatus({
        slug: req.slug,
        source: 'catalog',
        state: 'installed',
        downloaded: existing?.downloaded ?? 0,
        total: existing?.total ?? 0,
        updatedAt: new Date().toISOString(),
        skillId: skill.id,
        skillName: skill.name,
      })
      // 安装完成后查回 postInstallHint
      const item = service.listInstallableCatalog().find((it) => it.slug === req.slug)
      return item?.postInstallHint != null ? { skill, postInstallHint: item.postInstallHint } : { skill }
    } catch (err) {
      const existing = skillInstallStatusByKey.get(skillInstallStatusKey('catalog', req.slug))
      setSkillInstallStatus({
        slug: req.slug,
        source: 'catalog',
        state: 'failed',
        downloaded: existing?.downloaded ?? 0,
        total: existing?.total ?? 0,
        updatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  typedIpcHandle('skill:uninstall-catalog', async (req) => {
    log.info(`skill:uninstall-catalog requested, slug=${req.slug}`)
    const success = getSkillRegistryService().uninstallFromCatalog(req.slug)
    return { success }
  })

  typedIpcHandle('skill:install-remote', async (req) => {
    log.info(`skill:install-remote requested, registryId=${req.registryId}, slug=${req.slug}`)
    if (req.registryId !== 'skillhub') {
      throw new Error(`Remote install not supported for registry: ${req.registryId}`)
    }
    const service = getSkillRegistryService()
    updateSkillInstallProgress('skillhub', req.slug, 0, 0)
    try {
      // 复用与 catalog 相同的进度流通道（payload 按 slug 标识），前端沿用同一套消费逻辑
      const skill = await service.installFromSkillHub(req.slug, (downloaded, total) => {
        updateSkillInstallProgress('skillhub', req.slug, downloaded, total)
        pushStreamEvent('stream:skill:install-progress', {
          slug: req.slug,
          source: 'skillhub',
          downloaded,
          total,
        })
      })
      const existing = skillInstallStatusByKey.get(skillInstallStatusKey('skillhub', req.slug))
      setSkillInstallStatus({
        slug: req.slug,
        source: 'skillhub',
        state: 'installed',
        downloaded: existing?.downloaded ?? 0,
        total: existing?.total ?? 0,
        updatedAt: new Date().toISOString(),
        skillId: skill.id,
        skillName: skill.name,
      })
      return { skill }
    } catch (err) {
      const existing = skillInstallStatusByKey.get(skillInstallStatusKey('skillhub', req.slug))
      setSkillInstallStatus({
        slug: req.slug,
        source: 'skillhub',
        state: 'failed',
        downloaded: existing?.downloaded ?? 0,
        total: existing?.total ?? 0,
        updatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
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

  // ─── App Skills Manager Handlers ─────────────────────────────────────────

  typedIpcHandle('skill:install-to-app', async (req) => {
    log.info(`skill:install-to-app requested, sourcePath=${req.sourcePath}`)
    const manager = getAppSkillsManager()
    const destPath = manager.installSkill(req.sourcePath)
    // 安装后自动注册到数据库
    const svc = getSkillService()
    const skill = svc.importLocalDirectory(destPath, 'custom')
    return { skill, destPath }
  })

  typedIpcHandle('skill:uninstall-from-app', async (req) => {
    log.info(`skill:uninstall-from-app requested, name=${req.name}`)
    const manager = getAppSkillsManager()
    const success = manager.uninstallSkill(req.name)
    return { success }
  })

  typedIpcHandle('skill:link', async (req) => {
    log.info(`skill:link requested, targetPath=${req.targetPath}, name=${req.name}`)
    const manager = getAppSkillsManager()
    const linkPath = manager.linkSkill(req.targetPath, req.name)
    // 链接后自动注册到数据库
    const svc = getSkillService()
    const skill = svc.importLocalDirectory(linkPath, 'linked')
    return { skill, linkPath }
  })

  typedIpcHandle('skill:unlink', async (req) => {
    log.info(`skill:unlink requested, name=${req.name}`)
    const manager = getAppSkillsManager()
    const success = manager.unlinkSkill(req.name)
    return { success }
  })

  typedIpcHandle('skill:app-paths', async () => {
    const manager = getAppSkillsManager()
    return {
      bundledDir: manager.bundledDir,
      userDir: manager.userDir,
      linksDir: manager.linksDir,
      bundledSkills: manager.listBundledSkillNames(),
      userSkills: manager.listUserSkillNames(),
      linkedSkills: manager.listLinkedSkillNames(),
    }
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

  // ─── Memory Handlers（记忆系统 V2）─────────────────────────────────────────

  const toMemoryDto = (r: MemoryEntryRow): MemoryEntry => ({
    id: r.id,
    scope: r.scope,
    scopeRef: r.scope_ref,
    type: r.type,
    name: r.name,
    description: r.description,
    confidence: r.confidence,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
    sourceSessionId: r.source_session_id,
    archived: r.archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    validFrom: r.valid_from,
    invalidAt: r.invalid_at,
    supersededBy: r.superseded_by,
  })

  let _memoryStore: MemoryStoreService | null = null
  const getMemoryStore = (workspaceRootPath?: string): MemoryStoreService => {
    // project scope 需 workspaceRootPath → per-request 构造（每个 workspace 不同，不缓存）
    if (workspaceRootPath != null) return new MemoryStoreService(undefined, workspaceRootPath)
    // user/agent scope 用 appHomeDir（~/.spark-agent）→ 缓存单例
    if (_memoryStore == null) _memoryStore = new MemoryStoreService()
    return _memoryStore
  }
  /** project scope 时按 workspaceId 查 root_path；user/agent 返回 undefined */
  const resolveWorkspaceRootPath = (scope: string, scopeRef: string | null): string | undefined => {
    if (scope === 'project' && scopeRef != null && scopeRef.length > 0) {
      const ws = new WorkspaceRepository(getDatabase()).get(scopeRef)
      return ws?.root_path
    }
    return undefined
  }

  typedIpcHandle('memory:list', async (req) => {
    const repo = new MemoryRepository(getDatabase())
    const scope: MemoryScope = req.scope ?? 'user'
    const scopeRef =
      typeof req.scopeRef === 'string' && req.scopeRef.trim() !== '' ? req.scopeRef.trim() : null
    const entries = repo.listByScope(scope, scopeRef, {
      ...(req.type != null ? { type: req.type } : {}),
      includeArchived: req.includeArchived ?? false,
      includeInvalid: req.includeInvalid ?? false,
      matchAnyScopeRef: scope !== 'user' && scopeRef == null,
    })
    return { entries: entries.map(toMemoryDto) }
  })

  typedIpcHandle('memory:get', async (req) => {
    const repo = new MemoryRepository(getDatabase())
    const entry = repo.getById(req.id)
    let body = ''
    if (entry != null) {
      try {
        body = await getMemoryStore().readFile(entry.file_path)
      } catch {
        body = ''
      }
    }
    return { entry: entry != null ? toMemoryDto(entry) : null, body }
  })

  typedIpcHandle('memory:create', async (req) => {
    log.info(`memory:create requested, scope=${req.scope}, name=${req.name}`)
    const db = getDatabase()
    const repo = new MemoryRepository(db)
    const entityRepo = new MemoryEntityRepository(db)
    const settingsRepo = new SettingsRepository(db)
    const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
    // manualWrite 走去重/配额/敏感词闸门（跳过置信度/演化）
    const writer = new MemoryWriterService(repo, getMemoryStore(resolveWorkspaceRootPath(req.scope, req.scopeRef)), settingsGet, async () => '[]', null, entityRepo)
    const row = await writer.manualWrite({
      scope: req.scope,
      type: req.type,
      name: req.name,
      description: req.description,
      body: req.body,
      scopeRef: req.scopeRef,
      ...(req.entities != null ? { entities: req.entities } : {}),
    })
    if (req.entities != null && req.entities.length > 0) {
      try {
        entityRepo.upsertEntitiesForMemory(row.id, req.scope, req.scopeRef, req.entities)
      } catch (err) {
        log.warn(`memory:create entity persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { entry: toMemoryDto(row) }
  })

  typedIpcHandle('memory:update', async (req) => {
    log.info(`memory:update requested, id=${req.id}`)
    const repo = new MemoryRepository(getDatabase())
    const existing = repo.getById(req.id)
    if (existing == null) throw new SparkError('NOT_FOUND', `记忆不存在：${req.id}（可能已被删除或归档）。`)
    let bodyForUpdate: string | undefined
    if (req.body != null) {
      bodyForUpdate = req.body
      // 先写文件（事实来源），再更新 DB+FTS：writeFile 失败则整体中止（DB 维持旧状态，
      // 与 writer.updateEntry 契约一致——避免 DB 领先文件导致 recall 永久读不到正文）
      await getMemoryStore(resolveWorkspaceRootPath(existing.scope, existing.scope_ref)).writeFile(
        {
          meta: {
            id: existing.id,
            scope: existing.scope,
            scopeRef: existing.scope_ref,
            type: req.type ?? existing.type,
            name: existing.name,
            description: req.description ?? existing.description,
            confidence: existing.confidence,
            createdAt: existing.created_at,
            updatedAt: Date.now(),
            hitCount: existing.hit_count,
            lastHitAt: existing.last_hit_at,
            sourceSessionId: existing.source_session_id,
            links: [],
            archived: existing.archived === 1,
          },
          body: req.body,
        },
      )
    }
    const updated = repo.update(
      req.id,
      {
        ...(req.description != null ? { description: req.description } : {}),
        ...(req.type != null ? { type: req.type } : {}),
      },
      bodyForUpdate,
    )
    return { entry: toMemoryDto(updated) }
  })

  typedIpcHandle('memory:archive', async (req) => {
    log.info(`memory:archive requested, id=${req.id}`)
    new MemoryRepository(getDatabase()).archive(req.id)
    return { ok: true }
  })

  typedIpcHandle('memory:delete', async (req) => {
    log.info(`memory:delete requested, id=${req.id}`)
    new MemoryRepository(getDatabase()).delete(req.id)
    return { ok: true }
  })

  typedIpcHandle('memory:rebuild-vectors', async () => {
    log.info('memory:rebuild-vectors requested')
    try {
      const db = getDatabase()
      const settingsRepo = new SettingsRepository(db)
      const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
      const searchRepo = new MemorySearchRepository(db)
      const modelService = new ModelService(
        new ModelProfileRepository(db),
        new ProviderProfileRepository(db),
        settingsGet,
      )
      const embedding = new EmbeddingService(modelService, searchRepo, settingsGet)
      const r = await embedding.rebuild()
      if (r.done) {
        log.info('memory:rebuild-vectors completed: ok, vec table rebuilt, backfill scheduled')
      } else {
        log.warn(`memory:rebuild-vectors completed: skipped, reason="${r.reason ?? '(none)'}"`)
      }
      return { ok: r.done, ...(r.reason != null ? { reason: r.reason } : {}) }
    } catch (err) {
      log.warn(`memory:rebuild-vectors failed: ${err instanceof Error ? err.message : String(err)}`)
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // 主动探测抽取配置可用性：跑一次极简 complete()，返回真实状态（审查 HIGH#6）。
  // 用户在配置页点"测试抽取"按钮触发，避免配错后只能从"记忆静默不生成"被动发现。
  typedIpcHandle('memory:test-extraction', async () => {
    log.info('memory:test-extraction requested')
    try {
      const db = getDatabase()
      const settingsRepo = new SettingsRepository(db)
      const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
      const extractionProviderId = settingsGet('memory', 'extractionProviderId')
      const extractionModel = settingsGet('memory', 'extractionModel')
      const settingsAbsent =
        (extractionProviderId == null || extractionProviderId === undefined) &&
        (extractionModel == null || extractionModel === undefined)
      const modelService = new ModelService(
        new ModelProfileRepository(db),
        new ProviderProfileRepository(db),
        settingsGet,
        // 测试时不走 agent 回退（无 sessionId 上下文）；仅验证 settings 显式配置
        () => null,
      )
      const result = await modelService.complete(
        '请回复一个简短的 JSON 对象 {"ok":true}，用于测试抽取配置连通性。',
        { maxTokens: 32 },
      )
      if (!result.available) {
        return {
          ok: false,
          source: settingsAbsent ? 'none' : 'settings',
          ...(extractionProviderId != null ? { providerId: String(extractionProviderId) } : {}),
          ...(extractionModel != null ? { model: String(extractionModel) } : {}),
          reason: result.reason,
        }
      }
      return {
        ok: true,
        source: settingsAbsent ? 'fallback' : 'settings',
        ...(extractionProviderId != null ? { providerId: String(extractionProviderId) } : {}),
        ...(extractionModel != null ? { model: String(extractionModel) } : {}),
        sample: result.text.slice(0, 100),
      }
    } catch (err) {
      log.warn(`memory:test-extraction failed: ${err instanceof Error ? err.message : String(err)}`)
      return { ok: false, source: 'none', reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── Settings Handlers ─────────────────────────────────────────────────────

  typedIpcHandle('settings:get', async (req) => {
    const value = getSettingsService().get(req.category, req.key)
    return { value }
  })

  typedIpcHandle('settings:set', async (req) => {
    // value === null 视为"清除该 key"：调 repo.delete() 而非写入字面量 null。
    // 前端 MemoryPanel 等表单用 set(key, null) 表达"未设置"语义（触发默认/回退逻辑）。
    if (req.value === null) {
      getSettingsService().delete(req.category, req.key)
    } else {
      getSettingsService().set(req.category, req.key, req.value)
    }
    if (req.category === 'telemetry' && req.key === 'data') {
      applyTelemetrySettings(req.value)
    }
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

  // ─── Log Handlers ────────────────────────────────────────────────────────────
  // 设置页「遥测与日志」读取/清空/定位本地日志文件。

  typedIpcHandle('log:read', async (req) => {
    const maxLines = req.maxLines ?? 500
    const levels = req.levels
    const lines = readLogTail(maxLines, levels)
    const info = getLogInfo()
    return {
      lines,
      filePath: info?.filePath ?? null,
      sizeBytes: info?.sizeBytes ?? 0,
    }
  })

  typedIpcHandle('log:clear', async () => {
    const ok = clearLogFile()
    return { ok }
  })

  typedIpcHandle('log:reveal', async () => {
    const info = getLogInfo()
    if (info?.filePath != null) {
      shell.showItemInFolder(info.filePath)
    }
    return { ok: info?.filePath != null }
  })

  // ─── Board Task Handlers ────────────────────────────────────────────────────

  typedIpcHandle('board:list', async (req) => {
    let tasks = readBoardTasks()
    const includeDeleted = req.includeDeleted === true
    if (!includeDeleted) tasks = tasks.filter((t) => !t.deletedAt)
    if (req.status) tasks = tasks.filter((t) => t.status === req.status)
    if (req.priority) tasks = tasks.filter((t) => t.priority === req.priority)
    if (req.project) {
      const p = req.project.toLowerCase()
      tasks = tasks.filter((t) => t.project?.toLowerCase() === p)
    }
    if (req.assignee) {
      const a = req.assignee.toLowerCase()
      tasks = tasks.filter((t) => t.assignee?.toLowerCase().includes(a))
    }
    if (req.query) {
      const q = req.query.toLowerCase()
      tasks = tasks.filter(
        (t) => t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      )
    }
    return { tasks: tasks.map(boardRecordToTask), total: tasks.length }
  })

  typedIpcHandle('board:get', async (req) => {
    const tasks = readBoardTasks()
    const task = tasks.find((t) => t.id === req.id)
    if (!task) throw new Error(`Task not found: ${req.id}`)
    return { task: boardRecordToTask(task) }
  })

  typedIpcHandle('board:create', async (req) => {
    const tasks = readBoardTasks()
    const now = new Date().toISOString()
    const status = req.status ?? 'todo'
    // Auto-assign sortOrder: place at the end of the same-status column
    const sortOrder =
      req.sortOrder ??
      (() => {
        const sameStatus = tasks.filter((t) => t.status === status && !t.deletedAt)
        if (sameStatus.length === 0) return 0
        return Math.max(...sameStatus.map((t) => t.sortOrder ?? 0)) + 100
      })()
    const taskId = boardTaskUid()
    const attachments = await persistBoardAttachments(taskId, req.attachments ?? [])
    const task: BoardTaskRecord = {
      id: taskId,
      title: req.title ?? '',
      description: req.description ?? '',
      status,
      priority: req.priority ?? 'medium',
      assignee: req.assignee ?? '',
      project: req.project ?? '',
      tags: req.tags ?? [],
      dueDate: req.dueDate ?? '',
      processingAgent: req.processingAgent ?? '',
      acceptanceCriteria: req.acceptanceCriteria ?? '',
      testAgent: req.testAgent ?? '',
      commentsJson: '[]',
      attachmentsJson: JSON.stringify(attachments),
      sortOrder,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    tasks.push(task)
    writeBoardTasks(tasks)
    return { task: boardRecordToTask(task) }
  })

  typedIpcHandle('board:update', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.id)
    if (idx === -1) throw new Error(`Task not found: ${req.id}`)
    const base = tasks[idx]!
    const now = new Date().toISOString()
    const attachments =
      req.attachments !== undefined
        ? await persistBoardAttachments(base.id, req.attachments)
        : safeParseJson<BoardTaskAttachment[]>(base.attachmentsJson, [])
    const updated: BoardTaskRecord = {
      id: base.id,
      title: req.title !== undefined ? req.title : base.title,
      description: req.description !== undefined ? req.description : base.description,
      status: req.status !== undefined ? req.status : base.status,
      priority: req.priority !== undefined ? req.priority : base.priority,
      assignee: req.assignee !== undefined ? req.assignee : base.assignee,
      project: req.project !== undefined ? req.project : base.project,
      tags: req.tags !== undefined ? req.tags : base.tags,
      dueDate: req.dueDate !== undefined ? req.dueDate : base.dueDate,
      processingAgent:
        req.processingAgent !== undefined ? req.processingAgent : (base.processingAgent ?? ''),
      acceptanceCriteria:
        req.acceptanceCriteria !== undefined
          ? req.acceptanceCriteria
          : (base.acceptanceCriteria ?? ''),
      testAgent: req.testAgent !== undefined ? req.testAgent : (base.testAgent ?? ''),
      commentsJson: base.commentsJson ?? '[]',
      attachmentsJson: JSON.stringify(attachments),
      sortOrder: req.sortOrder !== undefined ? req.sortOrder : (base.sortOrder ?? 0),
      createdAt: base.createdAt,
      updatedAt: now,
      deletedAt: base.deletedAt,
    }
    tasks[idx] = updated
    writeBoardTasks(tasks)
    return { task: boardRecordToTask(updated) }
  })

  typedIpcHandle('board:delete', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.id)
    if (idx === -1) throw new Error(`Task not found: ${req.id}`)
    const now = new Date().toISOString()
    tasks[idx] = { ...tasks[idx], deletedAt: now, updatedAt: now } as BoardTaskRecord
    writeBoardTasks(tasks)
    return { success: true }
  })

  typedIpcHandle('board:batch-create', async (req) => {
    const tasks = readBoardTasks()
    const created: BoardTaskRecord[] = []
    for (const item of req.tasks ?? []) {
      const now = new Date().toISOString()
      const status = item.status ?? 'todo'
      const sortOrder =
        item.sortOrder ??
        (() => {
          const sameStatus = tasks.filter((t) => t.status === status && !t.deletedAt)
          if (sameStatus.length === 0) return 0
          return Math.max(...sameStatus.map((t) => t.sortOrder ?? 0)) + 100
        })()
      const taskId = boardTaskUid()
      const attachments = await persistBoardAttachments(taskId, item.attachments ?? [])
      const task: BoardTaskRecord = {
        id: taskId,
        title: item.title ?? '',
        description: item.description ?? '',
        status,
        priority: item.priority ?? 'medium',
        assignee: item.assignee ?? '',
        project: item.project ?? '',
        tags: item.tags ?? [],
        dueDate: item.dueDate ?? '',
        processingAgent: item.processingAgent ?? '',
        acceptanceCriteria: item.acceptanceCriteria ?? '',
        testAgent: item.testAgent ?? '',
        commentsJson: '[]',
        attachmentsJson: JSON.stringify(attachments),
        sortOrder,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
      tasks.push(task)
      created.push(task)
    }
    writeBoardTasks(tasks)
    return { created: created.length, tasks: created.map(boardRecordToTask) }
  })

  typedIpcHandle('board:batch-update', async (req) => {
    const tasks = readBoardTasks()
    const updated: BoardTaskRecord[] = []
    for (const upd of req.updates ?? []) {
      const idx = tasks.findIndex((t) => t.id === upd.id)
      if (idx === -1) continue
      const now = new Date().toISOString()
      const base = tasks[idx]!
      const attachments =
        upd.attachments !== undefined
          ? await persistBoardAttachments(base.id, upd.attachments)
          : safeParseJson<BoardTaskAttachment[]>(base.attachmentsJson, [])
      const task: BoardTaskRecord = {
        id: base.id,
        title: upd.title !== undefined ? upd.title : base.title,
        description: upd.description !== undefined ? upd.description : base.description,
        status: upd.status !== undefined ? upd.status : base.status,
        priority: upd.priority !== undefined ? upd.priority : base.priority,
        assignee: upd.assignee !== undefined ? upd.assignee : base.assignee,
        project: upd.project !== undefined ? upd.project : base.project,
        tags: upd.tags !== undefined ? upd.tags : base.tags,
        dueDate: upd.dueDate !== undefined ? upd.dueDate : base.dueDate,
        processingAgent:
          upd.processingAgent !== undefined ? upd.processingAgent : (base.processingAgent ?? ''),
        acceptanceCriteria:
          upd.acceptanceCriteria !== undefined
            ? upd.acceptanceCriteria
            : (base.acceptanceCriteria ?? ''),
        testAgent: upd.testAgent !== undefined ? upd.testAgent : (base.testAgent ?? ''),
        commentsJson: base.commentsJson ?? '[]',
        attachmentsJson: JSON.stringify(attachments),
        sortOrder: upd.sortOrder !== undefined ? upd.sortOrder : (base.sortOrder ?? 0),
        createdAt: base.createdAt,
        updatedAt: now,
        deletedAt: base.deletedAt,
      }
      tasks[idx] = task
      updated.push(task)
    }
    writeBoardTasks(tasks)
    return { updated: updated.length, tasks: updated.map(boardRecordToTask) }
  })

  typedIpcHandle('board:batch-delete', async (req) => {
    const tasks = readBoardTasks()
    const now = new Date().toISOString()
    let count = 0
    for (const id of req.ids ?? []) {
      const idx = tasks.findIndex((t) => t.id === id)
      if (idx !== -1) {
        tasks[idx] = { ...tasks[idx], deletedAt: now, updatedAt: now } as BoardTaskRecord
        count++
      }
    }
    writeBoardTasks(tasks)
    return { deleted: count }
  })

  typedIpcHandle('board:restore', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.id)
    if (idx === -1) throw new Error(`Task not found: ${req.id}`)
    tasks[idx] = {
      ...tasks[idx],
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    } as BoardTaskRecord
    writeBoardTasks(tasks)
    return { task: boardRecordToTask(tasks[idx]!) }
  })

  typedIpcHandle('board:permanent-delete', async (req) => {
    const tasks = readBoardTasks()
    const filtered = tasks.filter((t) => t.id !== req.id)
    writeBoardTasks(filtered)
    await removeBoardTaskAttachments(req.id)
    return { success: true }
  })

  // ─── Board Comments ──────────────────────────────────────────────────────

  typedIpcHandle('board:comment:list', async (req) => {
    const tasks = readBoardTasks()
    const task = tasks.find((t) => t.id === req.taskId)
    if (!task) throw new Error(`Task not found: ${req.taskId}`)
    const comments: Array<{
      id: string
      taskId: string
      author: string
      content: string
      createdAt: string
    }> = JSON.parse(task.commentsJson ?? '[]')
    return { comments }
  })

  typedIpcHandle('board:comment:create', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.taskId)
    if (idx === -1) throw new Error(`Task not found: ${req.taskId}`)
    const task = tasks[idx]!
    const comments: Array<{
      id: string
      taskId: string
      author: string
      content: string
      createdAt: string
    }> = JSON.parse(task.commentsJson ?? '[]')
    const comment = {
      id: `cmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      taskId: req.taskId,
      author: req.author ?? '',
      content: req.content,
      createdAt: new Date().toISOString(),
    }
    comments.push(comment)
    task.commentsJson = JSON.stringify(comments)
    task.updatedAt = new Date().toISOString()
    tasks[idx] = task
    writeBoardTasks(tasks)
    return { comment }
  })

  typedIpcHandle('board:comment:delete', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.taskId)
    if (idx === -1) throw new Error(`Task not found: ${req.taskId}`)
    const task = tasks[idx]!
    const comments: Array<{
      id: string
      taskId: string
      author: string
      content: string
      createdAt: string
    }> = JSON.parse(task.commentsJson ?? '[]')
    const filtered = comments.filter((c) => c.id !== req.commentId)
    task.commentsJson = JSON.stringify(filtered)
    task.updatedAt = new Date().toISOString()
    tasks[idx] = task
    writeBoardTasks(tasks)
    return { success: true }
  })

  typedIpcHandle('board:comment:update', async (req) => {
    const tasks = readBoardTasks()
    const idx = tasks.findIndex((t) => t.id === req.taskId)
    if (idx === -1) throw new Error(`Task not found: ${req.taskId}`)
    const task = tasks[idx]!
    const comments: Array<{
      id: string
      taskId: string
      author: string
      content: string
      createdAt: string
    }> = JSON.parse(task.commentsJson ?? '[]')
    const cmt = comments.find((c) => c.id === req.commentId)
    if (!cmt) throw new Error(`Comment not found: ${req.commentId}`)
    cmt.content = req.content
    task.commentsJson = JSON.stringify(comments)
    task.updatedAt = new Date().toISOString()
    tasks[idx] = task
    writeBoardTasks(tasks)
    return { comment: cmt }
  })

  // ─── Remote Connection Handlers ───────────────────────────────────────────

  typedIpcHandle('remote:list', async () => {
    const remote = getRemoteConnectionService()
    const store = remote.list()
    return {
      connections: store.connections,
      global: store.global,
      commandCatalog: remote.getCommandCatalog(),
    }
  })

  typedIpcHandle('remote:save', async (req) => {
    const remote = getRemoteConnectionService()
    const connection = remote.save(req.connection)
    remote.syncRuntime()
    return { connection }
  })

  typedIpcHandle('remote:delete', async (req) => {
    const remote = getRemoteConnectionService()
    const deleted = remote.delete(req.id)
    remote.syncRuntime()
    return { deleted }
  })

  typedIpcHandle('remote:test', async (req) => {
    const remote = getRemoteConnectionService()
    const result = remote.test(req.id)
    remote.syncRuntime()
    return result
  })

  typedIpcHandle('remote:create-bot-draft', async (req) => {
    const result = getRemoteConnectionService().createBotDraft(req.channel, req.name)
    if (req.openConsole === true) {
      await shell.openExternal(result.consoleUrl)
    }
    return result
  })

  typedIpcHandle('remote:generate-pairing', async (req) => {
    const remote = getRemoteConnectionService()
    const result = remote.generatePairing(req.id, req.mode)
    remote.syncRuntime()
    return result
  })

  typedIpcHandle('remote:confirm-pairing', async (req) => {
    const remote = getRemoteConnectionService()
    const result = remote.confirmPairing(req)
    remote.syncRuntime()
    return result
  })

  typedIpcHandle('remote:command-catalog', async () => {
    return { commands: getRemoteConnectionService().getCommandCatalog() }
  })

  typedIpcHandle('remote:execute-command', async (req) => {
    return executeRemoteCommand(req.id, req.message, req.sessionId)
  })

  typedIpcHandle('remote:runtime-status', async () => {
    return getRemoteConnectionService().getRuntimeStatus()
  })

  // ─── Scheduled Task Handlers ───────────────────────────────────────────────

  typedIpcHandle('scheduled-task:list', async (req) => {
    return { tasks: getScheduledTaskService().listTasks(req) }
  })

  typedIpcHandle('scheduled-task:get', async (req) => {
    return { task: getScheduledTaskService().getTask(req.id) }
  })

  typedIpcHandle('scheduled-task:create', async (req) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const task = getScheduledTaskService().createTask({
      id,
      name: req.name,
      description: req.description ?? '',
      enabled: req.enabled !== false,
      trigger_type: req.triggerType,
      interval_seconds: req.intervalSeconds ?? null,
      cron_expression: req.cronExpression ?? null,
      run_at: req.runAt ?? null,
      timezone: req.timezone ?? 'system',
      start_at: req.startAt ?? null,
      end_at: req.endAt ?? null,
      max_executions: req.maxExecutions ?? 0,
      agent_id: req.agentId ?? null,
      team_id: req.teamId ?? null,
      model_id: req.modelId ?? null,
      workspace_id: req.workspaceId ?? null,
      prompt_template: req.promptTemplate,
      permission_mode: req.permissionMode ?? 'auto',
      permission_profile_id: req.permissionProfileId ?? null,
      timeout_seconds: req.timeoutSeconds ?? 300,
      max_retries: req.maxRetries ?? 0,
      retry_delay_seconds: req.retryDelaySeconds ?? 60,
      retry_backoff: req.retryBackoff ?? 'fixed',
      notifications: req.notifications ?? [],
      concurrency_policy: req.concurrencyPolicy ?? 'skip',
      tags: req.tags ?? [],
      history_retention_days: req.historyRetentionDays ?? 30,
    } as any)
    return { task }
  })

  typedIpcHandle('scheduled-task:update', async (req) => {
    const updateFields: Record<string, unknown> = {}
    const fieldMap: Record<string, unknown> = {
      name: req.name,
      description: req.description,
      trigger_type: req.triggerType,
      interval_seconds: req.intervalSeconds,
      cron_expression: req.cronExpression,
      run_at: req.runAt,
      timezone: req.timezone,
      start_at: req.startAt,
      end_at: req.endAt,
      max_executions: req.maxExecutions,
      agent_id: req.agentId,
      team_id: req.teamId,
      model_id: req.modelId,
      workspace_id: req.workspaceId,
      prompt_template: req.promptTemplate,
      permission_mode: req.permissionMode,
      permission_profile_id: req.permissionProfileId,
      timeout_seconds: req.timeoutSeconds,
      max_retries: req.maxRetries,
      retry_delay_seconds: req.retryDelaySeconds,
      retry_backoff: req.retryBackoff,
      concurrency_policy: req.concurrencyPolicy,
      history_retention_days: req.historyRetentionDays,
    }
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v !== undefined) updateFields[k] = v
    }
    if (req.enabled !== undefined) updateFields.enabled = req.enabled
    if (req.notifications !== undefined) updateFields.notifications = req.notifications
    if (req.tags !== undefined) updateFields.tags = req.tags
    const task = getScheduledTaskService().updateTask(req.id, updateFields)
    if (!task) throw new Error(`Scheduled task not found: ${req.id}`)
    return { task }
  })

  typedIpcHandle('scheduled-task:delete', async (req) => {
    const success = getScheduledTaskService().deleteTask(req.id)
    return { success }
  })

  typedIpcHandle('scheduled-task:toggle', async (req) => {
    const task = req.enabled
      ? getScheduledTaskService().enableTask(req.id)
      : getScheduledTaskService().disableTask(req.id)
    if (!task) throw new Error(`Scheduled task not found: ${req.id}`)
    return { task }
  })

  typedIpcHandle('scheduled-task:run-now', async (req) => {
    const execution = await getScheduledTaskService().runNow(req.id)
    return { execution }
  })

  typedIpcHandle('task-execution:list', async (req) => {
    const opts: { page?: number; pageSize?: number; status?: string } = {}
    if (req.page !== undefined) opts.page = req.page
    if (req.pageSize !== undefined) opts.pageSize = req.pageSize
    if (req.status !== undefined) opts.status = req.status
    return getScheduledTaskService().getExecutions(req.taskId, opts)
  })

  typedIpcHandle('task-execution:get', async (req) => {
    return { execution: getScheduledTaskService().getExecution(req.id) }
  })

  typedIpcHandle('task-execution:cancel', async (req) => {
    const success = getScheduledTaskService().cancelExecution(req.id)
    return { success }
  })

  typedIpcHandle('task-execution:stats', async (req) => {
    return { stats: getScheduledTaskService().getExecutionStats(req.taskId) }
  })

  // ─── Scheduled Task Import/Export Handlers ────────────────────────────────
  //
  // 流程（与 Provider 完全对齐）：
  //   - 内存构造 ExportPayload                → `scheduled-task:export`
  //   - 弹保存对话框写 .json                   → `scheduled-task:export-to-file`
  //   - 弹打开对话框读 .json                   → `scheduled-task:import-from-file`
  //   - 真正写库                                → `scheduled-task:import`
  //
  // 文件 IO 走 electron 的 dialog + node:fs/promises。
  // 解析失败、IO 失败、版本不匹配都返回友好错误，UI 弹 toast。

  typedIpcHandle('scheduled-task:export', async (req) => {
    const count = req.ids.length
    log.info(`scheduled-task:export requested, ids=${count}`)
    const payload = getScheduledTaskService().exportTasks(req.ids)
    return { payload }
  })

  typedIpcHandle('scheduled-task:import', async (req) => {
    const total = req.payload.tasks.length
    log.info(`scheduled-task:import requested, mode=${req.mode}, tasks=${total}`)
    const result = await getScheduledTaskService().importTasks(req.payload, req.mode)
    log.info(
      `scheduled-task:import done, imported=${result.imported}, skipped=${result.skipped}, errors=${result.errors.length}`,
    )
    return result
  })

  typedIpcHandle('scheduled-task:export-to-file', async (req) => {
    const count = req.ids.length
    log.info(`scheduled-task:export-to-file requested, ids=${count}`)

    const payload = getScheduledTaskService().exportTasks(req.ids)

    // 默认文件名：spark-agent-tasks-YYYY-MM-DD.json
    const datePart = new Date().toISOString().slice(0, 10)
    const defaultName = `spark-agent-tasks-${datePart}.json`

    const result = await dialog.showSaveDialog({
      title: '导出定时任务',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePath == null || result.filePath.length === 0) {
      log.info('scheduled-task:export-to-file canceled by user')
      return { filePath: '', count: payload.tasks.length }
    }

    try {
      const json = JSON.stringify(payload, null, 2)
      await fs.writeFile(result.filePath, json, 'utf-8')
      log.info(
        `scheduled-task:export-to-file wrote ${payload.tasks.length} tasks to ${result.filePath}`,
      )
      return { filePath: result.filePath, count: payload.tasks.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`scheduled-task:export-to-file write failed: ${message}`)
      throw new Error(`写入文件失败：${message}`, { cause: err })
    }
  })

  typedIpcHandle('scheduled-task:import-from-file', async () => {
    log.info('scheduled-task:import-from-file requested')

    const result = await dialog.showOpenDialog({
      title: '选择定时任务配置文件',
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      log.info('scheduled-task:import-from-file canceled by user')
      return { payload: null, filePath: '' }
    }

    const filePath = result.filePaths[0]!
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`scheduled-task:import-from-file read failed: ${message}`)
      throw new Error(`读取文件失败：${message}`, { cause: err })
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`scheduled-task:import-from-file parse failed: ${message}`)
      throw new Error(`JSON 解析失败：${message}`, { cause: err })
    }

    const { ScheduledTaskExportPayloadSchema } = await import('@spark/protocol')
    const parsed = ScheduledTaskExportPayloadSchema.parse(json)

    log.info(
      `scheduled-task:import-from-file parsed ${parsed.tasks.length} tasks, version=${parsed.version}`,
    )

    return { payload: parsed as ScheduledTaskExportPayload, filePath }
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
    if (req.reasoningOutputTokens !== undefined)
      params.reasoningOutputTokens = req.reasoningOutputTokens
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
    const currentValue = getSettingsService().get('updates', 'data')
    const currentSettings =
      currentValue != null && typeof currentValue === 'object'
        ? (currentValue as Record<string, unknown>)
        : {}
    const nextSettings: Record<string, unknown> = { ...currentSettings }
    if (req.autoCheck !== undefined) {
      nextSettings.autoCheck = req.autoCheck
      svc.setAutoCheck(req.autoCheck)
    }
    if (req.autoDownload !== undefined) {
      nextSettings.autoDownload = req.autoDownload
      svc.setAutoDownload(req.autoDownload)
    }
    if (req.autoInstall !== undefined) {
      nextSettings.autoInstall = process.platform === 'win32' ? req.autoInstall : false
      svc.setAutoInstall(req.autoInstall)
    }
    if (req.channel !== undefined) {
      nextSettings.channel = req.channel
      svc.setChannel(req.channel)
    }
    getSettingsService().set('updates', 'data', nextSettings)
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

  typedIpcHandle('tool:open-folder', async (req) => {
    log.info(`tool:open-folder requested, rootPath=${req.rootPath}`)
    const errorMessage = await shell.openPath(req.rootPath)
    return {
      opened: errorMessage === '',
      ...(errorMessage ? { error: errorMessage } : {}),
    }
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
        const fallbackTitle = title ?? getNodeDefaultTitle(node)
        const notificationTitle = getSessionNotificationTitle(sessionId, fallbackTitle)
        const notificationBody = body ?? getNodeDefaultBody(node)
        showSystemNotification(notificationTitle, notificationBody, { target: 'session', sessionId, reason: node })
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
    log.info(
      `context:set-preference requested, workspaceId=${req.workspaceId}, filePath=${req.filePath}, action=${req.action}`,
    )
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

  // ─── File Reveal Handler ──────────────────────────────────────────────
  // Highlight a file/directory in the OS file manager (Finder / Explorer).
  typedIpcHandle('file:reveal', async (req) => {
    const filePath = req.filePath
    if (!filePath || typeof filePath !== 'string') {
      return { revealed: false, error: 'filePath is required' }
    }
    log.info(`file:reveal requested, path=${filePath}`)
    try {
      shell.showItemInFolder(filePath)
      return { revealed: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`file:reveal failed, path=${filePath}, error=${message}`)
      return { revealed: false, error: message }
    }
  })

  // ─── File Read Handler ────────────────────────────────────────────────

  typedIpcHandle('file:read', async (req) => {
    const filePath = req.filePath
    if (!filePath || typeof filePath !== 'string') {
      return { error: 'filePath is required' }
    }

    log.info(`file:read requested, path=${filePath}`)

    try {
      const fs = await import('node:fs/promises')
      const content = await fs.readFile(filePath, 'utf-8')
      return { content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`file:read failed, path=${filePath}, error=${message}`)
      return { error: message }
    }
  })

  // ─── File Save Image Handler ──────────────────────────────────────────
  //
  // 让用户把生成的图片（路径在 userData 或 workspace 的 .spark-artifacts 下）另存到本地。
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

    // 源文件必须在 safe-file 白名单内（userData / temp / workspace .spark-artifacts）
    const resolvedSource = path.resolve(sourcePath)
    if (!isSafeFilePathAllowed(resolvedSource)) {
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

    const rootDir = req.projectRootPath?.trim()
      ? path.join(path.resolve(req.projectRootPath), 'assets', 'images')
      : req.storageScope === 'canvas'
        ? getDefaultCanvasMediaDir()
        : path.join(app.getPath('temp'), 'spark-agent-pasted-images')
    await fs.mkdir(rootDir, { recursive: true })
    const baseName = (req.suggestedBaseName?.trim() || 'pasted-image').replace(
      /[^a-zA-Z0-9._-]+/g,
      '-',
    )
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
      patch: Partial<PlaywrightInstallProgress> &
        Pick<PlaywrightInstallProgress, 'state' | 'message'>,
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
    const result = req.target === 'mcp' ? await installMcp(onLog) : await installBrowser(onLog)
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
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true, mode: req.mode }
  })

  typedIpcHandle('playwright:set-enabled', async (req) => {
    log.info(`playwright:set-enabled requested, enabled=${req.enabled}`)
    setPlaywrightEnabled(getDatabase(), req.enabled)
    pushStreamEvent('stream:playwright:status', buildPlaywrightStatus())
    return { success: true, enabled: req.enabled }
  })

  // ─── FFmpeg & Video Processing Handlers ─────────────────────────────

  /** 构建 ffmpeg 状态响应（从缓存或重新检测） */
  function buildFfmpegStatus(): import('@spark/protocol').FfmpegStatusResponse {
    const state = getCachedFfmpegIntegrity()
    return {
      ffmpegReady: state?.ffmpegReady ?? false,
      ffmpegSource: state?.ffmpegSource ?? 'none',
      ffmpegVersion: state?.ffmpegVersion ?? null,
      ffprobeReady: state?.ffprobeReady ?? false,
      binaryPath: state?.binaryPath ?? null,
      lastError: state?.lastError ?? null,
    }
  }

  typedIpcHandle('ffmpeg:status', async () => {
    // 主动检测一次，保证返回最新状态
    const state = await detectFfmpegIntegrity()
    return {
      ffmpegReady: state.ffmpegReady,
      ffmpegSource: state.ffmpegSource,
      ffmpegVersion: state.ffmpegVersion,
      ffprobeReady: state.ffprobeReady,
      binaryPath: state.binaryPath,
      lastError: state.lastError,
    }
  })

  typedIpcHandle('ffmpeg:install', async (req) => {
    log.info(`ffmpeg:install requested, artifactId=${req.artifactId ?? '(auto)'}`)

    // 自动选 artifactId：从 manifest 找当前平台的最新 binary.ffmpeg 条目
    let artifactId = req.artifactId
    if (!artifactId) {
      try {
        const manifest = await getSkillRegistryService().fetchSparkManifestForQuery()
        const platformArch = `${process.platform}-${process.arch}`
        const candidates = (manifest.artifacts ?? [])
          .filter(
            (a) =>
              a.type === 'binary' &&
              a.id.startsWith('binary.ffmpeg') &&
              a.platform === process.platform &&
              a.arch === process.arch,
          )
          .sort((a, b) => {
            // 语义版本比较：解析为数字元组，避免字符串比较 "7.10" < "7.9" 的错误
            const parseVer = (s: string): number[] =>
              s.split('.').map((seg) => parseInt(seg.replace(/\D/g, ''), 10) || 0)
            const va = parseVer(a.version)
            const vb = parseVer(b.version)
            const len = Math.max(va.length, vb.length)
            for (let i = 0; i < len; i++) {
              const d = (vb[i] ?? 0) - (va[i] ?? 0)
              if (d !== 0) return d
            }
            return 0
          })
        const candidate = candidates[0]
        if (!candidate) {
          return {
            success: false,
            message: `当前平台 (${platformArch}) 暂无可用的 FFmpeg 安装包。请在 minio 仓库的 index.json 中添加对应条目。`,
          }
        }
        artifactId = candidate.id
      } catch (err) {
        return {
          success: false,
          message: `无法获取安装清单: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    const emitProgress = (
      state: FfmpegInstallProgress['state'],
      percent: number | null,
      message: string,
      logLine: string | null = null,
    ) => {
      pushStreamEvent('stream:ffmpeg:install-progress', {
        state,
        percent,
        message,
        logLine,
      })
    }
    emitProgress('starting', 0, `准备下载 ${artifactId}`)

    const result = await installFfmpeg(
      async (id, onProgress) => {
        emitProgress('downloading', 0, '正在下载 FFmpeg 二进制包')
        return getSkillRegistryService().installBinaryArtifact(id, {
          onProgress: (downloaded, total) => {
            const percent = total > 0 ? Math.round((downloaded / total) * 100) : null
            emitProgress('downloading', percent, `下载中 ${percent ?? '?'}%`)
            onProgress?.(downloaded, total)
          },
        })
      },
      {
        artifactId,
        onLog: (line) => {
          const text = line.trim()
          if (text) log.info(`[ffmpeg-install] ${text}`)
        },
      },
    )

    emitProgress('verifying', null, '校验安装结果')
    const nextState = await detectFfmpegIntegrity()
    pushStreamEvent('stream:ffmpeg:status', buildFfmpegStatus())
    emitProgress(
      result.success ? 'done' : 'error',
      result.success ? 100 : null,
      result.success ? `FFmpeg 安装成功 (版本 ${nextState.ffmpegVersion ?? '?'})` : result.message ?? '安装失败',
    )
    return result
  })

  typedIpcHandle('binary:install', async (req) => {
    log.info(`binary:install requested, artifactId=${req.artifactId}`)
    const emitProgress = (downloaded: number, total: number) => {
      pushStreamEvent('stream:binary:install-progress', {
        artifactId: req.artifactId,
        downloaded,
        total,
      })
    }
    try {
      const result = await getSkillRegistryService().installBinaryArtifact(req.artifactId, {
        onProgress: emitProgress,
      })
      return { success: true, destPath: result.destPath }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  })

  /** 通用视频处理 handler：按 operation 分派到 FfmpegRunner 方法 */
  typedIpcHandle('video:process', async (req: VideoProcessRequest): Promise<VideoProcessResponse> => {
    return handleVideoProcess(req, (progress) => {
      pushStreamEvent('stream:video:process-progress', {
        requestId: req.requestId,
        percent: progress.percent,
        stage: `frame=${progress.frame} fps=${progress.fps}`,
      })
    })
  })

  /** 视频探测专用通道（只读，无进度） */
  typedIpcHandle('video:probe', async (req: VideoProcessRequest): Promise<VideoProcessResponse> => {
    return handleVideoProcess(req)
  })

  typedIpcHandle('browser:open-external', async (req) => {
    log.info('browser:open-external requested')
    await shell.openExternal(
      req.url && req.url.trim().length > 0 ? req.url : 'https://spark.yiqibyte.com',
    )
    return { success: true }
  })

  // ─── Window Control Handlers ─────────────────────────────────────────────

  typedIpcHandle('window:minimize', async (_req, event) => {
    const win = getWindowForIpcSender(event, getMainWindow)
    if (win) win.minimize()
    return { success: !!win }
  })

  typedIpcHandle('window:maximize', async (_req, event) => {
    const win = getWindowForIpcSender(event, getMainWindow)
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

  typedIpcHandle('window:close', async (_req, event) => {
    const win = getWindowForIpcSender(event, getMainWindow)
    if (win) win.close()
    return { success: !!win }
  })

  typedIpcHandle('window:is-maximized', async (_req, event) => {
    const win = getWindowForIpcSender(event, getMainWindow)
    return { maximized: win ? win.isMaximized() : false }
  })

  typedIpcHandle('window:set-zoom', async (req, event) => {
    if (event.sender.isDestroyed()) {
      return { success: false, zoomPercent: 100 }
    }
    event.sender.setZoomFactor(req.zoomPercent / 100)
    return {
      success: true,
      zoomPercent: Math.round(event.sender.getZoomFactor() * 100),
    }
  })

  typedIpcHandle('window:ensure-width', async (req) => {
    const win = getMainWindow()
    if (!win) return { success: false, width: 0, changed: false }

    const bounds = win.getBounds()
    if (win.isMaximized() || win.isFullScreen()) {
      autoWindowWidthState = null
      return { success: true, width: bounds.width, changed: false }
    }

    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const targetWidth = Math.min(Math.max(800, Math.ceil(req.minWidth)), workArea.width)
    // req.allowGrow 默认 true（schema 已设置默认值），保持向后兼容。
    // false 时：当前宽度 < target 的 grow 分支被跳过，仅允许 shrink 路径或完全不动。
    // 用于 renderer 的窗口 resize 回调里避免和用户主动拖动打架，
    // 防止"缩小一点又弹回来"的视觉循环。
    const allowGrow = req.allowGrow !== false
    const isAtManagedWidth =
      autoWindowWidthState == null ||
      Math.abs(bounds.width - autoWindowWidthState.managedWidth) <= AUTO_WINDOW_WIDTH_TOLERANCE

    if (!isAtManagedWidth) {
      autoWindowWidthState = null
      if (bounds.width >= targetWidth) {
        return { success: true, width: bounds.width, changed: false }
      }
    }

    let nextWidth: number
    if (bounds.width < targetWidth) {
      if (!allowGrow) {
        // 用户已经主动把窗口拖到比目标小（例如拖窄窗口去腾出桌面空间），
        // 不再把窗口拉回去，避免覆盖用户的拖动意图。
        return { success: true, width: bounds.width, changed: false }
      }
      autoWindowWidthState ??= { baselineWidth: bounds.width, managedWidth: bounds.width }
      nextWidth = targetWidth
    } else if (req.allowShrink === true && autoWindowWidthState != null) {
      nextWidth = Math.max(autoWindowWidthState.baselineWidth, targetWidth)
      if (nextWidth >= bounds.width) {
        return { success: true, width: bounds.width, changed: false }
      }
    } else {
      return { success: true, width: bounds.width, changed: false }
    }

    const maxX = workArea.x + workArea.width - nextWidth
    const nextX = Math.max(workArea.x, Math.min(bounds.x, maxX))

    win.setBounds({ ...bounds, x: nextX, width: nextWidth }, true)
    if (autoWindowWidthState != null) {
      autoWindowWidthState.managedWidth = nextWidth
      if (nextWidth <= autoWindowWidthState.baselineWidth + AUTO_WINDOW_WIDTH_TOLERANCE) {
        autoWindowWidthState = null
      }
    }
    return { success: true, width: nextWidth, changed: nextWidth !== bounds.width }
  })

  // ─── Cloud Auth (对接 spark-edugen/edu-server) ───────────────────────────────
  registerAuthIpc()

  // ─── Built-in Terminal Panel (session-scoped PTY dock) ───────────────────────
  registerTerminalIpc()

  // ─── Provider 编辑辅助通道（如 reveal-key）注册入口 ─────────────────────

  // ─── Spark 平台官方模型（NewAPI 受管 Provider）──────────────────────────
  registerPlatformModelIpc()

  // ─── GitHub Connector 持久化与验证通道 ─────────────────────────────────
  registerGitHubConnectorIpc()

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
  worktree_meta_json?: string | null
}): WorkspaceInfo {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.root_path,
    pinnedAt: workspace.pinned_at,
    archivedAt: workspace.archived_at,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
    worktreeMeta: (() => {
      if (workspace.worktree_meta_json == null) return null
      try {
        return JSON.parse(workspace.worktree_meta_json) as {
          baseRepoRoot: string
          branch: string
          baseBranch: string
          baseWorkspaceId?: string
        }
      } catch {
        return null
      }
    })(),
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
    reasoningEffort: isProtocolReasoning(agent.reasoningEffort) ? agent.reasoningEffort : 'medium',
  }
}

function toWorkflowItem(workflow: StorageWorkflowItem): ProtocolWorkflowItem {
  return {
    ...workflow,
    graph: toWorkflowGraph(workflow.graph),
  }
}

function toManagedTeam(team: StorageAgentTeamItem): ManagedTeam {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    builtIn: team.builtIn,
    enabled: team.enabled,
    hostAgentId: team.hostAgentId,
    memberAgentIds: team.memberAgentIds,
    maxDepth: team.maxDepth,
    allowNesting: team.allowNesting,
    prompt: team.prompt,
    metadata: team.metadata,
    maxDiscussionRounds: team.maxDiscussionRounds,
    enablePeerMessaging: team.enablePeerMessaging,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
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
        return [
          {
            id,
            kind: isWorkflowNodeKind(kind) ? kind : 'agent',
            title: typeof record.title === 'string' ? record.title : id,
            x: typeof record.x === 'number' ? record.x : 80,
            y: typeof record.y === 'number' ? record.y : 80,
            config:
              record.config != null && typeof record.config === 'object'
                ? (record.config as Record<string, unknown>)
                : {},
          },
        ]
      })
    : []
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
        if (edge == null || typeof edge !== 'object') return []
        const record = edge as Record<string, unknown>
        const from = typeof record.from === 'string' ? record.from : ''
        const to = typeof record.to === 'string' ? record.to : ''
        if (!from || !to) return []
        return [
          {
            id: typeof record.id === 'string' ? record.id : `${from}-${to}`,
            from,
            to,
          },
        ]
      })
    : []
  // orientation 由渲染层写入 graph_json，这里白名单透传（仅认 'vertical'，其余视为横向缺省）。
  const orientation: WorkflowOrientation | undefined =
    value.orientation === 'vertical' ? 'vertical' : undefined
  return orientation != null ? { nodes, edges, orientation } : { nodes, edges }
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
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
}

function isWorkflowNodeKind(
  kind: string,
): kind is ProtocolWorkflowItem['graph']['nodes'][number]['kind'] {
  return (
    kind === 'input' ||
    kind === 'plan' ||
    kind === 'agent' ||
    kind === 'subagent' ||
    kind === 'skill' ||
    kind === 'tool' ||
    kind === 'mcp' ||
    kind === 'approval' ||
    kind === 'verify' ||
    kind === 'review' ||
    kind === 'artifact' ||
    kind === 'loop'
  )
}

/**
 * 归一化路径用于相等比较：先 path.resolve，再尝试 realpath 解软链。
 * realpath 失败（路径不存在）时回退到 resolve 结果。
 */
function normalizeRealPath(p: string): string {
  const resolved = path.resolve(p)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

/** 时间戳兜底分支名 spark/YYYYMMDD-HHmmss */
function timestampWorktreeBranch(): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `spark/${ts}`
}

/**
 * 解析 worktree 分支名：优先调用 LLM 按任务生成语义化 slug，
 * 失败则回退到任务文本的本地 slug，最后回退到时间戳。返回含 `spark/` 前缀的完整分支名。
 */
async function resolveWorktreeBranchName(req: {
  taskText?: string
  providerProfileId?: string
  model?: string
}): Promise<string> {
  const taskText = req.taskText?.trim() ?? ''
  if (taskText === '') return timestampWorktreeBranch()

  const localSlug = sanitizeBranchSlug(taskText)
  try {
    if (req.providerProfileId != null && req.providerProfileId !== '') {
      const profile = (await getProviderService().listProviders()).find(
        (p) => p.id === req.providerProfileId,
      )
      if (profile != null && profile.keystoreRef) {
        const apiKey = await resolveProviderApiKeyForProfile(profile)
        const model = req.model?.trim() || profile.defaultModel
        if (apiKey != null && apiKey.trim() !== '' && model != null && model !== '') {
          const slug = await generateWorktreeName({
            providerType: profile.provider,
            apiKey,
            ...(profile.apiEndpoint != null ? { apiEndpoint: profile.apiEndpoint } : {}),
            model,
            taskText,
          })
          if (slug != null && slug.length > 0) return `spark/${slug}`
        }
      }
    }
  } catch (err) {
    log.warn(
      `resolveWorktreeBranchName LLM step failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return localSlug.length > 0 ? `spark/${localSlug}` : timestampWorktreeBranch()
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
      return 'SparkWork - 权限请求'
    case 'ask_user_question':
      return 'SparkWork - 需要您的输入'
    case 'session_end':
      return 'SparkWork - 任务完成'
    case 'session_fail':
      return 'SparkWork - 任务失败'
    default:
      return 'SparkWork'
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

function showSystemNotification(
  title: string,
  body: string,
  navigationTarget?: SystemNotificationNavigateRequest,
): void {
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
    // 点击通知时聚焦窗口，并把目标转交给渲染进程完成精确路由。
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    if (navigationTarget != null) {
      pushStreamEvent('stream:system-notification:navigate', navigationTarget)
    }
  })

  notification.show()
}

// ─── Playwright Status Builder ───────────────────────────────────────────

/**
 * Build a full Playwright status response by combining integrity detection
 * and MCP registration state. The legacy embedded view was removed; the
 * visible in-app browser is exposed separately as spark_browser.
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
    viewOpen: false,
    cdpEndpoint: null,
    lastError: integrity.lastError,
  }
}
