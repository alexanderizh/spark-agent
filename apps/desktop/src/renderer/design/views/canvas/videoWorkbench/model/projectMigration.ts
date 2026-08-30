import {
  DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC,
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
  type VideoWorkbenchClip,
  type VideoWorkbenchProjectV2,
  type VideoWorkbenchResourceV2,
} from './projectTypes'

interface LegacyTrackClip {
  id: string
  resourceId: string
  order: number
  range?: { startSec: number; endSec: number }
  staticDuration?: number
}

export interface VideoWorkbenchMigrationResult {
  project: VideoWorkbenchProjectV2
  issues: string[]
}

/** Pure V1 -> V2 migration. It never mutates or persists the legacy payload. */
export function migrateVideoWorkbenchV1(
  raw: Record<string, unknown>,
): VideoWorkbenchMigrationResult {
  const defaults = createDefaultVideoWorkbenchProject()
  const issues: string[] = []
  const resources = readLegacyResources(raw.resourcePanel, issues)
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const legacyClips = readLegacyClips(raw.track, issues).sort(
    (left, right) => left.order - right.order,
  )
  const probeInfo = readProbeInfo(raw.probeInfo)

  let cursorSec = 0
  const clips: VideoWorkbenchClip[] = legacyClips.map((clip) => {
    const resource = resourcesById.get(clip.resourceId)
    const sourceInSec = clip.range?.startSec ?? 0
    const sourceOutSec = resolveLegacySourceOut(clip, resource, sourceInSec)
    const durationSec = resolveLegacyDuration(clip, resource, sourceInSec, sourceOutSec)
    const migrated: VideoWorkbenchClip = {
      id: clip.id,
      resourceId: clip.resourceId,
      timelineStartSec: cursorSec,
      sourceInSec,
      sourceOutSec,
      durationSec,
      speed: 1,
      enabled: true,
    }
    cursorSec += durationSec
    if (!resource)
      issues.push(`track clip ${clip.id} references missing resource ${clip.resourceId}`)
    return migrated
  })

  const mainTrack = createDefaultVideoWorkbenchTrack('video', 'track:legacy-main', '主视频')
  mainTrack.clips = clips

  return {
    project: {
      ...defaults,
      ...(isNonEmptyString(raw.sourceVideoAssetId)
        ? { sourceVideoAssetId: raw.sourceVideoAssetId }
        : {}),
      ...(probeInfo ? { probeInfo } : {}),
      extractConfig: readExtractConfig(raw.extractConfig, defaults.extractConfig),
      resources,
      tracks: [mainTrack],
      keyframes: readKeyframes(raw.keyframes, issues),
      outputs: readOutputs(raw.outputs, issues),
      manualMarks: readFiniteNumberArray(raw.manualMarks),
      autoCollectUpstream:
        typeof raw.autoCollectUpstream === 'boolean'
          ? raw.autoCollectUpstream
          : defaults.autoCollectUpstream,
      ui: {
        ...defaults.ui,
        activeTab: readActiveTab(raw.activeTab) ?? defaults.ui.activeTab,
      },
    },
    issues,
  }
}

function readLegacyResources(value: unknown, issues: string[]): VideoWorkbenchResourceV2[] {
  if (!Array.isArray(value)) return []
  const resources: VideoWorkbenchResourceV2[] = []
  const ids = new Set<string>()
  value.forEach((entry, index) => {
    const parsed = readLegacyResource(entry)
    if (!parsed) {
      issues.push(`resourcePanel[${index}] is invalid`)
      return
    }
    if (ids.has(parsed.id)) {
      issues.push(`resourcePanel[${index}] duplicates id ${parsed.id}`)
      return
    }
    ids.add(parsed.id)
    resources.push(parsed)
  })
  return resources
}

