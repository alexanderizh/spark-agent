import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import {
  BODY_METRICS,
  JOINT_LABEL,
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
 * 性能策略（避免摆姿势卡顿）：
 *  - 拖拽过程中**不**触发 React 重渲染：角度改动命令式直写关节 group 的 rotation，
 *    useFrame 仍按世界矩阵定位热点/环/IK 把手，外观立即响应。
 *  - pointerup（提交）时一次性调用 onJointChange，把最终欧拉角同步回 actor.joints，
 *    此时才触发整棵 3D 子树重渲染（MannequinRig 用新 joints 重建 rotation，与命令式一致无闪烁）。
 *  - 旋转环命中区：可见细环（tubeR≈6mm）+ 不可见粗环（4× 管粗，opacity 0）双重 raycast，
 *    解决「旋转句柄难触发」——可见环细以便不挡视线，命中环粗以便轻松点中。
 */

// 叠加渲染基准 renderOrder（高于人偶，保证热点/环恒可见）
const OVERLAY_ORDER = 999

const AXIS_COLOR: [string, string, string] = ['#ef4444', '#22c55e', '#3b82f6'] // X红 Y绿 Z蓝
const HOTSPOT_COLOR = '#f8fafc'
const HOTSPOT_HOVER = '#fde68a'
const IK_COLOR = '#38bdf8'
const IK_HOVER = '#7dd3fc'
const AXES: { axis: 0 | 1 | 2; label: 'X' | 'Y' | 'Z' }[] = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
]

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
  return HAND_JOINTS.has(jointId) ? 0.016 : 0.032
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
  /** 一次拖拽开始（pointerdown 时触发一次，供上层记录 undo 操作前快照）。 */
  onDragBegin?: (() => void) | undefined
}

const R2D = 180 / Math.PI

// ─────────────────────────── 性能：复用临时对象（避免拖拽每 move 分配 GC）──
// R3F pointer 事件单线程顺序派发，同步复用安全；跨帧持有的对象（drag.current 内）
// 仍用 clone/new 一次性分配。每 move 的临时向量改用这里复用。
const _ndc = new THREE.Vector2()
const _raycaster = new THREE.Raycaster()
const _plane = new THREE.Plane()
const _angHit = new THREE.Vector3() // angldOnPlane 交点
const _angV1 = new THREE.Vector3() // angldOnPlane v = hit - center
const _angV2 = new THREE.Vector3() // angldOnPlane w = normal × refDir
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _ORTHO_Y = new THREE.Vector3(0, 1, 0)
const _ORTHO_X = new THREE.Vector3(1, 0, 0)

// ─────────────────────────── 命中区下限（解决细关节难触发）──
// 可见环/球保持精致细小，不可见 hit 代理用绝对下限放大命中区，
// 避免 ray 像素级错过环/球 → onPointerMissed → 误退出 poseMode。
const MIN_HIT_TUBE = 0.02 // 环 hit 管粗下限（世界单位，乘 heightScale）
const MIN_HOTSPOT_HIT = 0.07 // 热点 hit 球半径下限（世界单位，乘 heightScale）

// ─────────────────────────── 性能打点（真机验证用，可移除）──
// 用户真机在 DevTools console 执行 window.__stage3dPerf = true 开启，
// 每秒输出一行帧/移动耗时汇总；不开则零开销（仅一次属性读）。
const _perfWin: typeof window & { __stage3dPerf?: boolean } | undefined =
  typeof window !== 'undefined' ? (window as typeof window & { __stage3dPerf?: boolean }) : undefined
