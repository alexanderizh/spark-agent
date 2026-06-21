import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Segmented, Tag } from '@lobehub/ui'
import { Drawer, Input, Modal, Spin, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import { CanvasInspector } from './CanvasInspector'
import { CanvasStage, type CanvasStageViewport } from './CanvasStage'
import { CanvasTaskQueue } from './CanvasTaskQueue'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { CanvasBoardSidebar } from './CanvasBoardSidebar'
import { downloadAsset } from './CanvasAssetsPanel'
import { CanvasAssetManagerPanel } from './CanvasAssetManagerPanel'
import { CanvasBottomDock } from './CanvasBottomDock'
import { CanvasHistoryPanel } from './CanvasHistoryPanel'
import { SaveToLibraryDialog } from './SaveToLibraryDialog'
import { readFileAsDataUrl, readImageDimensions } from './canvas-safe-file'
import { CanvasTemplatePanel } from './CanvasTemplatePanel'
import { CanvasFilmAssetCenter, type FilmCenterHandlers } from './CanvasFilmAssetCenter'
import { CanvasAgentModal } from './CanvasAgentModal'
import { CanvasOperationPanel } from './CanvasOperationPanel'
import {
  CanvasShotDirectorPanel,
  type CanvasShotDirectorDraft,
  type CanvasShotDirectorScreenshotInput,
} from './CanvasShotDirectorPanel'
import { isOperationNode } from './canvas.capabilities'
import {
  readAssetKind,
  readFilmData,
  readReferences,
  type ShotGroup,
  type ShotSegment,
} from './canvasFilmAssets'
import {
  buildCharacterSheetPrompt,
  getCharacterSheetTemplate,
  type CharacterPromptFields,
  type CharacterSheetAspect,
} from './canvasCharacterSheetPrompts'
import {
  collectDownstream,
  buildProductionBiblePrompt,
  readStylePresets,
  readStyleBible,
  upsertStylePreset,
  writeProductionBible,
  writeStyleBible,
} from './canvasPipeline'
import {
  appendStylePrompt,
  buildCanvasStyleContext,
  mergeStyleTaskParams,
} from './canvasStyleContext'
import { buildStoryboardGridPrompt } from './canvasStoryboardGrid'
import { buildOpPrompt } from './canvasPipelineOps'
import { buildEntityExtractionPrompt, parseExtractedEntities } from './canvasEntityExtract'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
import { CanvasPromptLibraryPanel, type CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import { CanvasProductionPanel } from './CanvasProductionPanel'
import type { TabKind as FilmCenterTab } from './CanvasFilmAssetCenter'
import type { PipelineStageKey } from './canvasPipelineProgress'
import { type AddNodeMenuItem } from './CanvasAddNodeMenu'
import type { CanvasTemplate } from './canvasTemplates'
import { useCanvasWorkspace } from './canvas.store'
import { canvasApi, isCanvasDirty, revertProject, saveCanvas } from './canvas.api'
import { useApp } from '../../AppContext'
import type {
  CanvasInputTransport,
  CanvasAsset,
  CanvasNode,
  CanvasOperationType,
  CanvasPipelineRole,
  CanvasProject,
  CanvasProjectSettings,
  CanvasTask,
} from './canvas.types'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import './CanvasWorkspaceView.less'

type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type CanvasPoint = { x: number; y: number }
type TrackedCanvasWorkflowResult = {
  count?: number
  outputNodeIds?: string[]
  outputAssetIds?: string[]
  message?: string
  rawResponse?: unknown
  agentId?: string | null
  providerProfileId?: string | null
  provider?: string | null
  modelId?: string | null
}
type PreparedImageUpload = {
  file: File
  filePath: string
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readShotDirectorDraft(
  metadata: Record<string, unknown> | undefined,
  boardId: string,
): Partial<CanvasShotDirectorDraft> | null {
  const shotDirector = metadata?.shotDirector
  if (!isRecord(shotDirector)) return null
  const boards = shotDirector.boards
  if (!isRecord(boards)) return null
  const draft = boards[boardId]
  return isRecord(draft) ? (draft as Partial<CanvasShotDirectorDraft>) : null
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

const CANVAS_SIDE_PANEL_WIDTH_KEY = 'spark-canvas:side-panel-width'
const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 360
const CANVAS_SIDE_PANEL_MIN_WIDTH = 300
const CANVAS_SIDE_PANEL_MAX_WIDTH = 640
const CANVAS_SIDE_PANEL_KEYBOARD_STEP = 24
const GROUP_IMAGE_GAP = 18
const GROUP_IMAGE_PADDING_X = 28
const GROUP_IMAGE_HEADER_HEIGHT = 56
const GROUP_IMAGE_PADDING_BOTTOM = 28

function clampSidePanelWidth(width: number): number {
  return Math.min(Math.max(width, CANVAS_SIDE_PANEL_MIN_WIDTH), CANVAS_SIDE_PANEL_MAX_WIDTH)
}

function readSidePanelWidth(): number {
  if (typeof window === 'undefined') return CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  try {
    const parsed = Number(window.localStorage.getItem(CANVAS_SIDE_PANEL_WIDTH_KEY))
    return Number.isFinite(parsed) ? clampSidePanelWidth(parsed) : CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  } catch {
    return CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  }
}

function fitImageNodeSize(width: number, height: number): { width: number; height: number } {
  const headerHeight = 36
  if (!width || !height) return { width: 320, height: 260 }
  const aspect = height / width
  let nodeWidth = Math.min(Math.max(width, 260), 420)
  let bodyHeight = Math.round(nodeWidth * aspect)
  if (bodyHeight > 680) {
    bodyHeight = 680
    nodeWidth = Math.max(220, Math.round(bodyHeight / aspect))
  }
  return {
    width: Math.round(nodeWidth),
    height: Math.max(220, bodyHeight + headerHeight),
  }
}

function fitGroupedImageNodeSize(width: number, height: number): { width: number; height: number } {
  const headerHeight = 36
  const nodeWidth = 220
  if (!width || !height) return { width: nodeWidth, height: 196 }
  const aspect = height / width
  const bodyHeight = Math.min(Math.max(Math.round(nodeWidth * aspect), 120), 260)
  return {
    width: nodeWidth,
    height: bodyHeight + headerHeight,
  }
}

function getImageGridColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(3, Math.ceil(Math.sqrt(count)))
}

function getImageGridMetrics(items: { width: number; height: number }[]): {
  columns: number
  columnWidths: number[]
  rowHeights: number[]
  width: number
  height: number
} {
  const columns = getImageGridColumns(items.length)
  const rows = Math.ceil(items.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)

  items.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, item.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.height)
  })

  return {
    columns,
    columnWidths,
    rowHeights,
    width:
      columnWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, columns - 1) * GROUP_IMAGE_GAP,
    height:
      rowHeights.reduce((total, height) => total + height, 0) +
      Math.max(0, rows - 1) * GROUP_IMAGE_GAP,
  }
}

function layoutGroupedImages(
  items: PreparedImageUpload[],
  groupPosition: CanvasPoint,
): (PreparedImageUpload & CanvasPoint)[] {
  const metrics = getImageGridMetrics(items)
  const columnOffsets = metrics.columnWidths.map(
    (_, index) =>
      metrics.columnWidths.slice(0, index).reduce((total, width) => total + width, 0) +
      index * GROUP_IMAGE_GAP,
  )
  const rowOffsets = metrics.rowHeights.map(
    (_, index) =>
      metrics.rowHeights.slice(0, index).reduce((total, height) => total + height, 0) +
      index * GROUP_IMAGE_GAP,
  )

  return items.map((item, index) => {
    const column = index % metrics.columns
    const row = Math.floor(index / metrics.columns)
    return {
      ...item,
      x: Math.round(groupPosition.x + GROUP_IMAGE_PADDING_X + (columnOffsets[column] ?? 0)),
      y: Math.round(groupPosition.y + GROUP_IMAGE_HEADER_HEIGHT + (rowOffsets[row] ?? 0)),
    }
  })
}

function clampPosition(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function positionNodeInViewport(
  viewport: CanvasStageViewport | null,
  size: { width: number; height: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || viewport.zoom <= 0) {
    return fallback
  }

  const visibleLeft = -viewport.x / viewport.zoom
  const visibleTop = -viewport.y / viewport.zoom
  const visibleRight = (viewport.width - viewport.x) / viewport.zoom
  const visibleBottom = (viewport.height - viewport.y) / viewport.zoom
  const centerX = visibleLeft + (visibleRight - visibleLeft) / 2
  const centerY = visibleTop + (visibleBottom - visibleTop) / 2

  return {
    x: Math.round(
      clampPosition(centerX - size.width / 2, visibleLeft + 24, visibleRight - size.width - 24),
    ),
    y: Math.round(
      clampPosition(centerY - size.height / 2, visibleTop + 24, visibleBottom - size.height - 24),
    ),
  }
}

function buildTaskInputFiles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRole>,
): CanvasMediaTaskInputFile[] {
  let imageIndex = 0
  return nodes
    .map((node) => {
      if (!node.data.url) return null
      const type =
        node.type === 'image'
          ? ('image' as const)
          : node.type === 'audio'
            ? ('audio' as const)
            : node.type === 'video'
              ? ('video' as const)
              : ('file' as const)
      const currentImageIndex = node.type === 'image' ? imageIndex++ : -1
      const role =
        inputRoles?.[node.id] ??
        (currentImageIndex >= 0
          ? currentImageIndex === 0
            ? ('first_frame' as const)
            : currentImageIndex === 1
              ? ('last_frame' as const)
              : ('reference' as const)
          : ('input' as const))
      return {
        type,
        role,
        ...(node.data.url.startsWith('data:')
          ? { dataUrl: node.data.url }
          : { url: node.data.url }),
        ...(node.data.mimeType ? { mimeType: node.data.mimeType } : {}),
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)
}

async function buildCloudTaskInputFiles(
  nodes: CanvasNode[],
  inputTransport: CanvasInputTransport | undefined,
  inputRoles?: Record<string, CanvasTaskInputRole>,
): Promise<CanvasMediaTaskInputFile[]> {
  const files = buildTaskInputFiles(nodes, inputRoles)
  if (files.length === 0) return files
  if (inputTransport === 'base64') {
    return Promise.all(
      files.map(async (file) => {
        if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://'))
          return file
        return {
          ...file,
          dataUrl: await readUrlAsDataUrl(file.url),
        }
      }),
    )
  }
  if (inputTransport !== 'cloud_url') return files
  return Promise.all(
    files.map(async (file, index) => {
      if (file.type !== 'image') return file
      if (file.url && /^https?:\/\//i.test(file.url)) return file
      const filePath = file.url ? decodeSafeFileUrl(file.url) : null
      const uploaded = await window.spark.invoke('auth:upload-file', {
        ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
        ...(filePath ? { filePath } : {}),
        fileName: `canvas-input-${index + 1}.${extensionFromMime(file.mimeType)}`,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      })
      return {
        type: file.type,
        ...(file.role ? { role: file.role } : {}),
        url: uploaded.aiUrl,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      }
    }),
  )
}

function readUrlAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.readAsDataURL(blob)
        }),
    )
}

function extensionFromMime(mimeType: string | undefined): string {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

function decodeSafeFileUrl(safeFileUrl: string): string | null {
  try {
    if (!safeFileUrl.startsWith('safe-file://')) return null
    const rest = safeFileUrl.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return null
  }
}

function buildPromptContext(nodes: CanvasNode[]): string {
  return nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => node.data.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
}

function mergePromptWithNodeContext(prompt: string, nodes: CanvasNode[]): string {
  const trimmedPrompt = prompt.trim()
  const context = buildPromptContext(nodes)
  if (!context) return trimmedPrompt
  if (!trimmedPrompt) return context
  if (trimmedPrompt.includes(context)) return trimmedPrompt
  return `${trimmedPrompt}\n\n画布节点内容：\n${context}`
}

function placeNodeRightOfNodes(
  nodes: CanvasNode[],
  fallback: { x: number; y: number },
  gap = 80,
): { x: number; y: number } {
  if (nodes.length === 0) return fallback
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const top = Math.min(...nodes.map((node) => node.y))
  return {
    x: Math.round(right + gap),
    y: Math.round(top),
  }
}

function expandCanvasInputNodes(selectedNodes: CanvasNode[], allNodes: CanvasNode[]): CanvasNode[] {
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const result: CanvasNode[] = []
  const seen = new Set<string>()
  const pushNode = (node: CanvasNode) => {
    if (node.hidden || seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
  }

  for (const node of selectedNodes) {
    if (node.type !== 'group') {
      pushNode(node)
      continue
    }
    const members = allNodes
      .filter((item) => item.parentNodeId === node.id && !item.hidden)
      .sort((left, right) => {
        const leftX = node.x + left.x
        const rightX = node.x + right.x
        const leftY = node.y + left.y
        const rightY = node.y + right.y
        return leftX - rightX || leftY - rightY || left.zIndex - right.zIndex
      })
    if (members.length === 0) {
      pushNode(node)
      continue
    }
    for (const member of members) {
      const latest = byId.get(member.id) ?? member
      pushNode(latest)
    }
  }

  return result
}

function resolveCanvasInputNodes(
  nodeIds: string[] | undefined,
  allNodes: CanvasNode[],
): CanvasNode[] {
  if (!nodeIds || nodeIds.length === 0) return []
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const orderedNodes = nodeIds
    .map((id) => byId.get(id))
    .filter((node): node is CanvasNode => Boolean(node))
  return expandCanvasInputNodes(orderedNodes, allNodes)
}

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  if (operation === 'image_edit') return '请基于输入图片进行自然编辑，保持主体与画面质量。'
  if (operation === 'image_to_image') return '请基于输入图片生成一个高质量变体。'
  if (operation === 'image_compose') return '请将输入图片自然合成为一张高质量图片。'
  if (operation === 'image_to_video') return '请基于输入图片生成一段自然流畅的视频。'
  if (operation === 'video_edit') return '请基于输入视频和参考帧进行自然视频编辑。'
  if (operation === 'audio_transcribe') return '请转写输入音频内容。'
  return ''
}

type ScriptBreakdownDraft = {
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
  props: Array<{ name: string; description: string }>
  segments: Array<{
    groupName?: string
    title: string
    description: string
    dialogue?: string
    characterNames: string[]
    sceneName?: string
    shotPrompt?: string
  }>
}

function buildScriptBreakdownDraft(asset: CanvasAsset): ScriptBreakdownDraft {
  const title = asset.title?.trim() || '未命名剧本'
  const text = asset.contentText?.trim() ?? ''
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const characterMap = new Map<string, { name: string; description: string }>()
  const sceneMap = new Map<string, { name: string; description: string }>()
  const propMap = new Map<string, { name: string; description: string }>()
  const segments: ScriptBreakdownDraft['segments'] = []
  let currentSceneName = ''
  let currentGroupName = `${title} - 自动分镜`

  const pushScene = (name: string, description: string) => {
    const normalized = name
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 40)
    if (!normalized || sceneMap.has(normalized)) return
    sceneMap.set(normalized, { name: normalized, description })
  }

  const pushCharacter = (name: string, line: string) => {
    const normalized = name
      .trim()
      .replace(/[（）()【】[\]\s]/g, '')
      .slice(0, 16)
    if (!normalized || normalized.length < 2 || characterMap.has(normalized)) return
    characterMap.set(normalized, {
      name: normalized,
      description: `从剧本「${title}」自动抽取。代表台词/动作：${line.slice(0, 80)}`,
    })
  }

  const pushProp = (name: string, line: string) => {
    const normalized = name
      .trim()
      .replace(/[（）()【】[\]\s]/g, '')
      .slice(0, 16)
    if (!normalized || normalized.length < 2 || propMap.has(normalized)) return
    propMap.set(normalized, {
      name: normalized,
      description: `从剧本「${title}」自动抽取的道具。出现语境：${line.slice(0, 80)}`,
    })
  }

  for (const line of lines.slice(0, 160)) {
    // 显式道具标注：「道具：X、Y」/「【道具】X」（仅在明确标注时抽取，避免误判）
    const propLine = line.match(/^[【\[]?\s*道具\s*[】\]]?\s*[:：]\s*(.+)$/)
    if (propLine && propLine[1]) {
      for (const part of propLine[1].split(/[、,，;；/]/)) pushProp(part, line)
      continue
    }
    const episodeLike = /^(第.{1,8}集|EP\s*\d+|Episode\s*\d+)/i.test(line)
    if (episodeLike && line.length <= 48) {
      currentGroupName = line.replace(/^#+\s*/, '').trim()
      continue
    }

    const sceneLike =
      /^(第.{1,8}[场幕集]|场景|内景|外景|INT\.|EXT\.)/i.test(line) ||
      /(?:室内|室外|街|房间|宫殿|教室|办公室|森林|海边|夜|日|黄昏|清晨)/.test(line)
    if (sceneLike && line.length <= 48) {
      currentSceneName = line.replace(/^场景[:：]?\s*/, '')
      pushScene(currentSceneName, line)
      continue
    }

    const dialogue = line.match(/^([^：:]{2,16})[：:]\s*(.+)$/)
    const characterNames: string[] = []
    let dialogueText = ''
    if (dialogue) {
      const name = dialogue[1]?.trim() ?? ''
      dialogueText = dialogue[2]?.trim() ?? ''
      pushCharacter(name, dialogueText)
      characterNames.push(name.replace(/[（）()【】[\]\s]/g, '').slice(0, 16))
    }

    if (segments.length < 24 && (dialogueText || line.length >= 8)) {
      const summary = dialogueText || line
      segments.push({
        groupName: currentGroupName,
        title: `镜${segments.length + 1} - ${summary.slice(0, 18)}`,
        description: dialogueText ? `${characterNames[0] ?? '角色'}说：${dialogueText}` : line,
        ...(dialogueText ? { dialogue: dialogueText } : {}),
        characterNames,
        ...(currentSceneName ? { sceneName: currentSceneName } : {}),
        shotPrompt: '电影感构图，主体清晰，动作自然，镜头连贯。',
      })
    }
  }

  if (sceneMap.size === 0) {
    pushScene(
      `${title} - 默认场景`,
      '根据剧本文本自动生成的默认场景，请后续补充地点、光线和美术风格。',
    )
  }

  return {
    characters: [...characterMap.values()].slice(0, 16),
    scenes: [...sceneMap.values()].slice(0, 12),
    props: [...propMap.values()].slice(0, 16),
    segments:
      segments.length > 0
        ? segments
        : [
            {
              groupName: currentGroupName,
              title: '镜1 - 剧情开场',
              description: text.slice(0, 160) || '请补充分镜画面描述。',
              characterNames: [],
              shotPrompt: '电影感开场镜头，建立场景氛围。',
            },
          ],
  }
}

/** 影视资产种类 → 流水线节点角色（设计 §6），用于插入画布时打标 */
function filmKindToPipelineRole(
  kind: ReturnType<typeof readAssetKind>,
): import('./canvas.types').CanvasPipelineRole | undefined {
  switch (kind) {
    case 'chapter':
      return 'chapter'
    case 'script':
      return 'screenplay'
    case 'character':
      return 'character'
    case 'scene':
      return 'scene'
    case 'prop':
      return 'prop'
    case 'effect':
      return 'effect'
    default:
      return undefined
  }
}

/** 把角色资产（contentText + metadata.attributes）映射为角色图提示词字段（设计 §S4） */
function assetToCharacterFields(asset: CanvasAsset): CharacterPromptFields {
  const attrs = (asset.metadata?.attributes as Record<string, string> | undefined) ?? {}
  const appearanceParts = [
    asset.contentText ?? '',
    ...Object.entries(attrs)
      .filter(([, value]) => value && value.trim())
      .map(([key, value]) => `${key}: ${value}`),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
  const fields: CharacterPromptFields = {}
  if (asset.title) fields.name = asset.title
  if (appearanceParts.length > 0) fields.appearance = appearanceParts.join(', ')
  return fields
}

/** 设定文本摘要上限：参考图 prompt 只需要视觉要点，整段原文既浪费 token 又稀释画面重点 */
const REFERENCE_SETTING_MAX = 240

/** 把可能很长的设定文本压成一句视觉摘要：去多余空白、取要点、截断 */
function condenseSettingText(text?: string | null): string {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= REFERENCE_SETTING_MAX) return normalized
  // 优先在句末标点处截断，读起来更完整
  const head = normalized.slice(0, REFERENCE_SETTING_MAX)
  const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('，'), head.lastIndexOf('；'))
  return (lastStop > REFERENCE_SETTING_MAX * 0.6 ? head.slice(0, lastStop + 1) : head) + '…'
}

