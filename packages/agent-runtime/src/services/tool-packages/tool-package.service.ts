import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  ToolPackageIdSchema,
  ToolPackageManifestSchema,
  validateToolEnvironmentValue,
  type ToolEnvironmentVariable,
  type ToolPackageConfigScope,
  type ToolPackageDetail,
  type ToolPackageEnvironmentStatus,
  type ToolPackageInspection,
  type ToolPackageManifest,
  type ToolPackageSecureRequest,
  type ToolPackageSource,
  type ToolPackageSummary,
  type ToolPackageTrust,
} from '@spark/protocol'
import {
  ToolPackageRepository,
  type SparkDatabase,
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
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import { ToolProcessHost, type ToolProcessInvocationContext } from './tool-process-host.js'

export interface ToolPackageChangeEvent {
  change: 'installed' | 'configured' | 'permission' | 'enabled' | 'disabled' | 'secret-requested'
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
}

export interface ToolPackageSecretStore {
  get(ref: KeystoreRef): Promise<string | null>
  set(ref: KeystoreRef, value: string): Promise<void>
  delete(ref: KeystoreRef): Promise<boolean>
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
  private readonly listeners = new Set<(event: ToolPackageChangeEvent) => void>()
  private readonly fulfillingSecureRequests = new Set<string>()
  private readonly packageRootOverride: string | undefined
  private readonly databasePath: string | undefined
  readonly capabilities: ToolHostCapabilityBroker
  readonly processHost: ToolProcessHost

  constructor(
    db: SparkDatabase,
    packageRoot?: string,
    capabilities = new ToolHostCapabilityBroker(),
    processHost?: ToolProcessHost,
    private readonly secretStore: ToolPackageSecretStore = defaultSecretStore,
  ) {
    this.packageRootOverride = packageRoot
    this.databasePath = typeof db.path === 'string' && db.path.length > 0 ? db.path : undefined
    this.repositoryInstance = this.databasePath == null ? null : new ToolPackageRepository(db)
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

  onChange(listener: (event: ToolPackageChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): ToolPackageRow[] {
    return this.repository.list()
  }

  listSummaries(): ToolPackageSummary[] {
    return this.repository.list().map((row) => this.toSummary(row))
  }

  async getDetail(packageId: string, version?: string): Promise<ToolPackageDetail> {
    const resolvedVersion = this.resolveInstalledVersion(packageId, version)
    const manifest = this.getManifest(packageId, resolvedVersion)
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

  async installDirectory(params: {
    sourcePath: string
    source: Extract<ToolPackageSource, 'managed-project' | 'local-directory'>
    trust?: ToolPackageTrust
  }): Promise<ToolPackageRow> {
    const installed = await installToolPackageDirectoryAtomic(params.sourcePath, this.packageRoot)
    this.repository.installVersion({
      manifest: installed.inspection.manifest,
      source: params.source,
      trust: params.trust ?? 'trusted-local',
      installPath: installed.installPath,
      sourcePath: installed.inspection.sourcePath,
      integritySha256: installed.inspection.integritySha256,
    })
    this.emit({
      change: 'installed',
      packageId: installed.inspection.manifest.id,
      runtimeChanged: false,
    })
    return this.requirePackage(installed.inspection.manifest.id)
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
    if (manifest.runtime.adapter !== 'process') {
      throw new Error(
        `Tool package runtime adapter is not executable yet: ${manifest.runtime.adapter}`,
      )
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
    if (manifest.runtime.adapter !== 'process') {
      throw new Error(
        `Tool package runtime adapter is not executable yet: ${manifest.runtime.adapter}`,
      )
    }
    const environment = await this.resolveEnvironment(
      request.packageId,
      manifest,
      request.toolName,
      request.context ?? {},
    )
    const grantedCapabilities = new Set(
      this.repository
        .listPermissions(request.packageId, request.version)
        .filter(
          (permission) => permission.kind === 'spark-capability' && permission.state === 'granted',
        )
        .map((permission) => permission.permission),
    )
    return this.processHost.invoke({
      manifest,
      installPath: version.install_path,
      toolName: request.toolName,
      input: request.input,
      context: { ...(request.context ?? {}), environment },
      grantedCapabilities,
      ...(request.timeoutMs != null ? { timeoutMs: request.timeoutMs } : {}),
    })
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