function perfEnabled(): boolean {
  return !!_perfWin && _perfWin.__stage3dPerf === true
}
const _perf = { frameCount: 0, frameMax: 0, moveCount: 0, moveMax: 0, lastReport: 0 }
function perfTick(kind: 'frame' | 'move', ms: number): void {
  if (!perfEnabled()) return
  if (kind === 'frame') {
    _perf.frameCount++
    if (ms > _perf.frameMax) _perf.frameMax = ms
  } else {
    _perf.moveCount++
    if (ms > _perf.moveMax) _perf.moveMax = ms
  }
  const now = performance.now()
  if (now - _perf.lastReport >= 1000) {
    // eslint-disable-next-line no-console
    console.log(
      `[stage3d perf] 1s: frames=${_perf.frameCount} maxFrame=${_perf.frameMax.toFixed(2)}ms | moves=${_perf.moveCount} maxMove=${_perf.moveMax.toFixed(2)}ms`,
    )
    _perf.frameCount = 0
    _perf.frameMax = 0
    _perf.moveCount = 0
    _perf.moveMax = 0
    _perf.lastReport = now
  }
}

export function PoseGizmo({
  actor,
  jointRefs,
  onJointChange,
  onDragStateChange,
  onDragCommit,
  onDragBegin,
}: PoseGizmoProps) {
  const { camera, gl } = useThree()
  const metrics = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const h = actor.heightScale

  const [selected, setSelected] = useState<JointId | null>(null)
  const [hovered, setHovered] = useState<JointId | null>(null)
  const [hoveredIk, setHoveredIk] = useState<JointId | null>(null)
  const [activeAxis, setActiveAxis] = useState<0 | 1 | 2 | null>(null)
  const [panelEuler, setPanelEuler] = useState<Vec3>([0, 0, 0])
  const [panelEditing, setPanelEditing] = useState(false)
  /** 拖拽中显示的角度标签（度，取整）。 */
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const selectedRef = useRef<JointId | null>(null)
  const panelEulerRef = useRef<Vec3>([0, 0, 0])
  const panelEditingRef = useRef(false)

  // 热点球 / 环容器 / IK 把手的可变 ref（每帧从关节世界矩阵同步位置）
  const hotspotRefs = useRef<Map<JointId, THREE.Object3D>>(new Map())
  const ringGroupRef = useRef<THREE.Group | null>(null)
  const ikRefs = useRef<Map<JointId, THREE.Object3D>>(new Map())
  const labelGroupRef = useRef<THREE.Group | null>(null)

  // 拖拽状态（命令式，避免每帧 setState）
  // commitEuler：本次拖拽的最终欧拉角（pointerup 时一次性提交，避免每个 pointermove 都重渲染整棵 3D 子树）。
  // 拖拽过程中直接写关节 group 的 rotation（命令式），React 状态在 commit 时同步一次。
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
    // 本次拖拽过程中最后一次写入的欧拉角（commit 时用）
    lastEuler?: Vec3
    // IK 拖拽影响的关节及其最新欧拉（一次 IK 写两关节，commit 时都要交）
    lastIk?: { upper: { id: JointId; euler: Vec3 }; lower: { id: JointId; euler: Vec3 } }
  }>(null)

  const emitDragState = useCallback(
    (dragging: boolean) => {
      onDragStateChange?.(dragging)
    },
    [onDragStateChange],
  )

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    panelEulerRef.current = panelEuler
  }, [panelEuler])

  useEffect(() => {
    panelEditingRef.current = panelEditing
  }, [panelEditing])

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

  const currentEuler = useCallback(
    (jointId: JointId): Vec3 => {
      // 从关节 group 的本地 rotation 读当前欧拉角（含预设+覆盖的最终值）
      const g = jointRefs.current.get(jointId)
      if (g) return [g.rotation.x, g.rotation.y, g.rotation.z]
      return [0, 0, 0]
    },
    [jointRefs],
  )

  // ── 关节热点：点选 ──
  const onHotspotDown = useCallback(
    (jointId: JointId) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setSelected((prev) => {
        if (prev === jointId) return prev
        const next = currentEuler(jointId)
        panelEulerRef.current = next
        setPanelEuler(next)
        return jointId
      })
    },
    [currentEuler],
  )

  useEffect(() => {
    if (!selected || panelEditingRef.current) return
    const next = currentEuler(selected)
    panelEulerRef.current = next
    setPanelEuler(next)
  }, [actor.joints, actor.pose, currentEuler, selected])

  const writeJointEuler = useCallback(
    (jointId: JointId, euler: Vec3) => {
      const g = jointRefs.current.get(jointId)
      if (!g) return
      g.rotation.x = euler[0]
      g.rotation.y = euler[1]
      g.rotation.z = euler[2]
    },
    [jointRefs],
  )

  const beginPanelEdit = useCallback(
    (e?: ReactPointerEvent<HTMLElement>) => {
      e?.stopPropagation()
      if (panelEditingRef.current) return
      panelEditingRef.current = true
      setPanelEditing(true)
      emitDragState(true)
      onDragBegin?.()
    },
    [emitDragState, onDragBegin],
  )

  const commitPanelEdit = useCallback(() => {
    if (!panelEditingRef.current) return
    const jointId = selectedRef.current
    if (jointId) onJointChange(jointId, panelEulerRef.current)
    panelEditingRef.current = false
    setPanelEditing(false)
    emitDragState(false)
    onDragCommit?.()
  }, [emitDragState, onDragCommit, onJointChange])

  useEffect(() => {
    if (!panelEditing) return
    window.addEventListener('pointerup', commitPanelEdit)
    window.addEventListener('pointercancel', commitPanelEdit)
    return () => {
      window.removeEventListener('pointerup', commitPanelEdit)
      window.removeEventListener('pointercancel', commitPanelEdit)
    }
  }, [commitPanelEdit, panelEditing])

  useEffect(() => {
    return () => {
      if (panelEditingRef.current || drag.current) emitDragState(false)
    }
  }, [emitDragState])

  const onPanelAxisChange = useCallback(
    (axis: 0 | 1 | 2, valueDeg: number) => {
      const jointId = selectedRef.current
      if (!jointId) return
      const next: Vec3 = [panelEulerRef.current[0], panelEulerRef.current[1], panelEulerRef.current[2]]
      next[axis] = valueDeg / R2D
      panelEulerRef.current = next
      setPanelEuler(next)
      writeJointEuler(jointId, next)
      setActiveAxis(axis)
    },
    [writeJointEuler],
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
      setActiveAxis(axis)
      ;(e.target as unknown as { setPointerCapture?: (id: number) => void })?.setPointerCapture?.(
        e.nativeEvent.pointerId,
      )
      emitDragState(true)
      onDragBegin?.()
      setDragLabel(`${Math.round((currentEuler(jointId)[axis]) * R2D)}°`)
    },
    [jointRefs, angldOnPlane, currentEuler, emitDragState, onDragBegin],
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
      onDragBegin?.()
      setDragLabel('IK')
    },
    [jointRefs, camera, emitDragState, onDragBegin],
  )

  // ── 全局指针移动/抬起（挂在 domElement 上，通过 R3F 的 onPointerMove 容器组件不便，用 window）──
  // 性能：拖拽过程中不调 onJointChange（避免每个 pointermove 触发整棵 3D 子树重渲染）。
  // 命令式直写关节 group 的 rotation，最后一次 onJointChange 在 endDrag 提交。
  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const d = drag.current
      if (!d) return
      e.stopPropagation()
      if (d.kind === 'ring' && d.axis !== undefined && d.ringPlaneNormal && d.ringCenter && d.startEuler) {
        const refDir = orthogonalTo(d.ringPlaneNormal)
        const now = angldOnPlane(e.nativeEvent, d.ringPlaneNormal, d.ringCenter, refDir)
        if (now === null || d.startAngle === undefined) return
        let delta = now - d.startAngle
        // 归一到 [-π, π]，避免跨越 ±π 跳变
        delta = Math.atan2(Math.sin(delta), Math.cos(delta))
        const next: Vec3 = [d.startEuler[0], d.startEuler[1], d.startEuler[2]]
        next[d.axis] = d.startEuler[d.axis] + delta
        const clamped = next
        // 命令式直写：jointRefs 已在 useFrame 跟踪世界变换，本地 rotation 改动立即生效
        const g = jointRefs.current.get(d.jointId)
        if (g) {
          g.rotation.x = clamped[0]
          g.rotation.y = clamped[1]
          g.rotation.z = clamped[2]
        }
        d.lastEuler = clamped
        panelEulerRef.current = clamped
        setPanelEuler(clamped)
        delete d.lastIk
        setDragLabel(`${Math.round(clamped[d.axis] * R2D)}°`)
      } else if (d.kind === 'ik' && d.ikPlaneNormal && d.ikPlanePoint) {
        const ray = pointerRay(e.nativeEvent, gl.domElement, camera)
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(d.ikPlaneNormal, d.ikPlanePoint)
        const hit = new THREE.Vector3()
        if (!ray.intersectPlane(plane, hit)) return
        // IK 同样命令式：solveIkToWorldTargetDirect 直写关节 group rotation，不调 onJointChange
        const ikRes = solveIkToWorldTargetDirect(d.jointId, hit, metrics, jointRefs, false)
        if (ikRes) {
          d.lastIk = ikRes
          delete d.lastEuler
        }
        setDragLabel('IK')
      }
    },
    [angldOnPlane, camera, gl, metrics, jointRefs],
  )

  const endDrag = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const d = drag.current
      if (!d) return
      e.stopPropagation?.()
      // 提交：一次性把拖拽过程中的最终欧拉角同步回 React 状态（actor.joints）
      if (d.kind === 'ring' && d.lastEuler) {
        onJointChange(d.jointId, d.lastEuler)
      } else if (d.kind === 'ik' && d.lastIk) {
        onJointChange(d.lastIk.upper.id, d.lastIk.upper.euler)
        onJointChange(d.lastIk.lower.id, d.lastIk.lower.euler)
      }
      drag.current = null
      setDragLabel(null)
      setActiveAxis(null)
      emitDragState(false)
      onDragCommit?.()
    },
    [emitDragState, onDragCommit, onJointChange],
  )

  // 环渲染数据（选中关节的可用轴）
  const rings = useMemo(() => {
    if (!selected || CURL_JOINTS.has(selected)) return []
    const r = ringRadiusFor(selected) * h
    const out: { axis: 0 | 1 | 2; radius: number }[] = []
    for (let axis = 0 as 0 | 1 | 2; axis < 3; axis = (axis + 1) as 0 | 1 | 2) {
      out.push({ axis, radius: r })
    }
    return out
  }, [selected, h])

  const tubeR = 0.006 * h
  const hideHandles = panelEditing

  return (
    <group
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 关节热点球 */}
      {!hideHandles && SELECTABLE_JOINTS.map((jointId) => {
        const isSel = selected === jointId
        const isHover = hovered === jointId
        const radius = hotspotRadiusFor(jointId) * h * (isHover ? 1.35 : 1)
        const hitRadius = Math.max(MIN_HOTSPOT_HIT * h * 0.72, radius * 2.4)
        return (
          <group
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
            <mesh renderOrder={OVERLAY_ORDER + 1}>
              <sphereGeometry args={[hitRadius, 10, 10]} />
              <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
            <mesh renderOrder={OVERLAY_ORDER}>
              <sphereGeometry args={[radius, 14, 14]} />
              <meshBasicMaterial
                color={isSel ? IK_COLOR : isHover ? HOTSPOT_HOVER : HOTSPOT_COLOR}
                transparent
                opacity={isSel ? 0.78 : isHover ? 0.45 : 0.26}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          </group>
        )
      })}

      {/* 选中关节的旋转环（按父空间轴向） */}
      {!hideHandles && selected && rings.length > 0 && (
        <group ref={ringGroupRef} renderOrder={OVERLAY_ORDER}>
          {rings.map(({ axis, radius }) => {
            const rot: [number, number, number] =
              axis === 0 ? [0, Math.PI / 2, 0] : axis === 1 ? [Math.PI / 2, 0, 0] : [0, 0, 0]
            const isActive = activeAxis === axis
            return (
              <group key={axis}>
                {/* 可见细环（展示用，不参与 raycast：visible 控制 DOM 层不参与事件，但 mesh 仍渲染） */}
                <mesh rotation={rot} renderOrder={OVERLAY_ORDER}>
                  <torusGeometry args={[radius, tubeR, 8, 48]} />
                  <meshBasicMaterial
                    color={AXIS_COLOR[axis]}
                    depthTest={false}
                    depthWrite={false}
                    transparent
                    opacity={isActive ? 1 : 0.45}
                  />
                </mesh>
                {/* 不可见粗环：仅作 raycast 命中区，半径同 visible、管粗 4×便于点中 */}
                <mesh
                  rotation={rot}
                  renderOrder={OVERLAY_ORDER + 1}
                  onPointerDown={onRingDown(selected, axis)}
                  onPointerOver={(e) => e.stopPropagation()}
                >
                  <torusGeometry args={[radius, tubeR * 4, 6, 24]} />
                  <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
                </mesh>
              </group>
            )
          })}
        </group>
      )}

      {/* IK 把手（菱形 octahedron） */}
      {!hideHandles && IK_HANDLES.map((jointId) => {
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

      {selected && (
        <Html fullscreen zIndexRange={[40, 0]} pointerEvents="auto" occlude={false}>
          <div
            className={`stage3d-pose-controller${panelEditing ? ' is-editing' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="stage3d-pose-controller-head">
              <span>{JOINT_LABEL[selected]}</span>
              <button
                type="button"
                className="stage3d-pose-controller-close"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(null)
                  setActiveAxis(null)
                }}
                title="关闭调节器"
              >
                ×
              </button>
            </div>
            <div className="stage3d-pose-controller-axes">
              {AXES.map(({ axis, label }) => {
                const value = Math.round(panelEuler[axis] * R2D)
                return (
                  <label
                    key={label}
                    className={`stage3d-pose-controller-axis axis-${label.toLowerCase()}${activeAxis === axis ? ' active' : ''}`}
                  >
                    <span>{label}</span>
                    <input
                      type="range"
                      min={-360}
                      max={360}
                      step={1}
                      value={value}
                      onPointerDown={beginPanelEdit}
                      onChange={(e) => onPanelAxisChange(axis, Number(e.currentTarget.value))}
                      onBlur={commitPanelEdit}
                    />
                    <output>{value}°</output>
                  </label>
                )
              })}
            </div>
          </div>
        </Html>
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
 * 直写关节 group 的 rotation（命令式），返回两关节的最新欧拉供 commit 时一次性提交。
 */
function solveIkToWorldTargetDirect(
  handleJoint: JointId,
  worldTarget: THREE.Vector3,
  metrics: BodyMetrics,
  jointRefs: RefObject<Map<JointId, THREE.Group>>,
  clamp: boolean,
): { upper: { id: JointId; euler: Vec3 }; lower: { id: JointId; euler: Vec3 } } | null {
  const chain = ikChainFor(handleJoint, metrics)
  if (!chain) return null
  const parentId = IK_UPPER_PARENT[handleJoint]
  const upper = jointRefs.current.get(chain.upperJointId)
  const lower = jointRefs.current.get(chain.lowerJointId)
  if (!upper?.parent || !parentId) return null
  // 上段父空间：upper.parent 的世界矩阵逆
  // 上段父空间世界矩阵含顶层 scale=h；求逆后 worldTarget 落回未缩放本地单位，
  // 与链长 upperLen/lowerLen（未缩放米数）同系，无需再补偿 h。
  const inv = new THREE.Matrix4().copy(upper.parent.matrixWorld).invert()
  const localTarget = worldTarget.clone().applyMatrix4(inv)
  const poleHint = lower ? lower.rotation.x : undefined
  const res = solveTwoBoneIK(chain, localTarget, poleHint, { clamp })
  // 命令式直写两关节 rotation，立即生效（不触发 React 重渲染）
  upper.rotation.x = res.upperEuler[0]
  upper.rotation.y = res.upperEuler[1]
  upper.rotation.z = res.upperEuler[2]
  if (lower) {
    lower.rotation.x = res.lowerEuler[0]
    lower.rotation.y = res.lowerEuler[1]
    lower.rotation.z = res.lowerEuler[2]
  }
  return {
    upper: { id: chain.upperJointId, euler: res.upperEuler },
    lower: { id: chain.lowerJointId, euler: res.lowerEuler },
  }
}
