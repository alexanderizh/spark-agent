import type { Canvas, FabricImage, FabricObject, Group, TPointerEventInfo } from 'fabric'
import type {
  CanvasImageAnnotationDocument,
  CanvasImageAnnotationPadding,
  CanvasNode,
} from '../canvas.types'
import {
  EMPTY_ANNOTATION_PADDING,
  annotationArtboardSize,
  annotationPaddingTranslation,
  normalizeAnnotationPadding,
} from './annotationGeometry'

export type AnnotationTool =
  | 'select'
  | 'pan'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'highlight'
  | 'text'
  | 'counter'
  | 'mosaic'
  | 'crop'
  | 'padding'

export type AnnotationMosaicMode = 'brush' | 'rect'
export type AnnotationTextBackground = 'none' | 'dark' | 'light'

type AnnotationObjectKind =
  | 'source'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'highlight'
  | 'text'
  | 'counter'
  | 'mosaic'
  | 'crop'

type TaggedFabricObject = FabricObject & {
  annotationKind?: AnnotationObjectKind
  mosaicBlockSize?: number
  mosaicMode?: AnnotationMosaicMode
  mosaicMaskDataUrl?: string
}

type FabricModule = typeof import('fabric')

type EditorSnapshot = {
  scene: unknown
  contentWidth: number
  contentHeight: number
  paddingEnabled: boolean
  padding: CanvasImageAnnotationPadding
}

export type AnnotationEditorViewState = {
  width: number
  height: number
  paddingEnabled: boolean
  padding: CanvasImageAnnotationPadding
  canUndo: boolean
  canRedo: boolean
  selectionCount: number
  selectedKind: AnnotationObjectKind | null
  hasPendingCrop: boolean
  dirty: boolean
  revision: number
}

export type AnnotationEditorOptions = {
  sourceNode: CanvasNode
  sourceUrl: string
  document?: CanvasImageAnnotationDocument | null
  onViewStateChange: (state: AnnotationEditorViewState) => void
}

const SOURCE_KIND: AnnotationObjectKind = 'source'
const CROP_KIND: AnnotationObjectKind = 'crop'
const SCENE_PROPERTIES = ['annotationKind', 'mosaicBlockSize', 'mosaicMode', 'mosaicMaskDataUrl']
const MAX_HISTORY = 60
const DEFAULT_COLOR = '#ff4d4f'

function objectKind(object: FabricObject | null | undefined): AnnotationObjectKind | null {
  return (object as TaggedFabricObject | null | undefined)?.annotationKind ?? null
}

function tagObject<T extends FabricObject>(
  object: T,
  annotationKind: AnnotationObjectKind,
): T & TaggedFabricObject {
  const tagged = object as T & TaggedFabricObject
  tagged.annotationKind = annotationKind
  return tagged
}

function arrowPathData(startX: number, startY: number, endX: number, endY: number): string {
  const angle = Math.atan2(endY - startY, endX - startX)
  const head = Math.max(14, Math.min(28, Math.hypot(endX - startX, endY - startY) * 0.18))
  const spread = Math.PI / 7
  const x1 = endX - head * Math.cos(angle - spread)
  const y1 = endY - head * Math.sin(angle - spread)
  const x2 = endX - head * Math.cos(angle + spread)
  const y2 = endY - head * Math.sin(angle + spread)
  return `M ${startX} ${startY} L ${endX} ${endY} M ${x1} ${y1} L ${endX} ${endY} L ${x2} ${y2}`
}

