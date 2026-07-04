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
// 框选截图：拖拽小于这个尺寸（CSS 像素）视为误触点击，不触发截取
const MIN_CROP_SIZE = 6
// 纹理上限：再大的全景图也先重采样到这个尺寸以内，避免超过 GPU MAX_TEXTURE_SIZE 后
// texImage2D 静默失败导致全黑。8192 对绝大多数全景已足够清晰。
const MAX_TEXTURE_CAP = 8192

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

function floorPowerOfTwo(value: number): number {
  return 2 ** Math.floor(Math.log2(Math.max(1, value)))
}

// 根据纹理是否为 2 次幂选择正确的环绕/过滤参数。
// WebGL1 下 NPOT 纹理用 REPEAT 或 mipmap 会变成「纹理不完整」→ 采样全黑，
// 因此 NPOT 时必须退回 CLAMP_TO_EDGE + 线性过滤。
function applyTextureFilters(gl: WebGLRenderingContext, width: number, height: number): void {
  const pot = isPowerOfTwo(width) && isPowerOfTwo(height)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  if (pot) {
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    return
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
}

type CssRect = { x: number; y: number; w: number; h: number }

// 框选截图：把 canvas 当前帧按 CSS 像素矩形裁出一块，返回 PNG dataURL。
// preserveDrawingBuffer 已开启，WebGL canvas 可直接当 2D drawImage 的源；
// 跨域纹理污染画布时 drawImage/toDataURL 会抛错，返回 null 由调用方提示降级。
function captureCanvasRegion(
  canvas: HTMLCanvasElement,
  cssRect: CssRect,
  boundingRect: DOMRect,
): string | null {
  const scaleX = canvas.width / boundingRect.width
  const scaleY = canvas.height / boundingRect.height
  const sx = clamp(Math.round(cssRect.x * scaleX), 0, canvas.width)
  const sy = clamp(Math.round(cssRect.y * scaleY), 0, canvas.height)
  const sw = clamp(Math.round(cssRect.w * scaleX), 1, canvas.width - sx)
  const sh = clamp(Math.round(cssRect.h * scaleY), 1, canvas.height - sy)
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    return out.toDataURL('image/png')
  } catch {
    return null
  }
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

// 把全景图重采样成 ≤ maxTex 的 2 次幂等距柱状尺寸（宽=2×高），保证：
// 1) 不超过 GPU 纹理上限；2) 是 POT，可用 REPEAT 让水平方向无缝环视。
// 优先用 createImageBitmap（不经过 2D canvas 回读，跨域无 CORS 的图也不会因污染抛错）；
// 不支持时回退到 2D canvas 缩放；都失败则直传原图。返回实际上传的尺寸。
async function uploadPanoramaTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  image: HTMLImageElement,
  shouldAbort: () => boolean,
): Promise<void> {
  const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, MAX_TEXTURE_CAP)
  const naturalW = image.naturalWidth || maxTex
  const naturalH = image.naturalHeight || Math.round(naturalW / 2)
  const targetW = Math.min(floorPowerOfTwo(naturalW), maxTex)
  const targetH = Math.min(floorPowerOfTwo(Math.round(targetW / 2)), maxTex)
  const needResize = naturalW !== targetW || naturalH !== targetH

  let source: TexImageSource = image
  let bitmap: ImageBitmap | null = null
  let uploadedW = naturalW
  let uploadedH = naturalH

  if (needResize) {
    try {
      bitmap = await createImageBitmap(image, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
      })
      if (shouldAbort()) {
        bitmap.close()
        return
      }
      source = bitmap
      uploadedW = targetW
      uploadedH = targetH
    } catch {
      try {
        const offscreen = document.createElement('canvas')
        offscreen.width = targetW
        offscreen.height = targetH
        const ctx = offscreen.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(image, 0, 0, targetW, targetH)
        source = offscreen
        uploadedW = targetW
        uploadedH = targetH
      } catch {
        source = image
        uploadedW = naturalW
        uploadedH = naturalH
      }
    }
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  // 不翻转：让 image / ImageBitmap / 2D canvas 三种上传路径朝向一致，朝向交给 shader 处理。
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  let uploaded = true
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  } catch {
    // 从被污染（tainted）的 2D canvas 上传会抛安全错误，退回直传原图（会污染绘制缓冲，
    // 仅影响截图 toDataURL，但预览正常）。
    uploaded = false
  }
  if (!uploaded) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    uploadedW = naturalW
    uploadedH = naturalH
  }
  applyTextureFilters(gl, uploadedW, uploadedH)
  if (bitmap) bitmap.close()
  const glError = gl.getError()
  if (glError !== gl.NO_ERROR) throw new Error(`WebGL 纹理上传失败 (0x${glError.toString(16)})`)
}

