import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  OptionalCapabilityId,
  OptionalCapabilityErrorCode,
  OptionalCapabilityItem,
  OptionalCapabilityMutationResponse,
  OptionalCapabilityPhase,
  OptionalCapabilityProgress,
  OptionalCapabilitySnapshot,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import {
  fetchSparkInstallManifest,
  resolveArtifactUrl,
  resolveArtifactUrlString,
  type SparkInstallArtifact,
  type SparkInstallManifest,
} from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'
import {
  installBinaryArchive,
  type BinaryArchiveInstallParams,
  type BinaryArchiveInstallResult,
} from '../../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js'
import {
  OPTIONAL_CAPABILITY_DEFINITIONS,
  getOptionalCapabilityDefinition,
  type SupportedDesktopArch,
  type SupportedDesktopPlatform,
} from './definitions.js'
import {
  type ExternalCapabilityAdapter,
  type ExternalCapabilityId,
  type ExternalCapabilityDescription,
} from './externalCapabilityAdapters.js'
import {
  OptionalCapabilityStateStore,
  type ActiveCapabilityState,
} from './OptionalCapabilityStateStore.js'
import { validateCapabilityPackageHealth } from './CapabilityPackageHealth.js'

type InstallArchive = (params: BinaryArchiveInstallParams) => Promise<BinaryArchiveInstallResult>

export interface OptionalCapabilityManagerOptions {
  userDataDir: string
  platform: SupportedDesktopPlatform
  arch: SupportedDesktopArch
  fetchManifest?: typeof fetchSparkInstallManifest
  installArchive?: InstallArchive
  now?: () => Date
  onProgress?: (progress: OptionalCapabilityProgress) => void
  onSnapshot?: (snapshot: OptionalCapabilitySnapshot) => void
  logger?: CapabilityLogger
  externalAdapters?: Partial<Record<ExternalCapabilityId, ExternalCapabilityAdapter>>
}

type CapabilityLogger = Pick<ReturnType<typeof createLogger>, 'info' | 'warn' | 'error'>
type CapabilityErrorState = {
  code: OptionalCapabilityErrorCode
  message: string
  retryable: boolean
}

const MANIFEST_CACHE_TTL_MS = 24 * 60 * 60 * 1_000

function defaultAutoUpdateForCapability(id: OptionalCapabilityId): boolean {
  // Codex App Server 是 Spark 适配器的协议上游。已安装的兼容 runtime 应保持可用，
  // 新版本默认由用户明确选择；其他可选能力沿用原有自动更新默认值。
  return id !== 'codex-runtime'
}

export class OptionalCapabilityManager {
  private readonly root: string
  private readonly store: OptionalCapabilityStateStore
  private readonly fetchManifest: typeof fetchSparkInstallManifest
  private readonly installArchive: InstallArchive
  private readonly now: () => Date
  private readonly onProgress: ((progress: OptionalCapabilityProgress) => void) | undefined
  private readonly onSnapshot: ((snapshot: OptionalCapabilitySnapshot) => void) | undefined
  private readonly installs = new Map<
    OptionalCapabilityId,
    Promise<OptionalCapabilityMutationResponse>
  >()
  private readonly errors = new Map<OptionalCapabilityId, CapabilityErrorState>()
  private readonly controllers = new Map<OptionalCapabilityId, AbortController>()
  private readonly verifiedActiveStates = new Map<OptionalCapabilityId, string>()
  private readonly externalAutoUpdates = new Map<ExternalCapabilityId, boolean>()
  private readonly progressListeners = new Set<(progress: OptionalCapabilityProgress) => void>()
  private readonly logger: CapabilityLogger
  private readonly externalAdapters: Partial<
    Record<ExternalCapabilityId, ExternalCapabilityAdapter>
  >
  private queueTail: Promise<void> = Promise.resolve()
  private queuedJobs = 0
  private manifest: SparkInstallManifest | null = null
  private manifestCheckedAt: Date | null = null
  private manifestCacheLoaded = false
  private manifestAvailable = false

