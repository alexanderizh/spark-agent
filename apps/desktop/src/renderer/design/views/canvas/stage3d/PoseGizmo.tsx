import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import {
  BODY_METRICS,
  JOINT_LABEL,
  JOINT_LIMITS,
  clampJointEuler,
  type BodyMetrics,
  type JointId,
  type Vec3,
} from './mannequin'
import { solveTwoBoneIK, type IkChain } from './poseIk'

/**
 * 姿势模式交互层（视口内直接摆姿势）。
 *
 * 三类可交互物件，均叠加渲染（depthTest=false，renderorder 高）在人偶之上：
 *  1. 关节热点球：跟随对应关节 group 的世界位置。点击选中该关节。
 *  2. 旋转环（FK）：选中关节后按其父空间轴向渲染 X/Y/Z torus，拖拽写角度增量。
 *  3. IK 把手：双腕/双踝的菱形把手，拖拽末端点解两骨 IK 写回 FK 欧拉角。
 *
 * 数据单向流：所有角度改动通过 onJointChange 写回 actor.joints → MannequinRig 重渲染，
 * Gizmo 自身不持久保存角度（只在拖拽过程中读取关节世界矩阵定位）。
 */

// 叠加渲染基准 renderOrder（高于人偶，保证热点/环恒可见）
const OVERLAY_ORDER = 999

const AXIS_COLOR: [string, string, string] = ['#ef4444', '#22c55e', '#3b82f6'] // X红 Y绿 Z蓝
const HOTSPOT_COLOR = '#f8fafc'
const HOTSPOT_HOVER = '#fde68a'
const IK_COLOR = '#38bdf8'
const IK_HOVER = '#7dd3fc'

/** 手部关节（腕/拇指/四指）热点缩小，减少误点。 */
const HAND_JOINTS = new Set<JointId>(['handL', 'handR', 'thumbL', 'fingersL', 'thumbR', 'fingersR'])
/** curl 类关节不出旋转环（curl 是联动量，交由属性面板滑杆微调）。 */
const CURL_JOINTS = new Set<JointId>(['thumbL', 'fingersL', 'thumbR', 'fingersR'])

/** 可在视口点选调节的关节（全部关节）。 */
const SELECTABLE_JOINTS: JointId[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'lowerArmL', 'handL', 'thumbL', 'fingersL',
  'shoulderR', 'upperArmR', 'lowerArmR', 'handR', 'thumbR', 'fingersR',
  'upperLegL', 'lowerLegL', 'footL',
  'upperLegR', 'lowerLegR', 'footR',
]

/** 环半径按部位分级（世界单位，乘 heightScale）。 */
function ringRadiusFor(jointId: JointId): number {
  if (jointId === 'hips' || jointId === 'spine' || jointId === 'chest') return 0.28
  if (jointId === 'neck' || jointId === 'head') return 0.2
  if (HAND_JOINTS.has(jointId)) return 0.08
  if (jointId.startsWith('upperLeg') || jointId.startsWith('upperArm')) return 0.16
  return 0.13
}

/** 热点球半径（世界单位，乘 heightScale）。 */
function hotspotRadiusFor(jointId: JointId): number {
  return HAND_JOINTS.has(jointId) ? 0.028 : 0.05
}

/** IK 链定义：腕→肩链、踝→髋链。 */
function ikChainFor(handleJoint: JointId, m: BodyMetrics): IkChain | null {
  switch (handleJoint) {
    case 'handL':
      return { upperLen: m.upperArmLen, lowerLen: m.lowerArmLen, upperJointId: 'upperArmL', lowerJointId: 'lowerArmL', bendSign: -1 }
    case 'handR':
      return { upperLen: m.upperArmLen, lowerLen: m.lowerArmLen, upperJointId: 'upperArmR', lowerJointId: 'lowerArmR', bendSign: -1 }
    case 'footL':
      return { upperLen: m.upperLegLen, lowerLen: m.lowerLegLen, upperJointId: 'upperLegL', lowerJointId: 'lowerLegL', bendSign: 1 }
    case 'footR':
      return { upperLen: m.upperLegLen, lowerLen: m.lowerLegLen, upperJointId: 'upperLegR', lowerJointId: 'lowerLegR', bendSign: 1 }
    default:
      return null
  }
}