function buildFilmAssetReferencePrompt(asset: CanvasAsset, styleBible?: string): string {
  const kind = readAssetKind(asset)
  const subject =
    kind === 'character'
      ? '角色定妆/设定'
      : kind === 'scene'
        ? '场景概念'
        : kind === 'prop'
          ? '道具设定'
          : '视觉参考'
  const attrs = asset.metadata?.attributes as Record<string, string> | undefined
  // 结构化属性优先（性别/年龄/外貌/材质…），它们才是出图最该锚定的视觉锚点
  const attrText = attrs
    ? Object.entries(attrs)
        .filter(([, value]) => value && value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`)
        .join('；')
    : ''
  const setting = condenseSettingText(asset.contentText)
  const stylePrompt = typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt.trim() : ''

  // 只喂结构化视觉要点 + 截断后的设定摘要，避免把整章/整段原文丢给模型
  const base = [
    `为影视项目生成一张「${asset.title ?? '未命名'}」的${subject}参考图。`,
    attrText ? `视觉要点：${attrText}` : '',
    setting ? `设定摘要：${setting}` : '',
    stylePrompt ? `风格要求：${stylePrompt}` : '',
    styleBible && styleBible.trim() ? `统一视觉基调：${styleBible.trim()}` : '',
    '画面：电影级质感、主体居中、背景干净，便于作为后续分镜与视频生成的一致性参考。',
  ].filter(Boolean)
  return base.join('\n')
}

/** 导演台阶段 → 影视资产中心 tab（深链定位） */
const PRODUCTION_STAGE_TO_TAB: Record<PipelineStageKey, FilmCenterTab> = {
  manuscript: 'manuscript',
  screenplay: 'script',
  resource: 'character',
  shot: 'shots',
  keyframe: 'shots',
  video: 'shots',
}

/** 分镜节点展示文本（§S6 节点化） */
function buildShotNodeText(group: ShotGroup, segment: ShotSegment): string {
  return [
    `【${group.name}】镜${segment.index}`,
    segment.description ? segment.description : '',
    segment.dialogue ? `对白：${segment.dialogue}` : '',
    segment.shotPrompt ? `镜头：${segment.shotPrompt}` : '',
    segment.durationSec != null ? `时长：${segment.durationSec}s` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function findSegmentStyleFragments(
  segment: ShotSegment,
  presets: ReturnType<typeof readStylePresets>,
): string[] {
  const ids = [segment.cameraDesignId, segment.frameDesignId, segment.actionDesignId].filter(
    (id): id is string => Boolean(id),
  )
  return ids
    .map((id) => presets.find((preset) => preset.id === id)?.promptFragment?.trim())
    .filter((fragment): fragment is string => Boolean(fragment))
}

function buildShotSegmentVideoPrompt(
  input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  },
  styleBible?: string,
  styleFragments: string[] = [],
): string {
  const { group, segment, characters, scene } = input
  const characterText = characters
    .map((asset) => {
      const refs = readReferences(asset.metadata)
      const refText = refs
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
      return `${asset.title ?? '角色'}：${asset.contentText ?? ''}${refText ? `；参考：${refText}` : ''}`
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    `请生成一段影视分镜视频。`,
    `分组：${group.name}`,
    `镜号：#${segment.index} ${segment.title}`,
    segment.description ? `画面/动作：${segment.description}` : '',
    segment.dialogue ? `对白：${segment.dialogue}` : '',
    segment.narration ? `旁白：${segment.narration}` : '',
    scene
      ? `场景：${scene.title ?? ''} ${scene.contentText ?? ''}${sceneRefs ? `；参考：${sceneRefs}` : ''}`
      : '',
    characterText ? `角色设定：\n${characterText}` : '',
    segment.shotPrompt ? `镜头语言：${segment.shotPrompt}` : '',
    styleFragments.length > 0 ? `片段风格预设：${styleFragments.join('；')}` : '',
    styleBible && styleBible.trim() ? `视觉总设定：${styleBible.trim()}` : '',
    '生成要求：动作自然，角色一致，场景连贯，电影感光影，避免字幕、水印和畸变。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildChapterToScreenplayInstruction(chapterText: string): string {
  return [
    '请把下面的小说/长文稿章节改写为影视剧本（场次剧本）。',
    '要求：按场次切分，每场标注【场号 内/外景 地点 时间】；正文用「动作描述 + 角色对白 + 旁白」格式；',
    '保留关键情节与人物关系；对白口语化、可表演；输出可直接用于后续角色/场景/分镜拆解，不要解释过程。',
    `章节原文：\n${chapterText.slice(0, 8000)}`,
  ].join('\n\n')
}

function buildShotSegmentKeyframePrompt(
  input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  },
  frame: 'first' | 'last',
  styleBible: string,
  styleFragments: string[] = [],
): string {
  const { group, segment, characters, scene } = input
  const characterText = characters
    .map((asset) => {
      const refs = readReferences(asset.metadata)
      const refText = refs
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
      return `${asset.title ?? '角色'}：${asset.contentText ?? ''}${refText ? `；参考：${refText}` : ''}`
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    `请生成一张影视分镜${frame === 'first' ? '首帧' : '尾帧'}关键帧图。`,
    `分组：${group.name}`,
    `镜号：#${segment.index} ${segment.title}`,
    segment.durationSec != null ? `镜头时长：${segment.durationSec} 秒` : '',
    segment.description ? `画面/动作：${segment.description}` : '',
    frame === 'first'
      ? '取镜头开始瞬间的画面。'
      : '取镜头结束瞬间的画面，需与首帧保持同一场景与角色一致。',
    scene
      ? `场景：${scene.title ?? ''} ${scene.contentText ?? ''}${sceneRefs ? `；参考：${sceneRefs}` : ''}`
      : '',
    characterText ? `角色设定：\n${characterText}` : '',
    segment.shotPrompt ? `镜头语言：${segment.shotPrompt}` : '',
    styleFragments.length > 0 ? `片段风格预设：${styleFragments.join('；')}` : '',
    styleBible ? `视觉总设定：${styleBible}` : '',
    '生成要求：电影级光影，角色与场景一致，单帧静态画面，避免字幕、水印和畸变。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildPromptOptimizationInstruction(prompt: string, negativePrompt: string): string {
  const sections = [
    '请把下面的提示词优化为适合影视/多媒体生成模型使用的专业提示词。',
    '要求：保留原意，补充主体、场景、镜头语言、光影、风格、质量要求；输出可直接复制使用的提示词，不要解释过程。',
    `原提示词：\n${prompt.trim()}`,
  ]
  if (negativePrompt.trim()) {
    sections.push(`反向提示词：\n${negativePrompt.trim()}`)
  }
  return sections.join('\n\n')
}

function buildRelatedPromptInstruction(prompt: string): string {
  return [
    '请基于以下文本生成 5 条可用于影视画布节点的相关提示词。',
    '每条提示词应覆盖不同用途，例如角色设定、场景氛围、镜头语言、动作表演、视频生成。',
    '输出格式：使用编号列表，每条包含简短标题和可直接使用的 prompt。',
    `源文本：\n${prompt.trim() || '请围绕当前影视项目生成可复用提示词。'}`,
  ].join('\n\n')
}

function appendPromptFragment(current: string, fragment: string): string {
  const clean = fragment.trim()
  if (!clean) return current
  const base = current.trimEnd()
  return base ? `${base}\n${clean}` : clean
}

function areNodeIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    Boolean(
      target.closest(
        '[contenteditable="true"], .canvas-inline-ai-composer, .ant-modal, .ant-drawer',
      ),
    )
  )
}

function toolLabel(tool: CanvasTool): string {
  return tool === 'pan' ? '平移画布' : '选择节点'
}