function isEditableObject(object: FabricObject): boolean {
  const kind = objectKind(object)
  return kind != null && kind !== SOURCE_KIND && kind !== CROP_KIND
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

export class FabricAnnotationEditor {
  private readonly fabric: FabricModule
  private readonly canvas: Canvas
  private readonly options: AnnotationEditorOptions
  private sourceImage: FabricImage | null = null
  private tool: AnnotationTool = 'select'
  private color = DEFAULT_COLOR
  private strokeWidth = 4
  private mosaicMode: AnnotationMosaicMode = 'brush'
  private textBackground: AnnotationTextBackground = 'none'
  private drawStart: { x: number; y: number } | null = null
  private draftObject: FabricObject | null = null
  private pendingCrop: FabricObject | null = null
  private contentWidth = 1
  private contentHeight = 1
  private paddingEnabled = false
  private padding: CanvasImageAnnotationPadding = { ...EMPTY_ANNOTATION_PADDING }
  private history: EditorSnapshot[] = []
  private historyIndex = -1
  private restoring = false
  private dirty = false
  private revision = 0
  private createdAt = new Date().toISOString()
  private counter = 1

  private constructor(
    fabric: FabricModule,
    element: HTMLCanvasElement,
    options: AnnotationEditorOptions,
  ) {
    this.fabric = fabric
    this.options = options
    const customProperties = new Set(fabric.FabricObject.customProperties)
    for (const property of SCENE_PROPERTIES) customProperties.add(property)
    fabric.FabricObject.customProperties = [...customProperties]
    this.canvas = new fabric.Canvas(element, {
      width: 1,
      height: 1,
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true,
      enablePointerEvents: true,
      targetFindTolerance: 12,
    })
    this.bindCanvasEvents()
  }

  static async create(
    element: HTMLCanvasElement,
    options: AnnotationEditorOptions,
  ): Promise<FabricAnnotationEditor> {
    const fabric = await import('fabric')
    const editor = new FabricAnnotationEditor(fabric, element, options)
    try {
      await editor.load()
      return editor
    } catch (error) {
      await editor.dispose()
      throw error
    }
  }

  private async load(): Promise<void> {
    const document = this.options.document
    this.restoring = true
    try {
      if (document?.schemaVersion === 1 && document.scene.engine === 'fabric') {
        this.createdAt = document.createdAt
        this.contentWidth = Math.max(1, document.artboard.contentWidth)
        this.contentHeight = Math.max(1, document.artboard.contentHeight)
        this.padding = normalizeAnnotationPadding(document.artboard.padding)
        this.paddingEnabled = document.artboard.background === '#ffffff'
        this.canvas.setDimensions({
          width: Math.max(1, document.artboard.width),
          height: Math.max(1, document.artboard.height),
        })
        this.canvas.backgroundColor = document.artboard.background ?? ''
        await this.canvas.loadFromJSON(document.scene.json as Record<string, unknown>)
        this.sourceImage =
          (this.canvas.getObjects().find((object) => objectKind(object) === SOURCE_KIND) as
            | FabricImage
            | undefined) ?? null
        this.counter = this.resolveNextCounter()
      } else {
        const image = await this.fabric.FabricImage.fromURL(
          this.options.sourceUrl,
          { crossOrigin: 'anonymous' },
          {
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
            selectable: false,
            evented: false,
            objectCaching: false,
          },
        )
        tagObject(image, SOURCE_KIND)
        this.sourceImage = image
        this.contentWidth = Math.max(1, Math.round(image.width || image.getOriginalSize().width))
        this.contentHeight = Math.max(1, Math.round(image.height || image.getOriginalSize().height))
        this.canvas.setDimensions({ width: this.contentWidth, height: this.contentHeight })
        this.canvas.add(image)
        this.canvas.sendObjectToBack(image)
      }
      this.configureAllObjects()
      this.applyToolMode()
      this.canvas.requestRenderAll()
      this.history = [this.captureSnapshot()]
      this.historyIndex = 0
      this.dirty = false
      this.revision = 0
    } finally {
      this.restoring = false
      this.emitViewState()
    }
  }

  private bindCanvasEvents(): void {
    this.canvas.on('mouse:down', (event) => this.handleMouseDown(event))
    this.canvas.on('mouse:move', (event) => this.handleMouseMove(event))
    this.canvas.on('mouse:up', (event) => void this.handleMouseUp(event))
    this.canvas.on('path:created', ({ path }) => {
      if (this.restoring) return
      if (this.tool === 'mosaic') {
        this.canvas.remove(path)
        void this.createMosaicBrush(path).then((mosaic) => {
          if (mosaic) this.canvas.add(mosaic)
          this.canvas.requestRenderAll()
          this.commitHistory()
        })
        return
      }
      tagObject(path, this.tool === 'highlight' ? 'highlight' : 'pen')
      this.configureObject(path)
      path.set({
        stroke: this.color,
        opacity: this.tool === 'highlight' ? 0.35 : 1,
        selectable: false,
      })
      this.commitHistory()
    })
    this.canvas.on('object:modified', ({ target }) => {
      if (this.restoring || !target) return
      if (objectKind(target) === 'mosaic') {
        void this.refreshMosaic(target as FabricImage).then(() => this.commitHistory())
        return
      }
      this.commitHistory()
    })
    this.canvas.on('text:editing:exited', () => {
      if (!this.restoring) this.commitHistory()
    })
    this.canvas.on('selection:created', () => this.emitViewState())
    this.canvas.on('selection:updated', () => this.emitViewState())
    this.canvas.on('selection:cleared', () => this.emitViewState())
  }

  private handleMouseDown(event: TPointerEventInfo): void {
    if (
      this.tool === 'select' ||
      this.tool === 'pan' ||
      this.tool === 'padding' ||
      this.tool === 'pen' ||
      this.tool === 'highlight' ||
      (this.tool === 'mosaic' && this.mosaicMode === 'brush') ||
      event.target
    ) {
      return
    }
    const point = event.scenePoint
    if (this.tool === 'text') {
      const text = tagObject(
        new this.fabric.IText('输入文字', {
          left: point.x,
          top: point.y,
          originX: 'left',
          originY: 'top',
          fill: this.color,
          fontSize: 28,
          backgroundColor: this.resolveTextBackgroundColor(this.textBackground),
          fontFamily:
            '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", system-ui, sans-serif',
          padding: 5,
        }),
        'text',
      )
      this.configureObject(text)
      this.canvas.add(text)
      this.canvas.setActiveObject(text)
      text.enterEditing()
      text.selectAll()
      requestAnimationFrame(() => {
        if (text.isEditing) text.hiddenTextarea?.focus({ preventScroll: true })
      })
      this.canvas.requestRenderAll()
      return
    }
    if (this.tool === 'counter') {
      this.addCounter(point.x, point.y)
      return
    }

    this.drawStart = { x: point.x, y: point.y }
    if (this.tool === 'rect' || this.tool === 'mosaic' || this.tool === 'crop') {
      const kind = this.tool === 'crop' ? CROP_KIND : this.tool
      const rect = tagObject(
        new this.fabric.Rect({
          left: point.x,
          top: point.y,
          originX: 'left',
          originY: 'top',
          width: 1,
          height: 1,
          fill: this.tool === 'mosaic' ? 'rgba(100,116,139,0.3)' : 'transparent',
          stroke: this.tool === 'crop' ? '#ffffff' : this.color,
          strokeWidth: this.strokeWidth,
          strokeDashArray: this.tool === 'crop' ? [8, 6] : null,
          selectable: false,
          evented: false,
        }),
        kind,
      )
      this.draftObject = rect
    } else if (this.tool === 'ellipse') {
      this.draftObject = tagObject(
        new this.fabric.Ellipse({
          left: point.x,
          top: point.y,
          originX: 'left',
          originY: 'top',
          rx: 1,
          ry: 1,
          fill: 'transparent',
          stroke: this.color,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false,
        }),
        'ellipse',
      )
    } else if (this.tool === 'arrow') {
      this.draftObject = this.createArrow(point.x, point.y, point.x + 1, point.y + 1)
    }
    if (this.draftObject) this.canvas.add(this.draftObject)
  }

  private handleMouseMove(event: TPointerEventInfo): void {
    const start = this.drawStart
    const draft = this.draftObject
    if (!start || !draft) return
    const point = event.scenePoint
    if (this.tool === 'arrow') {
      this.canvas.remove(draft)
      this.draftObject = this.createArrow(start.x, start.y, point.x, point.y)
      this.canvas.add(this.draftObject)
      return
    }
    const left = Math.min(start.x, point.x)
    const top = Math.min(start.y, point.y)
    const width = Math.max(1, Math.abs(point.x - start.x))
    const height = Math.max(1, Math.abs(point.y - start.y))
    if (objectKind(draft) === 'ellipse') {
      draft.set({ left, top, rx: width / 2, ry: height / 2 })
    } else {
      draft.set({ left, top, width, height })
    }
    draft.setCoords()
    this.canvas.requestRenderAll()
  }

  private async handleMouseUp(_event: TPointerEventInfo): Promise<void> {
    const start = this.drawStart
    const draft = this.draftObject
    this.drawStart = null
    this.draftObject = null
    if (!start || !draft) return
    const width = draft.getScaledWidth()
    const height = draft.getScaledHeight()
    if (width < 4 && height < 4) {
      this.canvas.remove(draft)
      return
    }
    if (objectKind(draft) === 'mosaic') {
      const left = draft.left
      const top = draft.top
      this.canvas.remove(draft)
      const mosaic = await this.createMosaic(left, top, width, height, this.strokeWidth * 4)
      if (mosaic) this.canvas.add(mosaic)
      this.commitHistory()
      return
    }
    if (objectKind(draft) === CROP_KIND) {
      if (this.pendingCrop) this.canvas.remove(this.pendingCrop)
      this.pendingCrop = draft
      draft.set({ selectable: true, evented: true })
      this.configureObject(draft)
      this.canvas.setActiveObject(draft)
      this.canvas.requestRenderAll()
      this.emitViewState()
      return
    }
    this.configureObject(draft)
    draft.set({ selectable: false, evented: false })
    this.canvas.requestRenderAll()
    this.commitHistory()
  }

  private createArrow(startX: number, startY: number, endX: number, endY: number): FabricObject {
    const arrow = tagObject(
      new this.fabric.Path(arrowPathData(startX, startY, endX, endY), {
        originX: 'left',
        originY: 'top',
        fill: 'transparent',
        stroke: this.color,
        strokeWidth: this.strokeWidth,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: false,
        evented: false,
      }),
      'arrow',
    )
    this.configureObject(arrow)
    return arrow
  }

  private addCounter(x: number, y: number): void {
    const radius = 17
    const circle = new this.fabric.Circle({
      radius,
      fill: this.color,
      originX: 'center',
      originY: 'center',
    })
    const label = new this.fabric.FabricText(String(this.counter++), {
      fill: '#ffffff',
      fontSize: 18,
      fontWeight: 700,
      originX: 'center',
      originY: 'center',
      fontFamily: 'system-ui, sans-serif',
    })
    const group = tagObject(
      new this.fabric.Group([circle, label], {
        left: x - radius,
        top: y - radius,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      }),
      'counter',
    )
    this.configureObject(group)
    this.canvas.add(group)
    this.commitHistory()
  }

  private async createMosaic(
    left: number,
    top: number,
    width: number,
    height: number,
    blockSize: number,
  ): Promise<FabricImage | null> {
    const element = this.renderMosaicElement(left, top, width, height, blockSize)
    if (!element) return null
    const image = tagObject(
      new this.fabric.FabricImage(element, {
        left,
        top,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        objectCaching: false,
      }),
      'mosaic',
    )
    image.mosaicBlockSize = blockSize
    image.mosaicMode = 'rect'
    this.configureObject(image)
    return image
  }

  private async createMosaicBrush(path: FabricObject): Promise<FabricImage | null> {
    const bounds = path.getBoundingRect()
    const width = Math.max(1, Math.ceil(bounds.width))
    const height = Math.max(1, Math.ceil(bounds.height))
    const left = Math.floor(bounds.left)
    const top = Math.floor(bounds.top)
    const blockSize = Math.max(10, this.strokeWidth * 4)
    const output = this.renderMosaicElement(left, top, width, height, blockSize)
    if (!output) return null
    const mask = path.toCanvasElement({ multiplier: 1 })
    this.applyMosaicMask(output, mask)
    const image = tagObject(
      new this.fabric.FabricImage(output, {
        left,
        top,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        objectCaching: false,
      }),
      'mosaic',
    )
    image.mosaicBlockSize = blockSize
    image.mosaicMode = 'brush'
    image.mosaicMaskDataUrl = mask.toDataURL('image/png')
    this.configureObject(image)
    return image
  }

  private applyMosaicMask(output: HTMLCanvasElement, mask: CanvasImageSource): void {
    const context = output.getContext('2d')
    if (!context) return
    context.save()
    context.globalCompositeOperation = 'destination-in'
    context.imageSmoothingEnabled = true
    context.drawImage(mask, 0, 0, output.width, output.height)
    context.restore()
  }

  private loadMaskImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('马赛克笔刷遮罩加载失败'))
      image.src = dataUrl
    })
  }

  private renderMosaicElement(
    left: number,
    top: number,
    width: number,
    height: number,
    blockSize: number,
  ): HTMLCanvasElement | null {
    const source = this.sourceImage
    const sourceElement = source?.getElement()
    if (!source || !sourceElement) return null
    const outputWidth = Math.max(1, Math.round(width))
    const outputHeight = Math.max(1, Math.round(height))
    const sampleWidth = Math.max(1, Math.ceil(outputWidth / Math.max(4, blockSize)))
    const sampleHeight = Math.max(1, Math.ceil(outputHeight / Math.max(4, blockSize)))
    const sample = document.createElement('canvas')
    sample.width = sampleWidth
    sample.height = sampleHeight
    const sampleContext = sample.getContext('2d')
    if (!sampleContext) return null
    sampleContext.fillStyle = '#ffffff'
    sampleContext.fillRect(0, 0, sampleWidth, sampleHeight)

    const scaleX = source.scaleX || 1
    const scaleY = source.scaleY || 1
    const rawX = (left - source.left) / scaleX + source.cropX
    const rawY = (top - source.top) / scaleY + source.cropY
    const rawWidth = outputWidth / scaleX
    const rawHeight = outputHeight / scaleY
    const sourceSize = source.getOriginalSize()
    const sourceX = Math.max(0, rawX)
    const sourceY = Math.max(0, rawY)
    const sourceRight = Math.min(sourceSize.width, rawX + rawWidth)
    const sourceBottom = Math.min(sourceSize.height, rawY + rawHeight)
    if (sourceRight > sourceX && sourceBottom > sourceY) {
      const destinationX = ((sourceX - rawX) / rawWidth) * sampleWidth
      const destinationY = ((sourceY - rawY) / rawHeight) * sampleHeight
      const destinationWidth = ((sourceRight - sourceX) / rawWidth) * sampleWidth
      const destinationHeight = ((sourceBottom - sourceY) / rawHeight) * sampleHeight
      sampleContext.drawImage(
        sourceElement,
        sourceX,
        sourceY,
        sourceRight - sourceX,
        sourceBottom - sourceY,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      )
    }

    const output = document.createElement('canvas')
    output.width = outputWidth
    output.height = outputHeight
    const outputContext = output.getContext('2d')
    if (!outputContext) return null
    outputContext.imageSmoothingEnabled = false
    outputContext.drawImage(
      sample,
      0,
      0,
      sampleWidth,
      sampleHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    )
    return output
  }

  private async refreshMosaic(object: FabricImage): Promise<void> {
    const width = Math.max(1, object.getScaledWidth())
    const height = Math.max(1, object.getScaledHeight())
    const tagged = object as TaggedFabricObject
    const element = this.renderMosaicElement(
      object.left,
      object.top,
      width,
      height,
      tagged.mosaicBlockSize ?? 16,
    )
    if (!element) return
    if (tagged.mosaicMode === 'brush' && tagged.mosaicMaskDataUrl) {
      try {
        const mask = await this.loadMaskImage(tagged.mosaicMaskDataUrl)
        this.applyMosaicMask(element, mask)
      } catch {
        // 遮罩损坏时保留矩形马赛克内容，避免对象完全消失。
      }
    }
    object.setElement(element, { width: element.width, height: element.height })
    object.set({ scaleX: 1, scaleY: 1 })
    object.setCoords()
    this.canvas.requestRenderAll()
  }

  private configureObject(object: FabricObject): void {
    if (objectKind(object) === SOURCE_KIND) {
      object.set({
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        excludeFromExport: false,
      })
      return
    }
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
    object.set({
      borderColor: '#60a5fa',
      cornerColor: '#ffffff',
      cornerStrokeColor: '#2563eb',
      cornerStyle: 'circle',
      cornerSize: coarsePointer ? 18 : 12,
      transparentCorners: false,
      padding: coarsePointer ? 8 : 4,
      lockScalingFlip: true,
      lockRotation: objectKind(object) === 'mosaic',
    })
  }

  private configureAllObjects(): void {
    for (const object of this.canvas.getObjects()) this.configureObject(object)
  }

  private resolveNextCounter(): number {
    return this.canvas.getObjects().filter((object) => objectKind(object) === 'counter').length + 1
  }

  setTool(tool: AnnotationTool): void {
    this.tool = tool
    if (tool !== 'crop') this.cancelCrop()
    this.applyToolMode()
    this.emitViewState()
  }

  private applyToolMode(): void {
    const drawing =
      this.tool === 'pen' ||
      this.tool === 'highlight' ||
      (this.tool === 'mosaic' && this.mosaicMode === 'brush')
    this.canvas.isDrawingMode = drawing
    if (drawing) {
      const brush = new this.fabric.PencilBrush(this.canvas)
      brush.color = this.tool === 'mosaic' ? '#000000' : this.color
      brush.width =
        this.tool === 'highlight' || this.tool === 'mosaic'
          ? Math.max(12, this.strokeWidth * 4)
          : this.strokeWidth
      brush.decimate = 1.5
      this.canvas.freeDrawingBrush = brush
    }
    const selectable = this.tool === 'select'
    this.canvas.selection = selectable
    this.canvas.defaultCursor = this.tool === 'pan' ? 'grab' : selectable ? 'default' : 'crosshair'
    for (const object of this.canvas.getObjects()) {
      if (objectKind(object) === SOURCE_KIND) continue
      const crop = objectKind(object) === CROP_KIND
      object.set({ selectable: selectable || crop, evented: selectable || crop })
    }
    if (!selectable && this.tool !== 'crop') this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
  }

  setColor(color: string): void {
    this.color = color
    const active = this.canvas.getActiveObjects()
    if (active.length > 0) {
      for (const object of active) this.applyColor(object, color)
      this.canvas.requestRenderAll()
      this.commitHistory()
    }
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = this.tool === 'mosaic' ? '#000000' : color
    }
  }

  setMosaicMode(mode: AnnotationMosaicMode): void {
    this.mosaicMode = mode
    if (this.tool === 'mosaic') this.applyToolMode()
  }

  setTextBackground(style: AnnotationTextBackground): void {
    this.textBackground = style
    const backgroundColor = this.resolveTextBackgroundColor(style)
    const active = this.canvas.getActiveObjects().filter((object) => objectKind(object) === 'text')
    if (active.length === 0) return
    for (const object of active) object.set({ backgroundColor })
    this.canvas.requestRenderAll()
    this.commitHistory()
  }

  private resolveTextBackgroundColor(style: AnnotationTextBackground): string {
    if (style === 'dark') return 'rgba(15,23,42,0.78)'
    if (style === 'light') return 'rgba(255,255,255,0.92)'
    return ''
  }

  private applyColor(object: FabricObject, color: string): void {
    const kind = objectKind(object)
    if (kind === 'text') object.set({ fill: color })
    else if (kind === 'counter') {
      const circle = (object as Group).getObjects()[0]
      circle?.set({ fill: color })
    } else if (kind !== 'mosaic') object.set({ stroke: color })
  }

  setStrokeWidth(width: number): void {
    this.strokeWidth = width
    const active = this.canvas.getActiveObjects()
    if (active.length > 0) {
      for (const object of active) {
        if (objectKind(object) !== 'text' && objectKind(object) !== 'counter') {
          object.set({ strokeWidth: width })
        }
      }
      this.canvas.requestRenderAll()
      this.commitHistory()
    }
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width =
        this.tool === 'highlight' || this.tool === 'mosaic' ? Math.max(12, width * 4) : width
    }
  }

  setPadding(enabled: boolean, nextPadding: CanvasImageAnnotationPadding, commit = true): void {
    const previous = this.paddingEnabled ? this.padding : EMPTY_ANNOTATION_PADDING
    const normalized = enabled
      ? normalizeAnnotationPadding(nextPadding)
      : { ...EMPTY_ANNOTATION_PADDING }
    const translation = annotationPaddingTranslation(previous, normalized)
    if (translation.x !== 0 || translation.y !== 0) {
      for (const object of this.canvas.getObjects()) {
        object.set({ left: object.left + translation.x, top: object.top + translation.y })
        object.setCoords()
      }
    }
    this.paddingEnabled = enabled
    this.padding = normalized
    const size = annotationArtboardSize(this.contentWidth, this.contentHeight, normalized)
    this.canvas.setDimensions(size)
    this.canvas.backgroundColor = enabled ? '#ffffff' : ''
    this.canvas.requestRenderAll()
    if (commit) this.commitHistory()
    else this.emitViewState()
  }

  applyCrop(): void {
    const crop = this.pendingCrop
    if (!crop) return
    const left = Math.max(0, Math.round(crop.left))
    const top = Math.max(0, Math.round(crop.top))
    const width = Math.max(8, Math.min(this.canvas.width - left, Math.round(crop.getScaledWidth())))
    const height = Math.max(
      8,
      Math.min(this.canvas.height - top, Math.round(crop.getScaledHeight())),
    )
    this.canvas.remove(crop)
    this.pendingCrop = null
    for (const object of this.canvas.getObjects()) {
      object.set({ left: object.left - left, top: object.top - top })
      object.setCoords()
    }
    this.contentWidth = width
    this.contentHeight = height
    this.paddingEnabled = false
    this.padding = { ...EMPTY_ANNOTATION_PADDING }
    this.canvas.setDimensions({ width, height })
    this.canvas.backgroundColor = ''
    this.setTool('select')
    this.commitHistory()
  }

  cancelCrop(): void {
    if (!this.pendingCrop) return
    this.canvas.remove(this.pendingCrop)
    this.pendingCrop = null
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    this.emitViewState()
  }

  cancelCurrentAction(): boolean {
    const active = this.canvas.getActiveObject()
    if (active instanceof this.fabric.IText && active.isEditing) {
      active.exitEditing()
      this.canvas.requestRenderAll()
      return true
    }
    if (this.pendingCrop) {
      this.cancelCrop()
      return true
    }
    if (this.draftObject) {
      this.canvas.remove(this.draftObject)
      this.draftObject = null
      this.drawStart = null
      this.canvas.requestRenderAll()
      return true
    }
    return false
  }

  deleteSelection(): void {
    const active = this.canvas.getActiveObjects().filter(isEditableObject)
    if (active.length === 0) return
    this.canvas.discardActiveObject()
    for (const object of active) this.canvas.remove(object)
    this.canvas.requestRenderAll()
    this.commitHistory()
  }

  async duplicateSelection(): Promise<void> {
    const active = this.canvas.getActiveObjects().filter(isEditableObject)
    if (active.length === 0) return
    const clones = await Promise.all(active.map((object) => object.clone(SCENE_PROPERTIES)))
    this.canvas.discardActiveObject()
    for (const clone of clones) {
      clone.set({ left: clone.left + 16, top: clone.top + 16 })
      this.configureObject(clone)
      this.canvas.add(clone)
    }
    if (clones.length === 1 && clones[0]) this.canvas.setActiveObject(clones[0])
    this.canvas.requestRenderAll()
    this.commitHistory()
  }

  moveSelection(dx: number, dy: number): void {
    const active = this.canvas.getActiveObjects().filter(isEditableObject)
    if (active.length === 0) return
    for (const object of active) {
      object.set({ left: object.left + dx, top: object.top + dy })
      object.setCoords()
    }
    this.canvas.requestRenderAll()
    this.commitHistory()
  }

  private captureSnapshot(): EditorSnapshot {
    return {
      scene: this.canvas.toObject(SCENE_PROPERTIES),
      contentWidth: this.contentWidth,
      contentHeight: this.contentHeight,
      paddingEnabled: this.paddingEnabled,
      padding: { ...this.padding },
    }
  }

  private commitHistory(): void {
    if (this.restoring) return
    const snapshot = this.captureSnapshot()
    const base = this.history.slice(0, this.historyIndex + 1)
    base.push(snapshot)
    if (base.length > MAX_HISTORY) base.shift()
    this.history = base
    this.historyIndex = base.length - 1
    this.dirty = true
    this.revision += 1
    this.emitViewState()
  }

  async undo(): Promise<void> {
    if (this.historyIndex <= 0) return
    this.historyIndex -= 1
    const snapshot = this.history[this.historyIndex]
    if (snapshot) await this.restoreSnapshot(snapshot)
  }

  async redo(): Promise<void> {
    if (this.historyIndex >= this.history.length - 1) return
    this.historyIndex += 1
    const snapshot = this.history[this.historyIndex]
    if (snapshot) await this.restoreSnapshot(snapshot)
  }

  private async restoreSnapshot(snapshot: EditorSnapshot): Promise<void> {
    this.restoring = true
    try {
      this.contentWidth = snapshot.contentWidth
      this.contentHeight = snapshot.contentHeight
      this.paddingEnabled = snapshot.paddingEnabled
      this.padding = { ...snapshot.padding }
      const size = annotationArtboardSize(
        snapshot.contentWidth,
        snapshot.contentHeight,
        snapshot.padding,
      )
      this.canvas.setDimensions(size)
      this.canvas.backgroundColor = snapshot.paddingEnabled ? '#ffffff' : ''
      await this.canvas.loadFromJSON(snapshot.scene as Record<string, unknown>)
      this.sourceImage =
        (this.canvas.getObjects().find((object) => objectKind(object) === SOURCE_KIND) as
          | FabricImage
          | undefined) ?? null
      this.pendingCrop = null
      this.configureAllObjects()
      this.applyToolMode()
      this.canvas.requestRenderAll()
    } finally {
      this.restoring = false
      this.dirty = true
      this.revision += 1
      this.emitViewState()
    }
  }

  private emitViewState(): void {
    const active = this.canvas.getActiveObjects()
    this.options.onViewStateChange({
      width: this.canvas.width,
      height: this.canvas.height,
      paddingEnabled: this.paddingEnabled,
      padding: { ...this.padding },
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1,
      selectionCount: active.filter(isEditableObject).length,
      selectedKind: active.length === 1 ? objectKind(active[0]) : null,
      hasPendingCrop: this.pendingCrop != null,
      dirty: this.dirty,
      revision: this.revision,
    })
  }

  serializeDocument(options?: { prepareForExport?: boolean }): CanvasImageAnnotationDocument {
    if (options?.prepareForExport) {
      this.canvas.discardActiveObject()
      if (this.pendingCrop) this.cancelCrop()
    }
    this.canvas.requestRenderAll()
    const timestamp = new Date().toISOString()
    return {
      schemaVersion: 1,
      source: {
        nodeId: this.options.sourceNode.id,
        ...(this.options.sourceNode.assetId ? { assetId: this.options.sourceNode.assetId } : {}),
        url: this.options.sourceUrl,
        width: this.sourceImage?.getOriginalSize().width ?? this.contentWidth,
        height: this.sourceImage?.getOriginalSize().height ?? this.contentHeight,
      },
      artboard: {
        width: this.canvas.width,
        height: this.canvas.height,
        contentWidth: this.contentWidth,
        contentHeight: this.contentHeight,
        background: this.paddingEnabled ? '#ffffff' : null,
        padding: { ...this.padding },
      },
      scene: {
        engine: 'fabric',
        engineVersion: this.fabric.version,
        json: this.canvas.toObject(SCENE_PROPERTIES),
      },
      createdAt: this.createdAt,
      updatedAt: timestamp,
    }
  }

  exportResult(multiplier = 1): {
    dataUrl: string
    document: CanvasImageAnnotationDocument
    outputWidth: number
    outputHeight: number
  } {
    const safeMultiplier = Math.max(0.1, Math.min(1, multiplier))
    const document = this.serializeDocument({ prepareForExport: true })
    const dataUrl = this.canvas.toDataURL({ format: 'png', multiplier: safeMultiplier })
    return {
      dataUrl,
      document,
      outputWidth: Math.max(1, Math.round(this.canvas.width * safeMultiplier)),
      outputHeight: Math.max(1, Math.round(this.canvas.height * safeMultiplier)),
    }
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.canvas.upperCanvasEl
  }

  handlesKeyboardEvent(event: KeyboardEvent): boolean {
    if (isTextInputTarget(event.target)) return false
    const active = this.canvas.getActiveObject()
    return !(active instanceof this.fabric.IText && active.isEditing)
  }

  async dispose(): Promise<void> {
    await this.canvas.dispose()
  }
}
