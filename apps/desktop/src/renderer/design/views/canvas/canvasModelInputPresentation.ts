import type { CanvasPromptRelation } from '@spark/protocol'
import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'

export type CanvasModelReferenceImage = {
  ordinal: number
  label: string
  relation: CanvasPromptRelation
}

export function renderCanvasPromptWithReferences(input: {
  userInput: string
  resources: readonly string[]
}): string {
  const userInput = input.userInput.trim()
  const resources = input.resources.map((resource) => resource.trim()).filter(Boolean)
  if (resources.length === 0) return userInput
  return [
    '[用户输入与引用关系]',
    userInput,
    '[/用户输入与引用关系]',
    '',
    '[引用资源]',
    resources.join('\n\n'),
    '[/引用资源]',
  ].join('\n')
}

export function renderCanvasReferenceImageList(
  images: readonly CanvasModelReferenceImage[],
): string {
  if (images.length === 0) return ''
  return [
    '[图片引用]',
    ...images.map(
      (image) => `参考图 #${image.ordinal}：${image.label}${imageRelationSuffix(image.relation)}`,
    ),
    '[/图片引用]',
  ].join('\n')
}

export function renderCanvasTextReference(input: {
  ordinal: number
  label: string
  relation: CanvasPromptRelation
  content: string
}): string {
  const trimmed = input.content.trim()
  const body = renderCanvasTextForModel(trimmed)
  return [
    `[文本引用 T${input.ordinal} 开始]`,
    `类型：${textRelationLabel(input.relation)}`,
    `名称：${input.label}`,
    ...(body ? ['', body] : []),
    `[/文本引用 T${input.ordinal} 结束]`,
  ].join('\n')
}

export function renderCanvasTextForModel(content: string): string {
  if (!content) return ''
  if (isShotScriptText(content)) {
    const rows = parseShotTable(content)
    if (rows.length > 0) return renderStoryboardRows(rows)
  }
  return renderGenericMarkdownTable(content) ?? content
}

function renderStoryboardRows(rows: readonly ParsedShotRow[]): string {
  return rows
    .map((row, index) => {
      const fields: Array<[string, string | number | undefined]> = [
        ['名称', row.title],
        ['镜号', row.index],
        ['场次', row.groupName],
        ['场景', row.sceneName],
        ['场景描述', row.sceneLayout],
        ['构图', row.composition],
        ['角色', row.characterNames?.join('、')],
        ['角色参考', row.characterReferences],
        ['时长（秒）', row.durationSec],
        ['景别', row.shotSize],
        ['角度', row.angle],
        ['运镜', row.movement],
        ['站位调度', row.blocking],
        ['光照', row.lighting],
        ['镜头参数', row.cameraParams],
        ['焦距', row.focalLength],
        ['光圈', row.aperture],
        ['ISO', row.iso],
        ['色调', row.colorTone],
        ['氛围', row.mood],
        ['微表情/动作', row.performance],
        ['服装', row.costume],
        ['画面/动作', row.description],
        ['动作节拍', row.actionBeats],
        ['对白', row.dialogue],
        ['旁白', row.narration],
        ['音效', row.soundEffects],
        ['转场', row.transition],
        ['首帧', row.firstFrame],
        ['尾帧', row.lastFrame],
        ['连续性', row.continuity],
        ['生成提示词', row.shotPrompt],
        ['反向提示词', row.negativePrompt],
      ]
      const renderedFields = fields.flatMap(([label, value]) => {
        if (value == null || String(value).trim().length === 0) return []
        return [`${label}：${indentMultiline(String(value).trim())}`]
      })
      return [`分镜 ${row.index ?? index + 1}`, ...renderedFields].join('\n')
    })
    .join('\n\n')
}

function renderGenericMarkdownTable(content: string): string | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const parts: string[] = []
  let prose: string[] = []
  let foundTable = false
  let index = 0
  const flushProse = () => {
    const value = prose.join('\n').trim()
    if (value) parts.push(value)
    prose = []
  }

  while (index < lines.length - 2) {
    const headerLine = lines[index]?.trim() ?? ''
    const dividerLine = lines[index + 1]?.trim() ?? ''
    if (!headerLine.startsWith('|') || !dividerLine.startsWith('|')) {
      prose.push(lines[index] ?? '')
      index += 1
      continue
    }
    const headers = splitMarkdownRow(headerLine)
    const divider = splitMarkdownRow(dividerLine)
    if (
      headers.length === 0 ||
      divider.length !== headers.length ||
      !divider.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))
    ) {
      prose.push(lines[index] ?? '')
      index += 1
      continue
    }
    const records: string[] = []
    let rowIndex = index + 2
    for (; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex]?.trim() ?? ''
      if (!line.startsWith('|')) break
      const cells = splitMarkdownRow(line)
      const fields = headers.flatMap((header, cellIndex) => {
        const value = cleanMarkdownCell(cells[cellIndex])
        if (!header || !value) return []
        return [`${header}：${indentMultiline(value)}`]
      })
      if (fields.length > 0) records.push([`记录 ${records.length + 1}`, ...fields].join('\n'))
    }
    if (records.length === 0) {
      prose.push(lines[index] ?? '', lines[index + 1] ?? '')
      index += 2
      continue
    }
    flushProse()
    parts.push(records.join('\n\n'))
    foundTable = true
    index = rowIndex
  }

  prose.push(...lines.slice(index))
  flushProse()
  return foundTable ? parts.join('\n\n') : null
}

function splitMarkdownRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '\\' && value[index + 1] === '|') {
      current += '|'
      index += 1
      continue
    }
    if (character === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  cells.push(current.trim())
  return cells
}

function cleanMarkdownCell(value: string | undefined): string {
  const cleaned = (value ?? '').trim().replace(/<br\s*\/?>/gi, '\n')
  return cleaned === '—' || cleaned === '-' ? '' : cleaned
}

function indentMultiline(value: string): string {
  return value.replace(/\r?\n/g, '\n  ')
}

function textRelationLabel(relation: CanvasPromptRelation): string {
  if (relation === 'storyboard') return '分镜脚本'
  if (relation === 'screenplay') return '剧本'
  if (relation === 'character' || relation === 'supporting_character') return '角色资料'
  if (relation === 'scene') return '场景资料'
  if (relation === 'prop') return '道具资料'
  return '文本'
}

function imageRelationSuffix(relation: CanvasPromptRelation): string {
  if (relation === 'character') return '（角色）'
  if (relation === 'supporting_character') return '（配角）'
  if (relation === 'scene') return '（场景）'
  if (relation === 'prop') return '（道具）'
  return '（参考图）'
}
