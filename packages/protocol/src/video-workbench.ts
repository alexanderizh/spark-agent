import { z } from 'zod'

export const VIDEO_WORKBENCH_RENDER_PLAN_VERSION = 1 as const

const IdSchema = z.string().min(1).max(300)
const PathSchema = z.string().min(1).max(8192)
const NonNegativeNumberSchema = z.number().finite().min(0)
const PositiveNumberSchema = z.number().finite().positive()

export const VideoWorkbenchRenderInputSchema = z.object({
  id: IdSchema,
  kind: z.enum(['video', 'image', 'audio']),
  path: PathSchema,
  durationSec: NonNegativeNumberSchema.optional(),
  hasAudio: z.boolean().optional(),
})

const VideoWorkbenchRenderClipTimingSchema = z
  .object({
    id: IdSchema,
    inputId: IdSchema,
    timelineStartSec: NonNegativeNumberSchema,
    durationSec: PositiveNumberSchema.max(86_400),
    sourceInSec: NonNegativeNumberSchema,
    sourceOutSec: NonNegativeNumberSchema,
    speed: z.number().finite().min(0.25).max(4),
    fadeInSec: NonNegativeNumberSchema.max(86_400).optional(),
    fadeOutSec: NonNegativeNumberSchema.max(86_400).optional(),
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
        message: 'fadeInSec exceeds durationSec',
      })
    }
    if (clip.fadeOutSec != null && clip.fadeOutSec > clip.durationSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fadeOutSec'],
        message: 'fadeOutSec exceeds durationSec',
      })
    }
  })

const NormalizedCropSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: PositiveNumberSchema.max(1),
  height: PositiveNumberSchema.max(1),
})

export const VideoWorkbenchVisualRenderClipSchema = VideoWorkbenchRenderClipTimingSchema.and(
  z.object({
    kind: z.enum(['video', 'image']),
    transform: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      scaleX: PositiveNumberSchema.max(100),
      scaleY: PositiveNumberSchema.max(100),
      rotationDeg: z.number().finite().min(-3600).max(3600),
      opacity: z.number().finite().min(0).max(1),
      mirrorX: z.boolean(),
      mirrorY: z.boolean(),
      crop: NormalizedCropSchema.optional(),
    }),
  }),
)

export const VideoWorkbenchAudioRenderClipSchema = VideoWorkbenchRenderClipTimingSchema.and(
  z.object({
    kind: z.literal('audio'),
    gainDb: z.number().finite().min(-60).max(24),
    muted: z.boolean(),
    balance: z.number().finite().min(-1).max(1),
    preservePitch: z.boolean(),
  }),
)

export const VideoWorkbenchTextRenderClipSchema = z.object({
  id: IdSchema,
  kind: z.enum(['text', 'subtitle']),
  timelineStartSec: NonNegativeNumberSchema,
  durationSec: PositiveNumberSchema.max(86_400),
  content: z.string().min(1).max(20_000),
  fontFamily: z.string().min(1).max(300),
  fontSize: PositiveNumberSchema.max(1000),
  color: z.string().min(1).max(100),
  align: z.enum(['left', 'center', 'right']),
  x: z.number().finite(),
  y: z.number().finite(),
  backgroundColor: z.string().min(1).max(100).optional(),
  strokeColor: z.string().min(1).max(100).optional(),
  strokeWidth: NonNegativeNumberSchema.max(100).optional(),
})

const VideoWorkbenchVisualRenderTrackSchema = z.object({
  id: IdSchema,
  kind: z.enum(['video', 'overlay']),
  order: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
  clips: z.array(VideoWorkbenchVisualRenderClipSchema).max(5000),
})

const VideoWorkbenchAudioRenderTrackSchema = z.object({
  id: IdSchema,
  kind: z.literal('audio'),
  order: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
  clips: z.array(VideoWorkbenchAudioRenderClipSchema).max(5000),
})

const VideoWorkbenchTextRenderTrackSchema = z.object({
  id: IdSchema,
  kind: z.enum(['text', 'subtitle']),
  order: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
  clips: z.array(VideoWorkbenchTextRenderClipSchema).max(5000),
})

export const VideoWorkbenchRenderTrackSchema = z.union([
  VideoWorkbenchVisualRenderTrackSchema,
  VideoWorkbenchAudioRenderTrackSchema,
  VideoWorkbenchTextRenderTrackSchema,
])

