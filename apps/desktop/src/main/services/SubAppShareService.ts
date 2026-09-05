import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  IpcSchemaRegistry,
  SUB_APP_SHARE_FORMAT_VERSION,
  SUB_APP_SOURCE_HARD_LIMIT,
} from '@spark/protocol'
import type {
  SubAppShareCapabilityReport,
  SubAppShareConflictInfo,
  SubAppShareDataEntry,
  SubAppShareImportCheck,
  SubAppSharePackage,
  SubAppSharePackageBody,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { SubAppNotFoundError, SubAppRepository, SubAppStateError } from '@spark/storage'
import type { SubAppFileStore } from './SubAppFileStore.js'

/**
 * 子应用分享包（.sparkapp 单文件 JSON）的打包 / 校验 / 导入服务。
 *
 * 职责边界：
 *   - 本服务不依赖 electron（对话框与平台版本由 IPC 层注入），可独立单测；
 *   - DB 侧导入原子性由 SubAppRepository.importApp 单事务保证；
 *   - 文件空间替换用同卷原子目录交换（target → .old-*，tmp → target），
 *     DB 写入失败时回滚目录，保证两边最终一致；
 *   - 覆盖导入前自动把本机当前应用导出为 .sparkapp 备份（可再导入恢复）。
 */

/** 与 sub-app:runtime:put-doc 的 document 上限对齐：超过则「可存不可跑」。 */
const SUB_APP_SHARE_SOURCE_RUNTIME_LIMIT = 260_000
/** 单文件空间内容上限（与 sub-app:file:write schema 一致）。 */
const SUB_APP_SHARE_FILE_CONTENT_LIMIT = 2_000_000
/** 文件空间文件数上限（与 SubAppFileStore.list 列出上限一致）。 */
const SUB_APP_SHARE_FILE_COUNT_LIMIT = 500
/** data 单条 JSON 上限（与 sub-app:data:upsert / repository 一致）。 */
const SUB_APP_SHARE_DATA_VALUE_LIMIT = 512_000
/** 导入文件体积硬上限：保护主进程内存，正常包远小于此值。 */
const SUB_APP_SHARE_MAX_FILE_BYTES = 128_000_000

export interface SubAppShareServiceOptions {
  repository: SubAppRepository
  fileStore: SubAppFileStore
  /** SubAppFileStore 的根目录（userData/sub-app-files），原子交换在其内进行。 */
  fileStoreRoot: string
  /** 覆盖导入前自动备份（.sparkapp）的落盘目录。 */
  backupsDir: string
  /** 当前平台版本（app.getVersion()），用于导入时的降级警告。 */
  platformVersion: string
}

export interface SubAppShareExportResult {
  body: SubAppSharePackageBody
  /** 完整分享包 JSON 文本（含 integrity），直接写盘即可。 */
  text: string
  counts: { releases: number; dataEntries: number; files: number }
  capabilities: SubAppShareCapabilityReport
  secretWarnings: string[]
}

export interface SubAppSharePreviewResult {
  body: SubAppSharePackageBody
  integrityOk: boolean
  checks: SubAppShareImportCheck[]
  conflict: SubAppShareConflictInfo
  fileName: string
  byteSize: number
}

export interface SubAppShareApplyResult {
  appId: string
  name: string
  publicationStatus: 'draft' | 'published' | 'archived'
  publishedVersion: number | null
  importedReleases: number
  importedDataEntries: number
  importedFiles: number
  backupPath: string | null
  warnings: string[]
}

export class SubAppShareService {
  private readonly repository: SubAppRepository
  private readonly fileStore: SubAppFileStore
  private readonly fileStoreRoot: string
  private readonly backupsDir: string
  private readonly platformVersion: string

  constructor(options: SubAppShareServiceOptions) {
    this.repository = options.repository
    this.fileStore = options.fileStore
    this.fileStoreRoot = options.fileStoreRoot
    this.backupsDir = options.backupsDir
    this.platformVersion = options.platformVersion
  }

  // ─── 导出侧 ───────────────────────────────────────────────────────────────

  /** 打包应用的完整分享包（manifest + 草稿 + 全部版本 + data + 文件空间）。 */
  async buildPackage(
    appId: string,
    options: { includeData?: boolean; includeFiles?: boolean } = {},
  ): Promise<SubAppShareExportResult> {
    const includeData = options.includeData !== false
    const includeFiles = options.includeFiles !== false

    const details = this.repository.get(appId)
    if (details == null) throw new SubAppNotFoundError()

    const releases = this.repository.listAllReleasesFull(appId)
    const releasesOutOfBounds = releases.filter(
      (release) => release.source.length > SUB_APP_SOURCE_HARD_LIMIT,
    )
    if (releasesOutOfBounds.length > 0) {
      throw new SparkError(
        'VALIDATION_FAILED',
        '存在超出源码硬上限的版本，无法导出（数据异常，请联系维护者核查）。',
      )
    }

    let data: SubAppShareDataEntry[] = []
    if (includeData) {
      const page = this.repository.listAllData(appId)
      // 导出不静默截断：超限提示清理或分namespace导出，避免用户拿到缺数据的包。
      if (page.total > page.entries.length) {
        throw new SparkError(
          'VALIDATION_FAILED',
          `应用数据条数（${page.total}）超出单包上限（${page.entries.length}），请先清理数据后重试。`,
        )
      }
      data = page.entries.map((entry) => ({
        namespace: entry.namespace,
        key: entry.key,
        value: entry.value,
      }))
    }

    let files: Array<{ path: string; content: string }> = []
    if (includeFiles) {
      files = await this.collectAppFiles(appId)
    }

    const sourceInputs = [
      { label: '草稿', source: details.draft.source },
      ...releases.map((release) => ({ label: `v${release.version}`, source: release.source })),
    ]
    const capabilities = scanCapabilities(sourceInputs, data)

    const body: SubAppSharePackageBody = {
      formatVersion: SUB_APP_SHARE_FORMAT_VERSION,
      appId: details.id,
      exportedAt: new Date().toISOString(),
      platformVersion: this.platformVersion,
      manifest: details.draft.manifest,
      draft: { source: details.draft.source, config: details.draft.config },
      releases: releases.map((release) => ({
        version: release.version,
        source: release.source,
        config: release.config,
        manifest: release.manifest,
        publishedAt: release.publishedAt,
      })),
      publishedVersion: details.publishedVersion,
      data,
      files,
      capabilities,
    }
    const { text } = serializePackage(body)

    return {
      body,
      text,
      counts: { releases: releases.length, dataEntries: data.length, files: files.length },
      capabilities,
      secretWarnings: describeSecretHints(capabilities.secretHints),
    }
  }

  /**
   * 收集应用文件空间（UTF-8 文本）。不走 SubAppFileStore.list（其 500 条截断
   * 无 total，会导致导出静默丢文件），自行 walk 并给出明确上限。
   */
  private async collectAppFiles(appId: string): Promise<Array<{ path: string; content: string }>> {
    const appRoot = path.resolve(this.fileStoreRoot, appId)
    let relativePaths: string[]
    try {
      await fs.stat(appRoot)
      relativePaths = await this.walkFiles(appRoot, appRoot, 0)
    } catch {
      return []
    }
    const files: Array<{ path: string; content: string }> = []
    for (const relPath of relativePaths) {
      const content = await fs.readFile(path.join(appRoot, relPath), 'utf8')
      files.push({ path: relPath, content })
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    return files
  }

  /** 深度优先收集相对路径；深度/数量双上限，超限直接报错（不静默截断）。 */
  private async walkFiles(
    appRoot: string,
    currentDir: string,
    depth: number,
  ): Promise<Array<string>> {
    if (depth > 8) {
      throw new SparkError('VALIDATION_FAILED', '应用文件空间目录层级过深，无法导出。')
    }
    const dirents = await fs.readdir(currentDir, { withFileTypes: true })
    const out: Array<string> = []
    for (const dirent of dirents) {
      if (out.length >= SUB_APP_SHARE_FILE_COUNT_LIMIT) {
        throw new SparkError(
          'VALIDATION_FAILED',
          `应用文件空间超过 ${SUB_APP_SHARE_FILE_COUNT_LIMIT} 个文件，无法导出，请先清理。`,
        )
      }
      const childPath = path.join(currentDir, dirent.name)
      if (dirent.isDirectory()) {
        const nested = await this.walkFiles(appRoot, childPath, depth + 1)
        out.push(...nested)
      } else if (dirent.isFile()) {
        out.push(path.relative(appRoot, childPath).split(path.sep).join('/'))
      }
    }
    return out
  }

  // ─── 导入侧 ───────────────────────────────────────────────────────────────

  /** 读取并解析分享包文件；JSON 损坏直接抛错。 */
  async previewFromFile(filePath: string, fileName?: string): Promise<SubAppSharePreviewResult> {
    let stat: Awaited<ReturnType<typeof fs.stat>>
    let raw: string
    try {
      stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size > SUB_APP_SHARE_MAX_FILE_BYTES) {
        throw new Error('size')
      }
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      throw new SparkError('VALIDATION_FAILED', '分享包文件无法读取（不存在、非文件或体积超限）。')
    }

    let parsed: SubAppSharePackage
    try {
      parsed = JSON.parse(raw) as SubAppSharePackage
    } catch {
      throw new SparkError('VALIDATION_FAILED', '不是有效的分享包：文件不是合法 JSON。')
    }
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      typeof parsed.formatVersion !== 'number' ||
      typeof parsed.appId !== 'string' ||
      typeof parsed.manifest?.name !== 'string' ||
      typeof parsed.draft?.source !== 'string' ||
      !Array.isArray(parsed.releases) ||
      !Array.isArray(parsed.data) ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.capabilities?.ipcChannels) ||
      !Array.isArray(parsed.capabilities?.providerRefs) ||
      !Array.isArray(parsed.capabilities?.secretHints)
    ) {
      throw new SparkError('VALIDATION_FAILED', '不是有效的分享包：缺少必要的包结构。')
    }

    const { integrityOk, body } = verifyPackageIntegrity(parsed)
    const checks = buildImportChecks(body, integrityOk, this.platformVersion)
    const conflict = await this.describeConflict(body)

    return {
      body,
      integrityOk,
      checks,
      conflict,
      fileName: fileName ?? path.basename(filePath),
      byteSize: stat.size,
    }
  }

  /** 本机冲突识别：同 appId → 可覆盖；仅同名不同 id → 提示；否则无冲突。 */
  async describeConflict(body: SubAppSharePackageBody): Promise<SubAppShareConflictInfo> {
    const currentById = this.repository.get(body.appId)
    if (currentById != null) {
      return {
        kind: 'same-id',
        appId: currentById.id,
        current: await this.summarizeCurrent(currentById.id),
      }
    }
    const name = body.manifest.name.trim()
    if (name.length > 0) {
      const matches = this.repository.list({ query: name, limit: 100 })
      const sameName = matches.items.find(
        (item) => item.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (sameName != null) {
        return {
          kind: 'same-name',
          appId: sameName.id,
          current: await this.summarizeCurrent(sameName.id),
        }
      }
    }
    return { kind: 'none' }
  }

  private async summarizeCurrent(
    appId: string,
  ): Promise<NonNullable<SubAppShareConflictInfo['current']>> {
    const summary = this.repository.get(appId)
    const releases = this.repository.listReleases(appId, { limit: 1 })
    const data = this.repository.listAllData(appId, 1)
    const files = await this.fileStore.list(appId)
    return {
      name: summary?.name ?? '',
      publicationStatus: summary?.publicationStatus ?? 'draft',
      publishedVersion: summary?.publishedVersion ?? null,
      releaseCount: releases?.total ?? 0,
      dataEntries: data.total,
      files: files.files.length,
    }
  }

  /**
   * 执行导入：覆盖 = 先备份本机应用 → 文件空间原子交换 → DB 单事务替换；
   * 新建 = 新 appId（必要时名称加后缀）。文件交换失败或 DB 失败都会回滚，
   * 保证文件与 DB 一致。
   *
   * expectedSha256 来自 preview 阶段已验证的包体哈希（body 全程留在主进程
   * 内存，凭 token 取用）；不一致说明缓存被异常篡改，直接拒绝。
   */
  async applyImport(
    body: SubAppSharePackageBody,
    mode: 'overwrite' | 'new-app',
    expectedSha256?: string,
  ): Promise<SubAppShareApplyResult> {
    const bodySha256 = computeBodySha256(body)
    if (expectedSha256 != null && bodySha256 !== expectedSha256) {
      throw new SparkError('VALIDATION_FAILED', '包体校验失败（与预览时不一致），已拒绝导入。')
    }
    const hardChecks = buildImportChecks(body, true, this.platformVersion)
    const blocking = hardChecks.filter((check) => check.level === 'error')
    const firstBlocking = blocking[0]
    if (firstBlocking != null) {
      throw new SparkError('VALIDATION_FAILED', `分享包存在阻断性问题：${firstBlocking.message}`)
    }

    const overwriteExisting = mode === 'overwrite'
    // 注意：new-app 模式的目标是新生成的 id，包内 appId 在本机是否存在都不影响
    // new-app（那正是同 id 冲突时用户改选新导入的场景）；冲突检查必须看目标 id。
    const targetId = overwriteExisting ? body.appId : randomUUID()
    const existing = this.repository.get(targetId)
    if (overwriteExisting && existing == null) {
      throw new SparkError(
        'VALIDATION_FAILED',
        '本机已不存在同 id 应用，无法覆盖，请改用「作为新应用导入」。',
      )
    }
    if (!overwriteExisting && existing != null) {
      // randomUUID 碰撞理论上不可能；防御性拦截。
      throw new SparkError('VALIDATION_FAILED', '目标应用 id 冲突，请重试。')
    }

    const manifest = { ...body.manifest }
    const warnings: string[] = []

    // 新建导入：名称与本机应用撞名时加后缀，保证列表可区分。
    if (!overwriteExisting) {
      const baseName = manifest.name.trim()
      const taken = new Set(
        this.repository
          .list({ limit: 200 })
          .items.map((item) => item.name.trim().toLowerCase()),
      )
      if (taken.has(baseName.toLowerCase())) {
        let candidate = `${baseName}（导入）`
        let suffix = 2
        while (taken.has(candidate.toLowerCase())) {
          candidate = `${baseName}（导入${suffix}）`
          suffix += 1
        }
        manifest.name = candidate
        warnings.push(`本机已有同名应用，已重命名为「${manifest.name}」。`)
      }
    }

    // 覆盖前备份：复用导出逻辑，把本机当前应用整体打包（含数据/文件）。
    let backupPath: string | null = null
    if (overwriteExisting && existing != null) {
      backupPath = await this.writeBackup(targetId)
    }

    await this.swapFileSpace(targetId, body.files, overwriteExisting)
    let imported: ReturnType<SubAppRepository['importApp']>
    try {
      imported = this.repository.importApp({
        id: targetId,
        manifest,
        draft: { source: body.draft.source, config: body.draft.config },
        releases: body.releases.map((release) => ({
          version: release.version,
          source: release.source,
          config: release.config,
          manifest: release.manifest,
          publishedAt: release.publishedAt,
        })),
        publishedVersion: body.publishedVersion,
        data: body.data.map((entry) => ({
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
        })),
      })
    } catch (error) {
      // DB 写入失败：回滚文件空间到导入前状态。
      await this.restoreFileSpace(targetId, overwriteExisting).catch(() => {})
      throw error
    }
    // DB 已提交：清除目录交换留下的旧文件空间（.old-*）。
    await this.removeOldDirs(targetId).catch(() => {})

    return {
      appId: imported.id,
      name: imported.name,
      publicationStatus: imported.publicationStatus,
      publishedVersion: imported.publishedVersion,
      importedReleases: body.releases.length,
      importedDataEntries: body.data.length,
      importedFiles: body.files.length,
      backupPath,
      warnings,
    }
  }

  /** 覆盖导入前把本机当前应用完整导出为 .sparkapp 备份；失败不阻断导入。 */
  private async writeBackup(appId: string): Promise<string | null> {
    try {
      const result = await this.buildPackage(appId, { includeData: true, includeFiles: true })
      await fs.mkdir(this.backupsDir, { recursive: true })
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\..+$/, '')
      const safeName = result.body.manifest.name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
      const backupPath = path.join(this.backupsDir, `${safeName}-覆盖前备份-${stamp}.sparkapp`)
      await fs.writeFile(backupPath, result.text, 'utf8')
      return backupPath
    } catch {
      return null
    }
  }

  /**
   * 原子目录交换：先写入 <appId>.incoming-<rand> 临时目录，再把旧目录挪到
   * .old-<rand>，最后把临时目录改名到位。同卷 rename 在 Windows/macOS/Linux
   * 上都是原子操作；DB 失败时由 restoreFileSpace 回滚。
   */
  private async swapFileSpace(
    appId: string,
    files: Array<{ path: string; content: string }>,
    hasOld: boolean,
  ): Promise<void> {
    const target = path.resolve(this.fileStoreRoot, appId)
    const stamp = randomUUID().slice(0, 8)
    const tmp = `${target}.incoming-${stamp}`
    const oldDir = `${target}.old-${stamp}`
    await fs.rm(tmp, { recursive: true, force: true })
    await fs.mkdir(tmp, { recursive: true })
    try {
      for (const file of files) {
        assertSafeRelativePath(file.path)
        const dest = path.resolve(tmp, file.path)
        if (dest !== tmp && !dest.startsWith(tmp + path.sep)) {
          throw new SparkError('PERMISSION_DENIED', '分享包内出现越界文件路径，已拒绝导入。')
        }
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, file.content, 'utf8')
      }
      if (hasOld) {
        await fs.rm(oldDir, { recursive: true, force: true })
        await fs.rename(target, oldDir)
      }
      try {
        await fs.rename(tmp, target)
      } catch (error) {
        if (hasOld) {
          // 临时目录换名失败：把旧目录放回去，应用还是导入前的样子。
          await fs.rename(oldDir, target).catch(() => {})
        }
        throw error
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 清除目录交换留下的 .old-* 旧文件空间目录。 */
  private async removeOldDirs(appId: string): Promise<void> {
    const target = path.resolve(this.fileStoreRoot, appId)
    const parent = path.dirname(target)
    const stale = (await fs.readdir(parent).catch(() => [])).filter((name) =>
      name.startsWith(`${path.basename(target)}.old-`),
    )
    for (const name of stale) {
      await fs.rm(path.join(parent, name), { recursive: true, force: true })
    }
  }

  /** DB 导入失败后的文件空间回滚：删新目录、还原旧目录。 */
  private async restoreFileSpace(appId: string, hadOld: boolean): Promise<void> {
    const target = path.resolve(this.fileStoreRoot, appId)
    if (!hadOld) {
      await fs.rm(target, { recursive: true, force: true })
      return
    }
    const oldDirs = (await fs.readdir(path.dirname(target)).catch(() => []))
      .filter((name) => name.startsWith(`${path.basename(target)}.old-`))
      .sort()
    const latestOld = oldDirs.at(-1)
    if (latestOld != null) {
      await fs.rm(target, { recursive: true, force: true })
      await fs.rename(path.join(path.dirname(target), latestOld), target)
    }
  }
}

// ─── 纯函数：能力扫描 / 完整性 / 检查 ─────────────────────────────────────────

/** 静态扫描源码与 data 值，产出能力依赖清单（只含名称/位置，绝不含密钥内容）。 */
export function scanCapabilities(
  sources: Array<{ label: string; source: string }>,
  data: SubAppShareDataEntry[],
): SubAppShareCapabilityReport {
  const channels = new Set<string>()
  const providerRefs = new Set<string>()
  const secretHints: SubAppShareCapabilityReport['secretHints'] = []

  for (const { label, source } of sources) {
    // 静态可解析的字面量通道；模板字符串等动态形式无法静态识别（已知限制）。
    for (const match of source.matchAll(/sparkApp\.ipc\.(?:invoke|on)\(\s*['"]([^'"]+)['"]/g)) {
      const channel = match[1]
      if (channel != null && channel.length > 0) channels.add(channel)
    }
    if (/providerProfileId/.test(source)) {
      providerRefs.add('providerProfileId（应用内固定渠道引用，不会随包转移）')
    }
    collectSecretHints(source, 'source', label, secretHints)
  }

  for (const channel of channels) {
    if (channel.startsWith('provider:')) {
      providerRefs.add(channel)
    }
  }

  for (const entry of data) {
    let serialized: string
    try {
      serialized = JSON.stringify(entry.value) ?? ''
    } catch {
      continue
    }
    collectSecretHints(serialized, 'data', `${entry.namespace}/${entry.key}`, secretHints)
  }

  return {
    ipcChannels: [...channels].sort(),
    providerRefs: [...providerRefs].sort(),
    secretHints,
  }
}

function collectSecretHints(
  text: string,
  scope: 'source' | 'data',
  location: string,
  out: SubAppShareCapabilityReport['secretHints'],
): void {
  const patterns = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /(api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  ]
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      out.push({ scope, location })
      return
    }
  }
}

