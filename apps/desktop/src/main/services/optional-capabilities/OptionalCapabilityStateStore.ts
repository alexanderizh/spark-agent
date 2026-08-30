import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OptionalCapabilityErrorCode, OptionalCapabilityId } from '@spark/protocol'
import type { SparkInstallManifest } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'

export interface ActiveCapabilityState {
  schemaVersion: 1
  capabilityId: OptionalCapabilityId
  version: string
  autoUpdate: boolean
  activatedAt: string
  runtimeFailure?: {
    code: OptionalCapabilityErrorCode
    message: string
    retryable: boolean
    reportedAt: string
  }
  artifacts: Record<
    string,
    {
      version: string
      sha256: string
      manifestSha256: string
      directory: string
      size: number
    }
  >
}

export interface OptionalCapabilityManifestCache {
  schemaVersion: 1
  checkedAt: string
  manifest: SparkInstallManifest
}

export class OptionalCapabilityStateStore {
  constructor(private readonly root: string) {}

  capabilityRoot(id: OptionalCapabilityId): string {
    return join(this.root, id)
  }

  async read(id: OptionalCapabilityId): Promise<ActiveCapabilityState | null> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.capabilityRoot(id), 'active.json'), 'utf8'),
      ) as Partial<ActiveCapabilityState>
      if (
        parsed.schemaVersion !== 1 ||
        parsed.capabilityId !== id ||
        typeof parsed.version !== 'string' ||
        typeof parsed.autoUpdate !== 'boolean' ||
        (parsed.runtimeFailure != null &&
          (typeof parsed.runtimeFailure !== 'object' ||
            parsed.runtimeFailure.code !== 'package_invalid' ||
            typeof parsed.runtimeFailure.message !== 'string' ||
            typeof parsed.runtimeFailure.retryable !== 'boolean' ||
            typeof parsed.runtimeFailure.reportedAt !== 'string')) ||
        !parsed.artifacts ||
        typeof parsed.artifacts !== 'object' ||
        !Object.values(parsed.artifacts).every(
          (artifact) =>
            artifact != null &&
            typeof artifact === 'object' &&
            typeof artifact.version === 'string' &&
            /^[0-9a-f]{64}$/i.test(String(artifact.sha256 ?? '')) &&
            /^[0-9a-f]{64}$/i.test(String(artifact.manifestSha256 ?? '')) &&
            typeof artifact.directory === 'string' &&
            Number.isSafeInteger(artifact.size) &&
            Number(artifact.size) > 0,
        )
      ) {
        throw new Error(`Invalid active state for ${id}`)
      }
      return parsed as ActiveCapabilityState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(state: ActiveCapabilityState): Promise<void> {
    const target = join(this.capabilityRoot(state.capabilityId), 'active.json')
    const temporary = `${target}.new`
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  async readManifestCache(): Promise<OptionalCapabilityManifestCache | null> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.root, 'manifest-cache.json'), 'utf8'),
      ) as Partial<OptionalCapabilityManifestCache>
      if (
        parsed.schemaVersion !== 1 ||
        typeof parsed.checkedAt !== 'string' ||
        !parsed.manifest ||
        !Array.isArray(parsed.manifest.artifacts)
      ) {
        throw new Error('Invalid optional capability manifest cache')
      }
      return parsed as OptionalCapabilityManifestCache
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async writeManifestCache(cache: OptionalCapabilityManifestCache): Promise<void> {
    const target = join(this.root, 'manifest-cache.json')
    const temporary = `${target}.new`
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  async readAutoUpdate(id: OptionalCapabilityId): Promise<boolean | null> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.root, 'auto-update.json'), 'utf8'),
      ) as Record<string, unknown>
      return typeof parsed[id] === 'boolean' ? parsed[id] : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
  }

  async writeAutoUpdate(id: OptionalCapabilityId, enabled: boolean): Promise<void> {
    let preferences: Record<string, boolean> = {}
    try {
      const parsed = JSON.parse(
        await readFile(join(this.root, 'auto-update.json'), 'utf8'),
      ) as Record<string, unknown>
      preferences = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'boolean') preferences[key] = value
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    preferences[id] = enabled
    const target = join(this.root, 'auto-update.json')
    const temporary = `${target}.new`
    await mkdir(this.root, { recursive: true })
    await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  async remove(id: OptionalCapabilityId): Promise<void> {
    await rm(this.capabilityRoot(id), { recursive: true, force: true })
  }
}
