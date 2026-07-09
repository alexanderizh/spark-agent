import {
  Component,
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { Grid, Html, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { message } from 'antd'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
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
import { rotationYFromQuaternion } from './rotationY'
import { createStage3DLocalModelRuntimeUrl } from './localModelImport'
import { mannequinTopHeight } from './MannequinRig'
import { MixamoActorRig } from './MixamoActorRig'
import { UE4ActorRig } from './UE4ActorRig'
import { getStage3DActorModel } from './actorModelRegistry'
import { PoseGizmo } from './PoseGizmo'
import { BODY_METRICS, poseGroundOffset, type JointId, type Vec3 } from './mannequin'

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
  onCrowdTransform: (crowdId: string, position: [number, number, number], rotationY: number) => void
  onPropTransform: (id: string, position: [number, number, number], rotationY: number) => void
  onCameraTransform: (position: [number, number, number], target: [number, number, number]) => void
  transformMode: 'translate' | 'rotate'
  /** 吸附对齐：开启时 translationSnap=0.25（半格）、rotationSnap=15° */
  snap: boolean
  /** 摆姿势模式（T2）：为选中人偶渲染 PoseGizmo、隐藏其整体移动/旋转 gizmo */
  poseMode?: boolean | undefined
  /** 摆姿势模式下写回某关节最终欧拉角（弧度） */
  onActorJointEuler?: ((actorId: string, jointId: JointId, euler: Vec3) => void) | undefined
  /** 双击人偶进入摆姿势模式 */
  onActorDoubleClick?: ((actorId: string) => void) | undefined
  /** 环/IK 拖拽结束（pointerup）时触发一次，供上层落一条 undo 快照（T3） */
  onActorPoseDragCommit?: ((actorId: string) => void) | undefined
  /** 环/IK 拖拽开始（pointerdown）时触发一次，供上层记录操作前快照（T3） */
  onActorPoseDragBegin?: ((actorId: string) => void) | undefined
  /**
   * 相机预设（R2a）：传入时把相机 position 与 OrbitControls target 设到预设机位——
   * target 基于 data.activeId 对应 actor.position（无人偶时回退场景中心）；
   * position 按 preset 偏移：front=+Z、side=+X、top=+Y、iso=+X+Y+Z 归一化。
   * 不传时完全维持现状（ViewportCameraSync 仍按 data.camera 自由/取景切换）。
   */
  cameraPreset?: 'front' | 'side' | 'top' | 'iso' | undefined
  /** 自由视口导航模式：orbit=左键环绕；pan=左键平移舞台视口 */
  viewNavigationMode?: 'orbit' | 'pan' | undefined
}

/**
 * drei OrbitControls 实例上我们实际用到的字段。
 * enabled 供 SelectedTransform 拖拽时临时禁用；target/update 供
 * ViewportCameraSync 在退出取景预览时把内部记账同步回恢复后的相机状态。
 */
type OrbitRefValue = { enabled: boolean; target: THREE.Vector3; update: () => void }

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

// 纹理上限：超大全景/背板先重采样到此尺寸内，避免超过 GPU MAX_TEXTURE_SIZE 后静默全黑。
// 与全景查看器 CanvasPanoramaViewerModal 的 MAX_TEXTURE_CAP 一致。
const MAX_TEXTURE_CAP = 8192

function isImageBitmapSource(source: HTMLImageElement | ImageBitmap): source is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap
}

function textureSourceSize(source: HTMLImageElement | ImageBitmap): {
  width: number
  height: number
} {
  if (isImageBitmapSource(source)) {
    return { width: source.width, height: source.height }
  }
  return {
    width: source.naturalWidth || source.width || 1,
    height: source.naturalHeight || source.height || 1,
  }
}

function makeImageTexture(
  source: HTMLImageElement | ImageBitmap,
  equirect: boolean,
): THREE.Texture {
  const tex = new THREE.Texture(source)
  if (equirect) tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

async function createTextureFromLoadedImage(
  image: HTMLImageElement,
  equirect: boolean,
): Promise<{ texture: THREE.Texture; bitmap: ImageBitmap | null }> {
  const { width, height } = textureSourceSize(image)
  const scale = Math.min(1, MAX_TEXTURE_CAP / Math.max(width, height, 1))
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  if (scale < 1 && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(image, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
      })
      return { texture: makeImageTexture(bitmap, equirect), bitmap }
    } catch {
      // Cross-origin images without CORS may fail to resize. Use the original image so preview
      // still works; screenshots may be unavailable for those remote assets.
    }
  }

  return { texture: makeImageTexture(image, equirect), bitmap: null }
}

