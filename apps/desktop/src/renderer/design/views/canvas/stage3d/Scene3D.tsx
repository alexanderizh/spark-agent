import {
  Component,
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  Grid,
  Html,
  OrbitControls,
  TransformControls,
  useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import { normalizeEduAssetUrl } from '@spark/shared'
import type {
  Stage3DActor,
  Stage3DCamera,
  Stage3DData,
  Stage3DLighting,
  Stage3DLightingPreset,
  Stage3DProp,
} from './stage3d.types'
import { STAGE3D_ASPECT_RATIO } from './stage3d.types'
import { findGlbAsset } from './propRegistry'
import { MannequinRig, mannequinTopHeight } from './MannequinRig'

/**
 * 3D 场景：主视口（OrbitControls）+ 人偶 + 道具 + 背景三模式 + 取景相机对象。
 *
 * 截图：通过 ref 暴露 screenshot()，用取景相机视角渲染一帧后 toDataURL。
 * Canvas 开启 preserveDrawingBuffer 才能在 rAF 之外可靠读取像素。
 */

export type Scene3DHandle = {
  /**
   * 渲染一帧返回 PNG dataURL（按画幅裁切）。
   * 不传参用 data.camera（当前工作机位）；传入 cam 时用指定机位（批量导出各镜头用）。
   */
  screenshot: (cam?: Stage3DCamera) => string | null
}

export type Scene3DProps = {
  data: Stage3DData
  /** 是否以取景相机视角预览（否则自由 Orbit 视角） */
  cameraPreview: boolean
  onSelect: (id: string | null) => void
  onActorTransform: (id: string, position: [number, number, number], rotationY: number) => void
  onPropTransform: (id: string, position: [number, number, number], rotationY: number) => void
  onCameraTransform: (position: [number, number, number], target: [number, number, number]) => void
  transformMode: 'translate' | 'rotate'
}

// ─────────────────────────── 三点布光 ───────────────────────────

type LightSpec = {
  /** key/fill/back 三盏方向光的位置与相对强度 */
  key: { position: [number, number, number]; intensity: number }
  fill: { position: [number, number, number]; intensity: number }
  back: { position: [number, number, number]; intensity: number }
  ambient: number
}

/**
 * 每种预设换算为一组明显不同的 key/fill/back 方向光组合，
 * 让取景预览真能看出光影差异（非纯文字）。位置以场景中心（人偶约 1m 高）为参照。
 */
const LIGHTING_SPECS: Record<Stage3DLightingPreset, LightSpec> = {
  // 经典三点布光：主光偏前侧上方，补光对侧较弱，背光勾边
  studio: {
    key: { position: [5, 6, 5], intensity: 1.2 },
    fill: { position: [-5, 3, 4], intensity: 0.45 },
    back: { position: [-2, 6, -6], intensity: 0.7 },
    ambient: 0.5,
  },
  // 顺光：主光几乎正对主体、来自镜头方向，阴影少
  front: {
    key: { position: [0, 3.5, 8], intensity: 1.35 },
    fill: { position: [3, 3, 6], intensity: 0.5 },
    back: { position: [0, 6, -5], intensity: 0.25 },
    ambient: 0.6,
  },
  // 侧光：强主光来自单侧，明暗对比强
  side: {
    key: { position: [8, 4, 1], intensity: 1.5 },
    fill: { position: [-6, 2, 2], intensity: 0.25 },
    back: { position: [-2, 6, -5], intensity: 0.35 },
    ambient: 0.4,
  },
  // 逆光：主光来自主体后方，正面补光弱，剪影感
  back: {
    key: { position: [0, 5, -8], intensity: 1.6 },
    fill: { position: [0, 3, 6], intensity: 0.3 },
    back: { position: [4, 6, -6], intensity: 0.6 },
    ambient: 0.35,
  },
  // 轮廓光：强逆侧光勾边 + 弱正面补光
  rim: {
    key: { position: [-6, 5, -6], intensity: 1.7 },
    fill: { position: [0, 3, 6], intensity: 0.35 },
    back: { position: [6, 5, -5], intensity: 1.1 },
    ambient: 0.3,
  },
  // 顶光：主光从正上方压下
  top: {
    key: { position: [0, 10, 0.5], intensity: 1.5 },
    fill: { position: [3, 3, 4], intensity: 0.35 },
    back: { position: [-3, 6, -5], intensity: 0.4 },
    ambient: 0.4,
  },
  // 默认（原固定布光的观感）
  none: {
    key: { position: [5, 8, 4], intensity: 1.1 },
    fill: { position: [-4, 3, -5], intensity: 0.4 },
    back: { position: [-2, 6, -6], intensity: 0.3 },
    ambient: 0.55,
  },
}

function LightingRig({ lighting }: { lighting: Stage3DLighting | undefined }) {
  const preset = lighting?.preset ?? 'studio'
  const mul = lighting?.intensity ?? 1
  const spec = LIGHTING_SPECS[preset] ?? LIGHTING_SPECS.studio
  return (
    <>
      <ambientLight intensity={spec.ambient * mul} />
      <directionalLight
        position={spec.key.position}
        intensity={spec.key.intensity * mul}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={spec.fill.position} intensity={spec.fill.intensity * mul} />
      <directionalLight position={spec.back.position} intensity={spec.back.intensity * mul} />
      {/* 不用 drei Environment：其 preset 会从 CDN 拉 HDR，被 CSP/离线环境拦截；用半球光补环境光 */}
      <hemisphereLight args={['#bcd4ff', '#3a3428', 0.4 * mul]} />
    </>
  )
}

// ─────────────────────────── 背景 ───────────────────────────

/**
 * 加载贴图。equirect=true 时用于全景球。
 * 只在异步回调里 setState，避免 effect 内同步 setState 的级联渲染。
 */
function useStageTexture(url: string | undefined, equirect: boolean): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) {
      // 异步清空，规避同步 setState-in-effect
      const t = setTimeout(() => setTexture(null), 0)
      return () => clearTimeout(t)
    }
    let disposed = false
    const src = normalizeEduAssetUrl(url)

    const finish = (tex: THREE.Texture) => {
      if (disposed) {
        tex.dispose()
        return
      }
      if (equirect) tex.mapping = THREE.EquirectangularReflectionMapping
      tex.colorSpace = THREE.SRGBColorSpace
      setTexture(tex)
    }

    // 先尝试带 crossOrigin（保证截图 toDataURL 不被污染）；本地 safe-file:// 等
    // 无 CORS 头的资源会加载失败，失败后去掉 crossOrigin 重试一次（与全景查看器
    // CanvasPanoramaViewerModal 的降级策略一致），否则背景图永远加载不出来。
    const loadWithCrossOrigin = (crossOrigin: string) => {
      const loader = new THREE.TextureLoader()
      if (crossOrigin) loader.setCrossOrigin(crossOrigin)
      loader.load(
        src,
        finish,
        undefined,
        () => {
          if (disposed) return
          if (crossOrigin) {
            loadWithCrossOrigin('')
            return
          }
          setTexture(null)
        },
      )
    }
    loadWithCrossOrigin('anonymous')

    return () => {
      disposed = true
    }
  }, [url, equirect])
  return texture
}