function PanoramaWebglViewer({
  src,
  fov,
  autorotate,
  cropMode,
  onFovChange,
  onLoadState,
  onPoseChange,
  onReady,
  onCropCapture,
}: {
  src: string
  fov: number
  autorotate: boolean
  cropMode: boolean
  onFovChange: (fov: number) => void
  onLoadState: (state: PanoramaLoadState) => void
  onPoseChange: (pose: PanoramaPose) => void
  onReady: (handle: PanoramaViewerHandle | null) => void
  onCropCapture: (dataUrl: string) => void
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
  /** 框选截图：拖拽起点（CSS 像素，相对 canvas） */
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  )

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
    const contextOptions: WebGLContextAttributes = {
      antialias: true,
      preserveDrawingBuffer: true,
      // 失败时不要直接黑，给上层机会提示
      failIfMajorPerformanceCaveat: false,
    }
    const gl = (canvas.getContext('webgl2', contextOptions) ||
      canvas.getContext('webgl', contextOptions)) as WebGLRenderingContext | null
    if (!gl) {
      onLoadState('webgl-unavailable')
      onReady(null)
      return undefined
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault()
      onLoadState('error')
      message.error('WebGL 上下文丢失，请重新打开全景预览')
    }
    canvas.addEventListener('webglcontextlost', handleContextLost, false)

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
           // 纹理不做 UNPACK_FLIP_Y（v=0 即图片顶部=天空），故这里用 0.5 - lat/PI：
           // 向上看(lat>0)采样到图片顶部的天空，避免上下颠倒。
           vec2 panoUv = vec2(fract(0.5 + lon / (2.0 * PI)), 0.5 - lat / PI);
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
      // 显式把 sampler 绑到纹理单元 0（虽然默认即 0，显式设置更稳健）
      gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)
      gl.activeTexture(gl.TEXTURE0)
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

      const attachImage = (image: HTMLImageElement) => {
        image.onload = () => {
          if (disposed || !texture) return
          void uploadPanoramaTexture(gl, texture, image, () => disposed)
            .then(() => {
              if (disposed) return
              onLoadState('ready')
              onReady({
                screenshot: () => {
                  render(performance.now(), false)
                  try {
                    return canvas.toDataURL('image/png')
                  } catch {
                    // 跨域资源会污染画布导致 toDataURL 抛错，截图功能降级为不可用
                    return null
                  }
                },
                reset: () => {
                  yawRef.current = 0
                  pitchRef.current = 0
                  velocityRef.current = { yaw: 0, pitch: 0 }
                  onFovChange(DEFAULT_FOV)
                },
              })
              render()
            })
            .catch((error: unknown) => {
              if (disposed) return
              onLoadState('error')
              message.error(error instanceof Error ? error.message : '全景图渲染失败')
            })
        }
      }

      const triggerError = () => {
        onLoadState('error')
        message.error('全景图加载失败')
      }

      // 先尝试带 crossOrigin（保证截图 toDataURL 不被污染）；失败则去掉重试一次，
      // 保证本地 safe-file:// / file:// 等无 CORS 头的资源至少能正常预览。
      let retried = false
      const image = new Image()
      attachImage(image)
      image.onerror = () => {
        if (retried) {
          triggerError()
          return
        }
        retried = true
        const fallback = new Image()
        attachImage(fallback)
        fallback.onerror = triggerError
        fallback.src = src
      }
      image.crossOrigin = 'anonymous'
      image.src = src
    } catch (error) {
      onLoadState('error')
      message.error(error instanceof Error ? error.message : '全景渲染器初始化失败')
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      canvas.removeEventListener('webglcontextlost', handleContextLost, false)
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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = event.currentTarget
      canvas.setPointerCapture(event.pointerId)
      if (cropMode) {
        const rect = canvas.getBoundingClientRect()
        const start = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        selectionStartRef.current = start
        setSelection({ x: start.x, y: start.y, w: 0, h: 0 })
        return
      }
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        yaw: yawRef.current,
        pitch: pitchRef.current,
        t: performance.now(),
      }
      velocityRef.current = { yaw: 0, pitch: 0 }
    },
    [cropMode],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (cropMode) {
        const start = selectionStartRef.current
        if (!start) return
        const rect = event.currentTarget.getBoundingClientRect()
        const current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        setSelection({
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          w: Math.abs(current.x - start.x),
          h: Math.abs(current.y - start.y),
        })
        return
      }
      const drag = dragRef.current
      if (!drag) return
      const now = performance.now()
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      // 画面跟随拖拽手势：右拖看右、下拖看下（pitch++ = 看向上，故下拖时 pitch 递减）
      yawRef.current = drag.yaw + dx * 0.006
      pitchRef.current = clamp(drag.pitch + dy * 0.006, -MAX_PITCH, MAX_PITCH)
      const elapsed = Math.max(1, now - drag.t)
      velocityRef.current = { yaw: (dx * 0.006) / elapsed, pitch: (dy * 0.006) / elapsed }
    },
    [cropMode],
  )

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = event.currentTarget
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      if (cropMode) {
        const start = selectionStartRef.current
        selectionStartRef.current = null
        setSelection(null)
        if (!start) return
        const rect = canvas.getBoundingClientRect()
        const current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const cssRect: CssRect = {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          w: Math.abs(current.x - start.x),
          h: Math.abs(current.y - start.y),
        }
        if (cssRect.w < MIN_CROP_SIZE || cssRect.h < MIN_CROP_SIZE) return
        const dataUrl = captureCanvasRegion(canvas, cssRect, rect)
        if (dataUrl) onCropCapture(dataUrl)
        else message.error('框选区域截取失败，可能是跨域图片无法读取像素')
        return
      }
      dragRef.current = null
    },
    [cropMode, onCropCapture],
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      updateFov(fovRef.current + event.deltaY * 0.03)
    },
    [updateFov],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      // 方向键与拖拽保持一致：上键看上、下键看下（pitch++ = 看向上）
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
    <div className="canvas-panorama-webgl-wrap">
      <canvas
        ref={canvasRef}
        className={`canvas-panorama-webgl${cropMode ? ' is-crop-mode' : ''}`}
        tabIndex={0}
        role="img"
        aria-label="360 全景预览，可拖拽、滚轮缩放或使用方向键查看；框选截图模式下可拖拽截取局部区域"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
      {selection && selection.w > 0 && selection.h > 0 && (
        <div
          className="canvas-panorama-crop-box"
          style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
        />
      )}
    </div>
  )
}