/**
 * 加载贴图。全景背景必须允许远程图先正常预览，所以这里不再强制经 2D canvas
 * 重采样；跨域无 CORS 的图片会污染截图缓冲，但不会因此黑屏。
 * 只在异步回调里 setState，避免 effect 内同步 setState 的级联渲染。
 *
 * 加载策略：
 * 1) 带 crossOrigin='anonymous' 加载，safe-file:// 会返回 ACAO，截图仍可用；
 * 2) 失败后去掉 crossOrigin 重试，保证普通远程图片至少能作为预览背景显示。
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
    let activeTexture: THREE.Texture | null = null
    let activeBitmap: ImageBitmap | null = null

    const finish = (result: { texture: THREE.Texture; bitmap: ImageBitmap | null } | null) => {
      if (disposed) {
        result?.texture.dispose()
        result?.bitmap?.close()
        return
      }
      if (!result) {
        setTexture(null)
        message.error('背景图加载失败，请检查图片是否可用')
        return
      }
      activeTexture?.dispose()
      activeBitmap?.close()
      activeTexture = result.texture
      activeBitmap = result.bitmap
      setTexture(result.texture)
    }

    const loadImage = (withCors: boolean, onError: () => void) => {
      const img = new Image()
      img.onload = () => {
        if (disposed) return
        void createTextureFromLoadedImage(img, equirect)
          .then(finish)
          .catch(() => finish(null))
      }
      img.onerror = onError
      if (withCors) img.crossOrigin = 'anonymous'
      img.src = src
    }

    loadImage(true, () => loadImage(false, () => finish(null)))

    return () => {
      disposed = true
      activeTexture?.dispose()
      activeBitmap?.close()
    }
  }, [url, equirect])
  return texture
}

function PanoramaSceneBackground({
  texture,
  rotationY,
}: {
  texture: THREE.Texture | null
  rotationY: number
}) {
  const { gl, scene } = useThree()

  useEffect(() => {
    if (!texture) {
      scene.background = new THREE.Color('#0b1220')
      scene.backgroundRotation.set(0, 0, 0)
      gl.setClearColor('#0b1220', 1)
      return
    }

    scene.background = texture
    scene.backgroundBlurriness = 0
    scene.backgroundIntensity = 1
    scene.backgroundRotation.set(0, rotationY, 0)
    gl.setClearColor('#0b1220', 1)

    return () => {
      scene.background = new THREE.Color('#0b1220')
      scene.backgroundRotation.set(0, 0, 0)
      gl.setClearColor('#0b1220', 1)
    }
  }, [gl, rotationY, scene, texture])

  return null
}

function Backdrop({ data }: { data: Stage3DData }) {
  const { backdrop } = data
  const backdropTexture = useStageTexture(
    backdrop.mode === 'backdrop' || backdrop.mode === 'panorama' ? backdrop.imageUrl : undefined,
    backdrop.mode === 'panorama',
  )

  if (backdrop.mode === 'panorama') {
    return (
      <group>
        <PanoramaSceneBackground texture={backdropTexture} rotationY={backdrop.rotationY ?? 0} />
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

  // grid（默认背景）
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

class ActorRigErrorBoundary extends Component<
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

function ActorObject({
  actor,
  selected,
  poseMode,
  onSelect,
  onDoubleClick,
  onJointEuler,
  onGizmoDrag,
  onPoseDragCommit,
  onPoseDragBegin,
}: {
  actor: Stage3DActor
  selected: boolean
  /** 该 actor 处于摆姿势模式（选中 + 全局 poseMode） */
  poseMode: boolean
  onSelect: () => void
  onDoubleClick?: (() => void) | undefined
  onJointEuler?: ((jointId: JointId, euler: Vec3) => void) | undefined
  /** 拖拽环/IK 把手时禁用 OrbitControls */
  onGizmoDrag?: ((dragging: boolean) => void) | undefined
  /** 一次环/IK 拖拽提交（pointerup），供上层落 undo 快照 */
  onPoseDragCommit?: (() => void) | undefined
  /** 一次环/IK 拖拽开始（pointerdown），供上层记录操作前快照 */
  onPoseDragBegin?: (() => void) | undefined
}) {
  const top = mannequinTopHeight(actor)
  // 摆姿势模式：收集关节 group 世界变换，供 PoseGizmo 定位热点/环/IK 把手
  const jointRefs = useRef<Map<JointId, THREE.Group>>(new Map())
  const onJointRef = useMemo(
    () =>
      poseMode
        ? (jointId: JointId, group: THREE.Group | null) => {
            if (group) jointRefs.current.set(jointId, group)
            else jointRefs.current.delete(jointId)
          }
        : undefined,
    [poseMode],
  )
  // T1 留的腾空偏移：飞踢等离地姿势把整体抬离地面
  const metrics = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const groundOffset = poseGroundOffset(actor.pose, metrics) * actor.heightScale
  const pos: [number, number, number] = [
    actor.position[0],
    actor.position[1] + groundOffset,
    actor.position[2],
  ]
  const actorModel = getStage3DActorModel(actor.modelId)
  const fallbackRig =
    actorModel.rigType === 'ue4-mannequin' ? (
      <MixamoActorRig actor={actor} onJointRef={onJointRef} />
    ) : null
  return (
    <>
      <group
        position={pos}
        rotation={[0, actor.rotationY, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDoubleClick?.()
        }}
      >
        <ActorRigErrorBoundary key={actorModel.id} fallback={fallbackRig}>
          <Suspense fallback={null}>
            {actorModel.rigType === 'ue4-mannequin' ? (
              <UE4ActorRig actor={actor} onJointRef={onJointRef} />
            ) : (
              <MixamoActorRig actor={actor} onJointRef={onJointRef} />
            )}
          </Suspense>
        </ActorRigErrorBoundary>
        {selected && !poseMode && (
          <mesh position={[0, top / 2, 0]} userData={{ stage3dHelper: true }}>
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
      {/* PoseGizmo 挂在场景根（世界系）而非 actor 变换 group 下：
          Gizmo 每帧用关节 getWorldPosition 定位热点/环/IK，写的是本地坐标，
          必须让其本地空间 == 世界空间，否则会被 actor 的 position/rotationY 二次叠加。 */}
      {poseMode && onJointEuler && (
        <PoseGizmo
          actor={actor}
          jointRefs={jointRefs}
          onJointChange={onJointEuler}
          onDragStateChange={onGizmoDrag}
          onDragCommit={onPoseDragCommit}
          onDragBegin={onPoseDragBegin}
        />
      )}
    </>
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
        <mesh position={[0, 0.4, 0]} userData={{ stage3dHelper: true }}>
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
        <mesh position={center} userData={{ stage3dHelper: true }}>
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

function getImportedModelNormalization(
  bounds: THREE.Box3,
  targetMaxSize = 2,
): {
  position: [number, number, number]
  scale: number
} {
  if (bounds.isEmpty()) return { position: [0, 0, 0], scale: 1 }
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  bounds.getSize(size)
  bounds.getCenter(center)
  const maxSize = Math.max(size.x, size.y, size.z)
  const scale = Number.isFinite(maxSize) && maxSize > 0 ? targetMaxSize / maxSize : 1
  return {
    position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale],
    scale,
  }
}

function NormalizedImportedModel({ object }: { object: THREE.Object3D }) {
  const { clone, normalization } = useMemo(() => {
    const cloned = cloneSkeleton(object) as THREE.Object3D
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
    cloned.updateMatrixWorld(true)
    return {
      clone: cloned,
      normalization: getImportedModelNormalization(new THREE.Box3().setFromObject(cloned)),
    }
  }, [object])

  return (
    <group
      position={normalization.position}
      scale={[normalization.scale, normalization.scale, normalization.scale]}
    >
      <primitive object={clone} />
    </group>
  )
}

function LocalFbxModel({ url }: { url: string }) {
  const object = useLoader(FBXLoader, url) as THREE.Group
  return <NormalizedImportedModel object={object} />
}

function LocalObjModel({ url }: { url: string }) {
  const object = useLoader(OBJLoader, url) as THREE.Group
  return <NormalizedImportedModel object={object} />
}

function LocalGlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  return <NormalizedImportedModel object={scene} />
}

function useStage3DLocalModelRuntimeUrl(url: string | undefined): string | undefined {
  const [runtimeUrl, setRuntimeUrl] = useState<string | undefined>(() =>
    url && !url.startsWith('data:') ? url : undefined,
  )

  useEffect(() => {
    if (!url) {
      setRuntimeUrl(undefined)
      return
    }

    let disposed = false
    let revoke: (() => void) | undefined
    setRuntimeUrl(url.startsWith('data:') ? undefined : url)

    void createStage3DLocalModelRuntimeUrl(url)
      .then((runtime) => {
        if (disposed) {
          runtime.revoke?.()
          return
        }
        revoke = runtime.revoke
        setRuntimeUrl(runtime.url)
      })
      .catch(() => {
        if (!disposed) setRuntimeUrl(url)
      })

    return () => {
      disposed = true
      revoke?.()
    }
  }, [url])

  return runtimeUrl
}

function LocalModelContent({ prop, selected }: { prop: Stage3DProp; selected: boolean }) {
  const runtimeUrl = useStage3DLocalModelRuntimeUrl(prop.url)
  if (!prop.url || !prop.format) return <GlbPlaceholder selected={selected} failed />
  if (!runtimeUrl) return <GlbPlaceholder selected={selected} />
  return (
    <GlbErrorBoundary
      key={`${prop.format}:${runtimeUrl}`}
      fallback={<GlbPlaceholder selected={selected} failed />}
    >
      <Suspense fallback={<GlbPlaceholder selected={selected} />}>
        {prop.format === 'fbx' ? (
          <LocalFbxModel url={runtimeUrl} />
        ) : prop.format === 'obj' ? (
          <LocalObjModel url={runtimeUrl} />
        ) : (
          <LocalGlbModel url={runtimeUrl} />
        )}
      </Suspense>
      {selected && (
        <mesh position={[0, 0.6, 0]} userData={{ stage3dHelper: true }}>
          <boxGeometry args={[1.2, 1.2, 1.2]} />
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.35} />
        </mesh>
      )}
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
      case 'cone':
        return <coneGeometry args={[0.45, 0.9, 32]} />
      case 'torus':
        return <torusGeometry args={[0.42, 0.12, 16, 48]} />
      case 'pyramid':
        return <coneGeometry args={[0.55, 0.95, 4]} />
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
        <mesh userData={{ stage3dHelper: true }}>
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
      ) : prop.kind === 'local-model' ? (
        <LocalModelContent prop={prop} selected={selected} />
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
    // 视锥从镜头前端出发（机身 +Z 约 0.23m 处），比从机身中心画更贴切
    const apex = pos.clone().add(dir.clone().multiplyScalar(0.23))
    const center = pos.clone().add(dir.clone().multiplyScalar(len))
    const corner = (sh: number, sv: number) =>
      center
        .clone()
        .add(right.clone().multiplyScalar(halfH * sh))
        .add(trueUp.clone().multiplyScalar(halfV * sv))
    const corners = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]
    const pts: THREE.Vector3[] = []
    for (const c of corners) pts.push(apex.clone(), c.clone())
    for (let i = 0; i < corners.length; i += 1) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      if (a && b) pts.push(a.clone(), b.clone())
    }
    const g = new THREE.BufferGeometry()
    g.setFromPoints(pts)
    return g
  }, [camera.aspect, camera.fov, px, py, pz, tx, ty, tz])

  // 相机机身朝向：让镜头筒指向 target，整组绕 Y 旋转对齐水平朝向
  const yaw = useMemo(() => {
    const dx = tx - px
    const dz = tz - pz
    return Math.atan2(dx, dz)
  }, [px, pz, tx, tz])

  const accent = selected ? '#f5a623' : '#fbbf24'
  const bodyColor = '#374151' // 深灰机身
  const darkColor = '#1f2937' // 更深的细节（遮光斗 / 提手）

  return (
    // 整个取景相机对象（机身实体 + 视锥线框）只是编辑器辅助显示，不是场景真实内容——
    // 打上 stage3dHelper 标记，截图时 ScreenshotBridge 会临时隐藏，避免相机自遮挡穿帮。
    <group userData={{ stage3dHelper: true }}>
      {/* 机身局部坐标：+Z 为镜头朝向（对齐 target），拼装一台仿真电影摄像机（≈0.4m） */}
      <group
        position={camera.position}
        rotation={[0, yaw, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
      >
        {/* 机身主体 */}
        <mesh castShadow position={[0, 0, -0.02]}>
          <boxGeometry args={[0.16, 0.15, 0.22]} />
          <meshStandardMaterial color={bodyColor} roughness={0.55} metalness={0.35} />
        </mesh>
        {/* 镜头筒（后段） */}
        <mesh castShadow position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.055, 0.1, 24]} />
          <meshStandardMaterial color={darkColor} roughness={0.4} metalness={0.5} />
        </mesh>
        {/* 镜头筒（前段遮光斗，前端略张） */}
        <mesh castShadow position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.05, 0.06, 24]} />
          <meshStandardMaterial color={darkColor} roughness={0.45} metalness={0.4} />
        </mesh>
        {/* 镜片高光环 */}
        <mesh position={[0, 0, 0.232]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.006, 24]} />
          <meshStandardMaterial color={accent} roughness={0.2} metalness={0.6} />
        </mesh>
        {/* 顶部提手 */}
        <mesh castShadow position={[0, 0.11, -0.02]}>
          <boxGeometry args={[0.02, 0.03, 0.14]} />
          <meshStandardMaterial color={darkColor} roughness={0.6} metalness={0.3} />
        </mesh>
        {/* 两个胶片盘（经典电影机剪影） */}
        <mesh castShadow position={[-0.045, 0.13, -0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.03, 24]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh castShadow position={[0.045, 0.13, -0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.03, 24]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
        </mesh>
        {/* 胶片盘中心轴高亮点 */}
        <mesh position={[-0.062, 0.13, -0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 0.008, 16]} />
          <meshStandardMaterial color={accent} roughness={0.3} metalness={0.5} />
        </mesh>
        <mesh position={[0.062, 0.13, -0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 0.008, 16]} />
          <meshStandardMaterial color={accent} roughness={0.3} metalness={0.5} />
        </mesh>
        {/* 侧面取景器小方块 */}
        <mesh castShadow position={[-0.095, 0.04, -0.05]}>
          <boxGeometry args={[0.04, 0.045, 0.06]} />
          <meshStandardMaterial color={darkColor} roughness={0.5} metalness={0.35} />
        </mesh>
      </group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color={accent} transparent opacity={0.8} />
      </lineSegments>
    </group>
  )
}