function Backdrop({ data }: { data: Stage3DData }) {
  const { backdrop } = data
  const panoTexture = useStageTexture(
    backdrop.mode === 'panorama' ? backdrop.imageUrl : undefined,
    true,
  )
  const backdropTexture = useStageTexture(
    backdrop.mode === 'backdrop' ? backdrop.imageUrl : undefined,
    false,
  )

  if (backdrop.mode === 'panorama') {
    return (
      <group rotation={[0, backdrop.rotationY ?? 0, 0]}>
        {panoTexture ? (
          <mesh scale={[-1, 1, 1]}>
            <sphereGeometry args={[50, 48, 32]} />
            <meshBasicMaterial map={panoTexture} side={THREE.BackSide} />
          </mesh>
        ) : (
          <mesh>
            <sphereGeometry args={[50, 24, 16]} />
            <meshBasicMaterial color="#0b1220" side={THREE.BackSide} />
          </mesh>
        )}
        <gridHelper args={[40, 40, '#334155', '#1e293b']} position={[0, 0.01, 0]} />
      </group>
    )
  }

  if (backdrop.mode === 'backdrop') {
    const dist = backdrop.backdropDistance ?? 8
    return (
      <group>
        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellColor="#334155"
          sectionSize={2}
          sectionColor="#475569"
          infiniteGrid
          fadeDistance={30}
          position={[0, 0, 0]}
        />
        <group rotation={[0, backdrop.rotationY ?? 0, 0]}>
          <mesh position={[0, 3, -dist]}>
            <planeGeometry args={[dist * 2.2, dist * 1.3]} />
            {backdropTexture ? (
              <meshBasicMaterial map={backdropTexture} side={THREE.DoubleSide} />
            ) : (
              <meshStandardMaterial color="#1e293b" side={THREE.DoubleSide} />
            )}
          </mesh>
        </group>
      </group>
    )
  }

  // grid（默认）
  return (
    <Grid
      args={[40, 40]}
      cellSize={0.5}
      cellColor="#334155"
      sectionSize={2}
      sectionColor="#475569"
      infiniteGrid
      fadeDistance={30}
    />
  )
}

