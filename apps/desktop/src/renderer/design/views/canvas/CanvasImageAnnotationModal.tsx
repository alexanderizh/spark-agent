import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Tooltip, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import './CanvasImageAnnotationModal.less'

type Tool = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text' | 'crop'
type Point = { x: number; y: number }

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
const TOOL_ITEMS: Array<{ key: Tool; label: string; icon: ReactNode }> = [
  { key: 'rect', label: '方框标注', icon: <span className="canvas-annotate-tool-glyph square" /> },
  {
    key: 'ellipse',
    label: '圆形标注',
    icon: <span className="canvas-annotate-tool-glyph circle" />,
  },
  {
    key: 'arrow',
    label: '箭头标注',
    icon: <span className="canvas-annotate-tool-glyph arrow">↗</span>,
  },
  { key: 'pen', label: '画笔自由标注', icon: <Icons.Edit size={16} /> },
  {
    key: 'mosaic',
    label: '马赛克笔',
    icon: <span className="canvas-annotate-tool-glyph mosaic" />,
  },
  {
    key: 'text',
    label: '文字标注',
    icon: <span className="canvas-annotate-tool-glyph text">T</span>,
  },
  { key: 'crop', label: '裁切', icon: <span className="canvas-annotate-tool-glyph crop">⌗</span> },
]

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

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const headLength = 18
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

function applyMosaic(ctx: CanvasRenderingContext2D, point: Point, size = 24) {
  const x = Math.max(0, Math.round(point.x - size / 2))
  const y = Math.max(0, Math.round(point.y - size / 2))
  const width = Math.min(size, ctx.canvas.width - x)
  const height = Math.min(size, ctx.canvas.height - y)
  if (width <= 0 || height <= 0) return
  const image = ctx.getImageData(x, y, width, height)
  let r = 0
  let g = 0
  let b = 0
  const pixels = image.data.length / 4
  for (let i = 0; i < image.data.length; i += 4) {
    r += image.data[i] ?? 0
    g += image.data[i + 1] ?? 0
    b += image.data[i + 2] ?? 0
  }
  ctx.fillStyle = `rgb(${Math.round(r / pixels)}, ${Math.round(g / pixels)}, ${Math.round(b / pixels)})`
  ctx.fillRect(x, y, width, height)
}

