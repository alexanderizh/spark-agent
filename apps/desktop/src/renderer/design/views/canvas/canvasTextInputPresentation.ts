import type { CanvasAsset, CanvasNode } from './canvas.types'
import { renderCanvasTextForModel } from './canvasModelInputPresentation'
import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'

const STORYBOARD_COLUMNS: Array<{
  label: string
  read: (row: ParsedShotRow, index: number) => string
}> = [
  { label: '镜号', read: (row, index) => String(row.index ?? index + 1) },
  { label: '标题', read: (row) => row.title },
  { label: '时长(秒)', read: (row) => (row.durationSec == null ? '' : String(row.durationSec)) },
  { label: '景别', read: (row) => row.shotSize ?? '' },
  { label: '角度', read: (row) => row.angle ?? '' },
  { label: '运镜', read: (row) => row.movement ?? '' },
  { label: '场次', read: (row) => row.groupName ?? '' },
  { label: '场景名', read: (row) => row.sceneName ?? '' },
  { label: '场景描述', read: (row) => row.sceneLayout ?? '' },
  { label: '构图', read: (row) => row.composition ?? '' },
  { label: '站位调度', read: (row) => row.blocking ?? '' },
  { label: '光照', read: (row) => row.lighting ?? '' },
  { label: '镜头参数', read: (row) => row.cameraParams ?? '' },
  { label: '焦距', read: (row) => row.focalLength ?? '' },
  { label: '光圈', read: (row) => row.aperture ?? '' },
  { label: 'ISO', read: (row) => row.iso ?? '' },
  { label: '色调', read: (row) => row.colorTone ?? '' },
  { label: '氛围', read: (row) => row.mood ?? '' },
  { label: '微表情动作', read: (row) => row.performance ?? '' },
  { label: '服装', read: (row) => row.costume ?? '' },
  { label: '画面/动作', read: (row) => row.description ?? '' },
  { label: '对白', read: (row) => row.dialogue ?? '' },
  { label: '旁白', read: (row) => row.narration ?? '' },
  { label: '角色', read: (row) => row.characterNames?.join('、') ?? '' },
  { label: '角色参考', read: (row) => row.characterReferences ?? '' },
  { label: '动作节拍', read: (row) => row.actionBeats ?? '' },
  { label: '音效', read: (row) => row.soundEffects ?? '' },
  { label: '转场', read: (row) => row.transition ?? '' },
  { label: '首帧', read: (row) => row.firstFrame ?? '' },
  { label: '尾帧', read: (row) => row.lastFrame ?? '' },
  { label: '连续性', read: (row) => row.continuity ?? '' },
  { label: '生成提示词', read: (row) => row.shotPrompt ?? '' },
  { label: '反向提示词', read: (row) => row.negativePrompt ?? '' },
]

function escapeMarkdownCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim()
}

export function formatStoryboardRowsAsMarkdown(rows: ParsedShotRow[]): string {
  if (rows.length === 0) return ''
  const columns = STORYBOARD_COLUMNS.filter((column) =>
    rows.some((row, index) => column.read(row, index).trim().length > 0),
  )
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row, index) =>
      `| ${columns.map((column) => escapeMarkdownCell(column.read(row, index))).join(' | ')} |`,
  )
  return [header, divider, ...body].join('\n')
}

export function formatStoryboardCameraParamsForEditor(row: ParsedShotRow): string {
  if (row.cameraParams !== undefined) return row.cameraParams
  const iso = row.iso?.trim()
  return [
    row.focalLength ? `焦距 ${row.focalLength}` : '',
    row.aperture ? `光圈 ${row.aperture}` : '',
    iso ? (/^iso\b/i.test(iso) ? iso : `ISO ${iso}`) : '',
  ]
    .filter(Boolean)
    .join('；')
}

export function updateStoryboardCameraParams(
  rows: ParsedShotRow[],
  index: number,
  cameraParams: string,
): ParsedShotRow[] {
  return rows.map((row, rowIndex) => {
    if (rowIndex !== index) return row
    const { focalLength: _focalLength, aperture: _aperture, iso: _iso, ...rest } = row
    return { ...rest, cameraParams }
  })
}

function isLegacySplitStoryboardText(text: string): boolean {
  const header = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .find((line) => line.trim().startsWith('|'))
  if (!header) return false
  return (
    /布光/.test(header) &&
    /站位\s*\/\s*调度/.test(header) &&
    !/场景描述|焦距|微表情|生成提示词|反向提示词/.test(header)
  )
}

function sameText(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = left?.trim()
  return Boolean(normalizedLeft) && normalizedLeft === right?.trim()
}

