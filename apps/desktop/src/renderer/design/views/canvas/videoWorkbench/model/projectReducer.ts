import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchTrack,
} from './projectTypes'
import {
  VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC,
  VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC,
  durationForVideoWorkbenchSourceRange,
  projectTimeToClipSourceTime,
  resolveVideoWorkbenchClipTiming,
} from './timelineMath'
import {
  canPlaceVideoWorkbenchResourceOnTrack,
  findVideoWorkbenchClip,
  hasDuplicateVideoWorkbenchClipId,
  isMainVideoWorkbenchTrack,
  isVideoWorkbenchClipPlacementAvailable,
} from './trackRules'

type TrackMutableFields = Pick<
  VideoWorkbenchTrack,
  'name' | 'locked' | 'muted' | 'solo' | 'visible' | 'collapsed'
>

export type VideoWorkbenchProjectCommand =
  | { type: 'track/add'; track: VideoWorkbenchTrack }
  | { type: 'track/remove'; trackId: string }
  | { type: 'track/reorder'; trackId: string; targetOrder: number }
  | { type: 'track/update'; trackId: string; changes: Partial<TrackMutableFields> }
  | { type: 'clip/add'; trackId: string; clip: VideoWorkbenchClip }
  | {
      type: 'clip/duplicate'
      clipId: string
      duplicateClipId: string
      timelineStartSec: number
    }
  | {
      type: 'clip/duplicate-many'
      items: Array<{ clipId: string; duplicateClipId: string; timelineStartSec: number }>
    }
  | {
      type: 'clip/move'
      clipId: string
      targetTrackId: string
      timelineStartSec: number
    }
  | {
      type: 'clip/move-many'
      moves: Array<{ clipId: string; targetTrackId: string; timelineStartSec: number }>
    }
  | {
      type: 'clip/trim'
      clipId: string
      edge: 'start' | 'end'
      sourceTimeSec: number
    }
  | { type: 'clip/split'; clipId: string; splitAtSec: number; rightClipId: string }
  | { type: 'clip/remove'; clipId: string; ripple?: boolean }
  | { type: 'clip/remove-many'; clipIds: string[]; ripple?: boolean }
  | { type: 'clip/set-speed'; clipId: string; speed: number }

export type VideoWorkbenchProjectCommandRejectReason =
  | 'clip-not-found'
  | 'duplicate-id'
  | 'incompatible-track'
  | 'invalid-command'
  | 'locked-track'
  | 'overlap'
  | 'track-not-found'

export type VideoWorkbenchProjectCommandResult =
  | { applied: true; project: VideoWorkbenchProjectV2 }
  | {
      applied: false
      project: VideoWorkbenchProjectV2
      reason: VideoWorkbenchProjectCommandRejectReason
    }

export function reduceVideoWorkbenchProject(
  project: VideoWorkbenchProjectV2,
  command: VideoWorkbenchProjectCommand,
): VideoWorkbenchProjectCommandResult {
  switch (command.type) {
    case 'track/add':
      return addTrack(project, command.track)
    case 'track/remove':
      return removeTrack(project, command.trackId)
    case 'track/reorder':
      return reorderTrack(project, command.trackId, command.targetOrder)
    case 'track/update':
      return updateTrack(project, command.trackId, command.changes)
    case 'clip/add':
      return addClip(project, command.trackId, command.clip)
    case 'clip/duplicate':
      return duplicateClip(
        project,
        command.clipId,
        command.duplicateClipId,
        command.timelineStartSec,
      )
    case 'clip/duplicate-many':
      return duplicateClips(project, command.items)
    case 'clip/move':
      return moveClip(project, command.clipId, command.targetTrackId, command.timelineStartSec)
    case 'clip/move-many':
      return moveClips(project, command.moves)
    case 'clip/trim':
      return trimClip(project, command.clipId, command.edge, command.sourceTimeSec)
    case 'clip/split':
      return splitClip(project, command.clipId, command.splitAtSec, command.rightClipId)
    case 'clip/remove':
      return removeClip(project, command.clipId, command.ripple)
    case 'clip/remove-many':
      return removeClips(project, command.clipIds, command.ripple)
    case 'clip/set-speed':
      return setClipSpeed(project, command.clipId, command.speed)
  }
}