function readLegacyResource(value: unknown): VideoWorkbenchResourceV2 | null {
  if (!isRecord(value)) return null
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.url) ||
    !isNonEmptyString(value.originPath) ||
    (value.source !== 'upstream' && value.source !== 'canvas' && value.source !== 'local') ||
    (value.kind !== 'video' && value.kind !== 'image') ||
    !isNonNegativeFinite(value.importedAt)
  ) {
    return null
  }
  return {
    id: value.id,
    source: value.source,
    kind: value.kind,
    title: value.title,
    url: value.url,
    originPath: value.originPath,
    importedAt: value.importedAt,
    ...optionalString('thumbnailUrl', value.thumbnailUrl),
    ...optionalNonNegativeNumber('durationSec', value.durationSec),
    ...optionalNonNegativeNumber('width', value.width),
    ...optionalNonNegativeNumber('height', value.height),
    ...optionalNonNegativeNumber('fileSize', value.fileSize),
    ...optionalString('upstreamNodeId', value.upstreamNodeId),
    ...optionalNonNegativeNumber('upstreamArtifactIndex', value.upstreamArtifactIndex),
  }
}

function readLegacyClips(value: unknown, issues: string[]): LegacyTrackClip[] {
  if (!Array.isArray(value)) return []
  const clips: LegacyTrackClip[] = []
  const ids = new Set<string>()
  value.forEach((entry, index) => {
    const parsed = readLegacyClip(entry)
    if (!parsed) {
      issues.push(`track[${index}] is invalid`)
      return
    }
    if (ids.has(parsed.id)) {
      issues.push(`track[${index}] duplicates id ${parsed.id}`)
      return
    }
    ids.add(parsed.id)
    clips.push(parsed)
  })
  return clips
}

function readLegacyClip(value: unknown): LegacyTrackClip | null {
  if (!isRecord(value)) return null
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.resourceId) ||
    !Number.isInteger(value.order) ||
    Number(value.order) < 0
  ) {
    return null
  }
  const range = readRange(value.range)
  if (value.range !== undefined && !range) return null
  if (value.staticDuration !== undefined && !isPositiveFinite(value.staticDuration)) return null
  return {
    id: value.id,
    resourceId: value.resourceId,
    order: Number(value.order),
    ...(range ? { range } : {}),
    ...(isPositiveFinite(value.staticDuration) ? { staticDuration: value.staticDuration } : {}),
  }
}

function resolveLegacySourceOut(
  clip: LegacyTrackClip,
  resource: VideoWorkbenchResourceV2 | undefined,
  sourceInSec: number,
): number {
  if (clip.range) return clip.range.endSec
  if (resource?.kind === 'image') {
    return sourceInSec + (clip.staticDuration ?? DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC)
  }
  if (!resource) return sourceInSec
  return resource.durationSec != null && resource.durationSec > sourceInSec
    ? resource.durationSec
    : sourceInSec + DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC
}

function resolveLegacyDuration(
  clip: LegacyTrackClip,
  resource: VideoWorkbenchResourceV2 | undefined,
  sourceInSec: number,
  sourceOutSec: number,
): number {
  if (resource?.kind === 'image') {
    return clip.staticDuration ?? DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC
  }
  return Math.max(0, sourceOutSec - sourceInSec)
}

function readProbeInfo(value: unknown): VideoWorkbenchProjectV2['probeInfo'] | null {
  if (!isRecord(value)) return null
  const numericKeys = ['durationSec', 'width', 'height', 'fps', 'bitrate', 'fileSize'] as const
  if (!numericKeys.every((key) => isNonNegativeFinite(value[key]))) return null
  if (
    typeof value.videoCodec !== 'string' ||
    (value.audioCodec !== null && typeof value.audioCodec !== 'string') ||
    typeof value.hasAudio !== 'boolean'
  ) {
    return null
  }
  return {
    durationSec: value.durationSec as number,
    width: value.width as number,
    height: value.height as number,
    fps: value.fps as number,
    videoCodec: value.videoCodec,
    audioCodec: value.audioCodec,
    hasAudio: value.hasAudio,
    bitrate: value.bitrate as number,
    fileSize: value.fileSize as number,
  }
}

