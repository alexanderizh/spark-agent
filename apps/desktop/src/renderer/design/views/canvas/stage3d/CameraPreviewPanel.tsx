import { useEffect, useRef, useState } from 'react'
import { Select } from 'antd'
import { Icons } from '../../../Icons'
import type { Stage3DCamera, Stage3DShot } from './stage3d.types'
import { STAGE3D_ASPECT_RATIO } from './stage3d.types'

/**
 * 机位预览画中画：右栏顶部常驻小窗，实时渲染「选中的机位」看到的画面。
 *
 * 渲染走 Scene3D 的离屏管线（renderPreview，隐藏 gizmo/取景相机模型），
 * 以 ~10fps 轮询；运镜播放时上层 resolveCamera 会返回动画机位，小窗即实时跟播。
 * 放大后以 overlay 形式浮在视口中央，方便对照取景。
 */

export type Stage3DCameraSource = { kind: 'director' } | { kind: 'shot'; id: string }

const PIP_TICK_MS = 100
const PIP_LONG_EDGE = 480
const PIP_EXPANDED_LONG_EDGE = 960

export function CameraPreviewPanel({
  shots,
  directorCameraName,
  resolveCamera,
  renderPreview,
  recording,
}: {
  shots: Stage3DShot[]
  directorCameraName: string
  resolveCamera: (source: Stage3DCameraSource) => Stage3DCamera | null
  renderPreview: (cam: Stage3DCamera | undefined, target: HTMLCanvasElement) => boolean
  /** 视频录制中：小窗角上亮录制指示 */
  recording?: boolean | undefined
}) {
  const [source, setSource] = useState<Stage3DCameraSource>({ kind: 'director' })
  const [expanded, setExpanded] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const resolveRef = useRef(resolveCamera)
  const renderRef = useRef(renderPreview)
  resolveRef.current = resolveCamera
  renderRef.current = renderPreview

  // 轮询渲染：小尺寸离屏一帧 → 画进预览 canvas
  useEffect(() => {
    const timer = window.setInterval(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cam = resolveRef.current(source)
      if (!cam) {
        setRenderFailed(true)
        return
      }
      const ratio = STAGE3D_ASPECT_RATIO[cam.aspect]
      const longEdge = expanded ? PIP_EXPANDED_LONG_EDGE : PIP_LONG_EDGE
      const width = ratio >= 1 ? longEdge : Math.round(longEdge * ratio)
      const height = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ok = renderRef.current(cam, canvas)
      setRenderFailed(!ok)
    }, PIP_TICK_MS)
    return () => window.clearInterval(timer)
  }, [source, expanded])

  const sourceValue = source.kind === 'director' ? 'director' : source.id
  const options = [
    { value: 'director', label: directorCameraName },
    ...shots.map((shot) => ({ value: shot.id, label: `镜头 · ${shot.name || shot.shotNumber || '未命名'}` })),
  ]

  const thumbnail = (
    <div className={`stage3d-pip-thumb${expanded ? ' expanded' : ''}`}>
      <canvas ref={canvasRef} className="stage3d-pip-canvas" />
      {renderFailed && <div className="stage3d-pip-fallback">等待 3D 视口就绪…</div>}
      {recording && (
        <div className="stage3d-pip-rec" title="正在录制运镜视频">
          <span className="stage3d-pip-rec-dot" />
          REC
        </div>
      )}
      <button
        type="button"
        className="stage3d-pip-expand"
        title={expanded ? '还原小窗' : '放大预览'}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icons.Maximize size={13} />
      </button>
    </div>
  )

  if (expanded) {
    return (
      <div className="stage3d-pip-expanded-wrap">
        <div className="stage3d-pip-header">
          <span className="stage3d-pip-title">机位预览</span>
          <button
            type="button"
            className="stage3d-pip-collapse"
            title="还原小窗"
            onClick={() => setExpanded(false)}
          >
            <Icons.Minimize size={13} />
          </button>
        </div>
        {thumbnail}
        <Select
          size="small"
          className="stage3d-pip-select"
          value={sourceValue}
          options={options}
          onChange={(value) =>
            setSource(value === 'director' ? { kind: 'director' } : { kind: 'shot', id: value })
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className="stage3d-pip-header">
        <span className="stage3d-pip-title">机位预览</span>
      </div>
      {thumbnail}
      <Select
        size="small"
        className="stage3d-pip-select"
        value={sourceValue}
        options={options}
        onChange={(value) =>
          setSource(value === 'director' ? { kind: 'director' } : { kind: 'shot', id: value })
        }
      />
    </>
  )
}