function reorderTrack(
  project: VideoWorkbenchProjectV2,
  trackId: string,
  targetOrder: number,
): VideoWorkbenchProjectCommandResult {
  const sortedTracks = [...project.tracks].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  )
  const sourceIndex = sortedTracks.findIndex((track) => track.id === trackId)
  if (sourceIndex < 0) return rejected(project, 'track-not-found')
  const sourceTrack = sortedTracks[sourceIndex]
  if (!sourceTrack) return rejected(project, 'track-not-found')
  if (sourceTrack.locked) return rejected(project, 'locked-track')
  if (!Number.isInteger(targetOrder) || targetOrder < 0 || targetOrder >= sortedTracks.length) {
    return rejected(project, 'invalid-command')
  }
  if (sourceIndex === targetOrder) return { applied: true, project }
  const [movedTrack] = sortedTracks.splice(sourceIndex, 1)
  if (!movedTrack) return rejected(project, 'track-not-found')
  sortedTracks.splice(targetOrder, 0, movedTrack)
  return applied(
    project,
    sortedTracks.map((track, order) => ({ ...track, order })),
  )
}

function removeTrack(
  project: VideoWorkbenchProjectV2,
  trackId: string,
): VideoWorkbenchProjectCommandResult {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) return rejected(project, 'track-not-found')
  if (track.locked) return rejected(project, 'locked-track')
  const isOnlyVideoTrack =
    track.kind === 'video' &&
    project.tracks.filter((candidate) => candidate.kind === 'video').length === 1
  if (isOnlyVideoTrack) return rejected(project, 'invalid-command')
  return applied(
    project,
    project.tracks
      .filter((candidate) => candidate.id !== trackId)
      .map((candidate, order) => ({ ...candidate, order })),
  )
}

function addTrack(
  project: VideoWorkbenchProjectV2,
  track: VideoWorkbenchTrack,
): VideoWorkbenchProjectCommandResult {
  if (!track.id || project.tracks.some((candidate) => candidate.id === track.id)) {
    return rejected(project, 'duplicate-id')
  }
  if (track.clips.some((clip) => hasDuplicateVideoWorkbenchClipId(project, clip.id))) {
    return rejected(project, 'duplicate-id')
  }
  const clipIds = new Set<string>()
  for (const clip of track.clips) {
    if (clipIds.has(clip.id)) return rejected(project, 'duplicate-id')
    clipIds.add(clip.id)
    if (!canPlaceClip(project, track, clip)) return rejected(project, 'incompatible-track')
    if (!isVideoWorkbenchClipPlacementAvailable(track, clip, new Set([clip.id]))) {
      return rejected(project, 'overlap')
    }
  }
  const nextTracks = [...project.tracks, track]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((candidate, order) => ({ ...candidate, order }))
  return applied(project, nextTracks)
}

function updateTrack(
  project: VideoWorkbenchProjectV2,
  trackId: string,
  changes: Partial<TrackMutableFields>,
): VideoWorkbenchProjectCommandResult {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) return rejected(project, 'track-not-found')
  if (track.locked && Object.keys(changes).some((key) => key !== 'locked' && key !== 'collapsed')) {
    return rejected(project, 'locked-track')
  }
  const normalizedChanges =
    changes.name === undefined ? changes : { ...changes, name: changes.name.trim() }
  if (
    normalizedChanges.name !== undefined &&
    (normalizedChanges.name.length === 0 || normalizedChanges.name.length > 80)
  ) {
    return rejected(project, 'invalid-command')
  }
  const nextTracks = project.tracks.map((candidate) =>
    candidate.id === trackId ? { ...candidate, ...normalizedChanges } : candidate,
  )
  return applied(project, nextTracks)
}

function addClip(
  project: VideoWorkbenchProjectV2,
  trackId: string,
  clip: VideoWorkbenchClip,
): VideoWorkbenchProjectCommandResult {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) return rejected(project, 'track-not-found')
  if (track.locked) return rejected(project, 'locked-track')
  if (!clip.id || hasDuplicateVideoWorkbenchClipId(project, clip.id)) {
    return rejected(project, 'duplicate-id')
  }
  if (!canPlaceClip(project, track, clip)) return rejected(project, 'incompatible-track')
  if (!isVideoWorkbenchClipPlacementAvailable(track, clip)) return rejected(project, 'overlap')
  return applied(
    project,
    replaceTrack(project, trackId, { ...track, clips: sortClips([...track.clips, clip]) }),
  )
}

function duplicateClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  duplicateClipId: string,
  timelineStartSec: number,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  if (found.track.locked) return rejected(project, 'locked-track')
  if (!duplicateClipId || hasDuplicateVideoWorkbenchClipId(project, duplicateClipId)) {
    return rejected(project, 'duplicate-id')
  }
  if (!Number.isFinite(timelineStartSec) || timelineStartSec < 0) {
    return rejected(project, 'invalid-command')
  }
  const duplicate = { ...found.clip, id: duplicateClipId, timelineStartSec }
  if (!isVideoWorkbenchClipPlacementAvailable(found.track, duplicate)) {
    return rejected(project, 'overlap')
  }
  return applied(
    project,
    replaceTrack(project, found.track.id, {
      ...found.track,
      clips: sortClips([...found.track.clips, duplicate]),
    }),
  )
}

