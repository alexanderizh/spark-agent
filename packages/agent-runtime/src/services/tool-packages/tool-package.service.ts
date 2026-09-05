import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  ToolPackageIdSchema,
  ToolNameSchema,
  ToolPackageManifestSchema,
  validateToolEnvironmentValue,
  type ToolEnvironmentVariable,
  type ToolPackageConfigScope,
  type ToolPackageDetail,
  type ToolPackageDevelopmentStep,
  type ToolPackageEnvironmentStatus,
  type ToolPackageInspection,
  type ToolPackageManifest,
  type ToolPackageProjectStepResult,
  type ToolPackageSecureRequest,
  type ToolPackageSource,
  type ToolPackageSummary,
  type ToolPackageTestResult,
  type ToolPackageTrust,
  type ToolPackageUninstallResult,
} from '@spark/protocol'
import {
  ToolPackageRepository,
  ToolInvocationRepository,
  type SparkDatabase,
  type ListToolInvocationsParams,
  type ToolPackageConfigRow,
  type ToolPackagePermissionKind,
  type ToolPackagePermissionState,
  type ToolPackageRow,
} from '@spark/storage'
import type { KeystoreRef } from '@spark/shared/keystore'
import { deleteSecret, getSecret, setSecret } from '@spark/shared/keystore'
import {
  inspectToolPackageDirectory,
  installToolPackageDirectoryAtomic,
} from './tool-package-inspector.js'
import {
  cloneGitRepository,
  extractToolPackageArchive,
  resolveGitImportSource,
  validateGitRef,
  validateGitSubdirectory,
} from './tool-package-import.js'
import { runManagedProjectDevelopmentStep } from './tool-package-project-runner.js'
import {
  invokeMcpImportTool,
  invokeRemoteHttpTool,
  type McpToolInvoker,
} from './tool-package-remote-executors.js'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import {
  ToolProcessHost,
  type ToolProcessInvocationContext,
  type ToolProcessRuntimeEventSink,
} from './tool-process-host.js'
import { z } from 'zod'
import { executeHttpTool } from '../custom-tools/http-executor.js'
import type { CustomToolService } from '../custom-tools/custom-tool.service.js'

export interface ToolPackageChangeEvent {
  change:
    | 'installed'
    | 'configured'
    | 'permission'
    | 'enabled'
    | 'disabled'
    | 'secret-requested'
    | 'uninstalled'
    | 'version-removed'
  packageId: string
  runtimeChanged: boolean
}

export interface ToolPackageInvocationRequest {
  packageId: string
  version: string
  toolName: string
  input: unknown
  context?: Omit<ToolProcessInvocationContext, 'environment'>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ToolPackageSecretStore {
  get(ref: KeystoreRef): Promise<string | null>
  set(ref: KeystoreRef, value: string): Promise<void>
  delete(ref: KeystoreRef): Promise<boolean>
}

/**
 * mcp-import 工具包需要的 MCP 服务面。McpService 结构上满足此接口，
 * 聚焦测试注入 fake；缺省（未注入）时 mcp-import 包不可安装与调用。
 */
export interface ToolPackageMcpBridge extends McpToolInvoker {
  serverExists(serverId: string): boolean
  listServerTools(
    serverId: string,
    options?: { startIfNeeded?: boolean },
  ): Promise<Array<{ name: string; description: string; inputSchema?: unknown }>>
}

/** 当前服务层能实际执行的运行时适配器。 */
const EXECUTABLE_RUNTIME_ADAPTERS: ReadonlySet<string> = new Set([
  'process',
  'remote-http',
  'declarative-http',
  'mcp-import',
  'legacy-custom-tool',
])

function assertExecutableAdapter(manifest: ToolPackageManifest): void {
  if (!EXECUTABLE_RUNTIME_ADAPTERS.has(manifest.runtime.adapter)) {
    throw new Error(`Tool package runtime adapter is not executable: ${manifest.runtime.adapter}`)
  }
}

const defaultSecretStore: ToolPackageSecretStore = {
  get: getSecret,
  set: setSecret,
  delete: deleteSecret,
}

const MAX_MANAGED_PROJECT_FILE_BYTES = 2 * 1024 * 1024
const MAX_MANAGED_PROJECT_FILES = 50_000

export class ToolPackageService {
  private readonly repositoryInstance: ToolPackageRepository | null
  private readonly invocationRepositoryInstance: ToolInvocationRepository | null
  private readonly listeners = new Set<(event: ToolPackageChangeEvent) => void>()
  private readonly fulfillingSecureRequests = new Set<string>()
  private readonly activeTestControllers = new Map<string, AbortController>()
  private readonly activeDevelopmentControllers = new Map<string, AbortController>()
  private readonly packageRootOverride: string | undefined
  private readonly databasePath: string | undefined
  readonly capabilities: ToolHostCapabilityBroker
  readonly processHost: ToolProcessHost
  private legacyCustomTools: Pick<CustomToolService, 'executeEnabled'> | undefined

  constructor(
    db: SparkDatabase,
    packageRoot?: string,
    capabilities = new ToolHostCapabilityBroker(),
    processHost?: ToolProcessHost,
    private readonly secretStore: ToolPackageSecretStore = defaultSecretStore,
    private readonly mcpBridge?: ToolPackageMcpBridge,
  ) {
    this.packageRootOverride = packageRoot
    this.databasePath = typeof db.path === 'string' && db.path.length > 0 ? db.path : undefined
    this.repositoryInstance = this.databasePath == null ? null : new ToolPackageRepository(db)
    this.invocationRepositoryInstance =
      this.databasePath == null ? null : new ToolInvocationRepository(db)
    this.capabilities = capabilities
    this.processHost = processHost ?? new ToolProcessHost(capabilities)
  }

  private get repository(): ToolPackageRepository {
    if (this.repositoryInstance == null) {
      throw new Error('Tool Package storage requires a persistent database path')
    }
    return this.repositoryInstance
  }

  private get packageRoot(): string {
    if (this.packageRootOverride != null) return this.packageRootOverride
    if (this.databasePath == null) {
      throw new Error('Tool Package filesystem operations require a database path')
    }
    return join(dirname(this.databasePath), 'tool-packages')
  }

  private get projectRoot(): string {
    return join(dirname(this.packageRoot), 'tool-projects')
  }

  /** 压缩包 / Git 克隆的临时物化目录；安装为不可变版本后即清理。 */
  private get importRoot(): string {
    return join(dirname(this.packageRoot), 'tool-imports')
  }