function describeSecretHints(
  hints: SubAppShareCapabilityReport['secretHints'],
): Array<string> {
  return hints.map((hint) =>
    hint.scope === 'source'
      ? `源码（${hint.location}）疑似包含明文密钥，请确认后再分享。`
      : `应用数据（${hint.location}）疑似包含明文密钥，将随包分享，请确认后再分享。`,
  )
}

/** 序列化包体并计算完整性（sha256/byteSize 均针对不含 integrity 的包体文本）。 */
export function serializePackage(body: SubAppSharePackageBody): {
  text: string
  integrity: { sha256: string; byteSize: number }
} {
  const bodyJson = JSON.stringify(body)
  const integrity = {
    sha256: createHash('sha256').update(bodyJson, 'utf8').digest('hex'),
    byteSize: Buffer.byteLength(bodyJson, 'utf8'),
  }
  return { text: JSON.stringify({ ...body, integrity }), integrity }
}

/** 计算包体（不含 integrity）的 sha256，与导出/校验共用同一序列化口径。 */
export function computeBodySha256(body: SubAppSharePackageBody): string {
  const bodyJson = JSON.stringify(body)
  return createHash('sha256').update(bodyJson, 'utf8').digest('hex')
}

/**
 * 校验包体完整性。前提：JSON.parse 保留键序、JSON.stringify 输出确定，
 * 因此对「去掉 integrity 后的包体重新序列化」可复现导出时的哈希原文。
 * 该校验拦截截断/误改，不是对抗性签名。
 */
