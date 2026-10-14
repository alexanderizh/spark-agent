import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Modal, Tooltip, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../../Icons'
import { translate, useI18n } from '../../../i18n'
import type {
  CanvasImageAnnotationDocument,
  CanvasImageAnnotationPadding,
  CanvasNode,
} from '../canvas.types'
import {
  FabricAnnotationEditor,
  type AnnotationEditorViewState,
  type AnnotationMosaicMode,
  type AnnotationTextBackground,
  type AnnotationTool,
} from './annotationFabricEditor'
import {
  DEFAULT_ANNOTATION_PADDING,
  EMPTY_ANNOTATION_PADDING,
  clampAnnotationPaddingValue,
  setLinkedAnnotationPadding,
} from './annotationGeometry'
import {
  calculateAnnotationExportBudget,
  formatAnnotationPixelCount,
} from './annotationExportBudget'
import {
  resolveCanvasImageAnnotationDraftPath,
  saveCanvasImageAnnotationDocument,
} from './annotationPersistence'
import './CanvasImageAnnotationWorkspace.less'

const COLORS = ['#ff4d4f', '#faad14', '#52c41a', '#1677ff', '#722ed1', '#111827', '#ffffff']
// 模块级常量只存 i18n key，渲染时再 translate()，避免语言切换后不刷新。
const WIDTHS = [
  { labelKey: 'canvasImageAnnotation.t1', value: 2 },
  { labelKey: 'canvasImageAnnotation.t2', value: 4 },
  { labelKey: 'canvasImageAnnotation.t3', value: 8 },
]

const INITIAL_VIEW_STATE: AnnotationEditorViewState = {
  width: 1,
  height: 1,
  paddingEnabled: false,
  padding: { ...EMPTY_ANNOTATION_PADDING },
  canUndo: false,
  canRedo: false,
  selectionCount: 0,
  selectedKind: null,
  hasPendingCrop: false,
  dirty: false,
  revision: 0,
}

const TOOL_ITEMS: Array<{
  key: AnnotationTool
  labelKey: string
  hotkey: string
  icon: ReactNode
}> = [
  { key: 'select', labelKey: 'canvasImageAnnotation.t4', hotkey: 'V', icon: <Icons.MousePointer size={18} /> },
  { key: 'pan', labelKey: 'canvasImageAnnotation.t5', hotkey: 'H', icon: <Icons.Hand size={18} /> },
  { key: 'arrow', labelKey: 'canvasImageAnnotation.t6', hotkey: 'A', icon: <Icons.ArrowUpRight size={18} /> },
  { key: 'rect', labelKey: 'canvasImageAnnotation.t7', hotkey: 'R', icon: <Icons.Square size={18} /> },
  { key: 'ellipse', labelKey: 'canvasImageAnnotation.t8', hotkey: 'O', icon: <Icons.Circle size={18} /> },
  { key: 'pen', labelKey: 'canvasImageAnnotation.t9', hotkey: 'P', icon: <Icons.Pencil size={18} /> },
  { key: 'highlight', labelKey: 'canvasImageAnnotation.t10', hotkey: 'G', icon: <Icons.Edit size={18} /> },
  { key: 'text', labelKey: 'canvasImageAnnotation.t11', hotkey: 'T', icon: <Icons.Type size={18} /> },
  { key: 'counter', labelKey: 'canvasImageAnnotation.t12', hotkey: 'N', icon: <Icons.Hash size={18} /> },
  {
    key: 'mosaic',
    labelKey: 'canvasImageAnnotation.t13',
    hotkey: 'M',
    icon: <span className="canvas-annotation-mosaic-icon" aria-hidden="true" />,
  },
  { key: 'crop', labelKey: 'canvasImageAnnotation.t14', hotkey: 'C', icon: <Icons.Crop size={18} /> },
  { key: 'padding', labelKey: 'canvasImageAnnotation.t15', hotkey: 'B', icon: <Icons.ImagePlus size={18} /> },
]

/** 留白四边：只存 i18n key，渲染时 translate()。 */
const PADDING_EDGE_LABEL_KEYS: Record<keyof CanvasImageAnnotationPadding, string> = {
  top: 'canvasImageAnnotation.t39',
  right: 'canvasImageAnnotation.t40',
  bottom: 'canvasImageAnnotation.t41',
  left: 'canvasImageAnnotation.t42',
}

