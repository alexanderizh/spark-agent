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
  Billboard,
  Grid,
  OrbitControls,
  Text,
  TransformControls,
  useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import { normalizeEduAssetUrl } from '@spark/shared'
import type { Stage3DActor, Stage3DData, Stage3DProp } from './stage3d.types'
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
  /** 用取景相机视角渲染一帧，返回 PNG dataURL（按画幅裁切） */
  screenshot: () => string | null
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
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      normalizeEduAssetUrl(url),
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        if (equirect) tex.mapping = THREE.EquirectangularReflectionMapping
        tex.colorSpace = THREE.SRGBColorSpace
        setTexture(tex)
      },
      undefined,
      () => {
        if (!disposed) setTexture(null)
      },
    )
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
      <Billboard position={[0, top + 0.22, 0]}>
        <Text fontSize={0.18} color="#e2e8f0" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#0f172a">
          {actor.name}
        </Text>
      </Billboard>
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
  onReady: (fn: () => string | null) => void
}) {
  const { gl, scene, camera: r3fCamera, size } = useThree()

  useEffect(() => {
    const fn = (): string | null => {
      try {
        const ratio = STAGE3D_ASPECT_RATIO[data.camera.aspect]
        // 输出分辨率：以 1600 长边为基准，按画幅换算
        const outW = ratio >= 1 ? 1600 : Math.round(1600 * ratio)
        const outH = ratio >= 1 ? Math.round(1600 / ratio) : 1600
        const cam = new THREE.PerspectiveCamera(data.camera.fov, ratio, 0.1, 200)
        cam.position.set(...data.camera.position)
        cam.lookAt(new THREE.Vector3(...data.camera.target))
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
  const screenshotFnRef = useRef<(() => string | null) | null>(null)

  useImperativeHandle(ref, () => ({
    screenshot: () => screenshotFnRef.current?.() ?? null,
  }))

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [4.5, 3, 6], fov: 45 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[5, 8, 4]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 3, -5]} intensity={0.4} />
      {/* 不用 drei Environment：其 preset 会从 CDN 拉 HDR，被 CSP/离线环境拦截；用半球光补环境光 */}
      <hemisphereLight args={['#bcd4ff', '#3a3428', 0.5]} />

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
  )
})