// ─────────────────────────── 人偶 ───────────────────────────

function ActorObject({
  actor,
  selected,
  onSelect,
}: {
  actor: Stage3DActor
  selected: boolean
  onSelect: () => void
}) {
  const top = mannequinTopHeight(actor)
  return (
    <group
      position={actor.position}
      rotation={[0, actor.rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
    >
      <MannequinRig actor={actor} />
      {selected && (
        <mesh position={[0, top / 2, 0]}>
          <boxGeometry args={[0.9, top, 0.9]} />
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.35} />
        </mesh>
      )}
      {/* 名字标签用 drei Html（DOM 元素）而非 drei Text/troika —— troika 会从
          CDN 拉字体（unicode-font-resolver），被本应用 CSP connect-src 拦截，会挂起
          Suspense/抛异常并炸穿整个 Canvas。DOM 标签无网络请求、支持中文，稳。 */}
      <Html
        position={[0, top + 0.22, 0]}
        center
        distanceFactor={8}
        zIndexRange={[20, 0]}
        pointerEvents="none"
        occlude={false}
      >
        <div className="stage3d-actor-label">{actor.name}</div>
      </Html>
    </group>
  )
}

// ─────────────────────────── 道具 ───────────────────────────

/** GLB 加载中 / 失败 / 资产缺失时的占位盒 */
function GlbPlaceholder({ selected, failed }: { selected: boolean; failed?: boolean }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial
          color={failed ? '#7f1d1d' : '#94a3b8'}
          roughness={0.75}
          metalness={0.05}
        />
      </mesh>
      {selected && (
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  )
}

/**
 * GLB 加载失败兜底：useGLTF（Suspense 资源）加载出错会向上抛，
 * 用 error boundary 捕获后渲染红色占位盒，不拖垮整个 Canvas。
 */
class GlbErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * GLB 模型：drei useGLTF 加载（按 url 全局缓存），每实例 clone —— three 的
 * 场景图节点不能同时挂在多个父节点下；clone 后 geometry/material 仍共享，开销低。
 * 附带一个按包围盒撑满的透明命中体，保证低多边形镂空模型也有可靠的点击区域。
 */
function GlbModel({ url, selected }: { url: string; selected: boolean }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
    return c
  }, [scene])

  const { size, center } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned)
    const s = box.getSize(new THREE.Vector3())
    return {
      size: [Math.max(s.x, 0.2), Math.max(s.y, 0.2), Math.max(s.z, 0.2)] as const,
      center: box.getCenter(new THREE.Vector3()),
    }
  }, [cloned])

  return (
    <group>
      <primitive object={cloned} />
      {/* 透明命中体（opacity 0 但参与 raycast），兼作选中框定位参照 */}
      <mesh position={center}>
        <boxGeometry args={[size[0], size[1], size[2]]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh position={center}>
          <boxGeometry args={[size[0] * 1.05, size[1] * 1.05, size[2] * 1.05]} />
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  )
}

function GlbPropContent({ prop, selected }: { prop: Stage3DProp; selected: boolean }) {
  const asset = findGlbAsset(prop.assetId)
  if (!asset?.url) return <GlbPlaceholder selected={selected} failed />
  return (
    <GlbErrorBoundary fallback={<GlbPlaceholder selected={selected} failed />}>
      <Suspense fallback={<GlbPlaceholder selected={selected} />}>
        <GlbModel url={asset.url} selected={selected} />
      </Suspense>
    </GlbErrorBoundary>
  )
}

