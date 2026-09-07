import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SubAppPackageDescriptor } from '@spark/protocol'
import { assertPackagePath, SubAppPackageService } from '@spark/storage'

export const SUB_APP_PACKAGE_RUNTIME_HOST = 'subapp-package'
const MAX_RUNTIME_PACKAGES = 64
const RUNTIME_TTL_MS = 10 * 60 * 1000

interface RuntimeEntry {
  root: string
  descriptor: SubAppPackageDescriptor
  expiresAt: number
}

const entries = new Map<string, RuntimeEntry>()

export async function putSubAppRuntimePackage(
  service: SubAppPackageService,
  input: { appId: string; releaseId?: string; mode: 'draft' | 'published' },
): Promise<{
  token: string
  entrySource: string
  assetsBaseUrl: string
  descriptor: SubAppPackageDescriptor
}> {
  sweepExpired()
  if (entries.size >= MAX_RUNTIME_PACKAGES) {
    const oldest = entries.keys().next().value as string | undefined
    if (oldest != null) entries.delete(oldest)
  }
  const runtime = await service.resolveRuntime(input)
  const token = randomUUID()
  entries.set(token, { ...runtime, expiresAt: Date.now() + RUNTIME_TTL_MS })
  const entrySource = await fs.readFile(
    path.join(runtime.root, assertPackagePath(runtime.descriptor.frontendEntry)),
    'utf8',
  )
  return {
    token,
    entrySource,
    assetsBaseUrl: `capability-asset://${SUB_APP_PACKAGE_RUNTIME_HOST}/${token}/${packageEntryDirectory(runtime.descriptor.frontendEntry)}`,
    descriptor: runtime.descriptor,
  }
}

function packageEntryDirectory(entry: string): string {
  const directory = path.posix.dirname(entry)
  return directory === '.' ? '' : `${directory}/`
}

export function releaseSubAppRuntimePackage(token: string): void {
  entries.delete(token)
}

export async function resolveSubAppRuntimePackagePath(
  token: string,
  relativePath: string,
): Promise<string | null> {
  sweepExpired()
  const entry = entries.get(token)
  if (entry == null) return null
  entry.expiresAt = Date.now() + RUNTIME_TTL_MS
  const safePath = assertPackagePath(relativePath)
  const target = path.resolve(entry.root, safePath)
  const root = path.resolve(entry.root)
  if (!target.startsWith(`${root}${path.sep}`)) return null
  const [rootReal, targetReal] = await Promise.all([fs.realpath(root), fs.realpath(target)])
  if (!targetReal.startsWith(`${rootReal}${path.sep}`)) return null
  const stat = await fs.lstat(targetReal)
  if (!stat.isFile() || stat.isSymbolicLink()) return null
  return targetReal
}

function sweepExpired(): void {
  const now = Date.now()
  for (const [token, entry] of entries) if (entry.expiresAt <= now) entries.delete(token)
}
