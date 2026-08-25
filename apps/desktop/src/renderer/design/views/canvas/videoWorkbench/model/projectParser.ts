import { z } from 'zod'
import { migrateVideoWorkbenchV1 } from './projectMigration'
import {
  VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION,
  createDefaultVideoWorkbenchProject,
  type VideoWorkbenchClip,
  type VideoWorkbenchProjectV2,
  type VideoWorkbenchResourceV2,
  type VideoWorkbenchTrack,
} from './projectTypes'
import { canPlaceVideoWorkbenchResourceOnTrack } from './trackRules'

const IdSchema = z.string().min(1).max(300)
const NonNegativeNumberSchema = z.number().finite().min(0)
const PositiveNumberSchema = z.number().finite().positive()
const ColorSchema = z.string().min(1).max(100)

const ResourceSchema: z.ZodType<VideoWorkbenchResourceV2> = z.object({
  id: IdSchema,
  source: z.enum(['upstream', 'canvas', 'local']),
  kind: z.enum(['video', 'image', 'audio']),
  title: z.string().min(1).max(1000),
  url: z.string().min(1).max(8192),
  originPath: z.string().min(1).max(8192),
  importedAt: NonNegativeNumberSchema,
  mimeType: z.string().min(1).max(300).optional(),
  thumbnailUrl: z.string().min(1).max(8192).optional(),
  durationSec: NonNegativeNumberSchema.optional(),
  width: NonNegativeNumberSchema.optional(),
  height: NonNegativeNumberSchema.optional(),
  fileSize: NonNegativeNumberSchema.optional(),
  hasAudio: z.boolean().optional(),
  upstreamNodeId: IdSchema.optional(),
  upstreamArtifactIndex: z.number().int().min(0).optional(),
  missing: z.boolean().optional(),
  waveformCacheKey: z.string().min(1).max(1000).optional(),
})

const CropSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: PositiveNumberSchema.max(1),
  height: PositiveNumberSchema.max(1),
})

const ClipSchema: z.ZodType<VideoWorkbenchClip> = z
  .object({
    id: IdSchema,
    resourceId: IdSchema.optional(),
    timelineStartSec: NonNegativeNumberSchema,
    sourceInSec: NonNegativeNumberSchema,
    sourceOutSec: NonNegativeNumberSchema,
    durationSec: NonNegativeNumberSchema,
    speed: z.number().finite().min(0.25).max(4),
    enabled: z.boolean(),
    linkedGroupId: IdSchema.optional(),
    transform: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        scaleX: PositiveNumberSchema.max(100),
        scaleY: PositiveNumberSchema.max(100),
        rotationDeg: z.number().finite().min(-3600).max(3600),
        opacity: z.number().finite().min(0).max(1),
        mirrorX: z.boolean(),
        mirrorY: z.boolean(),
        crop: CropSchema.optional(),
      })
      .optional(),
    audio: z
      .object({
        gainDb: z.number().finite().min(-60).max(24),
        muted: z.boolean(),
        balance: z.number().finite().min(-1).max(1),
        preservePitch: z.boolean(),
      })
      .optional(),
    fadeInSec: NonNegativeNumberSchema.optional(),
    fadeOutSec: NonNegativeNumberSchema.optional(),
    text: z
      .object({
        content: z.string().max(20_000),
        fontFamily: z.string().min(1).max(300),
        fontSize: PositiveNumberSchema.max(1000),
        color: ColorSchema,
        align: z.enum(['left', 'center', 'right']),
        backgroundColor: ColorSchema.optional(),
        strokeColor: ColorSchema.optional(),
        strokeWidth: NonNegativeNumberSchema.max(100).optional(),
      })
      .optional(),
  })
  .superRefine((clip, context) => {
    if (clip.sourceOutSec < clip.sourceInSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceOutSec'],
        message: 'sourceOutSec must be greater than or equal to sourceInSec',
      })
    }
    if (clip.fadeInSec != null && clip.fadeInSec > clip.durationSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fadeInSec'],
        message: 'fade-in exceeds clip duration',
      })
    }
    if (clip.fadeOutSec != null && clip.fadeOutSec > clip.durationSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fadeOutSec'],
        message: 'fade-out exceeds clip duration',
      })
    }
  })

