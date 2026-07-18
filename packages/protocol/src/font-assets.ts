/** Managed desktop webfont state shared by main, preload and renderer. */

export type ManagedFontAssetState = 'missing' | 'downloading' | 'ready' | 'error'

export interface ManagedFontFaceSource {
  family: 'Geist' | 'Geist Mono' | 'HarmonyOS Sans SC'
  url: string
  format: 'woff2' | 'opentype'
  weight: string
  style: 'normal' | 'italic'
}

export interface FontAssetsStatusRequest {}

export interface FontAssetsStatusResponse {
  state: ManagedFontAssetState
  version: string | null
  percent: number | null
  message: string
  lastError: string | null
  fonts: ManagedFontFaceSource[]
}

export interface FontAssetsInstallRequest {
  /** Manual retries force a fresh verified download even when the same version is active. */
  force?: boolean
}

export interface FontAssetsInstallResponse {
  success: boolean
  message: string
  status: FontAssetsStatusResponse
}