function legacyStoryboardMatchScore(current: ParsedShotRow, candidate: ParsedShotRow): number {
  if (
    current.index !== undefined &&
    candidate.index !== undefined &&
    current.index !== candidate.index
  ) {
    return -1
  }

  const descriptionMatches = sameText(current.description, candidate.description)
  const titleMatches = sameText(current.title, candidate.title)
  const supportingMatches = [
    sameText(current.dialogue, candidate.dialogue),
    sameText(current.lighting, candidate.lighting),
    sameText(current.blocking, candidate.blocking),
  ].filter(Boolean).length
  if (!descriptionMatches && !(titleMatches && supportingMatches > 0)) return -1

  const recoverableDetails = [
    candidate.sceneLayout,
    candidate.composition,
    candidate.focalLength,
    candidate.aperture,
    candidate.iso,
    candidate.colorTone,
    candidate.mood,
    candidate.performance,
    candidate.costume,
    candidate.characterReferences,
    candidate.actionBeats,
    candidate.soundEffects,
    candidate.transition,
    candidate.firstFrame,
    candidate.lastFrame,
    candidate.continuity,
    candidate.shotPrompt,
    candidate.negativePrompt,
  ].filter((value) => value?.trim()).length
  if (recoverableDetails === 0) return -1

  return (descriptionMatches ? 100 : 0) + (titleMatches ? 30 : 0) + supportingMatches * 10
}

function mergeLegacyStoryboardRow(current: ParsedShotRow, candidate: ParsedShotRow): ParsedShotRow {
  return {
    ...candidate,
    title: current.title || candidate.title,
    ...(current.index !== undefined ? { index: current.index } : {}),
    ...(current.durationSec !== undefined ? { durationSec: current.durationSec } : {}),
    ...(current.shotSize ? { shotSize: current.shotSize } : {}),
    ...(current.angle ? { angle: current.angle } : {}),
    ...(current.movement ? { movement: current.movement } : {}),
    ...(current.description ? { description: current.description } : {}),
    ...(current.dialogue ? { dialogue: current.dialogue } : {}),
    ...(current.characterNames?.length ? { characterNames: current.characterNames } : {}),
    ...(current.lighting ? { lighting: current.lighting } : {}),
    ...(current.blocking ? { blocking: current.blocking } : {}),
    ...(current.cameraParams ? { cameraParams: current.cameraParams } : {}),
  }
}

export function resolveStoryboardRowsForEditing(
  text: string,
  candidateNodes: CanvasNode[] = [],
): ParsedShotRow[] {
  const currentRows = parseShotTable(text)
  if (currentRows.length !== 1 || !isLegacySplitStoryboardText(text)) return currentRows

  const current = currentRows[0]
  if (!current) return currentRows
  const anchors = [current.description, current.title]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  let bestMatch: ParsedShotRow | undefined
  let bestScore = -1

  for (const node of candidateNodes) {
    const candidateText = node.data.text?.trim()
    if (
      !candidateText ||
      candidateText === text.trim() ||
      !isShotScriptText(candidateText) ||
      (anchors.length > 0 && !anchors.some((anchor) => candidateText.includes(anchor)))
    ) {
      continue
    }
    for (const candidate of parseShotTable(candidateText)) {
      const score = legacyStoryboardMatchScore(current, candidate)
      if (score > bestScore) {
        bestMatch = candidate
        bestScore = score
      }
    }
  }

  return bestMatch ? [mergeLegacyStoryboardRow(current, bestMatch)] : currentRows
}

/**
 * 分镜节点可能保存为 JSON；模型侧只需要可读语义，不应承担解析画布内部结构的职责。
 * 普通文本和无法可靠解析的内容保持原样，避免误改用户输入。
 */
export function presentCanvasTextForModel(content: string): string {
  return renderCanvasTextForModel(content.trim())
}

export function readCanvasTextInputContent(node: CanvasNode, assets: CanvasAsset[]): string {
  if (node.type !== 'text' && node.type !== 'prompt') return ''
  const assetText = node.assetId
    ? assets.find((asset) => asset.id === node.assetId)?.contentText
    : undefined
  return node.data.text?.trim() || assetText?.trim() || ''
}

function canvasTextInputKind(node: CanvasNode, content: string): string {
  if (node.data.pipelineRole === 'shot' || isShotScriptText(content)) return '分镜脚本'
  if (node.data.pipelineRole === 'screenplay') return '剧本'
  if (node.type === 'prompt') return '提示词节点'
  return '文本节点'
}

export function formatCanvasTextInputContext(node: CanvasNode, assets: CanvasAsset[] = []): string {
  const content = readCanvasTextInputContent(node, assets)
  if (!content) return ''
  const name = node.title?.trim() || '未命名'
  return `【${canvasTextInputKind(node, content)}｜${name}】\n${presentCanvasTextForModel(content)}`
}