export function CanvasPanoramaViewerModal({
  node,
  open,
  onClose,
  onScreenshot,
  onCrop,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onScreenshot: (dataUrl: string, sourceNode: CanvasNode, pose: PanoramaPose) => Promise<void>
  onCrop: (dataUrl: string, sourceNode: CanvasNode, pose: PanoramaPose) => Promise<void>
}) {
  const [fov, setFov] = useState(DEFAULT_FOV)
  const [loadState, setLoadState] = useState<PanoramaLoadState>('idle')
  const [autorotate, setAutorotate] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [pose, setPose] = useState<PanoramaPose>({ yaw: 0, pitch: 0, fov: DEFAULT_FOV })
  const [fullscreen, setFullscreen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<PanoramaViewerHandle | null>(null)
  // 最新 pose 的 ref：渲染循环每帧写入 ref，低频（节流）回灌 state，避免每帧 setState
  // 触发父级重渲染 → 重新生成传给 viewer 的回调 → WebGL effect 反复销毁重建（黑屏/无限加载）。
  const poseRef = useRef<PanoramaPose>({ yaw: 0, pitch: 0, fov: DEFAULT_FOV })
  const poseFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    setCropMode(false)
    setPose({ yaw: 0, pitch: 0, fov: DEFAULT_FOV })
    poseRef.current = { yaw: 0, pitch: 0, fov: DEFAULT_FOV }
    setFullscreen(false)
  }, [open, src])

  useEffect(() => {
    return () => {
      if (poseFlushTimerRef.current) clearTimeout(poseFlushTimerRef.current)
    }
  }, [])

  // 框选截图模式下按 Esc 取消框选（而不是关闭弹窗），与全局 Esc-关闭保持区分
  useEffect(() => {
    if (!open || !cropMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCropMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, cropMode])

  // 真·全屏：优先用 Fullscreen API 让外壳铺满整块屏幕；浏览器/环境不支持时
  // 回退到纯 CSS 沉浸模式（隐藏顶栏/罗盘/提示）。fullscreenchange 负责同步状态，
  // 这样按 Esc 退出系统全屏也能正确收回 UI。
  useEffect(() => {
    const handleFsChange = () => {
      setFullscreen(document.fullscreenElement === shellRef.current)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // 关闭模态时若仍处于系统全屏，主动退出，避免残留全屏态
  useEffect(() => {
    if (!open && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined)
    }
  }, [open])

  const toggleFullscreen = useCallback(() => {
    const el = shellRef.current
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => setFullscreen(false))
      return
    }
    if (el?.requestFullscreen) {
      void el.requestFullscreen().catch(() => setFullscreen((value) => !value))
      return
    }
    // 不支持 Fullscreen API：退回 CSS 沉浸模式
    setFullscreen((value) => !value)
  }, [])

  // —— 全部用 useCallback 稳定引用，保证传给 PanoramaWebglViewer 的回调恒定，
  // 从而其内部 WebGL 初始化 effect 只在 src 变化时执行一次。 ——
  const handleFovChange = useCallback((nextFov: number) => {
    setFov(nextFov)
  }, [])

  const handleLoadState = useCallback((state: PanoramaLoadState) => {
    setLoadState(state)
  }, [])

  const handlePoseChange = useCallback((nextPose: PanoramaPose) => {
    // 渲染循环高频调用：先写 ref，再节流（约每 80ms）回灌 state 供罗盘/读数显示
    poseRef.current = nextPose
    if (poseFlushTimerRef.current) return
    poseFlushTimerRef.current = setTimeout(() => {
      poseFlushTimerRef.current = null
      setPose(poseRef.current)
    }, 80)
  }, [])

  const handleReady = useCallback((handle: PanoramaViewerHandle | null) => {
    handleRef.current = handle
  }, [])

  // 进入框选模式时顺带停掉自动环视，避免拖框过程中画面漂移导致截取的内容和框选时看到的不一致
  const toggleCropMode = useCallback(() => {
    setCropMode((value) => {
      const next = !value
      if (next) setAutorotate(false)
      return next
    })
  }, [])

  const handleCropCapture = useCallback(
    async (dataUrl: string) => {
      if (!node) return
      setCropMode(false)
      await onCrop(dataUrl, node, poseRef.current)
    },
    [node, onCrop],
  )

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={null}
      centered
      destroyOnHidden
      width="80vw"
      rootClassName="canvas-panorama-root"
      wrapClassName="canvas-panorama-wrap"
      className={`canvas-panorama-modal${fullscreen ? ' canvas-panorama-modal-fullscreen' : ''}`}
      styles={{
        body: { padding: 0, height: '80vh' },
      }}
    >
      <div className="canvas-panorama-shell" ref={shellRef}>
        <div className="canvas-panorama-topbar">
          <div className="canvas-panorama-titlebox">
            <div className="canvas-panorama-kicker">360° Panorama Preview</div>
            <div className="canvas-panorama-title">{node?.title ?? '360 全景预览'}</div>
          </div>
          <div className="canvas-panorama-topbar-actions">
            <span className="canvas-panorama-meta">{aspectLabel}</span>
            <Button
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              onClick={toggleFullscreen}
            >
              {fullscreen ? '退出全屏' : '沉浸全屏'}
            </Button>
            <Button icon={<Icons.X size={14} />} onClick={onClose} />
          </div>
        </div>

        <div className="canvas-panorama-stage">
          {src && (
            <PanoramaWebglViewer
              src={src}
              fov={fov}
              autorotate={autorotate}
              cropMode={cropMode}
              onFovChange={handleFovChange}
              onLoadState={handleLoadState}
              onPoseChange={handlePoseChange}
              onReady={handleReady}
              onCropCapture={handleCropCapture}
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

          <div className="canvas-panorama-hint">
            {cropMode
              ? '拖拽框选想要截取的区域 · 松开鼠标即生成 · Esc 取消框选'
              : '拖拽 / 触控滑动查看方向 · 滚轮 / 滑杆缩放 · 方向键环视 · +/- 缩放'}
          </div>
        </div>

        <div className="canvas-panorama-toolbar">
          <Button icon={<Icons.RotateCcw size={14} />} onClick={() => handleRef.current?.reset()}>
            重置
          </Button>
          <div className="canvas-panorama-switch">
            <span>自动环视</span>
            <Switch size="middle" checked={autorotate} onChange={setAutorotate} />
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
            type={cropMode ? 'primary' : 'default'}
            disabled={!canCapture}
            icon={<Icons.Crop size={14} />}
            onClick={toggleCropMode}
          >
            {cropMode ? '取消框选' : '框选截图'}
          </Button>
          <Button
            type="primary"
            disabled={!canCapture}
            icon={<Icons.Image size={14} />}
            onClick={async () => {
              if (!node) return
              const dataUrl = handleRef.current?.screenshot()
              if (!dataUrl) return
              await onScreenshot(dataUrl, node, poseRef.current)
            }}
          >
            截图生成场景图
          </Button>
        </div>
      </div>
    </Modal>
  )
}
