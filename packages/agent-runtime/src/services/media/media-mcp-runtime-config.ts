import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  MediaModelManifestRepository,
  ProviderProfileRepository,
  type SparkDatabase,
} from '@spark/storage'
import {
  isMediaProviderKind,
  type MediaModelManifest,
  type MediaProviderKind,
  type ProviderMediaModelRef,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import { MediaModelCatalogService } from './media-model-catalog.service.js'
import { resolveProfileMediaModels, type MediaProfileLike } from './media-model-resolver.js'

const log = createLogger('media-mcp-runtime-config')
let mediaRuntimeDir: string | null = null
let cleanupRegistered = false

const MEDIA_CAPABILITIES = new Set([
  'image.generate',
  'image.edit',
  'image.variations',
  'audio.speech',
  'audio.music',
  'audio.transcription',
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
])

type MediaProviderConfig = {
  defaultModel?: string
  model?: string
  modelIds?: string[]
  apiEndpoint?: string
  modelType?: string
  imageProvider?: string | null
  imageApiType?: string | null
  mediaProvider?: string | null
  mediaApiType?: string | null
  mediaCapabilities?: string[]
  mediaDefaults?: Record<string, unknown>
  mediaModelRefs?: ProviderMediaModelRef[]
}

export type MediaMcpProviderRoute = {
  id: string
  name: string
  apiKey: string
  provider: MediaProviderKind
  model: string
  mode: string
  baseUrl?: string
  mediaDefaults: Record<string, unknown>
  capabilities: string[]
  manifests: MediaModelManifest[]
}

export type MediaMcpRuntimeFileConfig = {
  apiKeyEnv: string
  provider: MediaProviderKind
  model: string
  mode: string
  baseUrl?: string
  outputDir: string
  mediaDefaults: Record<string, unknown>
  manifests: MediaModelManifest[]
  providers: Array<Omit<MediaMcpProviderRoute, 'apiKey'> & { apiKeyEnv: string }>
}

/**
 * Windows CreateProcess has a small combined environment/command-line budget.
 * Media manifests can exceed it on their own, so only a short file path is
 * passed to SDK-managed child processes. API keys are deliberately excluded
 * and remain in short per-provider environment variables. The per-process
 * directory is private to the current OS user and removed on clean shutdown.
 */
export function writeMediaMcpRuntimeConfig(config: MediaMcpRuntimeFileConfig): string {
  const serialized = JSON.stringify(config)
  const runtimeDirectory = ensureMediaRuntimeDirectory()
  const digest = createHash('sha256').update(serialized).digest('hex')
  const filePath = path.join(runtimeDirectory, `${digest}.json`)
  try {
    writeFileSync(filePath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return filePath
}

function ensureMediaRuntimeDirectory(): string {
  if (mediaRuntimeDir != null) return mediaRuntimeDir
  mediaRuntimeDir = mkdtempSync(path.join(tmpdir(), `spark-agent-media-${process.pid}-`))
  try {
    chmodSync(mediaRuntimeDir, 0o700)
  } catch {
    // Windows ACLs are inherited from the user-scoped temporary directory.
  }
  if (cleanupRegistered) return mediaRuntimeDir
  cleanupRegistered = true
  process.once('exit', () => {
    if (mediaRuntimeDir != null) rmSync(mediaRuntimeDir, { recursive: true, force: true })
  })
  return mediaRuntimeDir
}

export async function resolveMediaMcpProviderRoutes(
  db: SparkDatabase,
): Promise<MediaMcpProviderRoute[]> {
  const providerRepo = new ProviderProfileRepository(db)
  if (typeof providerRepo.listAll !== 'function') return []
  const catalog = new MediaModelCatalogService(new MediaModelManifestRepository(db))
  catalog.seedBuiltinManifests()
  const routes: MediaMcpProviderRoute[] = []

  for (const row of providerRepo.listAll()) {
    if (row.enabled !== 1 || row.keystore_ref == null) continue
    let config: MediaProviderConfig
    try {
      config = JSON.parse(row.config_json) as MediaProviderConfig
    } catch {
      continue
    }
    if (!isMediaConfig(config, catalog)) continue
    const model = (config.defaultModel ?? config.model ?? '').trim()
    if (!model) continue
    let apiKey: string
    try {
      apiKey = await resolveProviderApiKey(row)
    } catch (error) {
      log.warn('Skipping media provider because credential resolution failed', {
        providerProfileId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!apiKey.trim()) continue
    const profile: MediaProfileLike = {
      defaultModel: model,
      modelIds: config.modelIds,
      mediaModelRefs: Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : [],
      mediaProvider: config.mediaProvider ?? legacyImageProvider(config.imageProvider),
      ...(config.modelType !== undefined ? { modelType: config.modelType } : {}),
      ...(config.mediaCapabilities !== undefined
        ? { mediaCapabilities: config.mediaCapabilities }
        : {}),
    }
    const manifests = resolveProfileMediaModels(profile, catalog, { enabledOnly: true }).map(
      (resolved) => resolved.manifest,
    )
    routes.push({
      id: row.id,
      name: row.name,
      apiKey,
      provider: resolveProviderKind(config),
      model,
      mode: config.mediaApiType ?? config.imageApiType ?? 'auto',
      ...(config.apiEndpoint?.trim() ? { baseUrl: config.apiEndpoint.trim() } : {}),
      mediaDefaults: config.mediaDefaults ?? {},
      capabilities: collectCapabilities(config, manifests),
      manifests,
    })
  }
  return routes
}

function isMediaConfig(config: MediaProviderConfig, catalog: MediaModelCatalogService): boolean {
  if (
    config.modelType === 'image' ||
    config.modelType === 'voice' ||
    config.modelType === 'video'
  ) {
    return true
  }
  if (config.mediaCapabilities?.some((capability) => MEDIA_CAPABILITIES.has(capability))) {
    return true
  }
  const profile: MediaProfileLike = {
    defaultModel: config.defaultModel ?? config.model,
    modelIds: config.modelIds,
    mediaModelRefs: config.mediaModelRefs,
    mediaProvider: config.mediaProvider ?? legacyImageProvider(config.imageProvider),
    ...(config.modelType !== undefined ? { modelType: config.modelType } : {}),
  }
  return resolveProfileMediaModels(profile, catalog, { enabledOnly: true }).some((resolved) =>
    resolved.manifest.capabilities.some((capability) => MEDIA_CAPABILITIES.has(capability.id)),
  )
}

function resolveProviderKind(config: MediaProviderConfig): MediaProviderKind {
  const candidate = config.mediaProvider ?? legacyImageProvider(config.imageProvider)
  return candidate != null && isMediaProviderKind(candidate) ? candidate : 'openai-compatible'
}

function legacyImageProvider(value: string | null | undefined): string | null {
  const candidate = value?.trim().toLowerCase()
  if (!candidate) return null
  if (candidate === 'openai') return 'openai-compatible'
  return candidate
}

function collectCapabilities(
  config: MediaProviderConfig,
  manifests: MediaModelManifest[],
): string[] {
  return [
    ...new Set([
      ...(config.mediaCapabilities ?? []),
      ...manifests.flatMap((manifest) => manifest.capabilities.map((capability) => capability.id)),
    ]),
  ]
}