  constructor(private readonly options: OptionalCapabilityManagerOptions) {
    this.root = join(options.userDataDir, 'optional-capabilities')
    this.store = new OptionalCapabilityStateStore(this.root)
    this.fetchManifest = options.fetchManifest ?? fetchSparkInstallManifest
    this.installArchive = options.installArchive ?? installBinaryArchive
    this.now = options.now ?? (() => new Date())
    this.onProgress = options.onProgress
    this.onSnapshot = options.onSnapshot
    this.logger = options.logger ?? createLogger('optional-capabilities')
    this.externalAdapters = options.externalAdapters ?? {}
  }

  async list(): Promise<OptionalCapabilitySnapshot> {
    await this.loadManifestCache()
    return this.buildSnapshot()
  }

  async check(forceRemote = false): Promise<OptionalCapabilitySnapshot> {
    await this.loadManifestCache()
    const cacheAge = this.manifestCheckedAt
      ? this.now().getTime() - this.manifestCheckedAt.getTime()
      : Number.POSITIVE_INFINITY
    const cacheFresh = cacheAge >= 0 && cacheAge < MANIFEST_CACHE_TTL_MS
    if (forceRemote || !this.manifest || !cacheFresh) {
      await this.refreshManifest().catch(() => undefined)
    }
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    for (const capability of snapshot.capabilities) {
      if (
        this.manifestAvailable &&
        capability.state === 'update_available' &&
        capability.autoUpdate
      ) {
        void this.enqueueInstall(capability.id)
      }
    }
    return snapshot
  }

  install(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    return this.enqueueInstall(id)
  }

  update(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    return this.enqueueInstall(id)
  }

  repair(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    return this.enqueueInstall(id)
  }

