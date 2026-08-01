import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  OptionalCapabilityId,
  OptionalCapabilityItem,
  OptionalCapabilityMutationResponse,
  OptionalCapabilityPhase,
  OptionalCapabilityProgress,
  OptionalCapabilitySnapshot,
} from '@spark/protocol'
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
  OptionalCapabilityStateStore,
  type ActiveCapabilityState,
} from './OptionalCapabilityStateStore.js'

type InstallArchive = (
  params: BinaryArchiveInstallParams,
) => Promise<BinaryArchiveInstallResult>

export interface OptionalCapabilityManagerOptions {
  userDataDir: string
  platform: SupportedDesktopPlatform
  arch: SupportedDesktopArch
  fetchManifest?: typeof fetchSparkInstallManifest
  installArchive?: InstallArchive
  now?: () => Date
  onProgress?: (progress: OptionalCapabilityProgress) => void
  onSnapshot?: (snapshot: OptionalCapabilitySnapshot) => void
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
  private readonly errors = new Map<OptionalCapabilityId, string>()
  private queueTail: Promise<void> = Promise.resolve()
  private queuedJobs = 0
  private manifest: SparkInstallManifest | null = null
  private manifestAvailable = false

  constructor(private readonly options: OptionalCapabilityManagerOptions) {
    this.root = join(options.userDataDir, 'optional-capabilities')
    this.store = new OptionalCapabilityStateStore(this.root)
    this.fetchManifest = options.fetchManifest ?? fetchSparkInstallManifest
    this.installArchive = options.installArchive ?? installBinaryArchive
    this.now = options.now ?? (() => new Date())
    this.onProgress = options.onProgress
    this.onSnapshot = options.onSnapshot
  }

  async list(): Promise<OptionalCapabilitySnapshot> {
    if (!this.manifest) await this.refreshManifest().catch(() => undefined)
    return this.buildSnapshot()
  }

