import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Slider, Switch, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'

type PanoramaViewerHandle = {
  screenshot: () => string | null
  reset: () => void
}

type PanoramaPose = {
  yaw: number
  pitch: number
  fov: number
}

type PanoramaLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'webgl-unavailable'

const MIN_FOV = 30
const MAX_FOV = 100
const DEFAULT_FOV = 75
const MAX_PITCH = 1.45
const KEYBOARD_STEP = 0.12
const AUTOROTATE_SPEED = 0.0016
const VELOCITY_DECAY = 0.92
const MIN_VELOCITY = 0.00004

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapRadians(value: number): number {
  const twoPi = Math.PI * 2
  return ((value % twoPi) + twoPi) % twoPi
}

function radiansToDegrees(value: number): number {
  return Math.round((value * 180) / Math.PI)
}

function formatYaw(yaw: number): string {
  const degrees = Math.round((wrapRadians(yaw) * 180) / Math.PI)
  if (degrees >= 315 || degrees < 45) return `${degrees}° N`
  if (degrees < 135) return `${degrees}° E`
  if (degrees < 225) return `${degrees}° S`
  return `${degrees}° W`
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建 WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) || 'shader compile failed'
    gl.deleteShader(shader)
    throw new Error(error)
  }
  return shader
}

function linkProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建 WebGL program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) || 'program link failed'
    gl.deleteProgram(program)
    throw new Error(error)
  }
  return program
}

function createFullscreenQuad(): { vertices: Float32Array; indices: Uint16Array } {
  // Full-screen render target. The fragment shader samples an equirectangular panorama as if
  // the camera were inside a textured sphere, matching the core approach used by lightweight
  // WebGL panorama viewers while avoiding another runtime dependency.
  return {
    vertices: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }
}

function setTextureFilters(gl: WebGLRenderingContext, width: number, height: number): void {
  const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    return
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
}