function duplicateClips(
  project: VideoWorkbenchProjectV2,
  items: Array<{ clipId: string; duplicateClipId: string; timelineStartSec: number }>,
): VideoWorkbenchProjectCommandResult {
  if (items.length === 0) return rejected(project, 'invalid-command')
  const duplicateIds = new Set<string>()
  for (const item of items) {
    if (!item.duplicateClipId || duplicateIds.has(item.duplicateClipId)) {
      return rejected(project, 'duplicate-id')
    }
    duplicateIds.add(item.duplicateClipId)
  }
  let nextProject = project
  for (const item of items) {
    const result = duplicateClip(
      nextProject,
      item.clipId,
      item.duplicateClipId,
      item.timelineStartSec,
    )
    if (!result.applied) return rejected(project, result.reason)
    nextProject = result.project
  }
  return { applied: true, project: nextProject }
}

function moveClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  targetTrackId: string,
  timelineStartSec: number,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  const targetTrack = project.tracks.find((track) => track.id === targetTrackId)
  if (!targetTrack) return rejected(project, 'track-not-found')
  if (found.track.locked || targetTrack.locked) return rejected(project, 'locked-track')
  if (!Number.isFinite(timelineStartSec) || timelineStartSec < 0) {
    return rejected(project, 'invalid-command')
  }
  const movedClip = { ...found.clip, timelineStartSec }
  if (!canPlaceClip(project, targetTrack, movedClip)) return rejected(project, 'incompatible-track')
  if (!isVideoWorkbenchClipPlacementAvailable(targetTrack, movedClip, new Set([clipId]))) {
    return rejected(project, 'overlap')
  }
  const tracksWithoutClip = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => clip.id !== clipId),
  }))
  const nextTracks = tracksWithoutClip.map((track) =>
    track.id === targetTrackId
      ? { ...track, clips: sortClips([...track.clips, movedClip]) }
      : track,
  )
  return applied(project, nextTracks)
}

function moveClips(
  project: VideoWorkbenchProjectV2,
  moves: Array<{ clipId: string; targetTrackId: string; timelineStartSec: number }>,
): VideoWorkbenchProjectCommandResult {
  if (moves.length === 0) return rejected(project, 'invalid-command')
  const selectedClipIds = new Set<string>()
  const resolvedMoves: Array<{
    clip: VideoWorkbenchClip
    targetTrackId: string
  }> = []
  for (const move of moves) {
    if (selectedClipIds.has(move.clipId)) return rejected(project, 'invalid-command')
    selectedClipIds.add(move.clipId)
    const found = findVideoWorkbenchClip(project, move.clipId)
    if (!found) return rejected(project, 'clip-not-found')
    const targetTrack = project.tracks.find((track) => track.id === move.targetTrackId)
    if (!targetTrack) return rejected(project, 'track-not-found')
    if (found.track.locked || targetTrack.locked) return rejected(project, 'locked-track')
    if (!Number.isFinite(move.timelineStartSec) || move.timelineStartSec < 0) {
      return rejected(project, 'invalid-command')
    }
    const movedClip = { ...found.clip, timelineStartSec: move.timelineStartSec }
    if (!canPlaceClip(project, targetTrack, movedClip)) {
      return rejected(project, 'incompatible-track')
    }
    resolvedMoves.push({
      clip: movedClip,
      targetTrackId: targetTrack.id,
    })
  }

  let nextTracks = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => !selectedClipIds.has(clip.id)),
  }))
  for (const move of resolvedMoves) {
    const targetTrack = nextTracks.find((track) => track.id === move.targetTrackId)
    if (!targetTrack) return rejected(project, 'track-not-found')
    if (!isVideoWorkbenchClipPlacementAvailable(targetTrack, move.clip)) {
      return rejected(project, 'overlap')
    }
    nextTracks = nextTracks.map((track) =>
      track.id === targetTrack.id
        ? { ...track, clips: sortClips([...track.clips, move.clip]) }
        : track,
    )
  }
  return applied(project, nextTracks)
}

function trimClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  edge: 'start' | 'end',
  sourceTimeSec: number,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  if (found.track.locked) return rejected(project, 'locked-track')
  if (!Number.isFinite(sourceTimeSec)) return rejected(project, 'invalid-command')
  const timing = resolveVideoWorkbenchClipTiming(found.clip)
  const resource = project.resources.find((candidate) => candidate.id === found.clip.resourceId)
  const minimumSourceSpanSec = VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC * timing.speed
  let nextClip: VideoWorkbenchClip
  if (edge === 'start') {
    if (resource?.kind === 'image') {
      const timelineStartSec =
        timing.timelineStartSec + (sourceTimeSec - timing.sourceStartSec) / timing.speed
      const durationSec = timing.timelineEndSec - timelineStartSec
      if (timelineStartSec < 0 || durationSec < VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC) {
        return rejected(project, 'invalid-command')
      }
      nextClip = {
        ...found.clip,
        timelineStartSec,
        sourceOutSec: found.clip.sourceInSec + durationSec * timing.speed,
        durationSec,
      }
    } else {
      if (sourceTimeSec < 0 || sourceTimeSec > timing.sourceEndSec - minimumSourceSpanSec) {
        return rejected(project, 'invalid-command')
      }
      const timelineStartSec =
        timing.timelineStartSec + (sourceTimeSec - timing.sourceStartSec) / timing.speed
      if (timelineStartSec < 0) return rejected(project, 'invalid-command')
      nextClip = {
        ...found.clip,
        timelineStartSec,
        sourceInSec: sourceTimeSec,
        durationSec: durationForVideoWorkbenchSourceRange(
          sourceTimeSec,
          timing.sourceEndSec,
          timing.speed,
        ),
      }
    }
  } else {
    const maximumSourceOutSec =
      resource?.kind === 'image'
        ? Number.POSITIVE_INFINITY
        : (resource?.durationSec ?? timing.sourceEndSec)
    if (
      sourceTimeSec < timing.sourceStartSec + minimumSourceSpanSec ||
      sourceTimeSec > maximumSourceOutSec
    ) {
      return rejected(project, 'invalid-command')
    }
    nextClip = {
      ...found.clip,
      sourceOutSec: sourceTimeSec,
      durationSec: durationForVideoWorkbenchSourceRange(
        timing.sourceStartSec,
        sourceTimeSec,
        timing.speed,
      ),
    }
  }
  if (!isVideoWorkbenchClipPlacementAvailable(found.track, nextClip, new Set([clipId]))) {
    return rejected(project, 'overlap')
  }
  return applied(project, replaceClip(project, found.track.id, nextClip))
}

function splitClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  splitAtSec: number,
  rightClipId: string,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  if (found.track.locked) return rejected(project, 'locked-track')
  if (!rightClipId || hasDuplicateVideoWorkbenchClipId(project, rightClipId)) {
    return rejected(project, 'duplicate-id')
  }
  const timing = resolveVideoWorkbenchClipTiming(found.clip)
  if (
    !Number.isFinite(splitAtSec) ||
    splitAtSec < timing.timelineStartSec + VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC ||
    splitAtSec > timing.timelineEndSec - VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC
  ) {
    return rejected(project, 'invalid-command')
  }
  const sourceSplitSec = projectTimeToClipSourceTime(found.clip, splitAtSec)
  const leftClip: VideoWorkbenchClip = {
    ...found.clip,
    sourceOutSec: sourceSplitSec,
    durationSec: splitAtSec - timing.timelineStartSec,
  }
  const rightClip: VideoWorkbenchClip = {
    ...found.clip,
    id: rightClipId,
    timelineStartSec: splitAtSec,
    sourceInSec: sourceSplitSec,
    durationSec: timing.timelineEndSec - splitAtSec,
  }
  const nextClips = found.track.clips.flatMap((clip) =>
    clip.id === clipId ? [leftClip, rightClip] : [clip],
  )
  return applied(
    project,
    replaceTrack(project, found.track.id, { ...found.track, clips: sortClips(nextClips) }),
  )
}

function removeClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  ripple: boolean | undefined,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  if (found.track.locked) return rejected(project, 'locked-track')
  const removedTiming = resolveVideoWorkbenchClipTiming(found.clip)
  const shouldRipple =
    ripple ??
    (project.project.magneticMainTrack && isMainVideoWorkbenchTrack(project, found.track.id))
  const nextClips = found.track.clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => {
      if (!shouldRipple || clip.timelineStartSec < removedTiming.timelineEndSec) return clip
      return {
        ...clip,
        timelineStartSec: Math.max(
          removedTiming.timelineStartSec,
          clip.timelineStartSec - found.clip.durationSec,
        ),
      }
    })
  return applied(
    project,
    replaceTrack(project, found.track.id, { ...found.track, clips: sortClips(nextClips) }),
  )
}