  onChange(listener: (event: ToolPackageChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onRuntimeEvent(listener: ToolProcessRuntimeEventSink): () => void {
    return this.processHost.onRuntimeEvent(listener)
  }

  setLegacyCustomToolService(service: Pick<CustomToolService, 'executeEnabled'> | null): void {
    this.legacyCustomTools = service ?? undefined
  }

  list(): ToolPackageRow[] {
    return this.repository.list()
  }

  listSummaries(): ToolPackageSummary[] {
    return this.repository.list().map((row) => this.toSummary(row))
  }

  listInvocations(params: ListToolInvocationsParams = {}) {
    return this.invocationRepositoryInstance?.list(params) ?? { items: [], total: 0 }
  }

  async testInstalledVersion(params: {
    packageId: string
    version?: string
    toolName: string
    input: Record<string, unknown>
    correlationId?: string
  }): Promise<ToolPackageTestResult> {
    const version = this.resolveInstalledVersion(params.packageId, params.version)
    const correlationId = params.correlationId ?? randomUUID()
    if (this.activeTestControllers.has(correlationId)) {
      throw new Error(`Tool Package test correlationId is already active: ${correlationId}`)
    }
    const controller = new AbortController()
    this.activeTestControllers.set(correlationId, controller)
    const startedAt = Date.now()
    try {
      const result = await this.invokeInstalledVersion({
        packageId: params.packageId,
        version,
        toolName: params.toolName,
        input: params.input,
        context: { correlationId, invocationSource: 'test' },
        signal: controller.signal,
      })
      return { ok: true, result, durationMs: Date.now() - startedAt, correlationId }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: toolPackageErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
        durationMs: Date.now() - startedAt,
        correlationId,
      }
    } finally {
      this.activeTestControllers.delete(correlationId)
    }
  }

  cancelTest(correlationId: string): boolean {
    const controller = this.activeTestControllers.get(correlationId)
    if (controller == null) return false
    controller.abort()
    return true
  }

  async getDetail(packageId: string, version?: string): Promise<ToolPackageDetail> {
    const resolvedVersion = this.resolveInstalledVersion(packageId, version)
    const manifest = this.getManifest(packageId, resolvedVersion)
    const versionRow = this.repository.getVersion(packageId, resolvedVersion)
    return {
      package: this.toSummary(this.requirePackage(packageId)),
      version: resolvedVersion,
      manifest,
      environment: await this.getEnvironmentStatus(packageId, resolvedVersion),
      permissions: this.repository
        .listPermissions(packageId, resolvedVersion)
        .map((permission) => ({
          kind: permission.kind,
          permission: permission.permission,
          required: permission.required === 1,
          state: permission.state,
        })),
      hostCapabilities: this.capabilities
        .describe()
        .filter((capability) =>
          [
            ...manifest.permissions.requiredSparkCapabilities,
            ...manifest.permissions.optionalSparkCapabilities,
          ].includes(capability.name),
        ),
      sourceUrl: versionRow?.source_url ?? null,
      sourceRef: versionRow?.source_ref ?? null,
      sourceSubdirectory: versionRow?.source_subdirectory ?? null,
    }
  }

  inspectDirectory(sourcePath: string): Promise<ToolPackageInspection> {
    return inspectToolPackageDirectory(sourcePath)
  }

  async createManagedProject(params: {
    manifest: unknown
    files?: Array<{ path: string; content: string }>
  }): Promise<{ packageId: string; projectPath: string; inspection: ToolPackageInspection }> {
    const manifest = ToolPackageManifestSchema.parse(params.manifest)
    const files = params.files ?? []
    if (files.length > 100)
      throw new Error('Managed tool project creation supports at most 100 files')
    const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(file.content), 0)
    if (totalBytes > 4 * 1024 * 1024) {
      throw new Error('Managed tool project creation payload exceeds 4 MB')
    }
    const target = join(this.projectRoot, manifest.id)
    if ((await lstat(target).catch(() => null)) != null) {
      throw new Error(`Managed tool project already exists: ${manifest.id}`)
    }
    const staging = `${target}.${randomUUID()}.staging`
    await mkdir(staging, { recursive: true })
    try {
      await writeFile(join(staging, 'spark-tool.json'), JSON.stringify(manifest, null, 2), 'utf8')
      for (const file of files) {
        if (file.path === 'spark-tool.json') {
          throw new Error('spark-tool.json is generated from the validated manifest')
        }
        const destination = resolveManagedProjectPath(staging, file.path)
        await assertNoSymlinkParents(staging, destination)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, file.content, 'utf8')
      }
      const inspection = await inspectToolPackageDirectory(staging)
      await mkdir(this.projectRoot, { recursive: true })
      await rename(staging, target)
      return { packageId: manifest.id, projectPath: target, inspection }
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async writeManagedProjectFile(params: {
    packageId: string
    path: string
    content: string
  }): Promise<{ projectPath: string; path: string }> {
    if (Buffer.byteLength(params.content) > MAX_MANAGED_PROJECT_FILE_BYTES) {
      throw new Error('Managed tool project file exceeds 2 MB')
    }
    const projectPath = await this.requireManagedProjectPath(params.packageId)
    const destination = resolveManagedProjectPath(projectPath, params.path)
    await assertNoSymlinkParents(projectPath, destination)
    const destinationInfo = await lstat(destination).catch(() => null)
    if (destinationInfo?.isSymbolicLink()) {
      throw new Error(`Managed tool project file is a symlink: ${params.path}`)
    }
    if (destinationInfo != null && !destinationInfo.isFile()) {
      throw new Error(`Managed tool project path is not a file: ${params.path}`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, params.content, 'utf8')
    return { projectPath, path: params.path }
  }

  async listManagedProjectFiles(packageId: string): Promise<{
    projectPath: string
    files: Array<{ path: string; size: number }>
  }> {
    const projectPath = await this.requireManagedProjectPath(packageId)
    const files: Array<{ path: string; size: number }> = []

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.DS_Store') {
          continue
        }
        const absolutePath = join(directory, entry.name)
        const info = await lstat(absolutePath)
        const path = relative(projectPath, absolutePath).split(sep).join('/')
        resolveManagedProjectPath(projectPath, path)
        if (info.isSymbolicLink()) {
          throw new Error(`Managed tool project contains a symlink: ${path}`)
        }
        if (info.isDirectory()) {
          await visit(absolutePath)
          continue
        }
        if (!info.isFile()) {
          throw new Error(`Managed tool project contains an unsupported entry: ${path}`)
        }
        files.push({ path, size: info.size })
        if (files.length > MAX_MANAGED_PROJECT_FILES) {
          throw new Error(`Managed tool project exceeds ${MAX_MANAGED_PROJECT_FILES} files`)
        }
      }
    }

    await visit(projectPath)
    return { projectPath, files }
  }

