import type { CanvasAsset, CanvasNode } from './canvas.types'
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
    const {
      focalLength: _focalLength,
      aperture: _aperture,
      iso: _iso,
      ...rest
    } = row
    return { ...rest, cameraParams }
  })
}

/**
 * 分镜节点可能保存为 JSON；模型侧只需要可读语义，不应承担解析画布内部结构的职责。
 * 普通文本和无法可靠解析的内容保持原样，避免误改用户输入。
 */
export function presentCanvasTextForModel(content: string): string {
  const trimmed = content.trim()
  if (!trimmed || !isShotScriptText(trimmed)) return trimmed
  const rows = parseShotTable(trimmed)
  if (rows.length === 0) return trimmed
  return formatStoryboardRowsAsMarkdown(rows)
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
