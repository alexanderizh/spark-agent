import { randomUUID } from 'node:crypto'
import type { SubAppSharePackageBody } from '@spark/protocol'

export const SUB_APP_IMPORT_CACHE_LIMIT = 4
export const SUB_APP_IMPORT_CACHE_TTL_MS = 10 * 60 * 1000

interface CachedSubAppImport {
  body: SubAppSharePackageBody
  sha256: string
  createdAt: number
}

const cache = new Map<string, CachedSubAppImport>()

export function cacheSubAppImportBody(
  body: SubAppSharePackageBody,
  sha256: string,
  now = Date.now(),
): string {
  for (const [key, entry] of cache) {
    if (now - entry.createdAt >= SUB_APP_IMPORT_CACHE_TTL_MS) cache.delete(key)
  }
  while (cache.size >= SUB_APP_IMPORT_CACHE_LIMIT) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (oldest == null) break
    cache.delete(oldest[0])
  }
  const token = randomUUID()
  cache.set(token, { body, sha256, createdAt: now })
  return token
}

export function takeCachedSubAppImportBody(
  token: string,
  now = Date.now(),
): { body: SubAppSharePackageBody; sha256: string } | undefined {
  const entry = cache.get(token)
  if (entry == null) return undefined
  cache.delete(token)
  if (now - entry.createdAt >= SUB_APP_IMPORT_CACHE_TTL_MS) return undefined
  return { body: entry.body, sha256: entry.sha256 }
}
