import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  SUB_APP_PACKAGE_MAX_BYTES,
  SUB_APP_PACKAGE_MAX_FILE_BYTES,
  SUB_APP_PACKAGE_MAX_FILES,
  SubAppPackageManifestSchema,
  SubAppProjectPathSchema,
  type SubAppPackageDescriptor,
  type SubAppPackageDiagnostic,
  type SubAppPackageManifest,
  type SubAppPackageValidationResult,
  type SubAppProjectFile,
  type SubAppProjectStatus,
} from '@spark/protocol'
import type { SparkDatabase } from './database.js'
import { SubAppPlatformRepository } from './repositories/sub-app-platform.repository.js'
import { SubAppRepository, SubAppStateError } from './repositories/sub-app.repository.js'

const MANIFEST_FILE = 'spark-app.json'

export interface SubAppPackageServiceOptions {
  rootDir?: string
}

export class SubAppPackageService {
  readonly rootDir: string
  private readonly platform: SubAppPlatformRepository
  private readonly apps: SubAppRepository

  constructor(
    private readonly database: SparkDatabase,
    options: SubAppPackageServiceOptions = {},
  ) {
    this.rootDir = options.rootDir ?? path.join(path.dirname(database.path), 'sub-app-platform')
    this.platform = new SubAppPlatformRepository(database)
    this.apps = new SubAppRepository(database)
  }