  async check(forceRemote = false): Promise<OptionalCapabilitySnapshot> {
    if (forceRemote || !this.manifest) await this.refreshManifest().catch(() => undefined)
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    for (const capability of snapshot.capabilities) {
      if (capability.state === 'update_available' && capability.autoUpdate) {
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

  async uninstall(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    await this.store.remove(id)
    this.errors.delete(id)
    const snapshot = await this.buildSnapshot()
    this.onSnapshot?.(snapshot)
    return { success: true, message: '可选能力已卸载', snapshot }
  }

  async setAutoUpdate(
    id: OptionalCapabilityId,
    enabled: boolean,
  ): Promise<OptionalCapabilitySnapshot> {
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
    const match = Object.entries(active.artifacts).find(([artifactId]) =>
      artifactId.startsWith(artifactIdPrefix),
    )
    return match?.[1].directory ?? null
  }

  private enqueueInstall(id: OptionalCapabilityId): Promise<OptionalCapabilityMutationResponse> {
    const existing = this.installs.get(id)
    if (existing) return existing

    const definition = getOptionalCapabilityDefinition(id)
    this.queuedJobs += 1
    this.emitProgress(id, definition.displayName, 'queued', 0, 0, this.queuedJobs, '等待安装')
    const job = this.queueTail.then(async () => {
      this.queuedJobs = Math.max(0, this.queuedJobs - 1)
      return this.performInstall(id)
    })
    this.queueTail = job.then(
      () => undefined,
      () => undefined,
    )
    this.installs.set(id, job)
    void job.finally(() => this.installs.delete(id)).catch(() => undefined)
    return job
  }

  private async performInstall(
    id: OptionalCapabilityId,
  ): Promise<OptionalCapabilityMutationResponse> {
    const definition = getOptionalCapabilityDefinition(id)
    let stagingRoot: string | null = null
    let backupRoot: string | null = null
    let targetRoot: string | null = null
    try {
      const manifest = await this.refreshManifest()
      const artifacts = definition.selectArtifacts(manifest, this.options.platform, this.options.arch)
      if (artifacts.length === 0) {
        throw new Error(`当前平台没有可用的${definition.displayName}制品`)
      }
      validateArtifacts(artifacts)
      const version = capabilityVersion(artifacts)
      const capabilityRoot = this.store.capabilityRoot(id)
      stagingRoot = join(capabilityRoot, `.staging-${randomUUID()}`)
      targetRoot = join(capabilityRoot, 'versions', safeSegment(version))
      backupRoot = `${targetRoot}.backup-${randomUUID()}`
      await mkdir(stagingRoot, { recursive: true })

      const total = artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0)
      let completed = 0
      for (const artifact of artifacts) {
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
        completed += artifact.size ?? 0
        this.emitProgress(
          id,
          definition.displayName,
          'extracting',
          completed,
          total,
          0,
          `正在解压 ${artifact.name}`,
          version,
        )
        await validateInstalledArtifact(destination, id, artifact)
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
            artifacts.map((artifact) => [
              artifact.id,
              {
                version: artifact.version,
                sha256: artifact.sha256!,
                directory: join(targetRoot!, safeSegment(artifact.id)),
                size: artifact.size!,
              },
            ]),
          ),
        }
        await this.store.write(state)
        if (backedUp) await rm(backupRoot, { recursive: true, force: true })
      } catch (error) {
        if (backedUp) {
          await rm(targetRoot, { recursive: true, force: true }).catch(() => undefined)
          await rename(backupRoot, targetRoot).catch(() => undefined)
        }
        throw error
      }

      this.errors.delete(id)
      this.emitProgress(
        id,
        definition.displayName,
        'ready',
        total,
        total,
        0,
        '安装完成',
        version,
      )
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return { success: true, message: `${definition.displayName}安装完成`, snapshot }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.errors.set(id, message)
      this.emitProgress(id, definition.displayName, 'error', 0, 0, 0, message)
      const snapshot = await this.buildSnapshot()
      this.onSnapshot?.(snapshot)
      return { success: false, message, snapshot }
    } finally {
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      if (backupRoot) await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async refreshManifest(): Promise<SparkInstallManifest> {
    try {
      const manifest = await this.fetchManifest()
      this.manifest = manifest
      this.manifestAvailable = true
      return manifest
    } catch (error) {
      this.manifestAvailable = false
      throw error
    }
  }

  private async buildSnapshot(): Promise<OptionalCapabilitySnapshot> {
    const capabilities = await Promise.all(
      OPTIONAL_CAPABILITY_DEFINITIONS.map(async (definition): Promise<OptionalCapabilityItem> => {
        const active = await this.store.read(definition.id).catch(() => null)
        const artifacts = this.manifest
          ? definition.selectArtifacts(this.manifest, this.options.platform, this.options.arch)
          : []
        const targetVersion = artifacts.length > 0 ? capabilityVersion(artifacts) : null
        const downloadSize = artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0)
        const error = this.errors.get(definition.id)
        let state: OptionalCapabilityPhase = active ? 'ready' : 'missing'
        if (active && !(await validateActiveState(active))) state = 'damaged'
        else if (active && targetVersion && targetVersion !== active.version) state = 'update_available'
        else if (error && !active) state = 'error'
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
          ...(error ? { error, retryable: true } : {}),
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

  private emitProgress(
    capabilityId: OptionalCapabilityId,
    displayName: string,
    phase: OptionalCapabilityPhase,
    downloaded: number,
    total: number,
    queuePosition: number,
    message: string,
    version?: string,
  ): void {
    this.onProgress?.({
      capabilityId,
      displayName,
      phase,
      downloaded,
      total,
      percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
      queuePosition,
      message,
      ...(version ? { version } : {}),
      ...(phase === 'error' ? { retryable: true } : {}),
    })
  }
}

function validateArtifacts(artifacts: SparkInstallArtifact[]): void {
  for (const artifact of artifacts) {
    if (!/^[0-9a-f]{64}$/i.test(artifact.sha256 ?? '')) {
      throw new Error(`${artifact.id} 缺少有效的 SHA-256`)
    }
    if (!Number.isSafeInteger(artifact.size) || (artifact.size ?? 0) <= 0) {
      throw new Error(`${artifact.id} 缺少有效的归档大小`)
    }
    safeSegment(artifact.id)
    safeSegment(artifact.version)
  }
}

async function validateInstalledArtifact(
  directory: string,
  capabilityId: OptionalCapabilityId,
  artifact: SparkInstallArtifact,
): Promise<void> {
  await validatePackageDirectory(directory, capabilityId, artifact.id, artifact.version)
}

async function validatePackageDirectory(
  directory: string,
  capabilityId: OptionalCapabilityId,
  artifactId: string,
  version: string,
): Promise<void> {
  const isModel = artifactId.startsWith('model.')
  const manifestName = isModel ? 'model-package.json' : 'capability-package.json'
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

async function validateActiveState(state: ActiveCapabilityState): Promise<boolean> {
  try {
    for (const [artifactId, artifact] of Object.entries(state.artifacts)) {
      if (basename(artifact.directory) !== safeSegment(artifactId)) return false
      await validatePackageDirectory(
        artifact.directory,
        state.capabilityId,
        artifactId,
        artifact.version,
      )
    }
    return true
  } catch {
    return false
  }
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