export function CanvasWorkspaceView({
  projectId,
  onBack,
}: {
  projectId: string
  onBack: () => void
}) {
  const {
    snapshot,
    loading,
    updateNodes,
    connectNodes,
    createTextNode,
    createImageNode,
    uploadImageAsset,
    createGroupNode,
    dissolveGroupNode,
    addNodesToGroup,
    removeNodesFromGroup,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNodeData,
    updateProjectSettings,
    createTask,
    completeDemoTask,
    cancelTask,
    // board 管理
    createBoard,
    renameBoard,
    deleteBoard,
    duplicateBoard,
    switchBoard,
    setDefaultBoard,
    copyNodesToBoard,
    // 资产
    insertAsset,
    refresh,
    applyTemplate,
    updateProjectMetadata,
    createFilmAsset,
    importManuscript,
    deleteManuscript,
    updateFilmAsset,
    deleteFilmAsset,
    getFilmAssetUsage,
    createShotGroup,
    updateShotGroup,
    deleteShotGroup,
    createShotSegment,
    updateShotSegment,
    deleteShotSegment,
    createOperationNode,
    retryOperationNode,
    runOperationNode,
  } = useCanvasWorkspace(projectId)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [filmCenterOpen, setFilmCenterOpen] = useState(false)
  const [shotDirectorOpen, setShotDirectorOpen] = useState(false)
  const [filmCenterInitialTab, setFilmCenterInitialTab] = useState<FilmCenterTab | undefined>(
    undefined,
  )
  const [agentOpen, setAgentOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [toolSwitchHint, setToolSwitchHint] = useState<{ tool: CanvasTool; nonce: number } | null>(
    null,
  )
  const [inlineAiOpen, setInlineAiOpen] = useState(false)
  const [saveToLibraryNodeId, setSaveToLibraryNodeId] = useState<string | null>(null)
  const saveToLibraryNode = useMemo(
    () =>
      saveToLibraryNodeId
        ? (snapshot?.nodes.find((n) => n.id === saveToLibraryNodeId) ?? null)
        : null,
    [saveToLibraryNodeId, snapshot],
  )
  const [sidePanelTab, setSidePanelTab] = useState<
    'production' | 'boards' | 'assets' | 'details' | 'project'
  >('details')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [activeOperationPanelNodeId, setActiveOperationPanelNodeId] = useState<string | null>(null)
  const [assetDetailResetKey, setAssetDetailResetKey] = useState(0)
  const canvasViewportRef = useRef<CanvasStageViewport | null>(null)
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePositionRef = useRef<CanvasPoint | null>(null)
  const activeToolRef = useRef<CanvasTool>('select')
  const { registerNavGuard } = useApp()
  const [dirty, setDirty] = useState(() => isCanvasDirty())
  const [saving, setSaving] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const savingRef = useRef(false)
  const leaveResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)
  const sidePanelStyle = useMemo(
    () =>
      ({
        '--canvas-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`,
      }) as CSSProperties,
    [sidePanelCollapsed, sidePanelWidth],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_SIDE_PANEL_WIDTH_KEY, String(sidePanelWidth))
    } catch {
      // Ignore storage failures; the current session still keeps the resized panel.
    }
  }, [sidePanelWidth])

  useEffect(
    () => () => {
      document.body.classList.remove('canvas-side-panel-resizing')
    },
    [],
  )

  const updateSidePanelWidth = useCallback((width: number) => {
    setSidePanelWidth(Math.round(clampSidePanelWidth(width)))
  }, [])

  const handleSidePanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidePanelWidth
      const body = document.body
      body.classList.add('canvas-side-panel-resizing')

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateSidePanelWidth(startWidth + startX - moveEvent.clientX)
      }

      const handlePointerUp = () => {
        body.classList.remove('canvas-side-panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [sidePanelWidth, updateSidePanelWidth],
  )

  const handleSidePanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        updateSidePanelWidth(sidePanelWidth + CANVAS_SIDE_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        updateSidePanelWidth(sidePanelWidth - CANVAS_SIDE_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'Home') {
        event.preventDefault()
        updateSidePanelWidth(CANVAS_SIDE_PANEL_MIN_WIDTH)
      } else if (event.key === 'End') {
        event.preventDefault()
        updateSidePanelWidth(CANVAS_SIDE_PANEL_MAX_WIDTH)
      }
    },
    [sidePanelWidth, updateSidePanelWidth],
  )

  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      const ok = await saveCanvas()
      if (ok) {
        message.success('画布已保存')
      } else {
        message.error('保存失败，请查看控制台日志')
      }
      return ok
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  // 监听 dirty 变化，刷新「未保存」徽标
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ dirty?: boolean }>).detail
      setDirty(Boolean(detail?.dirty))
    }
    window.addEventListener('canvas:dirty', handler as EventListener)
    return () => window.removeEventListener('canvas:dirty', handler as EventListener)
  }, [])

  // Ctrl / Cmd + S 手动保存（不在输入框内时）
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 's') return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      void doSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doSave])

  // 离开确认：返回用户选择（'save' 表示弹窗内已完成落库）
  const askLeave = useCallback((): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      leaveResolveRef.current = resolve
      setLeaveOpen(true)
    })
  }, [])

  // 注册导航守卫：侧边栏切换视图时若 dirty，先弹离开确认
  useEffect(() => {
    registerNavGuard(async () => {
      if (!isCanvasDirty()) return true
      const choice = await askLeave()
      if (choice === 'cancel') return false
      if (choice === 'discard') await revertProject(projectId)
      return true
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, askLeave, projectId])

  const handleBackWithGuard = useCallback(async () => {
    if (!isCanvasDirty()) {
      onBack()
      return
    }
    const choice = await askLeave()
    if (choice === 'cancel') return
    if (choice === 'discard') await revertProject(projectId)
    onBack()
  }, [askLeave, onBack, projectId])

  const onLeaveSave = useCallback(async () => {
    const ok = await doSave()
    if (!ok) return // 保存失败：保持弹窗打开，不离开
    setLeaveOpen(false)
    leaveResolveRef.current?.('save')
    leaveResolveRef.current = null
  }, [doSave])
  const onLeaveDiscard = useCallback(() => {
    setLeaveOpen(false)
    leaveResolveRef.current?.('discard')
    leaveResolveRef.current = null
  }, [])
  const onLeaveCancel = useCallback(() => {
    setLeaveOpen(false)
    leaveResolveRef.current?.('cancel')
    leaveResolveRef.current = null
  }, [])

  const selectedNodes = useMemo(
    () => snapshot?.nodes.filter((node) => selectedNodeIds.includes(node.id)) ?? [],
    [selectedNodeIds, snapshot?.nodes],
  )
  const aiInputNodes = useMemo(
    () => expandCanvasInputNodes(selectedNodes, snapshot?.nodes ?? []),
    [selectedNodes, snapshot?.nodes],
  )
  const editingNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === editingNodeId) ?? null,
    [editingNodeId, snapshot?.nodes],
  )
  const selectedGroups = useMemo(
    () => selectedNodes.filter((node) => node.type === 'group'),
    [selectedNodes],
  )
  const selectedTopLevelNodes = useMemo(
    () => selectedNodes.filter((node) => node.type !== 'group' && !node.parentNodeId),
    [selectedNodes],
  )
  const selectedGroupedNodes = useMemo(
    () => selectedNodes.filter((node) => Boolean(node.parentNodeId)),
    [selectedNodes],
  )
  const canCreateGroup =
    selectedNodes.length >= 2 &&
    selectedNodes.every((node) => node.type !== 'group' && !node.parentNodeId)
  const canAddToGroup = selectedGroups.length === 1 && selectedTopLevelNodes.length > 0
  const canRemoveFromGroup = selectedGroupedNodes.length > 0
  const canDissolveGroup = selectedGroups.length === 1
  const shotDirectorDraft = useMemo(
    () => (snapshot ? readShotDirectorDraft(snapshot.project.metadata, snapshot.board.id) : null),
    [snapshot],
  )
  const toolSwitchHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    activeToolRef.current = activeTool
  }, [activeTool])

  const showToolSwitchHint = useCallback((tool: CanvasTool) => {
    setToolSwitchHint({ tool, nonce: Date.now() })
    if (toolSwitchHintTimerRef.current != null) clearTimeout(toolSwitchHintTimerRef.current)
    toolSwitchHintTimerRef.current = setTimeout(() => {
      setToolSwitchHint(null)
      toolSwitchHintTimerRef.current = null
    }, 1500)
  }, [])

  const handleToolChange = useCallback((tool: CanvasTool) => {
    activeToolRef.current = tool
    setActiveTool(tool)
  }, [])

  const closeCanvasFloatPanels = useCallback(
    (
      except?:
        | 'inline-ai'
        | 'operation'
        | 'film-center'
        | 'shot-director'
        | 'agent'
        | 'node-edit'
        | 'asset-detail',
    ) => {
      if (except !== 'inline-ai') setInlineAiOpen(false)
      if (except !== 'operation') setActiveOperationPanelNodeId(null)
      if (except !== 'film-center') setFilmCenterOpen(false)
      if (except !== 'shot-director') setShotDirectorOpen(false)
      if (except !== 'agent') setAgentOpen(false)
      if (except !== 'node-edit') setEditingNodeId(null)
      if (except !== 'asset-detail') setAssetDetailResetKey((key) => key + 1)
    },
    [],
  )

  const togglePointerTool = useCallback(() => {
    const nextTool: CanvasTool = activeToolRef.current === 'pan' ? 'select' : 'pan'
    activeToolRef.current = nextTool
    setActiveTool(nextTool)
    showToolSwitchHint(nextTool)
  }, [showToolSwitchHint])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      togglePointerTool()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (toolSwitchHintTimerRef.current != null) clearTimeout(toolSwitchHintTimerRef.current)
    }
  }, [togglePointerTool])

  const handleSelectionChange = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds((previousIds) =>
      areNodeIdsEqual(previousIds, nodeIds) ? previousIds : nodeIds,
    )
    setActiveOperationPanelNodeId((currentId) =>
      currentId && nodeIds.length === 1 && nodeIds[0] === currentId ? currentId : null,
    )
    setEditingNodeId((currentId) =>
      currentId && nodeIds.length === 1 && nodeIds[0] === currentId ? currentId : null,
    )
  }, [])

  const handleNodeSelectIntent = useCallback(
    (nodeId: string) => {
      const node = snapshot?.nodes.find((item) => item.id === nodeId)
      if (!node) return

      if (activeOperationPanelNodeId === nodeId || editingNodeId === nodeId) return
      closeCanvasFloatPanels()
    },
    [activeOperationPanelNodeId, closeCanvasFloatPanels, editingNodeId, snapshot?.nodes],
  )

  const handleCanvasViewportChange = useCallback((viewport: CanvasStageViewport) => {
    canvasViewportRef.current = viewport
  }, [])

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeIds((previousIds) => previousIds.filter((id) => id !== nodeId))
      setActiveOperationPanelNodeId((currentId) => (currentId === nodeId ? null : currentId))
      setEditingNodeId((currentId) => (currentId === nodeId ? null : currentId))
      void deleteNodes([nodeId])
    },
    [deleteNodes],
  )

  const handleDeleteSelectedNodes = useCallback(() => {
    const nodeIds = selectedNodes.map((node) => node.id)
    if (nodeIds.length === 0) return
    Modal.confirm({
      title: nodeIds.length === 1 ? '删除选中节点？' : `删除选中的 ${nodeIds.length} 个节点？`,
      content:
        nodeIds.length === 1
          ? '删除后该节点会从当前画布移除，相关连线也会同步清理。'
          : '删除后这些节点会从当前画布移除，相关连线也会同步清理。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteNodes(nodeIds)
          setSelectedNodeIds([])
          setActiveOperationPanelNodeId((currentId) =>
            currentId && nodeIds.includes(currentId) ? null : currentId,
          )
          setEditingNodeId((currentId) =>
            currentId && nodeIds.includes(currentId) ? null : currentId,
          )
          closeCanvasFloatPanels()
          message.success(nodeIds.length === 1 ? '已删除节点' : `已删除 ${nodeIds.length} 个节点`)
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除节点失败')
          throw error
        }
      },
    })
  }, [closeCanvasFloatPanels, deleteNodes, selectedNodes])

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      void duplicateNodes([nodeId])
    },
    [duplicateNodes],
  )

  const handleToggleLockNode = useCallback(
    (nodeId: string) => {
      const node = snapshot?.nodes.find((item) => item.id === nodeId)
      if (!node) return
      void patchNodes([nodeId], { locked: !node.locked })
    },
    [patchNodes, snapshot?.nodes],
  )

  const handleBringNodeToFront = useCallback(
    (nodeId: string) => {
      const nodes = snapshot?.nodes ?? []
      const maxZ = Math.max(0, ...nodes.map((node) => node.zIndex))
      void patchNodes([nodeId], { zIndex: maxZ + 1 })
    },
    [patchNodes, snapshot?.nodes],
  )

  const handleCreateGroup = useCallback(() => {
    if (selectedTopLevelNodes.length < 2) return
    void createGroupNode(selectedTopLevelNodes.map((node) => node.id))
  }, [createGroupNode, selectedTopLevelNodes])

  const handleAddSelectionToGroup = useCallback(
    (groupId?: string) => {
      const targetGroupId = groupId ?? selectedGroups[0]?.id
      if (!targetGroupId || selectedTopLevelNodes.length === 0) return
      void addNodesToGroup(
        targetGroupId,
        selectedTopLevelNodes.map((node) => node.id),
      )
    },
    [addNodesToGroup, selectedGroups, selectedTopLevelNodes],
  )

  const handleRemoveFromGroup = useCallback(
    (nodeIds?: string[]) => {
      const targetNodeIds = nodeIds ?? selectedGroupedNodes.map((node) => node.id)
      if (targetNodeIds.length === 0) return
      void removeNodesFromGroup(targetNodeIds)
    },
    [removeNodesFromGroup, selectedGroupedNodes],
  )

  const handleDissolveGroup = useCallback(
    (groupId?: string) => {
      const targetGroupId = groupId ?? selectedGroups[0]?.id
      if (!targetGroupId) return
      void dissolveGroupNode(targetGroupId)
    },
    [dissolveGroupNode, selectedGroups],
  )

  const handleOpenInlineAi = useCallback(
    (nodeId?: string) => {
      closeCanvasFloatPanels('inline-ai')
      if (nodeId && !selectedNodeIds.includes(nodeId)) {
        setSelectedNodeIds([nodeId])
      }
      setInlineAiOpen(true)
    },
    [closeCanvasFloatPanels, selectedNodeIds],
  )

  const handleEditNode = useCallback(
    (nodeId: string) => {
      const node = snapshot?.nodes.find((item) => item.id === nodeId)
      if (node && isOperationNode(node)) {
        closeCanvasFloatPanels('operation')
        setSelectedNodeIds([nodeId])
        setActiveOperationPanelNodeId(nodeId)
        return
      }
      closeCanvasFloatPanels('node-edit')
      setSelectedNodeIds([nodeId])
      setEditingNodeId(nodeId)
    },
    [closeCanvasFloatPanels, snapshot?.nodes],
  )

  const handleSaveNodeEdit = useCallback(
    async (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => {
      await patchNodes([node.id], patch)
      await updateNodeData(node.id, data)
      setEditingNodeId(null)
    },
    [patchNodes, updateNodeData],
  )

  // ─── 节点创建动作（useCallback，必须在 early return 之前）────────────────
  // 这些被 handleAddNodeItem / Stage / BottomDock 等多处引用，统一在 hooks 区定义。
  const addText = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(
            canvasViewportRef.current,
            { width: 280, height: 164 },
            { x: 140, y: 120 },
          )
      await createTextNode({
        text: '双击后续版本可直接编辑文本内容。',
        x: position.x,
        y: position.y,
      })
    },
    [createTextNode],
  )

  const uploadFirstImage = useCallback((preferredPosition?: CanvasPoint) => {
    pendingImagePositionRef.current = preferredPosition
      ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
      : null
    fileInputRef.current?.click()
  }, [])

  const handleSwitchBoard = useCallback(
    async (boardId: string) => {
      if (!snapshot || boardId === snapshot.board.id) return
      const vp = canvasViewportRef.current
      const viewport = vp ? { x: vp.x, y: vp.y, zoom: vp.zoom } : undefined
      await switchBoard(boardId, viewport)
      setSelectedNodeIds([])
    },
    [snapshot, switchBoard],
  )

  const handleInsertAsset = useCallback(
    async (assetId: string) => {
      if (!snapshot) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 280, height: 200 },
        { x: 220, y: 180 },
      )
      const node = await insertAsset({
        assetId,
        boardId: snapshot.board.id,
        x: position.x,
        y: position.y,
      })
      // 影视资产插入后打上流水线角色，使画布右键出现「下一步」编排动作（设计 §7）
      const asset = snapshot.assets.find((item) => item.id === assetId)
      const role = asset ? filmKindToPipelineRole(readAssetKind(asset)) : undefined
      if (node && role) {
        await updateNodeData(node.id, { pipelineRole: role })
      }
      message.success('已插入资产到当前视口')
    },
    [insertAsset, snapshot, updateNodeData],
  )

  const handleApplyPromptEntryBesideSelection = useCallback(
    async (entry: CanvasPromptLibraryEntry): Promise<boolean> => {
      if (!snapshot || selectedNodes.length === 0) return false
      const anchorNode = selectedNodes.find((node) => node.type !== 'group') ?? selectedNodes[0]
      if (!anchorNode) return false

      const promptText = entry.negativePrompt
        ? `${entry.text}\n\nNegative prompt: ${entry.negativePrompt}`
        : entry.text
      const x = Math.round(anchorNode.x + anchorNode.width + (anchorNode.parentNodeId ? 24 : 36))
      const y = Math.round(anchorNode.y)
      const createdNode = await createTextNode({ text: promptText, x, y })
      if (!createdNode) return false

      await patchNodes([createdNode.id], {
        title: `提示词：${entry.label}`,
        ...(anchorNode.parentNodeId ? { parentNodeId: anchorNode.parentNodeId } : {}),
      })
      setSelectedNodeIds([createdNode.id])
      message.success(`已在选中节点旁新增提示词节点：${entry.label}`)
      return true
    },
    [createTextNode, patchNodes, selectedNodes, snapshot],
  )

  const handleInsertShotDirectorPrompt = useCallback(
    async (promptText: string) => {
      if (!snapshot) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 360, height: 220 },
        { x: 260, y: 200 },
      )
      const createdNode = await createTextNode({
        text: promptText,
        x: position.x,
        y: position.y,
      })
      if (!createdNode) return
      await patchNodes([createdNode.id], {
        title: '分镜导演台提示词',
        width: 360,
        height: 240,
      })
      setSelectedNodeIds([createdNode.id])
      setShotDirectorOpen(false)
      message.success('已插入分镜提示词节点')
    },
    [createTextNode, patchNodes, snapshot],
  )

  const handleSaveShotDirectorDraft = useCallback(
    async (draft: CanvasShotDirectorDraft) => {
      if (!snapshot) return
      const shotDirector = snapshot.project.metadata?.shotDirector
      const root = isRecord(shotDirector) ? shotDirector : {}
      const boards = isRecord(root.boards) ? root.boards : {}
      await updateProjectMetadata({
        shotDirector: {
          ...root,
          version: 1,
          boards: {
            ...boards,
            [snapshot.board.id]: draft,
          },
        },
      })
    },
    [snapshot, updateProjectMetadata],
  )

  const handleInsertShotDirectorScreenshot = useCallback(
    async (input: CanvasShotDirectorScreenshotInput) => {
      if (!snapshot) return
      const fileName = `shot-director-${Date.now()}.png`
      const file = await dataUrlToFile(input.dataUrl, fileName)
      const dimensions = await readImageDimensions(input.dataUrl)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl: input.dataUrl,
        mimeType: file.type,
        suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const nodeSize = fitImageNodeSize(dimensions.width || 1280, dimensions.height || 720)
      const position = positionNodeInViewport(canvasViewportRef.current, nodeSize, {
        x: 260,
        y: 200,
      })
      const imageNode = await createImageNode({
        file,
        filePath: savedImage.filePath,
        x: position.x,
        y: position.y,
        width: nodeSize.width,
        height: nodeSize.height,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      })
      const promptNode = await createTextNode({
        text: input.prompt,
        x: position.x + nodeSize.width + 32,
        y: position.y,
      })
      const selectedIds: string[] = []
      if (imageNode) {
        selectedIds.push(imageNode.id)
        await patchNodes([imageNode.id], { title: '分镜导演台截图' })
      }
      if (promptNode) {
        selectedIds.push(promptNode.id)
        await patchNodes([promptNode.id], {
          title: '分镜导演台提示词',
          width: 360,
          height: 240,
        })
      }
      if (selectedIds.length > 0) setSelectedNodeIds(selectedIds)
      message.success('已插入导演台截图和提示词')
    },
    [createImageNode, createTextNode, patchNodes, snapshot],
  )

  /** 应用模板：在当前视口中心生成节点组合（文档 §7.8） */
  const handleApplyTemplate = useCallback(
    async (template: CanvasTemplate) => {
      if (!snapshot) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 480, height: 320 },
        { x: 200, y: 160 },
      )
      await applyTemplate({
        boardId: snapshot.board.id,
        originX: position.x,
        originY: position.y,
        nodes: template.nodes,
        ...(template.edges ? { edges: template.edges } : {}),
      })
      setTemplateOpen(false)
    },
    [applyTemplate, snapshot],
  )

  const referencedAssetIds = useMemo(
    () =>
      new Set(
        (snapshot?.nodes ?? [])
          .map((node) => node.assetId)
          .filter((id): id is string => Boolean(id)),
      ),
    [snapshot?.nodes],
  )

  const handleLocateAsset = useCallback(
    (assetId: string) => {
      if (!snapshot) return
      const node = snapshot.nodes.find((item) => item.assetId === assetId)
      if (node) {
        setSelectedNodeIds([node.id])
        message.info(`已定位到节点：${node.title ?? node.type}`)
      }
    },
    [snapshot],
  )

  const handleAddNodeItem = useCallback(
    (item: AddNodeMenuItem) => {
      closeCanvasFloatPanels()
      // 内容节点：文本 / prompt 直接创建
      if (item.nodeType === 'text' || item.nodeType === 'prompt') {
        void addText()
        return
      }
      // 图片走上传链路
      if (item.action === 'upload_image' || item.nodeType === 'image') {
        uploadFirstImage()
        return
      }
      // 资源入口
      if (item.action === 'insert_asset') {
        setSidePanelTab('assets')
        return
      }
      if (item.action === 'from_history' || item.action === 'from_template') {
        message.info('该入口将在后续阶段开放')
        return
      }
      // AI 工作节点：打开 inline AI composer 并预选 operation
      if (item.operation) {
        closeCanvasFloatPanels('inline-ai')
        setInlineAiOpen(true)
      }
    },
    [addText, closeCanvasFloatPanels, uploadFirstImage, setSidePanelTab],
  )

  const handleToggleGrid = useCallback(() => {
    if (!snapshot) return
    const next = snapshot.board.settings.grid !== false ? false : true
    void canvasApi
      .updateBoardSettings(projectId, snapshot.board.id, { grid: next })
      .then(() => {
        void refresh()
      })
      .catch(() => {})
  }, [snapshot, projectId, refresh])

  // 全局 ESC：按优先级关闭最上层弹窗（避免多个弹窗同时收到事件）。
  // 顺序对应"视觉层级"：确认对话框 > 二级模态 > 主弹窗 > 侧栏抽屉。
  // 在输入控件聚焦时不拦截（让 textarea/input 自己处理 ESC，比如清空选区）。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (leaveOpen) {
        setLeaveOpen(false)
      } else if (saveToLibraryNodeId != null) {
        setSaveToLibraryNodeId(null)
      } else if (editingNodeId != null) {
        setEditingNodeId(null)
      } else if (agentOpen) {
        setAgentOpen(false)
      } else if (filmCenterOpen) {
        setFilmCenterOpen(false)
      } else if (inlineAiOpen) {
        setInlineAiOpen(false)
      } else if (historyOpen) {
        setHistoryOpen(false)
      } else if (templateOpen) {
        setTemplateOpen(false)
      } else {
        return // 没有开着的弹窗，让其他 handler 处理
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    leaveOpen,
    saveToLibraryNodeId,
    editingNodeId,
    agentOpen,
    filmCenterOpen,
    inlineAiOpen,
    historyOpen,
    templateOpen,
  ])

  if (loading) {
    return (
      <div className="canvas-workspace canvas-workspace-loading">
        <Spin tip="正在加载画布..." />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="canvas-workspace canvas-workspace-loading">
        <Empty description="画布不存在" />
      </div>
    )
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    const preferredPosition = pendingImagePositionRef.current
    pendingImagePositionRef.current = null
    event.target.value = ''
    if (selectedFiles.length === 0) return

    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      message.warning('请选择图片文件')
      return
    }
    if (imageFiles.length < selectedFiles.length) {
      message.warning('已跳过非图片文件')
    }

    try {
      const shouldGroup = imageFiles.length > 1
      const preparedImages: PreparedImageUpload[] = []
      for (const file of imageFiles) {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await readImageDimensions(dataUrl)
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          mimeType: file.type,
          suggestedBaseName: file.name.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
        })
        const nodeSize = shouldGroup
          ? fitGroupedImageNodeSize(dimensions.width, dimensions.height)
          : fitImageNodeSize(dimensions.width, dimensions.height)
        preparedImages.push({
          file,
          filePath: savedImage.filePath,
          width: nodeSize.width,
          height: nodeSize.height,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        })
      }

      if (preparedImages.length === 1) {
        const [image] = preparedImages
        if (!image) return
        const position = preferredPosition
          ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
          : positionNodeInViewport(
              canvasViewportRef.current,
              { width: image.width, height: image.height },
              {
                x: 220,
                y: 180,
              },
            )
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: position.x,
          y: position.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) setSelectedNodeIds([node.id])
        return
      }

      const gridMetrics = getImageGridMetrics(preparedImages)
      const groupSize = {
        width: Math.max(360, gridMetrics.width + GROUP_IMAGE_PADDING_X * 2),
        height: Math.max(
          220,
          GROUP_IMAGE_HEADER_HEIGHT + gridMetrics.height + GROUP_IMAGE_PADDING_BOTTOM,
        ),
      }
      const groupPosition = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, groupSize, {
            x: 220,
            y: 180,
          })
      const placedImages = layoutGroupedImages(preparedImages, groupPosition)
      const createdNodeIds: string[] = []
      for (const image of placedImages) {
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) createdNodeIds.push(node.id)
      }
      if (createdNodeIds.length > 1) {
        const nextSnapshot = await createGroupNode(createdNodeIds)
        const createdIdSet = new Set(createdNodeIds)
        const groupNode = nextSnapshot?.nodes.find((node) => {
          if (node.type !== 'group') return false
          const childIds = nextSnapshot.nodes
            .filter((child) => child.parentNodeId === node.id)
            .map((child) => child.id)
          return (
            createdNodeIds.every((id) => childIds.includes(id)) &&
            childIds.every((id) => createdIdSet.has(id))
          )
        })
        setSelectedNodeIds(groupNode ? [groupNode.id] : createdNodeIds)
        message.success(`已添加 ${createdNodeIds.length} 张图片并成组`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加图片失败')
    }
  }

  const handleCreateTask = async ({
    operation,
    prompt,
    negativePrompt,
    inputNodeIds,
    providerProfileId,
    manifestId,
    modelId,
    modelParams,
    inputTransport,
    inputRoles,
    agentId,
    taskTitle,
    taskPipelineRole,
    outputPipelineRole,
  }: {
    operation: CanvasOperationType
    prompt: string
    negativePrompt?: string
    inputNodeIds?: string[]
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
    inputTransport?: CanvasInputTransport
    inputRoles?: Record<string, CanvasTaskInputRole>
    agentId?: string
    taskTitle?: string
    taskPipelineRole?: CanvasPipelineRole
    outputPipelineRole?: CanvasPipelineRole
  }) => {
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const taskInputNodes =
      inputNodeIds !== undefined
        ? resolveCanvasInputNodes(inputNodeIds, snapshot.nodes)
        : aiInputNodes
    const inputFiles = await buildCloudTaskInputFiles(taskInputNodes, inputTransport, inputRoles)
    const mergedPrompt = mergePromptWithNodeContext(prompt, taskInputNodes)
    const effectivePrompt =
      mergedPrompt || (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : '')
    const styleContext = buildCanvasStyleContext(snapshot, {
      ...(negativePrompt != null ? { negativePrompt } : {}),
      ...(modelParams != null ? { modelParams } : {}),
    })
    const shouldApplyProjectStyle =
      styleContext.ready &&
      [
        'text_to_image',
        'image_to_image',
        'image_edit',
        'image_compose',
        'text_to_video',
        'image_to_video',
        'video_edit',
      ].includes(operation)
    const styledPrompt = shouldApplyProjectStyle
      ? appendStylePrompt(effectivePrompt, styleContext)
      : effectivePrompt
    const styledModelParams = shouldApplyProjectStyle
      ? mergeStyleTaskParams(styleContext, modelParams)
      : modelParams
    const styledNegativePrompt =
      shouldApplyProjectStyle && styleContext.negativePrompt
        ? styleContext.negativePrompt
        : negativePrompt
    const placement = placeNodeRightOfNodes(
      taskInputNodes.length > 0 ? taskInputNodes : selectedNodes,
      {
        x: 360,
        y: 260,
      },
    )

    await createTask({
      operation,
      prompt: styledPrompt,
      ...(styledNegativePrompt != null && styledNegativePrompt.trim().length > 0
        ? { negativePrompt: styledNegativePrompt.trim() }
        : {}),
      inputNodeIds: taskInputNodes.map((node) => node.id),
      inputAssetIds: taskInputNodes
        .map((node) => node.assetId)
        .filter((id): id is string => Boolean(id)),
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      ...(providerProfileId != null ? { providerProfileId } : {}),
      ...(manifestId != null ? { manifestId } : {}),
      ...(modelId != null ? { modelId } : {}),
      ...(styledModelParams != null ? { modelParams: styledModelParams } : {}),
      ...(agentId != null ? { agentId } : {}),
      ...(taskTitle != null ? { taskTitle } : {}),
      ...(taskPipelineRole != null ? { taskPipelineRole } : {}),
      ...(outputPipelineRole != null ? { outputPipelineRole } : {}),
      outputPlacement: {
        x: placement.x,
        y: placement.y,
      },
    })
  }

  const runTrackedCanvasWorkflow = async (
    request: {
      title: string
      prompt?: string
      inputNodeIds?: string[]
      inputAssetIds?: string[]
      bindToNodeId?: string
      message?: string
      agentId?: string
      providerProfileId?: string
      provider?: string
      modelId?: string
      modelParams?: Record<string, unknown>
    },
    run: () => Promise<TrackedCanvasWorkflowResult>,
  ): Promise<TrackedCanvasWorkflowResult> => {
    const placement = positionNodeInViewport(
      canvasViewportRef.current,
      { width: 300, height: 152 },
      { x: 260, y: 200 },
    )
    const { taskId } = await canvasApi.startWorkflowTask(projectId, {
      boardId: snapshot.board.id,
      operation: 'text_generate',
      title: request.title,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.inputNodeIds ? { inputNodeIds: request.inputNodeIds } : {}),
      ...(request.inputAssetIds ? { inputAssetIds: request.inputAssetIds } : {}),
      ...(request.bindToNodeId ? { bindToNodeId: request.bindToNodeId } : {}),
      ...(request.message ? { message: request.message } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.providerProfileId ? { providerProfileId: request.providerProfileId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.modelId ? { modelId: request.modelId } : {}),
      ...(request.modelParams ? { modelParams: request.modelParams } : {}),
      outputPlacement: { x: placement.x, y: placement.y },
    })
    await refresh()

    try {
      const result = await run()
      await canvasApi.finishWorkflowTask(projectId, taskId, {
        status: 'completed',
        ...(result.outputNodeIds ? { outputNodeIds: result.outputNodeIds } : {}),
        ...(result.outputAssetIds ? { outputAssetIds: result.outputAssetIds } : {}),
        ...(result.message ? { message: result.message } : {}),
        ...(result.rawResponse !== undefined ? { rawResponse: result.rawResponse } : {}),
        ...(result.agentId !== undefined ? { agentId: result.agentId } : {}),
        ...(result.providerProfileId !== undefined
          ? { providerProfileId: result.providerProfileId }
          : {}),
        ...(result.provider !== undefined ? { provider: result.provider } : {}),
        ...(result.modelId !== undefined ? { modelId: result.modelId } : {}),
      })
      await refresh()
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await canvasApi.finishWorkflowTask(projectId, taskId, {
        status: 'failed',
        errorMsg: 'workflow_failed',
        errorDetail: errorMessage,
        message: `失败：${errorMessage}`,
      })
      await refresh()
      throw error
    }
  }

  const handleBreakdownScriptAsset: NonNullable<
    FilmCenterHandlers['onBreakdownScriptAsset']
  > = async (asset) => {
    const scriptText = asset.contentText?.trim() ?? ''
    if (!scriptText) {
      message.warning('请先补充剧本内容，再执行拆解')
      return
    }

    const key = `film-breakdown:${asset.id}`
    message.loading({ key, content: '正在拆解剧本，生成角色/场景/分镜草稿...', duration: 0 })

    try {
      const result = await runTrackedCanvasWorkflow(
        {
          title: '剧本拆解 / 自动分镜',
          prompt: scriptText,
          inputAssetIds: [asset.id],
          message: '正在拆解剧本，生成角色/场景/分镜草稿...',
          modelParams: { workflow: 'script_breakdown', sourceAssetId: asset.id },
        },
        async () => {
          const draft = buildScriptBreakdownDraft(asset)
          const sourceTag = `来源:${asset.title ?? '剧本'}`
          const existingByKindAndName = new Map<string, CanvasAsset>()
          const createdAssetIds: string[] = []
          for (const item of snapshot.assets) {
            const kind = readAssetKind(item)
            if (!kind || !item.title) continue
            existingByKindAndName.set(`${kind}:${item.title.trim().toLowerCase()}`, item)
          }

          const ensureAsset = async (
            kind: 'character' | 'scene' | 'prop',
            input: { name: string; text: string },
          ): Promise<CanvasAsset> => {
            const normalizedName = input.name.trim()
            const existing = existingByKindAndName.get(`${kind}:${normalizedName.toLowerCase()}`)
            if (existing) return existing
            const created = await createFilmAsset({
              kind,
              name: normalizedName,
              text: input.text,
              tags: ['剧本拆解', sourceTag],
              attributes: {
                sourceScriptId: asset.id,
                sourceScriptTitle: asset.title ?? '',
              },
            })
            createdAssetIds.push(created.id)
            existingByKindAndName.set(`${kind}:${normalizedName.toLowerCase()}`, created)
            return created
          }

          const createdCharacters = await Promise.all(
            draft.characters.map((character) =>
              ensureAsset('character', {
                name: character.name,
                text: character.description,
              }),
            ),
          )
          const createdScenes = await Promise.all(
            draft.scenes.map((scene) =>
              ensureAsset('scene', {
                name: scene.name,
                text: scene.description,
              }),
            ),
          )
          const createdProps = await Promise.all(
            draft.props.map((prop) =>
              ensureAsset('prop', {
                name: prop.name,
                text: prop.description,
              }),
            ),
          )
          const characterIdByName = new Map(
            createdCharacters.map((item) => [(item.title ?? '').trim().toLowerCase(), item.id]),
          )
          const sceneIdByName = new Map(
            createdScenes.map((item) => [(item.title ?? '').trim().toLowerCase(), item.id]),
          )

          const segmentsByGroup = new Map<string, ScriptBreakdownDraft['segments']>()
          for (const segment of draft.segments) {
            const groupName = segment.groupName?.trim() || `${asset.title ?? '剧本'} - 自动分镜`
            const list = segmentsByGroup.get(groupName) ?? []
            list.push(segment)
            segmentsByGroup.set(groupName, list)
          }

          let createdGroupCount = 0
          let createdSegmentCount = 0
          for (const [groupName, segments] of segmentsByGroup) {
            const group = await createShotGroup({
              name: groupName,
              description: `由剧本「${asset.title ?? '未命名剧本'}」自动拆解生成，可继续人工调整。`,
            })
            createdGroupCount += 1
            for (const segment of segments) {
              const sceneAssetId = segment.sceneName
                ? sceneIdByName.get(segment.sceneName.trim().toLowerCase())
                : undefined
              await createShotSegment(group.id, {
                title: segment.title,
                description: segment.description,
                ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
                characterAssetIds: segment.characterNames
                  .map((name) => characterIdByName.get(name.trim().toLowerCase()))
                  .filter((id): id is string => Boolean(id)),
                ...(sceneAssetId ? { sceneAssetId } : {}),
                ...(segment.shotPrompt ? { shotPrompt: segment.shotPrompt } : {}),
              })
              createdSegmentCount += 1
            }
          }

          const content = `已生成 ${createdCharacters.length} 个角色、${createdScenes.length} 个场景、${createdProps.length} 个道具、${createdGroupCount} 个分组、${createdSegmentCount} 个分镜片段`
          return {
            message: content,
            outputAssetIds: createdAssetIds,
            rawResponse: {
              workflow: 'script_breakdown',
              characterCount: createdCharacters.length,
              sceneCount: createdScenes.length,
              propCount: createdProps.length,
              shotGroupCount: createdGroupCount,
              shotSegmentCount: createdSegmentCount,
            },
          }
        },
      )
      message.success({
        key,
        content: result.message ?? '剧本拆解完成',
      })
    } catch (error) {
      message.error({
        key,
        content: error instanceof Error ? error.message : '剧本拆解失败',
      })
    }
  }

  const handleImportManuscript: NonNullable<FilmCenterHandlers['onImportManuscript']> = async ({
    title,
    mode,
    chapters,
  }) => {
    if (chapters.length === 0) {
      throw new Error('未选择任何章节')
    }
    // 单次事务批量写入（整篇索引 + 逐章 + 章节索引），避免逐章重渲染卡死
    await importManuscript({ title, mode, chapters })
    return chapters.length
  }

  const handleDeleteManuscript: NonNullable<FilmCenterHandlers['deleteManuscript']> = async (
    manuscriptAssetId,
  ) => {
    return deleteManuscript(manuscriptAssetId)
  }

  const handleSaveStylePreset: NonNullable<FilmCenterHandlers['onSaveStylePreset']> = async (
    preset,
  ) => {
    await updateProjectMetadata(upsertStylePreset(snapshot.project.metadata, preset))
  }

  const handleApplyProductionBible: NonNullable<
    FilmCenterHandlers['onApplyProductionBible']
  > = async (productionBible) => {
    await updateProjectMetadata(writeProductionBible(snapshot.project.metadata, productionBible))
    message.success(productionBible.locked ? '项目视觉圣经已应用并锁定' : '项目视觉圣经已应用')
  }

  const handleExportTimeline: NonNullable<FilmCenterHandlers['onExportTimeline']> = ({
    title,
    markdown,
  }) => {
    void (async () => {
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 460, height: 360 },
        { x: 240, y: 200 },
      )
      const node = await createTextNode({ text: markdown, x: position.x, y: position.y })
      if (node) {
        await patchNodes([node.id], { title: `成片清单 · ${title}` })
      }
      message.success('成片清单已插入画布')
    })()
  }

  const handleChapterToScreenplay: NonNullable<
    FilmCenterHandlers['onChapterToScreenplay']
  > = async (asset) => {
    const chapterText = asset.contentText?.trim() ?? ''
    if (!chapterText) {
      message.warning('该章节没有正文内容')
      return
    }
    const scriptAsset = await createFilmAsset({
      kind: 'script',
      name: `${asset.title ?? '章节'} · 剧本`,
      text: chapterText,
      tags: [`来源:${asset.title ?? '章节'}`],
    })
    // 触发 agent 把小说体改写为场次剧本格式（产出节点标记为 screenplay，可直接右键继续编排）
    void handleCreateTask({
      operation: 'text_rewrite',
      prompt: buildChapterToScreenplayInstruction(chapterText),
      inputNodeIds: [],
      taskTitle: '生成剧本',
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'screenplay',
    })
    message.success(
      `已创建剧本「${scriptAsset.title}」，并发起剧本化改写；产出的剧本节点可右键继续编排`,
    )
  }

  const handleSetProductionState = async (
    nodeId: string,
    state: import('./canvas.types').CanvasProductionState,
  ): Promise<void> => {
    await updateNodeData(nodeId, {
      productionState: state,
      ...(state === 'confirmed' ? { confirmedAt: new Date().toISOString() } : {}),
    })
    // 确认即视为「上游已定稿」：把下游已生成节点标记为待更新（§9.2 过期传播）
    if (state === 'confirmed') {
      const edges = snapshot.edges
        .filter((edge) => edge.type === 'used_as_input' || edge.type === 'generated')
        .map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId }))
      const downstream = collectDownstream(nodeId, edges)
      let marked = 0
      for (const downstreamId of downstream) {
        const node = snapshot.nodes.find((item) => item.id === downstreamId)
        if (!node || node.data.productionState === 'stale') continue
        await updateNodeData(downstreamId, { productionState: 'stale' })
        marked += 1
      }
      message.success(marked > 0 ? `已确认，并标记 ${marked} 个下游节点待更新` : '已确认该节点')
    } else {
      message.info('已标记为待更新')
    }
  }

  /** 从分镜节点的 shotRef 解析 {group, segment, characters, scene}（§S6 节点化） */
  const resolveShotFromNode = (
    node: CanvasNode,
  ): {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  } | null => {
    const groupId = node.data.shotGroupId
    const segmentId = node.data.shotSegmentId
    if (!groupId || !segmentId) return null
    const film = readFilmData(snapshot.project.metadata)
    const group = film?.shotGroups?.find((item) => item.id === groupId)
    const segment = group?.segments.find((item) => item.id === segmentId)
    if (!group || !segment) return null
    const characters = (segment.characterAssetIds ?? [])
      .map((id) => snapshot.assets.find((a) => a.id === id))
      .filter((a): a is CanvasAsset => Boolean(a))
    const scene = segment.sceneAssetId
      ? snapshot.assets.find((a) => a.id === segment.sceneAssetId)
      : undefined
    return { group, segment, characters, ...(scene ? { scene } : {}) }
  }

  const resolveRuntimeFromNode = (
    node: CanvasNode,
  ): {
    agentId?: string
    providerProfileId?: string
    modelId?: string
  } => {
    const asset = node.assetId ? snapshot.assets.find((item) => item.id === node.assetId) : null
    const assetTaskId =
      typeof asset?.metadata?.taskId === 'string' ? asset.metadata.taskId : undefined
    const task = snapshot.tasks.find((item) => item.id === (node.taskId ?? assetTaskId))
    return {
      ...(task?.agentId ? { agentId: task.agentId } : {}),
      ...(task?.providerProfileId ? { providerProfileId: task.providerProfileId } : {}),
      ...(task?.modelId ? { modelId: task.modelId } : {}),
    }
  }

  const openOperationPanelForNode = (nodeId: string) => {
    closeCanvasFloatPanels('operation')
    setSelectedNodeIds([nodeId])
    setActiveOperationPanelNodeId(nodeId)
  }

  const createConfiguredOperationNode = async ({
    sourceNode,
    operation,
    title,
    prompt,
    nodeMessage,
    modelParams,
    taskPipelineRole,
    outputPipelineRole,
  }: {
    sourceNode: CanvasNode
    operation: CanvasOperationType
    title: string
    prompt: string
    nodeMessage: string
    modelParams?: Record<string, unknown>
    taskPipelineRole?: CanvasPipelineRole
    outputPipelineRole?: CanvasPipelineRole
  }) => {
    const placement = placeNodeRightOfNodes([sourceNode], { x: 360, y: 0 })
    const runtime = resolveRuntimeFromNode(sourceNode)
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation,
      inputNodeIds: [sourceNode.id],
      x: placement.x,
      y: placement.y,
      title,
      prompt,
      message: nodeMessage,
      ...(modelParams ? { modelParams } : {}),
      ...(taskPipelineRole ? { taskPipelineRole } : {}),
      ...(outputPipelineRole ? { outputPipelineRole } : {}),
      ...runtime,
    })
    const created = next?.nodes.find(
      (item) => !existingNodeIds.has(item.id) && item.type === operation,
    )
    if (created) {
      openOperationPanelForNode(created.id)
      message.info('已创建操作节点，请确认配置后点击开始任务')
    }
  }

  const handleNodePipelineAction = async (nodeId: string, actionId: string): Promise<void> => {
    const node = snapshot.nodes.find((item) => item.id === nodeId)
    if (!node) return
    // 分镜 / 关键帧节点：从 shotRef 解析分镜后执行（§S6/§S7 节点化）
    if (
      actionId === 'shot.to_keyframes' ||
      actionId === 'shot.to_video' ||
      actionId === 'keyframe.to_video'
    ) {
      const resolved = resolveShotFromNode(node)
      if (!resolved) {
        message.warning('该节点未关联分镜，无法执行')
        return
      }
      if (actionId === 'shot.to_keyframes') handleGenerateSegmentKeyframes(resolved)
      else handleGenerateSegmentVideo(resolved)
      return
    }
    const asset = node.assetId
      ? snapshot.assets.find((item) => item.id === node.assetId)
      : undefined
    // 文本来源：优先关联资产正文，回退节点自身文本（让章→剧本改写产出的纯文本节点右键即可用）
    const sourceText = (asset?.contentText ?? node.data.text ?? '').trim()
    const requireAsset = (): CanvasAsset | null => {
      if (!asset) {
        message.warning('该节点未关联资源，无法执行此操作')
        return null
      }
      return asset
    }

    switch (actionId) {
      case 'chapter.to_screenplay': {
        const a = requireAsset()
        if (a) await handleChapterToScreenplay(a)
        break
      }
      case 'screenplay.to_shot_script':
        await handleGenerateShotScript(node, sourceText)
        break
      case 'screenplay.extract_characters':
        await handlePrepareExtractEntitiesOperation(node, sourceText, 'character')
        break
      case 'screenplay.extract_scenes':
        await handlePrepareExtractEntitiesOperation(node, sourceText, 'scene')
        break
      case 'screenplay.storyboard_grid':
        handleStoryboardGridFromNode()
        break
      case 'character.three_view': {
        const a = requireAsset()
        if (a) handleGenerateCharacterSheets(a, ['turnaround'], node.id)
        break
      }
      case 'scene.scene_image':
      case 'prop.prop_image':
      case 'effect.effect_image': {
        const a = requireAsset()
        if (a) handleGenerateAssetReference(a, node.id)
        break
      }
      default:
        message.info('该操作暂未支持在画布节点上直接触发')
    }
  }

  /** 生成分镜脚本：剧本/文本节点 → 任务节点 → 分镜脚本产物节点（专用包装 + 血缘） */
  const handleGenerateShotScript = async (node: CanvasNode, sourceText: string) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法生成分镜脚本')
      return
    }
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_generate',
      prompt: buildOpPrompt('screenplay.to_shot_script', {
        upstreamText: sourceText,
        ...(styleBible ? { styleBible } : {}),
        maxClipSec: DEFAULT_MAX_CLIP_SEC,
      }),
      title: '生成分镜脚本',
      nodeMessage: '确认分镜脚本 Prompt、Agent 与模型后点击开始任务',
      taskPipelineRole: 'shot',
      // 产物是「分镜脚本文本」而非分镜片段节点，不打 shot 角色，避免右键出现不适用的关键帧/视频操作；
      // 其下一步是分镜面板「导入分镜表」解析落库（见 §S6）。
    })
  }

  const handlePrepareExtractEntitiesOperation = async (
    node: CanvasNode,
    sourceText: string,
    kind: 'character' | 'scene',
  ) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法抽取')
      return
    }
    const label = kind === 'character' ? '提取角色' : '提取场景'
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_generate',
      title: label,
      prompt: buildEntityExtractionPrompt(kind, sourceText, styleBible),
      nodeMessage: `确认${label} Prompt、Agent 与模型后点击开始任务`,
      modelParams: { workflow: `extract_${kind}`, responseFormat: 'json' },
      taskPipelineRole: kind,
    })
  }

  /** 生成分镜关键帧图：从项目最近的分镜分组出一张宫格分镜图 */
  const handleStoryboardGridFromNode = () => {
    const film = readFilmData(snapshot.project.metadata)
    const groups = film?.shotGroups ?? []
    const group = groups[groups.length - 1]
    if (!group || group.segments.length === 0) {
      message.warning('暂无分镜片段，请先「生成分镜脚本」并导入分镜表，再生成分镜图')
      return
    }
    handleGenerateStoryboardGrid(group)
  }

  /**
   * 提取角色 / 场景（一对多）：源节点 → 抽取任务节点 → 多个实体节点。
   * 每个实体登记到资产库（createFilmAsset）并在画布生成关联节点，任务完成自动连 generated 边。
   */
  const handleExtractEntities = async (
    node: CanvasNode,
    sourceText: string,
    kind: 'character' | 'scene',
    options: {
      prompt?: string
      agentId?: string
      providerProfileId?: string
      modelId?: string
      modelParams?: Record<string, unknown>
      bindToNodeId?: string
    } = {},
  ) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法抽取')
      return
    }
    const label = kind === 'character' ? '提取角色' : '提取场景'
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const extractionPrompt =
      options.prompt?.trim() || buildEntityExtractionPrompt(kind, sourceText, styleBible)
    const runtime = {
      ...resolveRuntimeFromNode(node),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.providerProfileId ? { providerProfileId: options.providerProfileId } : {}),
      ...(options.modelId ? { modelId: options.modelId } : {}),
    }
    try {
      await runTrackedCanvasWorkflow(
        {
          title: label,
          prompt: extractionPrompt,
          inputNodeIds: [node.id],
          ...(node.assetId ? { inputAssetIds: [node.assetId] } : {}),
          ...(options.bindToNodeId ? { bindToNodeId: options.bindToNodeId } : {}),
          message: `正在${label}...`,
          ...runtime,
          modelParams: {
            ...(options.modelParams ?? {}),
            workflow: `extract_${kind}`,
            responseFormat: 'json',
          },
        },
        async () => {
          const response = await window.spark.invoke('canvas:task:generate-text', {
            operation: 'text_generate',
            prompt: extractionPrompt,
            ...(runtime.agentId ? { agentId: runtime.agentId } : {}),
            ...(runtime.providerProfileId ? { providerProfileId: runtime.providerProfileId } : {}),
            ...(runtime.modelId ? { modelId: runtime.modelId } : {}),
          })
          if (response.status !== 'succeeded' || !response.text) {
            throw new Error(response.error?.message ?? '抽取失败')
          }
          const entities = parseExtractedEntities(kind, response.text)
          if (entities.length === 0) {
            throw new Error('未识别到实体，请检查文本内容或改用更规范的剧本')
          }
          // 已存在同名（同 kind）资产去重
          const existingByName = new Map<string, CanvasAsset>()
          for (const item of snapshot.assets) {
            if (readAssetKind(item) === kind && item.title) {
              existingByName.set(item.title.trim().toLowerCase(), item)
            }
          }
          const outputNodeIds: string[] = []
          const outputAssetIds: string[] = []
          const baseX = node.x + 460
          let created = 0
          let failed = 0
          for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]!
            // 单实体失败不影响其它实体（尽力而为，避免整批回滚）
            try {
              const nameKey = entity.name.trim().toLowerCase()
              let entityAsset = existingByName.get(nameKey)
              if (!entityAsset) {
                entityAsset = await createFilmAsset({
                  kind,
                  name: entity.name,
                  text: entity.description,
                  prompt: entity.prompt ?? entity.description,
                  attributes: entity.fields,
                  tags: [`来源:${node.title ?? '剧本'}`],
                })
                existingByName.set(nameKey, entityAsset)
              }
              outputAssetIds.push(entityAsset.id)
              const placed = await insertAsset({
                assetId: entityAsset.id,
                boardId: snapshot.board.id,
                x: baseX,
                y: node.y + i * 190,
              })
              if (placed) {
                await updateNodeData(placed.id, { pipelineRole: kind, productionState: 'draft' })
                outputNodeIds.push(placed.id)
              }
              created += 1
            } catch {
              failed += 1
            }
          }
          if (created === 0) {
            throw new Error(`识别到 ${entities.length} 个实体，但全部落库失败`)
          }
          return {
            count: created,
            outputNodeIds,
            outputAssetIds,
            message:
              failed > 0
                ? `已${label} ${created} 个（${failed} 个失败）`
                : `已${label} ${created} 个`,
            agentId: runtime.agentId ?? null,
            providerProfileId: (response.providerProfileId || runtime.providerProfileId) ?? null,
            provider: response.provider || null,
            modelId: (response.model || runtime.modelId) ?? null,
            rawResponse: {
              workflow: `extract_${kind}`,
              responseFormat: 'json',
              count: created,
              failed,
              providerProfileId: response.providerProfileId,
              provider: response.provider,
              model: response.model,
              agentId: runtime.agentId ?? null,
              prompt: extractionPrompt,
              outputText: response.text,
              parsedEntities: entities.map((entity) => ({
                name: entity.name,
                description: entity.description,
                prompt: entity.prompt ?? '',
                attributes: entity.fields,
                raw: entity.raw ?? null,
              })),
            },
          }
        },
      )
      message.success(`${label}完成`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : `${label}失败`)
    }
  }

  const handleGenerateAssetReference = (asset: CanvasAsset, sourceNodeId?: string) => {
    const kind = readAssetKind(asset)
    const title =
      kind === 'scene'
        ? '生成场景图'
        : kind === 'prop'
          ? '生成道具图'
          : kind === 'effect'
            ? '生成特效图'
            : '生成设计图'
    void handleCreateTask({
      operation: 'text_to_image',
      prompt: buildFilmAssetReferencePrompt(
        asset,
        buildProductionBiblePrompt(snapshot.project.metadata),
      ),
      inputNodeIds: sourceNodeId ? [sourceNodeId] : [],
      taskTitle: title,
      taskPipelineRole: 'design_card',
      outputPipelineRole: 'design_card',
    })
    message.info(`已发起${title}任务，结果会出现在画布上`)
  }

  const handleGenerateCharacterSheets = (
    asset: CanvasAsset,
    aspects: CharacterSheetAspect[],
    sourceNodeId?: string,
  ) => {
    if (aspects.length === 0) return
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const character = assetToCharacterFields(asset)
    const stylePrompt =
      typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt : undefined
    // 一致性：若角色已有定妆/概念图在画布上，非三视图面向走 image_to_image 喂基准图保同一张脸（§S4/§9.1）
    const baseImageNode = findCharacterBaseImageNode(asset)
    let i2iCount = 0
    for (const aspect of aspects) {
      const prompt = buildCharacterSheetPrompt({
        aspect,
        character,
        ...(styleBible ? { styleBible } : {}),
        ...(stylePrompt ? { extraPrompt: stylePrompt } : {}),
      })
      const sheetTitle =
        aspect === 'turnaround' ? `生成三视图 · ${asset.title ?? '角色'}` : '生成角色图'
      const needsBase = getCharacterSheetTemplate(aspect)?.needsBaseImage ?? false
      if (needsBase && baseImageNode) {
        i2iCount += 1
        void handleCreateTask({
          operation: 'image_to_image',
          prompt,
          inputNodeIds: [baseImageNode.id],
          taskTitle: sheetTitle,
          taskPipelineRole: 'design_card',
          outputPipelineRole: 'design_card',
        })
      } else {
        void handleCreateTask({
          operation: 'text_to_image',
          prompt,
          inputNodeIds: sourceNodeId ? [sourceNodeId] : [],
          taskTitle: sheetTitle,
          taskPipelineRole: 'design_card',
          outputPipelineRole: 'design_card',
        })
      }
    }
    message.info(
      i2iCount > 0
        ? `已发起 ${aspects.length} 组角色图（其中 ${i2iCount} 组基于基准图保持一致）`
        : `已发起 ${aspects.length} 组角色图生成任务，结果会出现在画布上`,
    )
  }

  /** 找角色的基准图节点：优先 concept 引用图，其次任意引用图，需在画布上有对应图片节点（§S4 一致性） */
  const findCharacterBaseImageNode = (asset: CanvasAsset): CanvasNode | undefined => {
    const refs = readReferences(asset.metadata)
    const ordered = [
      ...refs.filter((r) => r.isPrimary && (r.usage === 'identity' || r.kind === 'concept')),
      ...refs.filter((r) => r.locked && (r.usage === 'identity' || r.kind === 'concept')),
      ...refs.filter((r) => r.kind === 'concept'),
      ...refs,
    ]
    const imageNodeByAssetId = new Map<string, CanvasNode>()
    for (const node of snapshot.nodes) {
      if (
        node.type === 'image' &&
        node.assetId &&
        node.data.url &&
        !imageNodeByAssetId.has(node.assetId)
      ) {
        imageNodeByAssetId.set(node.assetId, node)
      }
    }
    for (const ref of ordered) {
      const node = ref.assetId ? imageNodeByAssetId.get(ref.assetId) : undefined
      if (node) return node
    }
    return undefined
  }

  /**
   * 解析分镜的锚点图片节点（§S8）：
   * 1) 优先用片段已记录的 keyframeNodeIds（首/尾帧）。
   * 2) 否则用所引用角色/场景的设定图（FilmReference）在画布上对应的图片节点。
   * 只返回画布上真实存在、带 url 的图片节点。
   */
  const resolveSegmentAnchorImageNodes = (
    segment: ShotSegment,
    characters: CanvasAsset[],
    scene?: CanvasAsset,
  ): CanvasNode[] => {
    const imageNodeByAssetId = new Map<string, CanvasNode>()
    for (const node of snapshot.nodes) {
      if (node.type === 'image' && node.assetId && node.data.url) {
        if (!imageNodeByAssetId.has(node.assetId)) imageNodeByAssetId.set(node.assetId, node)
      }
    }
    // 1) 关键帧节点（按 keyframeNodeIds 顺序）
    const keyframeNodes = (segment.keyframeNodeIds ?? [])
      .map((id) => snapshot.nodes.find((node) => node.id === id))
      .filter((node): node is CanvasNode => Boolean(node && node.type === 'image' && node.data.url))
    if (keyframeNodes.length > 0) return keyframeNodes
    // 2) 角色/场景设定图对应的画布节点
    const refAssetIds: string[] = []
    for (const asset of [scene, ...characters].filter((a): a is CanvasAsset => Boolean(a))) {
      for (const ref of readReferences(asset.metadata)) {
        if (ref.assetId) refAssetIds.push(ref.assetId)
      }
    }
    const anchors: CanvasNode[] = []
    for (const assetId of refAssetIds) {
      const node = imageNodeByAssetId.get(assetId)
      if (node && !anchors.includes(node)) anchors.push(node)
    }
    return anchors
  }

  const handleGenerateSegmentVideo: NonNullable<FilmCenterHandlers['onGenerateSegmentVideo']> = (
    input,
  ) => {
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const styleFragments = findSegmentStyleFragments(
      input.segment,
      readStylePresets(snapshot.project.metadata),
    )
    // 优先用关键帧 / 引用设定图作为首尾帧走图生视频（§S8 连贯性）；无锚点图则退化文生视频
    const anchorNodes = resolveSegmentAnchorImageNodes(input.segment, input.characters, input.scene)
    if (anchorNodes.length > 0) {
      void handleCreateTask({
        operation: 'image_to_video',
        prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
        // 取前两张：第一张→首帧，第二张→尾帧（buildTaskInputFiles 自动按序分配 role）
        inputNodeIds: anchorNodes.slice(0, 2).map((node) => node.id),
      })
      message.info('已发起首/尾帧图生视频任务，结果会出现在画布上')
      return
    }
    void handleCreateTask({
      operation: 'text_to_video',
      prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
      inputNodeIds: [],
    })
    message.info('未找到关键帧/设定图，已发起文生视频任务')
  }

  const handleSetSegmentKeyframesFromSelection: NonNullable<
    FilmCenterHandlers['onSetSegmentKeyframesFromSelection']
  > = ({ group, segment }) => {
    // 取画布上当前选中的图片节点（按选中顺序：第一张→首帧，第二张→尾帧）
    const imageNodeIds = selectedNodes
      .filter((node) => node.type === 'image' && node.data.url)
      .map((node) => node.id)
    if (imageNodeIds.length === 0) return 0
    void updateShotSegment(group.id, segment.id, { keyframeNodeIds: imageNodeIds })
    // 把这些图片标记为关键帧节点并回链分镜，使其右键可「出视频(首尾帧)」（§S7 节点化）
    for (const id of imageNodeIds) {
      void updateNodeData(id, {
        pipelineRole: 'keyframe',
        shotGroupId: group.id,
        shotSegmentId: segment.id,
      })
    }
    return imageNodeIds.length
  }

  const handleExpandShotsToCanvas: NonNullable<
    FilmCenterHandlers['onExpandShotsToCanvas']
  > = async (group) => {
    const result = await runTrackedCanvasWorkflow(
      {
        title: '分镜展开到画布',
        prompt: group.description ?? group.name,
        message: '正在把分镜片段展开为画布节点...',
        modelParams: {
          workflow: 'shot_expand_to_canvas',
          shotGroupId: group.id,
          segmentCount: group.segments.length,
        },
      },
      async () => {
        const segments = [...group.segments].sort((a, b) => a.index - b.index)
        if (segments.length === 0) return { count: 0, message: '没有可展开的分镜片段' }
        const base = positionNodeInViewport(
          canvasViewportRef.current,
          { width: 280, height: 170 },
          { x: 160, y: 140 },
        )
        const perRow = 4
        const gapX = 320
        const gapY = 230
        let prevNodeId: string | null = null
        let created = 0
        const createdNodeIds: string[] = []
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i]!
          const x = base.x + (i % perRow) * gapX
          const y = base.y + Math.floor(i / perRow) * gapY
          const node = await createTextNode({ text: buildShotNodeText(group, segment), x, y })
          if (!node) continue
          createdNodeIds.push(node.id)
          await patchNodes([node.id], {
            title: `分镜 #${segment.index}${segment.durationSec != null ? ` · ${segment.durationSec}s` : ''}`,
          })
          await updateNodeData(node.id, {
            pipelineRole: 'shot',
            shotGroupId: group.id,
            shotSegmentId: segment.id,
            productionState: 'draft',
          })
          // 回链节点到分镜片段
          await updateShotSegment(group.id, segment.id, {
            nodeIds: [...(segment.nodeIds ?? []), node.id],
          })
          // 顺序连线（同一行内）
          if (prevNodeId && i % perRow !== 0) {
            await connectNodes({ sourceNodeId: prevNodeId, targetNodeId: node.id })
          }
          prevNodeId = node.id
          created += 1
        }
        return {
          count: created,
          outputNodeIds: createdNodeIds,
          message: `已展开 ${created} 个分镜节点到画布`,
          rawResponse: {
            workflow: 'shot_expand_to_canvas',
            shotGroupId: group.id,
            createdNodeCount: created,
          },
        }
      },
    )
    return result.count ?? 0
  }

  const handleGenerateSegmentKeyframes: NonNullable<
    FilmCenterHandlers['onGenerateSegmentKeyframes']
  > = (input) => {
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const styleFragments = findSegmentStyleFragments(
      input.segment,
      readStylePresets(snapshot.project.metadata),
    )
    for (const frame of ['first', 'last'] as const) {
      void handleCreateTask({
        operation: 'text_to_image',
        prompt: buildShotSegmentKeyframePrompt(input, frame, styleBible, styleFragments),
        inputNodeIds: [],
      })
    }
    message.info('已发起首帧/尾帧关键帧生成任务，结果会出现在画布上')
  }

  const handleGenerateStoryboardGrid: NonNullable<
    FilmCenterHandlers['onGenerateStoryboardGrid']
  > = (group) => {
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    // 把角色/场景 assetId 解析为标题写进每格，提升跨格一致性
    const titleById = new Map(snapshot.assets.map((asset) => [asset.id, asset.title ?? '']))
    const prompt = buildStoryboardGridPrompt({
      group,
      ...(styleBible ? { styleBible } : {}),
      nameById: (id) => titleById.get(id) || undefined,
    })
    if (!prompt) {
      message.warning('该分镜分组暂无可用片段')
      return
    }
    void handleCreateTask({ operation: 'text_to_image', prompt, inputNodeIds: [] })
    message.info('已发起分镜图（宫格）生成任务，结果会出现在画布上')
  }

  const handleRetryTask = async (task: CanvasTask) => {
    const inputNodes = expandCanvasInputNodes(
      snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id)),
      snapshot.nodes,
    )
    const taskNode = snapshot.nodes.find((node) => node.taskId === task.id)
    const inputFiles = await buildCloudTaskInputFiles(
      inputNodes,
      task.provider === 'xai' ? 'base64' : 'cloud_url',
    )
    const placement = placeNodeRightOfNodes(taskNode ? [taskNode] : inputNodes, {
      x: 360,
      y: 260,
    })
    await createTask({
      operation: task.operation,
      prompt: task.prompt ?? '',
      inputNodeIds: task.inputNodeIds,
      inputAssetIds: task.inputAssetIds,
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      ...(task.providerProfileId != null ? { providerProfileId: task.providerProfileId } : {}),
      ...(task.manifestId != null ? { manifestId: task.manifestId } : {}),
      ...(task.modelId != null ? { modelId: task.modelId } : {}),
      modelParams: task.modelParams ?? {},
      outputPlacement: {
        x: placement.x,
        y: placement.y,
      },
    })
  }

  const handleToggleLock = async () => {
    if (selectedNodes.length === 0) return
    const shouldLock = selectedNodes.some((node) => !node.locked)
    await patchNodes(selectedNodeIds, { locked: shouldLock })
  }

  const handleBringToFront = async () => {
    if (selectedNodes.length === 0) return
    const maxZ = Math.max(0, ...snapshot.nodes.map((node) => node.zIndex))
    await patchNodes(selectedNodeIds, { zIndex: maxZ + 1 })
  }

  const handleExportProject = async () => {
    try {
      const result = await canvasApi.exportProjectPackage(projectId)
      if (result.exported) message.success('Canvas 项目包已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出 Canvas 项目失败')
    }
  }

  const handleOpenProjectFolder = async () => {
    try {
      const result = await canvasApi.openProjectFolder(projectId)
      if (!result.opened) message.error(result.error || '打开项目文件夹失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目文件夹失败')
    }
  }

  return (
    <div className="canvas-workspace">
      <header
        className="canvas-workspace-header"
        onDoubleClick={() => {
          if (window.spark?.platform === 'darwin') {
            window.spark?.invoke('window:maximize', {}).catch(() => {})
          }
        }}
      >
        <div className="canvas-workspace-header-row">
          <div className="canvas-workspace-title">
            <Button
              size="small"
              type="text"
              icon={<Icons.ArrowLeft size={15} />}
              onClick={() => void handleBackWithGuard()}
            >
              项目
            </Button>
            <div className="canvas-workspace-heading">
              <h2>{snapshot.project.title}</h2>
              <span className="canvas-workspace-meta">
                {snapshot.nodes.length} 节点 / {snapshot.assets.length} 素材 /{' '}
                {snapshot.tasks.length} 任务
              </span>
            </div>
          </div>
          {/* board 切换条（文档 §7.1：项目内多 board 切换） */}
          <div className="canvas-board-switcher">
            {(snapshot.boards ?? [snapshot.board]).map((board) => (
              <button
                key={board.id}
                type="button"
                className={`canvas-board-switcher-chip${board.id === snapshot.board.id ? ' active' : ''}`}
                onClick={() => void handleSwitchBoard(board.id)}
                title={board.name}
              >
                {board.name}
              </button>
            ))}
            <Tooltip title="新建画布">
              <Button
                size="small"
                type="text"
                icon={<Icons.Plus size={14} />}
                onClick={() => void createBoard()}
              />
            </Tooltip>
          </div>
        </div>
        <CanvasToolbar
          saveState={{ dirty, saving }}
          onSave={() => void doSave()}
          onExport={() => void handleExportProject()}
        />
      </header>

      <div className="canvas-workspace-body" style={sidePanelStyle}>
        <div className="canvas-stage-area">
          {toolSwitchHint && (
            <div
              key={toolSwitchHint.nonce}
              className={`canvas-tool-switch-hint canvas-tool-switch-hint-${toolSwitchHint.tool}`}
              role="status"
              aria-live="polite"
            >
              <span className="canvas-tool-switch-key">Tab</span>
              <span>已切换为 {toolLabel(toolSwitchHint.tool)}</span>
            </div>
          )}
          <CanvasStage
            snapshot={snapshot}
            activeTool={activeTool === 'pan' ? 'pan' : 'select'}
            selectedNodeIds={selectedNodeIds}
            onSelectionChange={handleSelectionChange}
            onNodesPersist={(nodes) => void updateNodes(nodes)}
            onConnectNodes={(input) => void connectNodes(input)}
            onDuplicateNode={handleDuplicateNode}
            onDeleteNode={handleDeleteNode}
            onToggleLockNode={handleToggleLockNode}
            onBringNodeToFront={handleBringNodeToFront}
            onCreateGroupFromSelection={handleCreateGroup}
            onAddSelectionToGroup={handleAddSelectionToGroup}
            onRemoveNodeFromGroup={(nodeId) => handleRemoveFromGroup([nodeId])}
            onDissolveGroup={handleDissolveGroup}
            onOpenAiComposer={handleOpenInlineAi}
            onEditNode={handleEditNode}
            onSaveNodeToLibrary={(nodeId) => setSaveToLibraryNodeId(nodeId)}
            onCreateOperationChild={(parentId, operation, options) => {
              const parent = snapshot.nodes.find((n) => n.id === parentId)
              if (!parent) return
              void createOperationNode({
                boardId: snapshot.board.id,
                operation,
                inputNodeIds: [parentId],
                x: parent.x + parent.width + 60,
                y: parent.y,
                ...(options?.title ? { title: options.title } : {}),
                ...(options?.prompt ? { prompt: options.prompt } : {}),
              })
            }}
            onPipelineAction={(nodeId, actionId) => void handleNodePipelineAction(nodeId, actionId)}
            onSetProductionState={(nodeId, state) => void handleSetProductionState(nodeId, state)}
            onAddTextAtPosition={(position) => void addText(position)}
            onAddImageAtPosition={uploadFirstImage}
            onAddPromptAtPosition={(position) => void addText(position)}
            onInsertAssetFromPane={() => setSidePanelTab('assets')}
            onCreateBoardFromPane={() => void createBoard()}
            onNodeSelectIntent={handleNodeSelectIntent}
            onViewportChange={handleCanvasViewportChange}
          />
          <CanvasBottomDock
            activeTool={activeTool}
            onToolChange={handleToolChange}
            onAddNodeItem={handleAddNodeItem}
            onOpenAddMenu={() => closeCanvasFloatPanels()}
            onOpenAiComposer={() => handleOpenInlineAi()}
            onOpenFilmCenter={() => {
              closeCanvasFloatPanels('film-center')
              setFilmCenterOpen(true)
            }}
            onOpenShotDirector={() => {
              closeCanvasFloatPanels('shot-director')
              setShotDirectorOpen(true)
            }}
            onOpenAgent={() => {
              closeCanvasFloatPanels('agent')
              setAgentOpen(true)
            }}
            onToggleGrid={handleToggleGrid}
            gridVisible={snapshot.board.settings.grid !== false}
            selectedCount={selectedNodes.length}
            onDeleteSelected={handleDeleteSelectedNodes}
          />
          <CanvasInlineAiComposer
            open={inlineAiOpen}
            selectedNodes={aiInputNodes}
            allNodes={snapshot.nodes}
            {...(snapshot.project.settings ? { projectSettings: snapshot.project.settings } : {})}
            onUploadImage={() => uploadFirstImage()}
            onClose={() => setInlineAiOpen(false)}
            onCreateTask={(input) => {
              void handleCreateTask(input)
              setInlineAiOpen(false)
            }}
          />
          <CanvasShotDirectorPanel
            key={`${snapshot.board.id}:${shotDirectorDraft?.updatedAt ?? 'draft'}`}
            open={shotDirectorOpen}
            initialDraft={shotDirectorDraft}
            onClose={() => setShotDirectorOpen(false)}
            onSaveDraft={handleSaveShotDirectorDraft}
            onInsertPrompt={handleInsertShotDirectorPrompt}
            onInsertScreenshot={handleInsertShotDirectorScreenshot}
          />
          {(() => {
            const opNode = activeOperationPanelNodeId
              ? snapshot.nodes.find(
                  (n) => n.id === activeOperationPanelNodeId && isOperationNode(n),
                )
              : null
            if (!opNode) return null
            const opTask = opNode.taskId ? snapshot.tasks.find((t) => t.id === opNode.taskId) : null
            return (
              <CanvasOperationPanel
                node={opNode}
                snapshot={snapshot}
                {...(opTask ? { task: opTask } : {})}
                onClose={() => {
                  setActiveOperationPanelNodeId(null)
                  setSelectedNodeIds([])
                }}
                onRun={async (params) => {
                  const taskInputNodes = resolveCanvasInputNodes(
                    params.inputNodeIds,
                    snapshot.nodes,
                  )
                  const inputFiles = await buildCloudTaskInputFiles(
                    taskInputNodes,
                    params.inputTransport,
                    params.inputRoles,
                  )
                  const mergedPrompt = mergePromptWithNodeContext(params.prompt, taskInputNodes)
                  const effectivePrompt =
                    mergedPrompt ||
                    (inputFiles.length > 0
                      ? fallbackPromptForOperation(
                          (opNode.data.operation ?? opNode.type) as CanvasOperationType,
                        )
                      : '')
                  const workflow =
                    opTask && typeof opTask.modelParams?.workflow === 'string'
                      ? opTask.modelParams.workflow
                      : ''
                  if (workflow === 'extract_character' || workflow === 'extract_scene') {
                    const sourceNode = taskInputNodes[0]
                    if (!sourceNode) {
                      message.warning('该抽取节点缺少原始输入，无法重新执行')
                      return
                    }
                    const sourceAsset = sourceNode.assetId
                      ? snapshot.assets.find((item) => item.id === sourceNode.assetId)
                      : undefined
                    const sourceText = (
                      sourceAsset?.contentText ??
                      sourceNode.data.text ??
                      ''
                    ).trim()
                    await handleExtractEntities(
                      sourceNode,
                      sourceText,
                      workflow === 'extract_character' ? 'character' : 'scene',
                      {
                        prompt: effectivePrompt,
                        ...(params.agentId ? { agentId: params.agentId } : {}),
                        ...(params.providerProfileId
                          ? { providerProfileId: params.providerProfileId }
                          : {}),
                        ...(params.modelId ? { modelId: params.modelId } : {}),
                        ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                        bindToNodeId: opNode.id,
                      },
                    )
                    setActiveOperationPanelNodeId(null)
                    setSelectedNodeIds([])
                    return
                  }
                  await runOperationNode(opNode.id, {
                    prompt: effectivePrompt,
                    ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                    inputNodeIds: taskInputNodes.map((item) => item.id),
                    inputAssetIds: taskInputNodes
                      .map((item) => item.assetId)
                      .filter((id): id is string => Boolean(id)),
                    ...(inputFiles.length > 0 ? { inputFiles } : {}),
                    ...(params.agentId ? { agentId: params.agentId } : {}),
                    ...(params.providerProfileId
                      ? { providerProfileId: params.providerProfileId }
                      : {}),
                    ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                    ...(params.modelId ? { modelId: params.modelId } : {}),
                    ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                  })
                  setActiveOperationPanelNodeId(null)
                  setSelectedNodeIds([])
                }}
                onRetry={() => void retryOperationNode(opNode.id)}
                onSaveDraft={async (params) => {
                  await patchNodes([opNode.id], { title: params.title })
                  await updateNodeData(opNode.id, {
                    ...opNode.data,
                    prompt: params.prompt,
                    negativePrompt: params.negativePrompt,
                    message: params.message,
                    modelParams: params.modelParams,
                  })
                }}
              />
            )
          })()}
          <CanvasAgentModal
            open={agentOpen}
            onClose={() => setAgentOpen(false)}
            snapshot={snapshot}
            workspace={{
              createTextNode,
              createImageNode,
              uploadImageAsset,
              createGroupNode,
              dissolveGroupNode,
              addNodesToGroup,
              removeNodesFromGroup,
              deleteNodes,
              duplicateNodes,
              patchNodes,
              updateNodeData,
              connectNodes,
              createBoard,
              renameBoard,
              deleteBoard,
              duplicateBoard,
              switchBoard,
              copyNodesToBoard,
              insertAsset,
              createFilmAsset,
              updateFilmAsset,
              deleteFilmAsset,
              createShotGroup,
              updateShotGroup,
              deleteShotGroup,
              createShotSegment,
              updateShotSegment,
              deleteShotSegment,
              createOperationNode,
              retryOperationNode,
              runOperationNode,
              cancelTask,
              updateProjectSettings,
              refresh,
            }}
          />
          <CanvasNodeEditModal
            node={editingNode}
            open={Boolean(editingNodeId)}
            assets={snapshot.assets}
            onClose={() => setEditingNodeId(null)}
            onSave={handleSaveNodeEdit}
            onCreatePromptTask={(input) => void handleCreateTask({ ...input, inputNodeIds: [] })}
          />
          <CanvasFilmAssetCenter
            open={filmCenterOpen}
            onClose={() => setFilmCenterOpen(false)}
            {...(filmCenterInitialTab ? { initialTab: filmCenterInitialTab } : {})}
            snapshot={snapshot}
            onUploadImage={uploadImageAsset}
            handlers={{
              createFilmAsset,
              updateFilmAsset,
              deleteFilmAsset,
              getFilmAssetUsage,
              onOptimizeAsset: (asset) => {
                // AI 优化：用 text_rewrite 触发平台 agent 优化资产文本
                void handleCreateTask({
                  operation: 'text_rewrite',
                  prompt:
                    asset.contentText ?? asset.title ?? '请优化以下内容，使其更专业、更精炼。',
                  inputNodeIds: [],
                })
                message.info('已发起 AI 优化任务，结果将生成在画布上')
              },
              onBreakdownScriptAsset: handleBreakdownScriptAsset,
              onImportManuscript: handleImportManuscript,
              deleteManuscript: handleDeleteManuscript,
              onChapterToScreenplay: handleChapterToScreenplay,
              onExportTimeline: handleExportTimeline,
              onSaveStylePreset: handleSaveStylePreset,
              onApplyProductionBible: handleApplyProductionBible,
              onExpandShotsToCanvas: handleExpandShotsToCanvas,
              onGenerateAssetReference: handleGenerateAssetReference,
              onGenerateCharacterSheets: handleGenerateCharacterSheets,
              onGenerateSegmentVideo: handleGenerateSegmentVideo,
              onGenerateSegmentKeyframes: handleGenerateSegmentKeyframes,
              onSetSegmentKeyframesFromSelection: handleSetSegmentKeyframesFromSelection,
              onGenerateStoryboardGrid: handleGenerateStoryboardGrid,
              hasPromptCanvasTarget: () => selectedNodes.length > 0,
              onApplyPromptEntryToCanvas: handleApplyPromptEntryBesideSelection,
              onInsertAssetToCanvas: (assetId) => void handleInsertAsset(assetId),
              createShotGroup,
              updateShotGroup,
              deleteShotGroup,
              createShotSegment,
              updateShotSegment,
              deleteShotSegment,
            }}
          />
        </div>
        <button
          type="button"
          className={`canvas-side-panel-collapse-toggle${sidePanelCollapsed ? ' is-collapsed' : ''}`}
          onClick={() => setSidePanelCollapsed((current) => !current)}
          aria-label={sidePanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
          title={sidePanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
        >
          {sidePanelCollapsed ? <Icons.ChevronLeft size={16} /> : <Icons.ChevronRight size={16} />}
        </button>
        {!sidePanelCollapsed && (
          <aside className="canvas-side-panel" style={{ width: sidePanelWidth }}>
            <div
              aria-label="调整右侧面板宽度"
              aria-orientation="vertical"
              aria-valuemax={CANVAS_SIDE_PANEL_MAX_WIDTH}
              aria-valuemin={CANVAS_SIDE_PANEL_MIN_WIDTH}
              aria-valuenow={sidePanelWidth}
              className="canvas-side-panel-resize-handle"
              onDoubleClick={() => updateSidePanelWidth(CANVAS_SIDE_PANEL_DEFAULT_WIDTH)}
              onKeyDown={handleSidePanelResizeKeyDown}
              onPointerDown={handleSidePanelResizeStart}
              role="separator"
              tabIndex={0}
              title="拖拽调整面板宽度"
            />
            <div className="canvas-side-tabs">
              <Segmented
                value={sidePanelTab}
                onChange={(value) =>
                  setSidePanelTab(
                    value as 'production' | 'boards' | 'assets' | 'details' | 'project',
                  )
                }
                options={[
                  { label: '制作', value: 'production' },
                  { label: '画布', value: 'boards' },
                  { label: '资产', value: 'assets' },
                  { label: '属性', value: 'details' },
                  { label: '项目信息', value: 'project' },
                ]}
              />
            </div>
            <div className="canvas-side-panel-footer">
              <button
                type="button"
                className="canvas-side-utility-btn"
                onClick={() => {
                  closeCanvasFloatPanels()
                  setHistoryOpen(true)
                }}
              >
                <Icons.Clock size={16} />
                <span>历史</span>
              </button>
              <button
                type="button"
                className="canvas-side-utility-btn"
                onClick={() => void handleOpenProjectFolder()}
              >
                <Icons.Folder size={16} />
                <span>目录</span>
              </button>
              <button
                type="button"
                className="canvas-side-utility-btn"
                onClick={() => {
                  closeCanvasFloatPanels()
                  setTemplateOpen(true)
                }}
              >
                <Icons.Layers size={16} />
                <span>模板</span>
              </button>
              <button
                type="button"
                className="canvas-side-utility-btn"
                onClick={() => message.info('帮助与快捷键')}
              >
                <Icons.HelpCircle size={16} />
                <span>帮助</span>
              </button>
            </div>
            {sidePanelTab === 'production' && (
              <CanvasProductionPanel
                snapshot={snapshot}
                onOpenFilmCenter={(stageKey) => {
                  if (stageKey) setFilmCenterInitialTab(PRODUCTION_STAGE_TO_TAB[stageKey])
                  closeCanvasFloatPanels('film-center')
                  setFilmCenterOpen(true)
                }}
              />
            )}
            {sidePanelTab === 'boards' && (
              <div className="canvas-side-panel-content">
                <CanvasBoardSidebar
                  snapshot={snapshot}
                  activeBoardId={snapshot.board.id}
                  onSelectBoard={(boardId) => void handleSwitchBoard(boardId)}
                  onCreateBoard={(input) => void createBoard(input)}
                  onRenameBoard={(boardId, name) => void renameBoard(boardId, name)}
                  onDeleteBoard={(boardId) => void deleteBoard(boardId)}
                  onDuplicateBoard={(boardId) => void duplicateBoard(boardId)}
                  onSetDefaultBoard={(boardId) => void setDefaultBoard(boardId)}
                />
              </div>
            )}
            {sidePanelTab === 'assets' && (
              <div className="canvas-side-panel-content">
                <CanvasAssetManagerPanel
                  assets={snapshot.assets}
                  nodes={snapshot.nodes}
                  tasks={snapshot.tasks}
                  onInsertAssets={(assetIds) => {
                    for (const assetId of assetIds) void handleInsertAsset(assetId)
                  }}
                  onInsertOne={(assetId) => void handleInsertAsset(assetId)}
                  onDownloadOne={(asset) => downloadAsset(asset)}
                  detailResetKey={assetDetailResetKey}
                  onOpenDetail={() => closeCanvasFloatPanels('asset-detail')}
                  onRemoveReferences={async (assetIds) => {
                    const targetAssetSet = new Set(assetIds)
                    const nodeIds = snapshot.nodes
                      .filter((node) => node.assetId && targetAssetSet.has(node.assetId))
                      .map((node) => node.id)
                    if (nodeIds.length > 0) {
                      await deleteNodes(nodeIds)
                    }
                  }}
                />
              </div>
            )}
            {sidePanelTab === 'details' && (
              <div className="canvas-side-panel-content">
                <CanvasTaskQueue
                  tasks={snapshot.tasks}
                  nodes={snapshot.nodes}
                  assets={snapshot.assets}
                  onCompleteDemoTask={(taskId) => void completeDemoTask(taskId)}
                  onCancelTask={(taskId) => void cancelTask(taskId)}
                  onRetryTask={(task) => void handleRetryTask(task)}
                  onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])}
                />
                <CanvasInspector
                  selectedNodes={selectedNodes}
                  nodes={snapshot.nodes}
                  edges={snapshot.edges}
                  assets={snapshot.assets}
                  tasks={snapshot.tasks}
                  onDuplicate={() => void duplicateNodes(selectedNodeIds)}
                  onToggleLock={() => void handleToggleLock()}
                  onBringToFront={() => void handleBringToFront()}
                  onCreateGroup={handleCreateGroup}
                  onAddToGroup={() => handleAddSelectionToGroup()}
                  onRemoveFromGroup={() => handleRemoveFromGroup()}
                  onDissolveGroup={() => handleDissolveGroup()}
                  canCreateGroup={canCreateGroup}
                  canAddToGroup={canAddToGroup}
                  canRemoveFromGroup={canRemoveFromGroup}
                  canDissolveGroup={canDissolveGroup}
                  onPatchNode={(node, patch) => {
                    void patchNodes([node.id], patch)
                  }}
                />
              </div>
            )}
            {sidePanelTab === 'project' && (
              <div className="canvas-side-panel-content">
                <CanvasProjectInfoPanel
                  key={`${snapshot.project.id}:${snapshot.project.updatedAt}:project-info`}
                  project={snapshot.project}
                  onOpenProjectFolder={handleOpenProjectFolder}
                  onSave={(settings) => updateProjectSettings(settings)}
                  onSaveStyleBible={async (styleBible) => {
                    await updateProjectMetadata(
                      writeStyleBible(snapshot.project.metadata, styleBible),
                    )
                  }}
                />
              </div>
            )}
          </aside>
        )}
      </div>
      <Drawer
        title="历史记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={360}
        styles={{ body: { padding: 0 } }}
      >
        <CanvasHistoryPanel
          assets={snapshot.assets}
          tasks={snapshot.tasks}
          onInsertAsset={(assetId) => void handleInsertAsset(assetId)}
          onLocateTaskNode={(taskId) => {
            const node = snapshot.nodes.find((n) => n.taskId === taskId)
            if (node) {
              setSelectedNodeIds([node.id])
              message.info(`已定位到任务节点：${node.title ?? node.type}`)
            }
          }}
          onRetryTask={(taskId) => {
            const task = snapshot.tasks.find((t) => t.id === taskId)
            if (task) void handleRetryTask(task)
          }}
        />
      </Drawer>
      <Drawer
        title="模板中心"
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        width={360}
        styles={{ body: { padding: 0 } }}
      >
        <CanvasTemplatePanel onApply={(template) => void handleApplyTemplate(template)} />
      </Drawer>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void handleFileChange(event)}
      />
      {snapshot && (
        <SaveToLibraryDialog
          open={Boolean(saveToLibraryNode)}
          node={saveToLibraryNode}
          snapshot={snapshot}
          onClose={() => setSaveToLibraryNodeId(null)}
          onSubmit={async (input) => {
            await createFilmAsset(input)
          }}
        />
      )}
      <Modal
        open={leaveOpen}
        title="画布有未保存的改动"
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="discard" danger onClick={onLeaveDiscard}>
            不保存
          </Button>,
          <Button key="cancel" onClick={onLeaveCancel}>
            取消
          </Button>,
          <Button key="save" type="primary" loading={saving} onClick={() => void onLeaveSave()}>
            保存并离开
          </Button>,
        ]}
      >
        离开前是否保存当前画布？未保存的改动不会写入应用数据库，离开后即丢失。
      </Modal>
    </div>
  )
}

