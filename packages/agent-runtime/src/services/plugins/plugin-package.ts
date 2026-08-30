import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, lstat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import {
  PluginManifestSchema,
  type PluginInspection,
  type PluginManifest,
  type PluginPermissionRisk,
} from '@spark/protocol'

const MAX_FILES = 20_000
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024

function assertSafeRelativePath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`Unsafe plugin path: ${value}`)
  }
}

async function walkFiles(
  root: string,
): Promise<{ relativePath: string; absolutePath: string; size: number }[]> {
  const output: { relativePath: string; absolutePath: string; size: number }[] = []
  let totalBytes = 0
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.name === '.DS_Store' ||
        entry.name === '__MACOSX' ||
        entry.name === '.spark-installed'
      )
        continue
      const absolutePath = join(directory, entry.name)
      const rel = relative(root, absolutePath).split(sep).join('/')
      assertSafeRelativePath(rel)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink())
        throw new Error(`Plugin packages cannot contain symbolic links: ${rel}`)
      if (info.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!info.isFile()) throw new Error(`Unsupported plugin entry: ${rel}`)
      totalBytes += info.size
      if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Plugin package exceeds the 250 MB limit')
      output.push({ relativePath: rel, absolutePath, size: info.size })
      if (output.length > MAX_FILES)
        throw new Error(`Plugin package exceeds the ${MAX_FILES} file limit`)
    }
  }
  await visit(root)
  return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function hashPackage(files: Awaited<ReturnType<typeof walkFiles>>): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(await readFile(file.absolutePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function inspectPluginDirectory(sourcePath: string): Promise<PluginInspection> {
  const root = resolve(sourcePath)
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('Plugin source must be a directory')
  const files = await walkFiles(root)
  const manifestPath = join(root, 'plugin.json')
  if (!files.some((file) => file.relativePath === 'plugin.json')) {
    throw new Error('Plugin package is missing plugin.json')
  }
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  const manifest = PluginManifestSchema.parse(raw) as unknown as PluginManifest
  const packageRoot = root.endsWith(sep) ? root : `${root}${sep}`
  for (const skill of manifest.contributions.skills) {
    const candidate = resolve(root, skill.path)
    if (!candidate.startsWith(packageRoot))
      throw new Error(`Skill path escapes plugin package: ${skill.path}`)
    const skillInfo = await stat(candidate).catch(() => null)
    if (skillInfo == null || !skillInfo.isDirectory())
      throw new Error(`Skill path does not exist: ${skill.path}`)
    if (!files.some((file) => file.relativePath === `${skill.path.replace(/\/$/, '')}/SKILL.md`)) {
      throw new Error(`Skill contribution must contain SKILL.md: ${skill.path}`)
    }
  }
  const packageSha256 = await hashPackage(files)
  const riskByPermission: Record<string, PluginPermissionRisk> = {
    network: 'medium',
    'filesystem.read': 'medium',
    'filesystem.write': 'high',
    'process.spawn': 'critical',
    'secrets.read': 'critical',
    clipboard: 'low',
    browser: 'high',
    'mcp.connect': 'high',
    'connector.account': 'high',
  }
  return {
    manifest,
    sourcePath: root,
    packageSha256,
    files: files.length,
    requiredPermissions: manifest.permissions.required.map((permission) => ({
      permission,
      risk: riskByPermission[permission] ?? 'high',
    })),
    warnings: [
      ...(manifest.contributions.mcpServers.length > 0
        ? ['MCP 服务在授权相关权限后才会启用。']
        : []),
      ...(manifest.contributions.connectors.length > 0
        ? ['连接器只声明接入能力，首次使用账号前仍需单独授权。']
        : []),
    ],
  }
}

export async function installPluginDirectoryAtomic(
  sourcePath: string,
  pluginRoot: string,
  pluginId: string,
): Promise<string> {
  const root = resolve(pluginRoot)
  await mkdir(root, { recursive: true })
  const target = join(root, pluginId)
  const staging = join(root, `.${pluginId}.${randomUUID()}.staging`)
  const backup = join(root, `.${pluginId}.${randomUUID()}.backup`)
  await cp(resolve(sourcePath), staging, { recursive: true, errorOnExist: true, force: false })
  try {
    const existing = await lstat(target).catch(() => null)
    if (existing != null)
      await cp(target, backup, { recursive: true, force: false, errorOnExist: true })
    await rm(target, { recursive: true, force: true })
    await writeFile(join(staging, '.spark-installed'), `${new Date().toISOString()}\n`, 'utf8')
    await import('node:fs/promises').then(({ rename }) => rename(staging, target))
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return target
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    const backupInfo = await lstat(backup).catch(() => null)
    if (backupInfo != null) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
      await import('node:fs/promises')
        .then(({ rename }) => rename(backup, target))
        .catch(() => undefined)
    }
    throw error
  }
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

async function downloadFile(
  url: string,
  destination: string,
  expectedSha256: string,
): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'Spark-Agent-Plugin-Manager/1' },
  })
  if (!response.ok) throw new Error(`Plugin download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest.toLowerCase() !== expectedSha256.toLowerCase())
    throw new Error('Plugin package checksum does not match the marketplace listing')
  await writeFile(destination, bytes)
}

export async function installPluginArchive(
  url: string,
  expectedSha256: string,
  tempRoot = tmpdir(),
): Promise<string> {
  const work = join(tempRoot, `spark-plugin-${randomUUID()}`)
  const archive = join(work, 'package.archive')
  const extracted = join(work, 'extracted')
  await mkdir(extracted, { recursive: true })
  try {
    await downloadFile(url, archive, expectedSha256)
    await run('tar', ['-tf', archive], work)
    const listing = await new Promise<string>((resolvePromise, reject) => {
      const child = spawn('tar', ['-tf', archive], { cwd: work, windowsHide: true })
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
      })
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? resolvePromise(output) : reject(new Error('Cannot inspect plugin archive')),
      )
    })
    for (const entry of listing.split(/\r?\n/).filter(Boolean))
      assertSafeRelativePath(entry.replace(/\/$/, ''))
    await run('tar', ['-xf', archive, '-C', extracted], work)
    const candidates: string[] = []
    async function findManifest(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const candidate = join(directory, entry.name)
        if (entry.isFile() && entry.name === 'plugin.json')
          candidates.push(resolve(candidate, '..'))
        if (entry.isDirectory()) await findManifest(candidate)
      }
    }
    await findManifest(extracted)
    if (candidates.length !== 1 || candidates[0] == null)
      throw new Error('Plugin archive must contain exactly one plugin.json')
    return candidates[0]
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
