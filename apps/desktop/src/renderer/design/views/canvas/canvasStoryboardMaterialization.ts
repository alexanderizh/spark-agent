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

function textValue(value: string | undefined): string {
  return value?.trim() ?? ''
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
    title: textValue(row.title) || `镜${row.index ?? 1}`,
    description: textValue(row.description),
    dialogue: textValue(row.dialogue),
    narration: textValue(row.narration),
    shotPrompt: textValue(row.shotPrompt),
    ...(row.durationSec != null ? { durationSec: row.durationSec } : {}),
    shotSize: textValue(row.shotSize),
    angle: textValue(row.angle),
    movement: textValue(row.movement),
    sceneLayout: textValue(row.sceneLayout),
    composition: textValue(row.composition),
    blocking: textValue(row.blocking),
    lighting: textValue(row.lighting),
    cameraParams: textValue(row.cameraParams),
    focalLength: textValue(row.focalLength),
    aperture: textValue(row.aperture),
    iso: textValue(row.iso),
    colorTone: textValue(row.colorTone),
    mood: textValue(row.mood),
    microExpression: textValue(row.performance),
    costume: textValue(row.costume),
    characterReferences: textValue(row.characterReferences),
    actionBeats: textValue(row.actionBeats),
    soundEffects: textValue(row.soundEffects),
    transition: textValue(row.transition),
    firstFrame: textValue(row.firstFrame),
    lastFrame: textValue(row.lastFrame),
    continuity: textValue(row.continuity),
    negativePrompt: textValue(row.negativePrompt),
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