function PrimitivePropContent({ prop, selected }: { prop: Stage3DProp; selected: boolean }) {
  const color = prop.color ?? '#cbd5e1'
  const geometry = useMemo(() => {
    switch (prop.assetId) {
      case 'cylinder':
        return <cylinderGeometry args={[0.4, 0.4, 0.8, 24]} />
      case 'sphere':
        return <sphereGeometry args={[0.5, 24, 24]} />
      case 'plane':
        return <boxGeometry args={[1.5, 0.04, 1.5]} />
      case 'box':
      default:
        return <boxGeometry args={[0.8, 0.8, 0.8]} />
    }
  }, [prop.assetId])

  return (
    <>
      <mesh castShadow receiveShadow>
        {geometry}
        <meshStandardMaterial color={color} roughness={0.75} metalness={0.05} />
      </mesh>
      {selected && (
        <mesh>
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </>
  )
}

function PropObject({
  prop,
  selected,
  onSelect,
}: {
  prop: Stage3DProp
  selected: boolean
  onSelect: () => void
}) {
  // 点击落在 GLB 子网格上时事件冒泡到本 group → 选中 / TransformControls 行为与 primitive 一致
  return (
    <group
      position={prop.position}
      rotation={[0, prop.rotationY, 0]}
      scale={[prop.scale, prop.scale, prop.scale]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
    >
      {prop.kind === 'glb' ? (
        <GlbPropContent prop={prop} selected={selected} />
      ) : (
        <PrimitivePropContent prop={prop} selected={selected} />
      )}
    </group>
  )
}

// ─────────────────────────── 取景相机对象 + 视锥 ───────────────────────────

function FramingCameraObject({
  data,
  selected,
  onSelect,
}: {
  data: Stage3DData
  selected: boolean
  onSelect: () => void
}) {
  const { camera } = data
  const [px, py, pz] = camera.position
  const [tx, ty, tz] = camera.target

  // 视锥线框：从相机指向 target 的方向，画一段四棱锥
  const geom = useMemo(() => {
    const pos = new THREE.Vector3(px, py, pz)
    const target = new THREE.Vector3(tx, ty, tz)
    const dir = target.clone().sub(pos).normalize()
    const len = Math.min(target.distanceTo(pos), 6) || 3
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(dir, up).normalize()
    const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize()
    const halfV = Math.tan((camera.fov * Math.PI) / 360) * len
    const halfH = halfV * STAGE3D_ASPECT_RATIO[camera.aspect]
    const center = pos.clone().add(dir.clone().multiplyScalar(len))
    const corner = (sh: number, sv: number) =>
      center
        .clone()
        .add(right.clone().multiplyScalar(halfH * sh))
        .add(trueUp.clone().multiplyScalar(halfV * sv))
    const corners = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]
    const pts: THREE.Vector3[] = []
    for (const c of corners) pts.push(pos.clone(), c.clone())
    for (let i = 0; i < corners.length; i += 1) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      if (a && b) pts.push(a.clone(), b.clone())
    }
    const g = new THREE.BufferGeometry()
    g.setFromPoints(pts)
    return g
  }, [camera.aspect, camera.fov, px, py, pz, tx, ty, tz])

  return (
    <group>
      <group
        position={camera.position}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
      >
        <mesh>
          <boxGeometry args={[0.28, 0.2, 0.32]} />
          <meshStandardMaterial color={selected ? '#f5a623' : '#fbbf24'} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.12, 16]} />
          <meshStandardMaterial color="#78350f" />
        </mesh>
      </group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color={selected ? '#f5a623' : '#fbbf24'} transparent opacity={0.8} />
      </lineSegments>
    </group>
  )
}

// ─────────────────────────── 变换控制器桥接 ───────────────────────────

