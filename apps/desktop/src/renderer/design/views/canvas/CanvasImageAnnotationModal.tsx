/**
 * 画布图片标注弹窗 —— 矢量对象模型版
 *
 * 架构：
 *   - 每个标注是一个 Shape 对象（rect/ellipse/arrow/pen/mosaic/text/eraser）
 *   - 维护 shapes[] + 选中态，每帧 render() 重绘（底图 → shapes → 选中框/手柄）
 *   - 选中后支持整体拖动、8 手柄缩放、删除
 *   - 橡皮擦用离屏遮罩 canvas，最终烘熔时 destination-out 擦除背景
 *   - 完成时烘熔成 PNG 输出，对外接口零变更
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal, Tooltip, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import './CanvasImageAnnotationModal.less'

type Point = { x: number; y: number }
type DrawTool = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'eraser' | 'mosaic' | 'text' | 'crop'
type Tool = 'select' | 'pan' | DrawTool
type WidthKey = 'thin' | 'medium' | 'thick'
/** 手柄方位 */
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 笔画类 points 用归一化坐标(0~1 相对包围盒)，缩放时只改 w/h，描点按比例重算 */
type ShapeBase = {
  id: string
  color: string
  width: number
  /** 包围盒左上角 + 宽高（canvas 内部分辨率坐标） */
  x: number
  y: number
  w: number
  h: number
}
type Shape =
  | ({ type: 'rect' | 'ellipse' | 'arrow' } & ShapeBase)
  | ({ type: 'pen' | 'mosaic' | 'eraser'; points: Point[] } & ShapeBase)
  | ({ type: 'text'; text: string; fontSize: number } & ShapeBase)

type Interaction =
  | { mode: 'idle' }
  | { mode: 'draw'; shape: Shape; absPts?: Point[] } // 正在创建一个 shape；笔画类用 absPts 缓存绝对点
  | { mode: 'move'; start: Point; orig: Shape } // 拖动整体
  | { mode: 'resize'; handle: HandleId; start: Point; orig: Shape } // 手柄缩放

const DEFAULT_ANNOTATION_COLOR = '#ff4d4f'
const COLORS = [
  DEFAULT_ANNOTATION_COLOR,
  '#faad14',
  '#52c41a',
  '#1677ff',
  '#722ed1',
  '#111827',
  '#ffffff',
]
const WIDTH_OPTIONS: Array<{ key: WidthKey; label: string; value: number }> = [
  { key: 'thin', label: '细', value: 2 },
  { key: 'medium', label: '中', value: 4 },
  { key: 'thick', label: '粗', value: 8 },
]

const TOOL_ITEMS: Array<{ key: Tool; label: string; hotkey: string; icon: ReactNode }> = [
  {
    key: 'select',
    label: '选择 (V) · 拖动/缩放/删除',
    hotkey: 'V',
    icon: <Icons.MousePointer size={17} />,
  },
  { key: 'pan', label: '移动画布 (H)', hotkey: 'H', icon: <Icons.Hand size={17} /> },
  { key: 'rect', label: '矩形 (R)', hotkey: 'R', icon: <Icons.Square size={17} /> },
  { key: 'ellipse', label: '圆形 (O)', hotkey: 'O', icon: <Icons.Circle size={17} /> },
  { key: 'arrow', label: '箭头 (A)', hotkey: 'A', icon: <Icons.ArrowUpRight size={17} /> },
  { key: 'pen', label: '画笔 (P)', hotkey: 'P', icon: <Icons.Pencil size={17} /> },
  { key: 'text', label: '文字 (T) · 点击即输入', hotkey: 'T', icon: <Icons.Type size={17} /> },
  {
    key: 'mosaic',
    label: '马赛克 (M)',
    hotkey: 'M',
    icon: <span className="canvas-annotate-tool-glyph mosaic" />,
  },
  {
    key: 'eraser',
    label: '橡皮擦 (E) · 擦除为透明',
    hotkey: 'E',
    icon: <Icons.Eraser size={17} />,
  },
  { key: 'crop', label: '裁切 (C)', hotkey: 'C', icon: <Icons.Crop size={17} /> },
]

const FONT_STACK =
  '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", -apple-system, system-ui, sans-serif'
const HANDLE_SIZE = 9 // canvas 像素
const HANDLE_HIT = 14 // 命中判定半径(canvas 像素)
let shapeIdSeq = 0
const nextId = () => `s${++shapeIdSeq}`

