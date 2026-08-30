import type {
  KeyframeExtractConfig,
  VideoProbeInfo,
  VideoWorkbenchTab,
  WorkbenchKeyframe,
  WorkbenchOutput,
  WorkbenchResourceSource,
} from '../videoWorkbench.types'

export const VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION = 2 as const
export const DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC = 8

export type VideoWorkbenchTrackKind = 'video' | 'overlay' | 'audio' | 'text' | 'subtitle'
export type VideoWorkbenchResourceKindV2 = 'video' | 'image' | 'audio'

export interface VideoWorkbenchProjectSettings {
  width: number
  height: number
  fps: number
  backgroundColor: string
  defaultImageDurationSec: number
  audioSampleRate: number
  magneticMainTrack: boolean
}

export interface VideoWorkbenchResourceV2 {
  id: string
  source: WorkbenchResourceSource
  kind: VideoWorkbenchResourceKindV2
  title: string
  url: string
  originPath: string
  importedAt: number
  mimeType?: string | undefined
  thumbnailUrl?: string | undefined
  durationSec?: number | undefined
  width?: number | undefined
  height?: number | undefined
  fileSize?: number | undefined
  hasAudio?: boolean | undefined
  upstreamNodeId?: string | undefined
  upstreamArtifactIndex?: number | undefined
  missing?: boolean | undefined
  waveformCacheKey?: string | undefined
}

export interface VideoWorkbenchClipTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotationDeg: number
  opacity: number
  mirrorX: boolean
  mirrorY: boolean
  crop?:
    | {
        x: number
        y: number
        width: number
        height: number
      }
    | undefined
}

export interface VideoWorkbenchClipAudio {
  gainDb: number
  muted: boolean
  balance: number
  preservePitch: boolean
}

export interface VideoWorkbenchTextSettings {
  content: string
  fontFamily: string
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  backgroundColor?: string | undefined
  strokeColor?: string | undefined
  strokeWidth?: number | undefined
}

export interface VideoWorkbenchClip {
  id: string
  resourceId?: string | undefined
  timelineStartSec: number
  sourceInSec: number
  sourceOutSec: number
  /** Project duration after speed is applied. */
  durationSec: number
  speed: number
  enabled: boolean
  linkedGroupId?: string | undefined
  transform?: VideoWorkbenchClipTransform | undefined
  audio?: VideoWorkbenchClipAudio | undefined
  fadeInSec?: number | undefined
  fadeOutSec?: number | undefined
  text?: VideoWorkbenchTextSettings | undefined
}

export interface VideoWorkbenchTrack {
  id: string
  kind: VideoWorkbenchTrackKind
  name: string
  order: number
  locked: boolean
  muted: boolean
  solo: boolean
  visible: boolean
  collapsed: boolean
  clips: VideoWorkbenchClip[]
}

export interface VideoWorkbenchCover {
  source: 'playhead' | 'resource' | 'local'
  imagePath: string
  previewUrl: string
  resourceId?: string | undefined
  clipId?: string | undefined
  timestampSec?: number | undefined
  crop?: { x: number; y: number; width: number; height: number } | undefined
}

export interface VideoWorkbenchUiState {
  activeTab: VideoWorkbenchTab
  zoomPxPerSec: number
  scrollLeftSec: number
  timelineHeightPx: number
  snappingEnabled: boolean
}

export interface VideoWorkbenchProjectV2 {
  schemaVersion: typeof VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION
  project: VideoWorkbenchProjectSettings
  sourceVideoAssetId?: string | undefined
  probeInfo?: VideoProbeInfo | undefined
  extractConfig: KeyframeExtractConfig
  resources: VideoWorkbenchResourceV2[]
  tracks: VideoWorkbenchTrack[]
  cover?: VideoWorkbenchCover | undefined
  keyframes: WorkbenchKeyframe[]
  outputs: WorkbenchOutput[]
  manualMarks: number[]
  autoCollectUpstream: boolean
  ui: VideoWorkbenchUiState
}

export function createDefaultVideoWorkbenchTrack(
  kind: VideoWorkbenchTrackKind,
  id: string,
  name: string,
  order = 0,
): VideoWorkbenchTrack {
  return {
    id,
    kind,
    name,
    order,
    locked: false,
    muted: false,
    solo: false,
    visible: true,
    collapsed: false,
    clips: [],
  }
}

export function createDefaultVideoWorkbenchProject(): VideoWorkbenchProjectV2 {
  return {
    schemaVersion: VIDEO_WORKBENCH_PROJECT_SCHEMA_VERSION,
    project: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
      defaultImageDurationSec: DEFAULT_VIDEO_WORKBENCH_IMAGE_DURATION_SEC,
      audioSampleRate: 48_000,
      magneticMainTrack: true,
    },
    extractConfig: {
      strategy: 'scene',
      threshold: 0.3,
      intervalSec: 10,
      maxFrames: 20,
    },
    resources: [],
    tracks: [createDefaultVideoWorkbenchTrack('video', 'track:main', '主视频')],
    keyframes: [],
    outputs: [],
    manualMarks: [],
    autoCollectUpstream: true,
    ui: {
      activeTab: 'resources',
      zoomPxPerSec: 48,
      scrollLeftSec: 0,
      timelineHeightPx: 280,
      snappingEnabled: true,
    },
  }
}
