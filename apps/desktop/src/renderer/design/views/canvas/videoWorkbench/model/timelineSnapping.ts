import type { VideoWorkbenchProjectV2 } from './projectTypes'
import { resolveVideoWorkbenchClipTiming } from './timelineMath'

export type VideoWorkbenchSnapCandidateKind =
  | 'origin'
  | 'playhead'
  | 'marker'
  | 'clip-start'
  | 'clip-end'

export interface VideoWorkbenchSnapCandidate {
  timeSec: number
  kind: VideoWorkbenchSnapCandidateKind
  clipId?: string
}

export interface VideoWorkbenchSnapResult {
  snapped: boolean
  timeSec: number
  deltaSec: number
  candidate?: VideoWorkbenchSnapCandidate
  alignedEdge?: 'start' | 'end'
}

export function collectVideoWorkbenchSnapCandidates(
  project: Pick<VideoWorkbenchProjectV2, 'tracks' | 'manualMarks'>,
  options: {
    playheadSec?: number
    excludedClipIds?: ReadonlySet<string>
  } = {},
): VideoWorkbenchSnapCandidate[] {
  const excludedClipIds = options.excludedClipIds ?? new Set<string>()
  const candidates: VideoWorkbenchSnapCandidate[] = [{ timeSec: 0, kind: 'origin' }]
  if (Number.isFinite(options.playheadSec) && Number(options.playheadSec) >= 0) {
    candidates.push({ timeSec: Number(options.playheadSec), kind: 'playhead' })
  }
  for (const marker of project.manualMarks) {
    if (Number.isFinite(marker) && marker >= 0) {
      candidates.push({ timeSec: marker, kind: 'marker' })
    }
  }
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (excludedClipIds.has(clip.id)) continue
      const timing = resolveVideoWorkbenchClipTiming(clip)
      candidates.push({ timeSec: timing.timelineStartSec, kind: 'clip-start', clipId: clip.id })
      candidates.push({ timeSec: timing.timelineEndSec, kind: 'clip-end', clipId: clip.id })
    }
  }
  return dedupeCandidates(candidates)
}

export function snapVideoWorkbenchTime(
  rawTimeSec: number,
  candidates: readonly VideoWorkbenchSnapCandidate[],
  zoomPxPerSec: number,
  thresholdPx = 8,
): VideoWorkbenchSnapResult {
  if (!Number.isFinite(rawTimeSec) || !Number.isFinite(zoomPxPerSec) || zoomPxPerSec <= 0) {
    return { snapped: false, timeSec: Math.max(0, finiteOrZero(rawTimeSec)), deltaSec: 0 }
  }
  const thresholdSec = Math.max(0, finiteOrZero(thresholdPx)) / zoomPxPerSec
  const nearest = [...candidates]
    .map((candidate) => ({ candidate, distance: Math.abs(candidate.timeSec - rawTimeSec) }))
    .filter(({ candidate, distance }) => candidate.timeSec >= 0 && distance <= thresholdSec)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        snapCandidatePriority(left.candidate.kind) - snapCandidatePriority(right.candidate.kind) ||
        left.candidate.timeSec - right.candidate.timeSec,
    )[0]
  if (!nearest) {
    return { snapped: false, timeSec: Math.max(0, rawTimeSec), deltaSec: 0 }
  }
  return {
    snapped: true,
    timeSec: nearest.candidate.timeSec,
    deltaSec: nearest.candidate.timeSec - rawTimeSec,
    candidate: nearest.candidate,
  }
}

export function snapVideoWorkbenchClipMove(
  rawStartSec: number,
  durationSec: number,
  candidates: readonly VideoWorkbenchSnapCandidate[],
  zoomPxPerSec: number,
  thresholdPx = 8,
): VideoWorkbenchSnapResult {
  const safeStartSec = Math.max(0, finiteOrZero(rawStartSec))
  const safeDurationSec = Math.max(0, finiteOrZero(durationSec))
  const startResult = snapVideoWorkbenchTime(safeStartSec, candidates, zoomPxPerSec, thresholdPx)
  const endResult = snapVideoWorkbenchTime(
    safeStartSec + safeDurationSec,
    candidates,
    zoomPxPerSec,
    thresholdPx,
  )
  const result = chooseNearestResult(startResult, endResult)
  if (!result.snapped) return result
  const alignedEdge = result === startResult ? 'start' : 'end'
  const nextStartSec = Math.max(0, safeStartSec + result.deltaSec)
  return {
    ...result,
    timeSec: nextStartSec,
    deltaSec: nextStartSec - safeStartSec,
    alignedEdge,
  }
}

function dedupeCandidates(
  candidates: VideoWorkbenchSnapCandidate[],
): VideoWorkbenchSnapCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.timeSec.toFixed(6)}:${candidate.kind}:${candidate.clipId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function chooseNearestResult(
  left: VideoWorkbenchSnapResult,
  right: VideoWorkbenchSnapResult,
): VideoWorkbenchSnapResult {
  if (!left.snapped) return right
  if (!right.snapped) return left
  return Math.abs(left.deltaSec) <= Math.abs(right.deltaSec) ? left : right
}

function snapCandidatePriority(kind: VideoWorkbenchSnapCandidateKind): number {
  return ['playhead', 'marker', 'clip-start', 'clip-end', 'origin'].indexOf(kind)
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}