function PanoramaWebglViewer({
  src,
  fov,
  autorotate,
  onFovChange,
  onLoadState,
  onPoseChange,
  onReady,
}: {
  src: string
  fov: number
  autorotate: boolean
  onFovChange: (fov: number) => void
  onLoadState: (state: PanoramaLoadState) => void
  onPoseChange: (pose: PanoramaPose) => void
  onReady: (handle: PanoramaViewerHandle | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const fovRef = useRef(fov)
  const autorotateRef = useRef(autorotate)
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; t: number } | null>(
    null,
  )
  const velocityRef = useRef({ yaw: 0, pitch: 0 })
  const lastFrameRef = useRef(0)

  useEffect(() => {
    fovRef.current = fov
  }, [fov])

  useEffect(() => {
    autorotateRef.current = autorotate
  }, [autorotate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    onLoadState('loading')
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })
    if (!gl) {
      onLoadState('webgl-unavailable')
      onReady(null)
      return undefined
    }

    let program: WebGLProgram | null = null
    let vertexBuffer: WebGLBuffer | null = null
    let indexBuffer: WebGLBuffer | null = null
    let texture: WebGLTexture | null = null
    let disposed = false
    let frame = 0

    try {
      program = linkProgram(
        gl,
        `attribute vec3 aPosition;
         void main() {
           gl_Position = vec4(aPosition.xy, 0.0, 1.0);
         }`,
        `precision highp float;
         uniform sampler2D uTexture;
         uniform float uYaw;
         uniform float uPitch;
         uniform float uFov;
         uniform vec2 uResolution;
         const float PI = 3.141592653589793;
         mat3 rotY(float a){ float s=sin(a), c=cos(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
         mat3 rotX(float a){ float s=sin(a), c=cos(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
         void main() {
           vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
           uv.x *= uResolution.x / uResolution.y;
           float z = 1.0 / tan(radians(uFov) * 0.5);
           vec3 dir = normalize(vec3(uv.x, uv.y, -z));
           dir = rotY(uYaw) * rotX(uPitch) * dir;
           float lon = atan(dir.x, -dir.z);
           float lat = asin(clamp(dir.y, -1.0, 1.0));
           vec2 panoUv = vec2(fract(0.5 + lon / (2.0 * PI)), 0.5 + lat / PI);
           gl_FragColor = texture2D(uTexture, panoUv);
         }`,
      )
      gl.useProgram(program)
      const mesh = createFullscreenQuad()
      vertexBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
      indexBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
      const positionLocation = gl.getAttribLocation(program, 'aPosition')
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
      const yawLocation = gl.getUniformLocation(program, 'uYaw')
      const pitchLocation = gl.getUniformLocation(program, 'uPitch')
      const fovLocation = gl.getUniformLocation(program, 'uFov')
      const resolutionLocation = gl.getUniformLocation(program, 'uResolution')
      texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([2, 6, 23, 255]),
      )

      const render = (time = performance.now(), scheduleNextFrame = true) => {
        if (disposed) return
        const delta = lastFrameRef.current ? Math.min(48, time - lastFrameRef.current) : 16
        lastFrameRef.current = time
        if (!dragRef.current) {
          if (autorotateRef.current) yawRef.current += AUTOROTATE_SPEED * delta
          if (
            Math.abs(velocityRef.current.yaw) > MIN_VELOCITY ||
            Math.abs(velocityRef.current.pitch) > MIN_VELOCITY
          ) {
            yawRef.current += velocityRef.current.yaw * delta
            pitchRef.current = clamp(
              pitchRef.current + velocityRef.current.pitch * delta,
              -MAX_PITCH,
              MAX_PITCH,
            )
            velocityRef.current.yaw *= VELOCITY_DECAY
            velocityRef.current.pitch *= VELOCITY_DECAY
          }
        }
        const rect = canvas.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const width = Math.max(1, Math.floor(rect.width * dpr))
        const height = Math.max(1, Math.floor(rect.height * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        gl.viewport(0, 0, width, height)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform1f(yawLocation, yawRef.current)
        gl.uniform1f(pitchLocation, pitchRef.current)
        gl.uniform1f(fovLocation, fovRef.current)
        gl.uniform2f(resolutionLocation, width, height)
        gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0)
        onPoseChange({ yaw: yawRef.current, pitch: pitchRef.current, fov: fovRef.current })
        if (scheduleNextFrame) frame = window.requestAnimationFrame(render)
      }

      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        if (disposed || !texture) return
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        setTextureFilters(gl, image.naturalWidth, image.naturalHeight)
        onLoadState('ready')
        onReady({
          screenshot: () => {
            render(performance.now(), false)
            return canvas.toDataURL('image/png')
          },
          reset: () => {
            yawRef.current = 0
            pitchRef.current = 0
            velocityRef.current = { yaw: 0, pitch: 0 }
            onFovChange(DEFAULT_FOV)
          },
        })
        render()
      }
      image.onerror = () => {
        onLoadState('error')
        message.error('全景图加载失败')
      }
      image.src = src
    } catch (error) {
      onLoadState('error')
      message.error(error instanceof Error ? error.message : '全景渲染器初始化失败')
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      onReady(null)
      if (texture) gl.deleteTexture(texture)
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer)
      if (indexBuffer) gl.deleteBuffer(indexBuffer)
      if (program) gl.deleteProgram(program)
    }
  }, [onFovChange, onLoadState, onPoseChange, onReady, src])

  const updateFov = useCallback(
    (nextFov: number) => {
      const clamped = clamp(nextFov, MIN_FOV, MAX_FOV)
      fovRef.current = clamped
      onFovChange(Math.round(clamped))
    },
    [onFovChange],
  )

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      yaw: yawRef.current,
      pitch: pitchRef.current,
      t: performance.now(),
    }
    velocityRef.current = { yaw: 0, pitch: 0 }
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const now = performance.now()
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    yawRef.current = drag.yaw - dx * 0.006
    pitchRef.current = clamp(drag.pitch + dy * 0.006, -MAX_PITCH, MAX_PITCH)
    const elapsed = Math.max(1, now - drag.t)
    velocityRef.current = { yaw: (-dx * 0.006) / elapsed, pitch: (dy * 0.006) / elapsed }
  }, [])

  const finishPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      updateFov(fovRef.current + event.deltaY * 0.03)
    },
    [updateFov],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (event.key === 'ArrowLeft') yawRef.current -= KEYBOARD_STEP
      else if (event.key === 'ArrowRight') yawRef.current += KEYBOARD_STEP
      else if (event.key === 'ArrowUp')
        pitchRef.current = clamp(pitchRef.current - KEYBOARD_STEP, -MAX_PITCH, MAX_PITCH)
      else if (event.key === 'ArrowDown')
        pitchRef.current = clamp(pitchRef.current + KEYBOARD_STEP, -MAX_PITCH, MAX_PITCH)
      else if (event.key === '+' || event.key === '=') updateFov(fovRef.current - 5)
      else if (event.key === '-' || event.key === '_') updateFov(fovRef.current + 5)
      else return
      event.preventDefault()
      velocityRef.current = { yaw: 0, pitch: 0 }
    },
    [updateFov],
  )

  return (
    <canvas
      ref={canvasRef}
      className="canvas-panorama-webgl"
      tabIndex={0}
      role="img"
      aria-label="360 全景预览，可拖拽、滚轮缩放或使用方向键查看"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    />
  )
}

