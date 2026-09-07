import { describe, expect, it } from 'vitest'
import type { SubAppSharePackageBody } from '@spark/protocol'
import {
  cacheSubAppImportBody,
  SUB_APP_IMPORT_CACHE_TTL_MS,
  takeCachedSubAppImportBody,
} from './SubAppImportCache.js'

const body = {} as SubAppSharePackageBody

describe('SubAppImportCache', () => {
  it('rejects a token at the TTL boundary and consumes valid tokens once', () => {
    const createdAt = 1_000
    const token = cacheSubAppImportBody(body, 'sha', createdAt)

    expect(
      takeCachedSubAppImportBody(token, createdAt + SUB_APP_IMPORT_CACHE_TTL_MS),
    ).toBeUndefined()

    const validToken = cacheSubAppImportBody(body, 'sha-2', createdAt)
    expect(
      takeCachedSubAppImportBody(validToken, createdAt + SUB_APP_IMPORT_CACHE_TTL_MS - 1),
    ).toEqual({
      body,
      sha256: 'sha-2',
    })
    expect(takeCachedSubAppImportBody(validToken, createdAt + 1)).toBeUndefined()
  })
})