// ─────────────────────────── 变换控制器桥接 ───────────────────────────

/** 选中对象的 TransformControls，拖拽时禁用 OrbitControls。 */
function SelectedTransform({
  data,
  transformMode,
  snap,
  orbitRef,
  onActorTransform,
  onCrowdTransform,
  onPropTransform,
  onCameraTransform,
}: {
  data: Stage3DData
  transformMode: 'translate' | 'rotate'
  snap: boolean
  orbitRef: React.MutableRefObject<OrbitRefValue | null>
  onActorTransform: Scene3DProps['onActorTransform']
  onCrowdTransform: Scene3DProps['onCrowdTransform']
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
    if (actor?.crowdId) {
      const members = data.actors.filter((a) => a.crowdId === actor.crowdId)
      if (members.length > 1) return { type: 'crowd' as const, crowdId: actor.crowdId, members }
    }
    if (actor) return { type: 'actor' as const, actor }
    const prop = data.props.find((p) => p.id === activeId)
    if (prop) return { type: 'prop' as const, prop }
    return null
  }, [activeId, data.actors, data.props])

  const crowdAnchor = useMemo(() => {
    if (target?.type !== 'crowd') return null
    const count = target.members.length
    const position = target.members.reduce(
      (acc, actor) => {
        acc[0] += actor.position[0]
        acc[1] += actor.position[1]
        acc[2] += actor.position[2]
        return acc
      },
      [0, 0, 0] as [number, number, number],
    )
    return {
      position: [
        Number((position[0] / count).toFixed(4)),
        Number((position[1] / count).toFixed(4)),
        Number((position[2] / count).toFixed(4)),
      ] as [number, number, number],
      rotationY: target.members[0]?.rotationY ?? 0,
    }
  }, [target])

  // 同步代理对象位置到选中项
  useEffect(() => {
    const obj = proxyRef.current
    if (!obj || !target) return
    if (target.type === 'camera') {
      obj.position.set(...data.camera.position)
      obj.rotation.set(0, 0, 0)
    } else if (target.type === 'crowd') {
      if (!crowdAnchor) return
      obj.position.set(...crowdAnchor.position)
      obj.rotation.set(0, crowdAnchor.rotationY, 0)
    } else if (target.type === 'actor') {
      obj.position.set(...target.actor.position)
      obj.rotation.set(0, target.actor.rotationY, 0)
    } else {
      obj.position.set(...target.prop.position)
      obj.rotation.set(0, target.prop.rotationY, 0)
    }
  }, [target, crowdAnchor, data.camera.position])

  if (!target) return null
  // 相机对象只允许移动（旋转由「相机对准」/目标点驱动，避免语义混乱）
  const mode = target.type === 'camera' ? 'translate' : transformMode

  const handleChange = () => {
    const obj = proxyRef.current
    if (!obj || !target) return
    const p: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z]
    const rotationY = rotationYFromQuaternion(obj.quaternion)
    if (target.type === 'camera') {
      // 相机移动时保持看向原 target
      onCameraTransform(p, data.camera.target)
    } else if (target.type === 'crowd') {
      onCrowdTransform(target.crowdId, [p[0], Math.max(-3, p[1]), p[2]], rotationY)
    } else if (target.type === 'actor') {
      // 人物 Y 轴钳制在 -3m ~ +∞：允许下探到台阶/下沉庭院/水中等场景，不再硬贴地于 0
      onActorTransform(target.actor.id, [p[0], Math.max(-3, p[1]), p[2]], rotationY)
    } else {
      onPropTransform(target.prop.id, p, rotationY)
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
          // 移动：三类对象都放开 Y（人物落地由 handleChange 的 Math.max(-3,y) 钳制，可站上台子，
          // 也允许下探到 -3m 用于台阶/下沉庭院/水中等场景，不再是硬贴地）。
          // 旋转：数据模型只有 rotationY，只保留水平朝向环（Y），隐藏 X/Z 环避免转了没效果。
          showX={mode !== 'rotate'}
          showY
          showZ={mode !== 'rotate'}
          // 吸附：对齐网格半格（cellSize 0.5 的一半）与 15° 步进；关闭时传 null 取消
          translationSnap={snap ? 0.25 : null}
          rotationSnap={snap ? (15 * Math.PI) / 180 : null}
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

        // 截图前临时隐藏"编辑器专用、不该出现在截图里"的对象：
        // - 打了 stage3dHelper 标记的（取景相机模型/视锥线框、各类选中态高亮线框）；
        // - drei TransformControls 内部生成的 gizmo/plane 辅助对象（type 以 TransformControls 开头，
        //   不受我们标记控制，只能靠 type 前缀识别）。
        // 否则离屏相机位置与取景相机模型原点重合，会被模型自身实体几何遮挡（穿帮"头部黑掉"），
        // 且 gizmo/视锥线框/选中框也会一并被截进去。渲染+读像素后必须在 finally 里恢复可见性。
        const hidden: THREE.Object3D[] = []
        scene.traverse((obj) => {
          const isHelper =
            obj.userData?.stage3dHelper === true || obj.type?.startsWith('TransformControls')
          if (isHelper && obj.visible) {
            hidden.push(obj)
          }
        })
        for (const obj of hidden) obj.visible = false

        // 离屏渲染到 render target，再读像素回 2D canvas → 干净的定尺寸 PNG，
        // 不受主视口尺寸/画幅影响。
        const rt = new THREE.WebGLRenderTarget(outW, outH, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        })
        try {
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
          return out.toDataURL('image/png')
        } finally {
          rt.dispose()
          for (const obj of hidden) obj.visible = true
        }
      } catch {
        return null
      }
    }
    onReady(fn)
  }, [data.camera, gl, scene, r3fCamera, onReady, size, cameraPreview])

  return null
}