function CanvasProjectInfoPanel({
  project,
  onOpenProjectFolder,
  onSave,
  onSaveStyleBible,
}: {
  project: CanvasProject
  onOpenProjectFolder: () => Promise<void>
  onSave: (settings: CanvasProjectSettings) => Promise<void>
  onSaveStyleBible: (styleBible: string) => Promise<void>
}) {
  const [prompt, setPrompt] = useState(project.settings?.prompt ?? '')
  const [negativePrompt, setNegativePrompt] = useState(project.settings?.negativePrompt ?? '')
  const [styleBible, setStyleBible] = useState(readStyleBible(project.metadata))
  const [savingStyle, setSavingStyle] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveStyleBible = async () => {
    setSavingStyle(true)
    try {
      await onSaveStyleBible(styleBible)
      message.success('视觉总设定已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存视觉总设定失败')
    } finally {
      setSavingStyle(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ prompt, negativePrompt })
      message.success('项目提示词已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存项目提示词失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="canvas-side-panel-content canvas-side-panel-content-project">
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>项目基础信息</h3>
          <Tag color={project.status === 'active' ? 'green' : 'default'} bordered>
            {project.status}
          </Tag>
        </div>
        <div className="canvas-project-info-grid">
          <CanvasProjectInfoItem label="项目名" value={project.title} />
          <CanvasProjectInfoItem label="节点" value={project.nodeCount} />
          <CanvasProjectInfoItem label="素材" value={project.assetCount} />
          <CanvasProjectInfoItem label="任务" value={project.taskCount} />
        </div>
        <div className="canvas-project-folder-card canvas-project-folder-card-inline">
          <div className="canvas-project-folder-info">
            <span>项目文件夹</span>
            <Tooltip title={project.rootPath || '默认位置'} placement="topLeft">
              <strong>{project.rootPath || '默认位置'}</strong>
            </Tooltip>
          </div>
          <Button
            size="small"
            icon={<Icons.Folder size={14} />}
            onClick={() => void onOpenProjectFolder()}
          >
            打开
          </Button>
        </div>
      </section>
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>视觉总设定 (Style Bible)</h3>
          <Tag color={styleBible.trim() ? 'purple' : 'default'} bordered>
            {styleBible.trim() ? '已设定' : '未设定'}
          </Tag>
        </div>
        <div className="canvas-form-row">
          <label>全片视觉风格（被角色图/分镜/关键帧等所有生成继承）</label>
          <Input.TextArea
            value={styleBible}
            rows={5}
            placeholder="例如：日系动画风格，电影级布光，冷色调，胶片颗粒，2.39:1 宽银幕，统一美术与材质语言"
            onChange={(event) => setStyleBible(event.target.value)}
          />
        </div>
        <div className="canvas-project-prompt-actions">
          <Button size="small" onClick={() => setStyleBible(readStyleBible(project.metadata))}>
            重置
          </Button>
          <Button
            size="small"
            type="primary"
            loading={savingStyle}
            onClick={() => void saveStyleBible()}
          >
            保存设定
          </Button>
        </div>
      </section>
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>AI 提示词设置</h3>
          <Tag color={prompt.trim() || negativePrompt.trim() ? 'blue' : 'default'} bordered>
            {prompt.trim() || negativePrompt.trim() ? '已配置' : '未配置'}
          </Tag>
        </div>
        <div className="canvas-form-row">
          <label>项目统一提示词</label>
          <Input.TextArea
            value={prompt}
            rows={6}
            placeholder="例如：统一品牌语气、画面风格、构图偏好、输出格式等"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="canvas-form-row">
          <label>反向提示词</label>
          <Input.TextArea
            value={negativePrompt}
            rows={5}
            placeholder="例如：不要出现的元素、不能做的动作、需要规避的风格或内容"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </div>
        <div className="canvas-project-prompt-actions">
          <Button
            size="small"
            onClick={() => {
              setPrompt(project.settings?.prompt ?? '')
              setNegativePrompt(project.settings?.negativePrompt ?? '')
            }}
          >
            重置
          </Button>
          <Button size="small" type="primary" loading={saving} onClick={() => void save()}>
            保存设置
          </Button>
        </div>
      </section>
    </div>
  )
}

function CanvasProjectInfoItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="canvas-project-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CanvasNodeEditModal({
  node,
  open,
  assets,
  onClose,
  onSave,
  onCreatePromptTask,
}: {
  node: CanvasNode | null
  open: boolean
  assets: CanvasAsset[]
  onClose: () => void
  onSave: (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => Promise<void>
  onCreatePromptTask: (input: {
    operation: 'prompt_optimize' | 'text_generate'
    prompt: string
    negativePrompt?: string
  }) => void
}) {
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [messageText, setMessageText] = useState('')
  const [url, setUrl] = useState('')
  const [editFullscreen, setEditFullscreen] = useState(false)
  const isTextLike = node?.type === 'text' || node?.type === 'prompt'

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setTitle(node.title ?? '')
    setText(node.data.text ?? '')
    setPrompt(node.data.prompt ?? '')
    setNegativePrompt('')
    setMessageText(node.data.message ?? '')
    setUrl(node.data.url ?? '')
  }, [node])

  const insertPromptText = (fragment: string) => {
    setText((current) => appendPromptFragment(current, fragment))
  }

  const runPromptOptimize = () => {
    const source = text.trim()
    if (!source) {
      message.warning('请先输入需要优化的文本或 Prompt')
      return
    }
    onCreatePromptTask({
      operation: 'prompt_optimize',
      prompt: buildPromptOptimizationInstruction(source, negativePrompt),
      ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
    })
    message.info('已发起 Prompt 优化任务，结果会生成到画布上')
  }

  const runRelatedPromptGenerate = () => {
    onCreatePromptTask({
      operation: 'text_generate',
      prompt: buildRelatedPromptInstruction(text),
    })
    message.info('已发起相关提示词生成任务，结果会生成到画布上')
  }

  const save = async () => {
    if (!node) return
    setSaving(true)
    try {
      const nextData: CanvasNode['data'] = { ...node.data }
      if (node.type === 'text' || node.type === 'prompt' || node.type === 'group') {
        nextData.text = text
      }
      if (node.type === 'text' || node.type === 'prompt') {
        nextData.format = node.type === 'prompt' ? 'prompt' : 'markdown'
      }
      if (node.type === 'task') {
        nextData.prompt = prompt
      }
      if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
        nextData.url = url.trim()
      }
      if (node.type !== 'text' && node.type !== 'prompt') {
        nextData.message = messageText
      }

      await onSave(
        node,
        {
          title: title.trim().length > 0 ? title.trim() : null,
        },
        nextData,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存节点失败')
      setSaving(false)
    }
  }

  if (!open || !node) return null
  const fullscreenLabel = editFullscreen ? '退出全屏' : '全屏编辑'
  const fullscreenIcon = editFullscreen ? (
    <Icons.Minimize size={14} />
  ) : (
    <Icons.Maximize size={14} />
  )
  const toggleFullscreen = () => setEditFullscreen((current) => !current)

  const content = (
    <div className="canvas-node-edit-dialog">
      <div className="canvas-node-edit-dialog-head">
        <Tag color="default" bordered>
          {node.type}
        </Tag>
        <span>{node.id}</span>
      </div>
      <label className="canvas-node-edit-field canvas-node-edit-field-wide">
        <span>标题</span>
        <Input
          value={title}
          placeholder="节点标题"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {isTextLike && (
        <div className="canvas-node-edit-prompt-layout">
          <div className="canvas-node-edit-prompt-main">
            <CanvasPromptEditor
              prompt={text}
              negativePrompt={negativePrompt}
              promptPlaceholder="输入文本、剧情段落、生成提示词或需要 agent 改写的要求"
              negativePlaceholder="可选：输入不希望出现的内容，AI 优化时会一并参考"
              optimizeDisabled={text.trim().length === 0}
              onPromptChange={setText}
              onNegativePromptChange={setNegativePrompt}
              onOptimizePrompt={runPromptOptimize}
            />
            <div className="canvas-node-edit-agent-actions">
              <Button
                size="small"
                icon={<Icons.Sparkles size={14} />}
                onClick={runRelatedPromptGenerate}
              >
                Agent 生成相关提示词
              </Button>
              <Button
                size="small"
                onClick={() => insertPromptText('电影感构图，主体清晰，光影自然，细节丰富。')}
              >
                插入基础质量词
              </Button>
            </div>
          </div>
          <CanvasPromptLibraryPanel
            assets={assets}
            className="canvas-node-edit-prompt-library"
            onApply={(entry) => insertPromptText(entry.text)}
          />
        </div>
      )}
      {node.type === 'group' && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>组说明</span>
          <Input.TextArea
            value={text}
            rows={5}
            placeholder="输入节点内容"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {node.type === 'task' && (
        <div className="canvas-node-edit-task-prompt">
          <label className="canvas-node-edit-field canvas-node-edit-field-wide">
            <span>任务指令</span>
            <Input.TextArea
              value={prompt}
              rows={6}
              placeholder="任务使用的 prompt"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <CanvasPromptLibraryPanel
            assets={assets}
            className="canvas-node-edit-prompt-library canvas-node-edit-prompt-library-compact"
            limit={24}
            onApply={(entry) => setPrompt((current) => appendPromptFragment(current, entry.text))}
          />
        </div>
      )}
      {(node.type === 'image' || node.type === 'video' || node.type === 'audio') && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>媒体 URL</span>
          <Input
            value={url}
            placeholder="https:// 或 data: URL"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      )}
      {node.type !== 'text' && node.type !== 'prompt' && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>备注 / 展示文本</span>
          <Input.TextArea
            value={messageText}
            rows={5}
            placeholder="节点内展示的辅助文本"
            onChange={(event) => setMessageText(event.target.value)}
          />
        </label>
      )}
    </div>
  )

  if (isTextLike) {
    return (
      <div
        className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel${editFullscreen ? ' is-fullscreen' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
          <div>
            <strong>编辑文本 / Prompt 节点</strong>
            <span>统一在底部工具栏上方编辑，避免遮挡画布上下文</span>
          </div>
          <div className="canvas-node-edit-bottom-actions">
            <Tooltip title={fullscreenLabel}>
              <Button
                size="small"
                type="text"
                icon={fullscreenIcon}
                aria-label={fullscreenLabel}
                onClick={toggleFullscreen}
              />
            </Tooltip>
            <Button size="small" onClick={onClose}>
              取消
            </Button>
            <Button size="small" type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </div>
        </div>
        <div className="canvas-bottom-floating-body canvas-node-edit-bottom-body">{content}</div>
      </div>
    )
  }

  return (
    <Modal
      className={`canvas-node-edit-modal${editFullscreen ? ' canvas-node-edit-modal-fullscreen' : ''}`}
      title={
        <div className="canvas-node-edit-modal-title">
          <span>编辑节点</span>
          <Tooltip title={fullscreenLabel}>
            <Button
              size="small"
              type="text"
              icon={fullscreenIcon}
              aria-label={fullscreenLabel}
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </div>
      }
      open={open}
      width={editFullscreen ? 'calc(100vw - 24px)' : 560}
      destroyOnHidden
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      onOk={() => void save()}
      onCancel={onClose}
    >
      {content}
    </Modal>
  )
}
