import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  ToolPackageManifestSchema,
  type ToolPackageInspection,
  type ToolPackageManifest,
} from '@spark/protocol'

const MAX_PACKAGE_FILES = 50_000
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MANIFEST_NAME = 'spark-tool.json'
const INSTALL_METADATA_NAME = '.spark-installed'

interface InspectedFile {
  relativePath: string
  absolutePath: string
  size: number
}

export async function inspectToolPackageDirectory(
  sourcePath: string,
): Promise<ToolPackageInspection> {
  const root = resolve(sourcePath)
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Tool package source must be a real directory, not a symbolic link')
  }
  const files = await walkPackageFiles(root)
  const manifestFile = files.find((file) => file.relativePath === MANIFEST_NAME)
  if (manifestFile == null) throw new Error(`Tool package is missing ${MANIFEST_NAME}`)
  if (manifestFile.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Tool package ${MANIFEST_NAME} exceeds the 4 MB manifest limit`)
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Tool package ${MANIFEST_NAME} is not valid JSON`, { cause: error })
  }
  const manifest = ToolPackageManifestSchema.parse(rawManifest)
  await assertRuntimePaths(root, files, manifest)

  return {
    manifest,
    sourcePath: root,
    integritySha256: await hashPackage(files),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    warnings: buildInspectionWarnings(manifest),
  }
}