/**
 * 主视口相机随「取景预览」切换。
 *
 * 进入取景预览（false→true）时，先把当前自由视角的 position/fov/OrbitControls target
 * 快照下来；退出（true→false）时用快照原样恢复，并调用 orbitRef.update() 让 OrbitControls
 * 内部的球坐标记账与恢复后的相机同步——否则下次拖拽会从旧记账状态跳变，表现为"被重置"。
 */
function ViewportCameraSync({
  data,
  cameraPreview,
  orbitRef,
}: {
  data: Stage3DData
  cameraPreview: boolean
  orbitRef: React.MutableRefObject<OrbitRefValue | null>
}) {
  const { camera } = useThree()
  const snapshotRef = useRef<{
    position: THREE.Vector3
    fov: number
    target: THREE.Vector3
  } | null>(null)

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    if (cameraPreview) {
      // 仅在首次进入（snapshotRef 仍空）时快照自由视角。effect 依赖含 data.camera，
      // 取景预览模式下拖动取景相机对象会让 data.camera 变化触发重跑——若每次都重新快照，
      // 会把此时已被切到取景机位的 camera 状态写进快照，退出时恢复的就是取景机位而非
      // 自由视角。后续重跑只更新相机参数让取景预览跟随 data.camera，不覆盖快照。
      if (!snapshotRef.current) {
        snapshotRef.current = {
          position: camera.position.clone(),
          fov: camera.fov,
          target: orbitRef.current?.target.clone() ?? new THREE.Vector3(...data.camera.target),
        }
      }
      // 直接改 three 相机是 R3F 命令式惯例（相机实例由渲染器管理，非 React state）
      // eslint-disable-next-line react-hooks/immutability
      camera.fov = data.camera.fov
      camera.position.set(...data.camera.position)
      camera.lookAt(new THREE.Vector3(...data.camera.target))
      camera.updateProjectionMatrix()
    } else {
      // 退出取景预览：恢复进入前快照的自由视角状态
      const snap = snapshotRef.current
      if (!snap) return
      snapshotRef.current = null
      // eslint-disable-next-line react-hooks/immutability
      camera.fov = snap.fov
      camera.position.copy(snap.position)
      camera.updateProjectionMatrix()
      if (orbitRef.current) {
        orbitRef.current.target.copy(snap.target)
        orbitRef.current.update()
      }
    }
  }, [cameraPreview, data.camera, camera, orbitRef])
  return null
}