function restoreImage(canvas: HTMLCanvasElement, dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve()
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0)
      resolve()
    }
    image.src = dataUrl
  })
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
  const draftRef = useRef<string | null>(null)
  const drawingRef = useRef(false)
  const startRef = useRef<Point | null>(null)
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState<string>(DEFAULT_ANNOTATION_COLOR)
  const [history, setHistory] = useState<string[]>([])
  const [readySrc, setReadySrc] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('标注')
  const src = useMemo(
    () => normalizeEduAssetUrl(node?.data.thumbnailUrl ?? node?.data.url ?? ''),
    [node],
  )

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setHistory((items) => [...items.slice(-19), canvas.toDataURL('image/png')])
  }, [])

  useEffect(() => {
    if (!open || !src) return
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      ctx.drawImage(image, 0, 0)
      setHistory([canvas.toDataURL('image/png')])
      setReadySrc(src)
    }
    image.onerror = () => message.error('图片加载失败，无法标注')
    image.src = src
  }, [open, src])

  const drawPreview = useCallback(
    (current: Point) => {
      const canvas = canvasRef.current
      const start = startRef.current
      if (!canvas || !start || !draftRef.current) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      void restoreImage(canvas, draftRef.current).then(() => {
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.lineWidth = 4
        const x = Math.min(start.x, current.x)
        const y = Math.min(start.y, current.y)
        const width = Math.abs(current.x - start.x)
        const height = Math.abs(current.y - start.y)
        if (tool === 'rect' || tool === 'crop') ctx.strokeRect(x, y, width, height)
        if (tool === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (tool === 'arrow') drawArrow(ctx, start, current)
      })
    },
    [color, tool],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || readySrc !== src) return
      const point = canvasPoint(event, canvas)
      if (tool === 'text') {
        const text = textDraft.trim()
        if (!text) {
          message.warning('请先输入标注文字')
          return
        }
        pushHistory()
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = color
        ctx.font = '28px sans-serif'
        ctx.textBaseline = 'top'
        ctx.fillText(text, point.x, point.y)
        return
      }
      drawingRef.current = true
      startRef.current = point
      draftRef.current = canvas.toDataURL('image/png')
      pushHistory()
      canvas.setPointerCapture(event.pointerId)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = tool === 'pen' ? 4 : 1
      ctx.lineCap = 'round'
      if (tool === 'pen') {
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
      }
      if (tool === 'mosaic') applyMosaic(ctx, point)
    },
    [color, pushHistory, readySrc, src, textDraft, tool],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || !drawingRef.current) return
      const point = canvasPoint(event, canvas)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      if (tool === 'pen') {
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
        return
      }
      if (tool === 'mosaic') {
        applyMosaic(ctx, point)
        return
      }
      drawPreview(point)
    },
    [drawPreview, tool],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const start = startRef.current
      if (!canvas || !drawingRef.current || !start) return
      drawingRef.current = false
      const end = canvasPoint(event, canvas)
      if (tool === 'crop') {
        const x = Math.round(Math.min(start.x, end.x))
        const y = Math.round(Math.min(start.y, end.y))
        const width = Math.round(Math.abs(end.x - start.x))
        const height = Math.round(Math.abs(end.y - start.y))
        if (width > 8 && height > 8) {
          const ctx = canvas.getContext('2d')
          if (ctx && draftRef.current) {
            void restoreImage(canvas, draftRef.current).then(() => {
              const cropCtx = canvas.getContext('2d')
              const image = cropCtx?.getImageData(x, y, width, height)
              if (!cropCtx || !image) return
              canvas.width = width
              canvas.height = height
              cropCtx.putImageData(image, 0, 0)
            })
          }
        }
      }
      draftRef.current = null
      startRef.current = null
    },
    [tool],
  )

  const undo = useCallback(() => {
    const previous = history[history.length - 1]
    const canvas = canvasRef.current
    if (!previous || !canvas) return
    setHistory((items) => items.slice(0, -1))
    void restoreImage(canvas, previous)
  }, [history])

  const complete = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !node) return
    onComplete({
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      sourceNode: node,
    })
  }, [node, onComplete])

  return (
    <Modal
      open={open}
      footer={null}
      onCancel={onCancel}
      width="96vw"
      centered
      className="canvas-image-annotation-modal"
      destroyOnClose
    >
      <div className="canvas-annotate-shell">
        <div className="canvas-annotate-toolbar">
          {TOOL_ITEMS.map((item) => (
            <Tooltip title={item.label} key={item.key}>
              <button
                type="button"
                className={tool === item.key ? 'active' : ''}
                onClick={() => setTool(item.key)}
              >
                {item.icon}
              </button>
            </Tooltip>
          ))}
          <span className="canvas-annotate-divider" />
          {tool === 'text' && (
            <Input
              className="canvas-annotate-text-input"
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              placeholder="输入标注文字"
              size="small"
            />
          )}
          {COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={`color${color === item ? ' active' : ''}`}
              style={{ background: item }}
              onClick={() => setColor(item)}
            />
          ))}
          <span className="canvas-annotate-spacer" />
          <Button
            onClick={undo}
            disabled={history.length <= 1}
            icon={<Icons.RotateCcw size={15} />}
          >
            撤回
          </Button>
          <Button type="primary" onClick={complete} disabled={readySrc !== src}>
            完成
          </Button>
        </div>
        <div className="canvas-annotate-stage">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
      </div>
    </Modal>
  )
}