export async function installToolPackageDirectoryAtomic(
  sourcePath: string,
  packageRoot: string,
): Promise<{ installPath: string; inspection: ToolPackageInspection }> {
  const inspection = await inspectToolPackageDirectory(sourcePath)
  const root = resolve(packageRoot)
  const packageDirectory = join(root, inspection.manifest.id)
  const target = join(packageDirectory, inspection.manifest.version)
  await mkdir(packageDirectory, { recursive: true })

  const existing = await stat(target).catch(() => null)
  if (existing != null) {
    if (!existing.isDirectory())
      throw new Error(`Tool package target is not a directory: ${target}`)
    const installedInspection = await inspectToolPackageDirectory(target)
    if (installedInspection.integritySha256 !== inspection.integritySha256) {
      throw new Error(
        `Tool package ${inspection.manifest.id}@${inspection.manifest.version} already exists with different content`,
      )
    }
    return { installPath: target, inspection: installedInspection }
  }

  const staging = join(packageDirectory, `.${inspection.manifest.version}.${randomUUID()}.staging`)
  try {
    await cp(inspection.sourcePath, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      // 包内符号链接（npm 的 node_modules/.bin、pnpm 的包布局）在安装副本中物化为真实文件，
      // 与 walkPackageFiles 的解引用检查保持一致，staging 复检才能得到相同的完整性摘要。
      dereference: true,
      filter: (source) =>
        source === inspection.sourcePath ||
        !isIgnoredPackageEntry(relative(inspection.sourcePath, source)),
    })
    const stagedInspection = await inspectToolPackageDirectory(staging)
    if (stagedInspection.integritySha256 !== inspection.integritySha256) {
      throw new Error('Tool package source changed while the immutable version was being copied')
    }
    await writeFile(
      join(staging, INSTALL_METADATA_NAME),
      JSON.stringify({
        packageId: inspection.manifest.id,
        version: inspection.manifest.version,
        integritySha256: inspection.integritySha256,
        installedAt: new Date().toISOString(),
      }),
      'utf8',
    )
    await rename(staging, target)
    return {
      installPath: target,
      inspection: { ...stagedInspection, sourcePath: target },
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function walkPackageFiles(root: string): Promise<InspectedFile[]> {
  const output: InspectedFile[] = []
  // 真实目录路径 → 首次被访问时的包内相对路径。仅当同一真实目录以「自身祖先路径」
  // 再次出现时才是链接环（复制会无限递归）；兄弟位置再次出现只是别名，
  // 内容复制两份是有界的，允许通过。
  const firstSeenRealPaths = new Map<string, string>()
  const realRoot = await realpath(root)
  let totalBytes = 0

  async function visit(directory: string): Promise<void> {
    const relativePath = normalizeRelativePath(relative(root, directory))
    const realDirectory = await realpath(directory)
    const firstSeen = firstSeenRealPaths.get(realDirectory)
    if (firstSeen != null && (relativePath === firstSeen || relativePath.startsWith(`${firstSeen}/`))) {
      throw new Error(`Tool package contains a symlink loop: ${relativePath}`)
    }
    if (firstSeen == null) firstSeenRealPaths.set(realDirectory, relativePath)
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const relativePath = normalizeRelativePath(relative(root, absolutePath))
      if (isIgnoredPackageEntry(relativePath)) continue
      assertSafeRelativePath(relativePath)

      const info = await lstat(absolutePath)
      // 包内符号链接按目标内容物化（安装副本中为真实文件）；指向包外或断链仍拒绝，
      // 杜绝包外内容借道链接进入不可变版本。
      const effectiveInfo = info.isSymbolicLink()
        ? await resolveSymlinkWithinPackage(realRoot, absolutePath, relativePath)
        : info
      if (effectiveInfo.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!effectiveInfo.isFile()) throw new Error(`Unsupported tool package entry: ${relativePath}`)

      totalBytes += effectiveInfo.size
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new Error('Tool package exceeds the 2 GB inspection limit')
      }
      output.push({ relativePath, absolutePath, size: effectiveInfo.size })
      if (output.length > MAX_PACKAGE_FILES) {
        throw new Error(`Tool package exceeds the ${MAX_PACKAGE_FILES} file inspection limit`)
      }
    }
  }

  await visit(root)
  return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

/** 解析包内符号链接的目标 stat；越界与断链抛出明确错误。 */
async function resolveSymlinkWithinPackage(
  realRoot: string,
  linkPath: string,
  relativePath: string,
): Promise<Stats> {
  const resolved = await realpath(linkPath).catch(() => {
    throw new Error(`Tool package contains a broken symbolic link: ${relativePath}`)
  })
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`
  if (resolved !== realRoot && !resolved.startsWith(prefix)) {
    throw new Error(`Tool package symbolic link escapes the package root: ${relativePath}`)
  }
  return stat(resolved)
}

async function assertRuntimePaths(
  root: string,
  files: InspectedFile[],
  manifest: ToolPackageManifest,
): Promise<void> {
  if (manifest.runtime.adapter !== 'process') return
  if (manifest.runtime.workingDirectory != null) {
    const workingDirectory = resolveWithinPackage(root, manifest.runtime.workingDirectory)
    const info = await stat(workingDirectory).catch(() => null)
    if (info == null || !info.isDirectory()) {
      throw new Error(
        `Tool package workingDirectory does not exist: ${manifest.runtime.workingDirectory}`,
      )
    }
  }
  const command = manifest.runtime.command
  if (command.startsWith('./')) {
    const relativeCommand = command.slice(2)
    assertSafeRelativePath(relativeCommand)
    if (!files.some((file) => file.relativePath === relativeCommand)) {
      throw new Error(`Tool package command does not exist: ${command}`)
    }
    return
  }
  // 进程不经 shell 拉起：command 必须是单个可执行文件，参数放 runtime.args。
  // "node index.js" 这类写法要等 spawn ENOENT 才暴露，这里提前拦截；
  // 真实路径里含空格的文件（绝对路径或包内相对路径）只要存在就放行。
  if (/\s/.test(command)) {
    const commandInfo = isAbsolute(command)
      ? await stat(command).catch(() => null)
      : null
    if (commandInfo == null || !commandInfo.isFile()) {
      throw new Error(
        `Tool package runtime.command must be a single executable; pass arguments via runtime.args: ${command}`,
      )
    }
  }
}

async function hashPackage(files: InspectedFile[]): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    for await (const chunk of createReadStream(file.absolutePath)) hash.update(chunk)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function buildInspectionWarnings(manifest: ToolPackageManifest): string[] {
  const warnings: string[] = []
  if (manifest.runtime.adapter === 'process') {
    warnings.push('trusted-local 进程可使用当前用户权限；启用前必须核对命令和 OS 行为声明。')
  }
  if (manifest.permissions.declaredOsEffects.length > 0) {
    warnings.push(
      `工具声明 OS 行为：${manifest.permissions.declaredOsEffects.join('、')}；这些不是细粒度沙箱承诺。`,
    )
  }
  if (manifest.environment.some((variable) => variable.secret)) {
    warnings.push('敏感环境变量不会从工具包读取，必须由安全配置流程写入 Keychain。')
  }
  return warnings
}

function resolveWithinPackage(root: string, value: string): string {
  assertSafeRelativePath(value)
  const candidate = resolve(root, value)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!candidate.startsWith(prefix)) throw new Error(`Tool package path escapes root: ${value}`)
  return candidate
}

function assertSafeRelativePath(value: string): void {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Unsafe tool package path: ${value}`)
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function isIgnoredPackageEntry(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  const first = normalized.split('/')[0]
  return (
    normalized === '' ||
    normalized === '.DS_Store' ||
    normalized === INSTALL_METADATA_NAME ||
    first === '.git' ||
    first === '__MACOSX'
  )
}