function removeClips(
  project: VideoWorkbenchProjectV2,
  clipIds: string[],
  ripple: boolean | undefined,
): VideoWorkbenchProjectCommandResult {
  const selectedClipIds = new Set(clipIds)
  if (selectedClipIds.size === 0 || selectedClipIds.size !== clipIds.length) {
    return rejected(project, 'invalid-command')
  }
  const selectedByTrack = new Map<string, VideoWorkbenchClip[]>()
  for (const clipId of selectedClipIds) {
    const found = findVideoWorkbenchClip(project, clipId)
    if (!found) return rejected(project, 'clip-not-found')
    if (found.track.locked) return rejected(project, 'locked-track')
    const trackSelection = selectedByTrack.get(found.track.id) ?? []
    trackSelection.push(found.clip)
    selectedByTrack.set(found.track.id, trackSelection)
  }

  const nextTracks = project.tracks.map((track) => {
    const selectedClips = selectedByTrack.get(track.id)
    if (!selectedClips) return track
    const shouldRipple =
      ripple ?? (project.project.magneticMainTrack && isMainVideoWorkbenchTrack(project, track.id))
    const removedTimings = selectedClips.map((clip) => ({
      durationSec: clip.durationSec,
      timing: resolveVideoWorkbenchClipTiming(clip),
    }))
    const clips = track.clips
      .filter((clip) => !selectedClipIds.has(clip.id))
      .map((clip) => {
        if (!shouldRipple) return clip
        const removedDurationBeforeClip = removedTimings.reduce(
          (durationSec, removed) =>
            removed.timing.timelineEndSec <=
            clip.timelineStartSec + VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC
              ? durationSec + removed.durationSec
              : durationSec,
          0,
        )
        return removedDurationBeforeClip <= 0
          ? clip
          : {
              ...clip,
              timelineStartSec: Math.max(0, clip.timelineStartSec - removedDurationBeforeClip),
            }
      })
    return { ...track, clips: sortClips(clips) }
  })
  return applied(project, nextTracks)
}

function setClipSpeed(
  project: VideoWorkbenchProjectV2,
  clipId: string,
  speed: number,
): VideoWorkbenchProjectCommandResult {
  const found = findVideoWorkbenchClip(project, clipId)
  if (!found) return rejected(project, 'clip-not-found')
  if (found.track.locked) return rejected(project, 'locked-track')
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    return rejected(project, 'invalid-command')
  }
  const nextClip = {
    ...found.clip,
    speed,
    durationSec: durationForVideoWorkbenchSourceRange(
      found.clip.sourceInSec,
      found.clip.sourceOutSec,
      speed,
    ),
  }
  if (nextClip.durationSec < VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC) {
    return rejected(project, 'invalid-command')
  }
  if (!isVideoWorkbenchClipPlacementAvailable(found.track, nextClip, new Set([clipId]))) {
    return rejected(project, 'overlap')
  }
  return applied(project, replaceClip(project, found.track.id, nextClip))
}

function canPlaceClip(
  project: VideoWorkbenchProjectV2,
  track: VideoWorkbenchTrack,
  clip: VideoWorkbenchClip,
): boolean {
  const resourceKind = project.resources.find((resource) => resource.id === clip.resourceId)?.kind
  return canPlaceVideoWorkbenchResourceOnTrack(resourceKind, track.kind, clip)
}

function replaceClip(
  project: VideoWorkbenchProjectV2,
  trackId: string,
  clip: VideoWorkbenchClip,
): VideoWorkbenchTrack[] {
  return project.tracks.map((track) =>
    track.id === trackId
      ? {
          ...track,
          clips: sortClips(
            track.clips.map((candidate) => (candidate.id === clip.id ? clip : candidate)),
          ),
        }
      : track,
  )
}

function replaceTrack(
  project: VideoWorkbenchProjectV2,
  trackId: string,
  nextTrack: VideoWorkbenchTrack,
): VideoWorkbenchTrack[] {
  return project.tracks.map((track) => (track.id === trackId ? nextTrack : track))
}

function sortClips(clips: VideoWorkbenchClip[]): VideoWorkbenchClip[] {
  return [...clips].sort(
    (left, right) =>
      left.timelineStartSec - right.timelineStartSec || left.id.localeCompare(right.id),
  )
}

function applied(
  project: VideoWorkbenchProjectV2,
  tracks: VideoWorkbenchTrack[],
): VideoWorkbenchProjectCommandResult {
  return { applied: true, project: { ...project, tracks } }
}

function rejected(
  project: VideoWorkbenchProjectV2,
  reason: VideoWorkbenchProjectCommandRejectReason,
): VideoWorkbenchProjectCommandResult {
  return { applied: false, project, reason }
}