export function CanvasPanoramaViewerModal({
  node,
  open,
  onClose,
  onScreenshot,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onScreenshot: (dataUrl: string, sourceNode: CanvasNode, pose: PanoramaPose) => Promise<void>
}) {
  const [fov, setFov] = useState(DEFAULT_FOV)
  const [loadState, setLoadState] = useState<PanoramaLoadState>('idle')
  const [autorotate, setAutorotate] = useState(false)
  const [pose, setPose] = useState<PanoramaPose>({ yaw: 0, pitch: 0, fov: DEFAULT_FOV })
  const [fullscreen, setFullscreen] = useState(false)
  const handleRef = useRef<PanoramaViewerHandle | null>(null)
  const src = node?.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const isBusy = loadState === 'loading' || loadState === 'idle'
  const canCapture = loadState === 'ready' && Boolean(handleRef.current)
  const aspectLabel = useMemo(() => {
    const width = node?.width ?? 0
    const height = node?.height ?? 0
    if (width <= 0 || height <= 0) return 'equirectangular'
    return Math.abs(width / height - 2) < 0.22 ? '2:1 equirectangular' : 'panorama image'
  }, [node?.height, node?.width])

  useEffect(() => {
    if (!open) return
    setFov(DEFAULT_FOV)
    setLoadState(src ? 'loading' : 'idle')
    setAutorotate(false)
    setPose({ yaw: 0, pitch: 0, fov: DEFAULT_FOV })
    setFullscreen(false)
  }, [open, src])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="100vw"
      className={`canvas-panorama-modal${fullscreen ? ' canvas-panorama-modal-fullscreen' : ''}`}
      title={null}
      destroyOnHidden
    >
      <div className="canvas-panorama-shell">
        <div className="canvas-panorama-topbar">
          <div>
            <div className="canvas-panorama-kicker">360° Panorama Preview</div>
            <div className="canvas-panorama-title">{node?.title ?? '360 全景预览'}</div>
          </div>
          <div className="canvas-panorama-topbar-actions">
            <span className="canvas-panorama-meta">{aspectLabel}</span>
            <Button
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              onClick={() => setFullscreen((value) => !value)}
            >
              {fullscreen ? '退出全屏' : '沉浸全屏'}
            </Button>
            <Button icon={<Icons.X size={14} />} onClick={onClose} />
          </div>
        </div>

        {src && (
          <PanoramaWebglViewer
            src={src}
            fov={fov}
            autorotate={autorotate}
            onFovChange={setFov}
            onLoadState={setLoadState}
            onPoseChange={setPose}
            onReady={(handle) => {
              handleRef.current = handle
            }}
          />
        )}

        {isBusy && (
          <div className="canvas-panorama-state">
            <div className="canvas-panorama-spinner" />
            <strong>正在加载全景图</strong>
            <span>准备 WebGL 球面渲染与纹理采样…</span>
          </div>
        )}
        {loadState === 'webgl-unavailable' && (
          <div className="canvas-panorama-state canvas-panorama-state-error">
            <strong>当前环境不支持 WebGL</strong>
            <span>请在支持 WebGL 的浏览器 / Electron 渲染环境中打开 360 全景预览。</span>
          </div>
        )}
        {loadState === 'error' && (
          <div className="canvas-panorama-state canvas-panorama-state-error">
            <strong>全景图加载失败</strong>
            <span>请确认产物图片仍可访问，并且是 PNG / JPG / WebP 等浏览器可加载格式。</span>
          </div>
        )}

        <div className="canvas-panorama-compass" aria-hidden>
          <div
            className="canvas-panorama-compass-needle"
            style={{ transform: `rotate(${radiansToDegrees(pose.yaw)}deg)` }}
          />
          <span>N</span>
        </div>

        <div className="canvas-panorama-toolbar">
          <Button icon={<Icons.RotateCcw size={14} />} onClick={() => handleRef.current?.reset()}>
            重置
          </Button>
          <div className="canvas-panorama-switch">
            <span>自动环视</span>
            <Switch size="small" checked={autorotate} onChange={setAutorotate} />
          </div>
          <div className="canvas-panorama-telemetry">
            <span>{formatYaw(pose.yaw)}</span>
            <span>Pitch {radiansToDegrees(pose.pitch)}°</span>
            <span>FOV {Math.round(fov)}°</span>
          </div>
          <span className="canvas-panorama-toolbar-label">远近</span>
          <Slider
            min={MIN_FOV}
            max={MAX_FOV}
            value={fov}
            onChange={setFov}
            className="canvas-panorama-zoom"
            tooltip={{ formatter: (value) => `${value}°` }}
          />
          <Button
            type="primary"
            disabled={!canCapture}
            icon={<Icons.Image size={14} />}
            onClick={async () => {
              if (!node) return
              const dataUrl = handleRef.current?.screenshot()
              if (!dataUrl) return
              await onScreenshot(dataUrl, node, pose)
            }}
          >
            截图生成场景图
          </Button>
        </div>
        <div className="canvas-panorama-hint">
          拖拽 / 触控滑动查看方向 · 滚轮 / 滑杆缩放 · 方向键环视 · +/- 缩放
        </div>
      </div>
    </Modal>
  )
}