export function verifyPackageIntegrity(pkg: SubAppSharePackage): {
  integrityOk: boolean
  body: SubAppSharePackageBody
} {
  const { integrity, ...body } = pkg
  try {
    return { integrityOk: integrity?.sha256 === computeBodySha256(body), body }
  } catch {
    return { integrityOk: false, body }
  }
}

/** 语义化版本比较；无法解析时返回 0（视为相同，不告警）。 */
function compareVersions(a: string, b: string): number {
  const parse = (value: string): Array<number> | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
    return match == null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const pa = parse(a)
  const pb = parse(b)
  if (pa == null || pb == null) return 0
  const [majorA = 0, minorA = 0, patchA = 0] = pa
  const [majorB = 0, minorB = 0, patchB = 0] = pb
  if (majorA !== majorB) return majorA - majorB
  if (minorA !== minorB) return minorA - minorB
  return patchA - patchB
}

/** 组装导入能力检查报告（error 级阻断导入，warning 级提示后可继续）。 */
export function buildImportChecks(
  body: SubAppSharePackageBody,
  integrityOk: boolean,
  currentPlatformVersion: string,
): SubAppShareImportCheck[] {
  const checks: SubAppShareImportCheck[] = []

  if (body.formatVersion !== SUB_APP_SHARE_FORMAT_VERSION) {
    checks.push({
      level: 'error',
      code: 'FORMAT_VERSION',
      message: `分享包格式版本不受支持（包 v${body.formatVersion} / 当前 v${SUB_APP_SHARE_FORMAT_VERSION}），请升级 SparkWork 后重试。`,
    })
  } else {
    checks.push({
      level: 'ok',
      code: 'FORMAT_VERSION',
      message: `包格式版本 v${body.formatVersion} 可识别。`,
    })
  }

  if (compareVersions(body.platformVersion, currentPlatformVersion) > 0) {
    checks.push({
      level: 'warning',
      code: 'PLATFORM_VERSION',
      message: `分享包来自更新版本的平台（包 ${body.platformVersion} > 当前 ${currentPlatformVersion}），导入可能缺少新能力，建议先升级。`,
    })
  }

  if (!integrityOk) {
    checks.push({
      level: 'error',
      code: 'INTEGRITY',
      message: '包体完整性校验失败：文件可能被截断或修改过，已拒绝导入。',
    })
  }

  const knownChannels = new Set(Object.keys(IpcSchemaRegistry))
  const unknownChannels = body.capabilities.ipcChannels.filter(
    (channel) => !knownChannels.has(channel),
  )
  checks.push({
    level: unknownChannels.length > 0 ? 'warning' : 'ok',
    code: 'IPC_CHANNELS',
    message:
      unknownChannels.length > 0
        ? `源码引用了 ${unknownChannels.length} 个当前平台无法识别的宿主通道，相关功能可能不可用（仅覆盖静态可解析的引用）。`
        : '源码引用的宿主通道当前平台均已支持（仅覆盖静态可解析的引用）。',
    ...(unknownChannels.length > 0 ? { detail: unknownChannels } : {}),
  })

  if (body.capabilities.providerRefs.length > 0) {
    checks.push({
      level: 'warning',
      code: 'IPC_CHANNELS',
      message: '应用引用了 AI 渠道相关能力：导入后请在本机选择自己的 Provider，渠道引用不随包转移。',
      detail: body.capabilities.providerRefs,
    })
  }

  const oversizedSources: string[] = []
  if (body.draft.source.length > SUB_APP_SHARE_SOURCE_RUNTIME_LIMIT) {
    oversizedSources.push('草稿')
  }
  for (const release of body.releases) {
    if (release.source.length > SUB_APP_SHARE_SOURCE_RUNTIME_LIMIT) {
      oversizedSources.push(`v${release.version}`)
    }
  }
  if (oversizedSources.length > 0) {
    checks.push({
      level: 'warning',
      code: 'SOURCE_RUNTIME_LIMIT',
      message: `部分源码超过运行时文档上限（260K 字符）：可导入保存，但运行时可能无法加载。`,
      detail: oversizedSources,
    })
  }

  if (body.capabilities.secretHints.length > 0) {
    checks.push({
      level: 'warning',
      code: 'SECRET_HINT',
      message: '疑似包含明文密钥（源码或应用数据），请知悉后再导入使用。',
      detail: describeSecretHints(body.capabilities.secretHints),
    })
  }

  const oversizedData = body.data
    .map((entry) => {
      try {
        return { entry, size: JSON.stringify(entry.value)?.length ?? 0 }
      } catch {
        return { entry, size: Number.POSITIVE_INFINITY }
      }
    })
    .filter((item) => item.size > SUB_APP_SHARE_DATA_VALUE_LIMIT)
    .map((item) => `${item.entry.namespace}/${item.entry.key}`)
  if (oversizedData.length > 0) {
    checks.push({
      level: 'error',
      code: 'DATA_LIMIT',
      message: '部分应用数据超过单条 512KB 上限，无法导入。',
      detail: oversizedData,
    })
  }

  const invalidFiles: string[] = []
  const oversizedFiles: string[] = []
  for (const file of body.files) {
    try {
      assertSafeRelativePath(file.path)
    } catch {
      invalidFiles.push(file.path)
      continue
    }
    if (file.content.length > SUB_APP_SHARE_FILE_CONTENT_LIMIT) {
      oversizedFiles.push(file.path)
    }
  }
  if (invalidFiles.length > 0 || oversizedFiles.length > 0) {
    checks.push({
      level: 'error',
      code: 'FILE_LIMIT',
      message: '部分文件不满足文件空间限制（单文件 2MB / 安全路径 / 数量上限），无法导入。',
      detail: [...invalidFiles, ...oversizedFiles],
    })
  }

  if (body.draft.source.trim().length === 0 && body.releases.length === 0) {
    checks.push({
      level: 'error',
      code: 'DRAFT_EMPTY',
      message: '分享包内没有草稿源码也没有发布版本，是空包，无法导入。',
    })
  } else if (body.draft.source.trim().length === 0) {
    checks.push({
      level: 'warning',
      code: 'DRAFT_EMPTY',
      message: '包内草稿源码为空：导入后为空草稿，已发布版本不受影响。',
    })
  }

  return checks
}

/** 与协议层 filePath 规则一致的二次校验（分享包内容不可信任）。 */
function assertSafeRelativePath(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 240) {
    throw new SubAppStateError('分享包内的文件路径非法。')
  }
  if (relPath.includes('\\') || relPath.includes(':') || relPath.startsWith('/')) {
    throw new SubAppStateError('分享包内的文件路径非法。')
  }
  const segments = relPath.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new SubAppStateError('分享包内的文件路径非法。')
  }
}
