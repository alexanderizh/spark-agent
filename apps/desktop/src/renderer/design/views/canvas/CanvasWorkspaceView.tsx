import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Empty, Segmented, Tag } from '@lobehub/ui'
import { Drawer, Input, Modal, Popover, Select, Spin, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import { CanvasInspector } from './CanvasInspector'
import {
  CanvasStage,
  type CanvasStageViewport,
  type CanvasStageViewportControls,
} from './CanvasStage'
import type { PendingCanvasConnection } from './canvasPendingConnection'
import { CanvasTaskQueue } from './CanvasTaskQueue'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { downloadAsset, downloadCanvasResource } from './CanvasAssetsPanel'
import { CanvasAssetManagerPanel } from './CanvasAssetManagerPanel'
import { CanvasBottomDock } from './CanvasBottomDock'
import { CanvasCharacterLibraryPanel } from './CanvasCharacterLibraryPanel'
import { CanvasCharacterSubviewEditor } from './CanvasCharacterSubviewEditor'
import { CanvasHistoryPanel } from './CanvasHistoryPanel'
import { SaveToLibraryDialog } from './SaveToLibraryDialog'
import {
  dataUrlToFile,
  encodeToSafeFileUrl,
  readFileAsDataUrl,
  readImageDimensions,
  readVideoDimensions,
} from './canvas-safe-file'
import { classifyDroppedFile, layoutDroppedFiles, textFormatFromFileName } from './canvasFileDrop'
import { extractDocumentText } from './canvasDocumentParse'
import { CanvasTemplatePanel } from './CanvasTemplatePanel'
import { CanvasFilmAssetCenter, type FilmCenterHandlers } from './CanvasFilmAssetCenter'
import { CanvasAgentModal } from './CanvasAgentModal'
import { CanvasOperationPanel, buildOperationPanelSnapshotSignature } from './CanvasOperationPanel'
import { shouldFocusCanvasInlinePanel } from './canvasInlinePanelFocus'
import { captureCanvasTaskViewport, runWithCanvasTaskViewport } from './canvasTaskViewportGuard'
import { CanvasOperationWorkbench } from './CanvasOperationWorkbench'
import {
  resolveCanvasOperationResourceNode,
  resolveCanvasOperationOutputState,
  selectCanvasOperationOutputs,
} from './canvasOperationOutputModel'
import { planCanvasOperationOutputMaterialization } from './canvasOperationOutputMaterialization'
import { planCanvasOperationOutputDeletion } from './canvasOperationOutputDeletion'
import { buildCanvasOperationRunViews, type CanvasOperationOutputView } from './canvasOperationRuns'
import { CanvasOperationPresetModal } from './CanvasOperationPresetModal'
import { CanvasPanoramaViewerModal } from './CanvasPanoramaViewerModal'
import { CanvasImageAnnotationModal } from './CanvasImageAnnotationModal'
import { CanvasGridSplitModal, type CanvasGridSplitTile } from './CanvasGridSplitModal'
import { useFloatingViewportGeometry } from './useFloatingViewportGeometry'
import { CanvasPresetHubEntry } from './CanvasPresetHubEntry'
import { CanvasProjectInfoPanel } from './CanvasProjectInfoPanel'
import {
  CanvasShotDirectorPanel,
  type CanvasShotDirectorDraft,
  type CanvasShotDirectorScreenshotInput,
} from './CanvasShotDirectorPanel'
import {
  CanvasDirectorStageModal,
  createDefaultDirectorStageData,
  type DirectorStageData,
} from './CanvasDirectorStageModal'
import { CanvasDirectorStage3DModal } from './stage3d/CanvasDirectorStage3DModal'
import { createDefaultStage3DData, type Stage3DData } from './stage3d/stage3d.types'
import { CanvasVideoWorkbenchModal } from './videoWorkbench/CanvasVideoWorkbenchModal'
import {
  createDefaultVideoWorkbenchData,
  type VideoWorkbenchData,
  type WorkbenchKeyframe,
} from './videoWorkbench/videoWorkbench.types'
import { isCanvasImageContentNode, isOperationNode } from './canvas.capabilities'
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
  getNodePipelineActions,
  readStylePresets,
  readStyleBible,
  upsertStylePreset,
  writeProductionBible,
  writeStyleBible,
} from './canvasPipeline'
import { applyCanvasStyleToTask, buildCanvasStyleContext } from './canvasStyleContext'
import { buildStoryboardGridPrompt, buildStoryboardNodePrompt } from './canvasStoryboardGrid'
import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import {
  resolveStoryboardSplitSourceNode,
  splitStoryboardNode,
} from './canvasStoryboardNodeSplit'
import { buildOpPrompt, CANVAS_PIPELINE_OPS } from './canvasPipelineOps'
import {
  planCanvasPipelineTaskPositions,
  resolveCanvasPipelineAssetTargets,
  type CanvasPipelineAssetTarget,
} from './canvasPipelineActionBatch'
import {
  CANVAS_PIPELINE_CREATE_OPERATIONS,
  canvasGeneralCreateOperations,
} from './canvasNodeGenerationMenu'
import { buildEntityExtractionPrompt, parseExtractedEntities } from './canvasEntityExtract'
import {
  DEFAULT_SHOT_SCRIPT_CONFIG,
  applyShotScriptConfigToPrompt,
} from './canvasAgentPromptPresets'
import { CanvasPromptLibraryPanel, type CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import {
  characterSourceImageUrl,
  cropCharacterSubviewToDataUrl,
  readCharacterSubviews,
  resolveCharacterAssetForDesignCardImageAsset,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'
import {
  placeAutoGridNode,
  placeAutoNodeToRight,
  stackAutoNodesToRight,
} from './canvasAutoPlacement'
import type { CanvasAutoLayoutMode, CanvasAutoLayoutSpacing } from './canvasAutoLayout'
import {
  GROUP_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  OPERATION_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  VIDEO_NODE_DEFAULT_SIZE,
  fitCanvasGroupedImageNodeSize,
  fitCanvasImageNodeSize,
} from './canvasNodeSize'
import type { TabKind as FilmCenterTab } from './CanvasFilmAssetCenter'
import { type AddNodeMenuItem } from './CanvasAddNodeMenu'
import type { CanvasTemplate } from './canvasTemplates'
import { useCanvasWorkspace } from './canvas.store'
import {
  canvasApi,
  fitMediaNodeSize,
  fitTextNodeSize,
  isCanvasDirty,
  operationLabel,
  readAssetTextForNode,
  revertProject,
  saveCanvas,
} from './canvas.api'
import { buildTaskInputFiles, type CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
import { pickCanvasPromptTaskFields } from './canvasPromptTaskFields'
import {
  buildCanvasPromptDocumentForInputs,
  buildCanvasPromptSubmission,
  type CanvasPromptSubmission,
} from './canvasPromptSubmission'
import { migrateLegacyPrompt } from './canvasPromptDocument'
import { stripCanvasFunctionalPromptInput } from './canvasPromptInitialization'
import { summarizeCanvasSelectionContext } from './canvasContextMenuModel'
import {
  buildCanvasOperationSystemPrompt,
  mergeCanvasOperationPresetNegativePrompt,
  mergeCanvasPresetTargetModelParams,
  readBuiltinCanvasOperationPreset,
  readCanvasOperationPreset,
  readCanvasOperationPresetOverrides,
  readCanvasResolvedPresetTarget,
  resolveCanvasPresetTarget,
  writeCanvasLastUsedPresetTarget,
} from './canvasOperationPresets'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import type {
  CanvasInputTransport,
  CanvasAsset,
  CanvasNode,
  CanvasOperationType,
  CanvasPipelineRole,
  CanvasProductionState,
  CanvasProject,
  CanvasProjectSettings,
  CanvasTask,
  ShotScriptConfig,
} from './canvas.types'
import type {
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
  SessionReasoningEffort,
} from '@spark/protocol'
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import './CanvasWorkspaceView.less'
import './uiux-v4/index.less'

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
  title?: string
}
type LayoutBounds = {
  left: number
  top: number
  right: number
  bottom: number
}
type InsertPreparedImagesResult = {
  createdNodeCount: number
  grouped: boolean
  createdNodeIds: string[]
  selectedNodeIds: string[]
  occupiedBounds?: LayoutBounds
  groupNodeId?: string
}
type CharacterSubviewEditorContext = {
  node: CanvasNode
  ownerAsset: CanvasAsset
  sourceImageAsset: CanvasAsset
  subviews: FilmCharacterSubview[]
}
type CanvasSaveMode = 'manual' | 'auto'
type CanvasPersistResult = 'saved' | 'failed' | 'skipped'

function findLatestCreatedOperationNode(
  nodes: CanvasNode[],
  operation: CanvasOperationType,
  existingNodeIds: Set<string>,
): CanvasNode | null {
  const candidates = nodes.filter(
    (item) =>
      !existingNodeIds.has(item.id) && item.data?.operation === operation && isOperationNode(item),
  )
  if (candidates.length === 0) return null
  return (
    [...candidates].sort((left, right) => {
      const timeDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
      if (timeDelta !== 0) return timeDelta
      return right.zIndex - left.zIndex
    })[0] ?? null
  )
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

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function canvasTaskFailureMessage(task: CanvasTask): string {
  const detail = (task.errorDetail ?? task.errorMsg ?? '').trim()
  return detail ? `任务失败：${detail}` : '任务失败，请检查任务详情后重试'
}

// html2canvas 1.4.1 只认 hsl/hsla/rgb/rgba 颜色函数，遇到 color()/oklch()/oklab()/color-mix()
// 等现代颜色函数会抛 "Attempting to parse an unsupported color function"。这里在截图前把目标
// 子树里所有用到这些函数的颜色相关样式，改写成浏览器规范化后的 rgb()/rgba() 等价值。
const HTML2CANVAS_UNSUPPORTED_COLOR = /(color-mix|color|oklch|oklab|hwb|lab|lch)\s*\(/i
const HTML2CANVAS_COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
  'caretColor',
  'columnRuleColor',
  'boxShadow',
  'background',
  'backgroundImage',
  'border',
  'outline',
  'textDecoration',
  'textShadow',
  'filter',
]

let html2canvasColorNormalizersCanvas: HTMLCanvasElement | null = null
let html2canvasColorNormalizerElement: HTMLElement | null = null

function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseCssColorNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined
  const number = Number.parseFloat(trimmed)
  if (!Number.isFinite(number)) return undefined
  return trimmed.endsWith('%') ? number / 100 : number
}

function parseCssAlpha(value: string | undefined): number {
  if (!value) return 1
  const parsed = parseCssColorNumber(value)
  if (parsed === undefined) return 1
  return Math.max(0, Math.min(1, parsed))
}

function formatCssRgbColor(channels: number[], alpha: number): string {
  const [red, green, blue] = channels.map((channel) => clampColorChannel(channel * 255))
  if (alpha >= 1) return `rgb(${red}, ${green}, ${blue})`
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
}

function normalizeCssColorFunctionToken(rawValue: string): string | undefined {
  const match = rawValue.match(/^color\(\s*([a-z0-9-]+)\s+(.+)\)$/i)
  if (!match) return undefined
  const colorSpace = match[1]?.toLowerCase()
  const supportedColorSpaces = ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb']
  if (!colorSpace || !supportedColorSpaces.includes(colorSpace)) {
    return undefined
  }
  const [channelText = '', alphaText] = (match[2] ?? '').split(/\s*\/\s*/, 2)
  const channels = channelText.trim().split(/\s+/).slice(0, 3).map(parseCssColorNumber)

  if (channels.length < 3 || channels.some((channel) => channel === undefined)) return undefined
  return formatCssRgbColor(channels as number[], parseCssAlpha(alphaText))
}

function normalizeCssColorWithBrowser(rawValue: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  if (!html2canvasColorNormalizerElement) {
    html2canvasColorNormalizerElement = document.createElement('span')
    html2canvasColorNormalizerElement.style.cssText =
      'position:absolute;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none;'
    document.documentElement.appendChild(html2canvasColorNormalizerElement)
  }
  const element = html2canvasColorNormalizerElement
  element.style.color = ''
  element.style.color = rawValue
  if (!element.style.color) return undefined

  const normalized = window.getComputedStyle(element).color
  const parsed = normalizeCssColorFunctionToken(normalized)
  return parsed ?? normalized
}

function normalizeCssColorWithBrowserForHtml2Canvas(rawValue: string): string | undefined {
  const normalized = normalizeCssColorWithBrowser(rawValue)
  if (!normalized || HTML2CANVAS_UNSUPPORTED_COLOR.test(normalized)) return undefined
  return normalized
}

function normalizeSingleCssColorToken(rawValue: string): string {
  const parsedColorFunction = normalizeCssColorFunctionToken(rawValue)
  if (parsedColorFunction) return parsedColorFunction

  // 浏览器 canvas 的 fillStyle 赋值会自动把任何合法颜色值规范化为 rgb()/rgba()/#hex，
  // 是最权威的颜色降级方式（支持 color()/oklch()/color-mix() 等所有现代写法）。
  if (!html2canvasColorNormalizersCanvas) {
    html2canvasColorNormalizersCanvas = document.createElement('canvas')
  }
  const ctx = html2canvasColorNormalizersCanvas.getContext('2d')
  if (!ctx) return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
  try {
    const sentinel = '#010203'
    ctx.fillStyle = sentinel
    ctx.fillStyle = rawValue
    const normalized = ctx.fillStyle
    // 若浏览器无法识别该值，fillStyle 会回落为上一个有效值，此时继续尝试 DOM computed style。
    if (normalized.toLowerCase() === sentinel) {
      return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
    }
    if (HTML2CANVAS_UNSUPPORTED_COLOR.test(normalized)) {
      return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
    }
    if (/^(rgb|rgba|#)/i.test(normalized)) return normalized
  } catch {
    // 继续尝试 DOM computed style 兜底。
  }

  return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
}

function findCssFunctionEnd(value: string, openParenIndex: number): number {
  let depth = 0
  for (let index = openParenIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function normalizeCssColorForSnapshot(rawValue: string): string {
  if (!rawValue || !HTML2CANVAS_UNSUPPORTED_COLOR.test(rawValue)) return rawValue

  let output = ''
  let cursor = 0
  let changed = false

  while (cursor < rawValue.length) {
    const rest = rawValue.slice(cursor)
    const match = rest.match(HTML2CANVAS_UNSUPPORTED_COLOR)
    if (!match || match.index === undefined) {
      output += rest
      break
    }

    const functionStart = cursor + match.index
    const functionOpen = rawValue.indexOf('(', functionStart)
    if (functionOpen < 0) {
      output += rawValue.slice(cursor)
      break
    }
    const functionEnd = findCssFunctionEnd(rawValue, functionOpen)
    if (functionEnd < 0) {
      output += rawValue.slice(cursor)
      break
    }

    const token = rawValue.slice(functionStart, functionEnd + 1)
    const normalized = normalizeSingleCssColorToken(token)
    output += rawValue.slice(cursor, functionStart) + normalized
    changed = changed || normalized !== token
    cursor = functionEnd + 1
  }

  return changed ? output : rawValue
}

function normalizeColorsForHtml2Canvas(
  root: HTMLElement,
  targetWindow: Window = window,
): (() => void) | undefined {
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const restores: Array<() => void> = []

  for (const element of elements) {
    const computed = targetWindow.getComputedStyle(element)
    const inlineStyle = element.style
    const cssProps = new Set(
      HTML2CANVAS_COLOR_PROPS.map((prop) => prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)),
    )
    for (let index = 0; index < computed.length; index += 1) {
      const cssProp = computed.item(index)
      if (!cssProp) continue
      const value = computed.getPropertyValue(cssProp)
      if (HTML2CANVAS_UNSUPPORTED_COLOR.test(value)) cssProps.add(cssProp)
    }

    for (const cssProp of cssProps) {
      const value = computed.getPropertyValue(cssProp)
      if (typeof value !== 'string' || !HTML2CANVAS_UNSUPPORTED_COLOR.test(value)) continue
      const normalized = normalizeCssColorForSnapshot(value)
      if (normalized === value) continue
      const previous = inlineStyle.getPropertyValue(cssProp)
      const previousPriority = inlineStyle.getPropertyPriority(cssProp)
      const hadPrevious = previous !== '' || previousPriority !== ''
      restores.push(() => {
        if (hadPrevious) {
          inlineStyle.setProperty(cssProp, previous, previousPriority)
        } else {
          inlineStyle.removeProperty(cssProp)
        }
      })
      // 用 !important 覆盖计算值，保证 html2canvas 在克隆阶段拿到的是 rgb()/rgba()。
      inlineStyle.setProperty(cssProp, normalized, 'important')
    }
  }

  if (restores.length === 0) return undefined
  return () => {
    while (restores.length > 0) {
      const restore = restores.pop()
      restore?.()
    }
  }
}

function buildCanvasSnapshotFileName(title: string | undefined): string {
  const safeTitle = (title || 'group')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${safeTitle || 'group'}-merged-${Date.now()}.png`
}

function collectGroupDescendantNodes(nodes: CanvasNode[], groupId: string): CanvasNode[] {
  const descendants: CanvasNode[] = []
  const queue = nodes.filter((node) => node.parentNodeId === groupId)

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    descendants.push(node)
    if (node.type === 'group') {
      queue.push(...nodes.filter((candidate) => candidate.parentNodeId === node.id))
    }
  }

  return descendants
}

function findGroupContainingNodes(nodes: CanvasNode[], nodeIds: string[]): CanvasNode | null {
  const expectedIds = new Set(nodeIds)
  if (expectedIds.size === 0) return null
  const groups = nodes.filter((node) => node.type === 'group')
  return (
    groups.find((group) => {
      const childIds = new Set(
        nodes.filter((node) => node.parentNodeId === group.id).map((node) => node.id),
      )
      for (const nodeId of expectedIds) {
        if (!childIds.has(nodeId)) return false
      }
      return true
    }) ?? null
  )
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

const CANVAS_SIDE_PANEL_WIDTH_KEY = 'spark-canvas:side-panel-width'
const CANVAS_AUTO_SAVE_STORAGE_KEY_PREFIX = 'spark-canvas:auto-save:'
const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 400
const CANVAS_SIDE_PANEL_MIN_WIDTH = 400
const CANVAS_SIDE_PANEL_MAX_WIDTH = 640
const CANVAS_SIDE_PANEL_KEYBOARD_STEP = 24
const CANVAS_AGENT_PANEL_WIDTH_KEY = 'spark-canvas:agent-panel-width'
const CANVAS_AGENT_PANEL_OPEN_KEY = 'spark-canvas:agent-panel-open'
// 旧实现会在 mount 时把"默认折叠 / 旧默认宽度"持久化进 localStorage，污染所有老用户的偏好，
// 导致即便改了默认常量，老用户也始终拿到旧的窄值/折叠态。用版本标记做一次性迁移：
// 迁移后老用户也回到新的默认（展开 + 更宽），用户后续显式折叠/调窄仍被保留。
const CANVAS_AGENT_PANEL_OPEN_DEFAULT_VERSION_KEY = 'spark-canvas:agent-panel-open-default-v2'
const CANVAS_AGENT_PANEL_WIDTH_MIGRATED_KEY = 'spark-canvas:agent-panel-width-migrated-v2'
const CANVAS_AGENT_PANEL_DEFAULT_WIDTH = 560
const CANVAS_AGENT_PANEL_MIN_WIDTH = 400
const CANVAS_AGENT_PANEL_MAX_WIDTH = 1200
const CANVAS_AUTO_SAVE_DEBOUNCE_MS = 1200
const CANVAS_AUTO_SAVE_THROTTLE_MS = 30_000
// 自动保存失败时的退避：失败时 delay = min(30s, 1.2s * 2^failCount)，
// 同时 failCount 连续累计到上限后停止重试（避免 SQLite 锁 / 磁盘满等持续错误把 CPU 打满）。
const CANVAS_AUTO_SAVE_BACKOFF_BASE_MS = CANVAS_AUTO_SAVE_DEBOUNCE_MS
const CANVAS_AUTO_SAVE_BACKOFF_MAX_MS = CANVAS_AUTO_SAVE_THROTTLE_MS
const CANVAS_AUTO_SAVE_MAX_FAILS = 5
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

function clampAgentPanelWidth(width: number): number {
  return Math.min(Math.max(width, CANVAS_AGENT_PANEL_MIN_WIDTH), CANVAS_AGENT_PANEL_MAX_WIDTH)
}

function readAgentPanelWidth(): number {
  if (typeof window === 'undefined') return CANVAS_AGENT_PANEL_DEFAULT_WIDTH
  try {
    const parsed = Number(window.localStorage.getItem(CANVAS_AGENT_PANEL_WIDTH_KEY))
    if (!Number.isFinite(parsed)) return CANVAS_AGENT_PANEL_DEFAULT_WIDTH
    // 一次性迁移：把低于新默认宽度的历史窄值（旧默认 380 / 旧最小 300 等）上迁到新默认，
    // 解决"之前改了默认常量但老用户面板还是窄"——持久化的旧窄值会覆盖新默认。
    // 用版本标记保证只迁一次：之后用户若手动调窄到 [MIN_WIDTH, DEFAULT) 区间，会被尊重保留。
    if (window.localStorage.getItem(CANVAS_AGENT_PANEL_WIDTH_MIGRATED_KEY) !== '1') {
      window.localStorage.setItem(CANVAS_AGENT_PANEL_WIDTH_MIGRATED_KEY, '1')
      if (parsed < CANVAS_AGENT_PANEL_DEFAULT_WIDTH) return CANVAS_AGENT_PANEL_DEFAULT_WIDTH
    }
    return clampAgentPanelWidth(parsed)
  } catch {
    return CANVAS_AGENT_PANEL_DEFAULT_WIDTH
  }
}

function readAgentPanelOpen(): boolean {
  if (typeof window === 'undefined') return true
  try {
    // 一次性迁移：旧实现会在 mount 时把"默认折叠"写成 '0' 持久化，导致改默认值对老用户无效。
    // 用版本标记识别"尚未迁移"的用户，清除被污染的旧 OPEN_KEY 后回退到默认展开。
    if (window.localStorage.getItem(CANVAS_AGENT_PANEL_OPEN_DEFAULT_VERSION_KEY) !== '1') {
      window.localStorage.removeItem(CANVAS_AGENT_PANEL_OPEN_KEY)
      window.localStorage.setItem(CANVAS_AGENT_PANEL_OPEN_DEFAULT_VERSION_KEY, '1')
      return true
    }
    const stored = window.localStorage.getItem(CANVAS_AGENT_PANEL_OPEN_KEY)
    // 已迁移且无显式偏好（新用户）→ 默认展开；显式折叠过 → 保留其偏好
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

function canvasAutoSaveStorageKey(projectId: string): string {
  return `${CANVAS_AUTO_SAVE_STORAGE_KEY_PREFIX}${projectId}`
}

function readCanvasAutoSaveEnabled(projectId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(canvasAutoSaveStorageKey(projectId)) === '1'
  } catch {
    return false
  }
}

function writeCanvasAutoSaveEnabled(projectId: string, enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const key = canvasAutoSaveStorageKey(projectId)
    if (enabled) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Ignore storage failures; the current session still respects the in-memory toggle.
  }
}

function fitImageNodeSize(width: number, height: number): { width: number; height: number } {
  return fitCanvasImageNodeSize(width, height)
}

function fitGroupedImageNodeSize(width: number, height: number): { width: number; height: number } {
  return fitCanvasGroupedImageNodeSize(width, height)
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

function mergeBounds(bounds: LayoutBounds[]): LayoutBounds {
  return {
    left: Math.min(...bounds.map((item) => item.left)),
    top: Math.min(...bounds.map((item) => item.top)),
    right: Math.max(...bounds.map((item) => item.right)),
    bottom: Math.max(...bounds.map((item) => item.bottom)),
  }
}

function boundsForPlacements(
  positions: Array<{ x: number; y: number }>,
  size: { width: number; height: number },
): LayoutBounds {
  return {
    left: Math.min(...positions.map((position) => position.x)),
    top: Math.min(...positions.map((position) => position.y)),
    right: Math.max(...positions.map((position) => position.x + size.width)),
    bottom: Math.max(...positions.map((position) => position.y + size.height)),
  }
}

function nextOriginAfterBounds(bounds: LayoutBounds): CanvasPoint {
  return {
    x: Math.round(bounds.right + 72),
    y: Math.round(bounds.top),
  }
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

/**
 * 计算资产插入画布后节点的真实尺寸。
 *
 * 必须与 `canvasApi.insertAssetToBoard` 内部的尺寸逻辑完全一致——
 * 两者用同样的分支（媒体按比例拟合 / 文本按字数拟合），否则居中位置会
 * 因尺寸偏差而落点不准。这里复用 canvas.api 导出的拟合函数，保证同步。
 */
function resolveAssetInsertSize(asset: CanvasAsset): { width: number; height: number } {
  if (asset.type === 'text' || asset.type === 'prompt') {
    return fitTextNodeSize(readAssetTextForNode(asset))
  }
  return fitMediaNodeSize(asset.type, asset.width, asset.height)
}

function getFloatingEditorGeometry(
  node: CanvasNode,
  viewport: CanvasStageViewport | null,
): { toolbar: CSSProperties; panel: CSSProperties } | null {
  const effectiveViewport: CanvasStageViewport =
    viewport && viewport.width > 0 && viewport.height > 0 && viewport.zoom > 0
      ? viewport
      : {
          x: viewport?.x ?? 0,
          y: viewport?.y ?? 0,
          zoom: viewport?.zoom && viewport.zoom > 0 ? viewport.zoom : 1,
          width: typeof window === 'undefined' ? 1024 : Math.max(640, window.innerWidth || 1024),
          height: typeof window === 'undefined' ? 720 : Math.max(480, window.innerHeight || 720),
        }

  const nodeLeft = effectiveViewport.x + node.x * effectiveViewport.zoom
  const nodeTop = effectiveViewport.y + node.y * effectiveViewport.zoom
  const nodeRight = effectiveViewport.x + (node.x + node.width) * effectiveViewport.zoom
  const nodeBottom = effectiveViewport.y + (node.y + node.height) * effectiveViewport.zoom
  const nodeCenterX = nodeLeft + (nodeRight - nodeLeft) / 2
  const floatingWidth = Math.min(920, Math.max(480, effectiveViewport.width - 96))
  const toolbarLeft = clampPosition(nodeCenterX, 180, effectiveViewport.width - 180)
  const panelLeft = clampPosition(
    nodeCenterX,
    floatingWidth / 2 + 16,
    effectiveViewport.width - floatingWidth / 2 - 16,
  )
  const toolbarTop = clampPosition(nodeTop - 68, 14, Math.max(14, effectiveViewport.height - 160))
  const panelTop = clampPosition(
    nodeBottom + 18,
    112,
    Math.max(112, effectiveViewport.height - 250),
  )

  return {
    toolbar: { left: toolbarLeft, top: toolbarTop },
    panel: {
      left: panelLeft,
      top: panelTop,
      width: floatingWidth,
    },
  }
}

const FLOATING_IMAGE_STYLE_EXTRACTION_PROMPT =
  '请分析输入图片的视觉风格，并输出可复用的中文风格描述。重点包括：画面题材、艺术媒介、色彩倾向、光影氛围、构图镜头、材质细节、时代/类型气质，以及适合作为后续生成提示词的风格关键词。'

function readCanvasNodeSourceText(node: CanvasNode): string {
  return (node.data.text ?? node.data.prompt ?? node.title ?? '').trim()
}

function buildFloatingImageOutpaintPrompt(node: CanvasNode): string {
  const source = readCanvasNodeSourceText(node)
  return [
    '请基于输入图片进行自然扩图，将画面扩展为默认 2:1 横向比例。',
    '保持主体身份、造型、场景透视、光影方向、材质纹理、镜头语言和整体风格一致。',
    '扩展区域需要像原图真实延伸出来，避免重复主体、变形、黑边、文字、水印、拼接痕迹或明显 AI 边缘。',
    source ? `补充要求：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildFloatingDetailSheetNineGridPrompt(node: CanvasNode): string {
  const source = readCanvasNodeSourceText(node)
  const sourceIntro =
    node.type === 'image'
      ? '请以输入图片为核心参考，保留主体/场景的身份一致性和视觉风格。'
      : '请根据输入内容进行视觉扩散设计。'
  return [
    sourceIntro,
    '生成一张 2:1 横向画布的九宫格设定拆分图，3x3 排列，每格是同一主题的不同角度、距离或细节变化。',
    '如果主题是场景：包含远景建立、正面、侧面、俯视/高角度、低角度、入口/出口、关键道具、材质细节、光影氛围等变化。',
    '如果主题是人物：包含正面、侧面、背面、半身、全身、表情、服装细节、道具细节、动态姿态等变化。',
    '如果主题是道具/物体：包含正视、侧视、背视、打开/使用状态、局部材质、尺寸关系、环境中的摆放、功能细节等变化。',
    '九格之间保持同一世界观与设计语言，画面干净，不要文字标签、水印、边框说明或 UI 元素。',
    source ? `输入内容：${source}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStoryboardReferenceInputRoles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = { ...(inputRoles ?? {}) }
  for (const node of nodes) {
    if (node.type === 'image' && node.data.url) roles[node.id] = 'reference'
  }
  return roles
}

async function buildCloudTaskInputFiles(
  nodes: CanvasNode[],
  inputTransport: CanvasInputTransport | undefined,
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): Promise<CanvasMediaTaskInputFile[]> {
  const files = buildTaskInputFiles(nodes, inputRoles)
  if (files.length === 0) return files
  if (inputTransport === 'base64') {
    return Promise.all(files.map(materializeBase64Input))
  }
  if (inputTransport !== 'cloud_url') {
    // auto / undefined：不强制按配置转换，但 safe-file:// 本地协议地址第三方 API
    // 永远无法访问，必须兜底转成 base64（项目「优先 base64」原则）。其余照原样透传。
    // 兜底是防御性的，转换失败时回退原样透传（与改前行为一致），不因读取异常阻断任务。
    return Promise.all(
      files.map(async (file) => {
        if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://'))
          return file
        try {
          return await materializeBase64Input(file)
        } catch {
          return file
        }
      }),
    )
  }
  return Promise.all(
    files.map(async (file, index) => {
      if (file.type !== 'image') return file
      if (file.url && /^https?:\/\//i.test(file.url)) return file
      const filePath = file.url ? decodeSafeFileUrl(file.url) : null
      try {
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
      } catch (uploadError) {
        try {
          const fallback = await materializeBase64Input(file)
          if (fallback !== file) {
            console.warn(
              '[CanvasTaskInput] auth:upload-file failed; falling back to base64 input',
              {
                index,
                role: file.role,
                mimeType: file.mimeType,
                uploadError,
              },
            )
            return fallback
          }
        } catch (fallbackError) {
          console.error(
            '[CanvasTaskInput] Failed to materialize local input after upload failure',
            {
              index,
              role: file.role,
              mimeType: file.mimeType,
              uploadError,
              fallbackError,
            },
          )
        }
        console.error('[CanvasTaskInput] Failed to upload input file for cloud_url transport', {
          index,
          role: file.role,
          mimeType: file.mimeType,
          uploadError,
        })
        throw uploadError
      }
    }),
  )
}

/**
 * 把 safe-file:// 图片转成 base64 dataUrl。
 *
 * 必须丢弃原来的 url：下游 adapter（如 xAI editImage 的取值）可能用 `file.url ?? file.dataUrl`，
 * 若保留旧 safe-file url，它会胜过刚转换出来的 dataUrl，导致转换白做、本地协议仍泄漏给第三方。
 */
async function materializeBase64Input(
  file: CanvasMediaTaskInputFile,
): Promise<CanvasMediaTaskInputFile> {
  if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://')) return file
  const dataUrl = await readUrlAsDataUrl(file.url)
  // 显式重构造，丢掉旧 url（与 cloud_url 分支写法一致，避免保留本地协议地址）
  return {
    type: file.type,
    ...(file.role ? { role: file.role } : {}),
    dataUrl,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
  }
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

function hydrateTextInputNodes(nodes: CanvasNode[], assets: CanvasAsset[]): CanvasNode[] {
  const assetTextById = new Map(
    assets
      .filter((asset) => asset.type === 'text' || asset.type === 'prompt')
      .map((asset) => [asset.id, asset.contentText?.trim() ?? '']),
  )
  return nodes.map((node) => {
    if (node.type !== 'text' && node.type !== 'prompt') return node
    const text = node.data.text?.trim() || (node.assetId ? assetTextById.get(node.assetId) : '')
    if (!text || text === node.data.text) return node
    return { ...node, data: { ...node.data, text } }
  })
}

function buildPipelineSourceText(nodes: CanvasNode[], assets: CanvasAsset[]): string {
  const byAssetId = new Map(assets.map((asset) => [asset.id, asset]))
  return nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => {
      const assetText = node.assetId ? byAssetId.get(node.assetId)?.contentText : undefined
      return (assetText ?? node.data.text ?? '').trim()
    })
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
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
  return readBuiltinCanvasOperationPreset(operation).prompt
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
    const propLine = line.match(/^[【[]?\s*道具\s*[】\]]?\s*[:：]\s*(.+)$/)
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

/** 把抽取得到的结构化属性拆成数组（中英顿号/逗号/分号分隔） */
function splitAttrList(value: string | undefined): string[] | undefined {
  if (!value || !value.trim()) return undefined
  const items = value
    .split(/[、,，;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * 把角色资产（contentText + metadata.attributes）映射为角色图提示词字段（设计 §S4）。
 * 优先把抽取出的结构化属性（身高/肤色/五官/眼睛/配饰/标志特征/气质…）逐项映射到
 * CharacterPromptFields，让角色卡拿到精细字段；未识别属性与正文设定汇入 appearance 补充。
 */
function assetToCharacterFields(asset: CanvasAsset): CharacterPromptFields {
  const attrs = (asset.metadata?.attributes as Record<string, string> | undefined) ?? {}
  const get = (key: string): string | undefined => {
    const value = attrs[key]
    return value && value.trim() ? value.trim() : undefined
  }
  const fields: CharacterPromptFields = {}
  if (asset.title) fields.name = asset.title
  const gender = get('gender')
  if (gender) fields.gender = gender
  const age = get('age')
  if (age) fields.ageStage = age
  const occupation = get('occupation')
  if (occupation) fields.occupation = occupation
  const height = get('height')
  if (height) fields.height = height
  const skin = get('skin')
  if (skin) fields.skinTone = skin
  const face = get('face')
  if (face) fields.facialFeatures = face
  const eyes = get('eyes')
  if (eyes) fields.eyeColor = eyes
  const hair = get('hair')
  if (hair) fields.hairstyle = hair
  const costume = get('costume')
  if (costume) fields.costume = costume
  const accessories = splitAttrList(get('accessories'))
  if (accessories) fields.accessories = accessories
  const signatureProps = splitAttrList(get('signatureProp'))
  if (signatureProps) fields.signatureProps = signatureProps
  const marks = get('marks')
  if (marks) fields.distinguishingMarks = marks
  const temperament = get('temperament')
  if (temperament) fields.temperament = temperament
  const personality = splitAttrList(get('personality'))
  if (personality) fields.personalityKeywords = personality

  // 已映射的结构化 key 之外的属性 + 正文设定，汇入 appearance 作为补充视觉要点
  const mappedKeys = new Set([
    'gender',
    'age',
    'occupation',
    'height',
    'skin',
    'face',
    'eyes',
    'hair',
    'costume',
    'accessories',
    'signatureProp',
    'marks',
    'temperament',
    'personality',
    'appearance',
  ])
  const appearanceParts = [
    get('appearance') ?? '',
    asset.contentText ?? '',
    ...Object.entries(attrs)
      .filter(([key, value]) => !mappedKeys.has(key) && value && value.trim())
      .map(([key, value]) => `${key}: ${value.trim()}`),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
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
          : kind === 'effect'
            ? '特效视觉设定'
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
  const detailDirective =
    kind === 'scene'
      ? '输出一张大画幅「场景概念设计板」：以低机位广角建立镜头呈现完整空间，明确前景/中景/背景的纵深层次与遮挡关系；标注主光源位置、光影走向、整体色调与色温；体现关键陈设、标志物与材质质感（墙面/地面/家具的材料及新旧磨损）；再补充 2-3 个细节插图（入口出口、标志物特写、材质特写）并配简短文字标签；保证空间布局可被后续镜头复用的一致性。'
      : kind === 'prop'
        ? '输出一张「道具设定板」：正面/侧面/背面与 3/4 视角并列，附手持或参照物比例；材质、工艺与磨损特写；功能结构拆解与可动部件；颜色、纹理、编号或机关等细节标注；附 1-2 个使用场景小图；强调可被后续分镜复用的一致性锚点。'
        : kind === 'effect'
          ? '输出一张「特效视觉设定板」：分起势/峰值/消散三阶段排列展示；标注运动轨迹与扩散方向；刻画粒子/烟雾/能量膜/光晕的质感细节；体现自发光及其对角色与环境的照明交互；提供近景细节与中景应用示例；统一色彩与氛围。'
          : '输出一张清晰「设定板」：主体居中并给出多视角，补充近景/中景与关键细节插图并配简短标签，便于作为后续分镜与视频生成的一致性参考。'

  const base = [
    `为影视项目生成一张「${asset.title ?? '未命名'}」的${subject}参考图。`,
    attrText ? `视觉要点：${attrText}` : '',
    setting ? `设定摘要：${setting}` : '',
    stylePrompt ? `风格要求：${stylePrompt}` : '',
    styleBible && styleBible.trim() ? `统一视觉基调：${styleBible.trim()}` : '',
    `画面要求：电影级质感，层次丰富、光影考究、细节精致、构图专业；${detailDirective}`,
    '负面要求：避免畸变、糊面、错误解剖、杂乱水印与无意义文字。',
  ].filter(Boolean)
  return base.join('\n')
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

function buildPromptOptimizationInstruction(
  prompt: string,
  negativePrompt: string,
  requirement?: string,
): string {
  const sections = [
    '请把下面的提示词优化为适合影视/多媒体生成模型使用的专业提示词。',
    '要求：保留原意，直接输出优化后的提示词本身，不要解释过程，不要加多余的前后缀说明。',
  ]
  if (requirement?.trim()) {
    sections.push(`本次优化的具体要求：${requirement.trim()}`)
  } else {
    sections.push('补充主体、场景、镜头语言、光影、风格、质量要求。')
  }
  sections.push(`原提示词：\n${prompt.trim()}`)
  if (negativePrompt.trim()) {
    sections.push(`反向提示词：\n${negativePrompt.trim()}`)
  }
  return sections.join('\n\n')
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

const CANVAS_SHORTCUT_HELP_GROUPS: Array<{
  title: string
  items: Array<{ keys: string[]; desc: string }>
}> = [
  {
    title: '创作 / 节点',
    items: [
      { keys: ['Tab'], desc: '在选择 / 平移工具之间切换' },
      { keys: ['双击节点'], desc: '展开节点编辑面板' },
      { keys: ['Esc'], desc: '关闭当前浮层 / 弹窗 / 编辑面板' },
      { keys: ['Delete', 'Backspace'], desc: '删除选中节点或连线' },
      { keys: ['Ctrl / Cmd', '点击'], desc: '追加选择节点' },
      { keys: ['Shift', '点击'], desc: '追加选择节点' },
      { keys: ['框选'], desc: '批量选择节点' },
    ],
  },
  {
    title: '视图 / 缩放',
    items: [
      { keys: ['滚轮'], desc: '缩放画布' },
      { keys: ['Ctrl / Cmd', '+'], desc: '放大画布' },
      { keys: ['Ctrl / Cmd', '-'], desc: '缩小画布' },
      { keys: ['Ctrl / Cmd', '0'], desc: '适配全部节点' },
      { keys: ['底部工具栏', '适配'], desc: '一键查看完整画布' },
      { keys: ['底部工具栏', '网格'], desc: '显示 / 隐藏画布网格' },
    ],
  },
  {
    title: '移动画布',
    items: [
      { keys: ['Space', '拖拽'], desc: '临时抓手平移画布' },
      { keys: ['平移工具', '拖拽'], desc: '移动视图' },
      { keys: ['方向键 ↑'], desc: '向上平移画布' },
      { keys: ['方向键 ↓'], desc: '向下平移画布' },
      { keys: ['方向键 ←'], desc: '向左平移画布' },
      { keys: ['方向键 →'], desc: '向右平移画布' },
      { keys: ['底部工具栏', '回到选中'], desc: '把视图移动到选中节点' },
    ],
  },
  {
    title: '其他 / 工具栏入口',
    items: [
      { keys: ['Ctrl / Cmd', 'S'], desc: '保存画布' },
      { keys: ['Ctrl / Cmd', 'Z'], desc: '撤销' },
      { keys: ['Ctrl / Cmd', 'Shift', 'Z'], desc: '重做' },
      { keys: ['Ctrl / Cmd', '\\'], desc: '展开 / 折叠右侧面板' },
      { keys: ['Ctrl / Cmd', 'R'], desc: '刷新当前画布数据' },
      { keys: ['Ctrl / Cmd', 'Shift', 'S'], desc: '开启 / 关闭自动保存' },
      { keys: ['底部工具栏', '任务节点'], desc: '打开任务节点类型列表' },
      { keys: ['底部工具栏', '资源节点'], desc: '打开资源内容节点列表' },
      { keys: ['底部工具栏', '资产中心'], desc: '打开项目资产中心' },
    ],
  },
]

export function CanvasWorkspaceView({
  projectId,
  onBack,
  showSidebarExpandButton = true,
}: {
  projectId: string
  onBack: () => void | Promise<void>
  showSidebarExpandButton?: boolean
}) {
  const {
    snapshot,
    loading,
    canUndo,
    canRedo,
    undoCanvasChange,
    redoCanvasChange,
    updateNodes,
    connectNodes,
    deleteEdges,
    createTextNode,
    createImageNode,
    createMediaNode,
    uploadImageAsset,
    createGroupNode,
    dissolveGroupNode,
    addNodesToGroup,
    removeNodesFromGroup,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNodeData,
    updateManyNodeData,
    updateProjectSettings,
    createTask,
    cancelTask,
    clearTasks,
    deleteTasks,
    // board 管理
    createBoard,
    renameBoard,
    deleteBoard,
    duplicateBoard,
    switchBoard,
    setDefaultBoard,
    copyNodesToBoard,
    refreshTaskSnapshot,
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
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [filmCenterOpen, setFilmCenterOpen] = useState(false)
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false)
  const [presetModalOpen, setPresetModalOpen] = useState(false)
  const [configuredPresetCount, setConfiguredPresetCount] = useState(
    () => Object.keys(readCanvasOperationPresetOverrides()).length,
  )
  const [shotDirectorOpen, setShotDirectorOpen] = useState(false)
  const [filmCenterInitialTab, setFilmCenterInitialTab] = useState<FilmCenterTab | undefined>(
    undefined,
  )
  const [agentOpen, setAgentOpen] = useState(readAgentPanelOpen)
  // 「新建空画布强制展开 Agent 面板」只判定一次：snapshot 首次加载完成且节点为空时强制展开。
  // ref 守卫避免后续把节点删空时反复弹开；非空画布尊重用户上次的展开/折叠偏好（useState 已初始化）。
  const forceExpandAgentOnEmptyCheckedRef = useRef(false)
  // 进入画布默认为平移模式：避免误触发框选/拖拽节点，更符合「先浏览」的直觉。
  const [activeTool, setActiveTool] = useState<CanvasTool>('pan')
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
  const [sidePanelTab, setSidePanelTab] = useState<'details' | 'tasks' | 'assets' | 'project'>(
    'details',
  )
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [inlinePanelFocusRequest, setInlinePanelFocusRequest] = useState<{
    nodeId: string
    nonce: number
  } | null>(null)
  const [panoramaPreviewNodeId, setPanoramaPreviewNodeId] = useState<string | null>(null)
  const [annotatingImageNodeId, setAnnotatingImageNodeId] = useState<string | null>(null)
  const [gridSplitImageNodeId, setGridSplitImageNodeId] = useState<string | null>(null)
  const [characterSubviewEditorNodeId, setCharacterSubviewEditorNodeId] = useState<string | null>(
    null,
  )
  const resolveCanvasResourceActionNode = useCallback(
    (nodeId: string) => {
      if (!snapshot) return null
      const node = snapshot.nodes.find((item) => item.id === nodeId)
      if (!node) return null
      return isOperationNode(node) ? resolveCanvasOperationResourceNode(node, snapshot) : node
    },
    [snapshot],
  )
  const annotatingImageNode = useMemo(
    () => (annotatingImageNodeId ? resolveCanvasResourceActionNode(annotatingImageNodeId) : null),
    [annotatingImageNodeId, resolveCanvasResourceActionNode],
  )
  const gridSplitImageNode = useMemo(
    () => (gridSplitImageNodeId ? resolveCanvasResourceActionNode(gridSplitImageNodeId) : null),
    [gridSplitImageNodeId, resolveCanvasResourceActionNode],
  )
  const characterSubviewEditorContext = useMemo<CharacterSubviewEditorContext | null>(() => {
    if (!characterSubviewEditorNodeId || !snapshot) return null
    const node = resolveCanvasResourceActionNode(characterSubviewEditorNodeId)
    if (!node?.assetId) return null
    const sourceImageAsset =
      snapshot.assets.find((item) => item.id === node.assetId && item.type === 'image') ?? null
    const characterAsset = resolveCharacterAssetForDesignCardImageAsset(
      sourceImageAsset,
      snapshot.assets,
      snapshot.tasks,
    )
    const ownerAsset = characterAsset ?? sourceImageAsset
    if (!sourceImageAsset || !ownerAsset) return null
    return {
      node,
      sourceImageAsset,
      ownerAsset,
      subviews: readCharacterSubviews(ownerAsset.metadata),
    }
  }, [characterSubviewEditorNodeId, resolveCanvasResourceActionNode, snapshot])
  const [directorStageNodeId, setDirectorStageNodeId] = useState<string | null>(null)
  const [directorStage3DNodeId, setDirectorStage3DNodeId] = useState<string | null>(null)
  const [videoWorkbenchNodeId, setVideoWorkbenchNodeId] = useState<string | null>(null)
  const [activeOperationPanelNodeId, setActiveOperationPanelNodeId] = useState<string | null>(null)
  const [assetDetailResetKey, setAssetDetailResetKey] = useState(0)
  const canvasViewportControlsRef = useRef<CanvasStageViewportControls | null>(null)
  const pendingCanvasViewportRestoreRef = useRef<Pick<
    CanvasStageViewport,
    'x' | 'y' | 'zoom'
  > | null>(null)
  const canvasViewportRestoreFrameRef = useRef<number | null>(null)
  const pendingImageConnectionRef = useRef<PendingCanvasConnection | null>(null)
  const pendingAssetConnectionRef = useRef<PendingCanvasConnection | null>(null)
  const pendingAssetPositionRef = useRef<CanvasPoint | null>(null)
  const mergingGroupImageIdsRef = useRef(new Set<string>())
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(true)
  const [agentPanelWidth, setAgentPanelWidth] = useState(readAgentPanelWidth)
  /** 用户显式「添加到 Agent 对话」的引用节点；与画布选区解耦，发送时以这里为准 */
  const [agentNodeRefs, setAgentNodeRefs] = useState<CanvasNode[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFilesInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePositionRef = useRef<CanvasPoint | null>(null)
  const activeToolRef = useRef<CanvasTool>('pan')
  const { registerNavGuard, requestConfirm, t, setTweak, setHasUnsavedChanges } = useApp()
  useEffect(() => {
    const prevTheme = t.theme
    if (prevTheme !== 'dark') setTweak('theme', 'dark')
    return () => {
      if (prevTheme !== 'dark') setTweak('theme', prevTheme)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [dirty, setDirty] = useState(() => isCanvasDirty(projectId))
  const [saving, setSaving] = useState(false)
  const [arrangingCanvas, setArrangingCanvas] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => readCanvasAutoSaveEnabled(projectId))
  const [autoSaving, setAutoSaving] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const savingRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSavePendingRef = useRef(false)
  const autoSaveEnabledRef = useRef(autoSaveEnabled)
  const autoSaveLastAtRef = useRef(0)
  // 连续失败次数：达到上限后停止重试；切换 project / 用户重新编辑 / 手动保存成功都会清零。
  const autoSaveFailCountRef = useRef(0)
  const dirtyRef = useRef(dirty)
  const leaveResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)
  const closeGuardInFlightRef = useRef(false)
  const sidePanelStyle = useMemo(
    () =>
      ({
        '--canvas-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`,
        '--canvas-agent-panel-width': agentOpen ? `${agentPanelWidth}px` : '0px',
      }) as CSSProperties,
    [sidePanelCollapsed, sidePanelWidth, agentOpen, agentPanelWidth],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_SIDE_PANEL_WIDTH_KEY, String(sidePanelWidth))
    } catch {
      // Ignore storage failures; the current session still keeps the resized panel.
    }
  }, [sidePanelWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_AGENT_PANEL_WIDTH_KEY, String(agentPanelWidth))
    } catch {
      // Ignore storage failures.
    }
  }, [agentPanelWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_AGENT_PANEL_OPEN_KEY, agentOpen ? '1' : '0')
    } catch {
      // Ignore storage failures.
    }
  }, [agentOpen])

  // 进入「新建空画布」（首次加载即无节点）时强制展开 Agent 面板，方便用户立即开始对话；
  // 已有内容的老画布尊重用户上次的展开/折叠偏好。useLayoutEffect 在浏览器绘制前定稿，避免一帧闪烁。
  useLayoutEffect(() => {
    if (forceExpandAgentOnEmptyCheckedRef.current) return
    if (loading || !snapshot) return
    forceExpandAgentOnEmptyCheckedRef.current = true
    if (snapshot.nodes.length === 0) setAgentOpen(true)
  }, [loading, snapshot])

  useEffect(
    () => () => {
      document.body.classList.remove('canvas-side-panel-resizing')
    },
    [],
  )

  const updateSidePanelWidth = useCallback((width: number) => {
    setSidePanelWidth(Math.round(clampSidePanelWidth(width)))
  }, [])

  const updateAgentPanelWidth = useCallback((width: number) => {
    setAgentPanelWidth(Math.round(clampAgentPanelWidth(width)))
  }, [])

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current != null) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
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

  const handleAgentPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = agentPanelWidth
      const body = document.body
      body.classList.add('canvas-agent-panel-resizing')

      // 用 capture 阶段监听，避免被内部 section 的 stopPropagation 拦截
      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault()
        updateAgentPanelWidth(startWidth + moveEvent.clientX - startX)
      }

      const handlePointerUp = () => {
        body.classList.remove('canvas-agent-panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [agentPanelWidth, updateAgentPanelWidth],
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

  const persistCanvas = useCallback(async (mode: CanvasSaveMode): Promise<CanvasPersistResult> => {
    if (savingRef.current) return 'skipped'
    savingRef.current = true
    setSaving(true)
    if (mode === 'auto') setAutoSaving(true)
    try {
      const ok = await saveCanvas()
      if (ok) {
        if (mode === 'manual') message.success('画布已保存')
        return 'saved'
      }
      if (mode === 'auto') {
        message.error('自动保存失败，请手动保存并查看控制台日志')
      } else {
        message.error('保存失败，请查看控制台日志')
      }
      return 'failed'
    } finally {
      if (mode === 'auto') setAutoSaving(false)
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  const doSave = useCallback(async (): Promise<boolean> => {
    const result = await persistCanvas('manual')
    if (result === 'saved') {
      // 手动保存成功 → 自动保存失败计数清零，下一次自动保存从干净状态开始。
      autoSaveFailCountRef.current = 0
    }
    return result === 'saved'
  }, [persistCanvas])

  const scheduleAutoSave = useCallback(() => {
    clearAutoSaveTimer()
    if (!autoSaveEnabledRef.current || !dirtyRef.current) {
      autoSavePendingRef.current = false
      return
    }
    autoSavePendingRef.current = true
    // 节流：两次成功保存至少间隔 throttle；
    // 失败后退避：1.2s * 2^failCount，上限 30s。
    const throttleRemaining = Math.max(
      0,
      CANVAS_AUTO_SAVE_THROTTLE_MS - (Date.now() - autoSaveLastAtRef.current),
    )
    const failCount = autoSaveFailCountRef.current
    const backoff = Math.min(
      CANVAS_AUTO_SAVE_BACKOFF_MAX_MS,
      CANVAS_AUTO_SAVE_BACKOFF_BASE_MS * Math.pow(2, Math.min(failCount, 6)),
    )
    const delay = Math.max(CANVAS_AUTO_SAVE_DEBOUNCE_MS, throttleRemaining, backoff)
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      void (async () => {
        if (!autoSaveEnabledRef.current || !dirtyRef.current) {
          autoSavePendingRef.current = false
          return
        }
        const startedAt = Date.now()
        const result = await persistCanvas('auto')
        if (result !== 'skipped') {
          autoSaveLastAtRef.current = startedAt
        }
        if (result === 'saved') {
          autoSavePendingRef.current = false
          autoSaveFailCountRef.current = 0
          return
        }
        if (result === 'failed') {
          autoSaveFailCountRef.current = Math.min(
            CANVAS_AUTO_SAVE_MAX_FAILS,
            autoSaveFailCountRef.current + 1,
          )
          // 达到连续失败上限，停止重试，保留 dirty 让用户手动决定。
          if (autoSaveFailCountRef.current >= CANVAS_AUTO_SAVE_MAX_FAILS) {
            autoSavePendingRef.current = false
            message.warning(
              `画布自动保存已连续失败 ${CANVAS_AUTO_SAVE_MAX_FAILS} 次，已暂停自动保存。请手动保存或稍后重试。`,
            )
            return
          }
        }
        if (autoSaveEnabledRef.current && dirtyRef.current) {
          scheduleAutoSave()
        }
      })()
    }, delay)
  }, [clearAutoSaveTimer, persistCanvas])

  const handleAutoSaveToggle = useCallback(
    (enabled: boolean) => {
      autoSaveEnabledRef.current = enabled
      setAutoSaveEnabled(enabled)
      if (!enabled) {
        autoSavePendingRef.current = false
        clearAutoSaveTimer()
      }
      // 重新打开时清零失败计数，避免上次连续失败直接把新开启卡在 MAX 状态。
      autoSaveFailCountRef.current = 0
      message.success(enabled ? '已开启画布自动保存' : '已关闭画布自动保存')
    },
    [clearAutoSaveTimer],
  )

  useEffect(() => {
    clearAutoSaveTimer()
    autoSavePendingRef.current = false
    autoSaveLastAtRef.current = 0
    autoSaveFailCountRef.current = 0
    const enabled = readCanvasAutoSaveEnabled(projectId)
    autoSaveEnabledRef.current = enabled
    setAutoSaveEnabled(enabled)
  }, [projectId, clearAutoSaveTimer])

  useEffect(() => {
    autoSaveEnabledRef.current = autoSaveEnabled
    writeCanvasAutoSaveEnabled(projectId, autoSaveEnabled)
  }, [autoSaveEnabled, projectId])

  useEffect(() => {
    dirtyRef.current = dirty
    // 同步推进到全局，让 beforeunload 能正确拦截真正的未保存状态。
    // 离开画布视图时清回 false，避免脏标志残留阻塞后续退出。
    setHasUnsavedChanges(dirty)
    return () => {
      setHasUnsavedChanges(false)
    }
  }, [dirty, setHasUnsavedChanges])

  useEffect(() => {
    if (!snapshot || !autoSaveEnabled || !dirty) {
      if (!dirty || !autoSaveEnabled) autoSavePendingRef.current = false
      clearAutoSaveTimer()
      return
    }
    scheduleAutoSave()
  }, [autoSaveEnabled, clearAutoSaveTimer, dirty, scheduleAutoSave])

  useEffect(() => clearAutoSaveTimer, [clearAutoSaveTimer])

  // 监听 dirty 变化，刷新「未保存」徽标。
  // dirty 现在是 per-project 的：detail.projectId 为具体项目 id 时按本项目过滤；
  // 为 null（全库级操作，如 hydrate 整库重建）时按「全局是否有任何未落库改动」刷新。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string | null; dirty?: boolean }>).detail
      if (detail?.projectId === null) {
        setDirty(Boolean(detail.dirty))
      } else if (detail?.projectId === projectId) {
        setDirty(Boolean(detail.dirty))
      }
    }
    window.addEventListener('canvas:dirty', handler as EventListener)
    return () => window.removeEventListener('canvas:dirty', handler as EventListener)
  }, [projectId])

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

  // Ctrl / Cmd + \ 切换右侧面板（不在输入框内时；与 Cmd+S 共享同样的修饰键约束风格）
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.shiftKey || event.altKey) return
      if (event.key !== '\\') return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      setSidePanelCollapsed((current) => !current)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 离开确认：返回用户选择（'save' 表示弹窗内已完成落库）
  const askLeave = useCallback((): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      leaveResolveRef.current = resolve
      setLeaveOpen(true)
    })
  }, [])

  // 是否有运行中的画布任务：离开画布会让正在执行的后台任务进度无法回写，需让用户确认风险。
  // 注意只看 running：pending 是「已创建但尚未提交/尚未开始执行」的等待态任务
  // （草稿占位、等待 agent/provider 接入），退出不会中断它们，因此不计入校验。
  const activeCanvasTaskCount = useMemo(
    () => snapshot?.tasks.filter((task) => task.status === 'running').length ?? 0,
    [snapshot?.tasks],
  )

  // 用户确认「继续退出」后，退出前把画布上所有运行中任务自动取消，
  // 避免离开画布后仍残留运行态（结果无法回写）。串行取消以防并发写库竞态，
  // 单个任务取消失败不阻塞退出流程。
  const cancelActiveCanvasTasks = useCallback(async () => {
    const activeTasks = snapshot?.tasks.filter((task) => task.status === 'running') ?? []
    for (const task of activeTasks) {
      try {
        await cancelTask(task.id)
      } catch {
        // 单个任务取消失败不阻塞退出；继续处理剩余任务。
      }
    }
  }, [snapshot?.tasks, cancelTask])

  const confirmLeaveWithActiveTasks = useCallback(async (): Promise<boolean> => {
    if (activeCanvasTaskCount === 0) return true
    const confirmed = await requestConfirm({
      title: '画布仍有运行中的任务',
      description: `当前还有 ${activeCanvasTaskCount} 个正在运行的任务。继续退出将自动取消这些运行中的任务。`,
      confirmText: '继续退出',
      cancelText: '留下等待',
      danger: true,
    })
    if (!confirmed) return false
    // 用户选择继续退出：退出前自动取消所有运行中任务。
    await cancelActiveCanvasTasks()
    return true
  }, [activeCanvasTaskCount, requestConfirm, cancelActiveCanvasTasks])

  // 注册导航守卫：侧边栏切换视图时若有未完成任务或 dirty，交给用户选择是否离开。
  useEffect(() => {
    registerNavGuard(async () => {
      const canLeaveActiveTasks = await confirmLeaveWithActiveTasks()
      if (!canLeaveActiveTasks) return false
      if (!isCanvasDirty(projectId)) return true
      const choice = await askLeave()
      if (choice === 'cancel') return false
      if (choice === 'discard') await revertProject(projectId)
      return true
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, askLeave, projectId, confirmLeaveWithActiveTasks])

  const handleBackWithGuard = useCallback(async () => {
    const canLeaveActiveTasks = await confirmLeaveWithActiveTasks()
    if (!canLeaveActiveTasks) return
    if (!isCanvasDirty(projectId)) {
      await onBack()
      return
    }
    const choice = await askLeave()
    if (choice === 'cancel') return
    if (choice === 'discard') await revertProject(projectId)
    await onBack()
  }, [askLeave, onBack, projectId, confirmLeaveWithActiveTasks])

  useEffect(() => {
    return window.spark.on('stream:canvas-window:close-request', (payload) => {
      if (payload.projectId != null && payload.projectId !== projectId) return
      if (closeGuardInFlightRef.current) return
      closeGuardInFlightRef.current = true
      void handleBackWithGuard().finally(() => {
        closeGuardInFlightRef.current = false
      })
    })
  }, [handleBackWithGuard, projectId])

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

  const snapshotNodeById = useMemo(
    () => new Map((snapshot?.nodes ?? []).map((node) => [node.id, node] as const)),
    [snapshot?.nodes],
  )
  const selectedNodes = useMemo(
    () =>
      selectedNodeIds
        .map((nodeId) => snapshotNodeById.get(nodeId))
        .filter((node): node is CanvasNode => Boolean(node)),
    [selectedNodeIds, snapshotNodeById],
  )
  const aiInputNodes = useMemo(
    () => expandCanvasInputNodes(selectedNodes, snapshot?.nodes ?? []),
    [selectedNodes, snapshot?.nodes],
  )
  const editingNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === editingNodeId) ?? null,
    [editingNodeId, snapshot?.nodes],
  )
  const activeOperationNode = useMemo(
    () =>
      activeOperationPanelNodeId
        ? (snapshot?.nodes.find(
            (node) => node.id === activeOperationPanelNodeId && isOperationNode(node),
          ) ?? null)
        : null,
    [activeOperationPanelNodeId, snapshot?.nodes],
  )
  const inlinePanelNode = activeOperationNode ?? editingNode
  const inlinePanelResourceNode = useMemo(
    () =>
      activeOperationNode && snapshot
        ? resolveCanvasOperationResourceNode(activeOperationNode, snapshot)
        : inlinePanelNode,
    [activeOperationNode, inlinePanelNode, snapshot],
  )
  const inlinePanelNodeId = inlinePanelNode?.id ?? null
  const inlinePanelIsOperation = Boolean(activeOperationNode)
  const [inlineOperationFullscreen, setInlineOperationFullscreen] = useState(false)
  const inlinePanelFocusRequested = inlinePanelFocusRequest?.nodeId === inlinePanelNodeId
  const shouldFocusInlinePanel = shouldFocusCanvasInlinePanel({
    inlinePanelNodeId,
    requestedNodeId: inlinePanelFocusRequest?.nodeId ?? null,
  })
  const inlinePanelPreferredWidth = inlinePanelNode
    ? pickInlineEditorMinWidth(inlinePanelNode, inlinePanelIsOperation)
    : 0
  const inlinePanelFocusPadding = useMemo(
    () => pickInlineEditorFocusPadding(inlinePanelIsOperation),
    [inlinePanelIsOperation],
  )
  const previousTaskStatusRef = useRef<Map<string, CanvasTask['status']> | null>(null)

  useEffect(() => {
    setInlineOperationFullscreen(false)
  }, [inlinePanelNodeId])

  const { viewportRef: canvasViewportRef, onViewportChange: handleCanvasViewportChange } =
    useFloatingViewportGeometry(inlinePanelNode, getFloatingEditorGeometry)

  useEffect(() => {
    const tasks = snapshot?.tasks ?? []
    const nextTaskStatus = new Map(tasks.map((task) => [task.id, task.status] as const))
    const previousTaskStatus = previousTaskStatusRef.current
    previousTaskStatusRef.current = nextTaskStatus
    if (!snapshot || !previousTaskStatus) return

    const newlyFailedTasks = tasks.filter((task) => {
      if (task.status !== 'failed') return false
      const previousStatus = previousTaskStatus.get(task.id)
      return previousStatus != null && previousStatus !== 'failed'
    })
    if (newlyFailedTasks.length === 0) return

    for (const task of newlyFailedTasks) {
      message.error({
        key: `canvas-task-failed:${task.id}`,
        content: canvasTaskFailureMessage(task),
      })
    }
  }, [snapshot])

  useEffect(() => {
    if (!inlinePanelNodeId || !shouldFocusInlinePanel) return undefined
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        canvasViewportControlsRef.current?.focusNodes([inlinePanelNodeId], {
          preferredWidth: inlinePanelPreferredWidth,
          padding: inlinePanelFocusPadding,
          maxZoom: 1.08,
        })
        if (inlinePanelFocusRequested) {
          setInlinePanelFocusRequest((current) =>
            current?.nonce === inlinePanelFocusRequest?.nonce ? null : current,
          )
        }
      })
    })
    return () => {
      if (firstFrame != null) window.cancelAnimationFrame(firstFrame)
      if (secondFrame != null) window.cancelAnimationFrame(secondFrame)
    }
  }, [
    inlinePanelFocusRequest?.nonce,
    inlinePanelFocusRequested,
    inlinePanelNodeId,
    inlinePanelFocusPadding,
    inlinePanelPreferredWidth,
    shouldFocusInlinePanel,
  ])

  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const applyPendingCanvasViewportRestore = useCallback(() => {
    const viewport = pendingCanvasViewportRestoreRef.current
    const controls = canvasViewportControlsRef.current
    if (!viewport || !controls) return false
    controls.setViewport(viewport, { duration: 0 })
    return true
  }, [])

  const restoreCanvasViewport = useCallback(
    (viewport: Pick<CanvasStageViewport, 'x' | 'y' | 'zoom'> | null) => {
      if (!viewport) return
      pendingCanvasViewportRestoreRef.current = {
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      }

      // 先立即取消仍在运行的 focus/fit 动画，再跨两帧覆盖面板收起、任务刷新
      // 和 React Flow 节点重新初始化造成的晚到视口写入。
      applyPendingCanvasViewportRestore()
      if (canvasViewportRestoreFrameRef.current != null) {
        window.cancelAnimationFrame(canvasViewportRestoreFrameRef.current)
      }
      canvasViewportRestoreFrameRef.current = window.requestAnimationFrame(() => {
        applyPendingCanvasViewportRestore()
        canvasViewportRestoreFrameRef.current = window.requestAnimationFrame(() => {
          canvasViewportRestoreFrameRef.current = null
          if (applyPendingCanvasViewportRestore()) {
            pendingCanvasViewportRestoreRef.current = null
          }
        })
      })
    },
    [applyPendingCanvasViewportRestore],
  )

  useEffect(
    () => () => {
      if (canvasViewportRestoreFrameRef.current != null) {
        window.cancelAnimationFrame(canvasViewportRestoreFrameRef.current)
      }
    },
    [],
  )

  const persistCurrentCanvasViewport = useCallback(async () => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) return null
    const controls = canvasViewportControlsRef.current
    const viewport = captureCanvasTaskViewport(controls, canvasViewportRef.current, {
      x: currentSnapshot.board.viewport.x,
      y: currentSnapshot.board.viewport.y,
      zoom: currentSnapshot.board.viewport.zoom,
    })
    await canvasApi.updateViewport(
      projectId,
      { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      currentSnapshot.board.id,
    )
    return viewport
  }, [projectId, canvasViewportRef])

  const panoramaPreviewNode = useMemo(
    () => (panoramaPreviewNodeId ? resolveCanvasResourceActionNode(panoramaPreviewNodeId) : null),
    [panoramaPreviewNodeId, resolveCanvasResourceActionNode],
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
  const selectionContextSummary = useMemo(
    () => summarizeCanvasSelectionContext(selectedNodes),
    [selectedNodes],
  )
  const canCreateGroup = selectionContextSummary.canCreateGroup
  const canAddToGroup = selectionContextSummary.canAddToGroup
  const canRemoveFromGroup = selectionContextSummary.canRemoveFromGroup
  const canDissolveGroup = selectionContextSummary.canDissolveGroup
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
        | 'character-library'
        | 'shot-director'
        | 'agent'
        | 'node-edit'
        | 'asset-detail',
    ) => {
      if (except !== 'inline-ai') setInlineAiOpen(false)
      if (except !== 'operation') setActiveOperationPanelNodeId(null)
      if (except !== 'operation' && except !== 'node-edit') setInlinePanelFocusRequest(null)
      if (except !== 'film-center') setFilmCenterOpen(false)
      if (except !== 'character-library') setCharacterLibraryOpen(false)
      if (except !== 'shot-director') setShotDirectorOpen(false)
      if (except !== 'agent') setAgentOpen(false)
      if (except !== 'node-edit') setEditingNodeId(null)
      if (except !== 'asset-detail') setAssetDetailResetKey((key) => key + 1)
    },
    [],
  )

  // Agent 面板改为 overlay 后不再全局抑制画布手势——面板自身的 pointer-events 会阻挡覆盖区域的交互，
  // 面板之外的画布区域可正常平移/缩放。仅阻止拖拽文件落到面板下方的画布区域。
  const suppressCanvasGestureWhileAgentOpen = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | ReactDragEvent<HTMLDivElement>) => {
      if (!agentOpen) return
      if (!('dataTransfer' in event)) return
      const target = event.target
      if (target instanceof Element && target.closest('.canvas-agent-panel')) return
      event.stopPropagation()
      event.preventDefault()
    },
    [agentOpen],
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
      if (characterSubviewEditorNodeId) return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      togglePointerTool()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (toolSwitchHintTimerRef.current != null) clearTimeout(toolSwitchHintTimerRef.current)
    }
  }, [characterSubviewEditorNodeId, togglePointerTool])

  const handleSelectionChange = useCallback(
    (nodeIds: string[]) => {
      const lockedInlinePanelNodeId = activeOperationPanelNodeId ?? editingNodeId
      if (nodeIds.length === 0 && lockedInlinePanelNodeId) {
        setSelectedNodeIds((previousIds) =>
          areNodeIdsEqual(previousIds, [lockedInlinePanelNodeId])
            ? previousIds
            : [lockedInlinePanelNodeId],
        )
        return
      }
      // React Flow 已在 CanvasStage 内同步提交视觉选中态；属性面板等父层派生
      // 更新可降低优先级，避免大型画布在 pointer-down 首帧重渲染整个工作区。
      startTransition(() => {
        setSelectedNodeIds((previousIds) =>
          areNodeIdsEqual(previousIds, nodeIds) ? previousIds : nodeIds,
        )
        setActiveOperationPanelNodeId((currentId) =>
          currentId && nodeIds.length === 1 && nodeIds[0] === currentId ? currentId : null,
        )
        setEditingNodeId((currentId) =>
          currentId && nodeIds.length === 1 && nodeIds[0] === currentId ? currentId : null,
        )
      })
    },
    [activeOperationPanelNodeId, editingNodeId],
  )

  const handleNodeSelectIntent = useCallback(
    (nodeId: string) => {
      // 从 ref 读取最新节点，避免把 snapshot?.nodes 放进依赖导致引用抖动
      // （否则每次 snapshot 变更都会让 nodeActions memo 失效，连带所有可见节点重渲染）
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (!node) return

      if (activeOperationPanelNodeId === nodeId || editingNodeId === nodeId) return
      closeCanvasFloatPanels()
    },
    [activeOperationPanelNodeId, closeCanvasFloatPanels, editingNodeId],
  )

  const handleCanvasViewportControlsChange = useCallback(
    (controls: CanvasStageViewportControls | null) => {
      canvasViewportControlsRef.current = controls
      if (!controls || !pendingCanvasViewportRestoreRef.current) return

      // 节点快照刷新会令 CanvasStage 短暂注销控制器；恢复请求不能因此丢失。
      // 若跨帧恢复已结束，则这次重新注册就是最后的可靠恢复点。
      const restored = applyPendingCanvasViewportRestore()
      if (restored && canvasViewportRestoreFrameRef.current == null) {
        pendingCanvasViewportRestoreRef.current = null
      }
    },
    [applyPendingCanvasViewportRestore],
  )

  const handleFitCanvasView = useCallback(() => {
    canvasViewportControlsRef.current?.fitView()
  }, [])

  const handleCenterSelectedNode = useCallback(() => {
    if (selectedNodeIds.length === 0) {
      message.info('请先选择一个节点')
      return
    }
    const centered = canvasViewportControlsRef.current?.centerNodes(selectedNodeIds)
    if (!centered) message.warning('未找到选中节点')
  }, [selectedNodeIds])

  const handleArrangeCanvas = useCallback(
    async (options: { mode: CanvasAutoLayoutMode; spacing: CanvasAutoLayoutSpacing }) => {
      const controls = canvasViewportControlsRef.current
      if (!controls) {
        message.warning('画布仍在初始化，请稍后重试')
        return
      }
      setArrangingCanvas(true)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      try {
        const partialLayout = selectedNodeIds.length > 1
        const arranged = await controls.arrangeNodes({
          ...options,
          ...(partialLayout ? { nodeIds: selectedNodeIds } : {}),
        })
        if (!arranged) {
          message.info('没有可整理的节点')
          return
        }
        message.success(
          partialLayout ? `已整理所选 ${selectedNodeIds.length} 个节点` : '已整理全画布',
        )
      } catch (error) {
        message.error(error instanceof Error ? error.message : '整理画布失败')
      } finally {
        setArrangingCanvas(false)
      }
    },
    [selectedNodeIds],
  )

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
          ? '删除后可通过底栏「撤销」恢复，相关连线会同步清理。'
          : '删除后可通过底栏「撤销」恢复这些节点，相关连线会同步清理。',
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
          message.success(
            nodeIds.length === 1 ? '已删除节点，可撤销' : `已删除 ${nodeIds.length} 个节点，可撤销`,
          )
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除节点失败')
          throw error
        }
      },
    })
  }, [closeCanvasFloatPanels, deleteNodes, selectedNodes])

  /** 右键「添加到 Agent 对话」：把当前选中节点去重合并进引用列表，并自动展开 Agent 面板 */
  const handleAddSelectedToAgent = useCallback(() => {
    if (selectedNodes.length === 0) return
    // 先关掉其他浮层但放过 agent（与 onOpenAgent 一致），避免菜单关闭流程里的
    // closeCanvasFloatPanels() 把刚 setAgentOpen(true) 的面板又关回去。
    closeCanvasFloatPanels('agent')
    setAgentNodeRefs((prev) => {
      const existing = new Set(prev.map((node) => node.id))
      const merged = [...prev]
      for (const node of selectedNodes) {
        if (!existing.has(node.id)) {
          merged.push(node)
          existing.add(node.id)
        }
      }
      return merged
    })
    setAgentOpen(true)
  }, [closeCanvasFloatPanels, selectedNodes])

  /** 单节点右键「添加到 Agent 对话」：把指定节点合并进引用列表并展开 Agent 面板。
   *  即使节点一时找不到（snapshot 尚未刷新），也保证面板展开，给用户即时反馈。 */
  const handleAddNodeToAgent = useCallback(
    (nodeId: string) => {
      // 同上：先以 'agent' 例外关闭其他浮层，确保面板稳定展开。
      closeCanvasFloatPanels('agent')
      setAgentOpen(true)
      const node =
        snapshotNodeById.get(nodeId) ?? snapshotRef.current?.nodes.find((n) => n.id === nodeId)
      if (!node) return
      setAgentNodeRefs((prev) => {
        if (prev.some((item) => item.id === nodeId)) return prev
        return [...prev, node]
      })
    },
    [closeCanvasFloatPanels, snapshotNodeById],
  )

  /** 宽屏切换：展开到屏幕一半宽度 / 恢复之前的宽度 */
  const agentPrevWidthRef = useRef(CANVAS_AGENT_PANEL_DEFAULT_WIDTH)
  const handleAgentWideMode = useCallback(
    (wide: boolean) => {
      if (wide) {
        agentPrevWidthRef.current = agentPanelWidth
        const halfScreen = Math.floor(window.innerWidth / 2)
        updateAgentPanelWidth(Math.min(halfScreen, CANVAS_AGENT_PANEL_MAX_WIDTH))
      } else {
        updateAgentPanelWidth(agentPrevWidthRef.current)
      }
    },
    [agentPanelWidth, updateAgentPanelWidth],
  )

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      void duplicateNodes([nodeId])
    },
    [duplicateNodes],
  )

  const handleToggleLockNode = useCallback(
    (nodeId: string) => {
      // 从 ref 读取，避免 snapshot?.nodes 引用抖动传导到 nodeActions（导致全节点重渲染）
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (!node) return
      void patchNodes([nodeId], { locked: !node.locked })
    },
    [patchNodes],
  )

  const handleBringNodeToFront = useCallback(
    (nodeId: string) => {
      const nodes = snapshotRef.current?.nodes ?? []
      const maxZ = Math.max(0, ...nodes.map((node) => node.zIndex))
      void patchNodes([nodeId], { zIndex: maxZ + 1 })
    },
    [patchNodes],
  )

  const handleMergeGroupToImage = useCallback(
    async (groupId: string, sourceSnapshot?: typeof snapshot) => {
      if (mergingGroupImageIdsRef.current.has(groupId)) {
        message.info('正在合成该组，请稍候')
        return
      }

      const currentSnapshot = sourceSnapshot ?? snapshotRef.current ?? snapshot
      const groupNode = currentSnapshot?.nodes.find(
        (node) => node.id === groupId && node.type === 'group',
      )
      if (!currentSnapshot || !groupNode) return
      const childNodes = collectGroupDescendantNodes(currentSnapshot.nodes, groupId)
      if (childNodes.length === 0) {
        message.warning('组内没有可合成的节点')
        return
      }
      const contentNodes = childNodes.filter((node) => node.type !== 'group')
      if (contentNodes.length === 0) {
        message.warning('组内没有可合成的内容节点')
        return
      }

      const stageElement = document.querySelector<HTMLElement>('.canvas-stage-area')
      const contentElements = contentNodes
        .map((node) =>
          document.querySelector<HTMLElement>(`[data-canvas-node-id="${cssEscape(node.id)}"]`),
        )
        .filter((element): element is HTMLElement => Boolean(element))

      if (!stageElement || contentElements.length === 0) {
        message.error('无法定位组内内容区，请稍后重试')
        return
      }

      const stageRect = stageElement.getBoundingClientRect()
      const unionRect = contentElements.reduce(
        (rect, element) => {
          const current = element.getBoundingClientRect()
          return {
            left: Math.min(rect.left, current.left),
            top: Math.min(rect.top, current.top),
            right: Math.max(rect.right, current.right),
            bottom: Math.max(rect.bottom, current.bottom),
          }
        },
        { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: 0, bottom: 0 },
      )

      const padding = 12
      const cropX = Math.max(0, Math.floor(unionRect.left - stageRect.left - padding))
      const cropY = Math.max(0, Math.floor(unionRect.top - stageRect.top - padding))
      const cropWidth = Math.min(
        Math.ceil(unionRect.right - unionRect.left + padding * 2),
        Math.floor(stageRect.width - cropX),
      )
      const cropHeight = Math.min(
        Math.ceil(unionRect.bottom - unionRect.top + padding * 2),
        Math.floor(stageRect.height - cropY),
      )

      if (cropWidth <= 0 || cropHeight <= 0) {
        message.error('组节点当前不在可截图区域内，请先移动视图后再合成')
        return
      }

      mergingGroupImageIdsRef.current.add(groupId)
      const closeLoading = message.loading('正在合成组内内容，请稍候…', 0)
      await nextFrame()

      const hideElements = Array.from(
        stageElement.querySelectorAll<HTMLElement>(
          '.react-flow__controls, .canvas-minimap, .canvas-alignment-guides, .canvas-edge-delete-button',
        ),
      )
      const previousVisibility = hideElements.map((element) => element.style.visibility)
      hideElements.forEach((element) => {
        element.style.visibility = 'hidden'
      })

      // html2canvas 1.4.1 无法解析 color()/oklch()/color-mix() 等现代颜色函数，
      // 先把这些计算样式临时降级成 rgb()/rgba()，截图完成后再还原，避免抛错。
      const restoreColors = normalizeColorsForHtml2Canvas(stageElement)
      try {
        const { default: html2canvas } = await import('html2canvas')
        const renderedCanvas = await html2canvas(stageElement, {
          backgroundColor: null,
          useCORS: true,
          allowTaint: false,
          logging: false,
          onclone: (clonedDocument) => {
            const clonedStageElement =
              clonedDocument.querySelector<HTMLElement>('.canvas-stage-area')
            const clonedWindow = clonedDocument.defaultView
            if (clonedStageElement && clonedWindow) {
              clonedStageElement.classList.add('canvas-stage-snapshot-content-only')
              normalizeColorsForHtml2Canvas(clonedStageElement, clonedWindow)
            }
          },
          scale: Math.min(4, Math.max(2.5, window.devicePixelRatio || 1)),
        })
        const scaleX = renderedCanvas.width / stageRect.width
        const scaleY = renderedCanvas.height / stageRect.height
        const outputCanvas = document.createElement('canvas')
        outputCanvas.width = Math.max(1, Math.round(cropWidth * scaleX))
        outputCanvas.height = Math.max(1, Math.round(cropHeight * scaleY))
        const context = outputCanvas.getContext('2d')
        if (!context) throw new Error('无法创建合成画布')
        context.drawImage(
          renderedCanvas,
          Math.round(cropX * scaleX),
          Math.round(cropY * scaleY),
          outputCanvas.width,
          outputCanvas.height,
          0,
          0,
          outputCanvas.width,
          outputCanvas.height,
        )

        const dataUrl = outputCanvas.toDataURL('image/png')
        const file = dataUrlToFile(
          dataUrl,
          buildCanvasSnapshotFileName(groupNode.title ?? undefined),
        )
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          mimeType: 'image/png',
          suggestedBaseName: file.name.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(currentSnapshot.project.rootPath
            ? { projectRootPath: currentSnapshot.project.rootPath }
            : {}),
        })
        const imageNode = await createImageNode({
          file,
          filePath: savedImage.filePath,
          x: Math.round(groupNode.x + groupNode.width + 96),
          y: Math.round(groupNode.y),
          ...fitImageNodeSize(outputCanvas.width, outputCanvas.height),
          imageWidth: outputCanvas.width,
          imageHeight: outputCanvas.height,
        })
        if (imageNode) {
          await patchNodes([imageNode.id], { title: `${groupNode.title ?? '组'} 合成图` })
          await connectNodes({ sourceNodeId: groupNode.id, targetNodeId: imageNode.id })
          setSelectedNodeIds([imageNode.id])
        }
        closeLoading()
        message.success('已在组右侧生成内容合成图节点，并连接来源组')
      } catch (error) {
        console.error('[canvas] merge group to image failed', error)
        closeLoading()
        message.error(
          error instanceof Error
            ? `合成图失败：${error.message}`
            : '合成图失败，请检查组内图片是否可访问',
        )
      } finally {
        restoreColors?.()
        hideElements.forEach((element, index) => {
          element.style.visibility = previousVisibility[index] ?? ''
        })
        mergingGroupImageIdsRef.current.delete(groupId)
      }
    },
    [connectNodes, createImageNode, patchNodes, snapshot],
  )

  const handleCreateGroup = useCallback(() => {
    if (selectedTopLevelNodes.length < 2) return
    void createGroupNode(selectedTopLevelNodes.map((node) => node.id))
  }, [createGroupNode, selectedTopLevelNodes])

  const handleMergeSelectionToImage = useCallback(async () => {
    const summary = summarizeCanvasSelectionContext(selectedNodes)
    if (summary.mergeGroupId) {
      await handleMergeGroupToImage(summary.mergeGroupId)
      return
    }
    if (!summary.canCreateGroup) {
      message.warning('请选择多个未入组的内容节点，或选择一个组节点')
      return
    }

    const nextSnapshot = await createGroupNode(summary.topLevelNodeIds)
    const groupNode = findGroupContainingNodes(nextSnapshot.nodes, summary.topLevelNodeIds)
    if (!groupNode) {
      message.warning('已创建组，但未能定位新组节点，请选中组后再次合成')
      return
    }
    setSelectedNodeIds([groupNode.id])
    await nextFrame()
    await handleMergeGroupToImage(groupNode.id, nextSnapshot)
  }, [createGroupNode, handleMergeGroupToImage, selectedNodes])

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
      // 从 ref 读取，避免 snapshot?.nodes 引用抖动传导到 nodeActions（导致全节点重渲染）
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (node && isOperationNode(node)) {
        closeCanvasFloatPanels('operation')
        setInlinePanelFocusRequest({ nodeId, nonce: Date.now() })
        setSelectedNodeIds([nodeId])
        setActiveOperationPanelNodeId(nodeId)
        return
      }
      if (node?.data.subtype === 'director_stage') {
        closeCanvasFloatPanels('node-edit')
        setSelectedNodeIds([nodeId])
        setDirectorStageNodeId(nodeId)
        return
      }
      if (node?.data.subtype === 'director_stage_3d') {
        closeCanvasFloatPanels('node-edit')
        setSelectedNodeIds([nodeId])
        setDirectorStage3DNodeId(nodeId)
        return
      }
      if (node?.data.subtype === 'video_workbench') {
        closeCanvasFloatPanels('node-edit')
        setSelectedNodeIds([nodeId])
        setVideoWorkbenchNodeId(nodeId)
        return
      }
      // 普通视频节点双击 → 直接打开视频工作台（源视频就是该节点本身）
      if (node?.type === 'video' && typeof node.data.url === 'string') {
        closeCanvasFloatPanels('node-edit')
        setSelectedNodeIds([nodeId])
        setVideoWorkbenchNodeId(nodeId)
        return
      }
      closeCanvasFloatPanels('node-edit')
      setInlinePanelFocusRequest({ nodeId, nonce: Date.now() })
      setSelectedNodeIds([nodeId])
      setEditingNodeId(nodeId)
    },
    [closeCanvasFloatPanels],
  )

  // 视频节点的「视频编辑」入口（由右键菜单触发，打开视频工作台）。
  // 覆盖：普通视频节点 / video_workbench 节点 / 视频操作节点的产物视频。
  // 对操作节点用 resolveCanvasOperationResourceNode 解析主产物（与菜单显示条件、
  // handlePreviewPanorama/handleDownloadMediaNode 的解析方式一致）。
  const handleEditVideo = useCallback(
    (nodeId: string) => {
      const snap = snapshotRef.current
      if (!snap) return
      const node = snap.nodes.find((item) => item.id === nodeId)
      if (!node) return

      // 统一解析：操作节点取其主产物资源节点，非操作节点取自身
      const resolved = isOperationNode(node) ? resolveCanvasOperationResourceNode(node, snap) : node
      const target = resolved ?? node

      // 目标是视频节点或有视频 url → 打开工作台
      if (
        target.type === 'video' ||
        target.data.subtype === 'video_workbench' ||
        (typeof target.data.url === 'string' && target.data.url)
      ) {
        closeCanvasFloatPanels('node-edit')
        setSelectedNodeIds([target.id])
        setVideoWorkbenchNodeId(target.id)
        return
      }

      message.warning('该节点没有可编辑的视频内容')
    },
    [closeCanvasFloatPanels],
  )

  // 360 全景产物节点的「全景预览」入口（由右键菜单触发，与「编辑」解耦）。
  const handlePreviewPanorama = useCallback(
    (nodeId: string) => {
      // 从 ref 读取，避免 snapshot 引用抖动传导到 nodeActions
      const currentSnapshot = snapshotRef.current
      if (!currentSnapshot) return
      const node = currentSnapshot.nodes.find((item) => item.id === nodeId)
      if (!node) return
      const resolved = isOperationNode(node)
        ? resolveCanvasOperationResourceNode(node, currentSnapshot)
        : node
      if (!resolved?.data.panorama360) {
        message.warning('当前节点没有可预览的全景图内容')
        return
      }
      closeCanvasFloatPanels('node-edit')
      setSelectedNodeIds([nodeId])
      setPanoramaPreviewNodeId(nodeId)
    },
    [closeCanvasFloatPanels],
  )

  const handleOpenCharacterSubviewEditorFromNode = useCallback(
    (nodeId: string) => {
      // 从 ref 读取，避免 snapshot 引用抖动传导到 nodeActions
      const currentSnapshot = snapshotRef.current
      if (!currentSnapshot) return
      const node = currentSnapshot.nodes.find((item) => item.id === nodeId)
      if (!node) return
      const resolved = isOperationNode(node)
        ? resolveCanvasOperationResourceNode(node, currentSnapshot)
        : node
      if (!resolved?.assetId) {
        message.warning('当前节点没有可裁切的图片资源')
        return
      }
      const sourceImageAsset =
        currentSnapshot.assets.find(
          (item) => item.id === resolved.assetId && item.type === 'image',
        ) ?? null
      if (!sourceImageAsset) {
        message.warning('当前节点没有可用的图片资源')
        return
      }
      closeCanvasFloatPanels()
      setSelectedNodeIds([nodeId])
      setCharacterSubviewEditorNodeId(nodeId)
    },
    [closeCanvasFloatPanels],
  )

  const handleDownloadMediaNode = useCallback(async (nodeId: string) => {
    // 从 ref 读取，避免 snapshot/resolveCanvasResourceActionNode 引用抖动传导到 nodeActions
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) return
    const node = currentSnapshot.nodes.find((item) => item.id === nodeId)
    if (!node) return
    const resolved = isOperationNode(node)
      ? resolveCanvasOperationResourceNode(node, currentSnapshot)
      : node
    if (!resolved || (!isCanvasImageContentNode(resolved) && resolved.type !== 'video')) {
      message.warning('当前节点没有可下载的图片或视频内容')
      return
    }
    const linkedAsset = resolved.assetId
      ? (currentSnapshot.assets.find((item) => item.id === resolved.assetId) ?? null)
      : null
    await downloadCanvasResource({
      id: linkedAsset?.id ?? resolved.id,
      type: linkedAsset?.type ?? (resolved.type === 'video' ? 'video' : 'image'),
      title: linkedAsset?.title ?? resolved.title ?? null,
      mimeType: linkedAsset?.mimeType ?? resolved.data.mimeType ?? null,
      storageKey: linkedAsset?.storageKey ?? null,
      url: resolved.data.url ?? linkedAsset?.url ?? null,
      thumbnailUrl: resolved.data.thumbnailUrl ?? linkedAsset?.thumbnailUrl ?? null,
      contentText: linkedAsset?.contentText ?? null,
    })
  }, [])

  const handleSaveNodeEdit = useCallback(
    async (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => {
      await patchNodes([node.id], patch)
      await updateNodeData(node.id, data)
      setEditingNodeId(null)
    },
    [patchNodes, updateNodeData],
  )

  const handleSetOperationPrimaryOutput = useCallback(
    async (operationNodeId: string, output: CanvasOperationOutputView) => {
      await updateNodeData(operationNodeId, {
        primaryOutputId: output.id,
        primaryOutputSelection: 'manual',
      })
      message.success(output.type === 'text' ? '已设为默认预览产物' : '已设为主产物')
    },
    [updateNodeData],
  )

  const handleDeleteOperationOutputs = useCallback(
    async (operationNodeId: string, outputs: CanvasOperationOutputView[]) => {
      const current = snapshotRef.current
      if (!current || outputs.length === 0) return
      const plan = planCanvasOperationOutputDeletion({
        operationNodeId,
        outputs,
        edges: current.edges,
      })
      if (plan.nodeIds.length === 0) {
        message.warning('所选产物没有可删除的画布节点')
        return
      }

      await deleteEdges(plan.edgeIds)
      await deleteNodes(plan.nodeIds)
      if (plan.skippedOutputIds.length > 0) {
        message.warning(
          `已删除 ${plan.nodeIds.length} 个产物，另有 ${plan.skippedOutputIds.length} 个未关联画布节点，已跳过`,
        )
        return
      }
      message.success(
        plan.nodeIds.length === 1
          ? '已删除产物节点'
          : `已删除 ${plan.nodeIds.length} 个产物节点`,
      )
    },
    [deleteEdges, deleteNodes],
  )

  const handleExpandOperationOutputs = useCallback(
    async (operationNodeId: string, outputs: CanvasOperationOutputView[]) => {
      const current = snapshotRef.current
      if (!current || outputs.length === 0) return
      const operationNode = current.nodes.find(
        (node) => node.id === operationNodeId && isOperationNode(node),
      )
      if (!operationNode) return
      const plan = planCanvasOperationOutputMaterialization({
        operationNode,
        outputs,
        existingNodes: current.nodes,
      })
      const materializedNodeIds = [...plan.existingNodeIds]
      const createdNodeIds: string[] = []

      for (const item of plan.items) {
        if (!item.output.assetId) continue
        const created = await insertAsset({
          assetId: item.output.assetId,
          boardId: current.board.id,
          x: item.x,
          y: item.y,
        })
        if (!created) continue
        await updateNodeData(created.id, {
          origin: 'asset',
          ...(item.output.pipelineRole ? { pipelineRole: item.output.pipelineRole } : {}),
          ...(item.output.productionState ? { productionState: item.output.productionState } : {}),
          ...(item.output.panorama360 ? { panorama360: item.output.panorama360 } : {}),
          materializedOutput: {
            operationNodeId,
            outputId: item.output.id,
            materializedAt: new Date().toISOString(),
          },
        })
        await connectNodes({
          sourceNodeId: operationNodeId,
          targetNodeId: created.id,
          type: 'references',
        })
        materializedNodeIds.push(created.id)
        createdNodeIds.push(created.id)
      }

      if (plan.unsupportedOutputIds.length > 0) {
        message.warning(`${plan.unsupportedOutputIds.length} 个产物尚未关联资产，暂不能展开`)
      }
      if (materializedNodeIds.length > 0) {
        setSelectedNodeIds(materializedNodeIds)
        requestAnimationFrame(() => {
          canvasViewportControlsRef.current?.focusNodes(materializedNodeIds, {
            padding: { top: 96, right: 96, bottom: 96, left: 96 },
            maxZoom: 1,
          })
        })
        message.success(
          plan.items.length > 0
            ? `已展开 ${plan.items.length} 个资产引用节点`
            : '这些产物已经在画布中展开',
        )
      }
    },
    [connectNodes, insertAsset, updateNodeData],
  )

  const handleExpandOperationOutputScope = useCallback(
    (operationNodeId: string, scope: 'primary' | 'latest_run' | 'all') => {
      const current = snapshotRef.current
      if (!current) return
      const operationNode = current.nodes.find(
        (node) => node.id === operationNodeId && isOperationNode(node),
      )
      if (!operationNode) return
      const runs = buildCanvasOperationRunViews(operationNode, current)
      const outputState = resolveCanvasOperationOutputState(operationNode, runs)
      const outputs =
        scope === 'primary'
          ? outputState.primaryOutput
            ? [outputState.primaryOutput]
            : []
          : scope === 'latest_run'
            ? (runs.find((run) => run.outputs.length > 0)?.outputs ?? [])
            : selectCanvasOperationOutputs(runs, { scope: 'all' })
      void handleExpandOperationOutputs(operationNodeId, outputs)
    },
    [handleExpandOperationOutputs],
  )

  const handleExpandLatestOperationOutputs = useCallback(
    (operationNodeId: string) => {
      handleExpandOperationOutputScope(operationNodeId, 'latest_run')
    },
    [handleExpandOperationOutputScope],
  )

  const createPanoramaCaptureNode = useCallback(
    async (
      dataUrl: string,
      sourceNode: CanvasNode,
      pose: { yaw: number; pitch: number; fov: number },
      options: {
        title: string
        message: string
        suggestedBaseName: string
        cropped: boolean
        successMessage: string
      },
    ) => {
      if (!snapshot) return
      const dimensions = await readImageDimensions(dataUrl)
      // 不能用 fetch(dataUrl)：CSP 的 connect-src 不含 data:，会抛 Failed to fetch。
      const file = dataUrlToFile(dataUrl, `${options.suggestedBaseName}-${Date.now()}.png`)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl,
        mimeType: 'image/png',
        suggestedBaseName: options.suggestedBaseName,
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const node = await createImageNode({
        file,
        filePath: savedImage.filePath,
        x: sourceNode.x + sourceNode.width + 60,
        y: sourceNode.y,
        ...fitImageNodeSize(dimensions.width, dimensions.height),
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      })
      if (node) {
        await patchNodes([node.id], { title: options.title })
        await updateNodeData(node.id, {
          ...node.data,
          message: options.message,
          modelParams: {
            ...(node.data.modelParams ?? {}),
            panoramaViewport: {
              sourceNodeId: sourceNode.id,
              yaw: pose.yaw,
              pitch: pose.pitch,
              fov: pose.fov,
              cropped: options.cropped,
              capturedAt: new Date().toISOString(),
            },
          },
        })
        await connectNodes({ sourceNodeId: sourceNode.id, targetNodeId: node.id })
        setSelectedNodeIds([node.id])
        message.success(options.successMessage)
      }
    },
    [connectNodes, createImageNode, patchNodes, snapshot, updateNodeData],
  )

  const handlePanoramaScreenshot = useCallback(
    (dataUrl: string, sourceNode: CanvasNode, pose: { yaw: number; pitch: number; fov: number }) =>
      createPanoramaCaptureNode(dataUrl, sourceNode, pose, {
        title: '全景视口截图',
        message: '从 360 全景预览当前视口截图生成',
        suggestedBaseName: 'panorama-viewport',
        cropped: false,
        successMessage: '已从当前全景视口生成场景图片节点',
      }),
    [createPanoramaCaptureNode],
  )

  const handlePanoramaCrop = useCallback(
    (dataUrl: string, sourceNode: CanvasNode, pose: { yaw: number; pitch: number; fov: number }) =>
      createPanoramaCaptureNode(dataUrl, sourceNode, pose, {
        title: '全景框选截图',
        message: '从 360 全景预览框选区域截图生成',
        suggestedBaseName: 'panorama-crop',
        cropped: true,
        successMessage: '已从框选区域生成场景图片节点',
      }),
    [createPanoramaCaptureNode],
  )

  // ─── 节点创建动作（useCallback，必须在 early return 之前）────────────────
  // 这些被 handleAddNodeItem / Stage / BottomDock 等多处引用，统一在 hooks 区定义。
  const addText = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, TEXT_NODE_DEFAULT_SIZE, {
            x: 140,
            y: 120,
          })
      return createTextNode({
        text: '双击打开右侧编辑器，输入文案、剧情段落或生成提示词。',
        x: position.x,
        y: position.y,
      })
    },
    [createTextNode],
  )

  const addPrompt = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, TEXT_NODE_DEFAULT_SIZE, {
            x: 140,
            y: 120,
          })
      return createTextNode({
        kind: 'prompt',
        text: '',
        x: position.x,
        y: position.y,
      })
    },
    [createTextNode],
  )

  const handleSplitStoryboard = useCallback(
    async (nodeId: string) => {
      const current = snapshotRef.current
      const requestedNode = current?.nodes.find((item) => item.id === nodeId)
      if (!current || !requestedNode) return
      const primaryOutput = isOperationNode(requestedNode)
        ? resolveCanvasOperationOutputState(
            requestedNode,
            buildCanvasOperationRunViews(requestedNode, current),
          ).primaryOutput
        : null
      const source = resolveStoryboardSplitSourceNode(requestedNode, primaryOutput)
      if (!source) {
        message.warning('没有解析到可拆分的分镜')
        return
      }
      const created = await splitStoryboardNode({
        source,
        allNodes: current.nodes,
        createTextNode,
        patchNodes,
        connectNodes,
      })
      if (created.length === 0) {
        message.warning('没有解析到可拆分的分镜')
        return
      }
      setSelectedNodeIds(created.map((item) => item.id))
      message.success(`已拆分为 ${created.length} 个分镜节点`)
    },
    [connectNodes, createTextNode, patchNodes],
  )

  const addDirectorStage = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
            x: 160,
            y: 140,
          })
      const node = await createTextNode({
        text: '2D 导演台：双击打开画面编排空间。',
        x: position.x,
        y: position.y,
      })
      if (!node) return
      await patchNodes([node.id], {
        title: '2D 导演台',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
      })
      await updateNodeData(node.id, {
        ...node.data,
        subtype: 'director_stage',
        displayCategory: 'content',
        directorStage: createDefaultDirectorStageData() as unknown as Record<string, unknown>,
        text: '2D 导演台：双击打开画面编排空间。',
      })
      setSelectedNodeIds([node.id])
      setDirectorStageNodeId(node.id)
      return node
    },
    [createTextNode, patchNodes, updateNodeData],
  )

  const addDirectorStage3D = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
            x: 180,
            y: 160,
          })
      const node = await createTextNode({
        text: '3D 导演台：双击打开三维编排空间。',
        x: position.x,
        y: position.y,
      })
      if (!node) return
      await patchNodes([node.id], {
        title: '3D 导演台',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
      })
      await updateNodeData(node.id, {
        ...node.data,
        subtype: 'director_stage_3d',
        displayCategory: 'content',
        stage3d: createDefaultStage3DData() as unknown as Record<string, unknown>,
        text: '3D 导演台：双击打开三维编排空间。',
      })
      setSelectedNodeIds([node.id])
      setDirectorStage3DNodeId(node.id)
      return node
    },
    [createTextNode, patchNodes, updateNodeData],
  )

  const addVideoWorkbench = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
            x: 180,
            y: 160,
          })
      // 若当前选中节点是视频，自动绑定为其源视频
      const selected = snapshot?.nodes.find((n) => selectedNodeIds.includes(n.id))
      const sourceVideoUrl =
        selected && selected.type === 'video' && typeof selected.data.url === 'string'
          ? (selected.data.url as string)
          : undefined
      const sourceVideoAssetId = sourceVideoUrl ? (selected?.assetId ?? undefined) : undefined
      const node = await createTextNode({
        text: sourceVideoUrl
          ? '视频工作台：双击打开，提取关键帧、剪辑、转码。'
          : '视频工作台：双击打开。请拖入视频或关联视频节点。',
        x: position.x,
        y: position.y,
      })
      if (!node) return
      await patchNodes([node.id], {
        title: sourceVideoUrl ? `视频工作台 — ${selected?.title ?? '视频'}` : '视频工作台',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
      })
      const wbData = createDefaultVideoWorkbenchData()
      if (sourceVideoAssetId) wbData.sourceVideoAssetId = sourceVideoAssetId
      await updateNodeData(node.id, {
        ...node.data,
        subtype: 'video_workbench',
        displayCategory: 'content',
        ...(sourceVideoUrl ? { url: sourceVideoUrl } : {}),
        videoWorkbench: wbData as unknown as Record<string, unknown>,
        text: sourceVideoUrl
          ? '视频工作台：双击打开，提取关键帧、剪辑、转码。'
          : '视频工作台：双击打开。请拖入视频或关联视频节点。',
      })
      setSelectedNodeIds([node.id])
      setVideoWorkbenchNodeId(node.id)
      return node
    },
    [createTextNode, patchNodes, updateNodeData, snapshot, selectedNodeIds],
  )

  const uploadFirstImage = useCallback(
    (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
      pendingImageConnectionRef.current = pendingConnection ?? null
      pendingImagePositionRef.current = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : null
      fileInputRef.current?.click()
    },
    [],
  )

  const handleInsertAsset = useCallback(
    async (assetId: string) => {
      if (!snapshot) return
      const pendingPosition = pendingAssetPositionRef.current
      const pendingConnection = pendingAssetConnectionRef.current
      pendingAssetPositionRef.current = null
      pendingAssetConnectionRef.current = null
      // 影视资产插入后打上流水线角色，使画布右键出现「下一步」编排动作（设计 §7）
      const asset = snapshot.assets.find((item) => item.id === assetId)
      // 用资产真实类型/尺寸拟合节点尺寸，保证居中落点与最终节点尺寸一致
      // （之前固定用 IMAGE_NODE_DEFAULT_SIZE，视频/文本资产会偏出视口中心）
      const nodeSize = asset ? resolveAssetInsertSize(asset) : IMAGE_NODE_DEFAULT_SIZE
      const position = pendingPosition
        ? { x: Math.round(pendingPosition.x), y: Math.round(pendingPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, nodeSize, {
            x: 220,
            y: 180,
          })
      const node = await insertAsset({
        assetId,
        boardId: snapshot.board.id,
        x: position.x,
        y: position.y,
      })
      const role = asset ? filmKindToPipelineRole(readAssetKind(asset)) : undefined
      if (node && role) {
        await updateNodeData(node.id, { pipelineRole: role })
      }
      if (node && pendingConnection) {
        await connectNodes({ sourceNodeId: pendingConnection.sourceNodeId, targetNodeId: node.id })
      }
      message.success('已插入资产到当前视口')
      return node
    },
    [connectNodes, insertAsset, snapshot, updateNodeData],
  )

  const handleInsertCharacterImage = useCallback(
    async (assetId: string) => {
      await handleInsertAsset(assetId)
    },
    [handleInsertAsset],
  )

  const handleApplyCharacterSubview = useCallback(
    async (
      characterAsset: CanvasAsset,
      sourceImageAsset: CanvasAsset,
      subview: FilmCharacterSubview,
    ) => {
      const sourceUrl = characterSourceImageUrl(sourceImageAsset)
      if (!sourceUrl) {
        message.warning('当前图片没有可用的源图')
        return
      }
      const baseName =
        (characterAsset.title || sourceImageAsset.title || 'image')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'image'
      const viewName =
        (subview.label || 'detail')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 24) || 'detail'
      const dataUrl = await cropCharacterSubviewToDataUrl(sourceUrl, subview.cropPx)
      const file = dataUrlToFile(dataUrl, `${baseName}-${viewName}-${Date.now()}.png`)
      const assetId = await uploadImageAsset(file)
      if (!assetId) {
        message.error('子视图生成失败')
        return
      }
      await handleInsertAsset(assetId)
      message.success(`已将子视图「${subview.label}」插入画布`)
    },
    [handleInsertAsset, uploadImageAsset],
  )

  const handleUpdateCharacterSubviews = useCallback(
    async (assetId: string, subviews: FilmCharacterSubview[]) => {
      await updateFilmAsset(assetId, { characterSubviews: subviews })
      message.success('角色子视图已更新')
    },
    [updateFilmAsset],
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
      const position = positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
        x: 260,
        y: 200,
      })
      const createdNode = await createTextNode({
        text: promptText,
        x: position.x,
        y: position.y,
      })
      if (!createdNode) return
      await patchNodes([createdNode.id], {
        title: '分镜导演台提示词',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
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
      const file = dataUrlToFile(input.dataUrl, fileName)
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
          width: VIDEO_NODE_DEFAULT_SIZE.width,
          height: VIDEO_NODE_DEFAULT_SIZE.height,
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
      // 资源内容节点：文本 / prompt 直接创建
      if (item.nodeType === 'text' || item.nodeType === 'prompt') {
        void addText()
        return
      }
      // 组：需先选中至少两个节点
      if (item.nodeType === 'group') {
        if (selectedTopLevelNodes.length < 2) {
          message.info('请先选择至少两个节点，再创建组')
          return
        }
        void createGroupNode(selectedTopLevelNodes.map((node) => node.id))
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
      if (item.action === 'from_history') {
        setTemplateOpen(false)
        setShortcutHelpOpen(false)
        setHistoryOpen(true)
        return
      }
      if (item.action === 'from_template') {
        setHistoryOpen(false)
        setShortcutHelpOpen(false)
        setTemplateOpen(true)
        return
      }
      // 任务节点：在视口中心创建 AI 操作节点
      if (item.operation && snapshot) {
        void (async () => {
          const position = positionNodeInViewport(
            canvasViewportRef.current,
            OPERATION_NODE_DEFAULT_SIZE,
            { x: 260, y: 200 },
          )
          const existingNodeIds = new Set(snapshot.nodes.map((node) => node.id))
          const next = await createOperationNode({
            boardId: snapshot.board.id,
            operation: item.operation!,
            inputNodeIds: [],
            x: Math.round(position.x),
            y: Math.round(position.y),
            message: '请在操作面板填写 Prompt / 连接输入节点后点击开始任务',
          })
          const created = next?.nodes.find(
            (node) => !existingNodeIds.has(node.id) && node.data?.operation === item.operation,
          )
          if (created) {
            closeCanvasFloatPanels('operation')
            setSelectedNodeIds([created.id])
            setActiveOperationPanelNodeId(created.id)
            message.info('已创建任务节点，请填写参数后连接输入并运行')
          }
        })()
      }
    },
    [
      addText,
      closeCanvasFloatPanels,
      createGroupNode,
      createOperationNode,
      selectedTopLevelNodes,
      snapshot,
      uploadFirstImage,
      setSidePanelTab,
    ],
  )

  const directorStageNode = useMemo(
    () => snapshot?.nodes.find((item) => item.id === directorStageNodeId) ?? null,
    [directorStageNodeId, snapshot?.nodes],
  )

  const handleSaveDirectorStage = useCallback(
    async (data: DirectorStageData, prompt: string) => {
      if (!directorStageNode) return
      await updateNodeData(directorStageNode.id, {
        ...directorStageNode.data,
        subtype: 'director_stage',
        directorStage: data as unknown as Record<string, unknown>,
        text: prompt,
      })
    },
    [directorStageNode, updateNodeData],
  )

  const handleInsertDirectorStagePrompt = useCallback(
    async (promptText: string) => {
      if (!snapshot) return
      const position = positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
        x: 260,
        y: 200,
      })
      const createdNode = await createTextNode({
        text: promptText,
        x: position.x,
        y: position.y,
      })
      if (!createdNode) return
      await patchNodes([createdNode.id], {
        title: '画面提示词',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
      })
      setSelectedNodeIds([createdNode.id])
      message.success('已插入画面提示词节点')
    },
    [createTextNode, patchNodes, snapshot],
  )

  const handleInsertDirectorStageScreenshot = useCallback(
    async (input: { dataUrl: string; prompt: string }) => {
      if (!snapshot) return
      const fileName = `director-framing-${Date.now()}.png`
      const file = dataUrlToFile(input.dataUrl, fileName)
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
      if (imageNode) {
        await patchNodes([imageNode.id], { title: '画面取景预览' })
        setSelectedNodeIds([imageNode.id])
      }
      message.success('已导出取景预览图到画布')
    },
    [createImageNode, patchNodes, snapshot],
  )

  // ─── 真·3D 导演台（subtype director_stage_3d）───
  const directorStage3DNode = useMemo(
    () => snapshot?.nodes.find((item) => item.id === directorStage3DNodeId) ?? null,
    [directorStage3DNodeId, snapshot?.nodes],
  )

  const stage3dImageNodes = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter((n) => n.type === 'image' && Boolean(n.data.url))
        .map((n) => ({
          id: n.id,
          title: n.title ?? '图片',
          url: n.data.url as string,
          ...(n.data.thumbnailUrl ? { thumbnailUrl: n.data.thumbnailUrl } : {}),
        })),
    [snapshot?.nodes],
  )

  const stage3dCharacterNodes = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter((n) => n.data.pipelineRole === 'character')
        .map((n) => ({ id: n.id, title: n.title ?? '角色' })),
    [snapshot?.nodes],
  )

  const handleSaveDirectorStage3D = useCallback(
    async (data: Stage3DData, prompt: string) => {
      if (!directorStage3DNode) return
      await updateNodeData(directorStage3DNode.id, {
        ...directorStage3DNode.data,
        subtype: 'director_stage_3d',
        stage3d: data as unknown as Record<string, unknown>,
        text: prompt,
      })
    },
    [directorStage3DNode, updateNodeData],
  )

  const handleInsertStage3DScreenshot = useCallback(
    async (input: { dataUrl: string; prompt: string }) => {
      if (!snapshot) return
      const fileName = `stage3d-${Date.now()}.png`
      const file = dataUrlToFile(input.dataUrl, fileName)
      const dimensions = await readImageDimensions(input.dataUrl)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl: input.dataUrl,
        mimeType: file.type,
        suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const nodeSize = fitImageNodeSize(dimensions.width || 1600, dimensions.height || 900)
      const source = directorStage3DNode
      const position = source
        ? { x: source.x + source.width + 60, y: source.y }
        : positionNodeInViewport(canvasViewportRef.current, nodeSize, { x: 260, y: 200 })
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
      if (imageNode) {
        await patchNodes([imageNode.id], { title: '3D 导演台截图' })
        if (source) await connectNodes({ sourceNodeId: source.id, targetNodeId: imageNode.id })
        setSelectedNodeIds([imageNode.id])
      }
      message.success('已从 3D 导演台生成截图节点')
    },
    [connectNodes, createImageNode, directorStage3DNode, patchNodes, snapshot],
  )

  const handleInsertStage3DScreenshots = useCallback(
    async (inputs: { dataUrl: string; title: string; prompt: string }[]) => {
      if (!snapshot || inputs.length === 0) return
      const source = directorStage3DNode
      const createdIds: string[] = []
      // 逐张沿用单张的保存+建节点+连线链路；网格化排布避免堆叠
      for (let i = 0; i < inputs.length; i += 1) {
        const input = inputs[i]!
        const fileName = `stage3d-${Date.now()}-${i}.png`
        const file = dataUrlToFile(input.dataUrl, fileName)
        const dimensions = await readImageDimensions(input.dataUrl)
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl: input.dataUrl,
          mimeType: file.type,
          suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
        })
        const nodeSize = fitImageNodeSize(dimensions.width || 1600, dimensions.height || 900)
        const col = i % 3
        const row = Math.floor(i / 3)
        const baseX = source ? source.x + source.width + 60 : 260
        const baseY = source ? source.y : 200
        const position = {
          x: baseX + col * (nodeSize.width + 40),
          y: baseY + row * (nodeSize.height + 40),
        }
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
        if (imageNode) {
          await patchNodes([imageNode.id], { title: input.title })
          if (source) await connectNodes({ sourceNodeId: source.id, targetNodeId: imageNode.id })
          createdIds.push(imageNode.id)
        }
      }
      if (createdIds.length > 0) setSelectedNodeIds(createdIds)
      message.success(`已批量导出 ${createdIds.length} 个镜头截图`)
    },
    [connectNodes, createImageNode, directorStage3DNode, patchNodes, snapshot],
  )

  const handleInsertStage3DPrompt = useCallback(
    async (promptText: string) => {
      if (!snapshot) return
      const position = positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
        x: 260,
        y: 200,
      })
      const createdNode = await createTextNode({
        text: promptText,
        x: position.x,
        y: position.y,
      })
      if (!createdNode) return
      await patchNodes([createdNode.id], {
        title: '3D 画面提示词',
        width: VIDEO_NODE_DEFAULT_SIZE.width,
        height: VIDEO_NODE_DEFAULT_SIZE.height,
      })
      setSelectedNodeIds([createdNode.id])
      message.success('已插入 3D 画面提示词节点')
    },
    [createTextNode, patchNodes, snapshot],
  )

  // ─── 视频工作台（subtype video_workbench）───
  const videoWorkbenchNode = useMemo(
    () => snapshot?.nodes.find((item) => item.id === videoWorkbenchNodeId) ?? null,
    [videoWorkbenchNodeId, snapshot?.nodes],
  )

  /** 画布上所有可用作工作台源的视频节点（供工作台「从画布选择」）。
   *  排除当前工作台节点自身和易失效的操作产物(task_output)。 */
  const videoNodesForWorkbench = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter(
          (n) =>
            n.type === 'video' &&
            typeof n.data.url === 'string' &&
            n.id !== videoWorkbenchNodeId &&
            n.data.origin !== 'task_output',
        )
        .map((n) => ({
          id: n.id,
          title: n.title ?? '视频',
          url: n.data.url as string,
          ...(n.data.thumbnailUrl ? { thumbnailUrl: n.data.thumbnailUrl as string } : {}),
        })),
    [snapshot?.nodes, videoWorkbenchNodeId],
  )

  const handleSaveVideoWorkbench = useCallback(
    async (data: VideoWorkbenchData) => {
      if (!videoWorkbenchNode) return
      // updateNodeData 是 merge 语义（{...node.data, ...data}），
      // 只传 videoWorkbench 字段即可，无需展开闭包里的 node.data（避免覆盖并发改动）。
      await updateNodeData(videoWorkbenchNode.id, {
        videoWorkbench: data as unknown as Record<string, unknown>,
      })
    },
    [videoWorkbenchNode, updateNodeData],
  )

  // 工作台「添加/更换视频」：文件选择器 → 复制进项目 → 写回当前工作台节点的 data.url
  const handleAddVideoToWorkbench = useCallback(async () => {
    if (!videoWorkbenchNode || !projectId) return
    const picked = await window.spark.invoke('dialog:open-file', {
      title: '选择视频',
      multiple: false,
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'] }],
    })
    if (picked.canceled || !picked.filePath) return
    const projectRootPath = snapshot?.project.rootPath
    const copyResult = await window.spark.invoke('canvas:asset:copy-to-project', {
      projectId,
      ...(projectRootPath ? { projectRootPath } : {}),
      sourcePath: picked.filePath,
      type: 'video',
    })
    if (copyResult.error || !copyResult.filePath) {
      message.error('视频导入失败')
      return
    }
    const fileUrl = encodeToSafeFileUrl(copyResult.filePath as string)
    await updateNodeData(videoWorkbenchNode.id, {
      url: fileUrl,
      videoWorkbench: createDefaultVideoWorkbenchData() as unknown as Record<string, unknown>,
    })
    message.success('视频已导入工作台')
  }, [videoWorkbenchNode, projectId, snapshot?.project.rootPath, updateNodeData])

  // 从画布选择视频作为工作台源视频（直接用已有节点的 url，无需重新落盘）
  const handleSelectVideoFromCanvas = useCallback(
    async (url: string) => {
      if (!videoWorkbenchNode) return
      await updateNodeData(videoWorkbenchNode.id, {
        url,
        videoWorkbench: createDefaultVideoWorkbenchData() as unknown as Record<string, unknown>,
      })
      message.success('已切换源视频')
    },
    [videoWorkbenchNode, updateNodeData],
  )

  /** 把关键帧导出为画布图片节点（批量），连线到源视频工作台节点 */
  const handleExportKeyframes = useCallback(
    async (frames: WorkbenchKeyframe[], sourceNodeId: string) => {
      if (!snapshot || frames.length === 0) return
      const source = snapshot.nodes.find((n) => n.id === sourceNodeId)
      const createdIds: string[] = []
      const nodeSize = { width: 320, height: 180 }
      const baseX = source ? source.x + source.width + 60 : 260
      const baseY = source ? source.y : 200

      // 分批并行 createImageNode（每批 5 个），降低串行 IPC 等待
      const BATCH = 5
      const loadingKey = `export-kf-${Date.now()}`
      message.loading({
        content: `正在导入 ${frames.length} 个关键帧…`,
        key: loadingKey,
        duration: 0,
      })
      for (let start = 0; start < frames.length; start += BATCH) {
        const batch = frames.slice(start, start + BATCH)
        const imageNodes = await Promise.all(
          batch.map(async (kf, j) => {
            const i = start + j
            const fileName = `keyframe_${String(kf.index + 1).padStart(3, '0')}.jpg`
            const file = new File([], fileName, { type: 'image/jpeg' })
            const col = i % 4
            const row = Math.floor(i / 4)
            return createImageNode({
              file,
              filePath: kf.path,
              x: baseX + col * (nodeSize.width + 24),
              y: baseY + row * (nodeSize.height + 24),
              width: nodeSize.width,
              height: nodeSize.height,
            })
          }),
        )
        // patchNodes + connectNodes 串行（涉及 DB 写入，避免竞态）
        for (let j = 0; j < imageNodes.length; j++) {
          const imageNode = imageNodes[j]
          const kf = batch[j]!
          if (imageNode) {
            await patchNodes([imageNode.id], {
              title: `关键帧 ${String(kf.index + 1).padStart(2, '0')}`,
            })
            if (source) await connectNodes({ sourceNodeId: source.id, targetNodeId: imageNode.id })
            createdIds.push(imageNode.id)
          }
        }
      }
      message.destroy(loadingKey)
      if (createdIds.length > 0) setSelectedNodeIds(createdIds)
      message.success(`已导入 ${createdIds.length} 个关键帧到画布`)
    },
    [connectNodes, createImageNode, patchNodes, snapshot],
  )

  const handleAnnotateImageComplete = useCallback(
    async (input: { dataUrl: string; width: number; height: number; sourceNode: CanvasNode }) => {
      if (!snapshot) return
      const fileName = `${
        (input.sourceNode.title || 'image')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'image'
      }-annotated-${Date.now()}.png`
      const file = await dataUrlToFile(input.dataUrl, fileName)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl: input.dataUrl,
        mimeType: file.type,
        suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const nodeSize = fitImageNodeSize(input.width, input.height)
      const source = input.sourceNode
      const placement = placeAutoNodeToRight({
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
      })
      const imageNode = await createImageNode({
        file,
        filePath: savedImage.filePath,
        x: placement.x,
        y: placement.y,
        width: nodeSize.width,
        height: nodeSize.height,
        imageWidth: input.width,
        imageHeight: input.height,
      })
      if (imageNode) {
        await patchNodes([imageNode.id], { title: `${source.title ?? '图片'} · 标注` })
        await connectNodes({ sourceNodeId: source.id, targetNodeId: imageNode.id })
        setSelectedNodeIds([imageNode.id])
      }
      setAnnotatingImageNodeId(null)
      message.success('已生成标注图片节点')
    },
    [connectNodes, createImageNode, patchNodes, snapshot],
  )

  const handleGridSplitComplete = useCallback(
    async (input: {
      sourceNode: CanvasNode
      rows: number
      cols: number
      selectedTiles: CanvasGridSplitTile[]
    }) => {
      if (!snapshot || input.selectedTiles.length === 0) return
      const safeBaseName =
        (input.sourceNode.title || 'image')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'image'
      const shouldGroup = input.selectedTiles.length > 1
      const preparedImages: PreparedImageUpload[] = []
      for (const tile of input.selectedTiles) {
        const fileName = `${safeBaseName}-grid-${tile.label}-${Date.now()}.png`
        const file = await dataUrlToFile(tile.dataUrl, fileName)
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl: tile.dataUrl,
          mimeType: file.type,
          suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
        })
        const nodeSize = shouldGroup
          ? fitGroupedImageNodeSize(tile.width, tile.height)
          : fitImageNodeSize(tile.width, tile.height)
        preparedImages.push({
          file,
          filePath: savedImage.filePath,
          width: nodeSize.width,
          height: nodeSize.height,
          imageWidth: tile.width,
          imageHeight: tile.height,
          title: `${input.sourceNode.title ?? '图片'} · ${tile.label}`,
        })
      }

      const preferredPosition = placeAutoNodeToRight({
        x: input.sourceNode.x,
        y: input.sourceNode.y,
        width: input.sourceNode.width,
        height: input.sourceNode.height,
      })

      if (!shouldGroup) {
        const image = preparedImages[0]
        if (!image) return
        const imageNode = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: preferredPosition.x,
          y: preferredPosition.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (imageNode) {
          await patchNodes([imageNode.id], {
            title: image.title ?? `${input.sourceNode.title ?? '图片'} · 宫格切分`,
          })
          await connectNodes({ sourceNodeId: input.sourceNode.id, targetNodeId: imageNode.id })
          setSelectedNodeIds([imageNode.id])
        }
        setGridSplitImageNodeId(null)
        message.success('已生成宫格切分图片节点')
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
      const groupPosition = positionNodeInViewport(
        canvasViewportRef.current,
        groupSize,
        preferredPosition,
      )
      const placedImages = layoutGroupedImages(preparedImages, groupPosition)
      const createdNodeIds: string[] = []
      const nodeTitleById = new Map<string, string>()
      for (const image of placedImages) {
        const imageNode = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (imageNode) {
          createdNodeIds.push(imageNode.id)
          if (image.title) nodeTitleById.set(imageNode.id, image.title)
        }
      }
      for (const [nodeId, title] of nodeTitleById) {
        await patchNodes([nodeId], { title })
      }

      if (createdNodeIds.length === 0) {
        setGridSplitImageNodeId(null)
        message.error('宫格切分结果生成失败')
        return
      }

      let selection = createdNodeIds
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
        if (groupNode) {
          await patchNodes([groupNode.id], {
            title: `${input.sourceNode.title ?? '图片'} · 宫格切分 ${input.rows}x${input.cols}`,
          })
          await connectNodes({ sourceNodeId: input.sourceNode.id, targetNodeId: groupNode.id })
          selection = [groupNode.id]
        } else {
          for (const nodeId of createdNodeIds) {
            await connectNodes({ sourceNodeId: input.sourceNode.id, targetNodeId: nodeId })
          }
        }
      } else if (createdNodeIds[0]) {
        await connectNodes({ sourceNodeId: input.sourceNode.id, targetNodeId: createdNodeIds[0] })
      }

      setSelectedNodeIds(selection)
      setGridSplitImageNodeId(null)
      message.success(`已生成 ${createdNodeIds.length} 张宫格切分图片`)
    },
    [connectNodes, createGroupNode, createImageNode, patchNodes, snapshot],
  )

  const handleUndoCanvasChange = useCallback(async () => {
    try {
      await undoCanvasChange()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '撤销失败')
    }
  }, [undoCanvasChange])

  const handleRedoCanvasChange = useCallback(async () => {
    try {
      await redoCanvasChange()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重做失败')
    }
  }, [redoCanvasChange])

  const handleToggleGrid = useCallback(() => {
    if (!snapshot) return
    const next = snapshot.board.settings.grid === true ? false : true
    void canvasApi
      .updateBoardSettings(projectId, snapshot.board.id, { grid: next })
      .then(() => {
        void refresh()
      })
      .catch(() => {})
  }, [snapshot, projectId, refresh])

  // 画布快捷键：只绑定到已有画布动作，避免在输入框、弹窗或抽屉中误触。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      if (leaveOpen || saveToLibraryNodeId != null || annotatingImageNodeId != null) return
      if (
        agentOpen ||
        characterLibraryOpen ||
        filmCenterOpen ||
        inlineAiOpen ||
        historyOpen ||
        templateOpen ||
        shortcutHelpOpen
      ) {
        return
      }

      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const stop = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (
        !mod &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        if (selectedNodes.length === 0) return
        stop()
        void handleDeleteSelectedNodes()
        return
      }

      if (mod && !event.altKey && key === 'z') {
        stop()
        if (event.shiftKey) {
          void handleRedoCanvasChange()
        } else {
          void handleUndoCanvasChange()
        }
        return
      }

      if (mod && !event.altKey && !event.shiftKey && key === 'r') {
        stop()
        void refresh()
        return
      }

      if (mod && event.shiftKey && !event.altKey && key === 's') {
        stop()
        handleAutoSaveToggle(!autoSaveEnabledRef.current)
        return
      }

      if (mod && !event.altKey && !event.shiftKey && (event.key === '+' || event.key === '=')) {
        stop()
        canvasViewportControlsRef.current?.zoomBy(0.12)
        return
      }

      if (mod && !event.altKey && !event.shiftKey && event.key === '-') {
        stop()
        canvasViewportControlsRef.current?.zoomBy(-0.12)
        return
      }

      if (mod && !event.altKey && !event.shiftKey && event.key === '0') {
        stop()
        handleFitCanvasView()
        return
      }

      if (!mod && !event.altKey && !event.shiftKey) {
        const step = 80
        if (event.key === 'ArrowUp') {
          stop()
          canvasViewportControlsRef.current?.panBy({ x: 0, y: step })
        } else if (event.key === 'ArrowDown') {
          stop()
          canvasViewportControlsRef.current?.panBy({ x: 0, y: -step })
        } else if (event.key === 'ArrowLeft') {
          stop()
          canvasViewportControlsRef.current?.panBy({ x: step, y: 0 })
        } else if (event.key === 'ArrowRight') {
          stop()
          canvasViewportControlsRef.current?.panBy({ x: -step, y: 0 })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    agentOpen,
    annotatingImageNodeId,
    characterLibraryOpen,
    filmCenterOpen,
    handleAutoSaveToggle,
    handleFitCanvasView,
    handleRedoCanvasChange,
    handleUndoCanvasChange,
    historyOpen,
    inlineAiOpen,
    leaveOpen,
    refresh,
    saveToLibraryNodeId,
    shortcutHelpOpen,
    templateOpen,
    handleDeleteSelectedNodes,
    selectedNodes,
  ])

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
      } else if (annotatingImageNodeId != null) {
        setAnnotatingImageNodeId(null)
      } else if (activeOperationPanelNodeId != null) {
        setActiveOperationPanelNodeId(null)
        setSelectedNodeIds([])
      } else if (editingNodeId != null) {
        setEditingNodeId(null)
        setSelectedNodeIds([])
      } else if (agentOpen) {
        setAgentOpen(false)
      } else if (characterLibraryOpen) {
        setCharacterLibraryOpen(false)
      } else if (filmCenterOpen) {
        setFilmCenterOpen(false)
      } else if (inlineAiOpen) {
        setInlineAiOpen(false)
      } else if (historyOpen) {
        setHistoryOpen(false)
      } else if (templateOpen) {
        setTemplateOpen(false)
      } else if (shortcutHelpOpen) {
        setShortcutHelpOpen(false)
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
    annotatingImageNodeId,
    activeOperationPanelNodeId,
    editingNodeId,
    agentOpen,
    characterLibraryOpen,
    filmCenterOpen,
    inlineAiOpen,
    historyOpen,
    templateOpen,
    shortcutHelpOpen,
  ])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    const preferredPosition = pendingImagePositionRef.current
    const pendingConnection = pendingImageConnectionRef.current
    pendingImagePositionRef.current = null
    pendingImageConnectionRef.current = null
    event.target.value = ''
    if (selectedFiles.length === 0) return
    const snapshot = snapshotRef.current
    if (!snapshot) return

    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      message.warning('请选择图片文件')
      return
    }
    if (imageFiles.length < selectedFiles.length) {
      message.warning('已跳过非图片文件')
    }

    try {
      const preparedImages = await Promise.all(
        imageFiles.map((file) =>
          prepareCanvasImageUpload(file, { grouped: imageFiles.length > 1 }),
        ),
      )
      const result = await insertPreparedImages(preparedImages, preferredPosition)
      const targetNodeId = result.groupNodeId ?? result.createdNodeIds[0]
      if (result.selectedNodeIds.length > 0) setSelectedNodeIds(result.selectedNodeIds)
      if (pendingConnection && targetNodeId) {
        await connectNodes({ sourceNodeId: pendingConnection.sourceNodeId, targetNodeId })
      }
      if (result.createdNodeCount > 0) {
        message.success(
          result.createdNodeCount === 1
            ? '已添加图片到画布'
            : result.grouped
              ? `已添加 ${result.createdNodeCount} 张图片并成组`
              : `已添加 ${result.createdNodeCount} 张图片到画布`,
        )
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
    skillIds,
    taskTitle,
    outputTitle,
    taskPipelineRole,
    outputPipelineRole,
    droppedModelParams,
    modelParamWarnings,
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
    inputRoles?: Record<string, CanvasTaskInputRoleSelection>
    agentId?: string
    skillIds?: string[]
    taskTitle?: string
    outputTitle?: string
    taskPipelineRole?: CanvasPipelineRole
    outputPipelineRole?: CanvasPipelineRole
    droppedModelParams?: Array<{ name: string; reason: string; valuePreview?: string | undefined }>
    modelParamWarnings?: Array<{ code: string; message: string }>
  }) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    // Persist the live viewport before the task API refreshes the snapshot.
    const viewportBeforeCreate = await persistCurrentCanvasViewport()
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const taskInputNodes =
      inputNodeIds !== undefined
        ? resolveCanvasInputNodes(inputNodeIds, snapshot.nodes)
        : aiInputNodes
    const lineageInputNodeIds = inputNodeIds ?? aiInputNodes.map((node) => node.id)
    const hydratedTaskInputNodes = hydrateTextInputNodes(taskInputNodes, snapshot.assets)
    const effectiveInputRoles =
      operation === 'storyboard_grid'
        ? buildStoryboardReferenceInputRoles(hydratedTaskInputNodes, inputRoles)
        : inputRoles
    const presetTargetId = resolveCanvasPresetTarget({
      operation,
      taskPipelineRole: taskPipelineRole ?? null,
      outputPipelineRole: outputPipelineRole ?? null,
      workflow: modelParams?.workflow,
    })
    const operationPreset = readCanvasResolvedPresetTarget(presetTargetId)
    const effectiveSkillIds =
      skillIds && skillIds.length > 0 ? skillIds : (operationPreset.skillIds ?? [])
    const effectiveNegativePrompt = mergeCanvasOperationPresetNegativePrompt(
      negativePrompt ?? '',
      operationPreset.negativePrompt,
    )
    const promptDocument = buildCanvasPromptDocumentForInputs({
      prompt,
      nodes: hydratedTaskInputNodes,
      assets: snapshot.assets,
    })
    const systemPrompt = buildCanvasOperationSystemPrompt(operation, operationPreset.prompt)
    const promptSubmission = await buildCanvasPromptSubmission({
      document: promptDocument,
      snapshot,
      operation,
      inputNodeIds: lineageInputNodeIds,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(effectiveNegativePrompt ? { negativePrompt: effectiveNegativePrompt } : {}),
      ...(inputTransport ? { inputTransport } : {}),
      ...(effectiveInputRoles ? { inputRoles: effectiveInputRoles } : {}),
    })
    const inputFiles = promptSubmission.inputFiles ?? []
    const effectivePrompt =
      promptSubmission.prompt ||
      (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : '')
    const mergedModelParams = mergeCanvasPresetTargetModelParams(presetTargetId, modelParams)
    const styleContext = buildCanvasStyleContext(snapshot, {
      ...(effectiveNegativePrompt ? { negativePrompt: effectiveNegativePrompt } : {}),
      ...(Object.keys(mergedModelParams).length > 0 ? { modelParams: mergedModelParams } : {}),
    })
    const styledTask = applyCanvasStyleToTask(
      operation,
      {
        prompt: effectivePrompt,
        ...(effectiveNegativePrompt ? { negativePrompt: effectiveNegativePrompt } : {}),
        modelParams: mergedModelParams,
      },
      styleContext,
    )
    const placement = placeNodeRightOfNodes(
      taskInputNodes.length > 0 ? taskInputNodes : selectedNodes,
      {
        x: 360,
        y: 260,
      },
    )

    await runWithCanvasTaskViewport(
      () => viewportBeforeCreate,
      restoreCanvasViewport,
      () =>
        createTask({
          ...promptSubmission,
          operation,
          prompt: styledTask.prompt,
          compiledUserText: styledTask.prompt,
          ...(styledTask.negativePrompt ? { negativePrompt: styledTask.negativePrompt } : {}),
          inputNodeIds: lineageInputNodeIds,
          inputAssetIds: taskInputNodes
            .map((node) => node.assetId)
            .filter((id): id is string => Boolean(id)),
          ...(inputFiles.length > 0 ? { inputFiles } : {}),
          ...(providerProfileId != null ? { providerProfileId } : {}),
          ...(manifestId != null ? { manifestId } : {}),
          ...(modelId != null ? { modelId } : {}),
          ...(Object.keys(styledTask.modelParams).length > 0
            ? { modelParams: styledTask.modelParams }
            : {}),
          ...(agentId != null ? { agentId } : {}),
          // skillIds 优先用调用方传入，没有就回退到 preset 默认，确保新建节点携带 skills。
          ...(effectiveSkillIds.length > 0 ? { skillIds: effectiveSkillIds } : {}),
          ...(taskTitle != null ? { taskTitle } : {}),
          ...(outputTitle != null ? { outputTitle } : {}),
          ...(taskPipelineRole != null ? { taskPipelineRole } : {}),
          ...(outputPipelineRole != null ? { outputPipelineRole } : {}),
          ...(droppedModelParams != null && droppedModelParams.length > 0
            ? { droppedModelParams }
            : {}),
          ...(modelParamWarnings != null && modelParamWarnings.length > 0
            ? { modelParamWarnings }
            : {}),
          outputPlacement: {
            x: placement.x,
            y: placement.y,
          },
        }),
    )
    writeCanvasLastUsedPresetTarget(presetTargetId, {
      ...(prompt.trim() ? { prompt } : {}),
      ...(negativePrompt != null ? { negativePrompt } : {}),
      ...(providerProfileId != null ? { providerProfileId } : {}),
      ...(manifestId != null ? { manifestId } : {}),
      ...(modelId != null ? { modelId } : {}),
      ...(agentId != null ? { agentId } : {}),
      ...(effectiveSkillIds.length > 0 ? { skillIds: effectiveSkillIds } : {}),
      ...(Object.keys(modelParams ?? {}).length > 0 ? { modelParams } : {}),
    })
  }

  const runTrackedCanvasWorkflow = async (
    request: {
      title: string
      prompt?: string
      userPrompt?: string
      inputNodeIds?: string[]
      inputAssetIds?: string[]
      bindToNodeId?: string
      message?: string
      agentId?: string
      providerProfileId?: string
      provider?: string
      modelId?: string
      skillIds?: string[]
      modelParams?: Record<string, unknown>
    } & CanvasPromptTaskFields,
    run: () => Promise<TrackedCanvasWorkflowResult>,
  ): Promise<TrackedCanvasWorkflowResult> => {
    const snapshot = snapshotRef.current
    if (!snapshot) throw new Error('画布尚未加载')
    const viewportBeforeRun = await persistCurrentCanvasViewport()
    const placement = positionNodeInViewport(
      canvasViewportRef.current,
      OPERATION_NODE_DEFAULT_SIZE,
      { x: 260, y: 200 },
    )
    const { taskId } = await canvasApi.startWorkflowTask(projectId, {
      boardId: snapshot.board.id,
      operation: 'text_generate',
      title: request.title,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.userPrompt !== undefined ? { userPrompt: request.userPrompt } : {}),
      ...(request.inputNodeIds ? { inputNodeIds: request.inputNodeIds } : {}),
      ...(request.inputAssetIds ? { inputAssetIds: request.inputAssetIds } : {}),
      ...(request.bindToNodeId ? { bindToNodeId: request.bindToNodeId } : {}),
      ...(request.message ? { message: request.message } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.providerProfileId ? { providerProfileId: request.providerProfileId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.modelId ? { modelId: request.modelId } : {}),
      ...(request.skillIds ? { skillIds: request.skillIds } : {}),
      ...(request.modelParams ? { modelParams: request.modelParams } : {}),
      ...(request.promptDocument ? { promptDocument: request.promptDocument } : {}),
      ...(request.promptSnapshot ? { promptSnapshot: request.promptSnapshot } : {}),
      ...(request.compiledUserText !== undefined
        ? { compiledUserText: request.compiledUserText }
        : {}),
      ...(request.inputSnapshots ? { inputSnapshots: request.inputSnapshots } : {}),
      ...(request.relationManifest ? { relationManifest: request.relationManifest } : {}),
      ...(request.promptWarnings ? { promptWarnings: request.promptWarnings } : {}),
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      outputPlacement: { x: placement.x, y: placement.y },
    })
    await refreshTaskSnapshot()
    restoreCanvasViewport(viewportBeforeRun)

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
      await refreshTaskSnapshot()
      restoreCanvasViewport(viewportBeforeRun)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await canvasApi.finishWorkflowTask(projectId, taskId, {
        status: 'failed',
        errorMsg: 'workflow_failed',
        errorDetail: errorMessage,
        message: `失败：${errorMessage}`,
      })
      await refreshTaskSnapshot()
      restoreCanvasViewport(viewportBeforeRun)
      throw error
    }
  }

  /**
   * 资产中心快捷 AI 操作：在画布视口中央创建一个待执行的操作节点（operation node），
   * 不直接发起任务；用户可在操作面板内调整 Prompt / Agent / 模型后手动开始。
   *
   * 与 `handleCreateOperationAtPosition` 的差异：预填 source asset、Prompt 与角色，
   * 节点创建后自动打开操作面板；用于"资产中心 → 一键产生任务节点"的入口。
   */
  const addFilmAssetTaskNode = async (params: {
    operation: CanvasOperationType
    title: string
    prompt: string
    message?: string
    modelParams?: Record<string, unknown>
    taskPipelineRole?: CanvasPipelineRole
    outputPipelineRole?: CanvasPipelineRole
    outputTitle?: string
    /** 预绑定的上游节点（仅创建时记录；用户可在面板里改） */
    inputNodeIds?: string[]
    /** 自定义节点尺寸，用于 viewport 居中计算 */
    size?: { width: number; height: number }
    /** 创建后是否自动打开操作面板，默认 true */
    openPanel?: boolean
  }): Promise<CanvasNode | null> => {
    const snapshot = snapshotRef.current
    if (!snapshot) return null
    const size = params.size ?? OPERATION_NODE_DEFAULT_SIZE
    const placement = positionNodeInViewport(canvasViewportRef.current, size, { x: 260, y: 200 })
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation: params.operation,
      inputNodeIds: params.inputNodeIds ?? [],
      x: Math.round(placement.x),
      y: Math.round(placement.y),
      title: params.title,
      systemPrompt: params.prompt,
      message: params.message ?? '请在操作面板确认 Prompt / Agent / 模型后点击开始任务',
      ...(params.modelParams ? { modelParams: params.modelParams } : {}),
      ...(params.taskPipelineRole ? { taskPipelineRole: params.taskPipelineRole } : {}),
      ...(params.outputPipelineRole ? { outputPipelineRole: params.outputPipelineRole } : {}),
      ...(params.outputTitle ? { outputTitle: params.outputTitle } : {}),
    })
    const created = findLatestCreatedOperationNode(
      next?.nodes ?? [],
      params.operation,
      existingNodeIds,
    )
    if (created) {
      if (params.openPanel !== false) {
        openOperationPanelForNode(created.id)
        message.info(`已创建「${params.title}」任务节点，请确认配置后开始`)
      } else {
        setSelectedNodeIds([created.id])
        message.info(`已创建并连接「${params.title}」节点，双击或右键“编辑节点”可打开配置`)
      }
    }
    return created ?? null
  }

  const handleBreakdownScriptAsset: NonNullable<
    FilmCenterHandlers['onBreakdownScriptAsset']
  > = async (asset) => {
    const scriptText = asset.contentText?.trim() ?? ''
    if (!scriptText) {
      message.warning('请先补充剧本内容，再执行拆解')
      return
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return

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
    const snapshot = snapshotRef.current
    if (!snapshot) return
    await updateProjectMetadata(upsertStylePreset(snapshot.project.metadata, preset))
  }

  const handleApplyProductionBible: NonNullable<
    FilmCenterHandlers['onApplyProductionBible']
  > = async (productionBible) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
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
    // 不直接发起任务：在画布上创建「转剧本」操作节点，用户在操作面板确认 Prompt / Agent / 模型后手动开始
    await addFilmAssetTaskNode({
      operation: 'text_rewrite',
      title: `转剧本 · ${asset.title ?? '章节'}`,
      prompt: buildChapterToScreenplayInstruction(chapterText),
      message: `已在资源库创建剧本「${scriptAsset.title}」。请在操作面板确认 Prompt / Agent / 模型后点击开始任务；产出剧本节点可右键继续编排`,
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'screenplay',
    })
  }

  const handleSetProductionState = async (
    nodeId: string,
    state: import('./canvas.types').CanvasProductionState,
  ): Promise<void> => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const updates: Array<{
      nodeId: string
      data: Partial<import('./canvas.types').CanvasNodeData>
    }> = [
      {
        nodeId,
        data: {
          productionState: state,
          ...(state === 'confirmed' ? { confirmedAt: new Date().toISOString() } : {}),
        },
      },
    ]
    if (state === 'confirmed') {
      const edges = snapshot.edges
        .filter((edge) => edge.type === 'used_as_input' || edge.type === 'generated')
        .map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId }))
      const downstream = collectDownstream(nodeId, edges)
      let marked = 0
      for (const downstreamId of downstream) {
        const node = snapshot.nodes.find((item) => item.id === downstreamId)
        if (!node || node.data.productionState === 'stale') continue
        updates.push({ nodeId: downstreamId, data: { productionState: 'stale' } })
        marked += 1
      }
      await updateManyNodeData(updates)
      message.success(marked > 0 ? `已确认，并标记 ${marked} 个下游节点待更新` : '已确认该节点')
      return
    }
    await updateManyNodeData(updates)
    message.info('已标记为待更新')
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
    const snapshot = snapshotRef.current
    if (!snapshot) return null
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
    reasoningEffort?: SessionReasoningEffort
    skillIds?: string[]
  } => {
    const snapshot = snapshotRef.current
    if (!snapshot) return {}
    const asset = node.assetId ? snapshot.assets.find((item) => item.id === node.assetId) : null
    const assetTaskId =
      typeof asset?.metadata?.taskId === 'string' ? asset.metadata.taskId : undefined
    const task = snapshot.tasks.find((item) => item.id === (node.taskId ?? assetTaskId))
    return {
      ...(task?.agentId ? { agentId: task.agentId } : {}),
      ...(task?.providerProfileId ? { providerProfileId: task.providerProfileId } : {}),
      ...(task?.modelId ? { modelId: task.modelId } : {}),
      ...(task?.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
      ...(task?.skillIds && task.skillIds.length > 0 ? { skillIds: task.skillIds } : {}),
    }
  }

  const openOperationPanelForNode = (nodeId: string) => {
    closeCanvasFloatPanels('operation')
    setInlinePanelFocusRequest({ nodeId, nonce: Date.now() })
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
    outputTitle,
    shotScriptConfig,
    position,
    openPanel = false,
    selectCreated = true,
    announce = true,
  }: {
    sourceNode: CanvasNode
    operation: CanvasOperationType
    title: string
    prompt: string
    nodeMessage: string
    modelParams?: Record<string, unknown>
    taskPipelineRole?: CanvasPipelineRole
    outputPipelineRole?: CanvasPipelineRole
    outputTitle?: string
    shotScriptConfig?: ShotScriptConfig
    position?: CanvasPoint
    /** 从节点右键流水线创建时默认只选中新节点，避免面板被菜单收尾状态立即关闭。 */
    openPanel?: boolean
    selectCreated?: boolean
    announce?: boolean
  }) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const placement = position ?? placeNodeRightOfNodes([sourceNode], { x: 360, y: 0 })
    const runtime = resolveRuntimeFromNode(sourceNode)
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation,
      inputNodeIds: [sourceNode.id],
      x: placement.x,
      y: placement.y,
      title,
      systemPrompt: prompt,
      message: nodeMessage,
      ...(modelParams ? { modelParams } : {}),
      ...(taskPipelineRole ? { taskPipelineRole } : {}),
      ...(outputPipelineRole ? { outputPipelineRole } : {}),
      ...(outputTitle ? { outputTitle } : {}),
      ...(shotScriptConfig ? { shotScriptConfig } : {}),
      ...runtime,
    })
    const created = findLatestCreatedOperationNode(next?.nodes ?? [], operation, existingNodeIds)
    if (created) {
      if (openPanel) {
        openOperationPanelForNode(created.id)
        if (announce) message.info('已创建操作节点，请确认配置后点击开始任务')
      } else {
        if (selectCreated) setSelectedNodeIds([created.id])
        if (announce) message.info('已创建并连接任务节点，双击或右键“编辑节点”可打开配置')
      }
    }
    return created
  }

  const handleNodePipelineAction = async (nodeId: string, actionId: string): Promise<void> => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const node = snapshot.nodes.find((item) => item.id === nodeId)
    if (!node) return
    // 分镜 / 关键帧节点：从 shotRef 解析分镜后执行（§S6/§S7 节点化）
    if (
      actionId === 'shot.to_keyframes' ||
      actionId === 'shot.to_video' ||
      actionId === 'keyframe.to_video'
    ) {
      if (actionId === 'shot.to_keyframes' && node.type === 'text') {
        const sourceText = (node.data.text ?? '').trim()
        const parsedRows = sourceText ? parseShotTable(sourceText) : []
        if (isShotScriptText(sourceText) && parsedRows.length >= 2) {
          await createConfiguredOperationNode({
            sourceNode: node,
            operation: 'storyboard_grid',
            title: '生成分镜关键帧图',
            prompt:
              '请根据输入的分镜脚本文本，生成一张分镜关键帧宫格图，保持镜头顺序、人物一致性与场景连续性。',
            nodeMessage: '确认故事板 Prompt、Agent 与模型后点击开始任务',
            taskPipelineRole: 'shot',
            outputPipelineRole: 'keyframe',
          })
          return
        }
      }
      const resolved = resolveShotFromNode(node)
      if (!resolved) {
        message.warning(
          actionId === 'shot.to_video'
            ? '该节点未关联可直接出视频的分镜片段，请先生成关键帧图或补充分镜片段关联'
            : '该节点未关联分镜，无法执行',
        )
        return
      }
      if (actionId === 'shot.to_keyframes') {
        handleGenerateSegmentKeyframes(resolved, { openPanel: false })
      } else {
        handleGenerateSegmentVideo(resolved, { openPanel: false })
      }
      return
    }
    const actionInputNodes = expandCanvasInputNodes([node], snapshot.nodes)
    const asset = node.assetId
      ? snapshot.assets.find((item) => item.id === node.assetId)
      : undefined
    // 文本来源：优先关联资产正文，回退节点自身文本（让章→剧本改写产出的纯文本节点右键即可用）
    const sourceText =
      node.type === 'group'
        ? buildPipelineSourceText(actionInputNodes, snapshot.assets)
        : (asset?.contentText ?? node.data.text ?? '').trim()
    const requireAssetTargets = (label: string): CanvasPipelineAssetTarget[] => {
      const targets = resolveCanvasPipelineAssetTargets({ sourceNode: node, actionId, snapshot })
      if (targets.length === 0) {
        message.warning(`该节点没有可用的${label}产物，无法执行此操作`)
      }
      return targets
    }
    const createAssetTaskBatch = async (
      targets: CanvasPipelineAssetTarget[],
      create: (
        target: CanvasPipelineAssetTarget,
        position: CanvasPoint,
      ) => Promise<CanvasNode | null | undefined>,
    ) => {
      const positions = planCanvasPipelineTaskPositions({
        sourceNode: node,
        count: targets.length,
        existingNodes: snapshot.nodes,
      })
      const createdNodeIds: string[] = []
      for (const [index, target] of targets.entries()) {
        const position = positions[index]
        if (!position) continue
        const created = await create(target, position)
        if (created) createdNodeIds.push(created.id)
      }
      if (createdNodeIds.length > 0) {
        setSelectedNodeIds(createdNodeIds)
        requestAnimationFrame(() => canvasViewportControlsRef.current?.focusNodes(createdNodeIds))
        message.success(
          createdNodeIds.length > 1
            ? `已批量创建 ${createdNodeIds.length} 个后续任务节点`
            : '已创建并连接任务节点，双击或右键“编辑节点”可打开配置',
        )
      }
    }

    switch (actionId) {
      case 'chapter.to_screenplay':
        await handlePrepareChapterToScreenplayOperation(node, sourceText)
        break
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
        handleStoryboardGridFromNode(node)
        break
      case 'character.three_view': {
        // 右键菜单入口：创建并选中操作节点，由用户双击或右键“编辑节点”打开配置
        // （不直接触发任务，与「生成分镜脚本 / 提取角色」等专用流水线行为保持一致）
        // 资产中心按钮入口仍走 handleGenerateCharacterSheets 直接发起任务。
        const targets = requireAssetTargets('角色')
        if (targets.length === 0) break
        const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
        await createAssetTaskBatch(targets, ({ sourceNode, asset: targetAsset }, position) =>
          createConfiguredOperationNode({
            sourceNode,
            position,
            operation: 'text_to_image',
            title: `生成角色身份板 · ${targetAsset.title ?? '角色'}`,
            prompt: buildCharacterSheetPrompt({
              aspect: 'turnaround',
              character: assetToCharacterFields(targetAsset),
              ...(styleBible ? { styleBible } : {}),
              ...(typeof targetAsset.metadata?.prompt === 'string'
                ? { extraPrompt: targetAsset.metadata.prompt }
                : {}),
            }),
            // 角色身份板默认 16:9（综合卡横版构图），仅此面向默认
            modelParams: { aspect_ratio: '16:9' },
            nodeMessage: '确认 Prompt、Agent 与模型后点击开始任务',
            taskPipelineRole: 'design_card',
            outputPipelineRole: 'design_card',
            outputTitle: targetAsset.title ?? '角色',
            selectCreated: false,
            announce: false,
          }),
        )
        break
      }
      case 'scene.scene_image':
      case 'prop.prop_image':
      case 'effect.effect_image': {
        // 右键菜单入口：创建并选中操作节点，由用户双击或右键“编辑节点”打开配置
        // 资产中心按钮入口仍走 handleGenerateAssetReference 直接发起任务。
        const targets = requireAssetTargets(
          actionId === 'scene.scene_image'
            ? '场景'
            : actionId === 'prop.prop_image'
              ? '道具'
              : '特效',
        )
        if (targets.length === 0) break
        const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
        await createAssetTaskBatch(targets, ({ sourceNode, asset: targetAsset }, position) => {
          const kind = readAssetKind(targetAsset)
          const title =
            kind === 'scene'
              ? '生成场景图'
              : kind === 'prop'
                ? '生成道具图'
                : kind === 'effect'
                  ? '生成特效图'
                  : '生成设计图'
          return createConfiguredOperationNode({
            sourceNode,
            position,
            operation: 'text_to_image',
            title,
            prompt: buildFilmAssetReferencePrompt(targetAsset, styleBible),
            nodeMessage: '确认 Prompt、Agent 与模型后点击开始任务',
            taskPipelineRole: 'design_card',
            outputPipelineRole: 'design_card',
            selectCreated: false,
            announce: false,
          })
        })
        break
      }
      default:
        message.info('该操作暂未支持在画布节点上直接触发')
    }
  }

  const handleNodePipelineActionRef = useRef(handleNodePipelineAction)
  handleNodePipelineActionRef.current = handleNodePipelineAction
  const handleSetProductionStateRef = useRef(handleSetProductionState)
  handleSetProductionStateRef.current = handleSetProductionState

  const onSaveNodeToLibraryStable = useCallback((nodeId: string) => {
    setSaveToLibraryNodeId(nodeId)
  }, [])
  const onAnnotateImageStable = useCallback((nodeId: string) => {
    setAnnotatingImageNodeId(nodeId)
  }, [])
  const onSplitGridImageStable = useCallback((nodeId: string) => {
    setGridSplitImageNodeId(nodeId)
  }, [])
  const onCreateOperationChildStable = useCallback(
    (
      parentId: string,
      operation: CanvasOperationType,
      options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
    ) => {
      const snap = snapshotRef.current
      if (!snap) return
      const parent = snap.nodes.find((item) => item.id === parentId)
      if (!parent) return
      void (async () => {
        const existingNodeIds = new Set(snap.nodes.map((item) => item.id))
        const next = await createOperationNode({
          boardId: snap.board.id,
          operation,
          inputNodeIds: [parentId],
          x: parent.x + parent.width + 60,
          y: parent.y,
          ...(options?.title ? { title: options.title } : {}),
          ...(options?.prompt ? { systemPrompt: options.prompt } : {}),
          ...(options?.modelParams ? { modelParams: options.modelParams } : {}),
        })
        const created = findLatestCreatedOperationNode(
          next?.nodes ?? [],
          operation,
          existingNodeIds,
        )
        if (created) {
          setSelectedNodeIds([created.id])
          message.info('已创建并连接任务节点，双击或右键“编辑节点”可打开配置')
        }
      })()
    },
    [createOperationNode],
  )
  const onPipelineActionStable = useCallback((nodeId: string, actionId: string) => {
    void handleNodePipelineActionRef.current(nodeId, actionId)
  }, [])
  const onExtractCharacterSubviewStable = useCallback(
    (nodeId: string) => {
      handleOpenCharacterSubviewEditorFromNode(nodeId)
    },
    [handleOpenCharacterSubviewEditorFromNode],
  )
  const onSetProductionStateStable = useCallback(
    (nodeId: string, state: import('./canvas.types').CanvasProductionState) => {
      void handleSetProductionStateRef.current(nodeId, state)
    },
    [],
  )
  const onInsertAssetFromPaneStable = useCallback(
    (position: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
      pendingAssetPositionRef.current = { x: Math.round(position.x), y: Math.round(position.y) }
      pendingAssetConnectionRef.current = pendingConnection ?? null
      setSidePanelTab('assets')
    },
    [],
  )

  const inlinePanelNodeRef = useRef(inlinePanelNode)
  inlinePanelNodeRef.current = inlinePanelNode
  const inlinePanelResourceNodeRef = useRef(inlinePanelResourceNode)
  inlinePanelResourceNodeRef.current = inlinePanelResourceNode

  const closeFloatingEditorStable = useCallback(() => {
    setActiveOperationPanelNodeId(null)
    setEditingNodeId(null)
    setInlinePanelFocusRequest(null)
    setSelectedNodeIds([])
  }, [])
  const focusInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) canvasViewportControlsRef.current?.focusNodes([nodeId])
  }, [])
  const duplicateInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleDuplicateNode(nodeId)
  }, [handleDuplicateNode])
  const toggleLockInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleToggleLockNode(nodeId)
  }, [handleToggleLockNode])
  const bringInlinePanelNodeToFrontStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleBringNodeToFront(nodeId)
  }, [handleBringNodeToFront])
  const downloadInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) void handleDownloadMediaNode(nodeId)
  }, [handleDownloadMediaNode])
  const previewInlinePanelPanoramaStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) handlePreviewPanorama(nodeId)
  }, [handlePreviewPanorama])
  const extractCharacterSubviewInlinePanelStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) handleOpenCharacterSubviewEditorFromNode(nodeId)
  }, [handleOpenCharacterSubviewEditorFromNode])
  const openInlinePanelAiStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleOpenInlineAi(nodeId)
  }, [handleOpenInlineAi])
  const editInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleEditNode(nodeId)
  }, [handleEditNode])
  const deleteInlinePanelNodeStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) handleDeleteNode(nodeId)
  }, [handleDeleteNode])
  const pipelineActionInlinePanelStable = useCallback((actionId: string) => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) void handleNodePipelineActionRef.current(nodeId, actionId)
  }, [])
  const createOperationChildInlinePanelStable = useCallback(
    (
      operation: CanvasOperationType,
      options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
    ) => {
      const node = inlinePanelNodeRef.current
      const snap = snapshotRef.current
      if (!node || !snap) return
      void (async () => {
        const existingNodeIds = new Set(snap.nodes.map((item) => item.id))
        const next = await createOperationNode({
          boardId: snap.board.id,
          operation,
          inputNodeIds: [node.id],
          x: node.x + node.width + 60,
          y: node.y,
          ...(options?.title ? { title: options.title } : {}),
          ...(options?.prompt ? { systemPrompt: options.prompt } : {}),
          ...(options?.modelParams ? { modelParams: options.modelParams } : {}),
        })
        const created = findLatestCreatedOperationNode(
          next?.nodes ?? [],
          operation,
          existingNodeIds,
        )
        if (created) {
          setSelectedNodeIds([created.id])
          message.info('已创建并连接任务节点，双击或右键“编辑节点”可打开配置')
        }
      })()
    },
    [createOperationNode],
  )
  const setProductionStateInlinePanelStable = useCallback(
    (state: import('./canvas.types').CanvasProductionState) => {
      const nodeId = inlinePanelResourceNodeRef.current?.id
      if (nodeId) void handleSetProductionStateRef.current(nodeId, state)
    },
    [],
  )
  const mergeInlinePanelGroupStable = useCallback(() => {
    const nodeId = inlinePanelNodeRef.current?.id
    if (nodeId) void handleMergeGroupToImage(nodeId)
  }, [handleMergeGroupToImage])
  const dissolveInlinePanelGroupStable = useCallback(() => {
    handleDissolveGroup()
  }, [handleDissolveGroup])
  const saveInlinePanelToLibraryStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) setSaveToLibraryNodeId(nodeId)
  }, [])
  const annotateInlinePanelStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) setAnnotatingImageNodeId(nodeId)
  }, [])
  const splitInlinePanelGridStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (nodeId) setGridSplitImageNodeId(nodeId)
  }, [])

  /** 生成分镜脚本：剧本/文本节点 → 任务节点 → 分镜脚本产物节点（专用包装 + 血缘） */
  const handleGenerateShotScript = async (node: CanvasNode, sourceText: string) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法生成分镜脚本')
      return
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_generate',
      prompt: buildOpPrompt('screenplay.to_shot_script', {
        upstreamText: sourceText,
        ...(styleBible ? { styleBible } : {}),
        keepShotScriptPlaceholders: true,
      }),
      title: '生成分镜脚本',
      nodeMessage: '确认分镜脚本 Prompt、Agent 与模型后点击开始任务',
      taskPipelineRole: 'shot',
      outputPipelineRole: 'shot',
      shotScriptConfig: DEFAULT_SHOT_SCRIPT_CONFIG,
    })
  }

  /** 转剧本：章节/剧本/普通文本节点 → 待执行任务节点（用户编辑后手动开始） */
  const handlePrepareChapterToScreenplayOperation = async (
    node: CanvasNode,
    sourceText: string,
  ) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法转剧本')
      return
    }
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_rewrite',
      prompt: buildChapterToScreenplayInstruction(sourceText),
      title: '转剧本',
      nodeMessage: '确认 Prompt、Agent 与模型后点击开始任务',
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'screenplay',
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
    const snapshot = snapshotRef.current
    if (!snapshot) return
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

  /** 生成分镜关键帧图：优先消费当前分镜脚本文本，否则回退到项目最近的分镜分组 */
  const handleStoryboardGridFromNode = (sourceNode?: CanvasNode) => {
    if (sourceNode?.type === 'text') {
      const sourceText = (sourceNode.data.text ?? '').trim()
      const parsedRows = sourceText ? parseShotTable(sourceText) : []
      if (isShotScriptText(sourceText) && parsedRows.length >= 2) {
        void createConfiguredOperationNode({
          sourceNode,
          operation: 'storyboard_grid',
          title: '生成分镜关键帧图',
          prompt:
            '请根据输入的分镜脚本文本，生成一张分镜关键帧宫格图，保持镜头顺序、人物一致性与场景连续性。',
          nodeMessage: '确认故事板 Prompt、Agent 与模型后点击开始任务',
          taskPipelineRole: 'shot',
          outputPipelineRole: 'keyframe',
        })
        return
      }
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const film = readFilmData(snapshot.project.metadata)
    const groups = film?.shotGroups ?? []
    const group = groups[groups.length - 1]
    if (!group || group.segments.length === 0) {
      message.warning('暂无分镜片段，请先「生成分镜脚本」并导入分镜表，再生成分镜图')
      return
    }
    handleGenerateStoryboardGrid(group, { openPanel: false })
  }

  const prepareCanvasImageUpload = useCallback(
    async (file: File, options?: { grouped?: boolean }): Promise<PreparedImageUpload> => {
      const snapshot = snapshotRef.current
      if (!snapshot) throw new Error('画布尚未加载')
      const dataUrl = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(dataUrl)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl,
        mimeType: file.type,
        suggestedBaseName: file.name.replace(/\.[^.]+$/, '') || 'canvas-image',
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const nodeSize = options?.grouped
        ? fitGroupedImageNodeSize(dimensions.width, dimensions.height)
        : fitImageNodeSize(dimensions.width, dimensions.height)
      return {
        file,
        filePath: savedImage.filePath,
        width: nodeSize.width,
        height: nodeSize.height,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      }
    },
    [],
  )

  const insertPreparedImages = useCallback(
    async (
      preparedImages: PreparedImageUpload[],
      preferredPosition?: CanvasPoint | null,
    ): Promise<InsertPreparedImagesResult> => {
      if (preparedImages.length === 0) {
        return {
          createdNodeCount: 0,
          grouped: false,
          createdNodeIds: [],
          selectedNodeIds: [],
        }
      }
      if (preparedImages.length === 1) {
        const [image] = preparedImages
        if (!image) {
          return {
            createdNodeCount: 0,
            grouped: false,
            createdNodeIds: [],
            selectedNodeIds: [],
          }
        }
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
        return {
          createdNodeCount: node ? 1 : 0,
          grouped: false,
          createdNodeIds: node ? [node.id] : [],
          selectedNodeIds: node ? [node.id] : [],
          ...(node
            ? {
                occupiedBounds: {
                  left: position.x,
                  top: position.y,
                  right: position.x + image.width,
                  bottom: position.y + image.height,
                },
              }
            : {}),
        }
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
      const createdBounds: LayoutBounds[] = []
      let groupNodeId: string | undefined
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
        if (node) {
          createdNodeIds.push(node.id)
          createdBounds.push({
            left: image.x,
            top: image.y,
            right: image.x + image.width,
            bottom: image.y + image.height,
          })
        }
      }
      let selectedNodeIds = createdNodeIds.length === 1 ? createdNodeIds : []
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
        groupNodeId = groupNode?.id
        selectedNodeIds = groupNode ? [groupNode.id] : createdNodeIds
      }
      return {
        createdNodeCount: createdNodeIds.length,
        grouped: createdNodeIds.length > 1,
        createdNodeIds,
        selectedNodeIds,
        ...(createdBounds.length > 0
          ? {
              occupiedBounds:
                groupNodeId || createdNodeIds.length > 1
                  ? {
                      left: groupPosition.x,
                      top: groupPosition.y,
                      right: groupPosition.x + groupSize.width,
                      bottom: groupPosition.y + groupSize.height,
                    }
                  : mergeBounds(createdBounds),
            }
          : {}),
        ...(groupNodeId ? { groupNodeId } : {}),
      }
    },
    [createGroupNode, createImageNode],
  )

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      const snapshot = snapshotRef.current
      if (!snapshot || !event.clipboardData) return

      const imageFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const text = event.clipboardData.getData('text/plain').trim()
      if (imageFiles.length === 0 && !text) return

      event.preventDefault()
      event.stopPropagation()

      const preferredPosition = positionNodeInViewport(
        canvasViewportRef.current,
        imageFiles.length > 0 ? IMAGE_NODE_DEFAULT_SIZE : TEXT_NODE_DEFAULT_SIZE,
        { x: 200, y: 150 },
      )

      void (async () => {
        try {
          if (imageFiles.length > 0) {
            const preparedImages = await Promise.all(
              imageFiles.map((file) =>
                prepareCanvasImageUpload(file, { grouped: imageFiles.length > 1 }),
              ),
            )
            const result = await insertPreparedImages(preparedImages, preferredPosition)
            if (result.createdNodeCount > 0) {
              if (result.selectedNodeIds.length > 0) setSelectedNodeIds(result.selectedNodeIds)
              message.success(
                result.createdNodeCount === 1
                  ? '已粘贴图片到画布'
                  : `已粘贴 ${result.createdNodeCount} 张图片到画布`,
              )
            }
            return
          }

          const node = await createTextNode({
            text,
            x: preferredPosition.x,
            y: preferredPosition.y,
          })
          if (node) {
            setSelectedNodeIds([node.id])
            message.success('已粘贴文本到画布')
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '粘贴到画布失败')
        }
      })()
    }

    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [createTextNode, insertPreparedImages, prepareCanvasImageUpload])

  /**
   * 拖入外部文件到画布：按类型路由成节点。
   *  - 图片 → 复用图片上传管线（dataUrl → 入库 → 图片节点）
   *  - 文本（txt/md/json/源码…）→ 读出文字 → 文本节点
   *  - 视频/音频 → 复制进项目 assets → 媒体节点
   *  - 其余（pdf/docx…）→ 跳过并提示
   * 多文件按 drop 点原点级联排布。
   */
  const handleDropFiles = useCallback(
    async (position: CanvasPoint, files: File[]) => {
      const current = snapshotRef.current
      if (!current || files.length === 0) return
      closeCanvasFloatPanels()
      const origin = { x: Math.round(position.x), y: Math.round(position.y) }
      const projectRootPath = current.project.rootPath || undefined

      const images: File[] = []
      const texts: File[] = []
      const documents: File[] = []
      const media: Array<{ file: File; kind: 'video' | 'audio' }> = []
      let unsupportedCount = 0
      for (const file of files) {
        const kind = classifyDroppedFile(file)
        if (kind === 'image') images.push(file)
        else if (kind === 'text') texts.push(file)
        else if (kind === 'document') documents.push(file)
        else if (kind === 'video') media.push({ file, kind: 'video' })
        else if (kind === 'audio') media.push({ file, kind: 'audio' })
        else unsupportedCount += 1
      }

      const createdNodeIds: string[] = []
      let selectionNodeIds: string[] = []
      let nextOrigin = origin

      try {
        // ── 图片：复用现有上传管线（含多图分组） ──────────────────────────
        if (images.length > 0) {
          const prepared = await Promise.all(
            images.map((file) => prepareCanvasImageUpload(file, { grouped: images.length > 1 })),
          )
          const result = await insertPreparedImages(prepared, nextOrigin)
          for (const id of result.createdNodeIds) createdNodeIds.push(id)
          if (result.selectedNodeIds.length > 0) selectionNodeIds = result.selectedNodeIds
          if (result.occupiedBounds) nextOrigin = nextOriginAfterBounds(result.occupiedBounds)
        }

        // ── 文本：浏览器 File.text() 直接读，无需 IPC ──────────────────────
        if (texts.length > 0) {
          const positions = layoutDroppedFiles(texts.length, nextOrigin, TEXT_NODE_DEFAULT_SIZE)
          const successfulTextIds = Array<string | null>(texts.length).fill(null)
          await Promise.all(
            texts.map(async (file, index) => {
              const text = await file.text()
              const format = textFormatFromFileName(file.name)
              const node = await createTextNode({
                text,
                x: positions[index]!.x,
                y: positions[index]!.y,
                ...(format === 'markdown' ? { format: 'markdown' } : {}),
              })
              if (node) {
                createdNodeIds.push(node.id)
                successfulTextIds[index] = node.id
              }
            }),
          )
          const orderedTextIds = successfulTextIds.filter((id): id is string => Boolean(id))
          if (orderedTextIds.length > 0) {
            selectionNodeIds = [orderedTextIds[orderedTextIds.length - 1]!]
            const successfulTextPositions = successfulTextIds.flatMap((id, index) =>
              id ? [positions[index]!] : [],
            )
            nextOrigin = nextOriginAfterBounds(
              boundsForPlacements(successfulTextPositions, TEXT_NODE_DEFAULT_SIZE),
            )
          }
        }

        // ── 富文档（docx/xlsx/pptx/odt/rtf）：解析出文字后建文本节点 ──────
        //    解析依赖（mammoth/exceljs）懒加载、失败兜底为留档提示，详见 canvasDocumentParse.ts
        if (documents.length > 0) {
          const docPositions = layoutDroppedFiles(
            documents.length,
            nextOrigin,
            TEXT_NODE_DEFAULT_SIZE,
          )
          const successfulDocIds = Array<string | null>(documents.length).fill(null)
          await Promise.all(
            documents.map(async (file, index) => {
              const extracted = await extractDocumentText(file)
              const node = await createTextNode({
                text: extracted.text,
                x: docPositions[index]!.x,
                y: docPositions[index]!.y,
                ...(extracted.format === 'markdown' ? { format: 'markdown' } : {}),
              })
              if (node) {
                createdNodeIds.push(node.id)
                successfulDocIds[index] = node.id
              }
            }),
          )
          const orderedDocIds = successfulDocIds.filter((id): id is string => Boolean(id))
          if (orderedDocIds.length > 0) {
            selectionNodeIds = [orderedDocIds[orderedDocIds.length - 1]!]
            const successfulDocPositions = successfulDocIds.flatMap((id, index) =>
              id ? [docPositions[index]!] : [],
            )
            nextOrigin = nextOriginAfterBounds(
              boundsForPlacements(successfulDocPositions, TEXT_NODE_DEFAULT_SIZE),
            )
          }
        }

        // ── 视频/音频：复制进项目 assets 目录后建节点 ─────────────────────
        if (media.length > 0) {
          const mediaPositions = layoutDroppedFiles(
            media.length,
            nextOrigin,
            VIDEO_NODE_DEFAULT_SIZE,
          )
          const successfulMediaIds = Array<string | null>(media.length).fill(null)
          await Promise.all(
            media.map(async (entry, index) => {
              const electronPath = (entry.file as File & { path?: string }).path
              if (!electronPath) return // 非 Electron 环境拿不到磁盘路径，跳过
              const copyResult = await window.spark.invoke('canvas:asset:copy-to-project', {
                projectId,
                ...(projectRootPath ? { projectRootPath } : {}),
                sourcePath: electronPath,
                type: entry.kind,
              })
              if (copyResult.error || !copyResult.filePath) return
              const filePath = copyResult.filePath as string
              const fileUrl = encodeToSafeFileUrl(filePath)
              let mediaWidth: number | undefined
              let mediaHeight: number | undefined
              let durationMs: number | undefined
              if (entry.kind === 'video') {
                const dims = await readVideoDimensions(fileUrl)
                mediaWidth = dims.width || undefined
                mediaHeight = dims.height || undefined
                durationMs = dims.durationMs
              }
              const basePos = mediaPositions[index] ?? nextOrigin
              const node = await createMediaNode({
                kind: entry.kind,
                fileName: entry.file.name,
                ...(entry.file.type ? { fileMimeType: entry.file.type } : {}),
                fileSize: entry.file.size,
                filePath,
                x: basePos.x,
                y: basePos.y,
                ...(mediaWidth ? { mediaWidth } : {}),
                ...(mediaHeight ? { mediaHeight } : {}),
                ...(durationMs ? { durationMs } : {}),
              })
              if (node) {
                createdNodeIds.push(node.id)
                successfulMediaIds[index] = node.id
              }
            }),
          )
          const orderedMediaIds = successfulMediaIds.filter((id): id is string => Boolean(id))
          if (orderedMediaIds.length > 0) {
            selectionNodeIds = [orderedMediaIds[orderedMediaIds.length - 1]!]
          }
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '拖入文件到画布失败')
      }

      if (createdNodeIds.length > 0) {
        if (selectionNodeIds.length > 0) setSelectedNodeIds(selectionNodeIds)
        message.success(
          createdNodeIds.length === 1
            ? '已添加文件到画布'
            : `已添加 ${createdNodeIds.length} 个文件到画布`,
        )
      }
      if (unsupportedCount > 0) {
        message.warning(`已跳过 ${unsupportedCount} 个不支持的文件`)
      }
    },
    [
      projectId,
      closeCanvasFloatPanels,
      createTextNode,
      createMediaNode,
      insertPreparedImages,
      prepareCanvasImageUpload,
    ],
  )

  /**
   * 顶部工具栏「上传文件」按钮：弹原生多选文件选择器，选中后走与拖入相同的
   * handleDropFiles 管线（图片 / 视频 / 音频 / 文本 / 代码 / CSV 等全部支持），
   * 落点取当前视口中心附近。纯 renderer <input>，无需主进程 IPC。
   */
  const handleUploadFilesChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (selectedFiles.length === 0) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        TEXT_NODE_DEFAULT_SIZE,
        { x: 260, y: 200 },
      )
      await handleDropFiles(position, selectedFiles)
    },
    [handleDropFiles],
  )

  /**
   * 空白处右键 → 创建一个无上游的 AI 操作节点（用户后续自己连线）。
   * 不绑定 inputNodeIds，prompt 留空，由用户在操作面板填完后再运行。
   */
  const handleCreateOperationAtPosition = async (
    operation: CanvasOperationType,
    position: CanvasPoint,
    options?: { openPanel?: boolean },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    closeCanvasFloatPanels()
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation,
      inputNodeIds: [],
      x: Math.round(position.x),
      y: Math.round(position.y),
      message: '请在操作面板填写 Prompt / 连接输入节点后点击开始任务',
    })
    const created = findLatestCreatedOperationNode(next?.nodes ?? [], operation, existingNodeIds)
    if (created) {
      if (options?.openPanel === false) {
        setSelectedNodeIds([created.id])
        message.info('已创建并连接任务节点，双击或右键“编辑节点”可打开配置')
      } else {
        openOperationPanelForNode(created.id)
        message.info('已创建操作节点，请填写参数后连接输入并运行')
      }
    }
    return created
  }

  /**
   * 空白处右键 → 创建一个流水线编排任务节点（如「提取角色」「转剧本」等）。
   * 与「节点右键→流水线」等价，但不依赖源节点；Prompt 预填占位文案，
   * 让用户连入文本/剧本节点后再点开始任务。
   */
  const handleCreatePipelineAtPosition = async (
    actionId: string,
    position: CanvasPoint,
    options?: { openPanel?: boolean },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    closeCanvasFloatPanels()
    const op = CANVAS_PIPELINE_OPS.find((item) => item.id === actionId)
    if (!op) return
    if (op.kind !== 'text' && op.kind !== 'extract') {
      message.info('该编排需要先选中具体节点再触发')
      return
    }
    const operation: CanvasOperationType =
      op.baseOperation ?? (op.kind === 'extract' ? 'text_generate' : 'text_generate')
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const promptPlaceholder =
      op.kind === 'extract' && op.extractKind
        ? buildEntityExtractionPrompt(op.extractKind, '【请连接剧本/文本节点提供原文】')
        : op.id === 'screenplay.to_shot_script'
          ? buildOpPrompt('screenplay.to_shot_script', {
              upstreamText: '【请连接剧本/文本节点提供原文】',
              keepShotScriptPlaceholders: true,
            })
          : op.id === 'chapter.to_screenplay'
            ? buildChapterToScreenplayInstruction('【请连接章节/文本节点提供原文】')
            : ''
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation,
      inputNodeIds: [],
      x: Math.round(position.x),
      y: Math.round(position.y),
      title: op.label,
      ...(promptPlaceholder
        ? { systemPrompt: stripCanvasFunctionalPromptInput(promptPlaceholder, op.id) }
        : {}),
      message: '请连接上游文本节点并确认 Prompt 后开始任务',
      ...(op.produces ? { outputPipelineRole: op.produces } : {}),
      ...(op.id === 'screenplay.to_shot_script'
        ? { shotScriptConfig: DEFAULT_SHOT_SCRIPT_CONFIG }
        : {}),
      ...(op.kind === 'extract'
        ? { modelParams: { workflow: `extract_${op.extractKind}`, responseFormat: 'json' } }
        : {}),
    })
    const created = findLatestCreatedOperationNode(next?.nodes ?? [], operation, existingNodeIds)
    if (created) {
      if (options?.openPanel === false) {
        setSelectedNodeIds([created.id])
        message.info(`已创建并连接「${op.label}」节点，双击或右键“编辑节点”可打开配置`)
      } else {
        openOperationPanelForNode(created.id)
        message.info(`已创建「${op.label}」节点，请连接上游文本节点后运行`)
      }
    }
    return created
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
      userPrompt?: string
      promptSubmission?: CanvasPromptSubmission
      agentId?: string
      providerProfileId?: string
      modelId?: string
      reasoningEffort?: SessionReasoningEffort
      skillIds?: string[]
      modelParams?: Record<string, unknown>
      bindToNodeId?: string
      inputNodeIds?: string[]
      inputAssetIds?: string[]
    } = {},
  ) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法抽取')
      return
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const label = kind === 'character' ? '提取角色' : '提取场景'
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const extractionPrompt =
      options.promptSubmission?.prompt.trim() ||
      options.prompt?.trim() ||
      buildEntityExtractionPrompt(kind, sourceText, styleBible)
    const promptTaskFields = options.promptSubmission
      ? pickCanvasPromptTaskFields(options.promptSubmission)
      : {}
    const runtime = {
      ...resolveRuntimeFromNode(node),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.providerProfileId ? { providerProfileId: options.providerProfileId } : {}),
      ...(options.modelId ? { modelId: options.modelId } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.skillIds ? { skillIds: options.skillIds } : {}),
    }
    const extractionModelParams = {
      ...(options.modelParams ?? {}),
      workflow: `extract_${kind}`,
      responseFormat: 'json',
    }
    try {
      await runTrackedCanvasWorkflow(
        {
          title: label,
          prompt: extractionPrompt,
          ...(options.userPrompt !== undefined ? { userPrompt: options.userPrompt } : {}),
          inputNodeIds: options.inputNodeIds ?? [node.id],
          inputAssetIds: options.inputAssetIds ?? (node.assetId ? [node.assetId] : []),
          ...(options.bindToNodeId ? { bindToNodeId: options.bindToNodeId } : {}),
          message: `正在${label}...`,
          ...runtime,
          modelParams: extractionModelParams,
          ...promptTaskFields,
        },
        async () => {
          const response = await window.spark.invoke('canvas:task:generate-text', {
            ...(options.promptSubmission ?? {}),
            operation: 'text_generate',
            prompt: extractionPrompt,
            ...(runtime.agentId ? { agentId: runtime.agentId } : {}),
            ...(runtime.providerProfileId ? { providerProfileId: runtime.providerProfileId } : {}),
            ...(runtime.modelId ? { modelId: runtime.modelId } : {}),
            ...(runtime.reasoningEffort ? { reasoningEffort: runtime.reasoningEffort } : {}),
            ...(runtime.skillIds ? { skillIds: runtime.skillIds } : {}),
            modelParams: extractionModelParams,
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
          // 产物基点：相对「抽取任务节点」（= bindToNodeId 指向的操作节点）右侧排列，
          // 而不是相对源章节节点——避免堆在源节点上方 / 覆盖在操作节点上。
          const anchorNode =
            (options.bindToNodeId
              ? snapshot.nodes.find((item) => item.id === options.bindToNodeId)
              : null) ?? node
          const parentGroup = anchorNode.parentNodeId
            ? snapshot.nodes.find(
                (item) => item.id === anchorNode.parentNodeId && item.type === 'group',
              )
            : null
          const anchorRect = parentGroup
            ? {
                x: parentGroup.x + anchorNode.x,
                y: parentGroup.y + anchorNode.y,
                width: anchorNode.width,
                height: anchorNode.height,
              }
            : {
                x: anchorNode.x,
                y: anchorNode.y,
                width: anchorNode.width,
                height: anchorNode.height,
              }
          const entityPlacements = stackAutoNodesToRight(
            anchorRect,
            entities.map(() => TEXT_NODE_DEFAULT_SIZE),
          )
          let created = 0
          let failed = 0
          for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]!
            const placement = entityPlacements[i]
            if (!placement) continue
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
                x: placement.x,
                y: placement.y,
              })
              if (placed) {
                if (parentGroup) {
                  await patchNodes([placed.id], {
                    parentNodeId: parentGroup.id,
                    x: placement.x - parentGroup.x,
                    y: placement.y - parentGroup.y,
                  })
                }
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
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const kind = readAssetKind(asset)
    const title =
      kind === 'scene'
        ? '生成场景图'
        : kind === 'prop'
          ? '生成道具图'
          : kind === 'effect'
            ? '生成特效图'
            : '生成设计图'
    // 不直接发起任务：在画布上创建参考图生成任务节点，用户确认后开始
    void addFilmAssetTaskNode({
      operation: 'text_to_image',
      title: `${title} · ${asset.title ?? '未命名'}`,
      prompt: buildFilmAssetReferencePrompt(
        asset,
        buildProductionBiblePrompt(snapshot.project.metadata),
      ),
      ...(sourceNodeId ? { inputNodeIds: [sourceNodeId] } : {}),
      taskPipelineRole: 'design_card',
      outputPipelineRole: 'design_card',
    })
  }

  const handleGenerateCharacterSheets = (
    asset: CanvasAsset,
    aspects: CharacterSheetAspect[],
    sourceNodeId?: string,
  ) => {
    if (aspects.length === 0) return
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const character = assetToCharacterFields(asset)
    const stylePrompt =
      typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt : undefined
    // 一致性：若角色已有定妆/概念图在画布上，非身份板面向走 image_to_image 喂基准图保同一张脸（§S4/§9.1）
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
        aspect === 'turnaround' ? `生成角色身份板 · ${asset.title ?? '角色'}` : '生成角色图'
      const needsBase = getCharacterSheetTemplate(aspect)?.needsBaseImage ?? false
      // 角色身份板默认 16:9（综合卡横版构图）；其余面向维持现状不强制比例
      const sheetModelParams = aspect === 'turnaround' ? { aspect_ratio: '16:9' } : undefined
      // 不直接发起任务：为每一面在画布上创建一个独立的生成任务节点，用户统一在面板里确认
      if (needsBase && baseImageNode) {
        i2iCount += 1
        void addFilmAssetTaskNode({
          operation: 'image_to_image',
          title: sheetTitle,
          prompt,
          inputNodeIds: [baseImageNode.id],
          ...(sheetModelParams ? { modelParams: sheetModelParams } : {}),
          taskPipelineRole: 'design_card',
          outputPipelineRole: 'design_card',
          ...(aspect === 'turnaround' ? { outputTitle: asset.title ?? '角色' } : {}),
        })
      } else {
        void addFilmAssetTaskNode({
          operation: 'text_to_image',
          title: sheetTitle,
          prompt,
          ...(sourceNodeId ? { inputNodeIds: [sourceNodeId] } : {}),
          ...(sheetModelParams ? { modelParams: sheetModelParams } : {}),
          taskPipelineRole: 'design_card',
          outputPipelineRole: 'design_card',
          ...(aspect === 'turnaround' ? { outputTitle: asset.title ?? '角色' } : {}),
        })
      }
    }
    if (i2iCount > 0) {
      message.info(
        `已创建 ${aspects.length} 个角色图任务节点（其中 ${i2iCount} 个基于基准图保持一致），请在画布上确认配置后开始`,
      )
    }
  }

  /** 找角色的基准图节点：优先 concept 引用图，其次任意引用图，需在画布上有对应图片节点（§S4 一致性） */
  const findCharacterBaseImageNode = (asset: CanvasAsset): CanvasNode | undefined => {
    const snapshot = snapshotRef.current
    if (!snapshot) return undefined
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
    const snapshot = snapshotRef.current
    if (!snapshot) return []
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

  const handleGenerateSegmentVideo = (
    input: Parameters<NonNullable<FilmCenterHandlers['onGenerateSegmentVideo']>>[0],
    options?: { openPanel?: boolean },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const styleFragments = findSegmentStyleFragments(
      input.segment,
      readStylePresets(snapshot.project.metadata),
    )
    // 优先用关键帧 / 引用设定图作为首尾帧走图生视频（§S8 连贯性）；无锚点图则退化文生视频
    const anchorNodes = resolveSegmentAnchorImageNodes(input.segment, input.characters, input.scene)
    if (anchorNodes.length > 0) {
      void addFilmAssetTaskNode({
        operation: 'image_to_video',
        title: `生成视频 · 分镜 #${input.segment.index}`,
        prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
        // 取前两张：第一张→首帧，第二张→尾帧（buildTaskInputFiles 自动按序分配 role）
        inputNodeIds: anchorNodes.slice(0, 2).map((node) => node.id),
        ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
      })
      return
    }
    void addFilmAssetTaskNode({
      operation: 'text_to_video',
      title: `生成视频 · 分镜 #${input.segment.index}`,
      prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
      ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
    })
    message.info('未找到关键帧/设定图，请先在画布上配置基准图')
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
        const base = positionNodeInViewport(canvasViewportRef.current, TEXT_NODE_DEFAULT_SIZE, {
          x: 160,
          y: 140,
        })
        const perRow = 4
        let prevNodeId: string | null = null
        let created = 0
        const createdNodeIds: string[] = []
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i]!
          const placement = placeAutoGridNode(base, TEXT_NODE_DEFAULT_SIZE, i, perRow)
          const x = placement.x
          const y = placement.y
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

  const handleGenerateSegmentKeyframes = (
    input: Parameters<NonNullable<FilmCenterHandlers['onGenerateSegmentKeyframes']>>[0],
    options?: { openPanel?: boolean },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    const styleFragments = findSegmentStyleFragments(
      input.segment,
      readStylePresets(snapshot.project.metadata),
    )
    for (const frame of ['first', 'last'] as const) {
      void addFilmAssetTaskNode({
        operation: 'text_to_image',
        title:
          frame === 'first'
            ? `首帧 · 分镜 #${input.segment.index}`
            : `尾帧 · 分镜 #${input.segment.index}`,
        prompt: buildShotSegmentKeyframePrompt(input, frame, styleBible, styleFragments),
        ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
      })
    }
  }

  const handleGenerateStoryboardGrid = (
    group: Parameters<NonNullable<FilmCenterHandlers['onGenerateStoryboardGrid']>>[0],
    options?: { openPanel?: boolean },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
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
    void addFilmAssetTaskNode({
      operation: 'storyboard_grid',
      title: `分镜图（宫格）· ${group.name}`,
      prompt,
      ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
    })
  }

  const handleRetryTask = async (task: CanvasTask) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const taskNode = snapshot.nodes.find((node) => node.taskId === task.id)
    // 失败/取消的任务如果存在关联的操作节点，则绑定到原节点重试，
    // 这样原节点的状态会立即刷新为「运行中」，而不是留下一个显示「失败」的旧节点。
    if (taskNode && isOperationNode(taskNode)) {
      const viewportBeforeRetry = await persistCurrentCanvasViewport()
      try {
        await retryOperationNode(taskNode.id)
      } finally {
        restoreCanvasViewport(viewportBeforeRetry)
      }
      return
    }
    const viewportBeforeRetry = await persistCurrentCanvasViewport()
    const inputNodes = expandCanvasInputNodes(
      snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id)),
      snapshot.nodes,
    )
    const inputFiles = await buildCloudTaskInputFiles(
      inputNodes,
      task.provider === 'xai' ? 'base64' : 'cloud_url',
      task.operation === 'storyboard_grid'
        ? buildStoryboardReferenceInputRoles(inputNodes)
        : undefined,
    )
    const placement = placeNodeRightOfNodes(taskNode ? [taskNode] : inputNodes, {
      x: 360,
      y: 260,
    })
    await runWithCanvasTaskViewport(
      () => viewportBeforeRetry,
      restoreCanvasViewport,
      () =>
        createTask({
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
        }),
    )
  }

  const handleToggleLock = async () => {
    if (selectedNodes.length === 0) return
    const shouldLock = selectedNodes.some((node) => !node.locked)
    await patchNodes(selectedNodeIds, { locked: shouldLock })
  }

  const handleBringToFront = async () => {
    if (selectedNodes.length === 0) return
    const snapshot = snapshotRef.current
    if (!snapshot) return
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

  const operationPanelSnapshotSigRef = useRef('')
  const operationPanelSnapshotCacheRef = useRef(snapshot)
  const operationPanelSnapshot = useMemo(() => {
    if (!snapshot || !activeOperationNode) return snapshot
    const sig = buildOperationPanelSnapshotSignature(snapshot, activeOperationNode.id)
    if (sig === operationPanelSnapshotSigRef.current && operationPanelSnapshotCacheRef.current) {
      return operationPanelSnapshotCacheRef.current
    }
    operationPanelSnapshotSigRef.current = sig
    operationPanelSnapshotCacheRef.current = snapshot
    return snapshot
  }, [activeOperationNode, snapshot])

  const floatingEditorPanel =
    snapshot && inlinePanelNode ? (
      activeOperationNode ? (
        (() => {
          const opNode = activeOperationNode
          const opTask = opNode.taskId
            ? snapshot.tasks.find((task) => task.id === opNode.taskId)
            : null
          return (
            <CanvasOperationWorkbench
              key={opNode.id}
              node={opNode}
              snapshot={snapshot}
              onSaveOutput={handleSaveNodeEdit}
              onDownloadOutput={(nodeId) => void handleDownloadMediaNode(nodeId)}
              onPreviewPanoramaOutput={handlePreviewPanorama}
              onOpenAssetLibrary={() => setSidePanelTab('assets')}
              onSetPrimaryOutput={(output) => handleSetOperationPrimaryOutput(opNode.id, output)}
              onExpandOutputs={(outputs) => handleExpandOperationOutputs(opNode.id, outputs)}
              onDeleteOutputs={(outputs) => handleDeleteOperationOutputs(opNode.id, outputs)}
              configPanel={
                <CanvasOperationPanel
                  node={opNode}
                  snapshot={operationPanelSnapshot ?? snapshot}
                  placement="inline"
                  fullscreen={inlineOperationFullscreen}
                  onFullscreenChange={setInlineOperationFullscreen}
                  {...(opTask ? { task: opTask } : {})}
                  onClose={() => {
                    setActiveOperationPanelNodeId(null)
                    setSelectedNodeIds([])
                  }}
                  onRun={async (params) => {
                    const viewportBeforeRun = await persistCurrentCanvasViewport()
                    const taskInputNodes = resolveCanvasInputNodes(
                      params.inputNodeIds,
                      snapshot.nodes,
                    )
                    const hydratedTaskInputNodes = hydrateTextInputNodes(
                      taskInputNodes,
                      snapshot.assets,
                    )
                    const workflow =
                      opTask && typeof opTask.modelParams?.workflow === 'string'
                        ? opTask.modelParams.workflow
                        : ''
                    // 统一行为：先收起弹窗，再继续执行任务，避免提交后弹窗长时间不关。
                    const closePanel = () => {
                      setActiveOperationPanelNodeId(null)
                      setSelectedNodeIds([])
                    }
                    if (workflow === 'extract_character' || workflow === 'extract_scene') {
                      const sourceNode = hydratedTaskInputNodes[0]
                      if (!sourceNode) {
                        message.warning('该抽取节点缺少原始输入，无法重新执行')
                        return
                      }
                      const sourceText = hydratedTaskInputNodes
                        .map((inputNode) => {
                          const asset = inputNode.assetId
                            ? snapshot.assets.find((item) => item.id === inputNode.assetId)
                            : undefined
                          return (asset?.contentText ?? inputNode.data.text ?? '').trim()
                        })
                        .filter(Boolean)
                        .join('\n\n')
                      const operation = (opNode.data.operation ??
                        opNode.type) as CanvasOperationType
                      const promptDocument =
                        params.promptDocument ??
                        migrateLegacyPrompt({
                          prompt: params.prompt,
                          nodes: snapshot.nodes,
                          assets: snapshot.assets,
                        })
                      const extractSystemPrompt =
                        params.systemPrompt?.trim() ||
                        buildCanvasOperationSystemPrompt(
                          operation,
                          readCanvasResolvedPresetTarget(
                            resolveCanvasPresetTarget({
                              operation,
                              taskPipelineRole: opNode.data.pipelineRole ?? null,
                              outputPipelineRole: opNode.data.outputPipelineRole ?? null,
                              workflow: params.modelParams?.workflow,
                            }),
                          ).prompt,
                        )
                      const promptSubmission = await buildCanvasPromptSubmission({
                        document: promptDocument,
                        snapshot,
                        operation,
                        ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                        ...(extractSystemPrompt ? { systemPrompt: extractSystemPrompt } : {}),
                        ...(params.inputTransport ? { inputTransport: params.inputTransport } : {}),
                      })
                      closePanel()
                      void handleExtractEntities(
                        sourceNode,
                        sourceText,
                        workflow === 'extract_character' ? 'character' : 'scene',
                        {
                          prompt: promptSubmission.prompt,
                          userPrompt: params.prompt,
                          promptSubmission,
                          ...(params.agentId ? { agentId: params.agentId } : {}),
                          ...(params.providerProfileId
                            ? { providerProfileId: params.providerProfileId }
                            : {}),
                          ...(params.modelId ? { modelId: params.modelId } : {}),
                          ...(params.reasoningEffort
                            ? { reasoningEffort: params.reasoningEffort }
                            : {}),
                          ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                          ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                          bindToNodeId: opNode.id,
                          ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                          inputAssetIds: taskInputNodes
                            .map((item) => item.assetId)
                            .filter((id): id is string => Boolean(id)),
                        },
                      )
                      restoreCanvasViewport(viewportBeforeRun)
                      return
                    }
                    // 普通操作（文本/图片/视频生成等）：先收起弹窗，再异步提交任务。
                    closePanel()
                    const operation = (opNode.data.operation ?? opNode.type) as CanvasOperationType
                    const presetTargetId = resolveCanvasPresetTarget({
                      operation,
                      taskPipelineRole: opNode.data.pipelineRole ?? null,
                      outputPipelineRole: opNode.data.outputPipelineRole ?? null,
                      workflow: params.modelParams?.workflow ?? opNode.data.modelParams?.workflow,
                    })
                    const effectiveInputRoles =
                      operation === 'storyboard_grid'
                        ? buildStoryboardReferenceInputRoles(
                            hydratedTaskInputNodes,
                            params.inputRoles,
                          )
                        : params.inputRoles
                    const promptDocument =
                      params.promptDocument ??
                      migrateLegacyPrompt({
                        prompt: params.prompt,
                        nodes: snapshot.nodes,
                        assets: snapshot.assets,
                      })
                    const resolvedPreset = readCanvasResolvedPresetTarget(presetTargetId)
                    const systemPrompt =
                      params.systemPrompt?.trim() ||
                      buildCanvasOperationSystemPrompt(operation, resolvedPreset.prompt)
                    const promptSubmission = await buildCanvasPromptSubmission({
                      document: promptDocument,
                      snapshot,
                      operation,
                      ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                      ...(systemPrompt ? { systemPrompt } : {}),
                      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                      ...(params.inputTransport ? { inputTransport: params.inputTransport } : {}),
                      ...(effectiveInputRoles ? { inputRoles: effectiveInputRoles } : {}),
                    })
                    const inputFiles = promptSubmission.inputFiles ?? []
                    const effectivePrompt =
                      promptSubmission.prompt ||
                      (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : '')
                    // 分镜任务：用用户配置的每镜最长时间替换 prompt 占位槽 {maxClip}。
                    const finalPrompt = params.shotScriptConfig
                      ? applyShotScriptConfigToPrompt(effectivePrompt, params.shotScriptConfig)
                      : effectivePrompt
                    const styleContext = buildCanvasStyleContext(snapshot, {
                      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                      ...(params.modelParams && Object.keys(params.modelParams).length > 0
                        ? { modelParams: params.modelParams }
                        : {}),
                    })
                    const styledTask = applyCanvasStyleToTask(
                      operation,
                      {
                        prompt: finalPrompt,
                        ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                        ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                      },
                      styleContext,
                    )
                    writeCanvasLastUsedPresetTarget(presetTargetId, {
                      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                      ...(params.agentId ? { agentId: params.agentId } : {}),
                      ...(params.providerProfileId
                        ? { providerProfileId: params.providerProfileId }
                        : {}),
                      ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                      ...(params.modelId ? { modelId: params.modelId } : {}),
                      ...(params.reasoningEffort
                        ? { reasoningEffort: params.reasoningEffort }
                        : {}),
                      ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                      ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                    })
                    try {
                      await runOperationNode(opNode.id, {
                        ...promptSubmission,
                        prompt: styledTask.prompt,
                        compiledUserText: styledTask.prompt,
                        ...(styledTask.negativePrompt
                          ? { negativePrompt: styledTask.negativePrompt }
                          : {}),
                        ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
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
                        ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                        ...(Object.keys(styledTask.modelParams).length > 0
                          ? { modelParams: styledTask.modelParams }
                          : {}),
                        userPrompt: params.prompt,
                      })
                    } finally {
                      restoreCanvasViewport(viewportBeforeRun)
                    }
                    // 分镜时长配置写回 node.data，保证下次打开面板回显用户选择
                    // （runOperationNode 的 task 同步白名单不含 shotScriptConfig）。
                    if (params.shotScriptConfig) {
                      await updateNodeData(opNode.id, {
                        ...opNode.data,
                        shotScriptConfig: params.shotScriptConfig,
                      })
                    }
                  }}
                  onRetry={async () => {
                    const viewportBeforeRetry = await persistCurrentCanvasViewport()
                    try {
                      await retryOperationNode(opNode.id)
                    } finally {
                      restoreCanvasViewport(viewportBeforeRetry)
                    }
                  }}
                  onCancelTask={async (taskId) => {
                    await cancelTask(taskId)
                  }}
                  onSaveDraft={async (params) => {
                    const operation = (opNode.data.operation ?? opNode.type) as CanvasOperationType
                    const presetTargetId = resolveCanvasPresetTarget({
                      operation,
                      taskPipelineRole: opNode.data.pipelineRole ?? null,
                      outputPipelineRole: opNode.data.outputPipelineRole ?? null,
                      workflow: params.modelParams?.workflow ?? opNode.data.modelParams?.workflow,
                    })
                    await patchNodes([opNode.id], { title: params.title })
                    const nextNodeData = {
                      ...opNode.data,
                      ...(params.promptDocument ? { promptDocument: params.promptDocument } : {}),
                      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
                      negativePrompt: params.negativePrompt,
                      message: params.message,
                      modelParams: params.modelParams,
                      ...(params.agentId ? { agentId: params.agentId } : {}),
                      ...(params.providerProfileId
                        ? { providerProfileId: params.providerProfileId }
                        : {}),
                      ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                      ...(params.modelId ? { modelId: params.modelId } : {}),
                      ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                      ...(params.shotScriptConfig
                        ? { shotScriptConfig: params.shotScriptConfig }
                        : {}),
                    }
                    if (params.prompt.trim()) {
                      nextNodeData.prompt = params.prompt
                    } else {
                      delete nextNodeData.prompt
                    }
                    await updateNodeData(opNode.id, nextNodeData)
                    writeCanvasLastUsedPresetTarget(presetTargetId, {
                      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                      ...(params.agentId ? { agentId: params.agentId } : {}),
                      ...(params.providerProfileId
                        ? { providerProfileId: params.providerProfileId }
                        : {}),
                      ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                      ...(params.modelId ? { modelId: params.modelId } : {}),
                      ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                      ...(params.modelParams ? { modelParams: params.modelParams } : {}),
                    })
                  }}
                />
              }
            />
          )
        })()
      ) : (
        <CanvasNodeEditModal
          node={editingNode}
          open={Boolean(editingNodeId)}
          assets={snapshot.assets}
          tasks={snapshot.tasks}
          placement="inline"
          onClose={() => {
            setEditingNodeId(null)
            setSelectedNodeIds([])
          }}
          onSave={handleSaveNodeEdit}
        />
      )
    ) : null

  if (loading) {
    return (
      <div className="canvas-workspace canvas-uiux-v4 canvas-workspace-loading">
        <Spin description="正在加载画布..." />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="canvas-workspace canvas-uiux-v4 canvas-workspace-loading">
        <Empty description="画布不存在" />
      </div>
    )
  }

  return (
    <div className="canvas-workspace canvas-uiux-v4">
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
            {/* 菜单隐藏时取代 shell-titlebar 的恢复按钮，与 header 共用同一条拖拽区。
                显隐由 CSS 根据根节点的 .sidebar-hidden 状态控制，画布组件不耦合 sidebar 逻辑。 */}
            {showSidebarExpandButton && (
              <span className="canvas-workspace-sidebar-expand">
                <SidebarExpandButton />
              </span>
            )}
            <Button
              size="middle"
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
        </div>
        <CanvasToolbar
          saveState={{ dirty, saving, autoSaving, autoSaveEnabled }}
          selectedCount={selectedNodeIds.length}
          arranging={arrangingCanvas}
          onArrange={handleArrangeCanvas}
          onSave={() => void doSave()}
          onAutoSaveChange={handleAutoSaveToggle}
          onExport={() => void handleExportProject()}
          onUploadFiles={() => uploadFilesInputRef.current?.click()}
        />
      </header>

      <div className="canvas-workspace-body" style={sidePanelStyle}>
        <button
          type="button"
          className={`canvas-agent-side-panel-collapse-toggle${agentOpen ? '' : ' is-collapsed'}`}
          onClick={() => setAgentOpen((current) => !current)}
          aria-label={agentOpen ? '折叠画布助手' : '展开画布助手'}
          title={agentOpen ? '折叠画布助手' : '展开画布助手'}
        >
          {agentOpen ? <Icons.ChevronLeft size={16} /> : <Icons.ChevronRight size={16} />}
        </button>
        <aside className={`canvas-agent-side-panel${agentOpen ? '' : ' is-collapsed'}`}>
          <div
            aria-label="调整助手面板宽度"
            aria-orientation="vertical"
            className="canvas-agent-side-panel-resize-handle"
            onPointerDown={handleAgentPanelResizeStart}
          />
          <CanvasAgentModal
            open={agentOpen}
            onClose={() => setAgentOpen(false)}
            snapshot={snapshot}
            selectedNodes={selectedNodes}
            nodeRefs={agentNodeRefs}
            onRemoveNodeRef={(nodeId) =>
              setAgentNodeRefs((prev) => prev.filter((node) => node.id !== nodeId))
            }
            onClearNodeRefs={() => setAgentNodeRefs([])}
            onWideModeChange={handleAgentWideMode}
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
              deleteEdges,
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
        </aside>
        <div
          className={`canvas-stage-area${agentOpen ? ' is-agent-open' : ''}`}
          onPointerMoveCapture={suppressCanvasGestureWhileAgentOpen}
          onDragOverCapture={suppressCanvasGestureWhileAgentOpen}
          onDropCapture={suppressCanvasGestureWhileAgentOpen}
        >
          <div className="canvas-stage-quick-actions">
            <CanvasPresetHubEntry
              configuredPresetCount={configuredPresetCount}
              onOpen={() => setPresetModalOpen(true)}
              variant="floating"
            />
          </div>
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
            onNodesPersist={(nodes) => updateNodes(nodes)}
            onUpdateNodeData={(nodeId, data) => void updateNodeData(nodeId, data)}
            onConnectNodes={connectNodes}
            onDeleteEdges={(edgeIds) => void deleteEdges(edgeIds)}
            onDuplicateNode={handleDuplicateNode}
            onDeleteNode={handleDeleteNode}
            onDownloadMediaNode={(nodeId) => void handleDownloadMediaNode(nodeId)}
            onToggleLockNode={handleToggleLockNode}
            onBringNodeToFront={handleBringNodeToFront}
            onMergeGroupToImage={handleMergeGroupToImage}
            onMergeSelectionToImage={() => void handleMergeSelectionToImage()}
            onCreateGroupFromSelection={handleCreateGroup}
            onAddSelectionToGroup={handleAddSelectionToGroup}
            onRemoveNodeFromGroup={(nodeId) => handleRemoveFromGroup([nodeId])}
            onDissolveGroup={handleDissolveGroup}
            onDuplicateSelectedNodes={() => void duplicateNodes(selectedNodeIds)}
            onToggleLockSelectedNodes={() => void handleToggleLock()}
            onBringSelectedNodesToFront={() => void handleBringToFront()}
            onAddNodesToAgent={handleAddSelectedToAgent}
            onAddNodeToAgent={handleAddNodeToAgent}
            onOpenAiComposer={handleOpenInlineAi}
            onEditNode={handleEditNode}
            onEditVideo={handleEditVideo}
            onExpandOperationOutputs={handleExpandLatestOperationOutputs}
            onPreviewPanorama={handlePreviewPanorama}
            onSaveNodeToLibrary={onSaveNodeToLibraryStable}
            onAnnotateImage={onAnnotateImageStable}
            onSplitGridImage={onSplitGridImageStable}
            onSplitStoryboard={(nodeId) => void handleSplitStoryboard(nodeId)}
            onExtractCharacterSubview={onExtractCharacterSubviewStable}
            onCreateOperationChild={onCreateOperationChildStable}
            onPipelineAction={onPipelineActionStable}
            onSetProductionState={onSetProductionStateStable}
            onAddTextAtPosition={addText}
            onAddImageAtPosition={uploadFirstImage}
            onDropFiles={handleDropFiles}
            onAddPromptAtPosition={addPrompt}
            onAddDirectorStageAtPosition={addDirectorStage}
            onAddDirectorStage3DAtPosition={addDirectorStage3D}
            onInsertAssetFromPane={onInsertAssetFromPaneStable}
            onCreateOperationAtPosition={handleCreateOperationAtPosition}
            onCreatePipelineAtPosition={handleCreatePipelineAtPosition}
            onNodeSelectIntent={handleNodeSelectIntent}
            onViewportChange={handleCanvasViewportChange}
            onViewportControlsChange={handleCanvasViewportControlsChange}
            onDeleteSelectedNodes={handleDeleteSelectedNodes}
          />
          {inlinePanelNode && floatingEditorPanel && (
            <div
              className="canvas-node-bottom-editor nodrag nopan"
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="canvas-node-bottom-editor-toolbar">
                <CanvasFloatingNodeToolbar
                  node={inlinePanelNode}
                  resourceNode={inlinePanelResourceNode ?? undefined}
                  isOperation={Boolean(activeOperationNode)}
                  operationFullscreen={inlineOperationFullscreen}
                  onOperationFullscreenChange={setInlineOperationFullscreen}
                  onClose={closeFloatingEditorStable}
                  onFocus={focusInlinePanelNodeStable}
                  onDuplicate={duplicateInlinePanelNodeStable}
                  onToggleLock={toggleLockInlinePanelNodeStable}
                  onBringToFront={bringInlinePanelNodeToFrontStable}
                  onSaveToLibrary={saveInlinePanelToLibraryStable}
                  onDownload={downloadInlinePanelNodeStable}
                  onAnnotate={annotateInlinePanelStable}
                  onSplitGrid={splitInlinePanelGridStable}
                  onExtractCharacterSubview={extractCharacterSubviewInlinePanelStable}
                  onPreviewPanorama={previewInlinePanelPanoramaStable}
                  onOpenInlineAi={openInlinePanelAiStable}
                  onEditNode={editInlinePanelNodeStable}
                  onDelete={deleteInlinePanelNodeStable}
                  onPipelineAction={pipelineActionInlinePanelStable}
                  onCreateOperationChild={createOperationChildInlinePanelStable}
                  onSetProductionState={setProductionStateInlinePanelStable}
                  onMergeGroup={mergeInlinePanelGroupStable}
                  onDissolveGroup={dissolveInlinePanelGroupStable}
                />
              </div>
              <div className="canvas-node-bottom-editor-panel canvas-node-floating-panel">
                {floatingEditorPanel}
              </div>
            </div>
          )}
          <CanvasBottomDock
            activeTool={activeTool}
            onToolChange={handleToolChange}
            onAddNodeItem={handleAddNodeItem}
            onOpenAddMenu={() => closeCanvasFloatPanels()}
            onOpenFilmCenter={() => {
              closeCanvasFloatPanels('film-center')
              setFilmCenterOpen(true)
            }}
            onOpenCharacterLibrary={() => {
              closeCanvasFloatPanels('character-library')
              setCharacterLibraryOpen(true)
            }}
            onOpenShotDirector={() => {
              closeCanvasFloatPanels('shot-director')
              setShotDirectorOpen(true)
            }}
            onAddDirectorStage3D={() => {
              closeCanvasFloatPanels()
              void addDirectorStage3D()
            }}
            onAddVideoWorkbench={() => {
              closeCanvasFloatPanels()
              // 选中视频节点时直接打开其工作台；否则新建空工作台（进去后点「添加视频」）
              const selected = snapshot?.nodes.find((n) => selectedNodeIds.includes(n.id))
              if (
                selected &&
                (selected.type === 'video' || selected.data.subtype === 'video_workbench')
              ) {
                setVideoWorkbenchNodeId(selected.id)
              } else {
                void addVideoWorkbench()
              }
            }}
            onOpenAgent={() => {
              closeCanvasFloatPanels('agent')
              setAgentOpen(true)
            }}
            onUndo={() => void handleUndoCanvasChange()}
            onRedo={() => void handleRedoCanvasChange()}
            onToggleGrid={handleToggleGrid}
            onOpenShortcutHelp={() => setShortcutHelpOpen(true)}
            onFitView={handleFitCanvasView}
            onCenterSelected={handleCenterSelectedNode}
            gridVisible={snapshot.board.settings.grid === true}
            canUndo={canUndo}
            canRedo={canRedo}
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
          <CanvasImageAnnotationModal
            open={Boolean(annotatingImageNode)}
            node={annotatingImageNode}
            onCancel={() => setAnnotatingImageNodeId(null)}
            onComplete={(input) => void handleAnnotateImageComplete(input)}
          />
          <CanvasGridSplitModal
            open={Boolean(gridSplitImageNode)}
            node={gridSplitImageNode}
            onCancel={() => setGridSplitImageNodeId(null)}
            onComplete={(input) => void handleGridSplitComplete(input)}
          />
          <CanvasCharacterSubviewEditor
            key={`${characterSubviewEditorContext?.node.id ?? 'none'}:${characterSubviewEditorContext?.ownerAsset.id ?? 'none'}:${characterSubviewEditorContext?.subviews.map((item) => item.id).join(',') ?? 'empty'}`}
            open={Boolean(characterSubviewEditorContext)}
            ownerAsset={characterSubviewEditorContext?.ownerAsset ?? null}
            sourceImageAsset={characterSubviewEditorContext?.sourceImageAsset ?? null}
            initialSubviews={characterSubviewEditorContext?.subviews ?? []}
            onClose={() => setCharacterSubviewEditorNodeId(null)}
            onInsertSubview={async (subview) => {
              const context = characterSubviewEditorContext
              if (!context) return
              await handleApplyCharacterSubview(
                context.ownerAsset,
                context.sourceImageAsset,
                subview,
              )
            }}
            onSave={async (nextSubviews) => {
              const context = characterSubviewEditorContext
              if (!context) return
              await updateFilmAsset(context.ownerAsset.id, { characterSubviews: nextSubviews })
              message.success('子视图已更新')
            }}
            zIndex={1500}
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
          <CanvasPanoramaViewerModal
            node={panoramaPreviewNode}
            open={Boolean(panoramaPreviewNode)}
            onClose={() => setPanoramaPreviewNodeId(null)}
            onScreenshot={handlePanoramaScreenshot}
            onCrop={handlePanoramaCrop}
          />
          <CanvasDirectorStageModal
            key={directorStageNode?.id}
            node={directorStageNode}
            open={Boolean(directorStageNode)}
            onClose={() => setDirectorStageNodeId(null)}
            onSave={handleSaveDirectorStage}
            onInsertPrompt={handleInsertDirectorStagePrompt}
            onExportFraming={handleInsertDirectorStageScreenshot}
          />
          <CanvasDirectorStage3DModal
            key={directorStage3DNode?.id}
            node={directorStage3DNode}
            open={Boolean(directorStage3DNode)}
            onClose={() => setDirectorStage3DNodeId(null)}
            onSave={handleSaveDirectorStage3D}
            imageNodes={stage3dImageNodes}
            characterNodes={stage3dCharacterNodes}
            onInsertPrompt={handleInsertStage3DPrompt}
            onExportScreenshot={handleInsertStage3DScreenshot}
            onExportScreenshots={handleInsertStage3DScreenshots}
          />
          <CanvasVideoWorkbenchModal
            key={videoWorkbenchNode?.id}
            node={videoWorkbenchNode}
            open={Boolean(videoWorkbenchNode)}
            onClose={() => setVideoWorkbenchNodeId(null)}
            onSave={handleSaveVideoWorkbench}
            onExportKeyframes={handleExportKeyframes}
            onAddVideo={handleAddVideoToWorkbench}
            onSelectVideo={handleSelectVideoFromCanvas}
            videoNodes={videoNodesForWorkbench}
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
                // AI 优化：在画布上创建一个待执行的操作节点，用户确认 Prompt / Agent / 模型后开始
                const sourceText = asset.contentText ?? asset.title ?? ''
                void addFilmAssetTaskNode({
                  operation: 'text_rewrite',
                  title: `AI 优化 · ${asset.title ?? '资产'}`,
                  prompt: sourceText
                    ? `请优化以下内容，使其更专业、更精炼：\n\n${sourceText}`
                    : '请优化以下内容，使其更专业、更精炼。',
                })
              },
              onBreakdownScriptAsset: handleBreakdownScriptAsset,
              onImportManuscript: handleImportManuscript,
              onOptimizeManuscriptDraft: (text) => {
                const source = text.trim()
                if (!source) {
                  message.warning('请先输入需要优化的文稿')
                  return
                }
                void addFilmAssetTaskNode({
                  operation: 'prompt_optimize',
                  title: 'AI 优化 · 导入文稿',
                  prompt: buildPromptOptimizationInstruction(source, ''),
                })
                message.info('已发起文稿 AI 优化任务，结果会生成到画布上')
              },
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
          <CanvasCharacterLibraryPanel
            open={characterLibraryOpen}
            onClose={() => setCharacterLibraryOpen(false)}
            snapshot={snapshot}
            onInsertCharacterImage={handleInsertCharacterImage}
            onApplyCharacterSubview={handleApplyCharacterSubview}
            onUpdateCharacterSubviews={handleUpdateCharacterSubviews}
          />
        </div>
        <button
          type="button"
          className={`canvas-side-panel-collapse-toggle${sidePanelCollapsed ? ' is-collapsed' : ''}`}
          onClick={() => setSidePanelCollapsed((current) => !current)}
          aria-label={sidePanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
          title={sidePanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
          aria-keyshortcuts="Meta+Backslash Control+Backslash"
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
                  setSidePanelTab(value as 'details' | 'tasks' | 'assets' | 'project')
                }
                options={[
                  { label: '属性', value: 'details' },
                  { label: '任务', value: 'tasks' },
                  { label: '资产', value: 'assets' },
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
            </div>
            {sidePanelTab === 'details' && (
              <div className="canvas-side-panel-content">
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
                  onPatchNodeData={(node, data) => {
                    void updateNodeData(node.id, data)
                  }}
                />
              </div>
            )}
            {sidePanelTab === 'tasks' && (
              <div className="canvas-side-panel-content">
                <CanvasTaskQueue
                  tasks={snapshot.tasks}
                  nodes={snapshot.nodes}
                  assets={snapshot.assets}
                  onCancelTask={(taskId) => void cancelTask(taskId)}
                  onClearTasks={(scope) => void clearTasks(scope)}
                  onDeleteTasks={(taskIds) => void deleteTasks(taskIds)}
                  onRetryTask={(task) => void handleRetryTask(task)}
                  onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])}
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
                  onInsertSubview={(ownerAsset, sourceImageAsset, subview) =>
                    void handleApplyCharacterSubview(ownerAsset, sourceImageAsset, subview)
                  }
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
            {sidePanelTab === 'project' && (
              <div className="canvas-side-panel-content">
                <CanvasProjectInfoPanel
                  key={`${snapshot.project.id}:${snapshot.project.updatedAt}:project-info`}
                  project={snapshot.project}
                  configuredPresetCount={configuredPresetCount}
                  onOpenProjectFolder={handleOpenProjectFolder}
                  onOpenPresetCenter={() => setPresetModalOpen(true)}
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
        size="default"
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
        size="default"
        styles={{ body: { padding: 0 } }}
      >
        <CanvasTemplatePanel onApply={(template) => void handleApplyTemplate(template)} />
      </Drawer>
      <CanvasOperationPresetModal
        open={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        onPresetCountChange={setConfiguredPresetCount}
      />
      <Modal
        open={shortcutHelpOpen}
        title={null}
        footer={null}
        width="min(96vw, 1320px)"
        centered={false}
        className="canvas-shortcut-help-modal"
        wrapClassName="canvas-shortcut-help-wrap"
        onCancel={() => setShortcutHelpOpen(false)}
      >
        <div className="canvas-shortcut-help">
          <button
            type="button"
            className="canvas-shortcut-help-close"
            aria-label="关闭画布快捷键帮助"
            onClick={() => setShortcutHelpOpen(false)}
          >
            <Icons.X size={26} />
          </button>
          <div className="canvas-shortcut-help-grid">
            {CANVAS_SHORTCUT_HELP_GROUPS.map((group) => (
              <section key={group.title} className="canvas-shortcut-help-column">
                <h3>{group.title}</h3>
                <div className="canvas-shortcut-help-list">
                  {group.items.map((item) => (
                    <div key={`${group.title}:${item.desc}`} className="canvas-shortcut-help-row">
                      <span>{item.desc}</span>
                      <span className="canvas-shortcut-help-keys">
                        {item.keys.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Modal>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void handleFileChange(event)}
      />
      <input
        ref={uploadFilesInputRef}
        type="file"
        multiple
        // accept 留宽：图片/视频/音频/文本/代码/CSV 等都放行；不支持的类型由
        // classifyDroppedFile 判为 unsupported 并提示跳过，而不是在这里用 accept 硬挡。
        style={{ display: 'none' }}
        onChange={(event) => void handleUploadFilesChange(event)}
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
        mask={{ closable: false }}
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

function pickInlineEditorMinWidth(node: CanvasNode, isOperation: boolean): number {
  if (isOperation) return 960
  if (node.type === 'text' || node.type === 'prompt') return 820
  if (node.type === 'task') return 780
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') return 740
  return 720
}

function pickInlineEditorFocusPadding(isOperation: boolean): {
  top: number
  right: number
  bottom: number
  left: number
} {
  return {
    top: 92,
    right: 48,
    bottom: isOperation ? 640 : 560,
    left: 48,
  }
}

const CanvasFloatingNodeToolbar = memo(function CanvasFloatingNodeToolbar({
  node,
  resourceNode,
  isOperation,
  onClose,
  onFocus,
  onDuplicate,
  onToggleLock,
  onBringToFront,
  onSaveToLibrary,
  onDownload,
  onAnnotate,
  onSplitGrid,
  onExtractCharacterSubview,
  onPreviewPanorama,
  onOpenInlineAi,
  onEditNode,
  onDelete,
  onPipelineAction,
  onCreateOperationChild,
  onSetProductionState,
  onMergeGroup,
  onDissolveGroup,
  operationFullscreen = false,
  onOperationFullscreenChange,
}: {
  node: CanvasNode
  /** 操作节点当前主产物；资源动作作用于它，节点管理仍作用于稳定步骤节点。 */
  resourceNode?: CanvasNode | undefined
  isOperation: boolean
  onClose: () => void
  onFocus: () => void
  onDuplicate: () => void
  onToggleLock: () => void
  onBringToFront: () => void
  onSaveToLibrary: () => void
  onDownload: () => void
  onAnnotate: () => void
  onSplitGrid: () => void
  onExtractCharacterSubview: () => void
  onPreviewPanorama: () => void
  onOpenInlineAi: () => void
  onEditNode: () => void
  onDelete: () => void
  onPipelineAction: (actionId: string) => void
  onCreateOperationChild: (
    operation: CanvasOperationType,
    options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
  ) => void
  onSetProductionState: (state: CanvasProductionState) => void
  onMergeGroup: () => void
  onDissolveGroup: () => void
  operationFullscreen?: boolean
  onOperationFullscreenChange?: (nextFullscreen: boolean) => void
}) {
  const contentNode = resourceNode ?? node
  const hasResource = !isOperation || Boolean(resourceNode)
  const isMedia = contentNode.type === 'image' || contentNode.type === 'video'
  const isImage = isCanvasImageContentNode(contentNode)
  const isGroup = node.type === 'group'
  const isPanorama360 = Boolean(contentNode.data.panorama360)
  const pipelineActions = hasResource ? getNodePipelineActions(contentNode) : []
  const canEditNode = contentNode.type !== 'image' || isOperation
  const title =
    node.title ??
    (isOperation
      ? operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
      : node.type)
  const operationTitle = isOperation
    ? operationLabel((node.data.operation ?? node.type) as CanvasOperationType)
    : title
  const operationStatus = node.data.status ?? 'pending'
  const operationStatusColor =
    operationStatus === 'completed'
      ? 'green'
      : operationStatus === 'failed'
        ? 'red'
        : operationStatus === 'running'
          ? 'blue'
          : 'default'
  const createImageOutpaintTask = () =>
    onCreateOperationChild('image_edit', {
      title: '图片扩图',
      prompt: buildFloatingImageOutpaintPrompt(contentNode),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createDetailSheetTask = () =>
    onCreateOperationChild(contentNode.type === 'image' ? 'image_edit' : 'text_to_image', {
      title: '细节设定图（九宫格）',
      prompt: buildFloatingDetailSheetNineGridPrompt(contentNode),
      modelParams: { aspect_ratio: '2:1' },
    })
  const createStyleExtractionTask = () =>
    onCreateOperationChild('text_generate', {
      title: '风格提取',
      prompt: FLOATING_IMAGE_STYLE_EXTRACTION_PROMPT,
    })
  const contextualAiActions = [
    ...(isImage && hasResource
      ? [
          {
            key: 'outpaint-image',
            label: '图片扩图',
            icon: <Icons.Crop size={14} />,
            onClick: createImageOutpaintTask,
          },
          {
            key: 'extract-style',
            label: '提取风格',
            icon: <Icons.Sparkles size={14} />,
            onClick: createStyleExtractionTask,
          },
        ]
      : []),
    ...((contentNode.type === 'image' ||
      contentNode.type === 'text' ||
      contentNode.type === 'prompt') &&
    hasResource
      ? [
          {
            key: 'detail-sheet-nine-grid',
            label: '细节设定图（九宫格）',
            icon: <Icons.Grid size={14} />,
            onClick: createDetailSheetTask,
          },
        ]
      : []),
  ]
  const genericAiOperations = canvasGeneralCreateOperations()
  const menuButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    options?: { danger?: boolean; disabled?: boolean },
  ) => (
    <Button
      block
      size="middle"
      type="text"
      icon={icon}
      onClick={onClick}
      {...(options?.danger ? { className: 'canvas-floating-menu-danger' } : {})}
      {...(options?.disabled ? { disabled: true } : {})}
    >
      {label}
    </Button>
  )
  const aiOperationMenu = (
    <div className="canvas-floating-menu">
      <div className="canvas-floating-menu-title">AI 工具</div>
      {menuButton('打开 AI 面板', <Icons.Sparkles size={14} />, onOpenInlineAi)}
      {(contextualAiActions.length > 0 || genericAiOperations.length > 0) && (
        <div className="canvas-floating-menu-divider" />
      )}
      {contextualAiActions.length > 0 && <div className="canvas-floating-menu-title">快捷操作</div>}
      {contextualAiActions.map((action) => (
        <div key={action.key}>{menuButton(action.label, action.icon, action.onClick)}</div>
      ))}
      {genericAiOperations.length > 0 && <div className="canvas-floating-menu-divider" />}
      <div className="canvas-floating-menu-title">新建 AI 任务</div>
      {genericAiOperations.map((item) => (
        <div key={item.operation}>
          {menuButton(item.label, resolveCanvasFloatingIcon(item.icon, 14), () =>
            onCreateOperationChild(item.operation),
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className="canvas-floating-toolbar-shell" role="toolbar" aria-label={`${title} 编辑工具`}>
      <div className="canvas-floating-toolbar-title">
        {isOperation ? <Icons.Sparkles size={14} /> : <Icons.Edit size={14} />}
        <span>{isOperation ? operationTitle : title}</span>
        {isOperation && (
          <Tag color={operationStatusColor} bordered>
            {floatingOperationStatusLabel(operationStatus)}
          </Tag>
        )}
      </div>
      <div className="canvas-floating-toolbar-divider" />
      <Tooltip title="聚焦节点">
        <Button size="middle" type="text" icon={<Icons.Crosshair size={14} />} onClick={onFocus}>
          聚焦
        </Button>
      </Tooltip>
      {!isGroup && !isOperation && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottomLeft"
          arrow={false}
          overlayClassName="canvas-floating-toolbar-popover"
          content={aiOperationMenu}
        >
          <Button size="middle" type="text" icon={<Icons.Sparkles size={14} />}>
            AI 操作
          </Button>
        </Popover>
      )}
      {!isGroup && !isOperation && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottom"
          content={
            <div className="canvas-floating-menu">
              <div className="canvas-floating-menu-title">剧本流水线</div>
              {pipelineActions.length > 0 &&
                pipelineActions.map((action) => (
                  <div key={action.id}>
                    {menuButton(action.label, resolveCanvasFloatingIcon(action.icon, 14), () =>
                      onPipelineAction(action.id),
                    )}
                  </div>
                ))}
              {pipelineActions.length > 0 && <div className="canvas-floating-menu-divider" />}
              {CANVAS_PIPELINE_CREATE_OPERATIONS.map((item) => (
                <div key={item.operation}>
                  {menuButton(item.label, resolveCanvasFloatingIcon(item.icon, 14), () =>
                    onCreateOperationChild(item.operation),
                  )}
                </div>
              ))}
              <div className="canvas-floating-menu-divider" />
              {menuButton('确认采用', <Icons.Check size={14} />, () =>
                onSetProductionState('confirmed'),
              )}
              {menuButton('标记待更新', <Icons.RotateCcw size={14} />, () =>
                onSetProductionState('stale'),
              )}
            </div>
          }
        >
          <Button size="middle" type="text" icon={<Icons.Workflow size={14} />}>
            剧本流水线
          </Button>
        </Popover>
      )}
      {!isOperation && (
        <Popover
          trigger="hover"
          mouseEnterDelay={0.08}
          mouseLeaveDelay={0.18}
          placement="bottom"
          content={
            <div className="canvas-floating-menu">
              <div className="canvas-floating-menu-title">媒体 / 素材</div>
              {isMedia && menuButton('下载到本地', <Icons.Download size={14} />, onDownload)}
              {isImage && (
                <>
                  {menuButton('提取子视图', <Icons.Crop size={14} />, onExtractCharacterSubview)}
                  {menuButton('图片标注', <Icons.Crop size={14} />, onAnnotate)}
                  {menuButton('宫格切分', <Icons.Grid size={14} />, onSplitGrid)}
                </>
              )}
              {isPanorama360 &&
                menuButton('全景预览', <Icons.Globe size={14} />, onPreviewPanorama)}
              {node.type === 'group' && (
                <>
                  {menuButton('多图合并', <Icons.Image size={14} />, onMergeGroup)}
                  {menuButton('解散组', <Icons.FolderOpen size={14} />, onDissolveGroup)}
                </>
              )}
              {menuButton('保存到资源库', <Icons.Folder size={14} />, onSaveToLibrary)}
            </div>
          }
        >
          <Button size="middle" type="text" icon={<Icons.Folder size={14} />}>
            素材
          </Button>
        </Popover>
      )}
      <div className="canvas-floating-toolbar-spacer" />
      {isOperation && (
        <Tooltip title={operationFullscreen ? '退出全屏' : '全屏展示'}>
          <Button
            size="middle"
            type="text"
            icon={operationFullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
            onClick={() => onOperationFullscreenChange?.(!operationFullscreen)}
          >
            {operationFullscreen ? '退出全屏' : '全屏'}
          </Button>
        </Tooltip>
      )}
      <Popover
        trigger="hover"
        mouseEnterDelay={0.08}
        mouseLeaveDelay={0.18}
        placement="bottom"
        content={
          <div className="canvas-floating-menu">
            <div className="canvas-floating-menu-title">节点管理</div>
            {menuButton('复制节点', <Icons.Copy size={14} />, onDuplicate)}
            {menuButton(
              node.locked ? '解锁节点' : '锁定节点',
              <Icons.Lock size={14} />,
              onToggleLock,
            )}
            {menuButton('置于顶层', <Icons.Layers size={14} />, onBringToFront)}
            {canEditNode &&
              !isOperation &&
              menuButton('编辑节点', <Icons.Edit size={14} />, onEditNode)}
            <div className="canvas-floating-menu-divider" />
            {menuButton('删除节点', <Icons.Trash size={14} />, onDelete, { danger: true })}
          </div>
        }
      >
        <Button size="middle" type="text" icon={<Icons.More size={14} />}>
          更多
        </Button>
      </Popover>
      <div className="canvas-floating-toolbar-divider" />
      <Tooltip title="关闭编辑">
        <Button size="middle" type="text" icon={<Icons.X size={14} />} onClick={onClose} />
      </Tooltip>
    </div>
  )
})

function floatingOperationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

function resolveCanvasFloatingIcon(iconKey: string | undefined, size = 14): React.ReactNode {
  const map = Icons as unknown as Record<string, (p: { size?: number }) => React.ReactNode>
  const IconFn = (iconKey && map[iconKey]) || Icons.Workflow
  return <IconFn size={size} />
}

const EMPTY_SHOT_ROW: ParsedShotRow = {
  title: '镜头',
  description: '',
}

function serializeShotRowsToMarkdown(rows: ParsedShotRow[]): string {
  const body = rows.map((row, index) =>
    [
      row.index ?? index + 1,
      row.durationSec ?? '',
      row.shotSize ?? '',
      row.movement ?? '',
      row.sceneLayout ?? '',
      row.blocking ?? '',
      row.lighting ?? '',
      row.cameraParams ?? '',
      row.performance ?? '',
      row.description ?? row.title ?? '',
      row.dialogue ?? '',
      row.characterNames?.join('、') ?? '',
      row.shotPrompt ?? '',
      row.negativePrompt ?? '',
    ]
      .map((cell) => String(cell).replace(/\|/g, '｜').replace(/\n/g, ' '))
      .join(' | '),
  )
  return [
    '| 镜号 | 时长(秒) | 景别 | 运镜 | 场景描述 | 站位调度 | 光照 | 镜头参数 | 微表情动作 | 画面/动作 | 对白 | 角色 | 生成提示词 | 反向提示词 |',
    '|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...body.map((line) => `| ${line} |`),
  ].join('\n')
}

function updateShotRowField(
  rows: ParsedShotRow[],
  index: number,
  patch: Partial<ParsedShotRow>,
): ParsedShotRow[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
}

function CanvasShotScriptEditPanel({
  rows,
  characterAssets,
  onRowsChange,
}: {
  rows: ParsedShotRow[]
  characterAssets: CanvasAsset[]
  onRowsChange: (rows: ParsedShotRow[]) => void
}) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const updateRow = (index: number, patch: Partial<ParsedShotRow>) =>
    onRowsChange(updateShotRowField(rows, index, patch))
  const toggleCharacter = (index: number, characterName: string) => {
    const current = rows[index]?.characterNames ?? []
    updateRow(index, {
      characterNames: current.includes(characterName)
        ? current.filter((name) => name !== characterName)
        : [...current, characterName],
    })
  }
  const handleTableWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    const tableWrap = tableWrapRef.current
    if (!tableWrap) return
    const maxScrollLeft = tableWrap.scrollWidth - tableWrap.clientWidth
    if (maxScrollLeft <= 0) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return
    event.preventDefault()
    tableWrap.scrollLeft += delta
  }
  return (
    <div className="canvas-shot-script-editor">
      <div className="canvas-shot-script-editor-toolbar">
        <span>{rows.length} 个镜头</span>
        <Button
          size="middle"
          type="text"
          icon={<Icons.Plus size={13} />}
          onClick={() =>
            onRowsChange([
              ...rows,
              {
                ...EMPTY_SHOT_ROW,
                index: rows.length + 1,
                title: `镜${rows.length + 1}`,
              },
            ])
          }
        >
          添加镜头
        </Button>
      </div>
      <div
        ref={tableWrapRef}
        className="canvas-shot-script-editor-table-wrap"
        onWheel={handleTableWheel}
      >
        <table className="canvas-shot-script-editor-table">
          <thead>
            <tr>
              <th>镜号</th>
              <th>时长</th>
              <th>景别</th>
              <th>运镜</th>
              <th>场景描述</th>
              <th>站位调度</th>
              <th>光照</th>
              <th>镜头参数</th>
              <th>微表情动作</th>
              <th>画面 / 动作</th>
              <th>对白</th>
              <th>角色</th>
              <th>生成提示词</th>
              <th>反向提示词</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <Input
                    size="middle"
                    value={row.index ?? index + 1}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10)
                      if (Number.isFinite(next)) {
                        updateRow(index, { index: next })
                        return
                      }
                      onRowsChange(
                        rows.map((item, rowIndex) => {
                          if (rowIndex !== index) return item
                          const { index: _index, ...rest } = item
                          return rest
                        }),
                      )
                    }}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.durationSec ?? ''}
                    suffix="s"
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value)
                      if (Number.isFinite(next) && next > 0) {
                        updateRow(index, { durationSec: next })
                        return
                      }
                      onRowsChange(
                        rows.map((item, rowIndex) => {
                          if (rowIndex !== index) return item
                          const { durationSec: _durationSec, ...rest } = item
                          return rest
                        }),
                      )
                    }}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.shotSize ?? ''}
                    onChange={(event) => updateRow(index, { shotSize: event.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.movement ?? ''}
                    onChange={(event) => updateRow(index, { movement: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.sceneLayout ?? ''}
                    onChange={(event) => updateRow(index, { sceneLayout: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.blocking ?? ''}
                    onChange={(event) => updateRow(index, { blocking: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.lighting ?? ''}
                    onChange={(event) => updateRow(index, { lighting: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.cameraParams ?? ''}
                    onChange={(event) => updateRow(index, { cameraParams: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.performance ?? ''}
                    onChange={(event) => updateRow(index, { performance: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    value={row.description ?? row.title ?? ''}
                    onChange={(event) =>
                      updateRow(index, {
                        description: event.target.value,
                        title: row.title || `镜${row.index ?? index + 1}`,
                      })
                    }
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.dialogue ?? ''}
                    onChange={(event) => updateRow(index, { dialogue: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-character">
                  <div className="canvas-shot-script-character-cell">
                    {characterAssets.length > 0 ? (
                      characterAssets.map((asset) => {
                        const name = asset.title ?? asset.id
                        const active = row.characterNames?.includes(name)
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className={`canvas-shot-script-character-chip${active ? ' is-active' : ''}`}
                            onClick={() => toggleCharacter(index, name)}
                          >
                            {name}
                          </button>
                        )
                      })
                    ) : (
                      <span className="canvas-shot-script-empty">暂无角色资产</span>
                    )}
                    <Input
                      size="middle"
                      value={row.characterNames?.join('、') ?? ''}
                      placeholder="可手动输入角色名"
                      onChange={(event) =>
                        updateRow(index, {
                          characterNames: event.target.value
                            .split(/[,，、/\s]+/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    value={row.shotPrompt ?? ''}
                    onChange={(event) => updateRow(index, { shotPrompt: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.negativePrompt ?? ''}
                    onChange={(event) => updateRow(index, { negativePrompt: event.target.value })}
                  />
                </td>
                <td>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Trash size={13} />}
                    disabled={rows.length <= 1}
                    onClick={() => onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CanvasNodeEditModal({
  node,
  open,
  assets,
  tasks,
  placement = 'floating',
  onClose,
  onSave,
}: {
  node: CanvasNode | null
  open: boolean
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  placement?: 'floating' | 'inline'
  onClose: () => void
  onSave: (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [messageText, setMessageText] = useState('')
  const [url, setUrl] = useState('')
  const [editFullscreen, setEditFullscreen] = useState(false)
  const [shotRows, setShotRows] = useState<ParsedShotRow[]>([])
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [optimizeRequirement, setOptimizeRequirement] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const isTextLike = node?.type === 'text' || node?.type === 'prompt'
  const isShotScriptNode =
    node?.type === 'text' &&
    isShotScriptText(node.data.text) &&
    parseShotTable(node.data.text ?? '').length > 0

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setTitle(node.title ?? '')
    setText(node.data.text ?? '')
    setPrompt(node.data.prompt ?? '')
    setNegativePrompt('')
    setMessageText(node.data.message ?? '')
    setUrl(node.data.url ?? '')
    setShotRows(parseShotTable(node.data.text ?? ''))
    setOptimizeModalOpen(false)
    setOptimizeRequirement('')
  }, [node])

  const insertPromptText = (fragment: string) => {
    setText((current) => appendPromptFragment(current, fragment))
  }

  const openOptimizeModal = () => {
    const source = text.trim()
    if (!source) {
      message.warning('请先输入需要优化的文本或 Prompt')
      return
    }
    setOptimizeRequirement('')
    setOptimizeModalOpen(true)
  }

  const confirmPromptOptimize = async () => {
    const source = text.trim()
    if (!source) {
      message.warning('请先输入需要优化的文本或 Prompt')
      return
    }
    setOptimizing(true)
    try {
      const runtimeTask = node?.taskId ? tasks.find((task) => task.id === node.taskId) : undefined
      const response = await window.spark.invoke('canvas:task:generate-text', {
        operation: 'prompt_optimize',
        prompt: buildPromptOptimizationInstruction(source, negativePrompt, optimizeRequirement),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        ...(runtimeTask?.agentId ? { agentId: runtimeTask.agentId } : {}),
        ...(runtimeTask?.providerProfileId
          ? { providerProfileId: runtimeTask.providerProfileId }
          : {}),
        ...(runtimeTask?.modelId ? { modelId: runtimeTask.modelId } : {}),
        ...(runtimeTask?.reasoningEffort ? { reasoningEffort: runtimeTask.reasoningEffort } : {}),
        ...(runtimeTask?.skillIds && runtimeTask.skillIds.length > 0
          ? { skillIds: runtimeTask.skillIds }
          : {}),
      })
      if (response.status !== 'succeeded' || !response.text.trim()) {
        throw new Error(response.error?.message ?? 'AI 优化失败')
      }
      setText(response.text.trim())
      setOptimizeModalOpen(false)
      message.success('已应用 AI 优化结果')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 优化失败')
    } finally {
      setOptimizing(false)
    }
  }

  const save = async () => {
    if (!node) return
    setSaving(true)
    try {
      const nextData: CanvasNode['data'] = { ...node.data }
      if (node.type === 'text' || node.type === 'prompt' || node.type === 'group') {
        nextData.text = isShotScriptNode ? serializeShotRowsToMarkdown(shotRows) : text
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

  const optimizeModal = (
    <Modal
      title="AI 优化提示词"
      open={optimizeModalOpen}
      onCancel={() => setOptimizeModalOpen(false)}
      onOk={() => void confirmPromptOptimize()}
      okText="开始优化"
      cancelText="取消"
      confirmLoading={optimizing}
      destroyOnHidden
    >
      <div className="canvas-node-edit-optimize-modal-body">
        <p>请输入本次优化的具体要求，AI 将基于当前提示词生成新版本并直接替换。</p>
        <Input.TextArea
          value={optimizeRequirement}
          rows={4}
          placeholder="例如：增强镜头语言和光影描写、更简洁、突出角色情绪…（可留空，使用默认优化策略）"
          onChange={(event) => setOptimizeRequirement(event.target.value)}
          autoFocus
        />
      </div>
    </Modal>
  )

  if (isShotScriptNode && placement === 'inline') {
    return (
      <div
        className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel canvas-shot-script-edit-panel is-inline${editFullscreen ? ' is-fullscreen' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
          <div>
            <strong>编辑分镜脚本</strong>
            <span>以表格方式编辑镜号、景别、运镜、画面、对白和角色</span>
          </div>
          <div className="canvas-node-edit-bottom-actions">
            <Tooltip title={fullscreenLabel}>
              <Button
                size="middle"
                type="text"
                icon={fullscreenIcon}
                aria-label={fullscreenLabel}
                onClick={toggleFullscreen}
              />
            </Tooltip>
            <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </div>
        </div>
        <div className="canvas-bottom-floating-body canvas-node-edit-bottom-body">
          <CanvasShotScriptEditPanel
            rows={shotRows}
            characterAssets={assets.filter((asset) => readAssetKind(asset) === 'character')}
            onRowsChange={setShotRows}
          />
        </div>
      </div>
    )
  }

  if (isTextLike && placement === 'inline' && !editFullscreen) {
    return (
      <>
        <div
          className="canvas-bottom-floating-panel canvas-node-edit-bottom-panel is-inline is-composer"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-node-text-composer-top">
            <div className="canvas-node-text-composer-title">
              <Tag color="default" bordered>
                {node.type === 'prompt' ? 'Prompt' : 'Text'}
              </Tag>
              <label className="canvas-node-text-composer-title-input">
                <span>标题</span>
                <Input
                  size="middle"
                  value={title}
                  placeholder="节点标题"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="canvas-node-text-composer-file">
                <Icons.File size={13} />
                <span>{node.id}</span>
              </div>
            </div>
            <div className="canvas-node-text-composer-actions">
              <Tooltip title="全屏编辑">
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Maximize size={15} />}
                  aria-label="全屏编辑"
                  onClick={() => setEditFullscreen(true)}
                />
              </Tooltip>
            </div>
          </div>

          <div className="canvas-node-text-composer-main">
            <Input.TextArea
              className="canvas-node-text-composer-textarea"
              value={text}
              rows={4}
              placeholder="输入文本、剧情段落、生成提示词或需要 agent 改写的要求"
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div className="canvas-node-text-composer-bottom">
            <div className="canvas-node-text-composer-params">
              <Popover
                trigger="hover"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.22}
                placement="top"
                content={
                  <div className="canvas-node-text-composer-library-popover">
                    <CanvasPromptLibraryPanel
                      assets={assets}
                      className="canvas-node-edit-prompt-library canvas-node-edit-prompt-library-compact"
                      limit={24}
                      onApply={(entry) => insertPromptText(entry.text)}
                    />
                  </div>
                }
              >
                <Button size="middle" icon={<Icons.Folder size={13} />}>
                  提示词库
                </Button>
              </Popover>
              <Popover
                trigger="hover"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.22}
                placement="top"
                content={
                  <div className="canvas-node-text-composer-popover">
                    <div className="canvas-node-text-composer-popover-title">反向提示词</div>
                    <Input.TextArea
                      value={negativePrompt}
                      rows={5}
                      placeholder="可选：输入不希望出现的内容，AI 优化时会一并参考"
                      onChange={(event) => setNegativePrompt(event.target.value)}
                    />
                  </div>
                }
              >
                <Button size="middle" type={negativePrompt.trim() ? 'primary' : 'default'}>
                  反向提示词
                </Button>
              </Popover>
              <Button
                size="middle"
                icon={<Icons.Sparkles size={13} />}
                disabled={text.trim().length === 0}
                onClick={openOptimizeModal}
              >
                AI 优化
              </Button>
            </div>
            <div className="canvas-node-text-composer-save">
              <span>{text.trim().length} 字符</span>
              <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
        </div>
        {optimizeModal}
      </>
    )
  }

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
              onOptimizePrompt={openOptimizeModal}
            />
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

  if (isTextLike || placement === 'inline') {
    return (
      <>
        <div
          className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel${placement === 'inline' ? ' is-inline' : ''}${editFullscreen ? ' is-fullscreen' : ''}`}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
            <div>
              <strong>{isTextLike ? '编辑文本 / Prompt 节点' : '编辑节点'}</strong>
              <span>
                {placement === 'inline'
                  ? '在节点内部直接调整，保持画布上下文'
                  : '统一在底部工具栏上方编辑，避免遮挡画布上下文'}
              </span>
            </div>
            <div className="canvas-node-edit-bottom-actions">
              <Tooltip title={fullscreenLabel}>
                <Button
                  size="middle"
                  type="text"
                  icon={fullscreenIcon}
                  aria-label={fullscreenLabel}
                  onClick={toggleFullscreen}
                />
              </Tooltip>
              {placement !== 'inline' && (
                <Button size="middle" onClick={onClose}>
                  取消
                </Button>
              )}
              <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
          <div className="canvas-bottom-floating-body canvas-node-edit-bottom-body">{content}</div>
        </div>
        {optimizeModal}
      </>
    )
  }

  return (
    <>
      <Modal
        className={`canvas-node-edit-modal${editFullscreen ? ' canvas-node-edit-modal-fullscreen' : ''}`}
        title={
          <div className="canvas-node-edit-modal-title">
            <span>编辑节点</span>
            <Tooltip title={fullscreenLabel}>
              <Button
                size="middle"
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
      {optimizeModal}
    </>
  )
}