/** DOM 坐标 → canvas 内部分辨率坐标 */
function canvasPoint(
  event: React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): Point {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** 判断颜色是否偏浅（白色等），用于决定文字是否需要描边提升对比度。支持 #hex 与 rgb()。 */
function isLightColor(color: string): boolean {
  const c = color.trim()
  let r: number
  let g: number
  let b: number
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((x) => x + x)
            .join('')
        : hex
    r = parseInt(full.slice(0, 2), 16)
    g = parseInt(full.slice(2, 4), 16)
    b = parseInt(full.slice(4, 6), 16)
  } else {
    const m = c.match(/(\d+(\.\d+)?)/g)
    if (!m) return false
    r = parseFloat(m[0] ?? '0')
    g = parseFloat(m[1] ?? '0')
    b = parseFloat(m[2] ?? '0')
  }
  if ([r, g, b].some(Number.isNaN)) return false
  // 感知亮度（标准公式），> 0.75 视为浅色
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.75
}

/** 计算点到线段(p1-p2)的最近距离 */
function distToSegment(p: Point, p1: Point, p2: Point): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - p1.x, p.y - p1.y)
  let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2
  t = clamp(t, 0, 1)
  return Math.hypot(p.x - (p1.x + t * dx), p.y - (p1.y + t * dy))
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, lineWidth: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const headLength = Math.max(12, lineWidth * 4)
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - headLength * Math.cos(angle - Math.PI / 6),
    to.y - headLength * Math.sin(angle - Math.PI / 6),
  )
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - headLength * Math.cos(angle + Math.PI / 6),
    to.y - headLength * Math.sin(angle + Math.PI / 6),
  )
  ctx.stroke()
}

/** 把归一化 points(0~1) 按 shape 包围盒还原为 canvas 绝对坐标 */
function absPoints(shape: {
  x: number
  y: number
  w: number
  h: number
  points: Point[]
}): Point[] {
  return shape.points.map((p) => ({ x: shape.x + p.x * shape.w, y: shape.y + p.y * shape.h }))
}

/** 单点马赛克 */
function mosaicBlock(
  ctx: CanvasRenderingContext2D,
  bg: CanvasImageSource,
  bgW: number,
  bgH: number,
  point: Point,
  size: number,
) {
  const x = clamp(Math.round(point.x - size / 2), 0, bgW)
  const y = clamp(Math.round(point.y - size / 2), 0, bgH)
  const w = Math.min(size, bgW - x)
  const h = Math.min(size, bgH - y)
  if (w <= 0 || h <= 0) return
  // 从背景图取一小块放大模糊：先画到小尺寸再放大回去
  const tmp = document.createElement('canvas')
  const sw = Math.max(2, Math.round(w / 6))
  const sh = Math.max(2, Math.round(h / 6))
  tmp.width = sw
  tmp.height = sh
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.imageSmoothingEnabled = true
  tctx.drawImage(bg, x, y, w, h, 0, 0, sw, sh)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
  ctx.imageSmoothingEnabled = true
}

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
/** 手柄在包围盒上的归一化锚点(0~1) */
const HANDLE_ANCHOR: Record<HandleId, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

/** 笔画类 shape 的通用几何外壳（draw 期或归一化后通用） */
type StrokeShell = { x: number; y: number; w: number; h: number; points: Point[] }

// ---- 模块级绘图函数（纯函数，不依赖组件 state） ----

/** 绘制单个 shape */
function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  bg: CanvasImageSource | null,
  bgW: number,
  bgH: number,
) {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.type === 'rect') {
    ctx.strokeRect(s.x, s.y, s.w, s.h)
  } else if (s.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      s.x + s.w / 2,
      s.y + s.h / 2,
      Math.abs(s.w / 2),
      Math.abs(s.h / 2),
      0,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
  } else if (s.type === 'arrow') {
    drawArrow(ctx, { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, s.width)
  } else if (s.type === 'text') {
    ctx.font = `${s.fontSize}px ${FONT_STACK}`
    ctx.textBaseline = 'top'
    // 仅浅色文字（白色等）在图片上对比度不足时描边；深色文字只填充，保持正常字重，不显粗
    const isLight = isLightColor(s.color)
    if (isLight) {
      ctx.lineWidth = Math.max(2, s.fontSize / 12)
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.strokeText(s.text, s.x, s.y)
    }
    ctx.fillText(s.text, s.x, s.y)
  } else if (s.type === 'pen') {
    drawStroke(ctx, s, s.width)
  } else if (s.type === 'mosaic') {
    if (bg) {
      const pts = absPoints(s)
      const size = Math.max(10, s.width * 4)
      for (const p of pts) mosaicBlock(ctx, bg, bgW, bgH, p, size)
    }
  }
  ctx.restore()
}