const TrackMetaSchema = z.object({
  id: IdSchema,
  kind: z.enum(['video', 'overlay', 'audio', 'text', 'subtitle']),
  name: z.string().min(1).max(300),
  order: z.number().int().min(0),
  locked: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
  visible: z.boolean(),
  collapsed: z.boolean(),
})

const ProjectEnvelopeSchema = z.object({
  schemaVersion: z.literal(VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION),
  project: z.object({
    width: z.number().int().min(16).max(16384),
    height: z.number().int().min(16).max(16384),
    fps: z.number().finite().min(1).max(240),
    backgroundColor: ColorSchema,
    defaultImageDurationSec: PositiveNumberSchema.max(3600),
    audioSampleRate: z.number().int().min(8000).max(384000),
    magneticMainTrack: z.boolean(),
  }),
  sourceVideoAssetId: IdSchema.optional(),
  probeInfo: z
    .object({
      durationSec: NonNegativeNumberSchema,
      width: NonNegativeNumberSchema,
      height: NonNegativeNumberSchema,
      fps: NonNegativeNumberSchema,
      videoCodec: z.string().max(300),
      audioCodec: z.string().max(300).nullable(),
      hasAudio: z.boolean(),
      bitrate: NonNegativeNumberSchema,
      fileSize: NonNegativeNumberSchema,
    })
    .optional(),
  extractConfig: z.object({
    strategy: z.enum(['scene', 'iframe', 'uniform']),
    threshold: z.number().finite().min(0).max(1),
    intervalSec: z.number().finite().min(0.2).max(86_400),
    maxFrames: z.number().int().min(1).max(500),
  }),
  cover: z
    .object({
      source: z.enum(['playhead', 'resource', 'local']),
      imagePath: z.string().min(1).max(8192),
      previewUrl: z.string().min(1).max(8192),
      resourceId: IdSchema.optional(),
      clipId: IdSchema.optional(),
      timestampSec: NonNegativeNumberSchema.optional(),
      crop: CropSchema.optional(),
    })
    .optional(),
  keyframes: z
    .array(
      z.object({
        path: z.string().min(1).max(8192),
        previewUrl: z.string().min(1).max(8192),
        timestampSec: NonNegativeNumberSchema,
        index: z.number().int().min(0),
        canvasNodeId: z.string().nullable().optional(),
      }),
    )
    .max(10_000),
  outputs: z
    .array(
      z.object({
        id: IdSchema,
        type: z.enum(['keyframes', 'trim', 'segment', 'concat', 'transcode', 'effect', 'audio']),
        outputPath: z.string().min(1).max(8192),
        outputUrl: z.string().min(1).max(8192),
        canvasNodeId: z.string().optional(),
        createdAt: NonNegativeNumberSchema,
        summary: z.string().max(2000),
      }),
    )
    .max(1000),
  manualMarks: z.array(NonNegativeNumberSchema).max(10_000),
  autoCollectUpstream: z.boolean(),
  ui: z.object({
    activeTab: z.enum(['resources', 'frames', 'edit', 'output']),
    zoomPxPerSec: PositiveNumberSchema.max(2000),
    scrollLeftSec: NonNegativeNumberSchema,
    timelineHeightPx: z.number().finite().min(120).max(1200),
    snappingEnabled: z.boolean(),
  }),
})

export type VideoWorkbenchProjectReadResult =
  | {
      source: 'empty' | 'v1' | 'v2'
      project: VideoWorkbenchProjectV2
      issues: string[]
    }
  | {
      source: 'unsupported'
      project: null
      issues: string[]
    }

export function readVideoWorkbenchProject(raw: unknown): VideoWorkbenchProjectReadResult {
  if (raw === undefined || raw === null) {
    return { source: 'empty', project: createDefaultVideoWorkbenchProject(), issues: [] }
  }
  if (!isRecord(raw)) {
    return {
      source: 'empty',
      project: createDefaultVideoWorkbenchProject(),
      issues: ['project payload is not an object'],
    }
  }
  if (raw.schemaVersion === VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION) {
    const parsed = parseVideoWorkbenchProjectV2(raw)
    return parsed.project
      ? { source: 'v2', project: parsed.project, issues: parsed.issues }
      : { source: 'unsupported', project: null, issues: parsed.issues }
  }
  if (typeof raw.schemaVersion === 'number') {
    return {
      source: 'unsupported',
      project: null,
      issues: [`unsupported video workbench schemaVersion ${raw.schemaVersion}`],
    }
  }
  const migrated = migrateVideoWorkbenchV1(raw)
  return { source: 'v1', project: migrated.project, issues: migrated.issues }
}

