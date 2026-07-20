import {
  filmUid,
  readAssetKind,
  type FilmProjectData,
  type ShotGroup,
  type ShotSegment,
} from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'
import type { ParsedShotRow } from './canvasShotTableParse'

type MaterializeStoryboardRowsInput = {
  metadata: Record<string, unknown> | undefined
  defaultGroupName: string
  assets: readonly CanvasAsset[]
  rows: readonly ParsedShotRow[]
}

export type MaterializeStoryboardRowsResult = {
  metadata: Record<string, unknown>
  createdGroups: ShotGroup[]
}

function normalizedName(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

function assetByKindAndName(
  assets: readonly CanvasAsset[],
  kind: 'character' | 'scene',
  name: string | undefined,
): CanvasAsset | undefined {
  const target = normalizedName(name)
  if (!target) return undefined
  return assets.find(
    (asset) => readAssetKind(asset) === kind && normalizedName(asset.title) === target,
  )
}

function cloneExistingGroups(metadata: Record<string, unknown> | undefined): ShotGroup[] {
  const film = metadata?.film as FilmProjectData | undefined
  return (film?.shotGroups ?? []).map((group) => ({
    ...group,
    segments: group.segments.map((segment) => ({ ...segment })),
  }))
}

export function storyboardRowToSegmentDraft(
  row: ParsedShotRow,
): Partial<ShotSegment> & { title: string } {
  return {
    title: row.title?.trim() || `镜${row.index ?? 1}`,
    ...(row.description ? { description: row.description } : {}),
    ...(row.dialogue ? { dialogue: row.dialogue } : {}),
    ...(row.narration ? { narration: row.narration } : {}),
    ...(row.shotPrompt ? { shotPrompt: row.shotPrompt } : {}),
    ...(row.durationSec != null ? { durationSec: row.durationSec } : {}),
    ...(row.shotSize ? { shotSize: row.shotSize } : {}),
    ...(row.angle ? { angle: row.angle } : {}),
    ...(row.movement ? { movement: row.movement } : {}),
    ...(row.sceneLayout ? { sceneLayout: row.sceneLayout } : {}),
    ...(row.composition ? { composition: row.composition } : {}),
    ...(row.blocking ? { blocking: row.blocking } : {}),
    ...(row.lighting ? { lighting: row.lighting } : {}),
    ...(row.focalLength ? { focalLength: row.focalLength } : {}),
    ...(row.aperture ? { aperture: row.aperture } : {}),
    ...(row.iso ? { iso: row.iso } : {}),
    ...(row.colorTone ? { colorTone: row.colorTone } : {}),
    ...(row.mood ? { mood: row.mood } : {}),
    ...(row.performance ? { microExpression: row.performance } : {}),
    ...(row.costume ? { costume: row.costume } : {}),
    ...(row.characterReferences ? { characterReferences: row.characterReferences } : {}),
    ...(row.actionBeats ? { actionBeats: row.actionBeats } : {}),
    ...(row.soundEffects ? { soundEffects: row.soundEffects } : {}),
    ...(row.transition ? { transition: row.transition } : {}),
    ...(row.firstFrame ? { firstFrame: row.firstFrame } : {}),
    ...(row.lastFrame ? { lastFrame: row.lastFrame } : {}),
    ...(row.continuity ? { continuity: row.continuity } : {}),
    ...(row.negativePrompt ? { negativePrompt: row.negativePrompt } : {}),
  }
}

function rowToSegment(
  row: ParsedShotRow,
  index: number,
  assets: readonly CanvasAsset[],
): ShotSegment {
  const characterAssetIds = (row.characterNames ?? [])
    .map((name) => assetByKindAndName(assets, 'character', name)?.id)
    .filter((id): id is string => Boolean(id))
  const sceneAssetId = assetByKindAndName(assets, 'scene', row.sceneName)?.id
  return {
    id: filmUid('shot_seg'),
    index: row.index ?? index + 1,
    ...storyboardRowToSegmentDraft(row),
    ...(characterAssetIds.length > 0 ? { characterAssetIds } : {}),
    ...(sceneAssetId ? { sceneAssetId } : {}),
  }
}

export function materializeStoryboardRows(
  input: MaterializeStoryboardRowsInput,
): MaterializeStoryboardRowsResult {
  if (input.rows.length === 0) throw new Error('分镜至少需要一个有效镜头')
  const existingGroups = cloneExistingGroups(input.metadata)
  const rowsByGroup = new Map<string, ParsedShotRow[]>()
  for (const row of input.rows) {
    const name = row.groupName?.trim() || input.defaultGroupName.trim() || '分镜脚本'
    const rows = rowsByGroup.get(name) ?? []
    rows.push(row)
    rowsByGroup.set(name, rows)
  }
  const createdGroups: ShotGroup[] = []
  for (const [name, rows] of rowsByGroup) {
    const group: ShotGroup = {
      id: filmUid('shot_group'),
      name,
      sortOrder: existingGroups.length + createdGroups.length,
      segments: rows.map((row, index) => rowToSegment(row, index, input.assets)),
    }
    createdGroups.push(group)
  }
  const currentFilm = (input.metadata?.film ?? {}) as FilmProjectData
  return {
    metadata: {
      ...(input.metadata ?? {}),
      film: {
        ...currentFilm,
        shotGroups: [...existingGroups, ...createdGroups],
      },
    },
    createdGroups,
  }
}