/** 选中对象的 TransformControls，拖拽时禁用 OrbitControls。 */
function SelectedTransform({
  data,
  transformMode,
  orbitRef,
  onActorTransform,
  onPropTransform,
  onCameraTransform,
}: {
  data: Stage3DData
  transformMode: 'translate' | 'rotate'
  orbitRef: React.MutableRefObject<{ enabled: boolean } | null>
  onActorTransform: Scene3DProps['onActorTransform']
  onPropTransform: Scene3DProps['onPropTransform']
  onCameraTransform: Scene3DProps['onCameraTransform']
}) {
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  const proxyRef = useRef<THREE.Object3D | null>(null)
  const activeId = data.activeId

  const target = useMemo(() => {
    if (!activeId) return null
    if (activeId === 'camera') return { type: 'camera' as const }
    const actor = data.actors.find((a) => a.id === activeId)
    if (actor) return { type: 'actor' as const, actor }
    const prop = data.props.find((p) => p.id === activeId)
    if (prop) return { type: 'prop' as const, prop }
    return null
  }, [activeId, data.actors, data.props])

  // 同步代理对象位置到选中项
  useEffect(() => {
    const obj = proxyRef.current
    if (!obj || !target) return
    if (target.type === 'camera') {
      obj.position.set(...data.camera.position)
      obj.rotation.set(0, 0, 0)
    } else if (target.type === 'actor') {
      obj.position.set(...target.actor.position)
      obj.rotation.set(0, target.actor.rotationY, 0)
    } else {
      obj.position.set(...target.prop.position)
      obj.rotation.set(0, target.prop.rotationY, 0)
    }
  }, [target, data.camera.position])

  if (!target) return null
  // 相机对象只允许移动（旋转由「相机对准」/目标点驱动，避免语义混乱）
  const mode = target.type === 'camera' ? 'translate' : transformMode

  const handleChange = () => {
    const obj = proxyRef.current
    if (!obj || !target) return
    const p: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z]
    if (target.type === 'camera') {
      // 相机移动时保持看向原 target
      onCameraTransform(p, data.camera.target)
    } else if (target.type === 'actor') {
      onActorTransform(target.actor.id, [p[0], Math.max(0, p[1]), p[2]], obj.rotation.y)
    } else {
      onPropTransform(target.prop.id, p, obj.rotation.y)
    }
  }

  return (
    <>
      <object3D
        ref={(o) => {
          proxyRef.current = o
          setProxy(o)
        }}
      />
      {proxy && (
        <TransformControls
          object={proxy}
          mode={mode}
          showY={mode === 'translate' ? target.type === 'prop' || target.type === 'camera' : false}
          onObjectChange={handleChange}
          onMouseDown={() => {
            if (orbitRef.current) orbitRef.current.enabled = false
          }}
          onMouseUp={() => {
            if (orbitRef.current) orbitRef.current.enabled = true
          }}
        />
      )}
    </>
  )
}

// ─────────────────────────── 截图桥接 ───────────────────────────

function ScreenshotBridge({
  data,
  cameraPreview,
  onReady,
}: {
  data: Stage3DData
  cameraPreview: boolean
  onReady: (fn: (cam?: Stage3DCamera) => string | null) => void
}) {
  const { gl, scene, camera: r3fCamera, size } = useThree()

  useEffect(() => {
    const fn = (camOverride?: Stage3DCamera): string | null => {
      try {
        const shotCam = camOverride ?? data.camera
        const ratio = STAGE3D_ASPECT_RATIO[shotCam.aspect]
        // 输出分辨率：以 1600 长边为基准，按画幅换算
        const outW = ratio >= 1 ? 1600 : Math.round(1600 * ratio)
        const outH = ratio >= 1 ? Math.round(1600 / ratio) : 1600
        const cam = new THREE.PerspectiveCamera(shotCam.fov, ratio, 0.1, 200)
        cam.position.set(...shotCam.position)
        cam.lookAt(new THREE.Vector3(...shotCam.target))
        cam.updateProjectionMatrix()

        // 离屏渲染到 render target，再读像素回 2D canvas → 干净的定尺寸 PNG，
        // 不受主视口尺寸/画幅影响。
        const rt = new THREE.WebGLRenderTarget(outW, outH, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        })
        const prevTarget = gl.getRenderTarget()
        gl.setRenderTarget(rt)
        gl.render(scene, cam)
        const buffer = new Uint8Array(outW * outH * 4)
        gl.readRenderTargetPixels(rt, 0, 0, outW, outH, buffer)
        gl.setRenderTarget(prevTarget)
        gl.render(scene, r3fCamera)

        const out = document.createElement('canvas')
        out.width = outW
        out.height = outH
        const ctx = out.getContext('2d')
        if (!ctx) {
          rt.dispose()
          return null
        }
        const imageData = ctx.createImageData(outW, outH)
        // readRenderTargetPixels 原点在左下，2D canvas 原点在左上 → 逐行翻转
        for (let y = 0; y < outH; y += 1) {
          const srcRow = (outH - 1 - y) * outW * 4
          const dstRow = y * outW * 4
          imageData.data.set(buffer.subarray(srcRow, srcRow + outW * 4), dstRow)
        }
        ctx.putImageData(imageData, 0, 0)
        rt.dispose()
        return out.toDataURL('image/png')
      } catch {
        return null
      }
    }
    onReady(fn)
  }, [data.camera, gl, scene, r3fCamera, onReady, size, cameraPreview])

  return null
}