function readExtractConfig(
  value: unknown,
  defaults: VideoWorkbenchProjectV2['extractConfig'],
): VideoWorkbenchProjectV2['extractConfig'] {
  if (!isRecord(value)) return defaults
  const strategy =
    value.strategy === 'scene' || value.strategy === 'iframe' || value.strategy === 'uniform'
      ? value.strategy
      : defaults.strategy
  return {
    strategy,
    threshold: isNonNegativeFinite(value.threshold)
      ? Math.min(1, value.threshold)
      : defaults.threshold,
    intervalSec: isPositiveFinite(value.intervalSec)
      ? Math.max(0.2, value.intervalSec)
      : defaults.intervalSec,
    maxFrames:
      Number.isInteger(value.maxFrames) && Number(value.maxFrames) > 0
        ? Math.min(500, Number(value.maxFrames))
        : defaults.maxFrames,
  }
}

function readKeyframes(value: unknown, issues: string[]): VideoWorkbenchProjectV2['keyframes'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`keyframes[${index}] is invalid`)
      return []
    }
    if (
      !isNonEmptyString(entry.path) ||
      !isNonEmptyString(entry.previewUrl) ||
      !isNonNegativeFinite(entry.timestampSec) ||
      !Number.isInteger(entry.index) ||
      Number(entry.index) < 0
    ) {
      issues.push(`keyframes[${index}] is invalid`)
      return []
    }
    return [
      {
        path: entry.path,
        previewUrl: entry.previewUrl,
        timestampSec: entry.timestampSec,
        index: Number(entry.index),
        ...(entry.canvasNodeId === null || typeof entry.canvasNodeId === 'string'
          ? { canvasNodeId: entry.canvasNodeId }
          : {}),
      },
    ]
  })
}

function readOutputs(value: unknown, issues: string[]): VideoWorkbenchProjectV2['outputs'] {
  if (!Array.isArray(value)) return []
  const validTypes = new Set([
    'keyframes',
    'trim',
    'segment',
    'concat',
    'transcode',
    'effect',
    'audio',
  ])
  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry) ||
      !isNonEmptyString(entry.id) ||
      !validTypes.has(String(entry.type)) ||
      !isNonEmptyString(entry.outputPath) ||
      !isNonEmptyString(entry.outputUrl) ||
      !isNonNegativeFinite(entry.createdAt) ||
      typeof entry.summary !== 'string'
    ) {
      issues.push(`outputs[${index}] is invalid`)
      return []
    }
    return [
      {
        id: entry.id,
        type: entry.type as VideoWorkbenchProjectV2['outputs'][number]['type'],
        outputPath: entry.outputPath,
        outputUrl: entry.outputUrl,
        createdAt: entry.createdAt,
        summary: entry.summary,
        ...(isNonEmptyString(entry.canvasNodeId) ? { canvasNodeId: entry.canvasNodeId } : {}),
      },
    ]
  })
}

function readFiniteNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter(isNonNegativeFinite) : []
}

function readActiveTab(value: unknown): VideoWorkbenchProjectV2['ui']['activeTab'] | null {
  return value === 'resources' || value === 'frames' || value === 'edit' || value === 'output'
    ? value
    : null
}

function readRange(value: unknown): { startSec: number; endSec: number } | null {
  if (!isRecord(value)) return null
  return isNonNegativeFinite(value.startSec) &&
    isPositiveFinite(value.endSec) &&
    value.endSec > value.startSec
    ? { startSec: value.startSec, endSec: value.endSec }
    : null
}

function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [key]: value } as Partial<Record<K, string>>) : {}
}

function optionalNonNegativeNumber<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  return isNonNegativeFinite(value) ? ({ [key]: value } as Partial<Record<K, number>>) : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