function parseAnnotationDocument(value: string | undefined): CanvasImageAnnotationDocument | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<CanvasImageAnnotationDocument>
    if (
      parsed.schemaVersion !== 1 ||
      parsed.scene?.engine !== 'fabric' ||
      !parsed.source ||
      !parsed.artboard
    ) {
      return null
    }
    return parsed as CanvasImageAnnotationDocument
  } catch {
    return null
  }
}

function safeTitle(node: CanvasNode | null): string {
  return node?.title?.trim() || translate('canvasImageAnnotation.t16')
}

export function CanvasImageAnnotationWorkspace({
  open,
  node,
  projectRootPath,
  onCancel,
  onDraftSaved,
  onComplete,
}: {
  open: boolean
  node: CanvasNode | null
  projectRootPath?: string | null
  onCancel: () => void
  onDraftSaved?: (input: {
    documentPath: string
    document: CanvasImageAnnotationDocument
    sourceNode: CanvasNode
  }) => void | Promise<void>
  onComplete: (input: {
    dataUrl: string
    width: number
    height: number
    sourceNode: CanvasNode
    document: CanvasImageAnnotationDocument
    documentPath?: string
  }) => void | Promise<void>
}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const fabricMountRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<FabricAnnotationEditor | null>(null)
  const sourceNodeRef = useRef<CanvasNode | null>(node)
  const fitViewRef = useRef<() => void>(() => undefined)
  const toolRef = useRef<AnnotationTool>('select')
  const spacePreviousToolRef = useRef<AnnotationTool | null>(null)
  const draftPathRef = useRef<string | null>(resolveCanvasImageAnnotationDraftPath(node))
  const revisionRef = useRef(0)
  const autoSaveRunRef = useRef(0)
  const paddingDraftRef = useRef<CanvasImageAnnotationPadding>({ ...DEFAULT_ANNOTATION_PADDING })
  const paddingDragRef = useRef<{
    edge: keyof CanvasImageAnnotationPadding
    pointerId: number
    clientX: number
    clientY: number
    start: CanvasImageAnnotationPadding
  } | null>(null)
  const panStartRef = useRef<{
    pointerId: number
    x: number
    y: number
    panX: number
    panY: number
  } | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColor] = useState('#ff4d4f')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [mosaicMode, setMosaicMode] = useState<AnnotationMosaicMode>('brush')
  const [textBackground, setTextBackground] = useState<AnnotationTextBackground>('none')
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE)
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle')
  const [errorText, setErrorText] = useState('')
  const [minimized, setMinimized] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [paddingDraft, setPaddingDraft] = useState<CanvasImageAnnotationPadding>({
    ...DEFAULT_ANNOTATION_PADDING,
  })
  const [paddingLinked, setPaddingLinked] = useState(true)
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    resolveCanvasImageAnnotationDraftPath(node) ? 'saved' : 'idle',
  )
  const [draftError, setDraftError] = useState('')
  const [lastSavedRevision, setLastSavedRevision] = useState(0)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform), [])

  useEffect(() => {
    sourceNodeRef.current = node
  }, [node])

  const sourceUrl = useMemo(
    () => normalizeEduAssetUrl(node?.data.thumbnailUrl ?? node?.data.url ?? ''),
    [node],
  )
  const nodeId = node?.id ?? null

  const fitView = useCallback(() => {
    const stage = stageRef.current
    if (!stage || viewState.width <= 1 || viewState.height <= 1) return
    const availableWidth = Math.max(240, stage.clientWidth - 96)
    const availableHeight = Math.max(180, stage.clientHeight - 96)
    const next = Math.min(1, availableWidth / viewState.width, availableHeight / viewState.height)
    setZoom(Math.max(0.08, next))
    setPan({ x: 0, y: 0 })
  }, [viewState.height, viewState.width])
  useEffect(() => {
    fitViewRef.current = fitView
  }, [fitView])

  useEffect(() => {
    const sourceNode = sourceNodeRef.current
    const fabricMount = fabricMountRef.current
    if (!open || !sourceNode || !fabricMount) return
    if (!sourceUrl) {
      const frame = window.requestAnimationFrame(() => {
        setStatus('error')
        setErrorText(translate('canvasImageAnnotation.t17Desc'))
      })
      return () => window.cancelAnimationFrame(frame)
    }
    let cancelled = false
    let currentEditor: FabricAnnotationEditor | null = null
    const canvasElement = document.createElement('canvas')
    fabricMount.replaceChildren(canvasElement)
    const removeFabricDom = () => {
      const wrapper = canvasElement.parentElement
      if (wrapper?.parentElement === fabricMount && wrapper.dataset.fabric === 'wrapper') {
        wrapper.remove()
      } else if (canvasElement.parentElement === fabricMount) {
        canvasElement.remove()
      }
    }
    const start = async () => {
      setStatus('loading')
      setErrorText('')
      setViewState(INITIAL_VIEW_STATE)
      toolRef.current = 'select'
      setTool('select')
      setMinimized(false)
      setPan({ x: 0, y: 0 })
      draftPathRef.current = resolveCanvasImageAnnotationDraftPath(sourceNode)
      setLastSavedRevision(0)
      revisionRef.current = 0
      setDraftStatus(draftPathRef.current ? 'saved' : 'idle')
      setDraftError('')

      let document: CanvasImageAnnotationDocument | null = null
      const documentPath = resolveCanvasImageAnnotationDraftPath(sourceNode)
      if (documentPath) {
        try {
          const response = await window.spark.invoke('file:read', { filePath: documentPath })
          document = parseAnnotationDocument(response.content)
          if (!document && !response.error)
            message.warning(translate('canvasImageAnnotation.t18Desc'))
        } catch {
          message.warning(translate('canvasImageAnnotation.t19Desc'))
        }
      }
      if (cancelled) return
      currentEditor = await FabricAnnotationEditor.create(canvasElement, {
        sourceNode,
        sourceUrl,
        document,
        onViewStateChange: (state) => {
          if (cancelled) return
          revisionRef.current = state.revision
          setViewState(state)
          if (state.paddingEnabled) setPaddingDraft(state.padding)
        },
      })
      if (cancelled) {
        await currentEditor.dispose()
        removeFabricDom()
        return
      }
      editorRef.current = currentEditor
      currentEditor.setTool('select')
      setStatus('idle')
      requestAnimationFrame(() => fitViewRef.current())
    }

    void start().catch((error: unknown) => {
      if (cancelled) return
      const detail = error instanceof Error ? error.message : String(error)
      setErrorText(detail)
      setStatus('error')
      message.error(translate('canvasImageAnnotation.t20Desc'))
    })
    return () => {
      cancelled = true
      autoSaveRunRef.current += 1
      editorRef.current = null
      if (currentEditor) void currentEditor.dispose().finally(removeFabricDom)
      else removeFabricDom()
    }
  }, [loadAttempt, nodeId, open, sourceUrl])

  useEffect(() => {
    if (status === 'idle') requestAnimationFrame(fitView)
  }, [fitView, status, viewState.height, viewState.width])

  useEffect(() => {
    const stage = stageRef.current
    if (!open || minimized || !stage || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => fitViewRef.current())
    })
    observer.observe(stage)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [minimized, open])

  const chooseTool = useCallback((nextTool: AnnotationTool) => {
    toolRef.current = nextTool
    setTool(nextTool)
    editorRef.current?.setTool(nextTool)
  }, [])

  const updateColor = useCallback((nextColor: string) => {
    setColor(nextColor)
    editorRef.current?.setColor(nextColor)
  }, [])

  const updateStrokeWidth = useCallback((nextWidth: number) => {
    setStrokeWidth(nextWidth)
    editorRef.current?.setStrokeWidth(nextWidth)
  }, [])

  const updateMosaicMode = useCallback((mode: AnnotationMosaicMode) => {
    setMosaicMode(mode)
    editorRef.current?.setMosaicMode(mode)
  }, [])

  const updateTextBackground = useCallback((style: AnnotationTextBackground) => {
    setTextBackground(style)
    editorRef.current?.setTextBackground(style)
  }, [])

  const applyPadding = useCallback(
    (enabled: boolean, nextPadding = paddingDraft) => {
      setPaddingDraft(nextPadding)
      editorRef.current?.setPadding(enabled, nextPadding)
    },
    [paddingDraft],
  )

  useEffect(() => {
    paddingDraftRef.current = paddingDraft
  }, [paddingDraft])

  const saveDraft = useCallback(async () => {
    const editor = editorRef.current
    const sourceNode = sourceNodeRef.current
    if (!editor || !sourceNode) return
    const revision = revisionRef.current
    const runId = ++autoSaveRunRef.current
    setDraftStatus('saving')
    setDraftError('')
    try {
      const document = editor.serializeDocument()
      const documentPath = await saveCanvasImageAnnotationDocument({
        document,
        sourceNode,
        existingFilePath: draftPathRef.current,
        ...(projectRootPath ? { projectRootPath } : {}),
      })
      if (runId !== autoSaveRunRef.current) return
      draftPathRef.current = documentPath
      setLastSavedRevision(revision)
      await onDraftSaved?.({ documentPath, document, sourceNode })
      if (runId !== autoSaveRunRef.current) return
      setDraftStatus('saved')
    } catch (error) {
      if (runId !== autoSaveRunRef.current) return
      setDraftStatus('error')
      setDraftError(error instanceof Error ? error.message : translate('canvasImageAnnotation.t21'))
    }
  }, [onDraftSaved, projectRootPath])

  useEffect(() => {
    if (
      !open ||
      status !== 'idle' ||
      !viewState.dirty ||
      viewState.revision <= lastSavedRevision ||
      draftStatus === 'saving' ||
      draftStatus === 'error'
    ) {
      return
    }
    const timer = window.setTimeout(() => void saveDraft(), 1200)
    return () => window.clearTimeout(timer)
  }, [draftStatus, lastSavedRevision, open, saveDraft, status, viewState.dirty, viewState.revision])

  const updatePaddingEdge = useCallback(
    (edge: keyof CanvasImageAnnotationPadding, value: number) => {
      const safeValue = clampAnnotationPaddingValue(value)
      const next = paddingLinked
        ? setLinkedAnnotationPadding(safeValue)
        : { ...paddingDraft, [edge]: safeValue }
      applyPadding(true, next)
    },
    [applyPadding, paddingDraft, paddingLinked],
  )

  const requestClose = useCallback(() => {
    const draftUpToDate = draftStatus === 'saved' && viewState.revision <= lastSavedRevision
    if (!viewState.dirty || draftUpToDate) {
      onCancel()
      return
    }
    Modal.confirm({
      title: translate('canvasImageAnnotation.t22'),
      content: draftUpToDate
        ? translate('canvasImageAnnotation.t23Desc')
        : draftStatus === 'error'
          ? translate('canvasImageAnnotation.tpl1Desc', {
              reason: draftError || translate('canvasImageAnnotation.t24'),
            })
          : translate('canvasImageAnnotation.t25Desc'),
      okText: draftUpToDate ? translate('canvasImageAnnotation.t26') : translate('canvasImageAnnotation.t27'),
      cancelText: translate('canvasImageAnnotation.t28'),
      ...(!draftUpToDate ? { okButtonProps: { danger: true } } : {}),
      onOk: onCancel,
    })
  }, [draftError, draftStatus, lastSavedRevision, onCancel, viewState.dirty, viewState.revision])

  const runComplete = useCallback(
    async (multiplier: number) => {
      const editor = editorRef.current
      const sourceNode = sourceNodeRef.current
      if (!editor || !sourceNode || status !== 'idle') return
      if (draftStatus === 'saving') {
        message.info(translate('canvasImageAnnotation.t29Desc'))
        return
      }
      autoSaveRunRef.current += 1
      setStatus('saving')
      try {
        const result = editor.exportResult(multiplier)
        await onComplete({
          dataUrl: result.dataUrl,
          width: result.outputWidth,
          height: result.outputHeight,
          sourceNode,
          document: result.document,
          ...(draftPathRef.current ? { documentPath: draftPathRef.current } : {}),
        })
      } catch (error) {
        message.error(error instanceof Error ? error.message : translate('canvasImageAnnotation.t30'))
        setStatus('idle')
      }
    },
    [draftStatus, onComplete, status],
  )

  const complete = useCallback(() => {
    const editor = editorRef.current
    if (!editor || status !== 'idle') return
    const budget = calculateAnnotationExportBudget(viewState.width, viewState.height)
    if (budget.level === 'downscale') {
      Modal.confirm({
        title: translate('canvasImageAnnotation.t31Desc'),
        content: translate('canvasImageAnnotation.tpl8LongDesc', {
          width: viewState.width,
          height: viewState.height,
          pixels: formatAnnotationPixelCount(budget.pixels),
          percent: Math.round(budget.recommendedMultiplier * 100),
          outWidth: budget.outputWidth,
          outHeight: budget.outputHeight,
        }),
        okText: translate('canvasImageAnnotation.tpl2', {
          percent: Math.round(budget.recommendedMultiplier * 100),
        }),
        cancelText: translate('canvasImageAnnotation.t32'),
        onOk: () => runComplete(budget.recommendedMultiplier),
      })
      return
    }
    void runComplete(1)
  }, [runComplete, status, viewState.height, viewState.width])

  useEffect(() => {
    if (!open || minimized) return
    const onKeyDown = (event: KeyboardEvent) => {
      const editor = editorRef.current
      if (!editor?.handlesKeyboardEvent(event)) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) void editor.redo()
        else void editor.undo()
        return
      }
      if (mod && key === 'd') {
        event.preventDefault()
        void editor.duplicateSelection()
        return
      }
      if (mod && event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        void complete()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        editor.deleteSelection()
        return
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        editor.moveSelection(
          event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
          event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0,
        )
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (editor.cancelCurrentAction()) return
        if (toolRef.current !== 'select') chooseTool('select')
        else requestClose()
        return
      }
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        if (spacePreviousToolRef.current == null) {
          spacePreviousToolRef.current = toolRef.current
          chooseTool('pan')
        }
        return
      }
      if (mod || event.altKey) return
      const item = TOOL_ITEMS.find((candidate) => candidate.hotkey.toLowerCase() === key)
      if (item) {
        event.preventDefault()
        chooseTool(item.key)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || spacePreviousToolRef.current == null) return
      event.preventDefault()
      const previousTool = spacePreviousToolRef.current
      spacePreviousToolRef.current = null
      chooseTool(previousTool)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      spacePreviousToolRef.current = null
    }
  }, [chooseTool, complete, minimized, open, requestClose])

  const transformStyle = useMemo<CSSProperties>(
    () => ({ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }),
    [pan.x, pan.y, zoom],
  )

  const beginPan = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== 'pan') return
      panStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: pan.x,
        panY: pan.y,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [pan.x, pan.y, tool],
  )

  const movePan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    })
  }, [])

  const endPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current?.pointerId !== event.pointerId) return
    panStartRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const beginPaddingDrag = useCallback(
    (edge: keyof CanvasImageAnnotationPadding, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      paddingDragRef.current = {
        edge,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        start: { ...paddingDraftRef.current },
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [],
  )

  const movePaddingDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = paddingDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const horizontal = (event.clientX - drag.clientX) / Math.max(zoom, 0.08)
      const vertical = (event.clientY - drag.clientY) / Math.max(zoom, 0.08)
      const delta =
        drag.edge === 'left'
          ? -horizontal
          : drag.edge === 'right'
            ? horizontal
            : drag.edge === 'top'
              ? -vertical
              : vertical
      const value = clampAnnotationPaddingValue(drag.start[drag.edge] + delta)
      const next = { ...drag.start, [drag.edge]: value }
      paddingDraftRef.current = next
      setPaddingDraft(next)
      editorRef.current?.setPadding(true, next, false)
    },
    [zoom],
  )

  const endPaddingDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = paddingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    paddingDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    editorRef.current?.setPadding(true, paddingDraftRef.current, true)
  }, [])

  const toolbarDisabled = status !== 'idle'
  const completeDisabled = toolbarDisabled || draftStatus === 'saving'
  const selectedCanStyle =
    viewState.selectionCount > 0 &&
    viewState.selectedKind !== 'mosaic' &&
    viewState.selectedKind !== 'counter'
  const showStyleBar =
    tool === 'arrow' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'pen' ||
    tool === 'highlight' ||
    tool === 'text' ||
    tool === 'mosaic' ||
    selectedCanStyle
  const isTextStyle = tool === 'text' || viewState.selectedKind === 'text'
  const isMosaicStyle = tool === 'mosaic'
  const exportBudget = calculateAnnotationExportBudget(viewState.width, viewState.height)
  const draftLabel =
    draftStatus === 'saving'
      ? translate('canvasImageAnnotation.t33')
      : draftStatus === 'saved' && viewState.revision <= lastSavedRevision
        ? translate('canvasImageAnnotation.t34')
        : draftStatus === 'error'
          ? translate('canvasImageAnnotation.t21')
          : viewState.dirty
            ? translate('canvasImageAnnotation.t35')
            : translate('canvasImageAnnotation.t36')

  return (
    <>
      <Modal
        open={open && !minimized}
        footer={null}
        closable={false}
        forceRender
        focusable={{ trap: false }}
        className="canvas-image-annotation-workspace-modal"
        wrapClassName="canvas-image-annotation-workspace-wrap"
        destroyOnHidden={false}
      >
        <div className={`canvas-image-annotation-workspace${isMac ? ' is-mac' : ''}`}>
          <header className="canvas-annotation-topbar">
            <div className="canvas-annotation-topbar-main">
              <button
                type="button"
                className="canvas-annotation-icon-button"
                onClick={requestClose}
              >
                <Icons.ChevronLeft size={19} />
                <span>{translate('canvasImageAnnotation.t70')}</span>
              </button>
              <span className="canvas-annotation-topbar-divider" />
              <div className="canvas-annotation-title">
                <strong>{safeTitle(node)}</strong>
                <span className={`is-draft-${draftStatus}`}>{draftLabel}</span>
              </div>
            </div>
            <div className="canvas-annotation-topbar-actions">
              <Tooltip title={translate('canvasImageAnnotation.t59')}>
                <button
                  type="button"
                  className="canvas-annotation-icon-button is-square"
                  onClick={() => setZoom((value) => Math.max(0.08, value - 0.1))}
                  aria-label={translate('canvasImageAnnotation.t59')}
                >
                  <Icons.Minus size={17} />
                </button>
              </Tooltip>
              <button type="button" className="canvas-annotation-zoom" onClick={fitView}>
                {Math.round(zoom * 100)}%
              </button>
              <Tooltip title={translate('canvasImageAnnotation.t60')}>
                <button
                  type="button"
                  className="canvas-annotation-icon-button is-square"
                  onClick={() => setZoom((value) => Math.min(4, value + 0.1))}
                  aria-label={translate('canvasImageAnnotation.t60')}
                >
                  <Icons.Plus size={17} />
                </button>
              </Tooltip>
              <Tooltip title={translate('canvasImageAnnotation.t61')}>
                <button
                  type="button"
                  className="canvas-annotation-icon-button is-square"
                  onClick={fitView}
                  aria-label={translate('canvasImageAnnotation.t61')}
                >
                  <Icons.Maximize size={17} />
                </button>
              </Tooltip>
              <Tooltip title={translate('canvasImageAnnotation.t62')}>
                <button
                  type="button"
                  className="canvas-annotation-icon-button is-square"
                  onClick={() => setMinimized(true)}
                  aria-label={translate('canvasImageAnnotation.t62')}
                >
                  <Icons.Minimize size={17} />
                </button>
              </Tooltip>
              <button
                type="button"
                className="canvas-annotation-complete"
                onClick={() => void complete()}
                disabled={completeDisabled}
              >
                {status === 'saving' ? <Icons.Spinner size={16} /> : <Icons.Check size={16} />}
                <span>{status === 'saving' ? translate('canvasImageAnnotation.t37') : translate('canvasImageAnnotation.t38')}</span>
              </button>
            </div>
          </header>

          <main
            ref={stageRef}
            className={`canvas-annotation-stage${tool === 'pan' ? ' is-pan' : ''}`}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onWheel={(event) => {
              event.preventDefault()
              if (event.metaKey || event.ctrlKey) {
                setZoom((value) =>
                  Math.max(0.08, Math.min(4, value + (event.deltaY < 0 ? 0.08 : -0.08))),
                )
              } else {
                setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY }))
              }
            }}
          >
            <div className="canvas-annotation-artboard-transform" style={transformStyle}>
              <div ref={fabricMountRef} className="canvas-annotation-fabric-mount" />
              {tool === 'padding' && viewState.paddingEnabled && (
                <div className="canvas-annotation-padding-handles" aria-label={translate('canvasImageAnnotation.t63')}>
                  {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
                    <button
                      type="button"
                      key={edge}
                      className={`is-${edge}`}
                      onPointerDown={(event) => beginPaddingDrag(edge, event)}
                      onPointerMove={movePaddingDrag}
                      onPointerUp={endPaddingDrag}
                      onPointerCancel={endPaddingDrag}
                      aria-label={translate('canvasImageAnnotation.tpl3Desc', {
                        edge: translate(PADDING_EDGE_LABEL_KEYS[edge]),
                      })}
                    />
                  ))}
                </div>
              )}
            </div>

            {(status === 'loading' || status === 'error') && (
              <div className={`canvas-annotation-state${status === 'error' ? ' is-error' : ''}`}>
                {status === 'loading' ? <Icons.Spinner size={28} /> : <Icons.Image size={36} />}
                <strong>{status === 'loading' ? translate('canvasImageAnnotation.t43') : translate('canvasImageAnnotation.t44')}</strong>
                {errorText && <span>{errorText}</span>}
                {status === 'error' && (
                  <button
                    type="button"
                    className="canvas-annotation-state-retry"
                    onClick={() => setLoadAttempt((value) => value + 1)}
                  >
                    {translate('canvasImageAnnotation.t71')}
                  </button>
                )}
              </div>
            )}

            {draftStatus === 'error' && status === 'idle' && (
              <div className="canvas-annotation-draft-error" role="alert">
                <Icons.AlertTriangle size={16} />
                <span>{draftError || translate('canvasImageAnnotation.t45')}</span>
                <button type="button" onClick={() => void saveDraft()}>
                  {translate('canvasImageAnnotation.t72')}
                </button>
              </div>
            )}

            <div className="canvas-annotation-floating-controls">
              {tool === 'padding' && (
                <div className="canvas-annotation-property-panel is-padding">
                  <label className="canvas-annotation-toggle-row">
                    <input
                      type="checkbox"
                      checked={viewState.paddingEnabled}
                      onChange={(event) => applyPadding(event.target.checked)}
                    />
                    <span>{translate('canvasImageAnnotation.t73')}</span>
                  </label>
                  <span className="canvas-annotation-property-divider" />
                  {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
                    <label className="canvas-annotation-padding-field" key={edge}>
                      <span>{translate(PADDING_EDGE_LABEL_KEYS[edge])}</span>
                      <input
                        type="number"
                        min={0}
                        max={4096}
                        value={paddingDraft[edge]}
                        disabled={!viewState.paddingEnabled}
                        onChange={(event) => updatePaddingEdge(edge, Number(event.target.value))}
                      />
                    </label>
                  ))}
                  <Tooltip title={paddingLinked ? translate('canvasImageAnnotation.t46') : translate('canvasImageAnnotation.t47')}>
                    <button
                      type="button"
                      className={`canvas-annotation-link-button${paddingLinked ? ' active' : ''}`}
                      onClick={() => setPaddingLinked((value) => !value)}
                      aria-label={translate('canvasImageAnnotation.t64')}
                    >
                      <Icons.Layers size={16} />
                    </button>
                  </Tooltip>
                  {[32, 64, 128].map((preset) => (
                    <button
                      type="button"
                      className="canvas-annotation-padding-preset"
                      key={preset}
                      disabled={!viewState.paddingEnabled}
                      onClick={() => applyPadding(true, setLinkedAnnotationPadding(preset))}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}

              {showStyleBar && tool !== 'padding' && (
                <div className="canvas-annotation-property-panel">
                  {isMosaicStyle ? (
                    <div className="canvas-annotation-segments" aria-label={translate('canvasImageAnnotation.t65')}>
                      <button
                        type="button"
                        className={mosaicMode === 'brush' ? 'active' : ''}
                        onClick={() => updateMosaicMode('brush')}
                        aria-pressed={mosaicMode === 'brush'}
                      >
                        <Icons.Pencil size={15} /> {translate('canvasImageAnnotation.t74')}
                      </button>
                      <button
                        type="button"
                        className={mosaicMode === 'rect' ? 'active' : ''}
                        onClick={() => updateMosaicMode('rect')}
                        aria-pressed={mosaicMode === 'rect'}
                      >
                        <Icons.Square size={15} /> {translate('canvasImageAnnotation.t7')}
                      </button>
                    </div>
                  ) : (
                    <div className="canvas-annotation-colors" aria-label={translate('canvasImageAnnotation.t66')}>
                      {COLORS.map((item) => (
                        <button
                          type="button"
                          key={item}
                          className={`canvas-annotation-color${color === item ? ' active' : ''}`}
                          style={{ '--annotation-color': item } as CSSProperties}
                          onClick={() => updateColor(item)}
                          aria-label={translate('canvasImageAnnotation.tpl4', { color: item })}
                        />
                      ))}
                    </div>
                  )}
                  {isTextStyle && (
                    <>
                      <span className="canvas-annotation-property-divider" />
                      <div className="canvas-annotation-segments" aria-label={translate('canvasImageAnnotation.t67')}>
                        {(
                          [
                            ['none', translate('canvasImageAnnotation.t48')],
                            ['dark', translate('canvasImageAnnotation.t49')],
                            ['light', translate('canvasImageAnnotation.t50')],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={textBackground === value ? 'active' : ''}
                            onClick={() => updateTextBackground(value)}
                            aria-pressed={textBackground === value}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {!isTextStyle && (
                    <>
                      <span className="canvas-annotation-property-divider" />
                      <div
                        className="canvas-annotation-widths"
                        aria-label={isMosaicStyle ? translate('canvasImageAnnotation.t51') : translate('canvasImageAnnotation.t52')}
                      >
                        {WIDTHS.map((item) => (
                          <button
                            type="button"
                            key={item.value}
                            className={strokeWidth === item.value ? 'active' : ''}
                            onClick={() => updateStrokeWidth(item.value)}
                            aria-label={translate('canvasImageAnnotation.tpl5', {
                              label: translate(item.labelKey),
                            })}
                          >
                            <span style={{ width: item.value * 1.6, height: item.value * 1.6 }} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {viewState.hasPendingCrop && (
                <div className="canvas-annotation-crop-actions">
                  <button type="button" onClick={() => editorRef.current?.cancelCrop()}>
                    {translate('canvasImageAnnotation.t75')}
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => editorRef.current?.applyCrop()}
                  >
                    {translate('canvasImageAnnotation.t76')}
                  </button>
                </div>
              )}

              <nav className="canvas-annotation-tool-dock" aria-label={translate('canvasImageAnnotation.t68')}>
                {TOOL_ITEMS.map((item) => (
                  <Tooltip
                    title={translate('canvasImageAnnotation.tpl7', {
                      label: translate(item.labelKey),
                      hotkey: item.hotkey,
                    })}
                    key={item.key}
                  >
                    <button
                      type="button"
                      className={tool === item.key ? 'active' : ''}
                      onClick={() => chooseTool(item.key)}
                      disabled={toolbarDisabled}
                      aria-label={translate('canvasImageAnnotation.tpl6', {
                        label: translate(item.labelKey),
                        hotkey: item.hotkey,
                      })}
                      aria-pressed={tool === item.key}
                    >
                      {item.icon}
                      <span>{translate(item.labelKey)}</span>
                    </button>
                  </Tooltip>
                ))}
              </nav>
            </div>
          </main>

          <footer className="canvas-annotation-statusbar">
            <div>
              <button
                type="button"
                onClick={() => void editorRef.current?.undo()}
                disabled={!viewState.canUndo}
              >
                <Icons.Undo2 size={15} /> {translate('canvasImageAnnotation.t77')}
              </button>
              <button
                type="button"
                onClick={() => void editorRef.current?.redo()}
                disabled={!viewState.canRedo}
              >
                <Icons.Redo2 size={15} /> {translate('canvasImageAnnotation.t78')}
              </button>
              <button
                type="button"
                onClick={() => editorRef.current?.deleteSelection()}
                disabled={viewState.selectionCount === 0}
              >
                <Icons.Trash size={15} /> {translate('canvasImageAnnotation.t79')}
              </button>
            </div>
            <span>
              {draftLabel} ·{' '}
              {viewState.paddingEnabled
                ? translate('canvasImageAnnotation.t53')
                : translate('canvasImageAnnotation.t54')}{' '}
              · {viewState.width} × {viewState.height}px
              {exportBudget.level !== 'safe'
                ? translate('canvasImageAnnotation.tpl9', {
                    mode:
                      exportBudget.level === 'downscale'
                        ? translate('canvasImageAnnotation.t55')
                        : translate('canvasImageAnnotation.t56'),
                  })
                : ''}
            </span>
            <span className="canvas-annotation-shortcut-hint">
              {translate('canvasImageAnnotation.t80Desc')}
            </span>
          </footer>
        </div>
      </Modal>

      {open && minimized && (
        <div className="canvas-annotation-minimized" role="status">
          <div>
            <strong>{translate('canvasImageAnnotation.t81')}</strong>
            <span>{viewState.dirty ? translate('canvasImageAnnotation.t57') : translate('canvasImageAnnotation.t58')}</span>
          </div>
          <button type="button" onClick={() => setMinimized(false)}>
            <Icons.Edit size={15} /> {translate('canvasImageAnnotation.t28')}
          </button>
          <button type="button" className="is-close" onClick={requestClose} aria-label={translate('canvasImageAnnotation.t69')}>
            <Icons.X size={15} />
          </button>
        </div>
      )}
    </>
  )
}