/** 主视口相机随「取景预览」切换 */
function ViewportCameraSync({ data, cameraPreview }: { data: Stage3DData; cameraPreview: boolean }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!cameraPreview) return
    if (camera instanceof THREE.PerspectiveCamera) {
      // 直接改 three 相机是 R3F 命令式惯例（相机实例由渲染器管理，非 React state）
      // eslint-disable-next-line react-hooks/immutability
      camera.fov = data.camera.fov
      camera.position.set(...data.camera.position)
      camera.lookAt(new THREE.Vector3(...data.camera.target))
      camera.updateProjectionMatrix()
    }
  }, [cameraPreview, data.camera, camera])
  return null
}

// ─────────────────────────── 视口错误边界（就地兜底，避免炸穿全局 Shell） ───────────────────────────

/**
 * DOM 级错误边界：包住整个 R3F <Canvas>。R3F 内部任何组件（Text/GLB/Suspense…）
 * 抛错时，React 会把异常沿组件树上抛——若无此边界会一路冒到全局 Shell ErrorBoundary，
 * 表现为整个应用白屏。此处就地捕获，在视口内显示中文错误 + 堆栈摘要，方便定位。
 */
class ViewportErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    // 保留控制台记录，便于开发环境排查
    // eslint-disable-next-line no-console
    console.error('[stage3d] 3D 视口渲染出错：', error)
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="stage3d-viewport-error">
          <div className="stage3d-viewport-error-title">3D 视口渲染出错</div>
          <div className="stage3d-viewport-error-msg">{this.state.error.message}</div>
          {this.state.error.stack && (
            <pre className="stage3d-viewport-error-stack">
              {this.state.error.stack.split('\n').slice(0, 6).join('\n')}
            </pre>
          )}
          <div className="stage3d-viewport-error-hint">
            左右面板仍可用；关闭并重新打开可重置视口。
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(function Scene3D(
  {
    data,
    cameraPreview,
    onSelect,
    onActorTransform,
    onPropTransform,
    onCameraTransform,
    transformMode,
  },
  ref,
) {
  const orbitRef = useRef<{ enabled: boolean } | null>(null)
  const screenshotFnRef = useRef<((cam?: Stage3DCamera) => string | null) | null>(null)

  useImperativeHandle(ref, () => ({
    screenshot: (cam?: Stage3DCamera) => screenshotFnRef.current?.(cam) ?? null,
  }))

  return (
    <ViewportErrorBoundary>
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [4.5, 3, 6], fov: 45 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#0b1220']} />
      <LightingRig lighting={data.lighting} />

      <Backdrop data={data} />

      {data.actors.map((actor) => (
        <ActorObject
          key={actor.id}
          actor={actor}
          selected={data.activeId === actor.id}
          onSelect={() => onSelect(actor.id)}
        />
      ))}

      {data.props.map((prop) => (
        <PropObject
          key={prop.id}
          prop={prop}
          selected={data.activeId === prop.id}
          onSelect={() => onSelect(prop.id)}
        />
      ))}

      {!cameraPreview && (
        <FramingCameraObject
          data={data}
          selected={data.activeId === 'camera'}
          onSelect={() => onSelect('camera')}
        />
      )}

      {!cameraPreview && (
        <SelectedTransform
          data={data}
          transformMode={transformMode}
          orbitRef={orbitRef}
          onActorTransform={onActorTransform}
          onPropTransform={onPropTransform}
          onCameraTransform={onCameraTransform}
        />
      )}

      <ViewportCameraSync data={data} cameraPreview={cameraPreview} />
      <ScreenshotBridge
        data={data}
        cameraPreview={cameraPreview}
        onReady={(fn) => {
          screenshotFnRef.current = fn
        }}
      />

      <OrbitControls
        ref={orbitRef as unknown as React.Ref<never>}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enabled={!cameraPreview}
        {...(cameraPreview ? { target: new THREE.Vector3(...data.camera.target) } : {})}
      />
    </Canvas>
    </ViewportErrorBoundary>
  )
})