export const VideoWorkbenchRenderPlanSchema = z
  .object({
    renderPlanVersion: z.literal(VIDEO_WORKBENCH_RENDER_PLAN_VERSION),
    project: z.object({
      width: z.number().int().min(16).max(16384),
      height: z.number().int().min(16).max(16384),
      fps: z.number().finite().min(1).max(240),
      backgroundColor: z.string().min(1).max(100),
      audioSampleRate: z.number().int().min(8000).max(384000),
    }),
    range: z.object({
      startSec: NonNegativeNumberSchema,
      endSec: PositiveNumberSchema.max(86_400),
    }),
    inputs: z.array(VideoWorkbenchRenderInputSchema).max(500),
    tracks: z.array(VideoWorkbenchRenderTrackSchema).max(100),
    output: z.object({
      path: PathSchema,
      container: z.enum(['mp4', 'mov', 'webm']),
      videoCodec: z.enum([
        'libx264',
        'libx265',
        'libvpx-vp9',
        'h264_videotoolbox',
        'h264_nvenc',
        'h264_qsv',
      ]),
      audioCodec: z.enum(['aac', 'libopus', 'none']),
      crf: z.number().int().min(0).max(63).optional(),
      pixelFormat: z.enum(['yuv420p', 'yuv420p10le']).default('yuv420p'),
    }),
  })
  .superRefine((plan, context) => {
    if (plan.range.endSec <= plan.range.startSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range', 'endSec'],
        message: 'render range must have positive duration',
      })
    }

    const webmCodecsValid =
      plan.output.videoCodec === 'libvpx-vp9' &&
      (plan.output.audioCodec === 'libopus' || plan.output.audioCodec === 'none')
    const isoMediaCodecsValid =
      plan.output.videoCodec !== 'libvpx-vp9' &&
      (plan.output.audioCodec === 'aac' || plan.output.audioCodec === 'none')
    if (
      (plan.output.container === 'webm' && !webmCodecsValid) ||
      (plan.output.container !== 'webm' && !isoMediaCodecsValid)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['output'],
        message: 'output codecs are incompatible with the selected container',
      })
    }

    const inputsById = new Map<string, z.infer<typeof VideoWorkbenchRenderInputSchema>>()
    plan.inputs.forEach((input, index) => {
      if (inputsById.has(input.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['inputs', index, 'id'],
          message: `duplicate input id ${input.id}`,
        })
      }
      inputsById.set(input.id, input)
    })

    const trackIds = new Set<string>()
    const clipIds = new Set<string>()
    plan.tracks.forEach((track, trackIndex) => {
      if (trackIds.has(track.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', trackIndex, 'id'],
          message: `duplicate track id ${track.id}`,
        })
      }
      trackIds.add(track.id)
      track.clips.forEach((clip, clipIndex) => {
        if (clipIds.has(clip.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'clips', clipIndex, 'id'],
            message: `duplicate clip id ${clip.id}`,
          })
        }
        clipIds.add(clip.id)
        if (!('inputId' in clip)) return
        const input = inputsById.get(clip.inputId)
        if (!input) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'clips', clipIndex, 'inputId'],
            message: `missing input ${clip.inputId}`,
          })
          return
        }
        const compatible =
          (clip.kind === 'audio' && (input.kind === 'audio' || input.kind === 'video')) ||
          (clip.kind === 'video' && input.kind === 'video') ||
          (clip.kind === 'image' && input.kind === 'image')
        if (!compatible) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'clips', clipIndex, 'inputId'],
            message: `input ${clip.inputId} is incompatible with ${clip.kind} clip`,
          })
        }
        if (input.kind !== 'image' && clip.sourceOutSec <= clip.sourceInSec) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'clips', clipIndex, 'sourceOutSec'],
            message: 'media clip source range must have positive duration',
          })
        }
        if (input.durationSec != null && clip.sourceOutSec > input.durationSec + 0.000_001) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'clips', clipIndex, 'sourceOutSec'],
            message: `clip source range exceeds input ${clip.inputId} duration`,
          })
        }
      })
    })
  })

export type VideoWorkbenchRenderPlan = z.infer<typeof VideoWorkbenchRenderPlanSchema>
export type VideoWorkbenchRenderInput = z.infer<typeof VideoWorkbenchRenderInputSchema>
export type VideoWorkbenchRenderTrack = z.infer<typeof VideoWorkbenchRenderTrackSchema>

export const VIDEO_WORKBENCH_FFMPEG_FILTERS = [
  'overlay',
  'scale',
  'crop',
  'volume',
  'amix',
  'atempo',
  'fade',
  'afade',
  'xfade',
  'acrossfade',
  'subtitles',
  'ass',
  'drawtext',
  'loudnorm',
  'afftdn',
  'sidechaincompress',
  'chromakey',
  'lut3d',
  'boxblur',
] as const

export const VIDEO_WORKBENCH_FFMPEG_ENCODERS = [
  'libx264',
  'libx265',
  'libvpx-vp9',
  'aac',
  'libopus',
  'h264_videotoolbox',
  'h264_nvenc',
  'h264_qsv',
] as const

export type VideoWorkbenchFfmpegFilter = (typeof VIDEO_WORKBENCH_FFMPEG_FILTERS)[number]
export type VideoWorkbenchFfmpegEncoder = (typeof VIDEO_WORKBENCH_FFMPEG_ENCODERS)[number]

export interface VideoWorkbenchFfmpegCapabilities {
  available: boolean
  source: 'managed' | 'system' | 'none'
  version: string | null
  filters: Record<VideoWorkbenchFfmpegFilter, boolean>
  encoders: Record<VideoWorkbenchFfmpegEncoder, boolean>
  checkedAt: string
  error?: string
}

export interface VideoWorkbenchFfmpegCapabilitiesRequest {}

export interface VideoWorkbenchIpcChannelMap {
  'video-workbench:get-ffmpeg-capabilities': [
    VideoWorkbenchFfmpegCapabilitiesRequest,
    VideoWorkbenchFfmpegCapabilities,
  ]
}
