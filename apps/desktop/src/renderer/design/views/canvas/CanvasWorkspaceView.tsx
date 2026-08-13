import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Empty } from '@lobehub/ui'
import { Drawer, Modal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import {
  CanvasStage,
  type CanvasStageViewport,
  type CanvasStageViewportControls,
} from './CanvasStage'
import type { PendingCanvasConnection } from './canvasPendingConnection'
import type { CanvasTaskRetryRuntimeSource } from './CanvasTaskQueue'
import type { CanvasTool } from './CanvasToolbar'
import { downloadCanvasResource } from './CanvasAssetsPanel'
import { CanvasBottomDock } from './CanvasBottomDock'
import { CanvasCinematicEmptyState } from './CanvasCinematicEmptyState'
import { CanvasWorkflowDrawer } from './CanvasWorkflowDrawer'
import { CanvasWorkflowExtractDialog } from './CanvasWorkflowExtractDialog'
import { useCanvasReload } from './useCanvasReload'
import {
  CanvasWorkflowRunPanel,
  type CanvasWorkflowRunExecutionInput,
} from './CanvasWorkflowRunPanel'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { executeCanvasWorkflowPlan } from './canvasWorkflowRunner'
import { executeCanvasWorkflowCanvasStep } from './canvasWorkflowCanvasExecutor'
import { waitForCanvasWorkflowTask } from './canvasWorkflowTaskAdapter'
import { extractCanvasWorkflowDraft, type CanvasWorkflowDraft } from './canvasWorkflowExtraction'
import { canvasNodeDownloadName } from './canvasNodeNaming'
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
import {
  classifyDroppedFile,
  layoutDroppedFiles,
  layoutDroppedImages,
  shouldGroupCanvasImages,
  textFormatFromFileName,
} from './canvasFileDrop'
import { replaceCanvasVideoNode, replaceCanvasAudioNode } from './canvasMediaNodeReplacement'
import { extractDocumentText } from './canvasDocumentParse'
import { CanvasTemplatePanel } from './CanvasTemplatePanel'
import { CanvasFilmAssetCenter, type FilmCenterHandlers } from './CanvasFilmAssetCenter'
import { resolveCanvasAssetFocusNodeIds } from './canvasAssetFocus'
import { CanvasAgentModal } from './CanvasAgentModal'
import { CanvasOperationPanel, buildOperationPanelSnapshotSignature } from './CanvasOperationPanel'
import { CanvasPromptNodePickerBanner } from './CanvasPromptNodePickerBanner'
import { useCanvasPromptNodePicker } from './useCanvasPromptNodePicker'
import { CanvasBatchTaskPanel } from './CanvasBatchTaskPanel'
import { useCanvasBatchTasks } from './useCanvasBatchTasks'
import { shouldFocusCanvasInlinePanel } from './canvasInlinePanelFocus'
import { captureCanvasTaskViewport, runWithCanvasTaskViewport } from './canvasTaskViewportGuard'
import { CanvasOperationWorkbench } from './CanvasOperationWorkbench'
import {
  resolveCanvasOperationResourceNode,
  resolveCanvasOperationOutputState,
  selectCanvasOperationOutputs,
} from './canvasOperationOutputModel'
import { operationNodeAspectRatioSizePatch } from './canvasOperationNodePresentation'
import { planCanvasOperationOutputMaterialization } from './canvasOperationOutputMaterialization'
import { planCanvasOperationOutputDeletion } from './canvasOperationOutputDeletion'
import {
  buildCanvasOperationRunViews,
  type CanvasOperationOutputView,
  type CanvasOperationRunView,
} from './canvasOperationRuns'
import { CanvasOperationPresetModal } from './CanvasOperationPresetModal'
import { CanvasPanoramaViewerModal } from './CanvasPanoramaViewerModal'
import { CanvasImageAnnotationModal } from './CanvasImageAnnotationModal'
import {
  annotationBaseName,
  createCanvasImageAnnotationRef,
  saveCanvasImageAnnotationDocument,
} from './image-annotation/annotationPersistence'
import { CanvasGridSplitModal, type CanvasGridSplitTile } from './CanvasGridSplitModal'
import { useFloatingViewportGeometry } from './useFloatingViewportGeometry'
import { CanvasPresetHubEntry } from './CanvasPresetHubEntry'
import { CanvasRightPanelRail } from './CanvasRightPanelRail'
import { CanvasWorkspaceSidePanel } from './CanvasWorkspaceSidePanel'
import { CanvasWorkspaceChrome } from './CanvasWorkspaceChrome'
import { CanvasOverlayBoundary } from './CanvasOverlayBoundary'
import { CanvasNodeEditModal } from './CanvasNodeEditModal'
import { CanvasFloatingNodeToolbar } from './CanvasFloatingNodeToolbar'
import {
  buildCanvasSnapshotFileName,
  canvasTaskFailureMessage,
  collectGroupDescendantNodes,
  collectSelectableGroupChildNodeIds,
  cssEscape,
  findLatestCreatedOperationNode,
  isRecord,
  nextFrame,
  normalizeColorsForHtml2Canvas,
  readShotDirectorDraft,
} from './canvasWorkspaceSnapshot'
import {
  fitGroupedImageNodeSize,
  fitImageNodeSize,
  GROUP_IMAGE_HEADER_HEIGHT,
  GROUP_IMAGE_PADDING_BOTTOM,
  GROUP_IMAGE_PADDING_X,
  getFloatingEditorGeometry,
  getImageGridMetrics,
  layoutGroupedImages,
  mergeWorkspaceBounds as mergeBounds,
  nextOriginAfterWorkspaceBounds as nextOriginAfterBounds,
  placeNodeRightOfNodes,
  positionNodeInViewport,
  resolveAssetInsertSize,
  workspaceBoundsForPlacements as boundsForPlacements,
  type CanvasWorkspaceBounds as LayoutBounds,
  type CanvasWorkspacePoint as CanvasPoint,
  type PreparedImageUpload,
} from './canvasWorkspacePlacement'
import {
  CanvasShotDirectorPanel,
  type CanvasShotDirectorDraft,
  type CanvasShotDirectorScreenshotInput,
} from './CanvasShotDirectorPanel'
import { CanvasDirectorStage3DModal } from './stage3d/CanvasDirectorStage3DModal'
import { createDefaultStage3DData, type Stage3DData } from './stage3d/stage3d.types'
import { CanvasVideoWorkbenchModal } from './videoWorkbench/CanvasVideoWorkbenchModal'
import { useCanvasVideoWorkbenchResources } from './videoWorkbench/useCanvasVideoWorkbenchResources'
import {
  createDefaultVideoWorkbenchData,
  type WorkbenchCanvasMaterialization,
  type VideoWorkbenchData,
  type WorkbenchKeyframe,
  type WorkbenchOutput,
} from './videoWorkbench/videoWorkbench.types'
import {
  getKeyframeCanvasGridPosition,
  getKeyframeCanvasNodeSize,
  getKeyframeImportTitle,
} from './videoWorkbench/videoWorkbenchKeyframeImport'
import { resolveWorkbenchMaterializationMedia } from './videoWorkbench/videoWorkbenchMaterialization'
import { isCanvasImageContentNode, isOperationNode } from './canvas.capabilities'
import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'
import {
  readAssetKind,
  readFilmData,
  readReferences,
  type ShotGroup,
  type ShotSegment,
} from './canvasFilmAssets'
import {
  readPromptLibraryCategories,
  writePromptLibraryCategories,
} from './canvasPromptLibraryCategories'
import type { FilmReferenceKind } from './canvasFilmTypes'
import {
  buildCharacterSheetPrompt,
  getCharacterSheetTemplate,
  type CharacterSheetAspect,
} from './canvasCharacterSheetPrompts'
import {
  collectDownstream,
  buildProductionBiblePrompt,
  readStylePresets,
  upsertStylePreset,
  writeProductionBible,
  writeStyleBible,
} from './canvasPipeline'
import { applyCanvasStyleToTask, buildCanvasStyleContext } from './canvasStyleContext'
import { buildStoryboardGridPrompt } from './canvasStoryboardGrid'
import { isShotScriptText, parseShotTable } from './canvasShotTableParse'
import {
  buildCloudTaskInputFiles,
  buildCanvasInputBindingsForRoles,
  buildStoryboardReferenceInputRoles,
  expandCanvasInputNodes,
  fallbackPromptForOperation,
  hydrateTextInputNodes,
  resolveCanvasInputNodes,
  resolveCanvasPipelineTextSource,
} from './canvasWorkspaceTaskInput'
import {
  assetToCharacterFields,
  buildFilmAssetReferencePrompt,
  buildChapterToScreenplayInstruction,
  buildScriptBreakdownDraft,
  buildShotNodeText,
  buildShotSegmentKeyframePrompt,
  buildShotSegmentVideoPrompt,
  filmKindToPipelineRole,
  findSegmentStyleFragments,
  resolveShotSegmentContext,
  type ScriptBreakdownDraft,
} from './canvasWorkspaceFilm'
import { buildPromptOptimizationInstruction } from './canvasPromptEditing'
import { resolveStoryboardSplitSourceNode, splitStoryboardNode } from './canvasStoryboardNodeSplit'
import { buildOpPrompt, CANVAS_PIPELINE_OPS, getCanvasPipelineInputType } from './canvasPipelineOps'
import {
  planCanvasPipelineTaskPositions,
  resolveCanvasPipelineAssetTargets,
  type CanvasPipelineAssetTarget,
} from './canvasPipelineActionBatch'
import { buildCanvasPipelineOperationDraft } from './canvasPipelineActionContracts'
import {
  buildEntityExtractionPrompt,
  extractEntityKindLabel,
  parseExtractedEntities,
  resolveExtractEntityKindFromWorkflow,
  type ExtractEntityKind,
} from './canvasEntityExtract'
import {
  mergeCanvasTrackedWorkflowDiagnostics,
  type CanvasTrackedWorkflowDiagnostics,
  type CaptureCanvasTrackedWorkflowDiagnostics,
} from './canvasTrackedWorkflowDiagnostics'
import {
  DEFAULT_SHOT_SCRIPT_CONFIG,
  applyShotScriptConfigToPrompt,
} from './canvasAgentPromptPresets'
import type { CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import { CanvasPromptLibraryQuickUseModal } from './CanvasPromptLibraryQuickUseModal'
import {
  isPromptLibraryCreateShortcut,
  isPromptLibraryShortcut,
} from './canvasPromptLibraryQuickUse'
import {
  characterSourceImageUrl,
  cropCharacterSubviewToDataUrl,
  readCharacterSubviews,
  resolveCharacterAssetForDesignCardImageAsset,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'
import {
  insertCharacterSubviewToCanvas,
  resolveCharacterSubviewCanvasSourceNode,
} from './canvasCharacterSubviewInsertion'
import {
  placeAutoGridNode,
  placeAutoNodeToRight,
  stackAutoNodesToRight,
} from './canvasAutoPlacement'
import type { CanvasAlignmentMode } from './canvasAlignment'
import {
  GROUP_NODE_DEFAULT_SIZE,
  AUDIO_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  OPERATION_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  VIDEO_NODE_DEFAULT_SIZE,
  fitCanvasVideoNodeSize,
} from './canvasNodeSize'
import type { TabKind as FilmCenterTab } from './CanvasFilmAssetCenter'
import { type AddNodeMenuItem } from './CanvasAddNodeMenu'
import type { CanvasTemplate } from './canvasTemplates'
import { useCanvasWorkspace } from './canvas.store'
import {
  canvasApi,
  isCanvasDirty,
  readAudioLocalFilePath,
  revertProject,
  saveCanvas,
} from './canvas.api'
import { buildTaskInputFiles, type CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
import { pickCanvasPromptTaskFields } from './canvasPromptTaskFields'
import { executionOperationForCanvasMediaCapability } from './canvasMediaInputMode'
import {
  buildCanvasPromptDocumentForInputs,
  buildCanvasPromptSubmission,
  type CanvasPromptSubmission,
} from './canvasPromptSubmission'
import { migrateLegacyPrompt } from './canvasPromptDocument'
import {
  normalizeCanvasFunctionalSystemPrompt,
  stripCanvasFunctionalPromptInput,
} from './canvasPromptInitialization'
import { summarizeCanvasSelectionContext } from './canvasContextMenuModel'
import {
  buildCanvasOperationSystemPrompt,
  mergeCanvasOperationPresetNegativePrompt,
  mergeCanvasPresetTargetModelParams,
  readBuiltinCanvasOperationPreset,
  readCanvasExecutionPresetPrompt,
  readCanvasOperationPreset,
  readCanvasOperationPresetOverrides,
  readCanvasResolvedPresetTarget,
  resolveCanvasPresetTarget,
  writeCanvasLastUsedPresetTarget,
} from './canvasOperationPresets'
import { useApp } from '../../AppContext'
import type {
  CanvasInputTransport,
  CanvasAsset,
  CanvasImageAnnotationDocument,
  CanvasNode,
  CanvasOperationType,
  CanvasPipelineRole,
  CanvasTask,
  ShotScriptConfig,
} from './canvas.types'
import type {
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
  CanvasWorkflowDefinition,
  CanvasWorkflowRun,
  CanvasWorkflowValueType,
  SessionReasoningEffort,
} from '@spark/protocol'
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import './cinematic/index.less'

type TrackedCanvasWorkflowResult = CanvasTrackedWorkflowDiagnostics & {
  count?: number
  outputNodeIds?: string[]
  outputAssetIds?: string[]
  message?: string
}
type PreparedMediaUpload = {
  kind: 'video' | 'audio'
  file: File
  filePath: string
  fileName: string
  fileMimeType?: string
  fileSize: number
  mediaWidth?: number
  mediaHeight?: number
  durationMs?: number
}
type InsertPreparedImagesResult = {
  createdNodeCount: number
  grouped: boolean
  createdNodeIds: string[]
  createdNodes: CanvasNode[]
  selectedNodeIds: string[]
  occupiedBounds?: LayoutBounds
  groupNodeId?: string
}
type InsertPreparedImagesOptions = {
  grouped?: boolean
  preservePreferredPosition?: boolean
}
type CharacterSubviewEditorContext = {
  node: CanvasNode
  sourceNode: CanvasNode
  ownerAsset: CanvasAsset
  sourceImageAsset: CanvasAsset
  subviews: FilmCharacterSubview[]
}
type CanvasSaveMode = 'manual' | 'auto'
type CanvasPersistResult = 'saved' | 'failed' | 'skipped'

const CANVAS_SIDE_PANEL_WIDTH_KEY = 'spark-canvas:side-panel-width'
const CANVAS_AUTO_SAVE_STORAGE_KEY_PREFIX = 'spark-canvas:auto-save:'
const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 400
const CANVAS_SIDE_PANEL_MIN_WIDTH = 400
const CANVAS_SIDE_PANEL_MAX_WIDTH = 640
const CANVAS_SIDE_PANEL_KEYBOARD_STEP = 24
const CANVAS_AGENT_PANEL_WIDTH_KEY = 'spark-canvas:agent-panel-width'
const CANVAS_AGENT_PANEL_OPEN_KEY = 'spark-canvas:agent-panel-open'
// 旧实现会在 mount 时把"默认折叠 / 旧默认宽度"持久化进 localStorage，污染所有老用户的偏好。
// 用版本标记完成旧值迁移，用户后续显式折叠/调整仍会持久化。
const CANVAS_AGENT_PANEL_OPEN_DEFAULT_VERSION_KEY = 'spark-canvas:agent-panel-open-default-v2'
const CANVAS_AGENT_PANEL_WIDTH_MIGRATED_KEY = 'spark-canvas:agent-panel-width-migrated-v2'
const CANVAS_AGENT_PANEL_DEFAULT_WIDTH = 420
const CANVAS_AGENT_PANEL_MIN_WIDTH = 400
const CANVAS_AGENT_PANEL_MAX_WIDTH = 1200
const CANVAS_AUTO_SAVE_DEBOUNCE_MS = 1200
const CANVAS_AUTO_SAVE_THROTTLE_MS = 30_000
// 自动保存失败时的退避：失败时 delay = min(30s, 1.2s * 2^failCount)，
// 同时 failCount 连续累计到上限后停止重试（避免 SQLite 锁 / 磁盘满等持续错误把 CPU 打满）。
const CANVAS_AUTO_SAVE_BACKOFF_BASE_MS = CANVAS_AUTO_SAVE_DEBOUNCE_MS
const CANVAS_AUTO_SAVE_BACKOFF_MAX_MS = CANVAS_AUTO_SAVE_THROTTLE_MS
const CANVAS_AUTO_SAVE_MAX_FAILS = 5

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
        '[contenteditable="true"], .canvas-inline-ai-composer, .ant-modal, .ant-drawer, .canvas-operation-panel',
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
      { keys: ['Ctrl / Cmd', 'E'], desc: '新建提示词并打开录入面板' },
      { keys: ['双击节点'], desc: '展开节点编辑面板' },
      { keys: ['Esc'], desc: '关闭当前浮层 / 弹窗 / 编辑面板' },
      { keys: ['Delete', 'Backspace'], desc: '删除选中节点或连线' },
      { keys: ['Ctrl / Cmd', '点击'], desc: '追加选择节点' },
      { keys: ['Shift', '点击'], desc: '追加选择节点' },
      { keys: ['框选'], desc: '批量选择节点' },
      { keys: ['Ctrl / Cmd', 'A'], desc: '选中当前组内节点' },
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
      { keys: ['Ctrl / Cmd', 'T'], desc: '打开提示词库查询 / 使用' },
      { keys: ['Ctrl / Cmd', 'Z'], desc: '撤销' },
      { keys: ['Ctrl / Cmd', 'Shift', 'Z'], desc: '重做' },
      { keys: ['Ctrl / Cmd', '\\'], desc: '展开 / 折叠右侧面板' },
      { keys: ['Ctrl / Cmd', 'R'], desc: '刷新当前画布数据' },
      { keys: ['Ctrl / Cmd', 'Shift', 'S'], desc: '开启 / 关闭自动保存' },
      { keys: ['底部工具栏', '全部节点'], desc: '打开全部节点类型列表' },
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
    createCanvasHistoryCheckpoint,
    restoreCanvasHistoryCheckpoint,
    hasCanvasHistoryCheckpoint,
    canRedo,
    undoCanvasChange,
    redoCanvasChange,
    updateNodes,
    connectNodes,
    deleteEdges,
    createTextNode,
    createImageNode,
    createEmptyImageNode,
    createEmptyMediaNode,
    createMediaNode,
    createProviderFileNode,
    uploadImageAsset,
    createGroupNode,
    dissolveGroupNode,
    addNodesToGroup,
    removeNodesFromGroup,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNode,
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
    materializeWorkflow,
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
    repollMediaTask,
    runOperationNode,
  } = useCanvasWorkspace(projectId)
  const promptLibraryCategories = useMemo(
    () => readPromptLibraryCategories(snapshot?.project.metadata),
    [snapshot?.project.metadata],
  )
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [promptQuickUseOpen, setPromptQuickUseOpen] = useState(false)
  const [promptCreateOpen, setPromptCreateOpen] = useState(false)
  const [filmCenterOpen, setFilmCenterOpen] = useState(false)
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false)
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false)
  const [workflowExtractDraft, setWorkflowExtractDraft] = useState<CanvasWorkflowDraft | null>(null)
  const [workflowToUpdate, setWorkflowToUpdate] = useState<CanvasWorkflowDefinition | null>(null)
  const [workflowToRun, setWorkflowToRun] = useState<CanvasWorkflowDefinition | null>(null)
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
  // 进入画布默认为选择模式：开箱即用即可点选/框选节点，无需先切工具；按住 Space / Tab 可临时切到平移。
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
    const sourceNode = snapshot.nodes.find((item) => item.id === characterSubviewEditorNodeId)
    if (!sourceNode) return null
    const node = resolveCanvasResourceActionNode(sourceNode.id)
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
      sourceNode,
      sourceImageAsset,
      ownerAsset,
      // 子视图按来源图片分区：只回显属于当前来源图片的子视图，避免同一角色资产的
      // 多张产物图之间互相串框（第一个产物的框选出现在第二个产物上）。
      subviews: readCharacterSubviews(ownerAsset.metadata).filter(
        (item) => item.sourceAssetId === sourceImageAsset.id,
      ),
    }
  }, [characterSubviewEditorNodeId, resolveCanvasResourceActionNode, snapshot])
  const [directorStage3DNodeId, setDirectorStage3DNodeId] = useState<string | null>(null)
  const [videoWorkbenchNodeId, setVideoWorkbenchNodeId] = useState<string | null>(null)
  const [activeOperationPanelNodeId, setActiveOperationPanelNodeId] = useState<string | null>(null)
  const {
    ownerNodeId: promptNodePickerOwnerId,
    start: startPromptNodePicker,
    cancel: cancelPromptNodePicker,
    interceptSelectionChange: interceptPromptNodePickerSelection,
    interceptNodeSelect: interceptPromptNodeSelect,
  } = useCanvasPromptNodePicker({
    nodes: snapshot?.nodes ?? [],
    activeOperationNodeId: activeOperationPanelNodeId,
    setSelectedNodeIds,
  })
  const batchTasks = useCanvasBatchTasks({
    getSnapshot: () => snapshot,
    updateManyNodeData,
    runOperationNode,
    waitForTask: async (taskId) => {
      await waitForCanvasWorkflowTask({
        projectId,
        taskId,
        readSnapshot: (currentProjectId) => canvasApi.openSnapshot(currentProjectId),
      })
      await refreshTaskSnapshot()
    },
    onSingleValidationError: (nodeId, error) => {
      setActiveOperationPanelNodeId(nodeId)
      setSelectedNodeIds([nodeId])
      message.error(error instanceof Error ? error.message : '任务参数校验失败')
    },
  })
  const [assetDetailResetKey, setAssetDetailResetKey] = useState(0)
  const canvasViewportControlsRef = useRef<CanvasStageViewportControls | null>(null)
  // persistCurrentCanvasViewport 定义在下方（晚于 persistCanvas 等使用方），用 ref 桥接
  // 打破 hooks 顺序依赖：使用方通过 ref 调用「最新版」viewport 持久化函数。
  const persistViewportFnRef = useRef<((opts?: { silent?: boolean }) => Promise<unknown>) | null>(
    null,
  )
  const pendingCanvasViewportRestoreRef = useRef<Pick<
    CanvasStageViewport,
    'x' | 'y' | 'zoom'
  > | null>(null)
  const canvasViewportRestoreFrameRef = useRef<number | null>(null)
  const pendingImageConnectionRef = useRef<PendingCanvasConnection | null>(null)
  const pendingAssetConnectionRef = useRef<PendingCanvasConnection | null>(null)
  const pendingAssetPositionRef = useRef<CanvasPoint | null>(null)
  // 牵线打开流水线菜单时，强制后续任务节点保留鼠标释放位置。
  const pipelineActionPositionRef = useRef<CanvasPoint | null>(null)
  // 鼠标在画布坐标系下的最近位置；粘贴等无坐标事件用它就近落点，鼠标不在画布上时为 null。
  const pointerFlowPositionRef = useRef<CanvasPoint | null>(null)
  const compositingImageLockRef = useRef(new Set<string>())
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(true)
  const [agentPanelWidth, setAgentPanelWidth] = useState(readAgentPanelWidth)
  const [agentSubmitRequest, setAgentSubmitRequest] = useState<{
    id: number
    text: string
  } | null>(null)
  const agentSubmitRequestIdRef = useRef(0)
  /** 用户显式「添加到 Agent 对话」的引用节点；与画布选区解耦，发送时以这里为准 */
  const [agentNodeRefs, setAgentNodeRefs] = useState<CanvasNode[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const operationImageUploadInputRef = useRef<HTMLInputElement>(null)
  const operationImageUploadTargetNodeIdRef = useRef<string | null>(null)
  const uploadFilesInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePositionRef = useRef<CanvasPoint | null>(null)
  /** 非空时表示下一次 fileInput 选择是「替换该图片节点」而非新增节点 */
  const replaceImageNodeIdRef = useRef<string | null>(null)
  /** 非空时表示下一次 audioFileInput 选择是「填充该空音频节点」而非其他用途 */
  const pendingAudioNodeIdRef = useRef<string | null>(null)
  const audioFileInputRef = useRef<HTMLInputElement>(null)
  const activeToolRef = useRef<CanvasTool>('select')
  const { registerNavGuard, requestConfirm, t, setTweak, setHasUnsavedChanges } = useApp()
  const handleCreatePromptCategory = useCallback(
    async (name: string): Promise<string | null> => {
      const nextName = name.trim()
      if (!nextName) return null
      if (promptLibraryCategories.includes(nextName)) {
        message.warning('分类已存在')
        return null
      }
      await updateProjectMetadata(
        writePromptLibraryCategories(snapshot?.project.metadata, [
          ...promptLibraryCategories,
          nextName,
        ]),
      )
      return nextName
    },
    [promptLibraryCategories, snapshot?.project.metadata, updateProjectMetadata],
  )
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
        '--canvas-side-panel-center-offset': sidePanelCollapsed ? '0px' : `${sidePanelWidth / 2}px`,
        '--canvas-agent-panel-center-offset': agentOpen ? `${agentPanelWidth / 2}px` : '0px',
      }) as CSSProperties,
    [sidePanelCollapsed, sidePanelWidth, agentOpen, agentPanelWidth],
  )

  const openAgentPanel = useCallback((options?: { constrainOversizedWidth?: boolean }) => {
    if (options?.constrainOversizedWidth) {
      setAgentPanelWidth((current) => Math.min(current, CANVAS_AGENT_PANEL_DEFAULT_WIDTH))
    }
    setSidePanelCollapsed(true)
    setAgentOpen(true)
  }, [])

  const toggleAgentPanel = useCallback(() => {
    if (agentOpen) {
      setAgentOpen(false)
      return
    }
    openAgentPanel({ constrainOversizedWidth: true })
  }, [agentOpen, openAgentPanel])

  const toggleWorkspacePanel = useCallback(() => {
    if (!sidePanelCollapsed) {
      setSidePanelCollapsed(true)
      return
    }
    setAgentOpen(false)
    setSidePanelCollapsed(false)
  }, [sidePanelCollapsed])

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

  // 进入「新建空画布」（首次加载即无节点）时强制展开 Agent 面板，方便用户立即开始对话。
  // 全局持久化宽度可能来自上一个画布的宽屏/拖拽操作；空画布只收敛过宽值到默认宽度，
  // 避免挤压主要创作区，同时保留用户主动设置的更窄宽度。已有内容的老画布继续尊重偏好。
  // useLayoutEffect 在浏览器绘制前定稿，避免一帧闪烁。
  useLayoutEffect(() => {
    if (forceExpandAgentOnEmptyCheckedRef.current) return
    if (loading || !snapshot) return
    forceExpandAgentOnEmptyCheckedRef.current = true
    if (snapshot.nodes.length === 0) {
      openAgentPanel({ constrainOversizedWidth: true })
    }
  }, [loading, openAgentPanel, snapshot])

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
        updateAgentPanelWidth(startWidth + startX - moveEvent.clientX)
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
      // 保存前先把实时 viewport（缩放/平移）回写 hot storage，确保 zoom 随本次保存落盘。
      // 非 silent：紧接的 saveCanvas 会落盘并清除 dirty，标记 dirty 在此无副作用。
      // 通过 ref 调用，避免把 persistCurrentCanvasViewport 纳入 useCallback 依赖。
      await persistViewportFnRef.current?.()
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

  const { refreshing: refreshingCanvas, reload: reloadCanvas } = useCanvasReload({
    projectId,
    savingRef,
    requestConfirm,
    refresh,
    onBeforeReload: () => {
      clearAutoSaveTimer()
      autoSavePendingRef.current = false
    },
    onReloaded: () => {
      setSelectedNodeIds([])
      setAgentNodeRefs([])
      setEditingNodeId(null)
    },
  })

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
      toggleWorkspacePanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleWorkspacePanel])

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

  // 离开画布（无内容改动）时静默保留当前缩放比例：立即落盘 localStorage，不污染 dirty。
  // viewport 属于视图偏好，缓存失败不应阻塞离开流程。
  const flushViewportSilentOnLeave = useCallback(async () => {
    try {
      await persistViewportFnRef.current?.({ silent: true })
    } catch (err) {
      console.warn('[canvas] flush viewport on leave failed', err)
    }
  }, [])

  // 注册导航守卫：侧边栏切换视图时若有未完成任务或 dirty，交给用户选择是否离开。
  useEffect(() => {
    registerNavGuard(async () => {
      const canLeaveActiveTasks = await confirmLeaveWithActiveTasks()
      if (!canLeaveActiveTasks) return false
      if (!isCanvasDirty(projectId)) {
        // 无内容改动也静默保留当前缩放比例（视图偏好），下次打开沿用。
        await flushViewportSilentOnLeave()
        return true
      }
      const choice = await askLeave()
      if (choice === 'cancel') return false
      if (choice === 'discard') await revertProject(projectId)
      return true
    })
    return () => registerNavGuard(null)
  }, [
    registerNavGuard,
    askLeave,
    projectId,
    confirmLeaveWithActiveTasks,
    flushViewportSilentOnLeave,
  ])

  const handleBackWithGuard = useCallback(async () => {
    const canLeaveActiveTasks = await confirmLeaveWithActiveTasks()
    if (!canLeaveActiveTasks) return
    if (!isCanvasDirty(projectId)) {
      // 无内容改动也静默保留当前缩放比例（视图偏好），下次打开沿用。
      await flushViewportSilentOnLeave()
      await onBack()
      return
    }
    const choice = await askLeave()
    if (choice === 'cancel') return
    if (choice === 'discard') await revertProject(projectId)
    await onBack()
  }, [askLeave, onBack, projectId, confirmLeaveWithActiveTasks, flushViewportSilentOnLeave])

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
  const promptCreateNode = useMemo(
    () =>
      selectedNodes.find((node) => node.type === 'text' || node.type === 'prompt') ??
      selectedNodes.find((node) => node.type === 'image') ??
      null,
    [selectedNodes],
  )
  const aiInputNodes = useMemo(
    () => (snapshot ? expandCanvasInputNodes(selectedNodes, snapshot) : []),
    [selectedNodes, snapshot],
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

  useEffect(() => {
    if (!inlineOperationFullscreen) return
    const handleFullscreenKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setInlineOperationFullscreen(false)
    }
    window.addEventListener('keydown', handleFullscreenKeyDown)
    return () => window.removeEventListener('keydown', handleFullscreenKeyDown)
  }, [inlineOperationFullscreen])

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

  const persistCurrentCanvasViewport = useCallback(
    async (opts?: { silent?: boolean }) => {
      const currentSnapshot = snapshotRef.current
      if (!currentSnapshot) return null
      const controls = canvasViewportControlsRef.current
      const viewport = captureCanvasTaskViewport(controls, canvasViewportRef.current, {
        x: currentSnapshot.board.viewport.x,
        y: currentSnapshot.board.viewport.y,
        zoom: currentSnapshot.board.viewport.zoom,
      })
      const nextViewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      if (opts?.silent) {
        // 视图偏好缓存：不标 dirty + 单项目落 SQLite，
        // 确保关闭/切走画布后，下次加载（openSnapshot 不 dirty 时读 SQLite）仍沿用缩放比例。
        await canvasApi.persistProjectViewport(projectId, nextViewport, currentSnapshot.board.id)
      } else {
        await canvasApi.updateViewport(projectId, nextViewport, currentSnapshot.board.id)
      }
      return viewport
    },
    [projectId, canvasViewportRef],
  )
  // 暴露给定义顺序更靠前的使用方（persistCanvas / 关闭守卫）通过 ref 调用，
  // 避免把 persistCurrentCanvasViewport 整体上移引发的大面积 hooks 重排。
  // 渲染期写入 ref 是安全的：不触发重渲染，读取只发生在远晚于渲染的事件回调中。
  persistViewportFnRef.current = persistCurrentCanvasViewport

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
        | 'workflow'
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
      if (except !== 'workflow') setWorkflowDrawerOpen(false)
      if (except !== 'character-library') setCharacterLibraryOpen(false)
      if (except !== 'shot-director') setShotDirectorOpen(false)
      if (except !== 'agent') setAgentOpen(false)
      if (except !== 'node-edit') setEditingNodeId(null)
      if (except !== 'asset-detail') setAssetDetailResetKey((key) => key + 1)
    },
    [],
  )

  const openWorkflowExtraction = useCallback(() => {
    if (!snapshot) return
    try {
      const draft = extractCanvasWorkflowDraft({
        projectId,
        boardId: snapshot.board.id,
        selectedNodes,
        allNodes: snapshot.nodes,
        allEdges: snapshot.edges,
      })
      setWorkflowDrawerOpen(false)
      setWorkflowToUpdate(null)
      setWorkflowExtractDraft(draft)
    } catch (extractError) {
      message.warning(
        extractError instanceof Error ? extractError.message : '当前选区无法提取为画布工作流',
      )
    }
  }, [projectId, selectedNodes, snapshot])

  const openWorkflowUpdate = useCallback(
    (workflow: CanvasWorkflowDefinition) => {
      if (!snapshot) return
      try {
        const draft = extractCanvasWorkflowDraft({
          projectId,
          boardId: snapshot.board.id,
          selectedNodes,
          allNodes: snapshot.nodes,
          allEdges: snapshot.edges,
        })
        setWorkflowDrawerOpen(false)
        setWorkflowToUpdate(workflow)
        setWorkflowExtractDraft(draft)
      } catch (extractError) {
        message.warning(
          extractError instanceof Error ? extractError.message : '当前选区无法更新画布工作流',
        )
      }
    },
    [projectId, selectedNodes, snapshot],
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
      if (interceptPromptNodePickerSelection()) return
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
    [activeOperationPanelNodeId, editingNodeId, interceptPromptNodePickerSelection],
  )

  const handleNodeSelectIntent = useCallback(
    (nodeId: string) => {
      if (interceptPromptNodeSelect(nodeId)) return
      // 从 ref 读取最新节点，避免把 snapshot?.nodes 放进依赖导致引用抖动
      // （否则每次 snapshot 变更都会让 nodeActions memo 失效，连带所有可见节点重渲染）
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (!node) return

      if (activeOperationPanelNodeId === nodeId || editingNodeId === nodeId) return
      // 节点右键菜单项点击完成后，React Flow 仍可能补发一次节点选择意图。
      // 保留 Agent 面板，避免“添加到 Agent 对话”刚展开又被这次收尾点击关闭。
      closeCanvasFloatPanels('agent')
    },
    [activeOperationPanelNodeId, closeCanvasFloatPanels, editingNodeId, interceptPromptNodeSelect],
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

  // CanvasStage 上报鼠标的画布坐标；粘贴等无坐标事件就近落点用。
  const handlePointerFlowPositionChange = useCallback((position: CanvasPoint | null) => {
    pointerFlowPositionRef.current = position
  }, [])

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
    async (options: Parameters<CanvasStageViewportControls['arrangeNodes']>[0]) => {
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

  const handleArrangeGridSelection = useCallback(
    async (columns: number) => {
      const controls = canvasViewportControlsRef.current
      if (!controls) {
        message.warning('画布仍在初始化，请稍后重试')
        return
      }
      if (selectedNodeIds.length < 2) {
        message.info('请先选中至少 2 个节点')
        return
      }
      setArrangingCanvas(true)
      try {
        const arranged = await controls.arrangeNodes({
          mode: 'grid',
          spacing: 'medium',
          columns,
          nodeIds: selectedNodeIds,
        })
        if (!arranged) {
          message.info('没有可整理的节点')
          return
        }
        message.success(`已按每排 ${columns} 个整理所选 ${selectedNodeIds.length} 个节点`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '整理画布失败')
      } finally {
        setArrangingCanvas(false)
      }
    },
    [selectedNodeIds],
  )

  const handleAlignSelected = useCallback(
    async (mode: CanvasAlignmentMode) => {
      const controls = canvasViewportControlsRef.current
      if (!controls) {
        message.warning('画布仍在初始化，请稍后重试')
        return
      }
      if (selectedNodeIds.length < 2) {
        message.info('请先选中至少 2 个节点')
        return
      }
      try {
        const aligned = await controls.alignNodes({ mode, nodeIds: selectedNodeIds })
        if (!aligned) {
          message.info('当前选择不支持该对齐')
          return
        }
        message.success(`已对齐所选 ${selectedNodeIds.length} 个节点`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '对齐节点失败')
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
    // closeCanvasFloatPanels() 把刚打开的 Agent 面板又关回去。
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
    openAgentPanel()
  }, [closeCanvasFloatPanels, openAgentPanel, selectedNodes])

  /** 单节点右键「添加到 Agent 对话」：把指定节点合并进引用列表并展开 Agent 面板。
   *  即使节点一时找不到（snapshot 尚未刷新），也保证面板展开，给用户即时反馈。 */
  const handleAddNodeToAgent = useCallback(
    (nodeId: string) => {
      // 同上：先以 'agent' 例外关闭其他浮层，确保面板稳定展开。
      closeCanvasFloatPanels('agent')
      openAgentPanel()
      const node =
        snapshotNodeById.get(nodeId) ?? snapshotRef.current?.nodes.find((n) => n.id === nodeId)
      if (!node) return
      setAgentNodeRefs((prev) => {
        if (prev.some((item) => item.id === nodeId)) return prev
        return [...prev, node]
      })
    },
    [closeCanvasFloatPanels, openAgentPanel, snapshotNodeById],
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

  // 把一组内容节点按其在画布上的当前位置截图合成成一张图，生成新的图片节点，
  // 并从 sourceNodeIds 连线到新节点。组内「多图合并」与多选「合并为组合图」共用此逻辑：
  // 前者 source = 组节点，后者 source = 被选中的内容节点（不再创建中间组节点）。
  const compositeContentNodesToImage = useCallback(
    async (params: {
      contentNodes: CanvasNode[]
      sourceNodeIds: string[]
      title: string
      placeX: number
      placeY: number
      lockKey: string
      projectRootPath?: string
      notInViewportMessage?: string
    }) => {
      const {
        contentNodes,
        sourceNodeIds,
        title,
        placeX,
        placeY,
        lockKey,
        projectRootPath,
        notInViewportMessage = '所选内容当前不在可截图区域内，请先移动视图后再合成',
      } = params

      if (compositingImageLockRef.current.has(lockKey)) {
        message.info('正在合成，请稍候')
        return
      }

      const stageElement = document.querySelector<HTMLElement>('.canvas-stage-area')
      const contentElements = contentNodes
        .map((node) =>
          document.querySelector<HTMLElement>(`[data-canvas-node-id="${cssEscape(node.id)}"]`),
        )
        .filter((element): element is HTMLElement => Boolean(element))

      if (!stageElement || contentElements.length === 0) {
        message.error('无法定位内容区，请稍后重试')
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
        message.error(notInViewportMessage)
        return
      }

      compositingImageLockRef.current.add(lockKey)
      const closeLoading = message.loading('正在合成内容，请稍候…', 0)
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
        const file = dataUrlToFile(dataUrl, buildCanvasSnapshotFileName(title))
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          mimeType: 'image/png',
          suggestedBaseName: file.name.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(projectRootPath ? { projectRootPath } : {}),
        })
        const imageNode = await createImageNode({
          file,
          filePath: savedImage.filePath,
          x: Math.round(placeX),
          y: Math.round(placeY),
          ...fitImageNodeSize(outputCanvas.width, outputCanvas.height),
          imageWidth: outputCanvas.width,
          imageHeight: outputCanvas.height,
        })
        if (imageNode) {
          await patchNodes([imageNode.id], { title: `${title} 合成图` })
          await Promise.all(
            sourceNodeIds.map((sourceNodeId) =>
              connectNodes({ sourceNodeId, targetNodeId: imageNode.id }),
            ),
          )
          setSelectedNodeIds([imageNode.id])
        }
        closeLoading()
        message.success('已生成内容合成图节点，并连接来源节点')
      } catch (error) {
        console.error('[canvas] composite content to image failed', error)
        closeLoading()
        message.error(
          error instanceof Error
            ? `合成图失败：${error.message}`
            : '合成图失败，请检查内容图片是否可访问',
        )
      } finally {
        restoreColors?.()
        hideElements.forEach((element, index) => {
          element.style.visibility = previousVisibility[index] ?? ''
        })
        compositingImageLockRef.current.delete(lockKey)
      }
    },
    [connectNodes, createImageNode, patchNodes],
  )

  const handleMergeGroupToImage = useCallback(
    async (groupId: string, sourceSnapshot?: typeof snapshot) => {
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
      await compositeContentNodesToImage({
        contentNodes,
        sourceNodeIds: [groupNode.id],
        title: groupNode.title ?? '组',
        placeX: groupNode.x + groupNode.width + 96,
        placeY: groupNode.y,
        lockKey: groupId,
        ...(currentSnapshot.project.rootPath
          ? { projectRootPath: currentSnapshot.project.rootPath }
          : {}),
        notInViewportMessage: '组节点当前不在可截图区域内，请先移动视图后再合成',
      })
    },
    [compositeContentNodesToImage, snapshot],
  )

  const handleCreateGroup = useCallback(async () => {
    if (selectedTopLevelNodes.length < 2) return
    const nodeIds = selectedTopLevelNodes.map((node) => node.id)
    const nextSnapshot = await createGroupNode(nodeIds)
    // 编组成功后把选区切到新组：原节点已折叠为子节点，保留旧 selection 会让
    // 多选工具栏继续悬空显示（指向已折叠子节点）。通过子节点关系定位新组，
    // 与 useCanvasFileInsertion 的编组选区逻辑保持一致。
    const createdIdSet = new Set(nodeIds)
    const groupNode = nextSnapshot?.nodes.find((node) => {
      if (node.type !== 'group') return false
      const childIds = nextSnapshot.nodes
        .filter((child) => child.parentNodeId === node.id)
        .map((child) => child.id)
      return (
        nodeIds.every((id) => childIds.includes(id)) && childIds.every((id) => createdIdSet.has(id))
      )
    })
    setSelectedNodeIds(groupNode ? [groupNode.id] : [])
  }, [createGroupNode, selectedTopLevelNodes, setSelectedNodeIds])

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

    // 直接后台合成选中内容节点为一张图，不再先创建中间组节点：
    // 与「手动成组 → 多图合并」产物一致，但跳过组节点，按节点当前位置截图，
    // 合成图放在选中内容整体的右侧，并从每个来源节点连线到合成图。
    const contentNodes = selectedNodes.filter((node) => summary.topLevelNodeIds.includes(node.id))
    if (contentNodes.length === 0) {
      message.warning('未找到可合成的内容节点')
      return
    }
    const placeX = contentNodes.reduce((maxX, node) => Math.max(maxX, node.x + node.width), 0) + 96
    const placeY = contentNodes.reduce(
      (minY, node) => Math.min(minY, node.y),
      Number.POSITIVE_INFINITY,
    )
    await compositeContentNodesToImage({
      contentNodes,
      sourceNodeIds: summary.topLevelNodeIds,
      title: '组合图',
      placeX,
      placeY: Number.isFinite(placeY) ? placeY : 0,
      lockKey: `selection:${[...summary.topLevelNodeIds].sort().join(',')}`,
      ...(snapshot?.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
    })
  }, [compositeContentNodesToImage, handleMergeGroupToImage, selectedNodes, snapshot])

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

  const handleSelectGroupChildren = useCallback(
    (groupId: string) => {
      const currentSnapshot = snapshotRef.current
      const groupNode = currentSnapshot?.nodes.find(
        (node) => node.id === groupId && node.type === 'group',
      )
      if (!currentSnapshot || !groupNode) return

      const childIds = collectSelectableGroupChildNodeIds(currentSnapshot.nodes, groupId)
      if (childIds.length === 0) {
        message.info('组内没有可选中的节点')
        return
      }

      // 组保持原有的单节点语义；折叠组先展开，保证选中结果在画布上可见。
      if (groupNode.data.collapsed === true) {
        void updateNodeData(groupId, { collapsed: false })
      }
      handleSelectionChange(childIds)
    },
    [handleSelectionChange, updateNodeData],
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
      // 空图片节点双击 → 触发上传（复用替换图片管线）
      if (node?.type === 'image' && !node.data.url) {
        replaceImageNodeIdRef.current = nodeId
        fileInputRef.current?.click()
        return
      }
      // 空音频节点双击 → 触发上传（音频空节点无占位上传按钮）
      if (node?.type === 'audio' && !node.data.url) {
        pendingAudioNodeIdRef.current = nodeId
        audioFileInputRef.current?.click()
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

  // 音频截取 → ffmpeg trim → 物化成新 audio 子节点 + generated 连线
  const handleAudioTrim = useCallback(
    async (nodeId: string, startSec: number, endSec: number) => {
      const snap = snapshotRef.current
      if (!projectId || !snap) return
      const source = snap.nodes.find((n) => n.id === nodeId)
      if (!source || source.type !== 'audio') return
      const filePath = readAudioLocalFilePath(source)
      if (!filePath) {
        message.error('无法定位源音频文件')
        return
      }
      try {
        const fileName = source.title ?? source.data.message ?? 'audio'
        const created = await canvasApi.materializeAudioTrim({
          projectId,
          boardId: snap.board.id,
          parentNodeId: nodeId,
          filePath,
          fileName,
          ...(source.data.mimeType ? { mimeType: source.data.mimeType } : {}),
          startSec,
          endSec,
        })
        if (created) {
          await refreshTaskSnapshot()
          message.success(`已生成截取片段 ${(endSec - startSec).toFixed(2)}s`)
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        message.error(`音频截取失败: ${text}`)
      }
    },
    [projectId, refreshTaskSnapshot],
  )

  // 音频变速 → ffmpeg atempo → 物化成新 audio 子节点 + generated 连线
  const handleAudioSpeed = useCallback(
    async (nodeId: string, factor: number) => {
      const snap = snapshotRef.current
      if (!projectId || !snap) return
      const source = snap.nodes.find((n) => n.id === nodeId)
      if (!source || source.type !== 'audio') return
      const filePath = readAudioLocalFilePath(source)
      if (!filePath) {
        message.error('无法定位源音频文件')
        return
      }
      try {
        const fileName = source.title ?? source.data.message ?? 'audio'
        const created = await canvasApi.materializeAudioSpeed({
          projectId,
          boardId: snap.board.id,
          parentNodeId: nodeId,
          filePath,
          fileName,
          ...(source.data.mimeType ? { mimeType: source.data.mimeType } : {}),
          factor,
        })
        if (created) {
          await refreshTaskSnapshot()
          message.success(`已生成 ${factor.toFixed(2)}x 变速副本`)
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        message.error(`音频变速失败: ${text}`)
      }
    },
    [projectId, refreshTaskSnapshot],
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
    const resolvedKind: 'image' | 'video' | 'audio' | null =
      resolved && !isCanvasImageContentNode(resolved)
        ? resolved.type === 'video'
          ? 'video'
          : resolved.type === 'audio'
            ? 'audio'
            : null
        : resolved
          ? 'image'
          : null
    if (!resolved || resolvedKind == null) {
      message.warning('当前节点没有可下载的图片、视频或音频内容')
      return
    }
    const linkedAsset = resolved.assetId
      ? (currentSnapshot.assets.find((item) => item.id === resolved.assetId) ?? null)
      : null
    await downloadCanvasResource({
      id: linkedAsset?.id ?? resolved.id,
      type: linkedAsset?.type ?? resolvedKind,
      title: linkedAsset?.title ?? resolved.title ?? null,
      suggestedFileName: canvasNodeDownloadName(
        node,
        linkedAsset?.title ?? resolved.title,
        resolvedKind === 'video' ? '视频' : resolvedKind === 'audio' ? '音频' : '图片',
      ),
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
      const operationNode = current.nodes.find(
        (node) => node.id === operationNodeId && isOperationNode(node),
      )
      const plan = planCanvasOperationOutputDeletion({
        operationNodeId,
        outputs,
        edges: current.edges,
      })
      if (plan.nodeIds.length === 0) {
        message.warning('所选产物没有可删除的画布节点')
        return
      }

      // 删除前预算，避免依赖 await 后的 snapshot 时序：
      // 1) 被删产物是否命中 primaryOutputId（命中则清空悬空指针，让 resolve 回退到最新 run）；
      // 2) 哪些 completed run 删完后产物全空 —— 按决策①连带删除空 task，
      //    避免运行历史残留可切到空白的空 run。
      const deletedKeys = new Set<string>()
      for (const item of outputs) {
        deletedKeys.add(item.id)
        if (item.nodeId) deletedKeys.add(item.nodeId)
        if (item.assetId) deletedKeys.add(item.assetId)
      }
      const primaryOutputId = operationNode?.data.primaryOutputId
      const primaryHit = primaryOutputId
        ? outputs.some(
            (item) =>
              item.id === primaryOutputId ||
              item.nodeId === primaryOutputId ||
              item.assetId === primaryOutputId,
          )
        : false
      const emptyTaskIds: string[] = []
      if (operationNode) {
        const runs = buildCanvasOperationRunViews(operationNode, current)
        for (const run of runs) {
          if (run.status !== 'completed') continue
          const remaining = run.outputs.filter((item) => {
            if (deletedKeys.has(item.id)) return false
            if (item.nodeId && deletedKeys.has(item.nodeId)) return false
            if (item.assetId && deletedKeys.has(item.assetId)) return false
            return true
          })
          if (remaining.length === 0) emptyTaskIds.push(run.taskId)
        }
      }

      await deleteEdges(plan.edgeIds)
      await deleteNodes(plan.nodeIds)
      if (primaryHit) {
        // primaryOutputId 是 optional 字段；updateManyNodeData 的清理逻辑（canvas.api.ts:4125-4129）
        // 会删除值为 undefined 的 key，借此清除悬空指针。exactOptionalPropertyTypes 下用双重断言表达删除语义。
        await updateNodeData(operationNodeId, {
          primaryOutputId: undefined,
          primaryOutputSelection: 'auto_latest',
        } as unknown as Partial<CanvasNode['data']>)
      }
      if (emptyTaskIds.length > 0) {
        await deleteTasks(emptyTaskIds)
      }

      if (plan.skippedOutputIds.length > 0) {
        message.warning(
          `已删除 ${plan.nodeIds.length} 个产物，另有 ${plan.skippedOutputIds.length} 个未关联画布节点，已跳过`,
        )
        return
      }
      message.success(
        plan.nodeIds.length === 1 ? '已删除产物节点' : `已删除 ${plan.nodeIds.length} 个产物节点`,
      )
    },
    [deleteEdges, deleteNodes, deleteTasks, updateNodeData],
  )

  const handleDeleteOperationRun = useCallback(
    async (operationNodeId: string, run: CanvasOperationRunView) => {
      const current = snapshotRef.current
      if (!current) return
      const operationNode = current.nodes.find(
        (node) => node.id === operationNodeId && isOperationNode(node),
      )
      if (!operationNode) return

      // 1. 该 task 的 generated 连线（sourceNodeId 命中 + 同一 taskId）
      const edgeIds = current.edges
        .filter(
          (edge) =>
            edge.type === 'generated' &&
            edge.sourceNodeId === operationNodeId &&
            edge.taskId === run.taskId,
        )
        .map((edge) => edge.id)

      // 2. 该 task 的产物节点（失败/取消 run 通常为空）
      const nodeIds = run.outputs
        .map((output) => output.nodeId)
        .filter((id): id is string => Boolean(id))

      // 3. primaryOutputId 是否命中该 run 的产物（命中则清空悬空指针）
      const primaryOutputId = operationNode.data.primaryOutputId
      const primaryHit = primaryOutputId
        ? run.outputs.some(
            (item) =>
              item.id === primaryOutputId ||
              item.nodeId === primaryOutputId ||
              item.assetId === primaryOutputId,
          )
        : false

      if (edgeIds.length > 0) await deleteEdges(edgeIds)
      if (nodeIds.length > 0) await deleteNodes(nodeIds)
      await deleteTasks([run.taskId])
      if (primaryHit) {
        await updateNodeData(operationNodeId, {
          primaryOutputId: undefined,
          primaryOutputSelection: 'auto_latest',
        } as unknown as Partial<CanvasNode['data']>)
      }

      message.success('已删除该运行记录')
    },
    [deleteEdges, deleteNodes, deleteTasks, updateNodeData],
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
        // 资产记录可能保留旧的方形音频尺寸；分离音频展开后统一落成长条资源节点。
        if (item.output.type === 'audio') {
          await patchNodes([created.id], {
            width: AUDIO_NODE_DEFAULT_SIZE.width,
            height: AUDIO_NODE_DEFAULT_SIZE.height,
          })
        }
        const isTextOutput = item.output.type === 'text' || item.output.type === 'prompt'
        const outputText = item.output.text?.trim() ?? ''
        await updateNodeData(created.id, {
          origin: 'asset',
          // 用产物自带的文本（分镜脚本等）覆盖资产派生文本，并标记为 markdown，
          // 保证展开后的文本节点双击进入分镜脚本编辑器时能正确回显。
          ...(outputText ? { text: outputText } : {}),
          ...(isTextOutput
            ? {
                format: (item.output.type === 'prompt' ? 'prompt' : 'markdown') as
                  | 'plain'
                  | 'markdown'
                  | 'prompt',
              }
            : {}),
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
    [connectNodes, insertAsset, patchNodes, updateNodeData],
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
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
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
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
      })
    },
    [createTextNode],
  )

  /** 工厂菜单「图片」直接落空节点（后续点占位按钮/双击再上传填充）。不建 asset。 */
  const addEmptyImage = useCallback(
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, IMAGE_NODE_DEFAULT_SIZE, {
            x: 140,
            y: 120,
          })
      const node = await createEmptyImageNode({
        x: position.x,
        y: position.y,
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
      })
      if (node) {
        setSelectedNodeIds([node.id])
      }
      return node
    },
    [createEmptyImageNode],
  )

  /** 工厂菜单「视频」直接落空节点（节点自带「上传视频」占位按钮，后续再上传填充）。不建 asset。 */
  const addEmptyVideo = useCallback(
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, VIDEO_NODE_DEFAULT_SIZE, {
            x: 140,
            y: 120,
          })
      const node = await createEmptyMediaNode({
        kind: 'video',
        x: position.x,
        y: position.y,
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
      })
      if (node) {
        setSelectedNodeIds([node.id])
      }
      return node
    },
    [createEmptyMediaNode],
  )

  /** 工厂菜单「音频」直接落空节点，并立即触发文件选择填充（音频空节点无占位上传按钮）。 */
  const addEmptyAudio = useCallback(
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, AUDIO_NODE_DEFAULT_SIZE, {
            x: 140,
            y: 120,
          })
      const node = await createEmptyMediaNode({
        kind: 'audio',
        x: position.x,
        y: position.y,
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
      })
      if (node) {
        setSelectedNodeIds([node.id])
        pendingAudioNodeIdRef.current = node.id
        audioFileInputRef.current?.click()
      }
      return node
    },
    [createEmptyMediaNode],
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

  const addDirectorStage3D = useCallback(
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
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
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
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
    async (preferredPosition?: CanvasPoint, pendingConnection?: PendingCanvasConnection | null) => {
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
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
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
        ...(pendingConnection ? { preservePreferredPosition: true } : {}),
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

  const handleInsertProviderFile = useCallback(
    async (input: {
      providerProfileId: string
      fileId: string
      fileName?: string
      mimeType?: string
      kind?: 'image' | 'video' | 'audio'
    }) => {
      if (!snapshot) return
      // 从 mimeType 推断节点类型（video→video / audio→audio / 其余→image），
      // 让 MiniMax Files 上传的图片/视频素材落到对应类型节点。
      const kind =
        input.kind ??
        (input.mimeType?.startsWith('video/')
          ? 'video'
          : input.mimeType?.startsWith('audio/')
            ? 'audio'
            : 'image')
      const nodeSize = kind === 'image' ? IMAGE_NODE_DEFAULT_SIZE : VIDEO_NODE_DEFAULT_SIZE
      const position = positionNodeInViewport(canvasViewportRef.current, nodeSize, {
        x: 220,
        y: 180,
      })
      await createProviderFileNode({
        providerProfileId: input.providerProfileId,
        fileId: input.fileId,
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        kind,
        x: position.x,
        y: position.y,
      })
      message.success('已加入画布，可作为视频生成输入')
    },
    [createProviderFileNode, snapshot],
  )

  const handleApplyCharacterSubview = useCallback(
    async (
      characterAsset: CanvasAsset,
      sourceImageAsset: CanvasAsset,
      subview: FilmCharacterSubview,
      options?: { sourceNodeId?: string },
    ) => {
      const sourceUrl = characterSourceImageUrl(sourceImageAsset)
      if (!sourceUrl) {
        message.warning('当前图片没有可用的源图')
        return
      }
      const cropSubviewToDataUrl = (url: string, cropPx: FilmCharacterSubview['cropPx']) =>
        cropCharacterSubviewToDataUrl(url, cropPx)
      const currentCanvasNodes = snapshotRef.current?.nodes ?? []
      const sourceNode = resolveCharacterSubviewCanvasSourceNode({
        ...(options?.sourceNodeId ? { preferredSourceNodeId: options.sourceNodeId } : {}),
        sourceAssetId: sourceImageAsset.id,
        canvasNodes: currentCanvasNodes,
      })
      if (sourceNode) {
        try {
          const inserted = await insertCharacterSubviewToCanvas(
            {
              sourceNode,
              canvasNodes: currentCanvasNodes,
              ownerAsset: characterAsset,
              sourceImageAsset,
              sourceImageUrl: sourceUrl,
              subview,
            },
            {
              cropToDataUrl: cropSubviewToDataUrl,
              dataUrlToFile,
              saveImage: (input) =>
                window.spark.invoke('file:save-pasted-image', {
                  ...input,
                  storageScope: 'canvas',
                  ...(snapshotRef.current?.project.rootPath
                    ? { projectRootPath: snapshotRef.current.project.rootPath }
                    : {}),
                }),
              createImageNode,
              patchNodes,
              updateNodeData,
              connectNodes,
              selectNode: (nodeId) => setSelectedNodeIds([nodeId]),
            },
          )
          if (!inserted) {
            message.error('子视图插入失败')
            return
          }
          message.success(`已将子视图「${subview.label}」插入原产物右侧并连线`)
        } catch (error) {
          message.error(
            error instanceof Error ? `子视图插入失败：${error.message}` : '子视图插入失败',
          )
        }
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
      try {
        const dataUrl = await cropSubviewToDataUrl(sourceUrl, subview.cropPx)
        const file = dataUrlToFile(dataUrl, `${baseName}-${viewName}-${Date.now()}.png`)
        const assetId = await uploadImageAsset(file)
        if (!assetId) {
          message.error('子视图生成失败')
          return
        }
        await handleInsertAsset(assetId)
        message.success(`已将子视图「${subview.label}」插入画布`)
      } catch (error) {
        message.error(
          error instanceof Error ? `子视图插入失败：${error.message}` : '子视图插入失败',
        )
      }
    },
    [
      connectNodes,
      createImageNode,
      handleInsertAsset,
      patchNodes,
      updateNodeData,
      uploadImageAsset,
    ],
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

  const handleApplyPromptEntryFromQuickUse = useCallback(
    async (entry: CanvasPromptLibraryEntry): Promise<boolean> => {
      if (selectedNodes.length > 0) {
        return handleApplyPromptEntryBesideSelection(entry)
      }
      if (!snapshot) return false

      const promptText = entry.negativePrompt
        ? `${entry.text}\n\nNegative prompt: ${entry.negativePrompt}`
        : entry.text
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 520, height: 260 },
        { x: 260, y: 180 },
      )
      const createdNode = await createTextNode({
        text: promptText,
        x: position.x,
        y: position.y,
      })
      if (!createdNode) return false

      await patchNodes([createdNode.id], {
        title: `提示词：${entry.label}`,
        width: 520,
        height: 260,
      })
      setSelectedNodeIds([createdNode.id])
      message.success(`已插入提示词节点：${entry.label}`)
      return true
    },
    [
      createTextNode,
      handleApplyPromptEntryBesideSelection,
      patchNodes,
      selectedNodes.length,
      snapshot,
    ],
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

  const materializeCanvasWorkflowAt = useCallback(
    async (workflow: CanvasWorkflowDefinition, position: { x: number; y: number }) => {
      if (!snapshot) return
      const previousNodeIds = new Set(snapshot.nodes.map((node) => node.id))
      const nextSnapshot = await materializeWorkflow({
        boardId: snapshot.board.id,
        originX: position.x,
        originY: position.y,
        workflowPackage: workflow.package,
      })
      setSelectedNodeIds(
        nextSnapshot.nodes.filter((node) => !previousNodeIds.has(node.id)).map((node) => node.id),
      )
      setWorkflowDrawerOpen(false)
      message.success(`已将“${workflow.name}”添加到画布`)
    },
    [materializeWorkflow, snapshot],
  )

  const handleAddCanvasWorkflow = useCallback(
    async (workflow: CanvasWorkflowDefinition) => {
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 560, height: 360 },
        { x: 200, y: 160 },
      )
      try {
        await materializeCanvasWorkflowAt(workflow, position)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '添加画布工作流失败')
      }
    },
    [materializeCanvasWorkflowAt],
  )

  const handleDropCanvasWorkflow = useCallback(
    async (position: { x: number; y: number }, workflowId: string) => {
      try {
        const workflow = await canvasWorkflowApi.get(workflowId)
        if (!workflow) throw new Error('画布工作流不存在或已被删除')
        await materializeCanvasWorkflowAt(workflow, position)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '添加画布工作流失败')
      }
    },
    [materializeCanvasWorkflowAt],
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
        // 复用 handleCreateGroup：编组后把选区切到新组，避免多选工具栏悬空
        void handleCreateGroup()
        return
      }
      // 图片：工厂菜单直接落空节点（后续再上传填充）
      if (item.nodeType === 'image') {
        void addEmptyImage()
        return
      }
      // 视频：落空节点（自带「上传视频」占位按钮）；音频：落空节点并立即触发文件选择
      if (item.nodeType === 'video') {
        void addEmptyVideo()
        return
      }
      if (item.nodeType === 'audio') {
        void addEmptyAudio()
        return
      }
      // 旧入口兜底：选图即加
      if (item.action === 'upload_image') {
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
      handleCreateGroup,
      createOperationNode,
      selectedTopLevelNodes,
      snapshot,
      uploadFirstImage,
      setSidePanelTab,
    ],
  )

  // ─── 3D 导演台（subtype director_stage_3d）───
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

  /** 画布上所有可用作工作台源的视频节点（供工作台「从画布选择」旧「设为源」入口）。
   *  排除当前工作台节点自身；任务产物(task_output)的 url 已固化为持久路径，可纳入。 */
  const videoNodesForWorkbench = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter(
          (n) =>
            n.type === 'video' && typeof n.data.url === 'string' && n.id !== videoWorkbenchNodeId,
        )
        .map((n) => ({
          id: n.id,
          title: n.title ?? '视频',
          url: n.data.url as string,
          ...(n.data.thumbnailUrl ? { thumbnailUrl: n.data.thumbnailUrl as string } : {}),
        })),
    [snapshot?.nodes, videoWorkbenchNodeId],
  )

  const {
    addLocalResources: handleAddLocalWorkbenchResources,
    pickCanvasResources: handlePickCanvasWorkbenchResources,
    collectUpstreamResources: handleCollectUpstreamWorkbenchResources,
  } = useCanvasVideoWorkbenchResources({
    snapshot,
    projectId,
    workbenchNodeId: videoWorkbenchNodeId,
    selectedNodes,
  })

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
  const handleMaterializeVideoOutput = useCallback(
    async (
      output: WorkbenchOutput,
      mode: 'add' | 'replace',
    ): Promise<WorkbenchCanvasMaterialization | undefined> => {
      const current = snapshotRef.current
      const target = current?.nodes.find((item) => item.id === videoWorkbenchNodeId)
      if (!current || !target || !projectId) throw new Error('当前视频节点已不存在')

      const sourcePath = output.outputPath
      const media = resolveWorkbenchMaterializationMedia(sourcePath)
      if (mode === 'replace' && media.kind === 'image') {
        throw new Error('GIF 等图片产物只能添加为新的图片节点，不能替换视频节点')
      }
      if (!sourcePath) throw new Error('产物文件路径为空')
      const copied = await window.spark.invoke('canvas:asset:copy-to-project', {
        projectId,
        ...(current.project.rootPath ? { projectRootPath: current.project.rootPath } : {}),
        sourcePath,
        suggestedBaseName: output.summary || 'video-output',
        type: media.kind,
      })
      if (copied.error || !copied.filePath) {
        throw new Error(copied.error ?? '产物复制到项目失败')
      }

      const filePath = copied.filePath as string
      const fileUrl = encodeToSafeFileUrl(filePath)
      const fileName =
        (copied.fileName as string | undefined) ??
        output.outputPath.split(/[\\/]/).pop() ??
        'video-output.mp4'

      if (media.kind === 'image') {
        const dimensions = await readImageDimensions(fileUrl)
        const imageWidth = dimensions.width || 320
        const imageHeight = dimensions.height || 180
        const imageNode = await createImageNode({
          file: new File([], fileName, { type: media.mimeType }),
          filePath,
          ...(copied.fileSize !== undefined ? { fileSize: copied.fileSize } : {}),
          x: target.x + target.width + 60,
          y: target.y,
          ...fitImageNodeSize(imageWidth, imageHeight),
          imageWidth,
          imageHeight,
        })
        if (!imageNode) throw new Error('产物节点创建失败')
        setSelectedNodeIds([imageNode.id])
        return { nodeId: imageNode.id, outputPath: filePath, outputUrl: fileUrl }
      }

      const dimensions = await readVideoDimensions(fileUrl)

      if (mode === 'replace') {
        const size = fitCanvasVideoNodeSize(dimensions.width, dimensions.height)
        const centerX = target.x + target.width / 2
        const centerY = target.y + target.height / 2
        await patchNodes([target.id], {
          width: size.width,
          height: size.height,
          x: Math.round(centerX - size.width / 2),
          y: Math.round(centerY - size.height / 2),
        })
        await updateNodeData(target.id, {
          url: fileUrl,
          mimeType: media.mimeType,
          ...(dimensions.width ? { mediaWidth: dimensions.width } : {}),
          ...(dimensions.height ? { mediaHeight: dimensions.height } : {}),
          ...(dimensions.durationMs ? { durationMs: dimensions.durationMs } : {}),
        })
        setSelectedNodeIds([target.id])
        return { nodeId: target.id, outputPath: filePath, outputUrl: fileUrl }
      }

      const created = await createMediaNode({
        kind: 'video',
        fileName,
        fileMimeType: media.mimeType,
        ...(copied.fileSize !== undefined ? { fileSize: copied.fileSize } : {}),
        filePath,
        x: target.x + target.width + 60,
        y: target.y,
        ...(dimensions.width ? { mediaWidth: dimensions.width } : {}),
        ...(dimensions.height ? { mediaHeight: dimensions.height } : {}),
        ...(dimensions.durationMs ? { durationMs: dimensions.durationMs } : {}),
      })
      if (!created) throw new Error('产物节点创建失败')
      setSelectedNodeIds([created.id])
      return { nodeId: created.id, outputPath: filePath, outputUrl: fileUrl }
    },
    [createImageNode, createMediaNode, patchNodes, projectId, updateNodeData, videoWorkbenchNodeId],
  )

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
    async (
      frames: WorkbenchKeyframe[],
      sourceNodeId: string,
    ): Promise<WorkbenchKeyframe[] | undefined> => {
      if (!snapshot || !projectId || frames.length === 0) return
      const source = snapshot.nodes.find((n) => n.id === sourceNodeId)
      const createdIds: string[] = []
      const createdIdsByOrder: Array<string | undefined> = []
      const copiedPathsByOrder: Array<string | undefined> = []
      const copiedUrlsByOrder: Array<string | undefined> = []
      const firstFrameDimensions = await readImageDimensions(frames[0]!.previewUrl)
      const hasFrameDimensions = firstFrameDimensions.width > 0 && firstFrameDimensions.height > 0
      const nodeSize = getKeyframeCanvasNodeSize(
        firstFrameDimensions.width,
        firstFrameDimensions.height,
      )
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
      try {
        for (let start = 0; start < frames.length; start += BATCH) {
          const batch = frames.slice(start, start + BATCH)
          const imageNodes = await Promise.all(
            batch.map(async (kf, j) => {
              const i = start + j
              const fileName = `keyframe_${String(i + 1).padStart(3, '0')}.jpg`
              const copied = await window.spark.invoke('canvas:asset:copy-to-project', {
                projectId,
                ...(snapshot.project.rootPath
                  ? { projectRootPath: snapshot.project.rootPath }
                  : {}),
                sourcePath: kf.path,
                suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
                type: 'image',
              })
              if (copied.error || !copied.filePath) {
                throw new Error(copied.error ?? `关键帧 ${i + 1} 复制到项目失败`)
              }
              const filePath = copied.filePath as string
              const copiedFileName = (copied.fileName as string | undefined) ?? fileName
              copiedPathsByOrder[i] = filePath
              copiedUrlsByOrder[i] = encodeToSafeFileUrl(filePath)
              const file = new File([], copiedFileName, {
                type: resolveWorkbenchMaterializationMedia(filePath).mimeType,
              })
              const position = getKeyframeCanvasGridPosition(i, { x: baseX, y: baseY }, nodeSize)
              return createImageNode({
                file,
                filePath,
                ...(copied.fileSize !== undefined ? { fileSize: copied.fileSize } : {}),
                ...position,
                width: nodeSize.width,
                height: nodeSize.height,
                ...(hasFrameDimensions
                  ? {
                      imageWidth: firstFrameDimensions.width,
                      imageHeight: firstFrameDimensions.height,
                    }
                  : {}),
              })
            }),
          )
          // patchNodes + connectNodes 串行（涉及 DB 写入，避免竞态）
          for (let j = 0; j < imageNodes.length; j++) {
            const imageNode = imageNodes[j]
            if (imageNode) {
              createdIdsByOrder[start + j] = imageNode.id
              await patchNodes([imageNode.id], {
                title: getKeyframeImportTitle(start + j),
              })
              createdIds.push(imageNode.id)
            }
          }
        }
      } finally {
        message.destroy(loadingKey)
      }
      let selectedNodeIds = createdIds
      if (createdIds.length > 1) {
        const nextSnapshot = await createGroupNode(createdIds)
        const createdIdSet = new Set(createdIds)
        const groupNode = nextSnapshot?.nodes.find((candidate) => {
          if (candidate.type !== 'group') return false
          const childIds = nextSnapshot.nodes
            .filter((child) => child.parentNodeId === candidate.id)
            .map((child) => child.id)
          return (
            createdIds.every((id) => childIds.includes(id)) &&
            childIds.every((id) => createdIdSet.has(id))
          )
        })
        if (groupNode) {
          await patchNodes([groupNode.id], {
            title: source?.title ? `${source.title} · 关键帧` : `关键帧组 · ${frames.length}帧`,
          })
          if (source) {
            await connectNodes({ sourceNodeId: source.id, targetNodeId: groupNode.id })
          }
          selectedNodeIds = [groupNode.id]
        } else if (source) {
          await Promise.all(
            createdIds.map((targetNodeId) =>
              connectNodes({ sourceNodeId: source.id, targetNodeId }),
            ),
          )
        }
      } else if (createdIds.length === 1 && source) {
        const [createdNodeId] = createdIds
        if (createdNodeId) {
          await connectNodes({ sourceNodeId: source.id, targetNodeId: createdNodeId })
        }
      }
      if (selectedNodeIds.length > 0) setSelectedNodeIds(selectedNodeIds)
      message.success(`已导入 ${createdIds.length} 个关键帧到画布`)
      return frames.map((frame, index) => ({
        ...frame,
        ...(copiedPathsByOrder[index] ? { path: copiedPathsByOrder[index] } : {}),
        ...(copiedUrlsByOrder[index] ? { previewUrl: copiedUrlsByOrder[index] } : {}),
        ...(createdIdsByOrder[index] ? { canvasNodeId: createdIdsByOrder[index] } : {}),
      }))
    },
    [connectNodes, createGroupNode, createImageNode, patchNodes, projectId, snapshot],
  )

  const handleAnnotateImageComplete = useCallback(
    async (input: {
      dataUrl: string
      width: number
      height: number
      sourceNode: CanvasNode
      document: CanvasImageAnnotationDocument
      documentPath?: string
    }) => {
      if (!snapshot) return
      const baseName = annotationBaseName(input.sourceNode)
      const fileName = `${baseName}-annotated-${Date.now()}.png`
      const documentPath = await saveCanvasImageAnnotationDocument({
        document: input.document,
        sourceNode: input.sourceNode,
        ...(input.documentPath ? { existingFilePath: input.documentPath } : {}),
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
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
      const placement = placeAutoNodeToRight(
        {
          x: source.x,
          y: source.y,
          width: source.width,
          height: source.height,
        },
        nodeSize,
      )
      const imageNode = await createImageNode({
        file,
        filePath: savedImage.filePath,
        x: placement.x,
        y: placement.y,
        width: nodeSize.width,
        height: nodeSize.height,
        imageWidth: input.width,
        imageHeight: input.height,
        preservePreferredPosition: true,
      })
      if (imageNode) {
        await patchNodes([imageNode.id], {
          title: `${source.title ?? '图片'} · 标注`,
          data: {
            ...imageNode.data,
            imageAnnotation: createCanvasImageAnnotationRef({
              documentPath,
              document: input.document,
              sourceNode: source,
            }),
          },
        })
        await connectNodes({ sourceNodeId: source.id, targetNodeId: imageNode.id })
        // “完成”代表这一轮草稿已经结算到新图片节点。新节点保留侧车文档用于追溯，
        // 原图则清除自动草稿引用；两者下一次都从各自当前图片开启一轮新的标注。
        await updateNodeData(source.id, {
          // updateNodeData 在运行时会删除值为 undefined 的字段；这里用显式断言表达“删除”。
          imageAnnotation: undefined,
        } as unknown as Partial<CanvasNode['data']>)
        setSelectedNodeIds([imageNode.id])
      }
      setAnnotatingImageNodeId(null)
      message.success('已生成标注图片节点')
    },
    [connectNodes, createImageNode, patchNodes, snapshot, updateNodeData],
  )

  const handleAnnotateImageDraftSaved = useCallback(
    async (input: {
      documentPath: string
      document: CanvasImageAnnotationDocument
      sourceNode: CanvasNode
    }) => {
      const source = input.sourceNode
      await patchNodes([source.id], {
        data: {
          ...source.data,
          imageAnnotation: createCanvasImageAnnotationRef(input),
        },
      })
    },
    [patchNodes],
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

      const imageBatchSize = shouldGroup
        ? (() => {
            const gridMetrics = getImageGridMetrics(preparedImages)
            return {
              width: Math.max(360, gridMetrics.width + GROUP_IMAGE_PADDING_X * 2),
              height: Math.max(
                220,
                GROUP_IMAGE_HEADER_HEIGHT + gridMetrics.height + GROUP_IMAGE_PADDING_BOTTOM,
              ),
            }
          })()
        : (preparedImages[0] ?? {
            width: IMAGE_NODE_DEFAULT_SIZE.width,
            height: IMAGE_NODE_DEFAULT_SIZE.height,
          })
      const preferredPosition = placeAutoNodeToRight(
        {
          x: input.sourceNode.x,
          y: input.sourceNode.y,
          width: input.sourceNode.width,
          height: input.sourceNode.height,
        },
        imageBatchSize,
      )

      // 把新切分节点接到来源节点的下游：删除 source→child，改为 newPrimary→child，
      // 让切分产物插入到来源节点与其后续子节点之间（放在原节点后面、连线到后续子节点）。
      const rewireDownstreamTo = async (newPrimaryId: string) => {
        const sourceId = input.sourceNode.id
        const downstreamEdges = snapshot.edges.filter(
          (edge) => edge.sourceNodeId === sourceId && edge.targetNodeId !== newPrimaryId,
        )
        if (downstreamEdges.length === 0) return
        const childIds = Array.from(new Set(downstreamEdges.map((edge) => edge.targetNodeId)))
        await deleteEdges(downstreamEdges.map((edge) => edge.id))
        await Promise.all(
          childIds.map((childId) =>
            connectNodes({ sourceNodeId: newPrimaryId, targetNodeId: childId }),
          ),
        )
      }

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
          preservePreferredPosition: true,
        })
        if (imageNode) {
          await patchNodes([imageNode.id], {
            title: image.title ?? `${input.sourceNode.title ?? '图片'} · 宫格切分`,
          })
          await connectNodes({ sourceNodeId: input.sourceNode.id, targetNodeId: imageNode.id })
          await rewireDownstreamTo(imageNode.id)
          setSelectedNodeIds([imageNode.id])
        }
        setGridSplitImageNodeId(null)
        message.success('已生成宫格切分图片节点')
        return
      }

      // 放在来源节点右侧（与单张切分一致），而不是视口居中。
      const groupPosition = preferredPosition
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
          preservePreferredPosition: true,
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
          await rewireDownstreamTo(groupNode.id)
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
    [connectNodes, createGroupNode, createImageNode, deleteEdges, patchNodes, snapshot],
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
      if (
        leaveOpen ||
        saveToLibraryNodeId != null ||
        promptCreateOpen ||
        annotatingImageNodeId != null ||
        workflowToRun != null ||
        promptQuickUseOpen
      )
        return
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

      if (isPromptLibraryShortcut(event) && snapshot) {
        stop()
        setPromptQuickUseOpen(true)
        return
      }

      if (isPromptLibraryCreateShortcut(event) && snapshot) {
        stop()
        setPromptCreateOpen(true)
        return
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
    workflowToRun,
    refresh,
    saveToLibraryNodeId,
    shortcutHelpOpen,
    templateOpen,
    handleDeleteSelectedNodes,
    selectedNodes,
    promptQuickUseOpen,
    promptCreateOpen,
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
      } else if (promptCreateOpen) {
        setPromptCreateOpen(false)
      } else if (promptQuickUseOpen) {
        setPromptQuickUseOpen(false)
      } else if (annotatingImageNodeId != null) {
        setAnnotatingImageNodeId(null)
      } else if (activeOperationPanelNodeId != null) {
        setActiveOperationPanelNodeId(null)
        setSelectedNodeIds([])
      } else if (editingNodeId != null) {
        setEditingNodeId(null)
        setSelectedNodeIds([])
      } else if (workflowToRun != null) {
        setWorkflowToRun(null)
      } else if (workflowExtractDraft != null) {
        setWorkflowExtractDraft(null)
      } else if (agentOpen) {
        setAgentOpen(false)
      } else if (workflowDrawerOpen) {
        setWorkflowDrawerOpen(false)
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
    promptCreateOpen,
    promptQuickUseOpen,
    annotatingImageNodeId,
    activeOperationPanelNodeId,
    editingNodeId,
    workflowExtractDraft,
    workflowToRun,
    agentOpen,
    workflowDrawerOpen,
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

    const replaceImageNodeId = replaceImageNodeIdRef.current
    replaceImageNodeIdRef.current = null
    if (replaceImageNodeId) {
      const file = selectedFiles[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        message.warning('请选择图片文件')
        return
      }
      try {
        const targetNode = snapshot.nodes.find((node) => node.id === replaceImageNodeId)
        if (!targetNode || targetNode.type !== 'image') {
          message.error('未找到目标图片节点')
          return
        }
        const prepared = await prepareCanvasImageUpload(file)
        const fileUrl = encodeToSafeFileUrl(prepared.filePath)
        // 保持节点中心点不变，按新图宽高重算节点框
        const centerX = targetNode.x + targetNode.width / 2
        const centerY = targetNode.y + targetNode.height / 2
        await patchNodes([replaceImageNodeId], {
          width: prepared.width,
          height: prepared.height,
          x: Math.round(centerX - prepared.width / 2),
          y: Math.round(centerY - prepared.height / 2),
        })
        await updateNodeData(replaceImageNodeId, {
          url: fileUrl,
          thumbnailUrl: fileUrl,
          mimeType: file.type,
        })
        message.success('已替换图片')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '替换图片失败')
      }
      return
    }

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
      const result = await insertPreparedImages(preparedImages, preferredPosition, {
        preservePreferredPosition: pendingConnection != null,
      })
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
    mediaInputMode,
    capabilityId,
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
  } & Pick<CanvasPromptTaskFields, 'mediaInputMode' | 'capabilityId'>) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    // Persist the live viewport before the task API refreshes the snapshot.
    const viewportBeforeCreate = await persistCurrentCanvasViewport()
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const taskInputNodes =
      inputNodeIds !== undefined ? resolveCanvasInputNodes(inputNodeIds, snapshot) : aiInputNodes
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
    const systemPrompt = buildCanvasOperationSystemPrompt(
      operation,
      readCanvasExecutionPresetPrompt(presetTargetId),
    )
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

    const createdTask = await runWithCanvasTaskViewport(
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
          ...(mediaInputMode ? { mediaInputMode } : {}),
          ...(capabilityId ? { capabilityId } : {}),
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
    return createdTask ?? null
  }

  const executeCanvasWorkflow = async ({
    workflow,
    run,
    plan,
    signal,
  }: CanvasWorkflowRunExecutionInput): Promise<CanvasWorkflowRun> =>
    executeCanvasWorkflowPlan({
      run,
      plan,
      signal,
      updateStep: (request) => canvasWorkflowApi.updateRunStep(request),
      cancelRun: (runId) => canvasWorkflowApi.cancelRun(runId),
      executeStep: (context) =>
        executeCanvasWorkflowCanvasStep(context, {
          contract: plan.contract,
          createOperation: async (request) => {
            const task = await handleCreateTask({
              operation: request.operation as CanvasOperationType,
              prompt: request.prompt,
              ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
              inputNodeIds: request.inputNodeIds,
              ...(request.providerProfileId
                ? { providerProfileId: request.providerProfileId }
                : {}),
              ...(request.manifestId ? { manifestId: request.manifestId } : {}),
              ...(request.modelId ? { modelId: request.modelId } : {}),
              modelParams: request.modelParams,
              ...(request.agentId ? { agentId: request.agentId } : {}),
              ...(request.skillIds ? { skillIds: request.skillIds } : {}),
              taskTitle: request.taskTitle,
              ...(request.outputTitle ? { outputTitle: request.outputTitle } : {}),
            })
            return task ? { id: task.id } : null
          },
          waitForTask: async (taskId, taskSignal) => {
            const task = await waitForCanvasWorkflowTask({
              projectId,
              taskId,
              readSnapshot: (currentProjectId) => canvasApi.openSnapshot(currentProjectId),
              ...(taskSignal ? { signal: taskSignal } : {}),
            })
            return {
              id: task.id,
              outputNodeIds: task.outputNodeIds,
              outputAssetIds: task.outputAssetIds,
            }
          },
          markProvenance: async (task, context) => {
            const provenance = {
              definitionId: workflow.id,
              version: run.workflowVersion,
              runId: run.id,
              stepNodeId: context.step.nodeId,
            }
            if (task.outputNodeIds.length > 0) {
              await updateManyNodeData(
                task.outputNodeIds.map((nodeId) => ({
                  nodeId,
                  data: { workflowProvenance: provenance },
                })),
              )
            }
            if (task.outputAssetIds.length > 0) {
              const latest = await canvasApi.openSnapshot(projectId)
              for (const assetId of task.outputAssetIds) {
                const asset = latest.assets.find((item) => item.id === assetId)
                const attributes =
                  asset?.metadata.attributes &&
                  typeof asset.metadata.attributes === 'object' &&
                  !Array.isArray(asset.metadata.attributes)
                    ? (asset.metadata.attributes as Record<string, string>)
                    : {}
                await updateFilmAsset(assetId, {
                  attributes: {
                    ...attributes,
                    workflowDefinitionId: workflow.id,
                    workflowVersion: String(run.workflowVersion),
                    workflowRunId: run.id,
                    workflowStepNodeId: context.step.nodeId,
                  },
                })
              }
            }
          },
          executeSubworkflow: async (request) => {
            const childWorkflow = await canvasWorkflowApi.get(request.workflowId)
            if (!childWorkflow) {
              throw new Error(`找不到子工作流“${request.workflowId}”`)
            }
            const childRun = await canvasWorkflowApi.createRun({
              workflowId: childWorkflow.id,
              workflowVersion: request.workflowVersion,
              projectId,
              inputs: request.inputs,
              exposedParams: request.exposedParams,
              idempotencyKey: request.idempotencyKey,
            })
            const completed = await executeCanvasWorkflow({
              workflow: childWorkflow,
              run: childRun.run,
              plan: childRun.plan,
              signal: request.signal ?? new AbortController().signal,
            })
            if (completed.status !== 'completed') {
              throw new Error(`子工作流“${childWorkflow.name}”未完成：${completed.status}`)
            }
            return {
              runId: completed.id,
              workflowVersion: completed.workflowVersion,
              outputs: completed.outputs,
            }
          },
        }),
    })

  const workflowInputNodes = useMemo(
    () =>
      (snapshot?.nodes ?? []).flatMap((node) => {
        if (node.type === 'group' || isOperationNode(node)) return []
        const valueTypes: CanvasWorkflowValueType[] = ['node']
        if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
          valueTypes.push(node.type)
        }
        if (node.assetId) valueTypes.push('asset')
        return [{ id: node.id, label: node.title?.trim() || node.type, valueTypes }]
      }),
    [snapshot?.nodes],
  )

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
      taskPipelineRole?: CanvasPipelineRole
      outputPipelineRole?: CanvasPipelineRole
      shotScriptConfig?: ShotScriptConfig
    } & CanvasPromptTaskFields,
    run: (
      captureDiagnostics: CaptureCanvasTrackedWorkflowDiagnostics,
    ) => Promise<TrackedCanvasWorkflowResult>,
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
      ...(request.taskPipelineRole ? { taskPipelineRole: request.taskPipelineRole } : {}),
      ...(request.outputPipelineRole ? { outputPipelineRole: request.outputPipelineRole } : {}),
      ...(request.shotScriptConfig ? { shotScriptConfig: request.shotScriptConfig } : {}),
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

    let diagnostics: CanvasTrackedWorkflowDiagnostics = {}
    const captureDiagnostics: CaptureCanvasTrackedWorkflowDiagnostics = (next) => {
      diagnostics = mergeCanvasTrackedWorkflowDiagnostics(diagnostics, next)
    }
    try {
      const result = await run(captureDiagnostics)
      const effectiveDiagnostics = mergeCanvasTrackedWorkflowDiagnostics(diagnostics, result)
      await canvasApi.finishWorkflowTask(projectId, taskId, {
        status: 'completed',
        ...(result.outputNodeIds ? { outputNodeIds: result.outputNodeIds } : {}),
        ...(result.outputAssetIds ? { outputAssetIds: result.outputAssetIds } : {}),
        ...(result.message ? { message: result.message } : {}),
        ...(effectiveDiagnostics.rawResponse !== undefined
          ? { rawResponse: effectiveDiagnostics.rawResponse }
          : {}),
        ...(effectiveDiagnostics.modelOutputText !== undefined
          ? { modelOutputText: effectiveDiagnostics.modelOutputText }
          : {}),
        ...(effectiveDiagnostics.agentId !== undefined
          ? { agentId: effectiveDiagnostics.agentId }
          : {}),
        ...(effectiveDiagnostics.providerProfileId !== undefined
          ? { providerProfileId: effectiveDiagnostics.providerProfileId }
          : {}),
        ...(effectiveDiagnostics.provider !== undefined
          ? { provider: effectiveDiagnostics.provider }
          : {}),
        ...(effectiveDiagnostics.modelId !== undefined
          ? { modelId: effectiveDiagnostics.modelId }
          : {}),
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
        ...(diagnostics.rawResponse !== undefined ? { rawResponse: diagnostics.rawResponse } : {}),
        ...(diagnostics.modelOutputText !== undefined
          ? { modelOutputText: diagnostics.modelOutputText }
          : {}),
        ...(diagnostics.agentId !== undefined ? { agentId: diagnostics.agentId } : {}),
        ...(diagnostics.providerProfileId !== undefined
          ? { providerProfileId: diagnostics.providerProfileId }
          : {}),
        ...(diagnostics.provider !== undefined ? { provider: diagnostics.provider } : {}),
        ...(diagnostics.modelId !== undefined ? { modelId: diagnostics.modelId } : {}),
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
    outputFilmAssetId?: string
    outputFilmReferenceKind?: FilmReferenceKind
    /** 预绑定的上游节点（仅创建时记录；用户可在面板里改） */
    inputNodeIds?: string[]
    /** 首帧/尾帧/参考图的明确语义，必须随操作节点持久化。 */
    inputRoles?: Record<string, CanvasTaskInputRoleSelection>
    /** 自定义节点尺寸，用于 viewport 居中计算 */
    size?: { width: number; height: number }
    /** 创建后是否自动打开操作面板，默认 true */
    openPanel?: boolean
  }): Promise<CanvasNode | null> => {
    const snapshot = snapshotRef.current
    if (!snapshot) return null
    const size = params.size ?? OPERATION_NODE_DEFAULT_SIZE
    const placement =
      pipelineActionPositionRef.current ??
      positionNodeInViewport(canvasViewportRef.current, size, { x: 260, y: 200 })
    const existingNodeIds = new Set(snapshot.nodes.map((item) => item.id))
    const inputBindings = params.inputRoles
      ? buildCanvasInputBindingsForRoles(snapshot.nodes, params.inputRoles)
      : []
    const next = await createOperationNode({
      boardId: snapshot.board.id,
      operation: params.operation,
      inputNodeIds: params.inputNodeIds ?? [],
      x: Math.round(placement.x),
      y: Math.round(placement.y),
      title: params.title,
      systemPrompt: params.prompt,
      message: params.message ?? '请在操作面板确认 Prompt / Agent / 模型后点击开始任务',
      ...(inputBindings.length > 0 ? { inputBindings } : {}),
      ...(params.modelParams ? { modelParams: params.modelParams } : {}),
      ...(params.taskPipelineRole ? { taskPipelineRole: params.taskPipelineRole } : {}),
      ...(params.outputPipelineRole ? { outputPipelineRole: params.outputPipelineRole } : {}),
      ...(params.outputTitle ? { outputTitle: params.outputTitle } : {}),
      ...(pipelineActionPositionRef.current ? { preservePreferredPosition: true } : {}),
    })
    const created = findLatestCreatedOperationNode(
      next?.nodes ?? [],
      params.operation,
      existingNodeIds,
    )
    if (created) {
      if (params.outputFilmAssetId) {
        await updateNodeData(created.id, {
          outputFilmAssetId: params.outputFilmAssetId,
          ...(params.outputFilmReferenceKind
            ? { outputFilmReferenceKind: params.outputFilmReferenceKind }
            : {}),
        })
      }
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
    options,
  ) => {
    return deleteManuscript(manuscriptAssetId, options)
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
    return resolveShotSegmentContext(group, segment, snapshot.assets)
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
    outputFilmAssetId,
    outputFilmReferenceKind,
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
    outputFilmAssetId?: string
    outputFilmReferenceKind?: FilmReferenceKind
    shotScriptConfig?: ShotScriptConfig
    position?: CanvasPoint
    /** 从节点右键流水线创建时默认只选中新节点，避免面板被菜单收尾状态立即关闭。 */
    openPanel?: boolean
    selectCreated?: boolean
    announce?: boolean
  }) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const requestedPosition = position ?? pipelineActionPositionRef.current
    const placement =
      requestedPosition ??
      placeNodeRightOfNodes([sourceNode], { x: 360, y: 0 }, 96, OPERATION_NODE_DEFAULT_SIZE)
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
      preservePreferredPosition: true,
      ...(requestedPosition == null ? { autoPlaceAfterInputs: true } : {}),
      ...runtime,
    })
    const created = findLatestCreatedOperationNode(next?.nodes ?? [], operation, existingNodeIds)
    if (created) {
      if (outputFilmAssetId) {
        await updateNodeData(created.id, {
          outputFilmAssetId,
          ...(outputFilmReferenceKind ? { outputFilmReferenceKind } : {}),
        })
      }
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
    const pipelineTextSource = resolveCanvasPipelineTextSource(node, snapshot)
    const action = CANVAS_PIPELINE_OPS.find((item) => item.id === actionId)
    const inputType = getCanvasPipelineInputType(pipelineTextSource.sourceNode)
    if (action && (!inputType || !action.inputTypes.includes(inputType))) {
      message.warning(
        `「${action.label}」仅支持${action.inputTypes.join('、')}输入，当前节点不是可用的媒体类型`,
      )
      return
    }
    // 分镜 / 关键帧节点：媒体型动作仍按输入内容执行；只有已有分镜回链时才启用
    // 分组批处理等增强行为，不把语义回链当成动作的必要前置条件。
    if (
      actionId === 'shot.to_keyframes' ||
      actionId === 'shot.to_video' ||
      actionId === 'keyframe.to_video'
    ) {
      const shotSourceNode = pipelineTextSource.sourceNode
      if (
        actionId === 'shot.to_keyframes' &&
        ['text', 'prompt', 'image'].includes(getCanvasPipelineInputType(shotSourceNode) ?? '')
      ) {
        await createConfiguredOperationNode({
          sourceNode: shotSourceNode,
          operation: 'storyboard_grid',
          title: '生成分镜关键帧图',
          prompt:
            '请根据输入内容生成一张分镜关键帧宫格图，保持镜头顺序、人物一致性与场景连续性；输入可以是普通文本、分镜脚本或图片参考。',
          nodeMessage: '确认故事板 Prompt、Agent 与模型后点击开始任务',
          taskPipelineRole: 'shot',
          outputPipelineRole: 'keyframe',
        })
        return
      }
      if (
        actionId === 'keyframe.to_video' &&
        getCanvasPipelineInputType(shotSourceNode) === 'image'
      ) {
        await createConfiguredOperationNode({
          sourceNode: shotSourceNode,
          operation: 'image_to_video',
          title: '生成视频',
          prompt:
            pipelineTextSource.sourceText ||
            '请根据输入图片生成连贯的视频，保持主体、构图和视觉风格一致。',
          nodeMessage: '确认视频 Prompt、Agent 与模型后点击开始任务',
          taskPipelineRole: 'keyframe',
          outputPipelineRole: 'clip',
        })
        return
      }
      if (actionId === 'shot.to_video') {
        const groupId = shotSourceNode.data.shotGroupId ?? node.data.shotGroupId
        const segmentId = shotSourceNode.data.shotSegmentId ?? node.data.shotSegmentId
        if (groupId && !segmentId) {
          const group = readFilmData(snapshot.project.metadata)?.shotGroups?.find(
            (item) => item.id === groupId,
          )
          if (group && group.segments.length > 0) {
            for (const segment of group.segments) {
              await handleGenerateSegmentVideo(
                resolveShotSegmentContext(group, segment, snapshot.assets),
                { openPanel: false },
              )
            }
            message.success(`已按 ${group.segments.length} 个分镜创建视频任务节点`)
            return
          }
        }
      }
      const resolved = resolveShotFromNode(shotSourceNode) ?? resolveShotFromNode(node)
      if (!resolved) {
        if (actionId === 'shot.to_video') {
          const draft = buildCanvasPipelineOperationDraft({
            actionId,
            sourceText: pipelineTextSource.sourceText,
            styleBible: buildProductionBiblePrompt(snapshot.project.metadata),
          })
          await createConfiguredOperationNode({
            sourceNode: shotSourceNode,
            operation: draft.operation,
            title: draft.title,
            prompt: draft.systemPrompt,
            nodeMessage: draft.message,
            ...(draft.modelParams ? { modelParams: draft.modelParams } : {}),
            ...(draft.taskPipelineRole ? { taskPipelineRole: draft.taskPipelineRole } : {}),
            ...(draft.outputPipelineRole ? { outputPipelineRole: draft.outputPipelineRole } : {}),
          })
          return
        }
        message.warning('该节点没有可用的分镜关键帧输入')
        return
      }
      if (actionId === 'shot.to_keyframes') {
        handleGenerateSegmentKeyframes(resolved, { openPanel: false })
      } else {
        await handleGenerateSegmentVideo(resolved, { openPanel: false })
      }
      return
    }
    const { sourceNode: textSourceNode, sourceText } = pipelineTextSource
    const resolveAssetTargets = (): CanvasPipelineAssetTarget[] => {
      const targets = resolveCanvasPipelineAssetTargets({ sourceNode: node, actionId, snapshot })
      // 同类型影视资产存在时继续批量创建；没有资产时由普通文本/Prompt直接创建单个任务。
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
        await handlePrepareChapterToScreenplayOperation(textSourceNode, sourceText)
        break
      case 'screenplay.to_shot_script':
        await handleGenerateShotScript(textSourceNode, sourceText)
        break
      case 'screenplay.extract_characters':
        await handlePrepareExtractEntitiesOperation(textSourceNode, sourceText, 'character')
        break
      case 'screenplay.extract_scenes':
        await handlePrepareExtractEntitiesOperation(textSourceNode, sourceText, 'scene')
        break
      case 'screenplay.extract_props':
        await handlePrepareExtractEntitiesOperation(textSourceNode, sourceText, 'prop')
        break
      case 'screenplay.extract_effects':
        await handlePrepareExtractEntitiesOperation(textSourceNode, sourceText, 'effect')
        break
      case 'screenplay.storyboard_grid':
        handleStoryboardGridFromNode(textSourceNode)
        break
      case 'screenplay.split_episodes':
      case 'scene.panorama_360': {
        const draft = buildCanvasPipelineOperationDraft({
          actionId,
          sourceText,
          styleBible: buildProductionBiblePrompt(snapshot.project.metadata),
        })
        await createConfiguredOperationNode({
          sourceNode: textSourceNode,
          operation: draft.operation,
          title: draft.title,
          prompt: draft.systemPrompt,
          nodeMessage: draft.message,
          ...(draft.modelParams ? { modelParams: draft.modelParams } : {}),
          ...(draft.taskPipelineRole ? { taskPipelineRole: draft.taskPipelineRole } : {}),
          ...(draft.outputPipelineRole ? { outputPipelineRole: draft.outputPipelineRole } : {}),
          ...(draft.shotScriptConfig ? { shotScriptConfig: draft.shotScriptConfig } : {}),
        })
        break
      }
      case 'character.three_view': {
        // 右键菜单入口：创建并选中操作节点，由用户双击或右键“编辑节点”打开配置
        // （不直接触发任务，与「生成分镜脚本 / 提取角色」等专用流水线行为保持一致）
        // 资产中心按钮入口仍走 handleGenerateCharacterSheets 直接发起任务。
        const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
        const targets = resolveAssetTargets()
        if (targets.length === 0) {
          // 普通文本/功能文本没有角色资产时，仍可直接把当前文本作为角色设定创建身份板任务。
          // 后续若先执行“提取角色”，同一入口会自动切换为按角色资产批量创建。
          const [position] = planCanvasPipelineTaskPositions({
            sourceNode: textSourceNode,
            count: 1,
            existingNodes: snapshot.nodes,
          })
          if (!position) break
          const draft = buildCanvasPipelineOperationDraft({
            actionId,
            sourceText,
            ...(styleBible ? { styleBible } : {}),
          })
          const created = await createConfiguredOperationNode({
            sourceNode: textSourceNode,
            position,
            operation: draft.operation,
            title: draft.title,
            prompt: draft.systemPrompt,
            nodeMessage: draft.message,
            ...(draft.modelParams ? { modelParams: draft.modelParams } : {}),
            ...(draft.taskPipelineRole ? { taskPipelineRole: draft.taskPipelineRole } : {}),
            ...(draft.outputPipelineRole ? { outputPipelineRole: draft.outputPipelineRole } : {}),
            outputTitle: textSourceNode.title?.trim() || '角色身份板',
            selectCreated: false,
            announce: false,
          })
          if (created) {
            setSelectedNodeIds([created.id])
            requestAnimationFrame(() => canvasViewportControlsRef.current?.focusNodes([created.id]))
            message.success('已创建并连接角色身份板生图节点')
          }
          break
        }
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
            outputFilmAssetId: targetAsset.id,
            outputFilmReferenceKind: 'concept',
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
        const targets = resolveAssetTargets()
        const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
        if (targets.length === 0) {
          const draft = buildCanvasPipelineOperationDraft({
            actionId,
            sourceText,
            ...(styleBible ? { styleBible } : {}),
          })
          const position = planCanvasPipelineTaskPositions({
            sourceNode: textSourceNode,
            count: 1,
            existingNodes: snapshot.nodes,
          })[0]
          if (!position) break
          const created = await createConfiguredOperationNode({
            sourceNode: textSourceNode,
            position,
            operation: draft.operation,
            title: draft.title,
            prompt: draft.systemPrompt,
            nodeMessage: draft.message,
            ...(draft.modelParams ? { modelParams: draft.modelParams } : {}),
            ...(draft.taskPipelineRole ? { taskPipelineRole: draft.taskPipelineRole } : {}),
            ...(draft.outputPipelineRole ? { outputPipelineRole: draft.outputPipelineRole } : {}),
            selectCreated: false,
            announce: false,
          })
          if (created) {
            setSelectedNodeIds([created.id])
            requestAnimationFrame(() => canvasViewportControlsRef.current?.focusNodes([created.id]))
            message.success(
              `已创建${actionId === 'scene.scene_image' ? '场景' : actionId === 'prop.prop_image' ? '道具' : '特效'}图任务节点`,
            )
          }
          break
        }
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
            outputFilmAssetId: targetAsset.id,
            outputFilmReferenceKind: 'concept',
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
          autoPlaceAfterInputs: true,
          preservePreferredPosition: true,
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

  const renameInlinePanelNodeStable = useCallback(
    async (title: string | null) => {
      const nodeId = inlinePanelNodeRef.current?.id
      if (!nodeId) return
      await patchNodes([nodeId], { title })
    },
    [patchNodes],
  )
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
          autoPlaceAfterInputs: true,
          preservePreferredPosition: true,
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
  const replaceInlinePanelImageStable = useCallback(() => {
    const nodeId = inlinePanelResourceNodeRef.current?.id
    if (!nodeId) return
    replaceImageNodeIdRef.current = nodeId
    fileInputRef.current?.click()
  }, [])

  /** 节点右键/chip/占位按钮 → 替换图片（复用替换管线，接收 nodeId 参数） */
  const onReplaceImageStable = useCallback((nodeId: string) => {
    replaceImageNodeIdRef.current = nodeId
    fileInputRef.current?.click()
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
    const storyboardSystemPrompt = buildOpPrompt('screenplay.to_shot_script', {
      upstreamText: sourceText,
      ...(styleBible ? { styleBible } : {}),
      keepShotScriptPlaceholders: true,
    })
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_generate',
      // 原剧本由 used_as_input 连接编译进 user prompt；system prompt 只保留契约，
      // 避免长剧本在 system/user 两侧各出现一次而挤占上下文。
      prompt: stripCanvasFunctionalPromptInput(storyboardSystemPrompt, 'screenplay.to_shot_script'),
      title: '生成分镜脚本',
      nodeMessage: '确认分镜脚本 Prompt、Agent 与模型后点击开始任务',
      taskPipelineRole: 'shot',
      outputPipelineRole: 'shot',
      modelParams: { workflow: 'shot_script', responseFormat: 'json' },
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
    kind: ExtractEntityKind,
  ) => {
    if (!sourceText) {
      message.warning('该节点没有可用文本，无法抽取')
      return
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const label = `提取${extractEntityKindLabel(kind)}`
    const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
    await createConfiguredOperationNode({
      sourceNode: node,
      operation: 'text_generate',
      title: label,
      prompt: buildEntityExtractionPrompt(kind, sourceText, styleBible),
      nodeMessage: `确认${label} Prompt、Agent 与模型后点击开始任务`,
      modelParams: { workflow: `extract_${kind}`, responseFormat: 'json' },
      taskPipelineRole: kind,
      outputPipelineRole: kind,
    })
  }

  /** 生成分镜关键帧图：任意文本或图片都可以直接作为输入；已有分镜分组仅作为增强回退。 */
  const handleStoryboardGridFromNode = (sourceNode?: CanvasNode) => {
    if (
      sourceNode &&
      ['text', 'prompt', 'image'].includes(getCanvasPipelineInputType(sourceNode) ?? '')
    ) {
      void createConfiguredOperationNode({
        sourceNode,
        operation: 'storyboard_grid',
        title: '生成分镜关键帧图',
        prompt:
          '请根据输入内容生成一张分镜关键帧宫格图，保持镜头顺序、人物一致性与场景连续性；输入可以是普通文本、分镜脚本或图片参考。',
        nodeMessage: '确认故事板 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'shot',
        outputPipelineRole: 'keyframe',
      })
      return
    }
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const film = readFilmData(snapshot.project.metadata)
    const groups = film?.shotGroups ?? []
    const group = groups[groups.length - 1]
    if (!group || group.segments.length === 0) {
      message.warning('暂无可用输入，请连接文本或图片节点后再生成分镜图')
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

  /**
   * 视频/音频落盘 helper：dataUrl → 主进程写盘 → 编码 safe-file:// → 取宽高/时长。
   * 拖入/上传按钮/粘贴三条路径共用，避免再出现"磁盘路径拿不到 → 静默 return"的回归。
   */
  const prepareCanvasMediaUpload = useCallback(
    async (file: File, kind: 'video' | 'audio'): Promise<PreparedMediaUpload> => {
      const snapshot = snapshotRef.current
      if (!snapshot) throw new Error('画布尚未加载')
      const dataUrl = await readFileAsDataUrl(file)
      const saved = await window.spark.invoke('file:save-pasted-media', {
        dataUrl,
        kind,
        mimeType: file.type,
        suggestedBaseName: file.name.replace(/\.[^.]+$/, '') || `canvas-${kind}`,
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      let mediaWidth: number | undefined
      let mediaHeight: number | undefined
      let durationMs: number | undefined
      if (kind === 'video') {
        const dims = await readVideoDimensions(encodeToSafeFileUrl(saved.filePath))
        mediaWidth = dims.width || undefined
        mediaHeight = dims.height || undefined
        durationMs = dims.durationMs
      }
      return {
        kind,
        file,
        filePath: saved.filePath,
        fileName: file.name,
        ...(file.type ? { fileMimeType: file.type } : {}),
        fileSize: file.size,
        ...(mediaWidth ? { mediaWidth } : {}),
        ...(mediaHeight ? { mediaHeight } : {}),
        ...(durationMs ? { durationMs } : {}),
      }
    },
    [],
  )

  const handleReplaceVideo = useCallback(
    async (nodeId: string, file: File) => {
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (!node) {
        message.error('未找到目标视频节点')
        return
      }
      try {
        await replaceCanvasVideoNode({
          node,
          file,
          prepare: prepareCanvasMediaUpload,
          patchNode: (targetId, patch) => patchNodes([targetId], patch),
          updateNodeData,
        })
        message.success('已上传视频')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '上传视频失败')
      }
    },
    [patchNodes, prepareCanvasMediaUpload, updateNodeData],
  )

  /** 音频文件选择回调：填充工厂菜单「音频」落下的空节点（复用媒体落盘管线）。 */
  const handleAudioFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      const nodeId = pendingAudioNodeIdRef.current
      pendingAudioNodeIdRef.current = null
      if (!file || !nodeId) return
      if (!file.type.startsWith('audio/')) {
        message.warning('请选择音频文件')
        return
      }
      const node = snapshotRef.current?.nodes.find((item) => item.id === nodeId)
      if (!node) {
        message.error('未找到目标音频节点')
        return
      }
      try {
        await replaceCanvasAudioNode({
          node,
          file,
          prepare: prepareCanvasMediaUpload,
          updateNodeData,
        })
        message.success('已上传音频')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '上传音频失败')
      }
    },
    [prepareCanvasMediaUpload, updateNodeData],
  )

  const insertPreparedImages = useCallback(
    async (
      preparedImages: PreparedImageUpload[],
      preferredPosition?: CanvasPoint | null,
      options?: InsertPreparedImagesOptions,
    ): Promise<InsertPreparedImagesResult> => {
      if (preparedImages.length === 0) {
        return {
          createdNodeCount: 0,
          grouped: false,
          createdNodeIds: [],
          createdNodes: [],
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
            createdNodes: [],
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
          ...(options?.preservePreferredPosition ? { preservePreferredPosition: true } : {}),
        })
        return {
          createdNodeCount: node ? 1 : 0,
          grouped: false,
          createdNodeIds: node ? [node.id] : [],
          createdNodes: node ? [node] : [],
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

      const shouldGroup = shouldGroupCanvasImages(preparedImages.length, options?.grouped !== false)
      const groupSize = shouldGroup
        ? (() => {
            const gridMetrics = getImageGridMetrics(preparedImages)
            return {
              width: Math.max(360, gridMetrics.width + GROUP_IMAGE_PADDING_X * 2),
              height: Math.max(
                220,
                GROUP_IMAGE_HEADER_HEIGHT + gridMetrics.height + GROUP_IMAGE_PADDING_BOTTOM,
              ),
            }
          })()
        : null
      const groupPosition = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, groupSize ?? IMAGE_NODE_DEFAULT_SIZE, {
            x: 220,
            y: 180,
          })
      const placedImages = shouldGroup
        ? layoutGroupedImages(preparedImages, groupPosition)
        : layoutDroppedImages(preparedImages, groupPosition)
      const createdNodeIds: string[] = []
      const createdNodes: CanvasNode[] = []
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
          ...(options?.preservePreferredPosition ? { preservePreferredPosition: true } : {}),
        })
        if (node) {
          createdNodeIds.push(node.id)
          createdNodes.push(node)
          createdBounds.push({
            left: image.x,
            top: image.y,
            right: image.x + image.width,
            bottom: image.y + image.height,
          })
        }
      }
      let selectedNodeIds = createdNodeIds.length === 1 ? createdNodeIds : []
      if (shouldGroup && createdNodeIds.length > 1) {
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
      } else if (!shouldGroup && createdNodeIds.length > 1) {
        selectedNodeIds = createdNodeIds
      }
      const grouped = shouldGroup && createdNodeIds.length > 1
      return {
        createdNodeCount: createdNodeIds.length,
        grouped,
        createdNodeIds,
        createdNodes,
        selectedNodeIds,
        ...(createdBounds.length > 0
          ? {
              occupiedBounds:
                grouped && groupSize
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

      // 不再用 startsWith('image/') 硬过滤：粘贴视频/音频也会被丢弃。
      // 按 classifyDroppedFile 分流到 图片 / 视频 / 音频，document/text 等忽略。
      const fileItems = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const imageFiles: File[] = []
      const mediaFiles: Array<{ file: File; kind: 'video' | 'audio' }> = []
      for (const file of fileItems) {
        const kind = classifyDroppedFile(file)
        if (kind === 'image') imageFiles.push(file)
        else if (kind === 'video' || kind === 'audio') mediaFiles.push({ file, kind })
      }
      const text = event.clipboardData.getData('text/plain').trim()
      if (imageFiles.length === 0 && mediaFiles.length === 0 && !text) return

      event.preventDefault()
      event.stopPropagation()

      // 优先落在鼠标当前位置；鼠标不在画布上时回退到视口中心。
      const pointerPosition = pointerFlowPositionRef.current
      const preferredPosition = pointerPosition
        ? { x: Math.round(pointerPosition.x), y: Math.round(pointerPosition.y) }
        : positionNodeInViewport(
            canvasViewportRef.current,
            imageFiles.length > 0
              ? IMAGE_NODE_DEFAULT_SIZE
              : mediaFiles.length > 0
                ? VIDEO_NODE_DEFAULT_SIZE
                : TEXT_NODE_DEFAULT_SIZE,
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
          }

          // 媒体走与拖入管线一致的 prepareCanvasMediaUpload，确保三条入口共用同一落盘路径。
          if (mediaFiles.length > 0) {
            const preparedMedia = await Promise.all(
              mediaFiles.map((entry) => prepareCanvasMediaUpload(entry.file, entry.kind)),
            )
            const positions = layoutDroppedFiles(
              preparedMedia.length,
              preferredPosition,
              VIDEO_NODE_DEFAULT_SIZE,
            )
            const createdMediaIds: string[] = []
            for (let i = 0; i < preparedMedia.length; i += 1) {
              const prepared = preparedMedia[i]!
              const basePos = positions[i] ?? preferredPosition
              const node = await createMediaNode({
                kind: prepared.kind,
                fileName: prepared.fileName,
                ...(prepared.fileMimeType ? { fileMimeType: prepared.fileMimeType } : {}),
                fileSize: prepared.fileSize,
                filePath: prepared.filePath,
                x: basePos.x,
                y: basePos.y,
                ...(prepared.mediaWidth ? { mediaWidth: prepared.mediaWidth } : {}),
                ...(prepared.mediaHeight ? { mediaHeight: prepared.mediaHeight } : {}),
                ...(prepared.durationMs ? { durationMs: prepared.durationMs } : {}),
              })
              if (node) createdMediaIds.push(node.id)
            }
            if (createdMediaIds.length > 0) {
              setSelectedNodeIds([createdMediaIds[createdMediaIds.length - 1]!])
              message.success(
                createdMediaIds.length === 1
                  ? '已粘贴媒体到画布'
                  : `已粘贴 ${createdMediaIds.length} 个媒体到画布`,
              )
            }
          }

          if (imageFiles.length === 0 && mediaFiles.length === 0 && text) {
            const node = await createTextNode({
              text,
              x: preferredPosition.x,
              y: preferredPosition.y,
            })
            if (node) {
              setSelectedNodeIds([node.id])
              message.success('已粘贴文本到画布')
            }
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '粘贴到画布失败')
        }
      })()
    }

    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [
    createTextNode,
    insertPreparedImages,
    prepareCanvasImageUpload,
    prepareCanvasMediaUpload,
    createMediaNode,
  ])

  /**
   * 拖入外部文件到画布：按类型路由成节点。
   *  - 图片 → 复用图片上传管线（dataUrl → 入库 → 图片节点）
   *  - 文本（txt/md/json/源码…）→ 读出文字 → 文本节点
   *  - 视频/音频 → 复制进项目 assets → 媒体节点
   *  - 其余（pdf/docx…）→ 跳过并提示
   * 多文件按 drop 点原点级联排布。
   */
  const handleDropFiles = useCallback(
    async (
      position: CanvasPoint,
      files: File[],
      options?: { keepPanelsOpen?: boolean; groupImages?: boolean },
    ): Promise<CanvasNode[]> => {
      const current = snapshotRef.current
      if (!current || files.length === 0) return []
      if (!options?.keepPanelsOpen) closeCanvasFloatPanels()
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
      const createdNodes: CanvasNode[] = []
      let selectionNodeIds: string[] = []
      let nextOrigin = origin
      const groupImages = shouldGroupCanvasImages(images.length, options?.groupImages !== false)

      try {
        // ── 图片：复用现有上传管线；外部拖入时保持为独立节点 ────────────────
        if (images.length > 0) {
          const prepared = await Promise.all(
            images.map((file) => prepareCanvasImageUpload(file, { grouped: groupImages })),
          )
          const result = await insertPreparedImages(prepared, nextOrigin, { grouped: groupImages })
          for (const id of result.createdNodeIds) createdNodeIds.push(id)
          createdNodes.push(...result.createdNodes)
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
                createdNodes.push(node)
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
                createdNodes.push(node)
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

        // ── 视频/音频：dataUrl 落盘 → safe-file URL → 媒体节点 ─────────────
        //    不再依赖 (file as File & { path?: string }).path：Electron 32+ 已
        //    移除该字段；统一走 dataUrl + file:save-pasted-media，与粘贴路径同源。
        if (media.length > 0) {
          const mediaPositions = layoutDroppedFiles(
            media.length,
            nextOrigin,
            VIDEO_NODE_DEFAULT_SIZE,
          )
          const successfulMediaIds = Array<string | null>(media.length).fill(null)
          await Promise.all(
            media.map(async (entry, index) => {
              try {
                const prepared = await prepareCanvasMediaUpload(entry.file, entry.kind)
                const basePos = mediaPositions[index] ?? nextOrigin
                const node = await createMediaNode({
                  kind: entry.kind,
                  fileName: prepared.fileName,
                  ...(prepared.fileMimeType ? { fileMimeType: prepared.fileMimeType } : {}),
                  fileSize: prepared.fileSize,
                  filePath: prepared.filePath,
                  x: basePos.x,
                  y: basePos.y,
                  ...(prepared.mediaWidth ? { mediaWidth: prepared.mediaWidth } : {}),
                  ...(prepared.mediaHeight ? { mediaHeight: prepared.mediaHeight } : {}),
                  ...(prepared.durationMs ? { durationMs: prepared.durationMs } : {}),
                })
                if (node) {
                  createdNodeIds.push(node.id)
                  createdNodes.push(node)
                  successfulMediaIds[index] = node.id
                }
              } catch (error) {
                // 单个文件失败不影响其他，错误明确提示，不再静默吞。
                message.error(
                  `添加 ${entry.file.name} 失败：${error instanceof Error ? error.message : String(error)}`,
                )
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
      return createdNodes
    },
    [
      projectId,
      closeCanvasFloatPanels,
      createTextNode,
      createMediaNode,
      insertPreparedImages,
      prepareCanvasImageUpload,
      prepareCanvasMediaUpload,
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
      const position = positionNodeInViewport(canvasViewportRef.current, TEXT_NODE_DEFAULT_SIZE, {
        x: 260,
        y: 200,
      })
      await handleDropFiles(position, selectedFiles)
    },
    [canvasViewportRef, handleDropFiles],
  )

  const handlePromptLocalUpload = useCallback(
    async (file: File): Promise<CanvasNode | undefined> => {
      const position = positionNodeInViewport(canvasViewportRef.current, TEXT_NODE_DEFAULT_SIZE, {
        x: 260,
        y: 200,
      })
      const createdNodes = await handleDropFiles(position, [file], { keepPanelsOpen: true })
      return createdNodes[0]
    },
    [canvasViewportRef, handleDropFiles],
  )

  const handleSelectOperationInput = useCallback(
    (targetNodeId: string) => {
      startPromptNodePicker(
        targetNodeId,
        (pickedNode) => {
          if (pickedNode.type !== 'image') {
            message.warning('图片反推仅支持图片节点')
            return
          }
          void connectNodes({ sourceNodeId: pickedNode.id, targetNodeId }).catch((error) => {
            message.error(error instanceof Error ? error.message : '连接输入图片失败')
          })
        },
        { keepWhenInactive: true },
      )
    },
    [connectNodes, startPromptNodePicker],
  )

  const handleUploadOperationInput = useCallback((targetNodeId: string) => {
    operationImageUploadTargetNodeIdRef.current = targetNodeId
    operationImageUploadInputRef.current?.click()
  }, [])

  const handleOperationImageUploadChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      const targetNodeId = operationImageUploadTargetNodeIdRef.current
      operationImageUploadTargetNodeIdRef.current = null
      if (!file || !targetNodeId) return
      if (!file.type.startsWith('image/')) {
        message.warning('请选择图片文件')
        return
      }
      try {
        const uploadedNode = await handlePromptLocalUpload(file)
        if (!uploadedNode) return
        await connectNodes({ sourceNodeId: uploadedNode.id, targetNodeId })
        setSelectedNodeIds([targetNodeId])
        message.success('图片已上传并连接到图片反推节点')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '上传并连接图片失败')
      }
    },
    [connectNodes, handlePromptLocalUpload],
  )

  /**
   * 空白处右键 → 创建一个无上游的 AI 操作节点（用户后续自己连线）。
   * 不绑定 inputNodeIds，prompt 留空，由用户在操作面板填完后再运行。
   */
  const handleCreateOperationAtPosition = async (
    operation: CanvasOperationType,
    position: CanvasPoint,
    options?: { openPanel?: boolean; preservePreferredPosition?: boolean },
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
      ...(options?.preservePreferredPosition ? { preservePreferredPosition: true } : {}),
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
    options?: { openPanel?: boolean; sourceNodeId?: string },
  ) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    closeCanvasFloatPanels()
    // 牵线菜单已经明确提供了上游节点，复用节点右键的完整编排处理器，
    // 不再走“空白处创建流水线”分支（后者只支持文本/抽取且不依赖选中态）。
    if (options?.sourceNodeId) {
      pipelineActionPositionRef.current = { x: Math.round(position.x), y: Math.round(position.y) }
      try {
        await handleNodePipelineAction(options.sourceNodeId, actionId)
      } finally {
        pipelineActionPositionRef.current = null
      }
      return
    }
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
      ...(op.produces ? { taskPipelineRole: op.produces } : {}),
      ...(op.produces ? { outputPipelineRole: op.produces } : {}),
      ...(op.id === 'screenplay.to_shot_script'
        ? { shotScriptConfig: DEFAULT_SHOT_SCRIPT_CONFIG }
        : {}),
      ...(op.kind === 'extract'
        ? { modelParams: { workflow: `extract_${op.extractKind}`, responseFormat: 'json' } }
        : op.id === 'screenplay.to_shot_script'
          ? { modelParams: { workflow: 'shot_script', responseFormat: 'json' } }
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
    kind: ExtractEntityKind,
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
    const label = `提取${extractEntityKindLabel(kind)}`
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
          taskPipelineRole: kind,
          outputPipelineRole: kind,
          ...promptTaskFields,
        },
        async (captureDiagnostics) => {
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
          captureDiagnostics({
            modelOutputText: response.text,
            rawResponse: response.rawResponse ?? {
              status: response.status,
              error: response.error ?? null,
            },
            agentId: runtime.agentId ?? null,
            providerProfileId: (response.providerProfileId || runtime.providerProfileId) ?? null,
            provider: response.provider || null,
            modelId: (response.model || runtime.modelId) ?? null,
          })
          if (response.status !== 'succeeded' || !response.text) {
            throw new Error(response.error?.message ?? '抽取失败')
          }
          const entities = parseExtractedEntities(kind, response.text)
          if (entities.length === 0) {
            const outputPreview = response.text.replace(/\s+/g, ' ').trim().slice(0, 500)
            throw new Error(
              `未识别到实体，请检查文本内容或输出格式${outputPreview ? `。模型输出摘要：${outputPreview}` : ''}`,
            )
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
                preservePreferredPosition: true,
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
      outputFilmAssetId: asset.id,
      outputFilmReferenceKind: 'concept',
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
      const sheetTemplate = getCharacterSheetTemplate(aspect)
      const needsBase = sheetTemplate?.needsBaseImage ?? false
      const referenceKind = sheetTemplate?.referenceKind ?? 'other'
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
          outputFilmAssetId: asset.id,
          outputFilmReferenceKind: referenceKind,
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
          outputFilmAssetId: asset.id,
          outputFilmReferenceKind: referenceKind,
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

  const handleGenerateSegmentVideo = async (
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
    // 优先使用真实关键帧；角色/场景设定图只能作为 reference，不能冒充时间端点。
    const anchorNodes = resolveSegmentAnchorImageNodes(input.segment, input.characters, input.scene)
    if (anchorNodes.length > 0) {
      const keyframeIds = new Set(input.segment.keyframeNodeIds ?? [])
      const usesKeyframes = anchorNodes.some((node) => keyframeIds.has(node.id))
      const inputRoles: Record<string, CanvasTaskInputRoleSelection> = {}
      for (const [index, node] of anchorNodes.slice(0, 2).entries()) {
        inputRoles[node.id] = usesKeyframes
          ? index === 0
            ? 'first_frame'
            : 'last_frame'
          : 'reference'
      }
      await addFilmAssetTaskNode({
        operation: 'image_to_video',
        title: `生成视频 · 分镜 #${input.segment.index}`,
        prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
        inputNodeIds: anchorNodes.slice(0, 2).map((node) => node.id),
        inputRoles,
        ...(input.segment.durationSec != null && input.segment.durationSec > 0
          ? { modelParams: { durationSeconds: input.segment.durationSec } }
          : {}),
        ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
      })
      return
    }
    await addFilmAssetTaskNode({
      operation: 'text_to_video',
      title: `生成视频 · 分镜 #${input.segment.index}`,
      prompt: buildShotSegmentVideoPrompt(input, styleBible, styleFragments),
      ...(input.segment.durationSec != null && input.segment.durationSec > 0
        ? { modelParams: { durationSeconds: input.segment.durationSec } }
        : {}),
      ...(options?.openPanel !== undefined ? { openPanel: options.openPanel } : {}),
    })
    message.info('未找到关键帧/设定图，已创建文生视频节点；补充基准图可进一步提升一致性')
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

  const handleRetryTask = async (task: CanvasTask, runtimeSource: CanvasTaskRetryRuntimeSource) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return
    const taskNode =
      (task.operationNodeId
        ? snapshot.nodes.find((node) => node.id === task.operationNodeId)
        : undefined) ?? snapshot.nodes.find((node) => node.taskId === task.id)
    const requestedRetryModelParams =
      runtimeSource === 'current-node'
        ? { ...task.modelParams, ...(taskNode?.data.modelParams ?? {}) }
        : task.modelParams
    const retryPresetTargetId = resolveCanvasPresetTarget({
      operation: task.operation,
      taskPipelineRole:
        (runtimeSource === 'current-node' ? taskNode?.data.pipelineRole : task.taskPipelineRole) ??
        task.taskPipelineRole ??
        null,
      outputPipelineRole:
        (runtimeSource === 'current-node'
          ? taskNode?.data.outputPipelineRole
          : task.outputPipelineRole) ??
        task.outputPipelineRole ??
        null,
      workflow: requestedRetryModelParams.workflow,
    })
    const retryModelParams = mergeCanvasPresetTargetModelParams(
      retryPresetTargetId,
      requestedRetryModelParams,
    )
    const retryExtractKind = resolveExtractEntityKindFromWorkflow(retryModelParams.workflow)
    if (taskNode && isOperationNode(taskNode) && retryExtractKind) {
      const retryInputNodes = task.inputNodeIds
        .map((nodeId) => snapshot.nodes.find((node) => node.id === nodeId && !node.hidden))
        .filter((node): node is CanvasNode => node != null)
      const sourceNode = retryInputNodes[0]
      const sourceText = retryInputNodes
        .map((node) => resolveCanvasPipelineTextSource(node, snapshot).sourceText.trim())
        .filter(Boolean)
        .join('\n\n')
      if (!sourceNode || !sourceText) {
        message.warning('该抽取任务的原始输入已不存在，无法重试')
        return
      }
      const runtime = runtimeSource === 'current-node' ? taskNode.data : task
      const promptSubmission: CanvasPromptSubmission = {
        prompt: task.compiledUserText ?? task.prompt ?? sourceText,
        ...pickCanvasPromptTaskFields(task),
      }
      const viewportBeforeRetry = await persistCurrentCanvasViewport()
      try {
        await handleExtractEntities(sourceNode, sourceText, retryExtractKind, {
          promptSubmission,
          ...(task.prompt != null ? { userPrompt: task.prompt } : {}),
          ...(runtime.agentId ? { agentId: runtime.agentId } : {}),
          ...(runtime.providerProfileId ? { providerProfileId: runtime.providerProfileId } : {}),
          ...(runtime.modelId ? { modelId: runtime.modelId } : {}),
          ...(runtime.reasoningEffort ? { reasoningEffort: runtime.reasoningEffort } : {}),
          ...(runtime.skillIds ? { skillIds: runtime.skillIds } : {}),
          modelParams: retryModelParams,
          bindToNodeId: taskNode.id,
          inputNodeIds: task.inputNodeIds,
          inputAssetIds: task.inputAssetIds,
        })
      } finally {
        restoreCanvasViewport(viewportBeforeRetry)
      }
      return
    }
    // 失败/取消的任务如果存在关联的操作节点，则绑定到原节点重试，
    // 这样原节点的状态会立即刷新为「运行中」，而不是留下一个显示「失败」的旧节点。
    if (taskNode && isOperationNode(taskNode)) {
      const viewportBeforeRetry = await persistCurrentCanvasViewport()
      try {
        await retryOperationNode(taskNode.id, {
          sourceTaskId: task.id,
          runtimeSource,
        })
      } finally {
        restoreCanvasViewport(viewportBeforeRetry)
      }
      return
    }
    const viewportBeforeRetry = await persistCurrentCanvasViewport()
    const inputNodes = expandCanvasInputNodes(
      snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id)),
      snapshot,
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
              fullscreen={inlineOperationFullscreen}
              onFullscreenChange={setInlineOperationFullscreen}
              onSaveOutput={handleSaveNodeEdit}
              onRenameNode={async (title) => {
                await patchNodes([opNode.id], { title })
              }}
              onDownloadOutput={(nodeId) => void handleDownloadMediaNode(nodeId)}
              onPreviewPanoramaOutput={handlePreviewPanorama}
              onOpenAssetLibrary={() => setSidePanelTab('assets')}
              onSetPrimaryOutput={(output) => handleSetOperationPrimaryOutput(opNode.id, output)}
              onExpandOutputs={(outputs) => handleExpandOperationOutputs(opNode.id, outputs)}
              onDeleteOutputs={(outputs) => handleDeleteOperationOutputs(opNode.id, outputs)}
              onDeleteRun={(run) => handleDeleteOperationRun(opNode.id, run)}
              configPanel={
                <CanvasOperationPanel
                  node={opNode}
                  snapshot={operationPanelSnapshot ?? snapshot}
                  placement="inline"
                  fullscreen={inlineOperationFullscreen}
                  onFullscreenChange={setInlineOperationFullscreen}
                  onRequestCanvasNodePick={(onPick) => startPromptNodePicker(opNode.id, onPick)}
                  onUploadLocalFile={handlePromptLocalUpload}
                  {...(opTask ? { task: opTask } : {})}
                  onClose={() => {
                    setActiveOperationPanelNodeId(null)
                    setSelectedNodeIds([])
                  }}
                  onRun={async (params) => {
                    const viewportBeforeRun = await persistCurrentCanvasViewport()
                    const taskInputNodes = resolveCanvasInputNodes(params.inputNodeIds, snapshot)
                    const hydratedTaskInputNodes = hydrateTextInputNodes(
                      taskInputNodes,
                      snapshot.assets,
                    )
                    const containerOperation = (opNode.data.operation ??
                      opNode.type) as CanvasOperationType
                    const operation = executionOperationForCanvasMediaCapability(
                      params.capabilityId,
                      containerOperation,
                    )
                    const currentPresetTargetId = resolveCanvasPresetTarget({
                      operation,
                      taskPipelineRole:
                        opNode.data.pipelineRole ?? opTask?.taskPipelineRole ?? null,
                      outputPipelineRole:
                        opNode.data.outputPipelineRole ?? opTask?.outputPipelineRole ?? null,
                      workflow:
                        params.modelParams?.workflow ??
                        opNode.data.modelParams?.workflow ??
                        opTask?.modelParams?.workflow,
                    })
                    const currentModelParams = mergeCanvasPresetTargetModelParams(
                      currentPresetTargetId,
                      params.modelParams,
                    )
                    const extractKind = resolveExtractEntityKindFromWorkflow(
                      currentModelParams.workflow,
                    )
                    // 统一行为：先收起弹窗，再继续执行任务，避免提交后弹窗长时间不关。
                    const closePanel = () => {
                      setActiveOperationPanelNodeId(null)
                      setSelectedNodeIds([])
                    }
                    if (extractKind) {
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
                      const promptDocument =
                        params.promptDocument ??
                        migrateLegacyPrompt({
                          prompt: params.prompt,
                          nodes: snapshot.nodes,
                          assets: snapshot.assets,
                        })
                      const extractSystemPrompt =
                        normalizeCanvasFunctionalSystemPrompt(
                          params.systemPrompt,
                          currentPresetTargetId,
                        ) ||
                        buildCanvasOperationSystemPrompt(
                          operation,
                          readCanvasExecutionPresetPrompt(
                            resolveCanvasPresetTarget({
                              operation,
                              taskPipelineRole: opNode.data.pipelineRole ?? null,
                              outputPipelineRole: opNode.data.outputPipelineRole ?? null,
                              workflow: currentModelParams.workflow,
                            }),
                          ),
                        )
                      const promptSubmission = await buildCanvasPromptSubmission({
                        document: promptDocument,
                        snapshot,
                        operation,
                        ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                        ...(params.inputBindings ? { inputBindings: params.inputBindings } : {}),
                        ...(extractSystemPrompt ? { systemPrompt: extractSystemPrompt } : {}),
                        ...(params.inputTransport ? { inputTransport: params.inputTransport } : {}),
                      })
                      // 抽取节点走独立的 workflow 分支，不会经过普通操作节点的
                      // runOperationNode / createTask 链路；因此要在这里同步记录最近一次
                      // 选择的运行时与模型参数，保证下一个角色/场景抽取节点能复用。
                      const extractPresetTargetId = resolveCanvasPresetTarget({
                        operation,
                        taskPipelineRole: opNode.data.pipelineRole ?? null,
                        outputPipelineRole: opNode.data.outputPipelineRole ?? null,
                        workflow: currentModelParams.workflow,
                      })
                      writeCanvasLastUsedPresetTarget(extractPresetTargetId, {
                        ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                        ...(params.agentId ? { agentId: params.agentId } : {}),
                        ...(params.providerProfileId
                          ? { providerProfileId: params.providerProfileId }
                          : {}),
                        ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                        ...(params.modelId ? { modelId: params.modelId } : {}),
                        ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                        modelParams: currentModelParams,
                      })
                      closePanel()
                      void handleExtractEntities(sourceNode, sourceText, extractKind, {
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
                        modelParams: currentModelParams,
                        bindToNodeId: opNode.id,
                        ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                        inputAssetIds: taskInputNodes
                          .map((item) => item.assetId)
                          .filter((id): id is string => Boolean(id)),
                      })
                      restoreCanvasViewport(viewportBeforeRun)
                      return
                    }
                    // 普通操作（文本/图片/视频生成等）：先收起弹窗，再异步提交任务。
                    closePanel()
                    const presetTargetId = currentPresetTargetId
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
                    const baseSystemPrompt =
                      normalizeCanvasFunctionalSystemPrompt(params.systemPrompt, presetTargetId) ||
                      buildCanvasOperationSystemPrompt(
                        operation,
                        readCanvasExecutionPresetPrompt(presetTargetId),
                      )
                    const systemPrompt = params.shotScriptConfig
                      ? applyShotScriptConfigToPrompt(baseSystemPrompt, params.shotScriptConfig)
                      : baseSystemPrompt
                    const promptSubmission = await buildCanvasPromptSubmission({
                      document: promptDocument,
                      snapshot,
                      operation,
                      ...(params.inputNodeIds ? { inputNodeIds: params.inputNodeIds } : {}),
                      ...(params.inputBindings ? { inputBindings: params.inputBindings } : {}),
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
                      ...(Object.keys(currentModelParams).length > 0
                        ? { modelParams: currentModelParams }
                        : {}),
                    })
                    const styledTask = applyCanvasStyleToTask(
                      operation,
                      {
                        prompt: finalPrompt,
                        ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                        modelParams: currentModelParams,
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
                      modelParams: currentModelParams,
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
                        ...(params.mediaInputMode ? { mediaInputMode: params.mediaInputMode } : {}),
                        ...(params.capabilityId ? { capabilityId: params.capabilityId } : {}),
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
                        ...(params.shotScriptConfig
                          ? { shotScriptConfig: params.shotScriptConfig }
                          : {}),
                        ...(params.skipParameterValidation
                          ? { skipParameterValidation: true }
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
                    if (opTask) {
                      await handleRetryTask(opTask, 'current-node')
                      return
                    }
                    const viewportBeforeRetry = await persistCurrentCanvasViewport()
                    try {
                      await retryOperationNode(opNode.id)
                    } finally {
                      restoreCanvasViewport(viewportBeforeRetry)
                    }
                  }}
                  onRepoll={
                    opTask
                      ? async () => {
                          try {
                            await repollMediaTask(opTask.id)
                          } catch (error) {
                            message.error(error instanceof Error ? error.message : '重新轮询失败')
                          }
                        }
                      : undefined
                  }
                  onCancelTask={async (taskId) => {
                    await cancelTask(taskId)
                  }}
                  onSaveDraft={async (params) => {
                    const operation = (opNode.data.operation ?? opNode.type) as CanvasOperationType
                    const presetTargetId = resolveCanvasPresetTarget({
                      operation,
                      taskPipelineRole:
                        opNode.data.pipelineRole ?? opTask?.taskPipelineRole ?? null,
                      outputPipelineRole:
                        opNode.data.outputPipelineRole ?? opTask?.outputPipelineRole ?? null,
                      workflow: params.modelParams?.workflow ?? opNode.data.modelParams?.workflow,
                    })
                    const modelParams = mergeCanvasPresetTargetModelParams(
                      presetTargetId,
                      params.modelParams,
                    )
                    const nextNodeData = {
                      ...opNode.data,
                      ...(params.promptDocument ? { promptDocument: params.promptDocument } : {}),
                      ...(params.inputBindings ? { inputBindings: params.inputBindings } : {}),
                      ...(params.mediaInputMode ? { mediaInputMode: params.mediaInputMode } : {}),
                      ...(params.capabilityId ? { capabilityId: params.capabilityId } : {}),
                      ...(params.systemPrompt
                        ? {
                            systemPrompt: normalizeCanvasFunctionalSystemPrompt(
                              params.systemPrompt,
                              presetTargetId,
                            ),
                          }
                        : {}),
                      negativePrompt: params.negativePrompt,
                      message: params.message,
                      modelParams,
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
                    const aspectRatioSizePatch = operationNodeAspectRatioSizePatch(
                      opNode,
                      modelParams,
                    )
                    await updateNodeData(opNode.id, nextNodeData)
                    if (aspectRatioSizePatch) {
                      await patchNodes([opNode.id], aspectRatioSizePatch)
                    }
                    writeCanvasLastUsedPresetTarget(presetTargetId, {
                      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
                      ...(params.agentId ? { agentId: params.agentId } : {}),
                      ...(params.providerProfileId
                        ? { providerProfileId: params.providerProfileId }
                        : {}),
                      ...(params.manifestId ? { manifestId: params.manifestId } : {}),
                      ...(params.modelId ? { modelId: params.modelId } : {}),
                      ...(params.skillIds ? { skillIds: params.skillIds } : {}),
                      modelParams,
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
          nodes={snapshot.nodes}
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
      <div className="canvas-workspace canvas-cinematic canvas-workspace-loading">
        <Spin description="正在加载画布..." />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="canvas-workspace canvas-cinematic canvas-workspace-loading">
        <Empty description="画布不存在" />
      </div>
    )
  }

  return (
    <CanvasOverlayBoundary
      className={`canvas-workspace canvas-cinematic${snapshot.nodes.length === 0 ? ' is-empty' : ''}${promptNodePickerOwnerId ? ' is-picking-prompt-node' : ''}`}
    >
      <CanvasWorkspaceChrome
        title={snapshot.project.title}
        nodeCount={snapshot.nodes.length}
        assetCount={snapshot.assets.length}
        taskCount={snapshot.tasks.length}
        showSidebarExpandButton={showSidebarExpandButton}
        saveState={{ dirty, saving, autoSaving, autoSaveEnabled }}
        selectedCount={selectedNodeIds.length}
        arranging={arrangingCanvas}
        refreshing={refreshingCanvas}
        onBack={() => void handleBackWithGuard()}
        onArrange={handleArrangeCanvas}
        onSave={() => void doSave()}
        onRefresh={() => void reloadCanvas()}
        onAutoSaveChange={handleAutoSaveToggle}
        onExport={() => void handleExportProject()}
        onUploadFiles={() => uploadFilesInputRef.current?.click()}
        onOpenAgent={() => {
          closeCanvasFloatPanels('agent')
          openAgentPanel()
        }}
      />

      <div className="canvas-workspace-body" style={sidePanelStyle}>
        <CanvasRightPanelRail
          agentOpen={agentOpen}
          workspacePanelOpen={!sidePanelCollapsed}
          onToggleAgent={toggleAgentPanel}
          onToggleWorkspacePanel={toggleWorkspacePanel}
        />
        <aside className={`canvas-agent-side-panel${agentOpen ? '' : ' is-collapsed'}`}>
          <div
            aria-label="调整助手面板宽度"
            aria-orientation="vertical"
            className="canvas-agent-side-panel-resize-handle"
            onPointerDown={handleAgentPanelResizeStart}
          />
          <CanvasAgentModal
            open={agentOpen}
            externalSubmitRequest={agentSubmitRequest}
            onClose={() => setAgentOpen(false)}
            snapshot={snapshot}
            selectedNodes={selectedNodes}
            nodeRefs={agentNodeRefs}
            onRemoveNodeRef={(nodeId) =>
              setAgentNodeRefs((prev) => prev.filter((node) => node.id !== nodeId))
            }
            onClearNodeRefs={() => setAgentNodeRefs([])}
            onFocusNode={(nodeId) => {
              const node = snapshot.nodes.find((item) => item.id === nodeId)
              if (!node) {
                message.warning('未找到对应的画布节点')
                return
              }
              setSelectedNodeIds([nodeId])
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  canvasViewportControlsRef.current?.focusNodes([nodeId], {
                    preferredWidth: 520,
                    maxZoom: 1.08,
                  })
                })
              })
            }}
            getViewport={() => canvasViewportRef.current}
            revealNodes={(nodeIds) => {
              if (nodeIds.length === 0) return
              setSelectedNodeIds(nodeIds)
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  canvasViewportControlsRef.current?.focusNodes(nodeIds, {
                    padding: { top: 96, right: 56, bottom: 96, left: 56 },
                    minZoom: 0.18,
                    maxZoom: 1,
                  })
                })
              })
            }}
            onWideModeChange={handleAgentWideMode}
            workspace={{
              createCanvasHistoryCheckpoint,
              restoreCanvasHistoryCheckpoint,
              hasCanvasHistoryCheckpoint,
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
              updateNode,
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
              applyTemplate,
              materializeWorkflow,
              runCanvasWorkflow: executeCanvasWorkflow,
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
          <CanvasPromptNodePickerBanner
            visible={Boolean(promptNodePickerOwnerId)}
            onCancel={() => cancelPromptNodePicker()}
          />
          {snapshot.nodes.length === 0 && (
            <CanvasCinematicEmptyState
              onStartWithAgent={() => {
                closeCanvasFloatPanels('agent')
                openAgentPanel()
              }}
              onSubmitAgentPrompt={(text) => {
                closeCanvasFloatPanels('agent')
                openAgentPanel()
                agentSubmitRequestIdRef.current += 1
                setAgentSubmitRequest({ id: agentSubmitRequestIdRef.current, text })
              }}
              onOpenInlineAi={() => handleOpenInlineAi()}
              onUploadFiles={() => uploadFilesInputRef.current?.click()}
              onOpenWorkflowLibrary={() => {
                closeCanvasFloatPanels('workflow')
                setWorkflowDrawerOpen(true)
              }}
            />
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
            onSelectGroupChildren={handleSelectGroupChildren}
            onRemoveNodeFromGroup={(nodeId) => handleRemoveFromGroup([nodeId])}
            onDissolveGroup={handleDissolveGroup}
            onDuplicateSelectedNodes={() => void duplicateNodes(selectedNodeIds)}
            onToggleLockSelectedNodes={() => void handleToggleLock()}
            onBringSelectedNodesToFront={() => void handleBringToFront()}
            onAddNodesToAgent={handleAddSelectedToAgent}
            onExtractSelectionToWorkflow={openWorkflowExtraction}
            onAddNodeToAgent={handleAddNodeToAgent}
            onRunOperationNode={(nodeId) => {
              void batchTasks.controller.runSingle(nodeId).catch(() => undefined)
            }}
            onSelectOperationInput={handleSelectOperationInput}
            onUploadOperationInput={handleUploadOperationInput}
            onConfigureSelectedTasks={batchTasks.controller.openConfigure}
            onSubmitSelectedTasks={(nodeIds) => {
              void batchTasks.controller.openSubmit(nodeIds).catch((error) => {
                message.error(error instanceof Error ? error.message : '批量提交失败')
              })
            }}
            onOpenAiComposer={handleOpenInlineAi}
            onEditNode={handleEditNode}
            onRenameNode={(nodeId, title) => patchNodes([nodeId], { title })}
            onEditVideo={handleEditVideo}
            onAudioTrim={handleAudioTrim}
            onAudioSpeed={handleAudioSpeed}
            onExpandOperationOutputs={handleExpandLatestOperationOutputs}
            onPreviewPanorama={handlePreviewPanorama}
            onSaveNodeToLibrary={onSaveNodeToLibraryStable}
            onAnnotateImage={onAnnotateImageStable}
            onSplitGridImage={onSplitGridImageStable}
            onSplitStoryboard={(nodeId) => void handleSplitStoryboard(nodeId)}
            onExtractCharacterSubview={onExtractCharacterSubviewStable}
            onReplaceImage={onReplaceImageStable}
            onReplaceVideo={handleReplaceVideo}
            onCreateOperationChild={onCreateOperationChildStable}
            onPipelineAction={onPipelineActionStable}
            onSetProductionState={onSetProductionStateStable}
            onAddTextAtPosition={addText}
            onAddImageAtPosition={addEmptyImage}
            onDropFiles={(position, files) =>
              void handleDropFiles(position, files, { groupImages: false })
            }
            onDropWorkflow={(position, workflowId) => {
              void handleDropCanvasWorkflow(position, workflowId)
            }}
            onAddDirectorStage3DAtPosition={addDirectorStage3D}
            onAddVideoWorkbenchAtPosition={addVideoWorkbench}
            onInsertAssetFromPane={onInsertAssetFromPaneStable}
            onCreateOperationAtPosition={handleCreateOperationAtPosition}
            onCreatePipelineAtPosition={handleCreatePipelineAtPosition}
            onNodeSelectIntent={handleNodeSelectIntent}
            onViewportChange={handleCanvasViewportChange}
            onViewportControlsChange={handleCanvasViewportControlsChange}
            onPointerFlowPositionChange={handlePointerFlowPositionChange}
            onDeleteSelectedNodes={handleDeleteSelectedNodes}
            onAlignSelected={handleAlignSelected}
            onArrangeGridSelection={handleArrangeGridSelection}
            arranging={arrangingCanvas}
          />
          <CanvasBatchTaskPanel
            state={batchTasks.state}
            onPatchGroup={batchTasks.controller.patchGroup}
            onPatchNode={batchTasks.controller.patchNode}
            onSaveDrafts={async () => {
              await batchTasks.controller.saveDrafts()
            }}
            onSubmit={batchTasks.controller.submit}
            onConfirmSubmit={batchTasks.controller.confirmSubmit}
            onRetryFailed={batchTasks.controller.retryFailed}
            onSkipNextConfirmationChange={batchTasks.controller.setSkipNextConfirmation}
            onSkipParameterValidationChange={batchTasks.controller.setSkipParameterValidation}
            onBackToConfigure={batchTasks.controller.backToConfigure}
            onClose={batchTasks.controller.close}
          />
          {inlinePanelNode && floatingEditorPanel && (
            <div
              className={`canvas-node-bottom-editor nodrag nopan${inlineOperationFullscreen ? ' is-fullscreen' : ''}`}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="canvas-node-bottom-editor-toolbar">
                <CanvasFloatingNodeToolbar
                  node={inlinePanelNode}
                  resourceNode={inlinePanelResourceNode ?? undefined}
                  isOperation={Boolean(activeOperationNode)}
                  onRenameNode={renameInlinePanelNodeStable}
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
                  onReplaceImage={replaceInlinePanelImageStable}
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
            onOpenWorkflowLibrary={() => {
              closeCanvasFloatPanels('workflow')
              setWorkflowDrawerOpen(true)
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
              openAgentPanel()
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
            onCreateTask={async (input) => {
              await handleCreateTask(input)
              setInlineAiOpen(false)
            }}
          />
          <CanvasWorkflowDrawer
            open={workflowDrawerOpen}
            projectId={projectId}
            projectName={snapshot.project.title}
            selectedNodeCount={selectedNodes.length}
            onClose={() => setWorkflowDrawerOpen(false)}
            onExtractSelection={openWorkflowExtraction}
            onAddWorkflow={(workflow) => void handleAddCanvasWorkflow(workflow)}
            onUpdateFromSelection={openWorkflowUpdate}
          />
          <CanvasWorkflowRunPanel
            open={workflowToRun != null}
            projectId={projectId}
            workflow={workflowToRun}
            availableInputNodes={workflowInputNodes}
            onClose={() => setWorkflowToRun(null)}
            onExecute={executeCanvasWorkflow}
          />
          <CanvasWorkflowExtractDialog
            open={workflowExtractDraft != null}
            projectId={projectId}
            draft={workflowExtractDraft}
            workflowToUpdate={workflowToUpdate}
            onClose={() => setWorkflowExtractDraft(null)}
            onSaved={(workflow) => {
              setWorkflowExtractDraft(null)
              setWorkflowToUpdate(null)
              message.success(`已保存画布工作流“${workflow.name}”`)
              setWorkflowDrawerOpen(true)
            }}
          />
          <CanvasImageAnnotationModal
            open={Boolean(annotatingImageNode)}
            node={annotatingImageNode}
            {...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {})}
            onCancel={() => setAnnotatingImageNodeId(null)}
            onDraftSaved={handleAnnotateImageDraftSaved}
            onComplete={handleAnnotateImageComplete}
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
                { sourceNodeId: context.sourceNode.id },
              )
            }}
            onSave={async (nextSubviews) => {
              const context = characterSubviewEditorContext
              if (!context) return
              // 子视图按来源图片分区存储在共享角色资产上：保存时只替换当前来源图片的
              // 子视图，保留其它产物图片的子视图，避免互相覆盖。
              const sourceAssetId = context.sourceImageAsset.id
              const latestOwner = snapshot?.assets.find((item) => item.id === context.ownerAsset.id)
              const preserved = readCharacterSubviews(
                latestOwner?.metadata ?? context.ownerAsset.metadata,
              ).filter((item) => item.sourceAssetId !== sourceAssetId)
              const stamped = nextSubviews.map((item) => ({ ...item, sourceAssetId }))
              await updateFilmAsset(context.ownerAsset.id, {
                characterSubviews: [...preserved, ...stamped],
              })
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
            onAddLocalResources={handleAddLocalWorkbenchResources}
            onPickCanvasResources={handlePickCanvasWorkbenchResources}
            onCollectUpstream={handleCollectUpstreamWorkbenchResources}
            onMaterializeOutput={handleMaterializeVideoOutput}
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
              onInsertProviderFileToCanvas: (input) => void handleInsertProviderFile(input),
              onLocateAsset: (assetId) => {
                const nodeId = resolveCanvasAssetFocusNodeIds(snapshot, assetId)[0]
                if (!nodeId) {
                  message.info('画布中暂无此资产节点')
                  return
                }

                // 资产中心覆盖在画布上方，先关闭后再聚焦，确保用户能直接看到目标节点。
                setFilmCenterOpen(false)
                setSelectedNodeIds([nodeId])
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(() => {
                    const focused = canvasViewportControlsRef.current?.focusNodes([nodeId], {
                      preferredWidth: 520,
                      maxZoom: 1.08,
                    })
                    if (!focused) message.warning('未找到资产对应的画布节点')
                  })
                })
              },
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
        <CanvasWorkspaceSidePanel
          snapshot={snapshot}
          selectedNodes={selectedNodes}
          sidePanelCollapsed={sidePanelCollapsed}
          sidePanelWidth={sidePanelWidth}
          limits={{
            minWidth: CANVAS_SIDE_PANEL_MIN_WIDTH,
            maxWidth: CANVAS_SIDE_PANEL_MAX_WIDTH,
          }}
          sidePanelTab={sidePanelTab}
          assetDetailResetKey={assetDetailResetKey}
          configuredPresetCount={configuredPresetCount}
          canCreateGroup={canCreateGroup}
          canAddToGroup={canAddToGroup}
          canRemoveFromGroup={canRemoveFromGroup}
          canDissolveGroup={canDissolveGroup}
          onResizeDefault={() => updateSidePanelWidth(CANVAS_SIDE_PANEL_DEFAULT_WIDTH)}
          onResizeKeyDown={handleSidePanelResizeKeyDown}
          onResizePointerDown={handleSidePanelResizeStart}
          onTabChange={setSidePanelTab}
          onOpenHistory={() => {
            closeCanvasFloatPanels()
            setHistoryOpen(true)
          }}
          onOpenProjectFolder={handleOpenProjectFolder}
          onOpenTemplate={() => {
            closeCanvasFloatPanels()
            setTemplateOpen(true)
          }}
          onDuplicateSelected={() => void duplicateNodes(selectedNodeIds)}
          onToggleLock={() => void handleToggleLock()}
          onBringToFront={() => void handleBringToFront()}
          onCreateGroup={handleCreateGroup}
          onAddToGroup={() => handleAddSelectionToGroup()}
          onRemoveFromGroup={() => handleRemoveFromGroup()}
          onDissolveGroup={() => handleDissolveGroup()}
          onPatchNode={(node, patch) => void patchNodes([node.id], patch)}
          onPatchNodeData={(node, data) => void updateNodeData(node.id, data)}
          onCancelTask={(taskId) => void cancelTask(taskId)}
          onClearTasks={(scope) => void clearTasks(scope)}
          onDeleteTasks={(taskIds) => void deleteTasks(taskIds)}
          onRetryTask={(task, runtimeSource) => void handleRetryTask(task, runtimeSource)}
          onRepollTask={(taskId) =>
            repollMediaTask(taskId).catch((error) => {
              message.error(error instanceof Error ? error.message : '重新轮询失败')
            })
          }
          onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])}
          onInsertAsset={(assetId) => void handleInsertAsset(assetId)}
          onInsertSubview={(ownerAsset, sourceImageAsset, subview) =>
            void handleApplyCharacterSubview(ownerAsset, sourceImageAsset, subview)
          }
          onOpenAssetDetail={() => closeCanvasFloatPanels('asset-detail')}
          onDeleteAssets={async (assetIds) => {
            const targetAssetSet = new Set(assetIds)
            const nodeIds = snapshot.nodes
              .filter((node) => node.assetId && targetAssetSet.has(node.assetId))
              .map((node) => node.id)
            if (nodeIds.length > 0) await deleteNodes(nodeIds)
            for (const assetId of assetIds) {
              await deleteFilmAsset(assetId, { hardDelete: true })
            }
          }}
          onOpenPresetCenter={() => setPresetModalOpen(true)}
          onSaveProjectSettings={updateProjectSettings}
          onSaveStyleBible={async (styleBible) => {
            await updateProjectMetadata(writeStyleBible(snapshot.project.metadata, styleBible))
          }}
        />
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
            const task = snapshot.tasks.find((candidate) => candidate.id === taskId)
            const node =
              (task?.operationNodeId
                ? snapshot.nodes.find((candidate) => candidate.id === task.operationNodeId)
                : undefined) ?? snapshot.nodes.find((candidate) => candidate.taskId === taskId)
            if (node) {
              setSelectedNodeIds([node.id])
              message.info(`已定位到任务节点：${node.title ?? node.type}`)
            }
          }}
          onRetryTask={(taskId) => {
            const task = snapshot.tasks.find((t) => t.id === taskId)
            if (task) void handleRetryTask(task, 'original-task')
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
      <CanvasPromptLibraryQuickUseModal
        open={promptQuickUseOpen}
        assets={snapshot.assets}
        selectedNodeCount={selectedNodes.length}
        onClose={() => setPromptQuickUseOpen(false)}
        onApply={handleApplyPromptEntryFromQuickUse}
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
        ref={operationImageUploadInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => void handleOperationImageUploadChange(event)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void handleFileChange(event)}
      />
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(event) => void handleAudioFileChange(event)}
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
          open={Boolean(saveToLibraryNode) || promptCreateOpen}
          node={promptCreateOpen ? promptCreateNode : saveToLibraryNode}
          promptOnly={promptCreateOpen}
          snapshot={snapshot}
          categories={promptLibraryCategories}
          onCreateCategory={handleCreatePromptCategory}
          onClose={() => {
            setSaveToLibraryNodeId(null)
            setPromptCreateOpen(false)
          }}
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
    </CanvasOverlayBoundary>
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
