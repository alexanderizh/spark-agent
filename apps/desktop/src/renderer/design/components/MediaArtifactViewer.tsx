/**
 * MediaArtifactViewer — 产物查看公用组件（内容区大图舞台 + 工具栏）
 *
 * 行为：
 *   - 图片尽量铺满舞台（object-fit: contain），工具栏 +/-/百分比/适屏 缩放，
 *     鼠标滚轮以光标为锚点缩放，按住拖拽平移查看局部，双击在适屏 / 放大间切换
 *   - 传入 inputImage 时提供「输入 / 输出对比」开关：左输入图、右输出图；
 *     没有参考图时不渲染对比入口
 *   - 工具栏：翻页（可选插槽，跨任务/跨集合时可用 label 说明当前项归属）、对比、复制、下载、打开产物所在文件夹
 *   - 键盘 ←/→ 翻页（与工具栏翻页同一回调，可用 keyboardPaging 关闭）
 *   - 键盘 ↑/↓ 缩放（与工具栏 +/- 同一档位，可用 keyboardZoom 关闭）
 *   - 下载目录记忆：保存成功后记住所选目录，下次保存直接落在该目录
 *   - 舞台右键菜单：内置图片 / 视频动作（复制、另存为、所在文件夹、大图），
 *     调用方可用 contextMenuExtraItems 追加自己的动作（如「删除这条任务」）
 *   - 视频产物回退为原生播放器，不提供缩放
 *
 * 该组件不感知任务概念，可被输出面板、详情弹层等任何产物展示场景复用。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Icons } from '../Icons'
import { useArrowPaging } from '../hooks/useArrowPaging'
import { useArrowZoom } from '../hooks/useArrowZoom'
import { ContextMenu } from './ContextMenu'
import { useContextMenu, type ContextMenuEntry } from './contextMenuModel'
import { useToast } from './Toast'
import { copyMediaImage, revealMediaArtifact, saveMediaArtifact } from './mediaArtifactActions'
import './MediaArtifactViewer.less'

export type MediaArtifactViewSource = {
  /** 已解析为页面可加载的 URL（safe-file:// 或 http 等） */
  src: string
  alt: string
  fileName?: string
  /** 本地绝对路径；下载与「打开所在文件夹」依赖它 */
  filePath?: string
  type: 'image' | 'video'
}

type MediaArtifactViewerProps = {
  media: MediaArtifactViewSource
  /** 参考输入图；提供时工具栏出现对比开关 */
  inputImage?: { src: string; label?: string } | undefined
  /** 输出翻页插槽；不传则不渲染翻页区 */
  pagination?:
    | {
        index: number
        total: number
        onPrev: () => void
        onNext: () => void
        /** 当前项归属说明（如任务标题）；跨任务翻页时提示用户翻到了哪条 */
        label?: string
      }
    | undefined
  /** 提供「大图预览」入口（全屏灯箱等），由调用方决定打开方式 */
  onOpenFullscreen?: (() => void) | undefined
  /** 是否用 ←/→ 翻页，默认开启；上层已有自己的键盘翻页（如全屏灯箱）时置 false */
  keyboardPaging?: boolean | undefined
  /** 是否用 ↑/↓ 缩放，默认开启；上层盖住了查看器（如全屏灯箱）时置 false */
  keyboardZoom?: boolean | undefined
  /**
   * 舞台右键菜单里追加的动作（任务级操作等），渲染在内置产物动作之后，
   * 中间自动加一条分割线；不传则只有内置动作。
   */
  contextMenuExtraItems?: ContextMenuEntry[] | undefined
}