  async readManagedProjectFile(params: {
    packageId: string
    path: string
  }): Promise<{ projectPath: string; path: string; content: string }> {
    const projectPath = await this.requireManagedProjectPath(params.packageId)
    const source = resolveManagedProjectPath(projectPath, params.path)
    await assertNoSymlinkParents(projectPath, source)
    const info = await lstat(source).catch(() => null)
    if (info == null || !info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Managed tool project file not found: ${params.path}`)
    }
    if (info.size > MAX_MANAGED_PROJECT_FILE_BYTES) {
      throw new Error('Managed tool project file exceeds the 2 MB read limit')
    }
    const content = await readFile(source, 'utf8')
    if (Buffer.byteLength(content) > MAX_MANAGED_PROJECT_FILE_BYTES) {
      throw new Error('Managed tool project file exceeds the 2 MB read limit')
    }
    return { projectPath, path: params.path, content }
  }

  async installManagedProject(
    packageId: string,
  ): Promise<{ package: ToolPackageRow; version: string }> {
    const projectPath = await this.requireManagedProjectPath(packageId)
    const inspection = await inspectToolPackageDirectory(projectPath)
    if (inspection.manifest.id !== packageId) {
      throw new Error(
        `Managed project manifest id does not match its project: ${inspection.manifest.id}`,
      )
    }
    const row = await this.installDirectory({
      sourcePath: projectPath,
      source: 'managed-project',
    })
    return { package: row, version: inspection.manifest.version }
  }

  async installDirectory(params: {
    sourcePath: string
    source: Extract<
      ToolPackageSource,
      'managed-project' | 'local-directory' | 'local-archive' | 'registry'
    >
    trust?: ToolPackageTrust
    sourceUrl?: string
    sourceRef?: string
    sourceSubdirectory?: string
  }): Promise<ToolPackageRow> {
    const installed = await installToolPackageDirectoryAtomic(params.sourcePath, this.packageRoot)
    this.repository.installVersion({
      manifest: installed.inspection.manifest,
      source: params.source,
      trust: params.trust ?? 'trusted-local',
      installPath: installed.installPath,
      sourcePath: installed.inspection.sourcePath,
      ...(params.sourceUrl != null ? { sourceUrl: params.sourceUrl } : {}),
      ...(params.sourceRef != null ? { sourceRef: params.sourceRef } : {}),
      ...(params.sourceSubdirectory != null
        ? { sourceSubdirectory: params.sourceSubdirectory }
        : {}),
      integritySha256: installed.inspection.integritySha256,
    })
    this.emit({
      change: 'installed',
      packageId: installed.inspection.manifest.id,
      runtimeChanged: false,
    })
    return this.requirePackage(installed.inspection.manifest.id)
  }

  /**
   * 从本地完整工程目录安装：inspector 只读校验 + 原子不可变安装。
   * 与 installArchive/installGitRepository 保持同一返回形状，供 UI 与 Agent 面复用。
   */
  async installLocalDirectory(params: {
    sourcePath: string
    trust?: ToolPackageTrust
  }): Promise<{ package: ToolPackageRow; version: string }> {
    const row = await this.installDirectory({
      sourcePath: params.sourcePath,
      source: 'local-directory',
      ...(params.trust != null ? { trust: params.trust } : {}),
    })
    return { package: row, version: this.resolveInstalledVersion(row.id) }
  }

  /**
   * 从 zip 压缩包导入：解压到临时物化目录 → 走与本地目录完全一致的
   * inspector 安全校验 + 原子安装 → 清理临时目录。
   */
  async installArchive(params: {
    archivePath: string
    trust?: ToolPackageTrust
  }): Promise<{ package: ToolPackageRow; version: string }> {
    await mkdir(this.importRoot, { recursive: true })
    const materialized = await extractToolPackageArchive({
      archivePath: params.archivePath,
      extractRoot: this.importRoot,
    })
    try {
      const row = await this.installDirectory({
        sourcePath: materialized.root,
        source: 'local-archive',
        ...(params.trust != null ? { trust: params.trust } : {}),
      })
      return { package: row, version: this.resolveInstalledVersion(row.id) }
    } finally {
      await materialized.cleanup()
    }
  }

  /**
   * 从 Git 仓库导入：owner/repo 简写 / 完整 URL / 本地仓库路径 →
   * 浅克隆到临时目录（支持 monorepo 子目录）→ inspector 校验 + 原子安装 → 清理克隆目录。
   */
  async installGitRepository(params: {
    url: string
    ref?: string
    subdirectory?: string
    trust?: ToolPackageTrust
    timeoutMs?: number
  }): Promise<{ package: ToolPackageRow; version: string }> {
    const source = resolveGitImportSource(params.url)
    const subdirectory =
      params.subdirectory == null ? null : validateGitSubdirectory(params.subdirectory)
    const ref = params.ref == null ? null : validateGitRef(params.ref)
    await mkdir(this.importRoot, { recursive: true })
    const cloneDir = join(this.importRoot, `git-${randomUUID()}`)
    await cloneGitRepository({
      source,
      ...(ref != null ? { ref } : {}),
      targetDir: cloneDir,
      ...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
    })
    const packageRoot = subdirectory == null ? cloneDir : join(cloneDir, subdirectory)
    try {
      const row = await this.installDirectory({
        sourcePath: packageRoot,
        source: 'registry',
        ...(params.trust != null ? { trust: params.trust } : {}),
        sourceUrl: source.url,
        ...(ref != null ? { sourceRef: ref } : {}),
        ...(subdirectory != null ? { sourceSubdirectory: subdirectory } : {}),
      })
      return { package: row, version: this.resolveInstalledVersion(row.id) }
    } finally {
      await rm(cloneDir, { recursive: true, force: true })
    }
  }

  /**
   * 安装 remote-http 适配器工具包：远端本身就是工具包服务，本地没有代码快照，
   * 只落一份 manifest 快照目录以维持 install_path 不变量（卸载/删版本的目录
   * 守卫要求 installPath 位于 packageRoot 内）。完整性 = manifest JSON 的 SHA-256。
   */
  async installRemoteManifest(params: {
    manifest: unknown
    trust?: ToolPackageTrust
  }): Promise<{ package: ToolPackageRow; version: string }> {
    const manifest = ToolPackageManifestSchema.parse(params.manifest)
    if (manifest.runtime.adapter !== 'remote-http') {
      throw new Error(
        `installRemoteManifest only accepts remote-http manifests, got ${manifest.runtime.adapter}`,
      )
    }
    const { installPath, integritySha256 } = await this.writeManifestSnapshot(manifest)
    this.repository.installVersion({
      manifest,
      source: 'remote',
      trust: params.trust ?? 'trusted-local',
      installPath,
      sourceUrl: manifest.runtime.baseUrl,
      integritySha256,
    })
    this.emit({ change: 'installed', packageId: manifest.id, runtimeChanged: false })
    return {
      package: this.requirePackage(manifest.id),
      version: this.resolveInstalledVersion(manifest.id),
    }
  }

  /**
   * 从已配置的 MCP 服务器导入工具：一次性拉取 tools/list 生成 manifest.tools。
   * MCP 工具名与 manifest 引擎名约束不一致时自动归一化并记录 toolNameOverrides；
   * 无法归一化或冲突的工具跳过并在结果中说明，不静默丢弃。
   * 未知语义的工具按保守默认（low-write/update/unsafe）声明，不进入自动允许面。
   */
  async installMcpImport(params: {
    serverId: string
    packageId?: string
    version?: string
    name?: string
    tools?: string[]
    trust?: ToolPackageTrust
  }): Promise<{
    package: ToolPackageRow
    version: string
    importedTools: string[]
    skippedTools: Array<{ name: string; reason: string }>
  }> {
    if (this.mcpBridge == null) {
      throw new Error('MCP-import tool packages require an MCP bridge in this host')
    }
    if (!this.mcpBridge.serverExists(params.serverId)) {
      throw new Error(`MCP server not found: ${params.serverId}`)
    }
    const serverTools = await this.mcpBridge.listServerTools(params.serverId, {
      startIfNeeded: true,
    })

    const requestedTools = params.tools
    const requested = requestedTools == null ? null : new Set(requestedTools)
    if (requestedTools != null) {
      const available = new Set(serverTools.map((tool) => tool.name))
      const missing = requestedTools.filter((name) => !available.has(name))
      if (missing.length > 0) {
        throw new Error(
          `MCP server ${params.serverId} does not expose tools: ${missing.join(', ')}`,
        )
      }
    }

    const imported: Array<{
      manifestName: string
      mcpName: string
      title: string
      description: string
      inputSchema: Record<string, unknown>
    }> = []
    const skipped: Array<{ name: string; reason: string }> = []
    const seenManifestNames = new Set<string>()
    const overrides: Record<string, string> = {}

    for (const tool of serverTools) {
      if (requested != null && !requested.has(tool.name)) continue
      const manifestName = normalizeMcpToolName(tool.name)
      if (manifestName == null) {
        skipped.push({
          name: tool.name,
          reason: 'name cannot be normalized to an engine-safe tool name',
        })
        continue
      }
      if (seenManifestNames.has(manifestName)) {
        skipped.push({
          name: tool.name,
          reason: `normalized name collides with another tool: ${manifestName}`,
        })
        continue
      }
      const schemaSize = Buffer.byteLength(JSON.stringify(tool.inputSchema ?? {}), 'utf8')
      if (schemaSize > 100 * 1024) {
        skipped.push({ name: tool.name, reason: 'inputSchema exceeds the 100 KB manifest limit' })
        continue
      }
      seenManifestNames.add(manifestName)
      if (manifestName !== tool.name) overrides[manifestName] = tool.name
      const rawSchema: unknown = tool.inputSchema
      const schemaIsObject =
        rawSchema != null &&
        typeof rawSchema === 'object' &&
        (rawSchema as { type?: unknown }).type === 'object'
      imported.push({
        manifestName,
        mcpName: tool.name,
        title: tool.name.slice(0, 160),
        description: (tool.description.trim() !== ''
          ? tool.description
          : `Imported MCP tool: ${tool.name}`
        ).slice(0, 4000),
        inputSchema: schemaIsObject
          ? (rawSchema as Record<string, unknown>)
          : { type: 'object', properties: {} },
      })
    }

    if (imported.length === 0) {
      throw new Error(`MCP server ${params.serverId} exposes no importable tools`)
    }

    const manifest = ToolPackageManifestSchema.parse({
      schemaVersion: 1,
      id: params.packageId ?? defaultMcpImportPackageId(params.serverId),
      version: params.version ?? '1.0.0',
      name: params.name ?? `MCP import: ${params.serverId}`,
      description: `Tools imported from MCP server ${params.serverId}. Semantics are unknown to Spark; every tool is declared with conservative risk defaults and requires normal approval.`,
      runtime: {
        adapter: 'mcp-import',
        serverId: params.serverId,
        ...(Object.keys(overrides).length > 0 ? { toolNameOverrides: overrides } : {}),
      },
      tools: imported.map((tool) => ({
        name: tool.manifestName,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        risk: 'low-write',
        effect: 'update',
        idempotency: 'unsafe',
      })),
      environment: [],
      permissions: {
        declaredOsEffects: [],
        requiredSparkCapabilities: [],
        optionalSparkCapabilities: [],
      },
    })

    const { installPath, integritySha256 } = await this.writeManifestSnapshot(manifest)
    this.repository.installVersion({
      manifest,
      source: 'mcp-import',
      trust: params.trust ?? 'trusted-local',
      installPath,
      integritySha256,
    })
    this.emit({ change: 'installed', packageId: manifest.id, runtimeChanged: false })
    return {
      package: this.requirePackage(manifest.id),
      version: this.resolveInstalledVersion(manifest.id),
      importedTools: imported.map((tool) => tool.manifestName),
      skippedTools: skipped,
    }
  }

  /**
   * 写入 manifest-only 快照目录：`.staging-<uuid>/spark-tool.json` → rename 到
   * `<packageRoot>/<id>/<version>`。版本目录已存在时保持不动——不可变版本语义
   * 下，同版本同 manifest 的内容必然一致，仓库层会做同 manifest 幂等校验。
   */
  private async writeManifestSnapshot(manifest: ToolPackageManifest): Promise<{
    installPath: string
    integritySha256: string
  }> {
    const manifestJson = JSON.stringify(manifest, null, 2)
    const integritySha256 = createHash('sha256').update(manifestJson, 'utf8').digest('hex')
    const packageDir = join(this.packageRoot, manifest.id)
    const versionDir = join(packageDir, manifest.version)
    if (await fileExists(versionDir)) return { installPath: versionDir, integritySha256 }
    const staging = join(packageDir, `.staging-${randomUUID()}`)
    try {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, 'spark-tool.json'), manifestJson, 'utf8')
      await rename(staging, versionDir)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error instanceof Error ? error : new Error(String(error))
    }
    return { installPath: versionDir, integritySha256 }
  }

  async runManagedProjectStep(params: {
    packageId: string
    step: ToolPackageDevelopmentStep
    timeoutMs?: number
    operationId?: string
  }): Promise<ToolPackageProjectStepResult> {
    const operationId = params.operationId ?? randomUUID()
    if (this.activeDevelopmentControllers.has(operationId)) {
      throw new Error(`Tool Package development operation is already active: ${operationId}`)
    }
    const controller = new AbortController()
    this.activeDevelopmentControllers.set(operationId, controller)
    try {
      const projectPath = await this.requireManagedProjectPath(params.packageId)
      const { manifest } = await inspectToolPackageDirectory(projectPath)
      return await runManagedProjectDevelopmentStep({
        packageId: params.packageId,
        projectPath,
        manifest,
        step: params.step,
        signal: controller.signal,
        ...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
      })
    } finally {
      this.activeDevelopmentControllers.delete(operationId)
    }
  }

  cancelManagedProjectStep(operationId: string): boolean {
    const controller = this.activeDevelopmentControllers.get(operationId)
    if (controller == null) return false
    controller.abort()
    return true
  }

  getManifest(packageId: string, version?: string): ToolPackageManifest {
    const resolvedVersion = this.resolveInstalledVersion(packageId, version)
    const versionRow = this.repository.getVersion(packageId, resolvedVersion)
    if (versionRow == null)
      throw new Error(`Tool package version not found: ${packageId}@${resolvedVersion}`)
    return ToolPackageManifestSchema.parse(JSON.parse(versionRow.manifest_json) as unknown)
  }

  async getEnvironmentStatus(
    packageId: string,
    version?: string,
  ): Promise<ToolPackageEnvironmentStatus[]> {
    const manifest = this.getManifest(packageId, version)
    const rows = this.repository
      .listConfig(packageId)
      .filter((row) => row.scope === 'package' && row.scope_id === '' && row.tool_name === '')
    return Promise.all(
      manifest.environment.map(async (variable) => {
        const row = rows.find((candidate) => candidate.name === variable.name)
        const config = row == null ? null : await this.readCompatibleConfig(row, variable)
        const configured = config?.configured === true
        return {
          name: variable.name,
          secret: variable.secret,
          required: variable.required,
          agentConfigurable: variable.agentConfigurable,
          configured,
          ...(!variable.secret && config?.configured === true ? { value: config.value } : {}),
          source: configured
            ? 'configured'
            : variable.default !== undefined
              ? 'default'
              : 'missing',
        }
      }),
    )
  }

  configureValue(params: {
    packageId: string
    version?: string
    name: string
    value: unknown
    scope?: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
    actor: 'user' | 'agent'
  }): void {
    const manifest = this.getManifest(params.packageId, params.version)
    const variable = this.requireEnvironmentVariable(params.packageId, params.version, params.name)
    if (variable.secret) throw new Error(`${params.name} is secret and requires secure input`)
    if (params.actor === 'agent' && !variable.agentConfigurable) {
      throw new Error(`${params.name} cannot be configured by an Agent`)
    }
    const issue = validateToolEnvironmentValue(variable, params.value)
    if (issue != null) throw new Error(issue)
    const target = normalizeConfigTarget(manifest, params)
    this.repository.setConfig({
      packageId: params.packageId,
      ...target,
      name: params.name,
      value: params.value,
    })
    this.emit({ change: 'configured', packageId: params.packageId, runtimeChanged: true })
  }

  async writeSecretFromSecureInput(params: {
    packageId: string
    version?: string
    name: string
    value: string
    scope?: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
  }): Promise<void> {
    const manifest = this.getManifest(params.packageId, params.version)
    const variable = this.requireEnvironmentVariable(params.packageId, params.version, params.name)
    if (!variable.secret) throw new Error(`${params.name} is not a secret environment variable`)
    if (params.value.length === 0) throw new Error(`${params.name} cannot be empty`)
    const issue = validateToolEnvironmentValue(variable, params.value)
    if (issue != null) throw new Error(issue)
    const target = normalizeConfigTarget(manifest, params)
    const ref = environmentKeystoreRef({ ...params, ...target })
    const previousValue = await this.secretStore.get(ref)
    await this.secretStore.set(ref, params.value)
    try {
      this.repository.setConfig({
        packageId: params.packageId,
        ...target,
        name: params.name,
        keystoreRef: ref,
      })
    } catch (error) {
      if (previousValue == null) await this.secretStore.delete(ref).catch(() => false)
      else await this.secretStore.set(ref, previousValue).catch(() => undefined)
      throw error
    }
    this.emit({ change: 'configured', packageId: params.packageId, runtimeChanged: true })
  }

  requestSecretInput(params: {
    packageId: string
    version?: string
    name: string
    scope?: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
    actor: 'user' | 'agent'
    ttlMs?: number
  }): ToolPackageSecureRequest {
    const version = this.resolveInstalledVersion(params.packageId, params.version)
    const manifest = this.getManifest(params.packageId, version)
    const variable = this.requireEnvironmentVariable(params.packageId, version, params.name)
    if (!variable.secret) throw new Error(`${params.name} is not a secret environment variable`)
    if (params.actor === 'agent' && !variable.agentConfigurable) {
      throw new Error(`${params.name} does not allow Agent-initiated secure input`)
    }
    const target = normalizeConfigTarget(manifest, params)
    const current = this.listPendingSecureRequests().find(
      (request) =>
        request.packageId === params.packageId &&
        request.version === version &&
        request.name === params.name &&
        request.scope === target.scope &&
        request.scopeId === (target.scopeId ?? '') &&
        (request.toolName ?? '') === (target.toolName ?? ''),
    )
    if (current != null) return current
    const ttlMs = Math.min(Math.max(params.ttlMs ?? 15 * 60_000, 60_000), 60 * 60_000)
    const row = this.repository.createSecureRequest({
      id: randomUUID(),
      packageId: params.packageId,
      version,
      name: params.name,
      ...target,
      requestedBy: params.actor,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    })
    const request = this.toSecureRequest(row)
    this.emit({
      change: 'secret-requested',
      packageId: params.packageId,
      runtimeChanged: false,
    })
    return request
  }

  listPendingSecureRequests(): ToolPackageSecureRequest[] {
    const now = Date.now()
    const pending = this.repository.listSecureRequests('pending')
    const active: ToolPackageSecureRequest[] = []
    for (const row of pending) {
      if (Date.parse(row.expires_at) <= now) {
        this.repository.setSecureRequestStatus(row.id, 'expired')
        continue
      }
      active.push(this.toSecureRequest(row))
    }
    return active
  }

  async fulfillSecureRequest(requestId: string, value: string): Promise<void> {
    if (this.fulfillingSecureRequests.has(requestId)) {
      throw new Error('Secure input request is already being fulfilled')
    }
    this.fulfillingSecureRequests.add(requestId)
    try {
      const row = this.requirePendingSecureRequest(requestId)
      await this.writeSecretFromSecureInput({
        packageId: row.package_id,
        version: row.version,
        name: row.name,
        value,
        scope: row.scope,
        ...(row.scope_id ? { scopeId: row.scope_id } : {}),
        ...(row.tool_name ? { toolName: row.tool_name } : {}),
      })
      if (!this.repository.setSecureRequestStatus(requestId, 'completed')) {
        throw new Error('Secure input request was already closed')
      }
    } finally {
      this.fulfillingSecureRequests.delete(requestId)
    }
  }

  cancelSecureRequest(requestId: string): void {
    if (this.fulfillingSecureRequests.has(requestId)) {
      throw new Error('Secure input request is currently being fulfilled')
    }
    this.requirePendingSecureRequest(requestId)
    if (!this.repository.setSecureRequestStatus(requestId, 'cancelled')) {
      throw new Error('Secure input request was already closed')
    }
  }

  setPermission(params: {
    packageId: string
    version: string
    kind: ToolPackagePermissionKind
    permission: string
    state: ToolPackagePermissionState
  }): void {
    if (!this.repository.setPermissionState(params)) {
      throw new Error(`Tool package permission not found: ${params.permission}`)
    }
    const current = this.requirePackage(params.packageId)
    const permission = this.repository
      .listPermissions(params.packageId, params.version)
      .find(
        (candidate) => candidate.kind === params.kind && candidate.permission === params.permission,
      )
    if (
      params.state !== 'granted' &&
      permission?.required === 1 &&
      current.enabled_version === params.version
    ) {
      this.repository.setEnabledVersion(params.packageId, null)
    }
    this.emit({ change: 'permission', packageId: params.packageId, runtimeChanged: true })
  }

  async setEnabled(packageId: string, version: string | null): Promise<ToolPackageRow> {
    if (version == null) {
      const disabled = this.repository.setEnabledVersion(packageId, null)
      if (disabled == null) throw new Error(`Tool package not found: ${packageId}`)
      this.emit({ change: 'disabled', packageId, runtimeChanged: true })
      return disabled
    }
    const versionRow = this.repository.getVersion(packageId, version)
    if (versionRow == null || versionRow.status !== 'installed') {
      throw new Error(`Tool package version is not installed: ${packageId}@${version}`)
    }
    const packageRow = this.requirePackage(packageId)
    if (packageRow.trust === 'blocked') {
      throw new Error(`Tool package is blocked and cannot be enabled: ${packageId}`)
    }
    const manifest = this.getManifest(packageId, version)
    assertExecutableAdapter(manifest)
    if (manifest.runtime.adapter === 'mcp-import') {
      if (this.mcpBridge == null) {
        throw new Error('MCP-import tool packages require an MCP bridge in this host')
      }
      if (!this.mcpBridge.serverExists(manifest.runtime.serverId)) {
        throw new Error(`Tool package imports a missing MCP server: ${manifest.runtime.serverId}`)
      }
    }
    const availableCapabilities = new Set(this.capabilities.list())
    const unavailableCapabilities = manifest.permissions.requiredSparkCapabilities.filter(
      (capability) => !availableCapabilities.has(capability),
    )
    if (unavailableCapabilities.length > 0) {
      throw new Error(
        `Required Spark capabilities are unavailable: ${unavailableCapabilities.join(', ')}`,
      )
    }
    const permissions = this.repository.listPermissions(packageId, version)
    const deniedOrPending = permissions.filter(
      (permission) => permission.required === 1 && permission.state !== 'granted',
    )
    if (deniedOrPending.length > 0) {
      throw new Error(
        `Tool package permissions are not granted: ${deniedOrPending.map((item) => item.permission).join(', ')}`,
      )
    }
    const missing = (await this.getEnvironmentStatus(packageId, version)).filter(
      (status) => status.required && status.source === 'missing',
    )
    if (missing.length > 0) {
      throw new Error(
        `Tool package configuration is missing: ${missing.map((item) => item.name).join(', ')}`,
      )
    }
    const enabled = this.repository.setEnabledVersion(packageId, version)
    if (enabled == null) throw new Error(`Tool package not found: ${packageId}`)
    this.emit({ change: 'enabled', packageId, runtimeChanged: true })
    return enabled
  }

  /**
   * Uninstall a disabled package: stop its processes, remove every immutable
   * version snapshot, delete all database rows, and clean up Keychain secrets.
   * Filesystem removal happens before the database delete so an rm failure
   * leaves the package installed and the operation retryable.
   */
  async uninstallPackage(params: {
    packageId: string
    removeManagedProject?: boolean
  }): Promise<ToolPackageUninstallResult> {
    const packageId = ToolPackageIdSchema.parse(params.packageId)
    const packageRow = this.requirePackage(packageId)
    if (packageRow.enabled_version != null) {
      throw new Error(`Tool package is enabled and must be disabled before uninstall: ${packageId}`)
    }
    const versions = this.repository.listVersions(packageId)
    const secretRefs = this.repository
      .listConfig(packageId)
      .map((config) => config.keystore_ref)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
    await this.processHost.invalidatePackage(packageId)
    await rm(join(this.packageRoot, packageId), { recursive: true, force: true })
    let removedManagedProject = false
    if (params.removeManagedProject === true) {
      await rm(join(this.projectRoot, packageId), { recursive: true, force: true })
      removedManagedProject = true
    }
    if (!this.repository.deletePackage(packageId)) {
      throw new Error(`Tool package not found: ${packageId}`)
    }
    let removedSecrets = 0
    for (const ref of new Set(secretRefs)) {
      const deleted = await this.secretStore.delete(ref as KeystoreRef).catch(() => false)
      if (deleted) removedSecrets += 1
    }
    this.emit({ change: 'uninstalled', packageId, runtimeChanged: true })
    return {
      packageId,
      removedVersions: versions.map((version) => version.version),
      removedSecrets,
      removedManagedProject,
    }
  }

  /**
   * Delete one immutable version of a package while keeping the package and
   * every other version installed. The enabled version and the last remaining
   * version are refused; those callers must disable or uninstall instead.
   */
  async deleteVersion(params: {
    packageId: string
    version: string
  }): Promise<{ removed: true; version: string }> {
    const packageId = ToolPackageIdSchema.parse(params.packageId)
    const packageRow = this.requirePackage(packageId)
    if (packageRow.enabled_version === params.version) {
      throw new Error(
        `Tool package version is enabled and must be disabled first: ${packageId}@${params.version}`,
      )
    }
    const versionRow = this.repository.getVersion(packageId, params.version)
    if (versionRow == null) {
      throw new Error(`Tool package version not found: ${packageId}@${params.version}`)
    }
    if (this.repository.listVersions(packageId).length <= 1) {
      throw new Error(`Tool package has a single version; uninstall the package: ${packageId}`)
    }
    const installRoot = resolve(this.packageRoot)
    if (!resolve(versionRow.install_path).startsWith(`${installRoot}${sep}`)) {
      throw new Error(`Tool package version install path is outside the package root: ${packageId}`)
    }
    await rm(versionRow.install_path, { recursive: true, force: true })
    if (!this.repository.deleteVersion(packageId, params.version)) {
      throw new Error(`Tool package version not found: ${packageId}@${params.version}`)
    }
    this.emit({ change: 'version-removed', packageId, runtimeChanged: false })
    return { removed: true, version: params.version }
  }

  listEnabledTools(): Array<{
    packageId: string
    version: string
    installPath: string
    manifest: ToolPackageManifest
    toolName: string
  }> {
    // Some non-desktop embeddings and focused unit tests intentionally provide
    // only a partial database host. They do not own persistent Tool Packages.
    if (this.repositoryInstance == null) return []
    return this.repository.list().flatMap((item) => {
      const enabledVersion = item.enabled_version
      if (item.state !== 'enabled' || enabledVersion == null) return []
      const version = this.repository.getVersion(item.id, enabledVersion)
      if (version == null || version.status !== 'installed') return []
      const manifest = ToolPackageManifestSchema.parse(JSON.parse(version.manifest_json) as unknown)
      const enabledNames = new Set(
        this.repository
          .listTools(item.id, enabledVersion)
          .filter((tool) => tool.enabled === 1)
          .map((tool) => tool.tool_name),
      )
      return manifest.tools
        .filter((tool) => enabledNames.has(tool.name))
        .map((tool) => ({
          packageId: item.id,
          version: enabledVersion,
          installPath: version.install_path,
          manifest,
          toolName: tool.name,
        }))
    })
  }

  async invoke(request: ToolPackageInvocationRequest): Promise<unknown> {
    const current = this.requirePackage(request.packageId)
    if (current.state !== 'enabled' || current.enabled_version !== request.version) {
      throw new Error(
        `Tool package version is not enabled: ${request.packageId}@${request.version}`,
      )
    }
    return this.invokeInstalledVersion(request)
  }

  /** Execute the exact immutable version captured by an active Agent loop or explicit test. */
  async invokeInstalledVersion(request: ToolPackageInvocationRequest): Promise<unknown> {
    if (this.requirePackage(request.packageId).trust === 'blocked') {
      throw new Error(`Tool package is blocked and cannot execute: ${request.packageId}`)
    }
    const version = this.repository.getVersion(request.packageId, request.version)
    if (version == null)
      throw new Error(`Tool package version not found: ${request.packageId}@${request.version}`)
    if (version.status !== 'installed') {
      throw new Error(
        `Tool package version is not installed: ${request.packageId}@${request.version}`,
      )
    }
    const manifest = ToolPackageManifestSchema.parse(JSON.parse(version.manifest_json) as unknown)
    assertExecutableAdapter(manifest)
    const traceId = randomUUID()
    const correlationId = request.context?.correlationId ?? randomUUID()
    this.invocationRepositoryInstance?.start({
      id: traceId,
      correlationId,
      sourceKind: 'tool-package',
      sourceId: request.packageId,
      packageId: request.packageId,
      toolName: request.toolName,
      version: request.version,
      adapter: manifest.runtime.adapter,
      ...(request.context?.sessionId != null ? { sessionId: request.context.sessionId } : {}),
      ...(request.context?.turnId != null ? { turnId: request.context.turnId } : {}),
      ...(request.context?.projectId != null ? { projectId: request.context.projectId } : {}),
      ...(request.context?.agentId != null ? { agentId: request.context.agentId } : {}),
      ...(request.context?.workflowId != null ? { workflowId: request.context.workflowId } : {}),
      invocationSource:
        request.context?.invocationSource ??
        (request.context?.workflowId != null ? 'workflow' : 'model'),
      inputSha256: hashJson(request.input),
    })
    try {
      const environment = await this.resolveEnvironment(
        request.packageId,
        manifest,
        request.toolName,
        request.context ?? {},
      )
      request.signal?.throwIfAborted()
      const grantedCapabilities = new Set(
        this.repository
          .listPermissions(request.packageId, request.version)
          .filter(
            (permission) =>
              permission.kind === 'spark-capability' && permission.state === 'granted',
          )
          .map((permission) => permission.permission),
      )

      let result: unknown
      if (manifest.runtime.adapter === 'remote-http') {
        result = await invokeRemoteHttpTool({
          manifest,
          toolName: request.toolName,
          input: request.input,
          environment,
          ...(request.timeoutMs != null ? { timeoutMs: request.timeoutMs } : {}),
          ...(request.signal != null ? { signal: request.signal } : {}),
        })
      } else if (manifest.runtime.adapter === 'declarative-http') {
        const spec = manifest.runtime.tools[request.toolName]
        if (spec == null) {
          throw new Error(`Declarative HTTP spec not found for tool: ${request.toolName}`)
        }
        const tool = manifest.tools.find((candidate) => candidate.name === request.toolName)
        if (tool == null) throw new Error(`Tool package tool not found: ${request.toolName}`)
        const now = new Date().toISOString()
        const httpResult = await executeHttpTool(
          {
            id: `${manifest.id}.${request.toolName}`,
            title: tool.title,
            description: tool.description,
            type: 'http',
            inputSchema: tool.inputSchema as never,
            spec,
            risk: tool.risk,
            effect: tool.effect,
            idempotency: tool.idempotency,
            timeoutMs: request.timeoutMs ?? manifest.runtime.timeoutMs ?? 30_000,
            enabled: true,
            origin: 'local',
            publishedVersion: 1,
            draftVersion: 1,
            lastTestAt: null,
            createdAt: now,
            updatedAt: now,
          },
          request.input as Record<string, unknown>,
          {
            signal: request.signal ?? new AbortController().signal,
            resolveSecret: async (name) => {
              const value = environment[name]
              if (value == null) throw new Error(`Tool package configuration is missing: ${name}`)
              return value
            },
          },
        )
        result = { text: httpResult.text, meta: httpResult.meta }
      } else if (manifest.runtime.adapter === 'mcp-import') {
        if (this.mcpBridge == null) {
          throw new Error('MCP-import tool packages require an MCP bridge in this host')
        }
        result = await invokeMcpImportTool({
          manifest,
          toolName: request.toolName,
          input: request.input,
          invoker: this.mcpBridge,
        })
      } else if (manifest.runtime.adapter === 'legacy-custom-tool') {
        if (this.legacyCustomTools == null) {
          throw new Error('Legacy Custom Tool service is unavailable in this host')
        }
        const legacyResult = await this.legacyCustomTools.executeEnabled({
          toolId: manifest.runtime.toolId,
          input: request.input as Record<string, unknown>,
          ...(request.context?.sessionId != null ? { sessionId: request.context.sessionId } : {}),
          ...(request.context?.turnId != null ? { turnId: request.context.turnId } : {}),
          ...(request.context?.projectId != null ? { projectId: request.context.projectId } : {}),
          ...(request.context?.agentId != null ? { agentId: request.context.agentId } : {}),
          ...(request.context?.workflowId != null
            ? { workflowId: request.context.workflowId }
            : {}),
          correlationId,
          source: 'model',
          invocationSource: 'nested',
          ...(request.signal != null ? { signal: request.signal } : {}),
        })
        result = {
          text: legacyResult.text,
          meta: legacyResult.meta,
          ...(legacyResult.traceId != null ? { legacyTraceId: legacyResult.traceId } : {}),
        }
      } else {
        result = await this.processHost.invoke({
          manifest,
          installPath: version.install_path,
          toolName: request.toolName,
          input: request.input,
          context: { ...(request.context ?? {}), correlationId, environment },
          grantedCapabilities,
          ...(request.timeoutMs != null ? { timeoutMs: request.timeoutMs } : {}),
          ...(request.signal != null ? { signal: request.signal } : {}),
        })
      }
      request.signal?.throwIfAborted()
      validateToolPackageOutput(manifest, request.toolName, result)
      this.invocationRepositoryInstance?.finish(traceId, {
        status: 'ok',
        outputBytes: jsonBytes(result),
      })
      return result
    } catch (error) {
      this.invocationRepositoryInstance?.finish(traceId, {
        status: classifyInvocationFailure(error),
        errorCode: toolPackageErrorCode(error),
      })
      throw error
    }
  }

  dispose(): Promise<void> {
    return this.processHost.dispose()
  }

  private async resolveEnvironment(
    packageId: string,
    manifest: ToolPackageManifest,
    toolName: string,
    context: Omit<ToolProcessInvocationContext, 'environment'>,
  ): Promise<Record<string, string>> {
    const rows = this.repository.listConfig(packageId)
    const selected = new Map<string, ToolPackageConfigRow>()
    const apply = (scope: ToolPackageConfigScope, scopeId: string, targetTool = ''): void => {
      for (const row of rows) {
        if (row.scope === scope && row.scope_id === scopeId && row.tool_name === targetTool) {
          selected.set(row.name, row)
        }
      }
    }
    apply('package', '')
    apply('tool', '', toolName)
    if (context.projectId != null) apply('project', context.projectId)
    if (context.agentId != null) apply('agent', context.agentId)
    if (context.workflowId != null) apply('workflow', context.workflowId)
    if (context.sessionId != null) apply('session', context.sessionId)

    const environment: Record<string, string> = {}
    for (const variable of manifest.environment) {
      const row = selected.get(variable.name)
      let value: unknown = variable.default
      if (row != null) {
        const config = await this.readCompatibleConfig(row, variable)
        if (config.configured) value = config.value
      }
      if (value == null) {
        if (variable.required)
          throw new Error(`Tool package configuration is missing: ${variable.name}`)
        continue
      }
      environment[variable.name] = stringifyEnvironmentValue(value)
    }
    return environment
  }

  private requireEnvironmentVariable(
    packageId: string,
    version: string | undefined,
    name: string,
  ): ToolEnvironmentVariable {
    const variable = this.getManifest(packageId, version).environment.find(
      (candidate) => candidate.name === name,
    )
    if (variable == null) throw new Error(`Tool package environment variable not found: ${name}`)
    return variable
  }

  private requirePackage(packageId: string): ToolPackageRow {
    const row = this.repository.get(packageId)
    if (row == null) throw new Error(`Tool package not found: ${packageId}`)
    return row
  }

  private async requireManagedProjectPath(packageId: string): Promise<string> {
    const validatedId = ToolPackageIdSchema.parse(packageId)
    const projectPath = join(this.projectRoot, validatedId)
    const projectInfo = await lstat(projectPath).catch(() => null)
    if (projectInfo == null || !projectInfo.isDirectory() || projectInfo.isSymbolicLink()) {
      throw new Error(`Managed tool project not found: ${packageId}`)
    }
    return projectPath
  }

  private resolveInstalledVersion(packageId: string, version?: string): string {
    const row = this.requirePackage(packageId)
    const resolvedVersion =
      version ?? row.enabled_version ?? this.repository.listVersions(packageId)[0]?.version
    if (resolvedVersion == null)
      throw new Error(`Tool package has no installed version: ${packageId}`)
    return resolvedVersion
  }

  private requirePendingSecureRequest(requestId: string) {
    const row = this.repository.getSecureRequest(requestId)
    if (row == null || row.status !== 'pending') {
      throw new Error('Secure input request is unavailable or already closed')
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.repository.setSecureRequestStatus(row.id, 'expired')
      throw new Error('Secure input request has expired')
    }
    return row
  }

  private toSecureRequest(
    row: ReturnType<ToolPackageRepository['getSecureRequest']> & {},
  ): ToolPackageSecureRequest {
    const manifest = this.getManifest(row.package_id, row.version)
    const variable = manifest.environment.find((candidate) => candidate.name === row.name)
    if (variable == null) {
      throw new Error(`Tool package environment variable not found: ${row.name}`)
    }
    return {
      id: row.id,
      packageId: row.package_id,
      packageName: manifest.name,
      version: row.version,
      name: row.name,
      title: variable.title,
      ...(variable.description != null ? { description: variable.description } : {}),
      scope: row.scope,
      scopeId: row.scope_id,
      ...(row.tool_name ? { toolName: row.tool_name } : {}),
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }
  }

  private toSummary(row: ToolPackageRow): ToolPackageSummary {
    return {
      id: row.id,
      name: row.display_name,
      description: row.description,
      source: row.source,
      trust: row.trust,
      state: row.state,
      enabledVersion: row.enabled_version,
      versions: this.repository.listVersions(row.id).map((version) => version.version),
      updatedAt: row.updated_at,
    }
  }

  private async readCompatibleConfig(
    row: ToolPackageConfigRow,
    variable: ToolEnvironmentVariable,
  ): Promise<{ configured: false } | { configured: true; value: unknown }> {
    if ((row.is_secret === 1) !== variable.secret) return { configured: false }
    let value: unknown
    if (row.is_secret === 1) {
      if (row.keystore_ref == null) return { configured: false }
      value = await this.secretStore.get(row.keystore_ref as KeystoreRef)
    } else {
      if (row.value_json == null) return { configured: false }
      try {
        value = JSON.parse(row.value_json) as unknown
      } catch {
        return { configured: false }
      }
    }
    if (value == null || validateToolEnvironmentValue(variable, value) != null) {
      return { configured: false }
    }
    return { configured: true, value }
  }

  private emit(event: ToolPackageChangeEvent): void {
    if (event.runtimeChanged) void this.processHost.invalidatePackage(event.packageId)
    for (const listener of this.listeners) listener(event)
  }
}

function validateToolPackageOutput(
  manifest: ToolPackageManifest,
  toolName: string,
  result: unknown,
): void {
  const tool = manifest.tools.find((candidate) => candidate.name === toolName)
  if (tool == null) throw new Error(`Tool package tool not found: ${toolName}`)
  if (tool.outputSchema == null) return
  const schema = z.fromJSONSchema(tool.outputSchema)
  const parsed = schema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `Invalid output from Tool Package ${manifest.id}/${toolName}: ${z.prettifyError(parsed.error)}`,
    )
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(safeJson(value)).digest('hex')
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(safeJson(value), 'utf8')
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return '[unserializable]'
  }
}

function classifyInvocationFailure(error: unknown): 'error' | 'timeout' | 'denied' | 'cancelled' {
  const message = error instanceof Error ? error.message : String(error)
  if (/abort|cancel/i.test(message)) return 'cancelled'
  if (/timed? out|timeout/i.test(message)) return 'timeout'
  if (/blocked|denied|not authorized|not enabled/i.test(message)) return 'denied'
  return 'error'
}

function toolPackageErrorCode(error: unknown): string {
  if (error instanceof Error && error.name && error.name !== 'Error') return error.name
  const message = error instanceof Error ? error.message : String(error)
  const explicit = /^([A-Z][A-Z0-9_]{2,80}):/.exec(message)?.[1]
  return explicit ?? 'TOOL_PACKAGE_EXECUTION_FAILED'
}

function environmentKeystoreRef(params: {
  packageId: string
  name: string
  scope?: ToolPackageConfigScope
  scopeId?: string
  toolName?: string
}): KeystoreRef {
  const identity = [
    params.scope ?? 'package',
    params.scopeId ?? '',
    params.toolName ?? '',
    params.name,
  ].join('\0')
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 20)
  return `tool-package:${params.packageId}:${params.name}:${suffix}` as KeystoreRef
}

function stringifyEnvironmentValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function normalizeConfigTarget(
  manifest: ToolPackageManifest,
  params: {
    scope?: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
  },
): { scope: ToolPackageConfigScope; scopeId?: string; toolName?: string } {
  const scope = params.scope ?? 'package'
  const scopeId = params.scopeId?.trim() ?? ''
  const toolName = params.toolName?.trim() ?? ''
  if (scope === 'package' && (scopeId || toolName)) {
    throw new Error('Package-scoped configuration cannot declare scopeId or toolName')
  }
  if (scope === 'tool') {
    if (!toolName) throw new Error('Tool-scoped configuration requires toolName')
    if (!manifest.tools.some((tool) => tool.name === toolName)) {
      throw new Error(`Tool package tool not found: ${toolName}`)
    }
    if (scopeId) throw new Error('Tool-scoped configuration cannot declare scopeId')
    return { scope, toolName }
  }
  if (scope !== 'package') {
    if (!scopeId) throw new Error(`${scope}-scoped configuration requires scopeId`)
    if (toolName) throw new Error(`${scope}-scoped configuration cannot declare toolName`)
    return { scope, scopeId }
  }
  return { scope }
}

function resolveManagedProjectPath(projectRoot: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').includes('..')
  ) {
    throw new Error(`Unsafe managed tool project path: ${relativePath}`)
  }
  const target = resolve(projectRoot, relativePath)
  const prefix = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`
  if (!target.startsWith(prefix))
    throw new Error(`Managed tool project path escapes root: ${relativePath}`)
  return target
}

async function assertNoSymlinkParents(projectRoot: string, target: string): Promise<void> {
  let current = dirname(target)
  const pending: string[] = []
  while (current !== projectRoot) {
    pending.push(current)
    const parent = dirname(current)
    if (parent === current) throw new Error('Managed tool project path escapes root')
    current = parent
  }
  for (const directory of pending.reverse()) {
    const info = await lstat(directory).catch(() => null)
    if (info?.isSymbolicLink())
      throw new Error(`Managed tool project path contains a symlink: ${directory}`)
    if (info != null && !info.isDirectory())
      throw new Error(`Managed tool project path is not a directory: ${directory}`)
  }
}

async function fileExists(target: string): Promise<boolean> {
  const info = await lstat(target).catch(() => null)
  return info != null
}

/**
 * MCP 工具名 → manifest 引擎名：小写化并把非法字符折叠为 `-`，
 * 结果必须满足 ToolNameSchema（小写字母开头、2-96 位）。不满足返回 null（跳过并说明原因）。
 */
function normalizeMcpToolName(name: string): string | null {
  const candidate = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return ToolNameSchema.safeParse(candidate).success ? candidate : null
}

/** mcp-import 包默认 id：serverId 归一化到包 id 约束（小写、folder-safe、≥3 位）。 */
function defaultMcpImportPackageId(serverId: string): string {
  const normalized = `mcp-${serverId}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 96)
  return ToolPackageIdSchema.safeParse(normalized).success
    ? normalized
    : `mcp-import-${randomUUID().slice(0, 8)}`
}