/** 绘制笔画（pen）：单点画圆，多点折线 */
function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeShell, lw: number) {
  const pts = absPoints(s)
  const first = pts[0]
  if (pts.length === 1 && first) {
    ctx.beginPath()
    ctx.arc(first.x, first.y, lw / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i]
    if (pt) ctx.lineTo(pt.x, pt.y)
  }
  ctx.stroke()
}

/** 橡皮擦：在轨迹上用 destination-out 擦成透明 */
function drawEraser(ctx: CanvasRenderingContext2D, s: StrokeShell, lw: number) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.strokeStyle = 'rgba(0,0,0,1)'
  ctx.lineWidth = Math.max(12, lw * 3)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  drawStroke(ctx, s, ctx.lineWidth)
  ctx.restore()
}

/** 选中框 + 8 手柄 */
function drawSelection(ctx: CanvasRenderingContext2D, s: Shape, primary: string) {
  const nx = Math.min(s.x, s.x + s.w)
  const ny = Math.min(s.y, s.y + s.h)
  const nw = Math.abs(s.w)
  const nh = Math.abs(s.h)
  ctx.save()
  ctx.strokeStyle = primary
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.5
  ctx.strokeRect(nx - 1, ny - 1, nw + 2, nh + 2)
  ctx.setLineDash([])
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = primary
  ctx.lineWidth = 1.5
  for (const h of HANDLES) {
    const a = HANDLE_ANCHOR[h]
    const hx = nx + a.x * nw
    const hy = ny + a.y * nh
    ctx.beginPath()
    ctx.rect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// ---- 模块级命中检测 ----

/** 点是否命中某个 shape */
function hitShape(p: Point, s: Shape): boolean {
  const nx = Math.min(s.x, s.x + s.w)
  const ny = Math.min(s.y, s.y + s.h)
  const nw = Math.abs(s.w)
  const nh = Math.abs(s.h)
  if (s.type === 'pen' || s.type === 'mosaic' || s.type === 'eraser') {
    const pts = absPoints(s)
    const thresh = Math.max(8, s.width * 2)
    const first = pts[0]
    if (
      p.x < nx - thresh ||
      p.x > nx + nw + thresh ||
      p.y < ny - thresh ||
      p.y > ny + nh + thresh
    ) {
      if (pts.length === 1 && first) return Math.hypot(p.x - first.x, p.y - first.y) <= thresh
      return false
    }
    if (pts.length === 1 && first) return Math.hypot(p.x - first.x, p.y - first.y) <= thresh
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a && b && distToSegment(p, a, b) <= thresh) return true
    }
    return false
  }
  // 矩形/椭圆/箭头/文字：包围盒判定
  const pad = Math.max(6, s.width)
  return p.x >= nx - pad && p.x <= nx + nw + pad && p.y >= ny - pad && p.y <= ny + nh + pad
}

/** 点是否命中选中对象的手柄 */
function hitHandle(p: Point, s: Shape): HandleId | null {
  const nx = Math.min(s.x, s.x + s.w)
  const ny = Math.min(s.y, s.y + s.h)
  const nw = Math.abs(s.w)
  const nh = Math.abs(s.h)
  for (const h of HANDLES) {
    const a = HANDLE_ANCHOR[h]
    const hx = nx + a.x * nw
    const hy = ny + a.y * nh
    if (Math.abs(p.x - hx) <= HANDLE_HIT && Math.abs(p.y - hy) <= HANDLE_HIT) return h
  }
  return null
}

/** 手柄缩放：返回新 shape 或 null（尺寸过小时） */
function resizeShape(orig: Shape, handle: HandleId, p: Point): Shape | null {
  const nx = Math.min(orig.x, orig.x + orig.w)
  const ny = Math.min(orig.y, orig.y + orig.h)
  let nw = Math.abs(orig.w)
  let nh = Math.abs(orig.h)
  let x0 = nx
  let y0 = ny
  const a = HANDLE_ANCHOR[handle]
  if (a.x === 0) {
    nw = nx + nw - p.x
    x0 = p.x
  } else if (a.x === 1) {
    nw = p.x - nx
  }
  if (a.y === 0) {
    nh = ny + nh - p.y
    y0 = p.y
  } else if (a.y === 1) {
    nh = p.y - ny
  }
  if (nw < 4 || nh < 4) return null
  return { ...orig, x: x0, y: y0, w: nw, h: nh }
}