// ─────────────────────────── 相机预设（R2a 全屏姿势编辑页用） ───────────────────────────

/**
 * 按 preset 把相机摆到正/侧/顶/iso 机位（不进入取景预览，仍由 OrbitControls 自由旋转）。
 *
 * target 基于「选中人偶 position」回退场景中心；position 按 preset 方向偏移固定距离。
 * 不与 ViewportCameraSync 冲突：cameraPreset 仅在传入时生效，主舞台不传 → 维持现状。
 */
const CAMERA_PRESET_DISTANCE = 4.5
const CAMERA_PRESET_HEIGHT = 1.6 // 约人偶胸口高度，正/侧视看起来更自然

function CameraPresetSync({
  preset,
  activeActor,
  orbitRef,
}: {
  preset: 'front' | 'side' | 'top' | 'iso'
  activeActor: Stage3DActor | undefined
  orbitRef: React.MutableRefObject<OrbitRefValue | null>
}) {
  const { camera } = useThree()
  const appliedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const key = `${preset}:${activeActor?.id ?? 'none'}`
    if (appliedKeyRef.current === key) return
    appliedKeyRef.current = key
    const center: [number, number, number] = activeActor
      ? [activeActor.position[0], activeActor.position[1], activeActor.position[2]]
      : [0, 0, 0]
    let dir: [number, number, number]
    switch (preset) {
      case 'front':
        dir = [0, 0, 1]
        break
      case 'side':
        dir = [1, 0, 0]
        break
      case 'top':
        dir = [0, 1, 0]
        break
      case 'iso':
      default: {
        const n = Math.sqrt(3)
        dir = [1 / n, 1 / n, 1 / n]
        break
      }
    }
    // top 时相机在头顶上方，target 用 actor 高度；其它 preset 抬到胸口高度看 actor
    const camY = preset === 'top' ? center[1] + CAMERA_PRESET_DISTANCE : CAMERA_PRESET_HEIGHT
    const camX = center[0] + dir[0] * CAMERA_PRESET_DISTANCE
    const camZ = center[2] + dir[2] * CAMERA_PRESET_DISTANCE
    const targetY = preset === 'top' ? center[1] + 0.01 : center[1] + 0.8
    // 直接改 three 相机是 R3F 命令式惯例（相机实例由渲染器管理，非 React state）
    // eslint-disable-next-line react-hooks/immutability
    camera.position.set(camX, camY, camZ)
    camera.lookAt(new THREE.Vector3(center[0], targetY, center[2]))
    camera.updateProjectionMatrix()
    if (orbitRef.current) {
      orbitRef.current.target.set(center[0], targetY, center[2])
      orbitRef.current.update()
    }
  }, [preset, activeActor?.id, camera, orbitRef])

  return null
}

