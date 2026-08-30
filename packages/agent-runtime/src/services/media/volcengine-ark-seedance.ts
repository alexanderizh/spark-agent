/**
 * Seedance model-family switches shared by validation and the native Ark adapter.
 * Keep these checks here so a newly added model cannot accidentally be treated as
 * a legacy 1.x model in one layer and a 2.x model in another.
 */

export interface SeedanceReferenceLimits {
  maxImages: number
  maxVideos: number
  maxAudios: number
  maxTotal: number
  /** Reference duration is not published for Seedance 2.5; omit to let Ark validate it. */
  maxDurationMs?: number
}

const SEEDANCE_2_LIMITS: SeedanceReferenceLimits = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxTotal: 15,
  maxDurationMs: 15_000,
}

const SEEDANCE_25_LIMITS: SeedanceReferenceLimits = {
  maxImages: 30,
  maxVideos: 10,
  maxAudios: 10,
  maxTotal: 50,
}

export function isSeedance25Model(modelId: string): boolean {
  return modelId.startsWith('doubao-seedance-2-5-')
}

export function isSeedance20Model(modelId: string): boolean {
  return modelId.startsWith('doubao-seedance-2-0-')
}

export function isSeedance2xModel(modelId: string): boolean {
  return isSeedance20Model(modelId) || isSeedance25Model(modelId)
}

export function seedanceReferenceLimits(modelId: string): SeedanceReferenceLimits | undefined {
  if (isSeedance25Model(modelId)) return SEEDANCE_25_LIMITS
  if (isSeedance20Model(modelId)) return SEEDANCE_2_LIMITS
  return undefined
}
