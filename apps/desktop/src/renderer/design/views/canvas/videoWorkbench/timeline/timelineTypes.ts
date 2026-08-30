import type { VideoWorkbenchTrack } from '../model/projectTypes'

export type TrackMutableChanges = Partial<
  Pick<VideoWorkbenchTrack, 'name' | 'locked' | 'muted' | 'solo' | 'visible' | 'collapsed'>
>

export type VideoWorkbenchClipSelectionMode = 'replace' | 'toggle'