export function parseVideoWorkbenchProjectV2(raw: Record<string, unknown>): {
  project: VideoWorkbenchProjectV2 | null
  issues: string[]
} {
  const issues: string[] = []
  const resources = parseUniqueItems(raw.resources, ResourceSchema, 'resources', issues)
  const tracks = parseTracks(raw.tracks, issues)
  validateProjectReferences(resources, tracks, issues)
  const parsed = ProjectEnvelopeSchema.safeParse({
    ...raw,
    resources: undefined,
    tracks: undefined,
  })
  if (!parsed.success) {
    return {
      project: null,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }
  }
  return {
    project: {
      ...parsed.data,
      keyframes: parsed.data.keyframes.map((keyframe) => ({
        path: keyframe.path,
        previewUrl: keyframe.previewUrl,
        timestampSec: keyframe.timestampSec,
        index: keyframe.index,
        ...(keyframe.canvasNodeId !== undefined ? { canvasNodeId: keyframe.canvasNodeId } : {}),
      })),
      outputs: parsed.data.outputs.map((output) => ({
        id: output.id,
        type: output.type,
        outputPath: output.outputPath,
        outputUrl: output.outputUrl,
        createdAt: output.createdAt,
        summary: output.summary,
        ...(output.canvasNodeId !== undefined ? { canvasNodeId: output.canvasNodeId } : {}),
      })),
      resources,
      tracks,
    },
    issues,
  }
}

function validateProjectReferences(
  resources: VideoWorkbenchResourceV2[],
  tracks: VideoWorkbenchTrack[],
  issues: string[],
): void {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      const resource = clip.resourceId ? resourcesById.get(clip.resourceId) : undefined
      if (clip.resourceId && !resource) {
        issues.push(
          `tracks[${trackIndex}].clips[${clipIndex}] references missing resource ${clip.resourceId}`,
        )
        return
      }
      if (!canPlaceVideoWorkbenchResourceOnTrack(resource?.kind, track.kind, clip)) {
        issues.push(
          `tracks[${trackIndex}].clips[${clipIndex}] is incompatible with ${track.kind} track`,
        )
      }
    })
  })
}

function parseTracks(value: unknown, issues: string[]): VideoWorkbenchTrack[] {
  if (!Array.isArray(value)) {
    issues.push('tracks must be an array')
    return []
  }
  const trackIds = new Set<string>()
  const clipIds = new Set<string>()
  const tracks: VideoWorkbenchTrack[] = []
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`tracks[${index}] is invalid`)
      return
    }
    const meta = TrackMetaSchema.safeParse(entry)
    if (!meta.success) {
      issues.push(`tracks[${index}] is invalid`)
      return
    }
    if (trackIds.has(meta.data.id)) {
      issues.push(`tracks[${index}] duplicates id ${meta.data.id}`)
      return
    }
    trackIds.add(meta.data.id)
    const clips = parseUniqueItems(
      entry.clips,
      ClipSchema,
      `tracks[${index}].clips`,
      issues,
      clipIds,
    )
    tracks.push({ ...meta.data, clips })
  })
  return tracks.sort((left, right) => left.order - right.order)
}

function parseUniqueItems<T extends { id: string }>(
  value: unknown,
  schema: z.ZodType<T>,
  path: string,
  issues: string[],
  existingIds = new Set<string>(),
): T[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`)
    return []
  }
  const items: T[] = []
  value.forEach((entry, index) => {
    const parsed = schema.safeParse(entry)
    if (!parsed.success) {
      issues.push(`${path}[${index}] is invalid`)
      return
    }
    if (existingIds.has(parsed.data.id)) {
      issues.push(`${path}[${index}] duplicates id ${parsed.data.id}`)
      return
    }
    existingIds.add(parsed.data.id)
    items.push(parsed.data)
  })
  return items
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
