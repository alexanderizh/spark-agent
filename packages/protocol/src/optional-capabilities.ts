export type OptionalCapabilityId = 'office-viewer' | 'local-depth'

export type OptionalCapabilityPhase =
  | 'checking'
  | 'missing'
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'activating'
  | 'cancelled'
  | 'ready'
  | 'update_available'
  | 'damaged'
  | 'error'

export type OptionalCapabilityErrorCode =
  | 'manifest_unavailable'
  | 'artifact_unavailable'
  | 'artifact_invalid'
  | 'download_failed'
  | 'package_invalid'
  | 'activation_failed'
  | 'cancelled'
  | 'internal_error'

export interface OptionalCapabilityItem {
  id: OptionalCapabilityId
  displayName: string
  description: string
  state: OptionalCapabilityPhase
  installedVersion: string | null
  targetVersion: string | null
  downloadSize: number
  installedSize: number | null
  autoUpdate: boolean
  error?: string
  errorCode?: OptionalCapabilityErrorCode
  retryable?: boolean
  entryUrl?: string
}

export interface OptionalCapabilitySnapshot {
  capabilities: OptionalCapabilityItem[]
  checkedAt: string
  manifestUpdatedAt: string | null
  remoteAvailable: boolean
}

export interface OptionalCapabilityProgress {
  capabilityId: OptionalCapabilityId
  displayName: string
  phase: OptionalCapabilityPhase
  downloaded: number
  total: number
  percent: number | null
  queuePosition: number
  message: string
  version?: string
  errorCode?: OptionalCapabilityErrorCode
  retryable?: boolean
}

export interface OptionalCapabilityListRequest {}
export type OptionalCapabilityListResponse = OptionalCapabilitySnapshot

export interface OptionalCapabilityCheckRequest {
  forceRemote?: boolean
}
export type OptionalCapabilityCheckResponse = OptionalCapabilitySnapshot

export interface OptionalCapabilityMutationRequest {
  capabilityId: OptionalCapabilityId
}

export interface OptionalCapabilityMutationResponse {
  success: boolean
  message: string
  errorCode?: OptionalCapabilityErrorCode
  snapshot: OptionalCapabilitySnapshot
}

export interface OptionalCapabilitySetAutoUpdateRequest {
  capabilityId: OptionalCapabilityId
  enabled: boolean
}

export type OptionalCapabilitySetAutoUpdateResponse = OptionalCapabilitySnapshot