  subscribeProgress(listener: (progress: OptionalCapabilityProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  async cancel(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    const controller = this.controllers.get(id)
    const definition = getOptionalCapabilityDefinition(id)
    if (!definition.cancellable) {
      const snapshot = await this.buildSnapshot()
      return {
        success: false,
        message: `${definition.displayName}当前安装任务不支持取消`,
        snapshot,
      }
    }
    if (!controller) {
      const snapshot = await this.buildSnapshot()
      return { success: false, message: `${definition.displayName}当前没有可取消的安装`, snapshot }
    }
    controller.abort()
    this.errors.delete(id)
    this.logger.warn(
      `event=optional_capability_install capability=${id} stage=cancelled status=cancelled source=user`,
    )
    this.emitProgress(id, definition.displayName, 'cancelled', 0, 0, 0, '安装已取消')
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    return { success: true, message: `${definition.displayName}安装已取消`, snapshot }
  }

  async uninstall(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    const definition = getOptionalCapabilityDefinition(id)
    if (!definition.supportsUninstall) {
      const snapshot = await this.buildSnapshot()
      return { success: false, message: `${definition.displayName}不支持从应用内卸载`, snapshot }
    }
    const activeInstall = this.installs.get(id)
    if (activeInstall) {
      this.controllers.get(id)?.abort()
      await activeInstall
    }
    this.logger.info(
      `event=optional_capability_uninstall capability=${id} stage=started status=running`,
    )
    await this.store.remove(id)
    this.errors.delete(id)
    this.verifiedActiveStates.delete(id)
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    this.logger.info(
      `event=optional_capability_uninstall capability=${id} stage=completed status=succeeded`,
    )
    return { success: true, message: '可选能力已卸载', snapshot }
  }

  async reportRuntimeFailure(
    id: OptionalCapabilityId,
    cause: unknown,
  ): Promise<OptionalCapabilitySnapshot> {
    const definition = getOptionalCapabilityDefinition(id)
    const failure: CapabilityErrorState = {
      code: 'package_invalid',
      message: `${definition.displayName}运行验证失败：原生 Runtime 无法加载，请更新或修复组件`,
      retryable: true,
    }
    const active = await this.store.read(id)
    if (active) {
      await this.store.write({
        ...active,
        runtimeFailure: {
          ...failure,
          reportedAt: this.now().toISOString(),
        },
      })
    }
    this.verifiedActiveStates.delete(id)
    this.logger.warn(
      `event=optional_capability_health capability=${id} stage=runtime_probe status=failed code=package_invalid error=${safeDiagnostic(cause)}`,
    )
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    return snapshot
  }

  async setAutoUpdate(
    id: OptionalCapabilityId,
    enabled: boolean,
  ): Promise<OptionalCapabilitySnapshot> {
    if (isExternalCapabilityId(id)) {
      this.externalAutoUpdates.set(id, enabled)
      await this.store.writeAutoUpdate(id, enabled)
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return snapshot
    }
    const active = await this.store.read(id)
    if (active) await this.store.write({ ...active, autoUpdate: enabled })
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    return snapshot
  }

  async getArtifactDirectory(
    id: OptionalCapabilityId,
    artifactIdPrefix: string,
  ): Promise<string | null> {
    const active = await this.store.read(id)
    if (!active) return null
    const stateKey = activeStateKey(active)
    if (this.verifiedActiveStates.get(id) !== stateKey) {
      if (
        !(await validateActiveState(
          active,
          this.store.capabilityRoot(id),
          this.options.platform,
          this.options.arch,
        ))
      ) {
        this.logger.warn(
          `event=optional_capability_health capability=${id} stage=active_check status=failed code=package_invalid`,
        )
        return null
      }
      this.verifiedActiveStates.set(id, stateKey)
    }
    const match = Object.entries(active.artifacts).find(([artifactId]) =>
      artifactId.startsWith(artifactIdPrefix),
    )
    return match?.[1].directory ?? null
  }

  private enqueueInstall(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    const existing = this.installs.get(id)
    if (existing) return existing

    const definition = getOptionalCapabilityDefinition(id)
    const controller = new AbortController()
    this.controllers.set(id, controller)
    this.queuedJobs += 1
    this.emitProgress(id, definition.displayName, 'queued', 0, 0, this.queuedJobs, '等待安装')
    const job = this.queueTail.then(async () => {
      this.queuedJobs = Math.max(0, this.queuedJobs - 1)
      return this.performInstall(id, controller.signal)
    })
    this.queueTail = job.then(
      () => undefined,
      () => undefined,
    )
    this.installs.set(id, job)
    void job
      .finally(() => {
        this.installs.delete(id)
        this.controllers.delete(id)
      })
      .catch(() => undefined)
    return job
  }

  private async performInstall(
    id: OptionalCapabilityId,
    signal: AbortSignal,
  ): Promise<OptionalCapabilityMutationResponse> {
    const definition = getOptionalCapabilityDefinition(id)
    let stagingRoot: string | null = null
    let backupRoot: string | null = null
    try {
      throwIfAborted(signal, definition.displayName)
      this.logger.info(
        `event=optional_capability_install capability=${id} stage=started status=running`,
      )
      if (definition.source === 'external') {
        return await this.performExternalInstall(id as ExternalCapabilityId, signal)
      }
      const manifest = await this.refreshManifest().catch((error) => {
        throw capabilityError(
          'manifest_unavailable',
          `${definition.displayName}安装失败：无法连接组件仓库，请检查网络后重试`,
          true,
          error,
        )
      })
      throwIfAborted(signal, definition.displayName)
      const artifacts = definition.selectArtifacts(
        manifest,
        this.options.platform,
        this.options.arch,
      )
      if (artifacts.length === 0) {
        throw capabilityError(
          'artifact_unavailable',
          `${definition.displayName}安装失败：当前平台暂无可用制品`,
          false,
        )
      }
      try {
        validateArtifacts(artifacts, manifest)
      } catch (error) {
        throw capabilityError(
          'artifact_invalid',
          `${definition.displayName}安装失败：远程制品清单无效`,
          false,
          error,
        )
      }
      const version = capabilityVersion(artifacts)
      const capabilityRoot = this.store.capabilityRoot(id)
      stagingRoot = join(capabilityRoot, `.staging-${randomUUID()}`)
      const targetRoot = join(capabilityRoot, 'versions', safeSegment(version))
      backupRoot = `${targetRoot}.backup-${randomUUID()}`
      await mkdir(stagingRoot, { recursive: true })

      const total = artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0)
      let completed = 0
      const installedArtifacts = new Map<string, { size: number; manifestSha256: string }>()
      for (const artifact of artifacts) {
        throwIfAborted(signal, definition.displayName)
        const destination = join(stagingRoot, safeSegment(artifact.id))
        this.emitProgress(
          id,
          definition.displayName,
          'downloading',
          completed,
          total,
          0,
          `正在下载 ${artifact.name}`,
          version,
        )
        try {
          await this.installArchive({
            url: resolveArtifactUrl(manifest, artifact),
            ...(artifact.fallbackUrls?.length
              ? {
                  fallbackUrls: artifact.fallbackUrls.map((url) =>
                    resolveArtifactUrlString(manifest, url),
                  ),
                }
              : {}),
            ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
            ...(artifact.archive?.format ? { format: artifact.archive.format } : {}),
            ...(artifact.archive?.contentRoot != null
              ? { contentRoot: artifact.archive.contentRoot }
              : {}),
            destDir: destination,
            signal,
            onStage: (stage) => {
              if (stage === 'downloading') return
              this.emitProgress(
                id,
                definition.displayName,
                stage,
                completed,
                total,
                0,
                stage === 'verifying' ? `正在校验 ${artifact.name}` : `正在解压 ${artifact.name}`,
                version,
              )
            },
            onProgress: (downloaded, reportedTotal) =>
              this.emitProgress(
                id,
                definition.displayName,
                'downloading',
                Math.min(total, completed + downloaded),
                total || reportedTotal,
                0,
                `正在下载 ${artifact.name}`,
                version,
              ),
          })
          throwIfAborted(signal, definition.displayName)
        } catch (error) {
          throwIfAborted(signal, definition.displayName)
          throw capabilityError(
            'download_failed',
            `${definition.displayName}安装失败：下载或解压制品失败，请检查网络后重试`,
            true,
            error,
          )
        }
        completed += artifact.size ?? 0
        try {
          this.emitProgress(
            id,
            definition.displayName,
            'verifying',
            completed,
            total,
            0,
            `正在校验 ${artifact.name} 的包内文件`,
            version,
          )
          installedArtifacts.set(
            artifact.id,
            await validateInstalledArtifact(destination, id, artifact),
          )
        } catch (error) {
          throw capabilityError(
            'package_invalid',
            `${definition.displayName}安装失败：组件缺少必需文件或完整性校验未通过，请重试安装`,
            true,
            error,
          )
        }
      }

      this.emitProgress(
        id,
        definition.displayName,
        'verifying',
        total,
        total,
        0,
        '正在校验完整性',
        version,
      )
      await mkdir(dirname(targetRoot), { recursive: true })
      let backedUp = false
      try {
        throwIfAborted(signal, definition.displayName)
        await access(targetRoot)
        await rename(targetRoot, backupRoot)
        backedUp = true
      } catch {
        // No version with the same identifier is active on disk.
      }
      try {
        this.emitProgress(
          id,
          definition.displayName,
          'activating',
          total,
          total,
          0,
          '正在激活新版本',
          version,
        )
        await rename(stagingRoot, targetRoot)
        stagingRoot = null
        const previous = await this.store.read(id)
        const state: ActiveCapabilityState = {
          schemaVersion: 1,
          capabilityId: id,
          version,
          autoUpdate: previous?.autoUpdate ?? true,
          activatedAt: this.now().toISOString(),
          artifacts: Object.fromEntries(
            artifacts.map((artifact) => {
              if (!artifact.sha256 || !artifact.size) {
                throw new Error(`可选能力制品元数据缺失：${artifact.id}`)
              }
              const installed = installedArtifacts.get(artifact.id)
              if (!installed) throw new Error(`可选能力制品校验结果缺失：${artifact.id}`)
              return [
                artifact.id,
                {
                  version: artifact.version,
                  sha256: artifact.sha256,
                  manifestSha256: installed.manifestSha256,
                  directory: join(targetRoot, safeSegment(artifact.id)),
                  size: installed.size,
                },
              ]
            }),
          ),
        }
        await this.store.write(state)
        if (backedUp) await rm(backupRoot, { recursive: true, force: true })
      } catch (error) {
        if (backedUp) {
          await rm(targetRoot, { recursive: true, force: true }).catch(() => undefined)
          await rename(backupRoot, targetRoot).catch(() => undefined)
        }
        if (error instanceof OptionalCapabilityInstallError) throw error
        throw capabilityError(
          'activation_failed',
          `${definition.displayName}安装失败：无法激活新版本，原版本已保留`,
          true,
          error,
        )
      }

      this.errors.delete(id)
      this.logger.info(
        `event=optional_capability_install capability=${id} stage=ready status=succeeded version=${version}`,
      )
      this.emitProgress(id, definition.displayName, 'ready', total, total, 0, '安装完成', version)
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return { success: true, message: `${definition.displayName}安装完成`, snapshot }
    } catch (error) {
      const failure = normalizeCapabilityError(error, definition.displayName)
      if (failure.code === 'cancelled') this.errors.delete(id)
      else this.errors.set(id, failure)
      this.logger.warn(
        `event=optional_capability_install capability=${id} stage=error status=failed code=${failure.code} error=${safeDiagnostic(
          failure.cause ?? failure.message,
        )}`,
      )
      this.emitProgress(
        id,
        definition.displayName,
        failure.code === 'cancelled' ? 'cancelled' : 'error',
        0,
        0,
        0,
        failure.message,
        undefined,
        failure.code,
        failure.retryable,
      )
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return {
        success: false,
        message: failure.message,
        errorCode: failure.code,
        snapshot,
      }
    } finally {
      if (stagingRoot)
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      if (backupRoot) await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async refreshManifest(): Promise<SparkInstallManifest> {
    try {
      const manifest = await this.fetchManifest()
      this.manifest = manifest
      this.manifestCheckedAt = this.now()
      this.manifestAvailable = true
      await this.store
        .writeManifestCache({
          schemaVersion: 1,
          checkedAt: this.manifestCheckedAt.toISOString(),
          manifest,
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to persist optional capability manifest cache: ${safeDiagnostic(error)}`,
          )
        })
      return manifest
    } catch (error) {
      this.manifestAvailable = false
      throw error
    }
  }

  private async loadManifestCache(): Promise<void> {
    if (this.manifestCacheLoaded) return
    this.manifestCacheLoaded = true
    const cached = await this.store.readManifestCache().catch((error) => {
      this.logger.warn(
        `Ignoring invalid optional capability manifest cache: ${safeDiagnostic(error)}`,
      )
      return null
    })
    if (!cached) return
    const checkedAt = new Date(cached.checkedAt)
    if (!Number.isFinite(checkedAt.getTime())) return
    this.manifest = cached.manifest
    this.manifestCheckedAt = checkedAt
    // A disk cache avoids redundant startup traffic but is not evidence that the network is live.
    this.manifestAvailable = false
  }

  private async buildSnapshot(): Promise<OptionalCapabilitySnapshot> {
    const capabilities = await Promise.all(
      OPTIONAL_CAPABILITY_DEFINITIONS.map(async (definition): Promise<OptionalCapabilityItem> => {
        if (definition.source === 'external') {
          const externalId = definition.id as ExternalCapabilityId
          const description = await this.describeExternalCapability(externalId)
          const externalError = this.errors.get(externalId)
          const autoUpdate =
            this.externalAutoUpdates.get(externalId) ??
            (await this.store.readAutoUpdate(externalId)) ??
            defaultAutoUpdateForCapability(externalId)
          this.externalAutoUpdates.set(externalId, autoUpdate)
          return {
            id: externalId,
            displayName: definition.displayName,
            description: definition.description,
            ...description,
            ...(externalError
              ? {
                  state: 'error' as const,
                  error: externalError.message,
                  errorCode: externalError.code,
                  retryable: externalError.retryable,
                }
              : {}),
            autoUpdate,
            cancellable: definition.cancellable,
            supportsUninstall: definition.supportsUninstall,
          }
        }
        const active = await this.store.read(definition.id).catch(() => null)
        const artifacts = this.manifest
          ? definition.selectArtifacts(this.manifest, this.options.platform, this.options.arch)
          : []
        const targetVersion = artifacts.length > 0 ? capabilityVersion(artifacts) : null
        const downloadSize = artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0)
        const runtimeFailure = active?.runtimeFailure
        const error = runtimeFailure ?? this.errors.get(definition.id)
        let state: OptionalCapabilityPhase = active ? 'ready' : 'missing'
        if (active) {
          const valid = await validateActiveState(
            active,
            this.store.capabilityRoot(definition.id),
            this.options.platform,
            this.options.arch,
          )
          if (valid) {
            this.verifiedActiveStates.set(definition.id, activeStateKey(active))
            if (runtimeFailure) state = 'damaged'
            else if (targetVersion && targetVersion !== active.version) state = 'update_available'
          } else {
            this.verifiedActiveStates.delete(definition.id)
            state = 'damaged'
          }
        } else if (error) state = 'error'
        return {
          id: definition.id,
          displayName: definition.displayName,
          description: definition.description,
          state,
          installedVersion: active?.version ?? null,
          targetVersion,
          downloadSize,
          installedSize: active
            ? Object.values(active.artifacts).reduce((sum, artifact) => sum + artifact.size, 0)
            : null,
          autoUpdate: active?.autoUpdate ?? true,
          cancellable: definition.cancellable,
          supportsUninstall: definition.supportsUninstall,
          ...(error
            ? { error: error.message, errorCode: error.code, retryable: error.retryable }
            : {}),
        }
      }),
    )
    return {
      capabilities,
      checkedAt: this.now().toISOString(),
      manifestUpdatedAt: this.manifest?.updatedAt || null,
      remoteAvailable: this.manifestAvailable,
    }
  }

  private async describeExternalCapability(
    id: ExternalCapabilityId,
  ): Promise<ExternalCapabilityDescription> {
    const adapter = this.externalAdapters[id]
    if (!adapter) {
      return {
        state: 'missing',
        installedVersion: null,
        targetVersion: null,
        downloadSize: 0,
        installedSize: null,
      }
    }
    try {
      return await adapter.describe({
        manifest: this.manifest ?? emptyManifest(),
        platform: this.options.platform,
        arch: this.options.arch,
        signal: new AbortController().signal,
      })
    } catch (error) {
      return {
        state: 'error',
        installedVersion: null,
        targetVersion: null,
        downloadSize: 0,
        installedSize: null,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'internal_error',
        retryable: true,
      }
    }
  }

  private async performExternalInstall(
    id: ExternalCapabilityId,
    signal: AbortSignal,
  ): Promise<OptionalCapabilityMutationResponse> {
    const definition = getOptionalCapabilityDefinition(id)
    const adapter = this.externalAdapters[id]
    if (!adapter) {
      const message = `${definition.displayName}安装适配器尚未注册`
      const snapshot = await this.buildSnapshot()
      return { success: false, message, errorCode: 'internal_error', snapshot }
    }
    let manifest = this.manifest ?? emptyManifest()
    try {
      manifest = await this.refreshManifest()
    } catch {
      // Chromium can install from the already bundled Playwright package without
      // the Spark artifact manifest. Other adapters will report a precise
      // artifact-unavailable error from their own selector.
    }
    try {
      const result = await adapter.install(
        {
          manifest,
          platform: this.options.platform,
          arch: this.options.arch,
          signal,
        },
        (phase, downloaded, total, message, version) =>
          this.emitProgress(
            id,
            definition.displayName,
            phase,
            downloaded,
            total,
            0,
            message,
            version,
          ),
      )
      if (!result.success) {
        this.errors.set(id, {
          code: result.errorCode ?? 'internal_error',
          message: result.message,
          retryable: result.retryable ?? true,
        })
        this.emitProgress(
          id,
          definition.displayName,
          'error',
          0,
          0,
          0,
          result.message,
          undefined,
          result.errorCode ?? 'internal_error',
          result.retryable ?? true,
        )
      } else {
        this.errors.delete(id)
        this.emitProgress(id, definition.displayName, 'ready', 0, 0, 0, result.message)
      }
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return {
        success: result.success,
        message: result.message,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        snapshot,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure: CapabilityErrorState = {
        code: 'internal_error',
        message: `${definition.displayName}安装失败：${message}`,
        retryable: true,
      }
      this.errors.set(id, failure)
      this.emitProgress(
        id,
        definition.displayName,
        'error',
        0,
        0,
        0,
        failure.message,
        undefined,
        failure.code,
        failure.retryable,
      )
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return { success: false, message: failure.message, errorCode: failure.code, snapshot }
    }
  }

  private emitProgress(
    capabilityId: OptionalCapabilityId,
    displayName: string,
    phase: OptionalCapabilityPhase,
    downloaded: number,
    total: number,
    queuePosition: number,
    message: string,
    version?: string,
    errorCode?: OptionalCapabilityErrorCode,
    retryable?: boolean,
  ): void {
    const progress: OptionalCapabilityProgress = {
      capabilityId,
      displayName,
      phase,
      downloaded,
      total,
      percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
      queuePosition,
      message,
      ...(version ? { version } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(retryable != null ? { retryable } : {}),
    }
    this.onProgress?.(progress)
    for (const listener of this.progressListeners) listener(progress)
  }
}

function validateArtifacts(
  artifacts: SparkInstallArtifact[],
  manifest: SparkInstallManifest,
): void {
  for (const artifact of artifacts) {
    if (!/^[0-9a-f]{64}$/i.test(artifact.sha256 ?? '')) {
      throw new Error(`${artifact.id} 缺少有效的 SHA-256`)
    }
    if (!Number.isSafeInteger(artifact.size) || (artifact.size ?? 0) <= 0) {
      throw new Error(`${artifact.id} 缺少有效的归档大小`)
    }
    if (artifact.archive?.format !== 'tar.gz' && artifact.archive?.format !== 'zip') {
      throw new Error(`${artifact.id} 缺少受支持的归档格式`)
    }
    safeSegment(artifact.id)
    safeSegment(artifact.version)
    for (const url of [
      resolveArtifactUrl(manifest, artifact),
      ...(artifact.fallbackUrls?.map((value) => resolveArtifactUrlString(manifest, value)) ?? []),
    ]) {
      if (new URL(url).protocol !== 'https:') {
        throw new Error(`${artifact.id} 使用了不安全的下载地址`)
      }
    }
  }
}

async function validateInstalledArtifact(
  directory: string,
  capabilityId: OptionalCapabilityId,
  artifact: SparkInstallArtifact,
): Promise<{ size: number; manifestSha256: string }> {
  await validatePackageDirectory(directory, capabilityId, artifact)
  return {
    size: await directorySize(directory),
    manifestSha256: await sha256File(join(directory, packageManifestName(artifact.id))),
  }
}

async function directorySize(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`能力包不能包含符号链接：${entry.name}`)
    }
    if (entry.isDirectory()) total += await directorySize(entryPath)
    else if (entry.isFile()) total += (await lstat(entryPath)).size
  }
  return total
}

async function validatePackageDirectory(
  directory: string,
  capabilityId: OptionalCapabilityId,
  artifact: Pick<SparkInstallArtifact, 'id' | 'type' | 'version' | 'platform' | 'arch'>,
): Promise<void> {
  const { id: artifactId, version } = artifact
  const isModel = artifactId.startsWith('model.')
  const manifestName = packageManifestName(artifactId)
  const parsed = JSON.parse(await readFile(join(directory, manifestName), 'utf8')) as Record<
    string,
    unknown
  >
  if (parsed.schemaVersion !== 1 || parsed.version !== version) {
    throw new Error(`${artifactId} 包内 manifest 版本不匹配`)
  }
  if (!isModel) {
    if (parsed.capabilityId !== capabilityId || parsed.artifactId !== artifactId) {
      throw new Error(`${artifactId} 包内 manifest 身份不匹配`)
    }
  }
  if (!parsed.files || typeof parsed.files !== 'object') {
    throw new Error(`${artifactId} 包内 manifest 缺少文件哈希`)
  }
  validateCapabilityPackageHealth(capabilityId, artifact, parsed)
  for (const [relativePath, expectedHash] of Object.entries(parsed.files)) {
    if (!/^[0-9a-f]{64}$/i.test(String(expectedHash))) {
      throw new Error(`${artifactId} 包内文件哈希无效：${relativePath}`)
    }
    const filePath = safePackageFile(directory, relativePath)
    await assertNoSymlinkEscape(directory, filePath, relativePath)
    const actualHash = await sha256File(filePath)
    if (actualHash !== String(expectedHash).toLowerCase()) {
      throw new Error(`${artifactId} 文件 SHA-256 校验失败：${relativePath}`)
    }
  }
}

async function assertNoSymlinkEscape(
  directory: string,
  filePath: string,
  relativePath: string,
): Promise<void> {
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink()) {
    throw new Error(`能力包文件不能是符号链接：${relativePath}`)
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(directory),
    realpath(filePath),
  ])
  if (!canonicalFile.startsWith(canonicalRoot + sep)) {
    throw new Error(`能力包文件通过符号链接逃逸：${relativePath}`)
  }
}

async function validateActiveState(
  state: ActiveCapabilityState,
  capabilityRoot: string,
  platform: SupportedDesktopPlatform,
  arch: SupportedDesktopArch,
): Promise<boolean> {
  try {
    for (const [artifactId, artifact] of Object.entries(state.artifacts)) {
      if (basename(artifact.directory) !== safeSegment(artifactId)) return false
      if (!isSamePathOrChild(resolve(artifact.directory), resolve(capabilityRoot))) return false
      const manifestHash = await sha256File(
        join(artifact.directory, packageManifestName(artifactId)),
      )
      if (manifestHash !== artifact.manifestSha256) return false
      await validatePackageDirectory(artifact.directory, state.capabilityId, {
        id: artifactId,
        type: artifactId.startsWith('model.')
          ? 'model'
          : artifactId.startsWith('runtime.')
            ? 'runtime'
            : 'archive',
        version: artifact.version,
        ...(artifactId.startsWith('runtime.') ? { platform, arch } : {}),
      })
    }
    return true
  } catch {
    return false
  }
}

function isSamePathOrChild(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep)
}

function activeStateKey(state: ActiveCapabilityState): string {
  return JSON.stringify([
    state.activatedAt,
    state.version,
    Object.entries(state.artifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([artifactId, artifact]) => [
        artifactId,
        artifact.version,
        artifact.sha256,
        artifact.manifestSha256,
        artifact.directory,
        artifact.size,
      ]),
  ])
}

class OptionalCapabilityInstallError extends Error {
  constructor(
    readonly code: OptionalCapabilityErrorCode,
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'OptionalCapabilityInstallError'
  }
}

function capabilityError(
  code: OptionalCapabilityErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): OptionalCapabilityInstallError {
  return new OptionalCapabilityInstallError(code, message, retryable, cause)
}

function normalizeCapabilityError(
  error: unknown,
  displayName: string,
): OptionalCapabilityInstallError {
  if (error instanceof OptionalCapabilityInstallError) return error
  return capabilityError(
    'internal_error',
    `${displayName}安装失败：发生内部错误，请重试或前往完整性页修复`,
    true,
    error,
  )
}

function throwIfAborted(signal: AbortSignal, displayName: string): void {
  if (signal.aborted) {
    throw capabilityError('cancelled', `${displayName}安装已取消`, true)
  }
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown error')
  return raw.replace(/https?:\/\/[^\s]+/gi, (value) => {
    try {
      const url = new URL(value)
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return '[redacted-url]'
    }
  })
}

function safePackageFile(directory: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\\')) {
    throw new Error(`能力包包含不安全路径：${relativePath}`)
  }
  const root = resolve(directory)
  const filePath = resolve(root, relativePath)
  if (!filePath.startsWith(root + sep)) {
    throw new Error(`能力包包含不安全路径：${relativePath}`)
  }
  return filePath
}

function packageManifestName(artifactId: string): string {
  return artifactId.startsWith('model.') ? 'model-package.json' : 'capability-package.json'
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolvePromise)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

function capabilityVersion(artifacts: SparkInstallArtifact[]): string {
  return artifacts.map((artifact) => artifact.version).join('+')
}

function safeSegment(value: string): string {
  if (!/^[0-9A-Za-z@._+-]+$/.test(value)) {
    throw new Error(`不安全的能力包路径片段：${value}`)
  }
  return value
}

function isExternalCapabilityId(id: OptionalCapabilityId): id is ExternalCapabilityId {
  return id === 'codex-runtime' || id === 'ffmpeg' || id === 'chromium' || id === 'voice-pack'
}

function emptyManifest(): SparkInstallManifest {
  return { schemaVersion: 1, updatedAt: '', artifacts: [] }
}
