import { randomBytes } from 'node:crypto'

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_GRANTS = 2_000
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43,128}$/

interface PreviewGrant {
  snapshotId: string
  sessionId: string | null
  turnId: string | null
  expiresAt: number
}

export interface SnapshotPreviewCapability {
  token: string
  previewUrl: string
  expiresAt: string
}

export class SnapshotPreviewCapabilityService {
  private readonly grants = new Map<string, PreviewGrant>()
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly ttlMs: number
  private readonly maxGrants: number

  constructor(
    options: {
      now?: () => number
      createToken?: () => string
      ttlMs?: number
      maxGrants?: number
    } = {},
  ) {
    this.now = options.now ?? Date.now
    this.createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'))
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxGrants = options.maxGrants ?? DEFAULT_MAX_GRANTS
    if (this.ttlMs < 1_000 || this.ttlMs > 60 * 60_000) {
      throw new Error('Snapshot preview capability TTL is outside the supported range')
    }
    if (!Number.isSafeInteger(this.maxGrants) || this.maxGrants < 1) {
      throw new Error('Snapshot preview capability limit must be a positive integer')
    }
  }

  issue(input: {
    snapshotId: string
    sessionId: string | null
    turnId: string | null
  }): SnapshotPreviewCapability {
    validateSnapshotId(input.snapshotId)
    const now = this.now()
    this.removeExpired(now)
    const token = this.uniqueToken()
    const expiresAt = now + this.ttlMs
    this.grants.set(token, { ...input, expiresAt })
    this.trim()
    return {
      token,
      previewUrl: snapshotPreviewUrl(input.snapshotId, token),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  authorize(snapshotId: string, token: string): boolean {
    if (!CAPABILITY_TOKEN.test(token)) return false
    const grant = this.grants.get(token)
    if (grant == null) return false
    if (grant.expiresAt <= this.now()) {
      this.grants.delete(token)
      return false
    }
    return grant.snapshotId === snapshotId
  }

  revokeSession(sessionId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token)
    }
  }

  revokeSnapshot(snapshotId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.snapshotId === snapshotId) this.grants.delete(token)
    }
  }

  private uniqueToken(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = this.createToken()
      if (!CAPABILITY_TOKEN.test(token)) {
        throw new Error('Snapshot preview capability generator returned an invalid token')
      }
      if (!this.grants.has(token)) return token
    }
    throw new Error('Snapshot preview capability token collision')
  }

  private removeExpired(now: number): void {
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token)
    }
  }

  private trim(): void {
    while (this.grants.size > this.maxGrants) {
      const oldest = this.grants.keys().next().value
      if (oldest == null) break
      this.grants.delete(oldest)
    }
  }
}

export function snapshotPreviewUrl(snapshotId: string, token: string): string {
  validateSnapshotId(snapshotId)
  if (!CAPABILITY_TOKEN.test(token)) throw new Error('Invalid snapshot preview capability')
  return `spark-snapshot://snapshot/${encodeURIComponent(snapshotId)}/preview?cap=${token}`
}

function validateSnapshotId(snapshotId: string): void {
  if (
    snapshotId.length < 1 ||
    snapshotId.length > 200 ||
    snapshotId.trim() !== snapshotId ||
    containsControlCharacters(snapshotId)
  ) {
    throw new Error('Invalid snapshot ID')
  }
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}

let activeCapabilities: SnapshotPreviewCapabilityService | null = null

export function getSnapshotPreviewCapabilityService(): SnapshotPreviewCapabilityService {
  activeCapabilities ??= new SnapshotPreviewCapabilityService()
  return activeCapabilities
}