const IK_HANDLES: JointId[] = ['handL', 'handR', 'footL', 'footR']
/** IK 把手对应上段关节的父 group（求解在其本地空间进行）。 */
const IK_UPPER_PARENT: Record<string, JointId> = {
  handL: 'shoulderL',
  handR: 'shoulderR',
  footL: 'hips',
  footR: 'hips',
}

export type PoseGizmoProps = {
  actor: Stage3DActor
  /** MannequinRig 上报的关节 group 世界变换来源（ref 容器，避免 render 期读 .current）。 */
  jointRefs: RefObject<Map<JointId, THREE.Group>>
  /** 写回某关节的完整欧拉角（弧度，已含预设基准的「合成后覆盖」语义由上层负责换算）。 */
  onJointChange: (jointId: JointId, euler: Vec3) => void
  /** 拖拽开始/结束（供上层临时禁用 OrbitControls）。 */
  onDragStateChange?: ((dragging: boolean) => void) | undefined
  /** 一次拖拽提交（pointerup 时触发一次，供 T3 记录 undo 快照）。 */
  onDragCommit?: (() => void) | undefined
}

const R2D = 180 / Math.PI

export function PoseGizmo({
  actor,
  jointRefs,
  onJointChange,
  onDragStateChange,
  onDragCommit,
}: PoseGizmoProps) {
  const { camera, gl } = useThree()
  const metrics = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const h = actor.heightScale

  const [selected, setSelected] = useState<JointId | null>(null)
  const [hovered, setHovered] = useState<JointId | null>(null)
  const [hoveredIk, setHoveredIk] = useState<JointId | null>(null)
  /** 拖拽中显示的角度标签（度，取整）。 */
  const [dragLabel, setDragLabel] = useState<string | null>(null)

  // 热点球 / 环容器 / IK 把手的可变 ref（每帧从关节世界矩阵同步位置）
  const hotspotRefs = useRef<Map<JointId, THREE.Object3D>>(new Map())
  const ringGroupRef = useRef<THREE.Group | null>(null)
  const ikRefs = useRef<Map<JointId, THREE.Object3D>>(new Map())
  const labelGroupRef = useRef<THREE.Group | null>(null)

  // 拖拽状态（命令式，避免每帧 setState）
  const drag = useRef<null | {
    kind: 'ring' | 'ik'
    jointId: JointId
    axis?: 0 | 1 | 2
    // ring：起始角与起始欧拉
    ringPlaneNormal?: THREE.Vector3
    ringCenter?: THREE.Vector3
    startAngle?: number
    startEuler?: Vec3
    // ik：把手所在的面向相机平面
    ikPlaneNormal?: THREE.Vector3
    ikPlanePoint?: THREE.Vector3
  }>(null)

  const emitDragState = useCallback(
    (dragging: boolean) => {
      onDragStateChange?.(dragging)
    },
    [onDragStateChange],
  )

  // ── 每帧：把叠加物件贴到对应关节世界位置 ──
  useFrame(() => {
    for (const jointId of SELECTABLE_JOINTS) {
      const target = hotspotRefs.current.get(jointId)
      const src = jointRefs.current.get(jointId)
      if (target && src) {
        src.getWorldPosition(target.position)
      }
    }
    // IK 把手
    for (const jointId of IK_HANDLES) {
      const target = ikRefs.current.get(jointId)
      const src = jointRefs.current.get(jointId)
      if (target && src) {
        src.getWorldPosition(target.position)
      }
    }
    // 选中关节的旋转环：跟随位置 + 父空间朝向
    if (selected && ringGroupRef.current) {
      const src = jointRefs.current.get(selected)
      if (src?.parent) {
        src.getWorldPosition(ringGroupRef.current.position)
        // 环按父空间轴向：取父 group 的世界四元数
        src.parent.getWorldQuaternion(ringGroupRef.current.quaternion)
      }
    }
    if (labelGroupRef.current && selected) {
      const src = jointRefs.current.get(selected)
      if (src) src.getWorldPosition(labelGroupRef.current.position)
    }
  })

  // ── 关节热点：点选 ──
  const onHotspotDown = useCallback(
    (jointId: JointId) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setSelected((prev) => (prev === jointId ? prev : jointId))
    },
    [],
  )

  // ── 旋转环拖拽 ──
  const currentEuler = useCallback(
    (jointId: JointId): Vec3 => {
      // 从关节 group 的本地 rotation 读当前欧拉角（含预设+覆盖的最终值）
      const g = jointRefs.current.get(jointId)
      if (g) return [g.rotation.x, g.rotation.y, g.rotation.z]
      return [0, 0, 0]
    },
    [jointRefs],
  )

  /** 指针在环平面上相对环心的极角。 */
  const angldOnPlane = useCallback(
    (e: PointerEvent, normal: THREE.Vector3, center: THREE.Vector3, refDir: THREE.Vector3): number | null => {
      const ray = pointerRay(e, gl.domElement, camera)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center)
      const hit = new THREE.Vector3()
      if (!ray.intersectPlane(plane, hit)) return null
      const v = hit.sub(center)
      // 在平面内用 refDir 与其法向叉积构造正交基，得到极角
      const u = refDir.clone()
      const w = new THREE.Vector3().crossVectors(normal, u).normalize()
      return Math.atan2(v.dot(w), v.dot(u))
    },
    [camera, gl],
  )

  const onRingDown = useCallback(
    (jointId: JointId, axis: 0 | 1 | 2) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const g = jointRefs.current.get(jointId)
      const parent = g?.parent
      if (!g || !parent) return
      const center = g.getWorldPosition(new THREE.Vector3())
      // 环法向 = 父空间该轴的世界方向
      const basis = new THREE.Matrix4().extractRotation(parent.matrixWorld)
      const axisVec = new THREE.Vector3()
      axisVec.setFromMatrixColumn(basis, axis).normalize()
      // 参考方向：平面内任取一条正交轴
      const refDir = orthogonalTo(axisVec)
      const start = angldOnPlane(e.nativeEvent, axisVec, center, refDir)
      if (start === null) return
      drag.current = {
        kind: 'ring',
        jointId,
        axis,
        ringPlaneNormal: axisVec,
        ringCenter: center,
        startAngle: start,
        startEuler: currentEuler(jointId),
      }
      ;(e.target as unknown as { setPointerCapture?: (id: number) => void })?.setPointerCapture?.(
        e.nativeEvent.pointerId,
      )
      emitDragState(true)
      setDragLabel(`${Math.round((currentEuler(jointId)[axis]) * R2D)}°`)
    },
    [jointRefs, angldOnPlane, currentEuler, emitDragState],
  )

  // ── IK 把手拖拽 ──
  const onIkDown = useCallback(
    (jointId: JointId) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const g = jointRefs.current.get(jointId)
      if (!g) return
      const point = g.getWorldPosition(new THREE.Vector3())
      // 面向相机的平面（法向 = 相机视线方向）
      const normal = camera.getWorldDirection(new THREE.Vector3()).negate()
      drag.current = { kind: 'ik', jointId, ikPlaneNormal: normal, ikPlanePoint: point }
      ;(e.target as unknown as { setPointerCapture?: (id: number) => void })?.setPointerCapture?.(
        e.nativeEvent.pointerId,
      )
      emitDragState(true)
      setDragLabel('IK')
    },
    [jointRefs, camera, emitDragState],
  )

  // ── 全局指针移动/抬起（挂在 domElement 上，通过 R3F 的 onPointerMove 容器组件不便，用 window）──
  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const d = drag.current
      if (!d) return
      e.stopPropagation()
      const alt = e.nativeEvent.altKey
      if (d.kind === 'ring' && d.axis !== undefined && d.ringPlaneNormal && d.ringCenter && d.startEuler) {
        const refDir = orthogonalTo(d.ringPlaneNormal)
        const now = angldOnPlane(e.nativeEvent, d.ringPlaneNormal, d.ringCenter, refDir)
        if (now === null || d.startAngle === undefined) return
        let delta = now - d.startAngle
        // 归一到 [-π, π]，避免跨越 ±π 跳变
        delta = Math.atan2(Math.sin(delta), Math.cos(delta))
        const next: Vec3 = [d.startEuler[0], d.startEuler[1], d.startEuler[2]]
        next[d.axis] = d.startEuler[d.axis] + delta
        const clamped = clampJointEuler(d.jointId, next, { clamp: !alt })
        onJointChange(d.jointId, clamped)
        setDragLabel(`${Math.round(clamped[d.axis] * R2D)}°`)
      } else if (d.kind === 'ik' && d.ikPlaneNormal && d.ikPlanePoint) {
        const ray = pointerRay(e.nativeEvent, gl.domElement, camera)
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(d.ikPlaneNormal, d.ikPlanePoint)
        const hit = new THREE.Vector3()
        if (!ray.intersectPlane(plane, hit)) return
        solveIkToWorldTarget(d.jointId, hit, metrics, jointRefs, onJointChange, !alt)
        setDragLabel('IK')
      }
    },
    [angldOnPlane, onJointChange, camera, gl, metrics, jointRefs],
  )

  const endDrag = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drag.current) return
      e.stopPropagation?.()
      drag.current = null
      setDragLabel(null)
      emitDragState(false)
      onDragCommit?.()
    },
    [emitDragState, onDragCommit],
  )

  // 环渲染数据（选中关节的可用轴）
  const rings = useMemo(() => {
    if (!selected || CURL_JOINTS.has(selected)) return []
    const limits = JOINT_LIMITS[selected]
    const r = ringRadiusFor(selected) * h
    const out: { axis: 0 | 1 | 2; radius: number }[] = []
    for (let axis = 0 as 0 | 1 | 2; axis < 3; axis = (axis + 1) as 0 | 1 | 2) {
      if (limits[axis] !== null) out.push({ axis, radius: r })
    }
    return out
  }, [selected, h])

  const tubeR = 0.006 * h

  return (
    <group
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 关节热点球 */}
      {SELECTABLE_JOINTS.map((jointId) => {
        const isSel = selected === jointId
        const isHover = hovered === jointId
        const radius = hotspotRadiusFor(jointId) * h * (isHover ? 1.35 : 1)
        return (
          <mesh
            key={jointId}
            ref={(o) => {
              if (o) hotspotRefs.current.set(jointId, o)
              else hotspotRefs.current.delete(jointId)
            }}
            renderOrder={OVERLAY_ORDER}
            onPointerDown={onHotspotDown(jointId)}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHovered(jointId)
            }}
            onPointerOut={() => setHovered((p) => (p === jointId ? null : p))}
          >
            <sphereGeometry args={[radius, 16, 16]} />
            <meshBasicMaterial
              color={isSel ? IK_COLOR : isHover ? HOTSPOT_HOVER : HOTSPOT_COLOR}
              transparent
              opacity={isSel ? 0.95 : 0.6}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )
      })}

      {/* 选中关节的旋转环（按父空间轴向） */}
      {selected && rings.length > 0 && (
        <group ref={ringGroupRef} renderOrder={OVERLAY_ORDER}>
          {rings.map(({ axis, radius }) => (
            <mesh
              key={axis}
              // X 环绕 X 轴：torus 默认在 XY 平面（法向 Z），旋转到对应轴平面
              rotation={axis === 0 ? [0, Math.PI / 2, 0] : axis === 1 ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
              renderOrder={OVERLAY_ORDER}
              onPointerDown={onRingDown(selected, axis)}
            >
              <torusGeometry args={[radius, tubeR, 8, 48]} />
              <meshBasicMaterial color={AXIS_COLOR[axis]} depthTest={false} depthWrite={false} transparent opacity={0.9} />
            </mesh>
          ))}
        </group>
      )}

      {/* IK 把手（菱形 octahedron） */}
      {IK_HANDLES.map((jointId) => {
        const isHover = hoveredIk === jointId
        const size = 0.05 * h * (isHover ? 1.3 : 1)
        return (
          <mesh
            key={`ik-${jointId}`}
            ref={(o) => {
              if (o) ikRefs.current.set(jointId, o)
              else ikRefs.current.delete(jointId)
            }}
            renderOrder={OVERLAY_ORDER}
            onPointerDown={onIkDown(jointId)}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredIk(jointId)
            }}
            onPointerOut={() => setHoveredIk((p) => (p === jointId ? null : p))}
          >
            <octahedronGeometry args={[size, 0]} />
            <meshBasicMaterial
              color={isHover ? IK_HOVER : IK_COLOR}
              transparent
              opacity={0.85}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )
      })}

      {/* 拖拽角度标签 */}
      {dragLabel && selected && (
        <group ref={labelGroupRef}>
          <Html center distanceFactor={6} zIndexRange={[30, 0]} pointerEvents="none" occlude={false}>
            <div className="stage3d-pose-anglelabel">
              {JOINT_LABEL[selected]} {dragLabel}
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}

// ─────────────────────────── 辅助纯函数 ───────────────────────────

/** 由屏幕指针事件构造一条世界射线。 */
function pointerRay(e: PointerEvent, dom: HTMLElement, camera: THREE.Camera): THREE.Ray {
  const rect = dom.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  return raycaster.ray
}

/** 求一条与给定单位向量正交的单位向量。 */
function orthogonalTo(v: THREE.Vector3): THREE.Vector3 {
  const ref = Math.abs(v.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  return new THREE.Vector3().crossVectors(v, ref).normalize()
}

/**
 * 把世界系目标点解成 IK：换算到上段关节父空间本地坐标，求解，写回 upper/lower 欧拉角。
 * 导出仅供内部使用（组件内 onPointerMove 调用）。
 */
function solveIkToWorldTarget(
  handleJoint: JointId,
  worldTarget: THREE.Vector3,
  metrics: BodyMetrics,
  jointRefs: RefObject<Map<JointId, THREE.Group>>,
  onJointChange: (jointId: JointId, euler: Vec3) => void,
  clamp: boolean,
): void {
  const chain = ikChainFor(handleJoint, metrics)
  if (!chain) return
  const parentId = IK_UPPER_PARENT[handleJoint]
  const upper = jointRefs.current.get(chain.upperJointId)
  if (!upper?.parent || !parentId) return
  // 上段父空间：upper.parent 的世界矩阵逆
  // 上段父空间世界矩阵含顶层 scale=h；求逆后 worldTarget 落回未缩放本地单位，
  // 与链长 upperLen/lowerLen（未缩放米数）同系，无需再补偿 h。
  const inv = new THREE.Matrix4().copy(upper.parent.matrixWorld).invert()
  const localTarget = worldTarget.clone().applyMatrix4(inv)
  const lower = jointRefs.current.get(chain.lowerJointId)
  const poleHint = lower ? lower.rotation.x : undefined
  const res = solveTwoBoneIK(chain, localTarget, poleHint, { clamp })
  onJointChange(chain.upperJointId, res.upperEuler)
  onJointChange(chain.lowerJointId, res.lowerEuler)
}