export function CanvasImageAnnotationModal({
  open,
  node,
  onCancel,
  onComplete,
}: {
  open: boolean
  node: CanvasNode | null
  onCancel: () => void
  onComplete: (input: {
    dataUrl: string
    width: number
    height: number
    sourceNode: CanvasNode
  }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** 背景图（原图） */
  const bgRef = useRef<HTMLImageElement | null>(null)
  const interactionRef = useRef<Interaction>({ mode: 'idle' })
  const panInteractionRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    originX: number
    originY: number
  } | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState<string>(DEFAULT_ANNOTATION_COLOR)
  const [widthKey, setWidthKey] = useState<WidthKey>('medium')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<Shape[][]>([[]])
  const [cursor, setCursor] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [readySrc, setReadySrc] = useState<string | null>(null)
  /** 文字浮层 */
  const [textEditing, setTextEditing] = useState(false)
  const [textAnchor, setTextAnchor] = useState<Point | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  /** 强制重绘 tick（交互中频繁更新 shapes 时用 ref 触发 render） */
  const [, setRenderTick] = useState(0)
  const bumpRender = useCallback(() => setRenderTick((n) => n + 1), [])

  const src = useMemo(
    () => normalizeEduAssetUrl(node?.data.thumbnailUrl ?? node?.data.url ?? ''),
    [node],
  )
  const strokeWidth = WIDTH_OPTIONS.find((w) => w.key === widthKey)?.value ?? 4
  const selectedShape = useMemo(
    () => shapes.find((s) => s.id === selectedId) ?? null,
    [shapes, selectedId],
  )
  const canUndo = cursor > 0
  const canRedo = cursor >= 0 && cursor < history.length - 1
  const hasUnsavedChanges = cursor > 0 || shapes.length > 0 || textDraft.trim().length > 0

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(clamp(nextZoom, 0.25, 4))
  }, [])

  /** 把当前 shapes 记为新历史节点：截断 cursor 之后并 push */
  const commit = useCallback(
    (next: Shape[], selectId: string | null = null) => {
      setShapes(next)
      setSelectedId(selectId)
      setHistory((items) => {
        const base = cursor >= 0 ? items.slice(0, cursor + 1) : []
        const updated = [...base, next]
        setCursor(updated.length - 1)
        return updated
      })
    },
    [cursor],
  )

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const bg = bgRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // 1. 底图
    if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)
    // 2. shapes（橡皮擦单独处理：用 destination-out 擦除）
    const primary =
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#6366f1'
    for (const s of shapes) {
      if (s.type === 'eraser') {
        drawEraser(ctx, s, strokeWidth)
        continue
      }
      drawShape(ctx, s, bg, canvas.width, canvas.height)
    }
    // 3. 选中框 + 手柄
    if (selectedShape) {
      drawSelection(ctx, selectedShape, primary)
    }
    bumpRender()
  }, [shapes, selectedShape, strokeWidth, bumpRender])

  /** 烘熔（无选中框/手柄），返回 dataUrl */
  const bake = useCallback((): string | null => {
    const canvas = canvasRef.current
    const bg = bgRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return null
    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const octx = out.getContext('2d')
    if (!octx) return null
    if (bg) octx.drawImage(bg, 0, 0, out.width, out.height)
    for (const s of shapes) {
      if (s.type === 'eraser') {
        drawEraser(octx, s, strokeWidth)
        continue
      }
      drawShape(octx, s, bg, out.width, out.height)
    }
    return out.toDataURL('image/png')
  }, [shapes, strokeWidth])

  // 图片加载
  useEffect(() => {
    if (!open || !src) return
    setStatus('loading')
    setReadySrc(null)
    setShapes([])
    setSelectedId(null)
    setHistory([[]])
    setCursor(0)
    resetView()
    setMinimized(false)
    setTextEditing(false)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      bgRef.current = image
      setStatus('idle')
      setReadySrc(src)
    }
    image.onerror = () => {
      setStatus('error')
      message.error('图片加载失败，无法标注')
    }
    image.src = src
  }, [open, resetView, src])

  // 画布尺寸/状态变化时重绘
  useEffect(() => {
    render()
  }, [render, readySrc, status])

  /** 点击命中：从顶层到底层找第一个命中的 shape */
  const pickShape = useCallback(
    (p: Point): Shape | null => {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]
        if (s && hitShape(p, s)) return s
      }
      return null
    },
    [shapes],
  )

  // ---- 指针交互 ----
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || readySrc !== src || status !== 'idle') return

      if (tool === 'pan') {
        panInteractionRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          originX: pan.x,
          originY: pan.y,
        }
        setIsPanning(true)
        canvas.setPointerCapture(event.pointerId)
        return
      }
      const p = canvasPoint(event, canvas)

      // 文字工具：点击即输入
      if (tool === 'text') {
        setTextAnchor(p)
        setTextDraft('')
        setTextEditing(true)
        return
      }

      // 选择工具：先判手柄，再判对象，再判空白
      if (tool === 'select') {
        if (selectedShape) {
          const h = hitHandle(p, selectedShape)
          if (h) {
            interactionRef.current = {
              mode: 'resize',
              handle: h,
              start: p,
              orig: { ...selectedShape },
            }
            canvas.setPointerCapture(event.pointerId)
            return
          }
        }
        const hit = pickShape(p)
        if (hit) {
          setSelectedId(hit.id)
          interactionRef.current = { mode: 'move', start: p, orig: { ...hit } }
          canvas.setPointerCapture(event.pointerId)
        } else {
          setSelectedId(null)
        }
        return
      }

      // 裁切：用矩形选区临时交互，up 时执行像素裁切
      if (tool === 'crop') {
        const shape: Shape = {
          id: nextId(),
          type: 'rect',
          color: DEFAULT_ANNOTATION_COLOR,
          width: 1,
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
        }
        interactionRef.current = { mode: 'draw', shape }
        canvas.setPointerCapture(event.pointerId)
        return
      }

      // 绘制工具：创建临时对象
      const id = nextId()
      let shape: Shape
      const base = { id, color, width: strokeWidth, x: p.x, y: p.y, w: 0, h: 0 }
      if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow') {
        shape = { type: tool, ...base }
      } else {
        // pen / mosaic / eraser：points 始终存归一化坐标；absPts 缓存绝对点供 appendDrawStroke 重算
        shape = { type: tool, ...base, points: [{ x: 0.5, y: 0.5 }] }
      }
      interactionRef.current = { mode: 'draw', shape, absPts: [p] }
      canvas.setPointerCapture(event.pointerId)
    },
    [color, pan.x, pan.y, pickShape, readySrc, selectedShape, src, status, strokeWidth, tool],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const panInteraction = panInteractionRef.current
    if (panInteraction?.pointerId === event.pointerId) {
      setPan({
        x: panInteraction.originX + event.clientX - panInteraction.clientX,
        y: panInteraction.originY + event.clientY - panInteraction.clientY,
      })
      return
    }
    const inter = interactionRef.current
    if (inter.mode === 'idle') return
    const p = canvasPoint(event, canvas)

    if (inter.mode === 'draw') {
      const s = inter.shape
      if (s.type === 'pen' || s.type === 'mosaic' || s.type === 'eraser') {
        appendDrawStroke(s, inter.absPts ?? [p], p)
        setShapes((prev) => mergeDrawTemp(prev, s))
      } else {
        s.w = p.x - s.x
        s.h = p.y - s.y
        setShapes((prev) => mergeDrawTemp(prev, s))
      }
      return
    }

    if (inter.mode === 'move') {
      const dx = p.x - inter.start.x
      const dy = p.y - inter.start.y
      const moved = { ...inter.orig, x: inter.orig.x + dx, y: inter.orig.y + dy } as Shape
      setShapes((prev) => replaceShape(prev, moved))
      return
    }

    if (inter.mode === 'resize') {
      const resized = resizeShape(inter.orig, inter.handle, p)
      if (resized) setShapes((prev) => replaceShape(prev, resized))
      return
    }
  }, [])

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const panInteraction = panInteractionRef.current
      if (panInteraction?.pointerId === event.pointerId) {
        panInteractionRef.current = null
        setIsPanning(false)
        if (canvas?.hasPointerCapture(event.pointerId))
          canvas.releasePointerCapture(event.pointerId)
        return
      }
      const inter = interactionRef.current
      if (!canvas || inter.mode === 'idle') return
      interactionRef.current = { mode: 'idle' }

      if (inter.mode === 'draw') {
        const s = inter.shape
        // 笔画类现在始终以归一化坐标存储，无需 up 时转换
        // 裁切特殊处理
        if (tool === 'crop' && s.type === 'rect') {
          applyCrop(s)
          return
        }
        // 过滤掉太小的形状（点击没拖动）：笔画类无论大小都保留（哪怕单点），
        // 几何类（矩形/圆/箭头）尺寸过小则丢弃
        const minSize = 3
        const isStroke = s.type === 'pen' || s.type === 'mosaic' || s.type === 'eraser'
        const tooSmall = !isStroke && Math.abs(s.w) < minSize && Math.abs(s.h) < minSize
        if (tooSmall) {
          setShapes((prev) => prev.filter((x) => x.id !== s.id))
          return
        }
        commit(shapesRef.current, s.id)
        // 几何工具（矩形/圆/箭头）画完后自动切到选择工具，保持选中 → 立即可拖动/缩放/删除。
        // 画笔/马赛克/橡皮擦为连续涂抹工具，保持原工具更自然。
        if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'arrow') {
          setTool('select')
        }
        return
      }

      if (inter.mode === 'move' || inter.mode === 'resize') {
        // 交互结束提交历史
        commit(shapesRef.current, selectedIdRef.current)
        return
      }
    },
    [tool, commit],
  )

  // shapes/selectedId 的 ref，供 pointer 回调读取最新值
  const shapesRef = useRef<Shape[]>([])
  shapesRef.current = shapes
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  // ---- 笔画辅助 ----
  /**
   * 追加一个绝对点到笔画，并重算包围盒 + 归一化所有点写入 s.points。
   * 这样 render 始终走归一化路径（absPoints），draw 期与完成后表现一致。
   * absPts 缓存绝对点序列；包围盒退化为单点时 w/h 至少 1，避免除零。
   */
  function appendDrawStroke(s: Shape, absPts: Point[], p: Point) {
    if (s.type !== 'pen' && s.type !== 'mosaic' && s.type !== 'eraser') return
    absPts.push(p)
    const xs = absPts.map((q) => q.x)
    const ys = absPts.map((q) => q.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    s.x = minX
    s.y = minY
    s.w = w
    s.h = h
    s.points = absPts.map((q) => ({ x: (q.x - minX) / w, y: (q.y - minY) / h }))
  }

  /** 把 draw 期临时 shape 合并进 shapes（替换同 id，不存在则追加） */
  function mergeDrawTemp(prev: Shape[], s: Shape): Shape[] {
    const idx = prev.findIndex((x) => x.id === s.id)
    if (idx >= 0) {
      const next = prev.slice()
      next[idx] = { ...s }
      return next
    }
    return [...prev, { ...s }]
  }

  function replaceShape(prev: Shape[], s: Shape): Shape[] {
    return prev.map((x) => (x.id === s.id ? { ...s } : x))
  }

  // ---- 裁切（像素操作：改 canvas 尺寸 + 重缓存底图） ----
  function applyCrop(s: Shape) {
    if (s.type !== 'rect') return
    const canvas = canvasRef.current
    const bg = bgRef.current
    if (!canvas || !bg) return
    const cx = Math.round(Math.min(s.x, s.x + s.w))
    const cy = Math.round(Math.min(s.y, s.y + s.h))
    const cw = Math.round(Math.abs(s.w))
    const ch = Math.round(Math.abs(s.h))
    if (cw < 8 || ch < 8) return
    // 烘熔当前画布到临时图，裁出区域作为新底图
    const tmp = document.createElement('canvas')
    tmp.width = canvas.width
    tmp.height = canvas.height
    const tctx = tmp.getContext('2d')
    if (!tctx) return
    if (bg) tctx.drawImage(bg, 0, 0)
    const region = tctx.getImageData(cx, cy, cw, ch)
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(region, 0, 0)
    // 新底图 = 当前 canvas 内容
    const newBg = new Image()
    newBg.onload = () => {
      bgRef.current = newBg
      commit([], null)
    }
    newBg.src = canvas.toDataURL('image/png')
  }

  // ---- 历史：撤销/重做/重置 ----
  const undo = useCallback(() => {
    if (!canUndo) return
    const target = cursor - 1
    const snap = history[target]
    if (!snap) return
    setCursor(target)
    setShapes(snap)
    setSelectedId(null)
  }, [canUndo, cursor, history])

  const redo = useCallback(() => {
    if (!canRedo) return
    const target = cursor + 1
    const snap = history[target]
    if (!snap) return
    setCursor(target)
    setShapes(snap)
    setSelectedId(null)
  }, [canRedo, cursor, history])

  const resetOriginal = useCallback(() => {
    setCursor(0)
    setShapes([])
    setSelectedId(null)
  }, [])

  // 删除选中
  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    commit(
      shapes.filter((s) => s.id !== selectedId),
      null,
    )
  }, [commit, selectedId, shapes])

  const complete = useCallback(() => {
    const dataUrl = bake()
    const canvas = canvasRef.current
    if (!dataUrl || !canvas || !node) return
    onComplete({ dataUrl, width: canvas.width, height: canvas.height, sourceNode: node })
  }, [bake, node, onComplete])

  const requestClose = useCallback(() => {
    if (!hasUnsavedChanges) {
      onCancel()
      return
    }
    Modal.confirm({
      title: '退出图片标注？',
      content: '当前有未保存的标注，退出后这些修改会丢失。',
      okText: '放弃并退出',
      cancelText: '继续标注',
      okButtonProps: { danger: true },
      onOk: onCancel,
    })
  }, [hasUnsavedChanges, onCancel])

  // 提交文字浮层 → 生成 text 对象
  const commitText = useCallback(() => {
    const anchor = textAnchor
    setTextEditing(false)
    const text = textDraft.trim()
    if (!anchor || !text) {
      setTextDraft('')
      return
    }
    // 文字字号与粗细档位解耦：用固定基准字号（28px），避免粗档位把字撑得过大过粗
    const fontSize = 28
    // 估算文字包围盒
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    let tw = fontSize * text.length * 0.6
    let th = fontSize * 1.3
    if (ctx) {
      ctx.save()
      ctx.font = `${fontSize}px ${FONT_STACK}`
      tw = ctx.measureText(text).width
      th = fontSize * 1.3
      ctx.restore()
    }
    const shape: Shape = {
      id: nextId(),
      type: 'text',
      color,
      width: strokeWidth,
      text,
      fontSize,
      x: anchor.x,
      y: anchor.y,
      w: tw,
      h: th,
    }
    commit([...shapesRef.current, shape], shape.id)
    setTextDraft('')
    setTool('select')
  }, [color, commit, strokeWidth, textAnchor, textDraft])

  // 文字浮层打开时聚焦
  useEffect(() => {
    if (textEditing) requestAnimationFrame(() => textAreaRef.current?.focus())
  }, [textEditing])

  // 键盘快捷键
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        complete()
        return
      }
      if (e.key === 'Escape') {
        if (textEditing) {
          setTextEditing(false)
          return
        }
        if (selectedId) {
          setSelectedId(null)
          return
        }
        if (tool !== 'select') {
          setTool('select')
          return
        }
        requestClose()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing) return
        if (selectedId) {
          e.preventDefault()
          deleteSelected()
        }
        return
      }
      if (typing || mod || e.altKey) return
      const found = TOOL_ITEMS.find((t) => t.hotkey.toLowerCase() === e.key.toLowerCase())
      if (found) {
        e.preventDefault()
        setTool(found.key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, undo, redo, complete, textEditing, selectedId, deleteSelected, requestClose, tool])

  // 光标样式
  const cursorClass = useMemo(() => {
    if (tool === 'select') return selectedShape ? 'is-select-hit' : 'is-select'
    if (tool === 'pan') return isPanning ? 'is-panning' : 'is-pan'
    if (tool === 'text') return 'is-text'
    return 'is-draw'
  }, [isPanning, tool, selectedShape])

  // 文字浮层定位
  const overlayStyle = useMemo<React.CSSProperties | null>(() => {
    const canvas = canvasRef.current
    const anchor = textAnchor
    if (!canvas || !anchor) return null
    return {
      left: (anchor.x / canvas.width) * canvas.clientWidth,
      top: (anchor.y / canvas.height) * canvas.clientHeight,
    }
  }, [textAnchor, textEditing])

  return (
    <>
      <Modal
        open={open && !minimized}
        footer={null}
        onCancel={requestClose}
        width="96vw"
        centered
        className="canvas-image-annotation-modal"
        wrapClassName="canvas-image-annotation-wrap"
        destroyOnHidden={false}
      >
        <div className="canvas-annotate-shell">
          {/* 顶部工具栏 */}
          <div className="canvas-annotate-toolbar">
            <div className="canvas-annotate-tool-group">
              {TOOL_ITEMS.map((item) => (
                <Tooltip title={item.label} key={item.key}>
                  <button
                    type="button"
                    className={`canvas-annotate-tool${tool === item.key ? ' active' : ''}`}
                    onClick={() => setTool(item.key)}
                  >
                    {item.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
            <span className="canvas-annotate-divider" />
            <div className="canvas-annotate-colors">
              {COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`canvas-annotate-color${color === item ? ' active' : ''}`}
                  style={{ background: item }}
                  onClick={() => setColor(item)}
                />
              ))}
            </div>
            <span className="canvas-annotate-divider" />
            <div className="canvas-annotate-widths">
              {WIDTH_OPTIONS.map((item) => (
                <Tooltip title={`粗细：${item.label}`} key={item.key}>
                  <button
                    type="button"
                    className={`canvas-annotate-width${widthKey === item.key ? ' active' : ''}`}
                    onClick={() => setWidthKey(item.key)}
                  >
                    <span
                      className="canvas-annotate-width-dot"
                      style={{ width: item.value * 1.6, height: item.value * 1.6 }}
                    />
                  </button>
                </Tooltip>
              ))}
            </div>
            <span className="canvas-annotate-divider" />
            <div className="canvas-annotate-view-controls">
              <Tooltip title="缩小">
                <button
                  type="button"
                  className="canvas-annotate-tool"
                  onClick={() => updateZoom(zoom - 0.25)}
                >
                  <Icons.Minus size={17} />
                </button>
              </Tooltip>
              <button
                type="button"
                className="canvas-annotate-zoom-value"
                onClick={resetView}
                title="重置视图"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Tooltip title="放大">
                <button
                  type="button"
                  className="canvas-annotate-tool"
                  onClick={() => updateZoom(zoom + 0.25)}
                >
                  <Icons.Plus size={17} />
                </button>
              </Tooltip>
              <Tooltip title="重置视图">
                <button type="button" className="canvas-annotate-tool" onClick={resetView}>
                  <Icons.Maximize size={17} />
                </button>
              </Tooltip>
              <Tooltip title="暂时收起，返回画布查看">
                <button
                  type="button"
                  className="canvas-annotate-tool"
                  onClick={() => setMinimized(true)}
                >
                  <Icons.Minimize size={17} />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* 画布舞台 */}
          <div
            className="canvas-annotate-stage"
            onWheel={(event) => {
              event.preventDefault()
              updateZoom(zoom + (event.deltaY < 0 ? 0.15 : -0.15))
            }}
          >
            <div
              className={`canvas-annotate-canvas-wrap ${cursorClass}`}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
              {textEditing && overlayStyle && (
                <textarea
                  ref={textAreaRef}
                  className="canvas-annotate-text-overlay"
                  style={overlayStyle}
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onBlur={commitText}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      commitText()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setTextEditing(false)
                    }
                  }}
                  placeholder="输入文字…"
                  rows={1}
                />
              )}
            </div>
            {status === 'loading' && (
              <div className="canvas-annotate-status">
                <Icons.Spinner size={28} />
                <span>加载中…</span>
              </div>
            )}
            {status === 'error' && (
              <div className="canvas-annotate-status is-error">
                <Icons.Image size={40} />
                <span>图片加载失败，无法标注</span>
              </div>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="canvas-annotate-actions">
            <div className="canvas-annotate-actions-left">
              <button
                type="button"
                className="canvas-annotate-action"
                onClick={undo}
                disabled={!canUndo}
                title="撤销 (Cmd/Ctrl+Z)"
              >
                <Icons.Undo2 size={16} />
                <span>撤销</span>
              </button>
              <button
                type="button"
                className="canvas-annotate-action"
                onClick={redo}
                disabled={!canRedo}
                title="重做 (Cmd/Ctrl+Shift+Z)"
              >
                <Icons.Redo2 size={16} />
                <span>重做</span>
              </button>
              <button
                type="button"
                className="canvas-annotate-action"
                onClick={resetOriginal}
                title="清空所有标注"
              >
                <Icons.Refresh size={16} />
                <span>重置</span>
              </button>
              <button
                type="button"
                className="canvas-annotate-action"
                onClick={deleteSelected}
                disabled={!selectedId}
                title="删除选中 (Delete)"
              >
                <Icons.Trash size={16} />
                <span>删除</span>
              </button>
            </div>
            <div className="canvas-annotate-actions-right">
              <button
                type="button"
                className="canvas-annotate-action is-ghost"
                onClick={requestClose}
                title="取消 (Esc)"
              >
                取消
              </button>
              <button
                type="button"
                className="canvas-annotate-action is-primary"
                onClick={complete}
                disabled={readySrc !== src || status !== 'idle'}
                title="完成 (Cmd/Ctrl+Enter)"
              >
                <Icons.Check size={16} />
                <span>完成</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>
      {open && minimized && (
        <div className="canvas-annotate-minimized" role="status">
          <div>
            <strong>图片标注已暂时收起</strong>
            <span>{hasUnsavedChanges ? '修改尚未保存' : '可以随时继续'}</span>
          </div>
          <button type="button" onClick={() => setMinimized(false)}>
            <Icons.Edit size={15} /> 继续标注
          </button>
          <button type="button" className="is-close" onClick={requestClose} aria-label="退出标注">
            <Icons.X size={15} />
          </button>
        </div>
      )}
    </>
  )
}