  async scaffold(input: {
    name: string
    description?: string
    icon?: string | null
    surface?: SubAppPackageManifest['surface']
    template?: 'frontend' | 'fullstack'
  }): Promise<{ appId: string; draftRevision: number; project: SubAppProjectStatus }> {
    const fullstack = input.template === 'fullstack'
    const app = this.apps.create({
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.surface !== undefined ? { surface: input.surface } : {}),
      source: '',
      permissions: fullstack ? ['data', 'backend', 'jobs'] : ['data'],
    })
    const manifest: SubAppPackageManifest = {
      schemaVersion: 2,
      name: input.name,
      ...(input.description != null ? { description: input.description } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      surface: input.surface ?? 'content',
      frontend: { entry: 'frontend/index.html' },
      ...(fullstack
        ? {
            service: {
              runtime: 'node' as const,
              entry: 'service/main.mjs',
              lifecycle: 'on-demand' as const,
              idleTimeoutSeconds: 300,
              healthAction: 'health',
            },
          }
        : {}),
      permissions: {
        sparkCapabilities: fullstack ? ['data', 'backend', 'jobs'] : ['data'],
        osEffects: [],
        connections: [],
      },
    }
    const files = new Map<string, Buffer>([
      [MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
      ['frontend/index.html', Buffer.from(scaffoldHtml(input.name, fullstack))],
      ['frontend/styles.css', Buffer.from(scaffoldCss())],
    ])
    if (fullstack) files.set('service/main.mjs', Buffer.from(scaffoldService()))
    await this.writeRevision(app.id, 1, files)
    const draftRevision = this.platform.markDraftAsV2(app.id, app.draftRevision, 1, manifest)
    return { appId: app.id, draftRevision, project: await this.status(app.id) }
  }

  async importProject(
    projectDir: string,
    workspaceRoot: string,
  ): Promise<{ appId: string; draftRevision: number; project: SubAppProjectStatus }> {
    const sourceRoot = await assertWorkspaceDirectory(projectDir, workspaceRoot)
    const files = new Map<string, Buffer>()
    await walkFiles(sourceRoot, async (relative, absolute) => {
      files.set(relative, await fs.readFile(absolute))
    })
    const validation = validatePackageFiles(files)
    if (!validation.readyToPublish || validation.manifest == null) {
      throw new SubAppStateError(
        `V2 项目导入校验失败：${validation.diagnostics
          .filter((item) => item.level === 'error')
          .map((item) => item.message)
          .join('；')}`,
      )
    }
    const manifest = validation.manifest
    const app = this.apps.create({
      name: manifest.name,
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      ...(manifest.icon !== undefined ? { icon: manifest.icon } : {}),
      surface: manifest.surface,
      source: '',
      permissions: manifest.permissions.sparkCapabilities,
    })
    await this.writeRevision(app.id, 1, files)
    const draftRevision = this.platform.markDraftAsV2(app.id, app.draftRevision, 1, manifest)
    return { appId: app.id, draftRevision, project: await this.status(app.id) }
  }

  async migrateV1(appId: string, expectedDraftRevision: number): Promise<SubAppProjectStatus> {
    const app = this.apps.get(appId)
    if (app == null) throw new SubAppStateError('子应用不存在。')
    const format = this.platform.getDraftFormat(appId)
    if (format.format === 'v2') return this.status(appId)
    this.platform.assertAppRevision(appId, expectedDraftRevision)
    if (app.draft.source.trim().length === 0)
      throw new SubAppStateError('V1 草稿源码为空，无法迁移。')
    const manifest: SubAppPackageManifest = {
      schemaVersion: 2,
      name: app.name,
      description: app.description,
      icon: app.icon,
      surface: app.surface,
      frontend: { entry: 'frontend/index.html' },
      permissions: {
        sparkCapabilities: app.draft.manifest.permissions.filter((item) => item !== 'ipc'),
        osEffects: [],
        connections: [],
      },
    }
    const files = new Map<string, Buffer>([
      [MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
      ['frontend/index.html', Buffer.from(app.draft.source)],
    ])
    await this.writeRevision(appId, 1, files)
    try {
      this.platform.markDraftAsV2(appId, expectedDraftRevision, 1, manifest)
    } catch (error) {
      await fs.rm(this.projectRevisionRoot(appId, 1), { recursive: true, force: true })
      throw error
    }
    return this.status(appId)
  }

  async exportProject(
    appId: string,
    workspaceRoot: string,
  ): Promise<{ directory: string; files: number; digest: string }> {
    const format = this.platform.getDraftFormat(appId)
    if (format.projectRevision == null) throw new SubAppStateError('子应用没有 V2 草稿项目。')
    const files = await this.readRevisionFiles(appId, format.projectRevision)
    const exportRoot = path.join(
      workspaceRoot,
      '.spark-agent',
      'sub-app-projects',
      appId,
      `rev-${format.projectRevision}`,
    )
    const resolvedWorkspace = path.resolve(workspaceRoot)
    const resolvedExport = path.resolve(exportRoot)
    if (!resolvedExport.startsWith(`${resolvedWorkspace}${path.sep}`))
      throw new SubAppStateError('导出路径逃逸工作区。')
    const existing = await fs.lstat(exportRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing == null) {
      await this.writeFilesToFreshDirectory(exportRoot, files)
    } else {
      await assertDirectory(exportRoot)
      const exported = new Map<string, Buffer>()
      await walkFiles(exportRoot, async (relative, absolute) => {
        exported.set(relative, await fs.readFile(absolute))
      })
      if (digestFiles(exported) !== digestFiles(files)) {
        throw new SubAppStateError('已存在的导出目录内容与当前草稿不一致，已拒绝覆盖。')
      }
    }
    return { directory: exportRoot, files: files.size, digest: digestFiles(files) }
  }

  async writeFile(input: {
    appId: string
    expectedDraftRevision: number
    filePath: string
    content: string
    encoding?: 'utf8' | 'base64'
  }): Promise<SubAppProjectStatus> {
    const relative = assertPackagePath(input.filePath)
    const bytes = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf8')
    if (bytes.byteLength > SUB_APP_PACKAGE_MAX_FILE_BYTES) {
      throw new SubAppStateError('单个应用包文件不能超过 5 MB。')
    }
    const draft = this.platform.assertAppRevision(input.appId, input.expectedDraftRevision)
    if (draft.draft_format !== 'v2') throw new SubAppStateError('当前草稿不是 V2 受管项目。')
    const format = this.platform.getDraftFormat(input.appId)
    const currentProjectRevision = format.projectRevision
    if (currentProjectRevision == null) throw new SubAppStateError('V2 草稿缺少项目版本。')
    const nextProjectRevision = currentProjectRevision + 1
    const files = await this.readRevisionFiles(input.appId, currentProjectRevision)
    files.set(relative, bytes)
    const validation = validatePackageFiles(files)
    if (validation.manifest == null) {
      throw new SubAppStateError(
        validation.diagnostics.find((item) => item.level === 'error')?.message ??
          'spark-app.json 无效。',
      )
    }
    await this.writeRevision(input.appId, nextProjectRevision, files)
    try {
      this.platform.markDraftAsV2(
        input.appId,
        input.expectedDraftRevision,
        nextProjectRevision,
        validation.manifest,
      )
    } catch (error) {
      await fs.rm(this.projectRevisionRoot(input.appId, nextProjectRevision), {
        recursive: true,
        force: true,
      })
      throw error
    }
    return this.status(input.appId)
  }

  async deleteFile(input: {
    appId: string
    expectedDraftRevision: number
    filePath: string
  }): Promise<SubAppProjectStatus> {
    const relative = assertPackagePath(input.filePath)
    if (relative === MANIFEST_FILE) throw new SubAppStateError('spark-app.json 不能删除。')
    const draft = this.platform.assertAppRevision(input.appId, input.expectedDraftRevision)
    if (draft.draft_format !== 'v2') throw new SubAppStateError('当前草稿不是 V2 受管项目。')
    const format = this.platform.getDraftFormat(input.appId)
    if (format.projectRevision == null) throw new SubAppStateError('V2 草稿缺少项目版本。')
    const files = await this.readRevisionFiles(input.appId, format.projectRevision)
    if (!files.delete(relative)) throw new SubAppStateError('指定的项目文件不存在。')
    const validation = validatePackageFiles(files)
    if (validation.manifest == null) throw new SubAppStateError('spark-app.json 无效。')
    const nextProjectRevision = format.projectRevision + 1
    await this.writeRevision(input.appId, nextProjectRevision, files)
    try {
      this.platform.markDraftAsV2(
        input.appId,
        input.expectedDraftRevision,
        nextProjectRevision,
        validation.manifest,
      )
    } catch (error) {
      await fs.rm(this.projectRevisionRoot(input.appId, nextProjectRevision), {
        recursive: true,
        force: true,
      })
      throw error
    }
    return this.status(input.appId)
  }

  async readFile(appId: string, filePath: string, encoding: 'utf8' | 'base64' = 'utf8') {
    const relative = assertPackagePath(filePath)
    const format = this.platform.getDraftFormat(appId)
    if (format.projectRevision == null) throw new SubAppStateError('子应用没有 V2 草稿项目。')
    const bytes = await fs.readFile(
      path.join(this.projectRevisionRoot(appId, format.projectRevision), relative),
    )
    return {
      path: relative,
      content: bytes.toString(encoding === 'base64' ? 'base64' : 'utf8'),
      encoding,
      byteLength: bytes.byteLength,
    }
  }

  async status(appId: string): Promise<SubAppProjectStatus> {
    const format = this.platform.getDraftFormat(appId)
    if (format.format !== 'v2' || format.projectRevision == null) {
      return {
        appId,
        revision: format.draftRevision,
        files: [],
        manifest: null,
        validation: emptyValidation('SUB_APP_NOT_V2', '当前应用还是 V1 单 HTML 草稿。'),
      }
    }
    const files = await this.readRevisionFiles(appId, format.projectRevision)
    const validation = validatePackageFiles(files)
    return {
      appId,
      revision: format.draftRevision,
      files: await this.describeFiles(appId, format.projectRevision, files),
      manifest: validation.manifest,
      validation,
    }
  }

  async publish(appId: string, expectedDraftRevision: number) {
    this.platform.assertAppRevision(appId, expectedDraftRevision)
    const activeJobs = [
      ...this.platform.listJobs(appId, { status: 'queued', limit: 1 }).items,
      ...this.platform.listJobs(appId, { status: 'running', limit: 1 }).items,
    ]
    if (activeJobs.length > 0) {
      throw new SubAppStateError(
        '子应用存在排队中或运行中的持久任务，为保持 release 一致性，请等待任务结束或取消后再发布。',
      )
    }
    const format = this.platform.getDraftFormat(appId)
    if (format.projectRevision == null) throw new SubAppStateError('子应用没有 V2 草稿项目。')
    const files = await this.readRevisionFiles(appId, format.projectRevision)
    const validation = validatePackageFiles(files)
    if (!validation.readyToPublish || validation.manifest == null) {
      const message = validation.diagnostics
        .filter((item) => item.level === 'error')
        .map((item) => item.message)
        .join('；')
      throw new SubAppStateError(`V2 应用包校验失败：${message}`)
    }
    const digest = digestFiles(files)
    const artifactRoot = path.join(this.artifactsRoot(), digest)
    await this.ensureArtifact(artifactRoot, files)
    const descriptor: SubAppPackageDescriptor = {
      schemaVersion: 2,
      digest,
      byteLength: validation.byteLength,
      fileCount: validation.fileCount,
      frontendEntry: validation.manifest.frontend.entry,
      serviceEntry: validation.manifest.service?.entry ?? null,
      manifest: validation.manifest,
    }
    let published
    try {
      published = this.platform.publishPackage({
        appId,
        expectedDraftRevision,
        descriptor,
        relativePath: path.relative(this.rootDir, artifactRoot).split(path.sep).join('/'),
        buildInfo: {
          builder: 'sparkwork-managed-project',
          projectRevision: format.projectRevision,
        },
      })
    } catch (error) {
      if (!this.platform.hasArtifactDigest(digest)) {
        await fs.rm(artifactRoot, { recursive: true, force: true }).catch(() => {})
      }
      throw error
    }
    return { ...published, details: this.apps.get(appId) }
  }

  async rollback(
    appId: string,
    version: number,
    expectedDraftRevision: number,
  ): Promise<SubAppProjectStatus> {
    const target = this.platform.getPackageByVersion(appId, version)
    if (target == null) throw new SubAppStateError('指定的 V2 发布版本不存在。')
    this.platform.assertAppRevision(appId, expectedDraftRevision)
    const current = this.platform.getDraftFormat(appId)
    const nextProjectRevision = (current.projectRevision ?? 0) + 1
    const root = path.join(this.rootDir, target.relativePath)
    const files = new Map<string, Buffer>()
    await walkFiles(root, async (relative, absolute) => {
      files.set(relative, await fs.readFile(absolute))
    })
    await this.writeRevision(appId, nextProjectRevision, files)
    try {
      this.platform.markDraftAsV2(
        appId,
        expectedDraftRevision,
        nextProjectRevision,
        target.manifest,
      )
    } catch (error) {
      await fs.rm(this.projectRevisionRoot(appId, nextProjectRevision), {
        recursive: true,
        force: true,
      })
      throw error
    }
    return this.status(appId)
  }

  async resolveRuntime(input: { appId: string; releaseId?: string; mode: 'draft' | 'published' }) {
    if (input.mode === 'draft') {
      const format = this.platform.getDraftFormat(input.appId)
      if (format.projectRevision == null) throw new SubAppStateError('子应用没有 V2 草稿项目。')
      const files = await this.readRevisionFiles(input.appId, format.projectRevision)
      const validation = validatePackageFiles(files)
      if (validation.manifest == null) throw new SubAppStateError('V2 manifest 无效。')
      return {
        root: this.projectRevisionRoot(input.appId, format.projectRevision),
        descriptor: {
          schemaVersion: 2 as const,
          digest: digestFiles(files),
          byteLength: validation.byteLength,
          fileCount: validation.fileCount,
          frontendEntry: validation.manifest.frontend.entry,
          serviceEntry: validation.manifest.service?.entry ?? null,
          manifest: validation.manifest,
        },
      }
    }
    const stored =
      input.releaseId == null
        ? this.platform.getPublishedPackage(input.appId)
        : this.platform.getPackageForRelease(input.releaseId)
    if (stored == null) throw new SubAppStateError('指定的 V2 发布制品不存在。')
    const root = path.join(this.rootDir, stored.relativePath)
    await assertDirectory(root)
    await this.verifyArtifact(root, stored.digest)
    const { relativePath: _relativePath, ...descriptor } = stored
    return { root, descriptor }
  }

  async cleanupDeletedApp(appId: string): Promise<void> {
    await fs.rm(path.join(this.rootDir, 'projects', appId), { recursive: true, force: true })
    const orphaned = this.platform.pruneUnreferencedArtifacts()
    await Promise.allSettled(
      orphaned.map((relative) =>
        fs.rm(path.join(this.rootDir, relative), { recursive: true, force: true }),
      ),
    )
  }

  async cleanupOrphanedArtifacts(): Promise<void> {
    const orphaned = this.platform.pruneUnreferencedArtifacts()
    await Promise.allSettled(
      orphaned.map((relative) =>
        fs.rm(path.join(this.rootDir, relative), { recursive: true, force: true }),
      ),
    )
  }

  private async readRevisionFiles(
    appId: string,
    projectRevision: number,
  ): Promise<Map<string, Buffer>> {
    const root = this.projectRevisionRoot(appId, projectRevision)
    const files = new Map<string, Buffer>()
    await walkFiles(root, async (relative, absolute) => {
      files.set(relative, await fs.readFile(absolute))
    })
    return files
  }

  private async describeFiles(
    appId: string,
    projectRevision: number,
    files: Map<string, Buffer>,
  ): Promise<SubAppProjectFile[]> {
    const root = this.projectRevisionRoot(appId, projectRevision)
    return Promise.all(
      [...files.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([filePath, bytes]) => ({
          path: filePath,
          byteLength: bytes.byteLength,
          updatedAt: (await fs.stat(path.join(root, filePath))).mtime.toISOString(),
        })),
    )
  }

  private async writeRevision(
    appId: string,
    revision: number,
    files: Map<string, Buffer>,
  ): Promise<void> {
    const finalRoot = this.projectRevisionRoot(appId, revision)
    const staging = `${finalRoot}.staging-${randomUUID()}`
    await fs.mkdir(staging, { recursive: true })
    try {
      for (const [relative, bytes] of files) {
        const target = path.join(staging, assertPackagePath(relative))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, bytes, { flag: 'wx' })
      }
      await fs.mkdir(path.dirname(finalRoot), { recursive: true })
      await fs.rename(staging, finalRoot)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private async writeFilesToFreshDirectory(
    finalRoot: string,
    files: Map<string, Buffer>,
  ): Promise<void> {
    const staging = `${finalRoot}.staging-${randomUUID()}`
    await fs.mkdir(staging, { recursive: true })
    try {
      for (const [relative, bytes] of files) {
        const target = path.join(staging, assertPackagePath(relative))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, bytes, { flag: 'wx' })
      }
      await fs.mkdir(path.dirname(finalRoot), { recursive: true })
      await fs.rename(staging, finalRoot)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private async ensureArtifact(root: string, files: Map<string, Buffer>): Promise<void> {
    const existing = await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing != null) {
      await assertDirectory(root)
      const expected = digestFiles(files)
      await this.verifyArtifact(root, expected)
      return
    }
    const staging = `${root}.staging-${randomUUID()}`
    await fs.mkdir(staging, { recursive: true })
    try {
      for (const [relative, bytes] of files) {
        const target = path.join(staging, assertPackagePath(relative))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, bytes, { flag: 'wx' })
      }
      await fs.mkdir(path.dirname(root), { recursive: true })
      await fs.rename(staging, root).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
      })
      await this.verifyArtifact(root, digestFiles(files))
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }

  private async verifyArtifact(root: string, expectedDigest: string): Promise<void> {
    const files = new Map<string, Buffer>()
    await walkFiles(root, async (relative, absolute) => {
      files.set(relative, await fs.readFile(absolute))
    })
    if (digestFiles(files) !== expectedDigest) {
      throw new SubAppStateError('子应用发布制品完整性校验失败，已拒绝运行。')
    }
  }

  private projectRevisionRoot(appId: string, revision: number): string {
    return path.join(this.rootDir, 'projects', appId, `rev-${revision}`)
  }

  private artifactsRoot(): string {
    return path.join(this.rootDir, 'artifacts')
  }
}

export function validatePackageFiles(
  files: ReadonlyMap<string, Buffer>,
): SubAppPackageValidationResult {
  const diagnostics: SubAppPackageDiagnostic[] = []
  const byteLength = [...files.values()].reduce((total, value) => total + value.byteLength, 0)
  if (files.size > SUB_APP_PACKAGE_MAX_FILES)
    diagnostics.push(
      errorDiagnostic('PACKAGE_FILE_LIMIT', `应用包文件数超过 ${SUB_APP_PACKAGE_MAX_FILES}。`),
    )
  if (byteLength > SUB_APP_PACKAGE_MAX_BYTES)
    diagnostics.push(errorDiagnostic('PACKAGE_SIZE_LIMIT', '应用包总大小超过 20 MB。'))
  for (const [filePath, value] of files) {
    try {
      assertPackagePath(filePath)
    } catch {
      diagnostics.push(errorDiagnostic('PACKAGE_PATH_INVALID', '应用包包含非法路径。', filePath))
    }
    if (value.byteLength > SUB_APP_PACKAGE_MAX_FILE_BYTES)
      diagnostics.push(errorDiagnostic('PACKAGE_FILE_SIZE_LIMIT', '单文件超过 5 MB。', filePath))
  }
  let manifest: SubAppPackageManifest | null = null
  const manifestBytes = files.get(MANIFEST_FILE)
  if (manifestBytes == null) {
    diagnostics.push(
      errorDiagnostic('MANIFEST_MISSING', '应用包缺少 spark-app.json。', MANIFEST_FILE),
    )
  } else {
    try {
      const parsed = SubAppPackageManifestSchema.safeParse(
        JSON.parse(manifestBytes.toString('utf8')),
      )
      if (parsed.success) manifest = parsed.data as SubAppPackageManifest
      else
        diagnostics.push(
          errorDiagnostic(
            'MANIFEST_INVALID',
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('；'),
            MANIFEST_FILE,
          ),
        )
    } catch {
      diagnostics.push(
        errorDiagnostic('MANIFEST_JSON_INVALID', 'spark-app.json 不是有效 JSON。', MANIFEST_FILE),
      )
    }
  }
  if (manifest != null) {
    const required = [
      manifest.frontend.entry,
      manifest.service?.entry,
      manifest.contracts?.backendActions,
      manifest.contracts?.jobs,
    ].filter((value): value is string => value != null)
    for (const requiredPath of required)
      if (!files.has(requiredPath))
        diagnostics.push(
          errorDiagnostic(
            'PACKAGE_ENTRY_MISSING',
            `manifest 引用的文件不存在：${requiredPath}`,
            requiredPath,
          ),
        )
    if (manifest.service != null && !manifest.permissions.sparkCapabilities.includes('backend'))
      diagnostics.push(
        errorDiagnostic(
          'BACKEND_PERMISSION_MISSING',
          '声明 service 时必须授予 backend 能力。',
          MANIFEST_FILE,
        ),
      )
    if (manifest.permissions.sparkCapabilities.includes('ipc'))
      diagnostics.push(
        errorDiagnostic(
          'RAW_IPC_FORBIDDEN',
          'V2 应用禁止声明 legacy raw ipc，请使用稳定 SDK。',
          MANIFEST_FILE,
        ),
      )
    for (const capability of ['clipboard', 'notifications'] as const) {
      if (manifest.permissions.sparkCapabilities.includes(capability))
        diagnostics.push(
          errorDiagnostic(
            'CAPABILITY_RESERVED',
            `V2 能力 ${capability} 尚未实现，不能发布。`,
            MANIFEST_FILE,
          ),
        )
    }
    for (const slot of manifest.permissions.connections)
      if (manifest.connections?.[slot] == null)
        diagnostics.push(
          errorDiagnostic(
            'CONNECTION_DECLARATION_MISSING',
            `连接权限 ${slot} 没有对应声明。`,
            MANIFEST_FILE,
          ),
        )
    const entryHtml = files.get(manifest.frontend.entry)?.toString('utf8')
    if (entryHtml != null && /(?:src|href)\s*=\s*["']\/(?!\/)/iu.test(entryHtml)) {
      diagnostics.push(
        errorDiagnostic(
          'PACKAGE_ROOT_RESOURCE',
          'V2 包资源必须使用 ./ 或相对路径，不能使用以 / 开头的 origin 根路径。',
          manifest.frontend.entry,
        ),
      )
    }
  }
  const detectedCapabilities = manifest?.permissions.sparkCapabilities ?? []
  const valid = diagnostics.every((item) => item.level !== 'error')
  return {
    valid,
    readyToPublish: valid && manifest != null,
    diagnostics: diagnostics.slice(0, 100),
    detectedCapabilities,
    manifest,
    fileCount: files.size,
    byteLength,
  }
}

export function digestFiles(files: ReadonlyMap<string, Buffer>): string {
  const hash = createHash('sha256')
  for (const [filePath, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(filePath)
    hash.update('\0')
    hash.update(String(bytes.byteLength))
    hash.update('\0')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

export function assertPackagePath(value: string): string {
  const parsed = SubAppProjectPathSchema.safeParse(value.split(path.sep).join('/'))
  if (!parsed.success) throw new SubAppStateError('应用包路径必须是无逃逸的 POSIX 相对路径。')
  return parsed.data
}

async function walkFiles(
  root: string,
  visit: (relative: string, absolute: string) => Promise<void>,
): Promise<void> {
  await assertDirectory(root)
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new SubAppStateError('应用包不允许符号链接。')
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) await visit(assertPackagePath(relative), absolute)
    }
  }
  await walk(root)
}

async function assertDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new SubAppStateError('应用包路径不是安全目录。')
}

async function assertWorkspaceDirectory(directory: string, workspaceRoot: string): Promise<string> {
  const workspace = await fs.realpath(workspaceRoot)
  const candidate = await fs.realpath(path.resolve(workspaceRoot, directory))
  if (candidate !== workspace && !candidate.startsWith(`${workspace}${path.sep}`)) {
    throw new SubAppStateError('项目目录必须位于当前工作区内。')
  }
  await assertDirectory(candidate)
  return candidate
}

function errorDiagnostic(code: string, message: string, file?: string): SubAppPackageDiagnostic {
  return { level: 'error', code, message, ...(file != null ? { file } : {}) }
}

function emptyValidation(code: string, message: string): SubAppPackageValidationResult {
  return {
    valid: false,
    readyToPublish: false,
    diagnostics: [errorDiagnostic(code, message)],
    detectedCapabilities: [],
    manifest: null,
    fileCount: 0,
    byteLength: 0,
  }
}

function scaffoldHtml(name: string, fullstack: boolean): string {
  const action = fullstack
    ? `<button id="health">Check service</button><pre id="output"></pre><script type="module">document.querySelector('#health').onclick=async()=>{const value=await window.sparkApp.backend.invoke('health',{});document.querySelector('#output').textContent=JSON.stringify(value,null,2)}</script>`
    : '<p>Edit this managed project with spark_app_project_write_file.</p>'
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./styles.css"><title>${escapeHtml(name)}</title></head><body><main><h1>${escapeHtml(name)}</h1>${action}</main></body></html>\n`
}

function scaffoldCss(): string {
  return `:root{font-family:system-ui,sans-serif;color:var(--spark-color-text);background:var(--spark-color-bg)}body{margin:0}main{padding:24px}button{font:inherit;padding:8px 12px}\n`
}

function scaffoldService(): string {
  return `export default {\n  async invoke(action, input, context) {\n    if (action === 'health') return { ok: true }\n    if (action === 'run-job') { context.progress(0.5, 'working'); return { input } }\n    throw new Error('Unknown action: ' + action)\n  }\n}\n`
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] as string,
  )
}
