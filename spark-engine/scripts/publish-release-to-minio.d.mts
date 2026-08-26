export declare const DEFAULT_RELEASE_BASE: string

export declare class PublishError extends Error {
  constructor(message: string, options?: { readonly status?: number })
  status?: number
}

export interface SignedRequest {
  method: string
  host: string
  path: string
  headers: Record<string, string>
}

export declare function signRequest(
  request: {
    method: string
    endpointUrl: URL
    key?: string
    headers?: Record<string, string>
    payloadHash?: string
  },
  credentials: { accessKeyId: string; secretAccessKey: string; region: string; bucket: string },
  clock?: Date,
): SignedRequest

export interface PublishConfig {
  endpointUrl: URL
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: URL
}

export declare function resolvePublishConfig(env: NodeJS.ProcessEnv): PublishConfig

export declare function resolveRemoteBase(input: {
  config: { publicBaseUrl: URL }
  baseOverride?: string | undefined
}): { url: URL; keyPrefix: string }

export interface ReleaseManifestRecord {
  name: string
  version: string
  sha256: string
  tarball: string
  publishedAt?: string
}

export interface ReleaseArtifact {
  filename: string
  bytes: Buffer
  sha256: string
}

export declare function discoverReleaseArtifacts(releaseDir: string): Promise<{
  manifest: ReleaseManifestRecord
  artifacts: ReleaseArtifact[]
}>

export declare function publishRelease(input: {
  config?: PublishConfig | undefined
  remoteBase: { url: URL; keyPrefix: string }
  manifest: ReleaseManifestRecord
  artifacts: ReleaseArtifact[]
  dryRun?: boolean | undefined
  log?: ((text: string) => void) | undefined
}): Promise<{ skipped: string[]; uploaded: string[]; remoteBase?: string; version?: string }>