// ─────────────────────────── 视口错误边界（就地兜底，避免炸穿全局 Shell） ───────────────────────────

/**
 * DOM 级错误边界：包住整个 R3F <Canvas>。R3F 内部任何组件（Text/GLB/Suspense…）
 * 抛错时，React 会把异常沿组件树上抛——若无此边界会一路冒到全局 Shell ErrorBoundary，
 * 表现为整个应用白屏。此处就地捕获，在视口内显示中文错误 + 堆栈摘要，方便定位。
 */
class ViewportErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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
    onCrowdTransform,
    onPropTransform,
    onCameraTransform,
    transformMode,
    snap,
    poseMode,
    onActorJointEuler,
    onActorDoubleClick,
    onActorPoseDragCommit,
    onActorPoseDragBegin,
    cameraPreset,
    viewNavigationMode = 'orbit',
  },
  ref,
) {
  const orbitRef = useRef<OrbitRefValue | null>(null)
  const orbitMouseButtons = useMemo(
    () => ({
      LEFT: viewNavigationMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: viewNavigationMode === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    }),
    [viewNavigationMode],
  )
  // Gizmo 拖拽期间禁用 OrbitControls（事件处理器，非 render 期读 ref）
  const handleGizmoDrag = useCallback((dragging: boolean) => {
    if (orbitRef.current) orbitRef.current.enabled = !dragging
  }, [])
  useEffect(() => {
    if (!cameraPreview && !poseMode && orbitRef.current) orbitRef.current.enabled = true
    return () => {
      if (orbitRef.current) orbitRef.current.enabled = true
    }
  }, [cameraPreview, poseMode])
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
        onContextMenu={(e) => e.preventDefault()}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#0b1220']} />
        <LightingRig lighting={data.lighting} />

        <Backdrop data={data} />

        {data.actors.map((actor) => {
          const isActorPosing = !!poseMode && data.activeId === actor.id
          return (
            <ActorObject
              key={actor.id}
              actor={actor}
              selected={data.activeId === actor.id}
              poseMode={isActorPosing}
              onSelect={() => onSelect(actor.id)}
              onDoubleClick={() => onActorDoubleClick?.(actor.id)}
              {...(onActorJointEuler
                ? {
                    onJointEuler: (jointId: JointId, euler: Vec3) =>
                      onActorJointEuler(actor.id, jointId, euler),
                  }
                : {})}
              onGizmoDrag={handleGizmoDrag}
              {...(onActorPoseDragCommit
                ? { onPoseDragCommit: () => onActorPoseDragCommit(actor.id) }
                : {})}
              {...(onActorPoseDragBegin
                ? { onPoseDragBegin: () => onActorPoseDragBegin(actor.id) }
                : {})}
            />
          )
        })}

        {data.props.map((prop) => (
          <PropObject
            key={prop.id}
            prop={prop}
            selected={data.activeId === prop.id}
            onSelect={() => onSelect(prop.id)}
          />
        ))}

        {!cameraPreview && !poseMode && (
          <FramingCameraObject
            data={data}
            selected={data.activeId === 'camera'}
            onSelect={() => onSelect('camera')}
          />
        )}

        {!cameraPreview && !(poseMode && data.actors.some((a) => a.id === data.activeId)) && (
          <SelectedTransform
            data={data}
            transformMode={transformMode}
            snap={snap}
            orbitRef={orbitRef}
            onActorTransform={onActorTransform}
            onCrowdTransform={onCrowdTransform}
            onPropTransform={onPropTransform}
            onCameraTransform={onCameraTransform}
          />
        )}

        <ViewportCameraSync data={data} cameraPreview={cameraPreview} orbitRef={orbitRef} />
        {cameraPreset && (
          <CameraPresetSync
            preset={cameraPreset}
            activeActor={data.actors.find((a) => a.id === data.activeId)}
            orbitRef={orbitRef}
          />
        )}
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
          enablePan
          dampingFactor={0.1}
          enabled={!cameraPreview}
          mouseButtons={orbitMouseButtons}
          screenSpacePanning={false}
          {...(cameraPreview ? { target: new THREE.Vector3(...data.camera.target) } : {})}
        />
      </Canvas>
    </ViewportErrorBoundary>
  )
})