const MIN_SCALE = 1
const MAX_SCALE = 8
/** 工具栏 +/- 与 ↑/↓ 的每一档缩放倍率 */
const ZOOM_STEP = 1.4
/** 双击放大档位 */
const DOUBLE_CLICK_SCALE = 2.5

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function MediaArtifactViewer({
  media,
  inputImage,
  pagination,
  onOpenFullscreen,
  keyboardPaging = true,
  keyboardZoom = true,
  contextMenuExtraItems,
}: MediaArtifactViewerProps) {
  const { toast } = useToast()
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  // 缩放与位移收敛为单一 view 状态，保证 updater 纯函数（StrictMode 双调用安全）
  const [view, setView] = useState({ scale: 1, offset: { x: 0, y: 0 } })
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const dragStateRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const { scale, offset } = view

  const isVideo = media.type === 'video'
  const canCompare = Boolean(inputImage?.src)
  const compareActive = canCompare && compareOpen && !isVideo

  // 键盘翻页与工具栏翻页共用同一组回调；单页或显式关闭时不注册监听
  useArrowPaging({
    enabled: keyboardPaging && Boolean(pagination) && (pagination?.total ?? 0) > 1,
    onPrev: () => pagination?.onPrev(),
    onNext: () => pagination?.onNext(),
  })

  // 切换产物时回到适屏状态，避免上一张的缩放残留。
  // 用 React 官方「渲染期间调整状态」模式（记录上次 mediaKey），不引入 effect。
  const mediaKey = `${media.type}:${media.src}`
  const [prevMediaKey, setPrevMediaKey] = useState(mediaKey)
  if (prevMediaKey !== mediaKey) {
    setPrevMediaKey(mediaKey)
    setView({ scale: 1, offset: { x: 0, y: 0 } })
    setCompareOpen(false)
  }

  const resetView = useCallback(() => {
    setView({ scale: 1, offset: { x: 0, y: 0 } })
  }, [])

  const clampOffset = useCallback((next: { x: number; y: number }, nextScale: number) => {
    const stage = stageRef.current
    if (!stage) return next
    const rect = stage.getBoundingClientRect()
    const maxX = (rect.width / 2) * (nextScale - 1)
    const maxY = (rect.height / 2) * (nextScale - 1)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }, [])

  const zoomAt = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const stage = stageRef.current
      const clamped = clampScale(nextScale)
      if (!stage) {
        setView({ scale: clamped, offset: { x: 0, y: 0 } })
        return
      }
      const rect = stage.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      setView((current) => {
        const ratio = clamped / current.scale
        if (!anchor || ratio === 1) return { scale: clamped, offset: { x: 0, y: 0 } }
        const dx = anchor.x - center.x
        const dy = anchor.y - center.y
        return {
          scale: clamped,
          offset: clampOffset(
            { x: dx - (dx - current.offset.x) * ratio, y: dy - (dy - current.offset.y) * ratio },
            clamped,
          ),
        }
      })
    },
    [clampOffset],
  )

  // 键盘缩放与工具栏 +/- 同档位，锚点取舞台中心：缩放时当前视野中心不漂移，平移量按比例跟随
  const zoomByKeyboard = useCallback(
    (factor: number) => {
      const stage = stageRef.current
      if (!stage) {
        zoomAt(scale * factor)
        return
      }
      const rect = stage.getBoundingClientRect()
      zoomAt(scale * factor, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    },
    [scale, zoomAt],
  )

  useArrowZoom({
    rootRef: viewerRef,
    enabled: keyboardZoom && !isVideo && !compareActive,
    onZoomIn: () => zoomByKeyboard(ZOOM_STEP),
    onZoomOut: () => zoomByKeyboard(1 / ZOOM_STEP),
  })

  // React 的 onWheel 在根节点是 passive 的，无法 preventDefault；这里用原生监听接管滚轮缩放
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || isVideo || compareActive) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0016)
      zoomAt(scale * factor, { x: event.clientX, y: event.clientY })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [compareActive, isVideo, scale, zoomAt])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isVideo || compareActive || scale <= 1) return
    event.preventDefault()
    void event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.lastX
    const dy = event.clientY - drag.lastY
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    setView((current) => ({
      ...current,
      offset: clampOffset({ x: current.offset.x + dx, y: current.offset.y + dy }, current.scale),
    }))
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) dragStateRef.current = null
  }

  const handleDoubleClick = () => {
    if (isVideo || compareActive) return
    if (scale > 1) resetView()
    else zoomAt(DOUBLE_CLICK_SCALE)
  }

  const handleCopy = useCallback(async () => {
    try {
      await copyMediaImage(media.src)
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      toast.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [media.src, toast])

  const handleDownload = useCallback(async () => {
    if (!media.filePath) {
      toast.warning('当前产物没有本地文件，无法下载')
      return
    }
    setDownloading(true)
    try {
      const result = await saveMediaArtifact({ filePath: media.filePath, fileName: media.fileName })
      if (result.saved && result.savedPath) {
        toast.success(`已保存到 ${result.savedPath}`)
      } else if (result.error) {
        toast.error(`下载失败：${result.error}`)
      }
    } catch (err) {
      toast.error(`下载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [media.filePath, media.fileName, toast])

  const handleReveal = useCallback(async () => {
    if (!media.filePath) return
    try {
      const result = await revealMediaArtifact(media.filePath)
      if (!result.revealed) toast.error(result.error ?? '打开产物所在文件夹失败')
    } catch (err) {
      toast.error(`打开产物所在文件夹失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [media.filePath, toast])

  // 舞台右键菜单：内置动作与工具栏一致，调用方追加的任务级动作排在分割线之后
  const stageMenu = useContextMenu<void>()
  const stageMenuItems: ContextMenuEntry[] = []
  if (!isVideo) {
    stageMenuItems.push({
      key: 'copy',
      label: '复制图片',
      icon: <Icons.Copy size={14} />,
      onClick: () => void handleCopy(),
    })
  }
  if (onOpenFullscreen && !isVideo) {
    stageMenuItems.push({
      key: 'fullscreen',
      label: '全屏大图预览',
      icon: <Icons.Maximize size={14} />,
      onClick: onOpenFullscreen,
    })
  }
  if (media.filePath) {
    stageMenuItems.push({
      key: 'download',
      label: '另存为…',
      icon: <Icons.Download size={14} />,
      onClick: () => void handleDownload(),
    })
    stageMenuItems.push({
      key: 'reveal',
      label: '打开所在文件夹',
      icon: <Icons.FolderOpen size={14} />,
      onClick: () => void handleReveal(),
    })
  }
  if (contextMenuExtraItems && contextMenuExtraItems.length > 0) {
    stageMenuItems.push({ type: 'divider' }, ...contextMenuExtraItems)
  }

  return (
    <div ref={viewerRef} className="media-artifact-viewer" aria-label={media.alt}>
      <div
        ref={stageRef}
        className={`media-artifact-viewer-stage${compareActive ? ' is-compare' : ''}`}
        onContextMenu={
          stageMenuItems.length > 0 ? (event) => stageMenu.open(event, undefined) : undefined
        }
      >
        {compareActive && inputImage ? (
          <>
            <figure className="media-artifact-compare-pane">
              <figcaption>{inputImage.label ?? '输入图'}</figcaption>
              <img src={inputImage.src} alt={inputImage.label ?? '输入图'} draggable={false} />
            </figure>
            <figure className="media-artifact-compare-pane">
              <figcaption>输出图</figcaption>
              <img src={media.src} alt={media.alt} draggable={false} />
            </figure>
          </>
        ) : isVideo ? (
          <video key={media.src} src={media.src} controls className="media-artifact-video" />
        ) : (
          <div
            className={`media-artifact-canvas${scale > 1 ? ' is-zoomed' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onDoubleClick={handleDoubleClick}
          >
            <img
              src={media.src}
              alt={media.alt}
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
            />
          </div>
        )}
      </div>

      <div className="media-artifact-viewer-toolbar">
        {pagination && pagination.total > 1 && (
          <div className="media-artifact-viewer-pager">
            {pagination.label && (
              <span className="media-artifact-viewer-pager-label" title={pagination.label}>
                {pagination.label}
              </span>
            )}
            <button
              type="button"
              aria-label="上一项输出"
              onClick={pagination.onPrev}
              title="上一项（←）"
            >
              <Icons.ChevronLeft size={15} />
            </button>
            <span>
              {pagination.index + 1} / {pagination.total}
            </span>
            <button
              type="button"
              aria-label="下一项输出"
              onClick={pagination.onNext}
              title="下一项（→）"
            >
              <Icons.ChevronRight size={15} />
            </button>
          </div>
        )}

        <div className="media-artifact-viewer-actions">
          {canCompare && !isVideo && (
            <button
              type="button"
              className={compareActive ? 'is-active' : ''}
              onClick={() => setCompareOpen((current) => !current)}
              title={compareActive ? '退出对比' : '并排查看输入与输出'}
            >
              <Icons.Combine size={14} />
              <span>{compareActive ? '退出对比' : '对比'}</span>
            </button>
          )}
          {!isVideo && (
            <div className="media-artifact-viewer-zoom">
              <button
                type="button"
                aria-label="缩小"
                disabled={scale <= MIN_SCALE}
                title="缩小（↓）"
                onClick={() => zoomAt(scale / ZOOM_STEP)}
              >
                <Icons.Minus size={14} />
              </button>
              <button
                type="button"
                className="media-artifact-viewer-zoom-level"
                onClick={resetView}
                title="重置为适屏"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大"
                disabled={scale >= MAX_SCALE}
                title="放大（↑）"
                onClick={() => zoomAt(scale * ZOOM_STEP)}
              >
                <Icons.Plus size={14} />
              </button>
            </div>
          )}
          {!isVideo && onOpenFullscreen && (
            <button type="button" onClick={onOpenFullscreen} title="打开全屏大图预览">
              <Icons.Maximize size={14} />
              <span>大图</span>
            </button>
          )}
          {!isVideo && (
            <button type="button" onClick={() => void handleCopy()} title="复制图片">
              {copied ? <Icons.Check size={14} /> : <Icons.Copy size={14} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          )}
          {media.filePath && (
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              title="下载到本地"
            >
              <Icons.Download size={14} />
              <span>下载</span>
            </button>
          )}
          {media.filePath && (
            <button type="button" onClick={() => void handleReveal()} title="打开产物所在文件夹">
              <Icons.FolderOpen size={14} />
              <span>所在文件夹</span>
            </button>
          )}
        </div>
      </div>

      {stageMenu.menu && stageMenuItems.length > 0 && (
        <ContextMenu
          x={stageMenu.menu.x}
          y={stageMenu.menu.y}
          items={stageMenuItems}
          onClose={stageMenu.close}
          ariaLabel="产物操作"
        />
      )}
    </div>
  )
}
