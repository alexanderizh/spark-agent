import { useCallback, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import { BODY_METRICS, getPose, type BodyMetrics, type JointId, type Vec3 } from './mannequin'

const d = (deg: number): number => (deg * Math.PI) / 180

/** 关节 ref 上报回调：group 挂载时上报，卸载时传 null（供 PoseGizmo 取世界变换）。 */
export type JointRefCallback = (jointId: JointId, group: THREE.Group | null) => void

/**
 * 程序化关节人偶（可动人偶 / 素体手办 body-kun 风格）。
 *
 * 用嵌套 <group> 表达关节层级，每个关节应用「姿势预设角度 + 逐关节覆盖」。
 * 关节层级、原点、旋转轴语义、j()/onJointRef 全部沿用旧版，仅升级各段视觉 mesh：
 *   - 头：饱满颅顶椭球 + 下颌收窄 + 眉弓 / 鼻梁 / 下巴暗示体块。
 *   - 躯干三段：胸甲块（胸大肌 / 锁骨窝 / 肩胛平面）+ 腰腹柔性段（横向分割线）+ 骨盆壳（髋窝开口 / 裆部收角）。
 *   - 关节外露球壳：肩 / 肘 / 腕 / 髋 / 膝 / 踝均为可见深色球关节 + 包壳。
 *   - 四肢：LatheGeometry 自定义纵向轮廓做梭形肌肉段（三角肌 / 二头肌 / 股四头 / 腓肠肌隆起）。
 *   - 手：掌背隆起楔形 + 圆角指节；脚：靴状脚背斜面 + 方正脚跟。
 *
 * 性能：所有 geometry / material 走模块级缓存共享（key 带尺寸 / 颜色），同参数只构建一份；
 * LatheGeometry radialSegments ≤ 18；单人偶目标 < 2 万三角形。
 */

const JOINT_COLOR = '#1f2937'

// ─────────────────────────── 共享缓存 ───────────────────────────
// 同尺寸 / 同色的 geometry / material 全局复用一份，避免多 actor、多 mesh 重复构建。

const geometryCache = new Map<string, THREE.BufferGeometry>()
const materialCache = new Map<string, THREE.MeshStandardMaterial>()

function getGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key)
  if (!g) {
    g = build()
    geometryCache.set(key, g)
  }
  return g
}

/** 主体材质（肢段主色）：同色复用一份。 */
function bodyMaterial(color: string): THREE.MeshStandardMaterial {
  const key = `body:${color}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.07 })
    materialCache.set(key, m)
  }
  return m
}

/** 头部材质：略低粗糙度，做出头雕的柔和高光。 */
function headMaterial(color: string): THREE.MeshStandardMaterial {
  const key = `head:${color}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.06 })
    materialCache.set(key, m)
  }
  return m
}

/** 关节球 / 缝隙材质：深色区隔肢段（沿用 JOINT_COLOR 语义）。 */
function jointMaterial(): THREE.MeshStandardMaterial {
  const key = `joint:${JOINT_COLOR}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: JOINT_COLOR, roughness: 0.48, metalness: 0.16 })
    materialCache.set(key, m)
  }
  return m
}

// ─────────────────────────── LatheGeometry 肢段 ───────────────────────────

/**
 * 纵向轮廓点 = [半径比例, 位置比例]，位置比例 0=关节原点(顶) → 1=末端(底)。
 * 由 build 时映射到 (radius * rFactor, -length * yFactor)。半径比例须 ≥ 0。
 */
type LatheProfile = readonly (readonly [rFactor: number, yFactor: number])[]

/** 肢段轮廓预设（8~12 点，描述肌肉隆起 → 收窄的梭形）。 */
const LIMB_PROFILES = {
  // 大臂：肩端三角肌隆起 → 肱二头鼓包 → 肘前收窄
  upperArm: [
    [0.55, 0.0],
    [1.18, 0.08],
    [1.12, 0.24],
    [1.2, 0.42],
    [1.05, 0.62],
    [0.82, 0.8],
    [0.7, 0.94],
    [0.5, 1.0],
  ],
  // 前臂：近肘粗 → 腕部明显收细
  lowerArm: [
    [0.62, 0.0],
    [1.05, 0.1],
    [1.12, 0.26],
    [0.98, 0.5],
    [0.78, 0.72],
    [0.6, 0.9],
    [0.48, 1.0],
  ],
  // 大腿：腿根粗 → 股四头前鼓 → 膝上收窄
  upperLeg: [
    [0.7, 0.0],
    [1.18, 0.1],
    [1.22, 0.3],
    [1.12, 0.52],
    [0.94, 0.74],
    [0.78, 0.9],
    [0.66, 1.0],
  ],
  // 小腿：膝下 → 腓肠肌后鼓 → 脚踝收细
  lowerLeg: [
    [0.78, 0.0],
    [1.06, 0.14],
    [1.14, 0.32],
    [1.0, 0.54],
    [0.74, 0.78],
    [0.54, 0.92],
    [0.46, 1.0],
  ],
} as const satisfies Record<string, LatheProfile>

/**
 * 由纵向轮廓 + 长度 + 基准半径构建一段梭形肢体的 LatheGeometry。
 * 轮廓沿 -Y 从关节原点延伸 length；radialSegments 16。
 * geometry 按 (profileKey, length, radius) 量化缓存，多 actor 复用。
 */
function limbGeometry(
  profileKey: keyof typeof LIMB_PROFILES,
  length: number,
  radius: number,
): THREE.BufferGeometry {
  const L = Math.round(length * 1000)
  const R = Math.round(radius * 1000)
  return getGeometry(`limb:${profileKey}:${L}:${R}`, () => {
    const profile = LIMB_PROFILES[profileKey]
    const pts: THREE.Vector2[] = profile.map(
      ([rf, yf]) => new THREE.Vector2(Math.max(0, rf * radius), -yf * length),
    )
    // 末端补一个半径 0 的收口点，避免开口。
    if (pts[pts.length - 1]!.x > 1e-4) pts.push(new THREE.Vector2(0, -length))
    return new THREE.LatheGeometry(pts, 16)
  })
}

/** 缓存版球体（关节球 / 头 / 肩球等）。 */
function sphereGeometry(radius: number, wSeg = 16, hSeg = 12): THREE.BufferGeometry {
  const R = Math.round(radius * 1000)
  return getGeometry(`sphere:${R}:${wSeg}:${hSeg}`, () => new THREE.SphereGeometry(radius, wSeg, hSeg))
}

/** 缓存版盒体。 */
function boxGeometry(w: number, h: number, dep: number): THREE.BufferGeometry {
  const key = `box:${Math.round(w * 1000)}:${Math.round(h * 1000)}:${Math.round(dep * 1000)}`
  return getGeometry(key, () => new THREE.BoxGeometry(w, h, dep))
}

/** 缓存版圆柱 / 锥台。 */
function cylGeometry(rTop: number, rBot: number, h: number, seg = 16): THREE.BufferGeometry {
  const key = `cyl:${Math.round(rTop * 1000)}:${Math.round(rBot * 1000)}:${Math.round(h * 1000)}:${seg}`
  return getGeometry(key, () => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1))
}

// ─────────────────────────── 视觉子组件 ───────────────────────────

/**
 * 梭形肢段：从关节原点沿 -Y 延伸 length，纵向轮廓描述肌肉隆起。
 * 用缓存的 LatheGeometry + 共享主体材质。
 */
function Limb({
  profile,
  length,
  radius,
  material,
}: {
  profile: keyof typeof LIMB_PROFILES
  length: number
  radius: number
  material: THREE.MeshStandardMaterial
}) {
  const geo = useMemo(() => limbGeometry(profile, length, radius), [profile, length, radius])
  return <mesh geometry={geo} material={material} castShadow />
}

/** 关节球 + 外露包壳：一枚深色球，外侧叠一枚略大扁球做「护盖」缝隙感。 */
function JointBall({
  radius,
  material,
  cover,
}: {
  radius: number
  material: THREE.MeshStandardMaterial
  /** 外侧护盖偏移方向（局部，可选）：给肘 / 膝外侧圆护盖用。 */
  cover?: { pos: Vec3; r: number } | undefined
}) {
  const ballGeo = useMemo(() => sphereGeometry(radius, 16, 12), [radius])
  const coverGeo = useMemo(
    () => (cover ? sphereGeometry(cover.r, 14, 10) : null),
    [cover],
  )
  return (
    <group>
      <mesh geometry={ballGeo} material={material} castShadow />
      {cover && coverGeo && (
        <mesh
          geometry={coverGeo}
          material={material}
          position={cover.pos}
          scale={[0.6, 1, 1]}
          castShadow
        />
      )}
    </group>
  )
}

/** 一节指节：从当前原点沿 -Y 延伸 length 的圆角扁段（用略缩放的盒近似圆角），绕关节顶端弯曲。 */
function Phalanx({
  length,
  width,
  thickness,
  material,
  curl,
  children,
}: {
  length: number
  width: number
  thickness: number
  material: THREE.MeshStandardMaterial
  /** 本节弯曲角（绕 X 轴，正值向掌心内屈） */
  curl: number
  children?: ReactNode
}) {
  const geo = useMemo(() => boxGeometry(width, length, thickness), [width, length, thickness])
  return (
    <group rotation={[curl, 0, 0]}>
      <mesh geometry={geo} material={material} position={[0, -length / 2, 0]} castShadow />
      {/* 子节挂到本节末端 */}
      <group position={[0, -length, 0]}>{children}</group>
    </group>
  )
}

/**
 * 手掌 + 拇指（两节）+ 四指（三段）联动几何（层级 / 驱动逻辑与旧版一致）。
 * 掌改为掌背隆起楔形；指节圆角。
 */
function Hand({
  length,
  radius,
  material,
  thumb,
  fingers,
}: {
  length: number
  radius: number
  material: THREE.MeshStandardMaterial
  /** [curl, spread, _] 拇指弯曲/张开 */
  thumb: Vec3
  /** [curl, spread, _] 四指弯曲/张开 */
  fingers: Vec3
}) {
  const palmLen = length * 0.62
  const palmWidth = radius * 1.7
  const palmThick = radius * 0.9

  // 四指三段联动：总弯曲 fingersCurl 按 40/35/25 分配
  const fCurl = fingers[0]
  const fSpread = fingers[1]
  const fingerLen = length * 0.42
  const seg = [fingerLen * 0.4, fingerLen * 0.36, fingerLen * 0.24]
  const fCurlSeg = [fCurl * 0.4, fCurl * 0.35, fCurl * 0.25]
  const fingerW = palmWidth * 0.92
  const fingerT = palmThick * 0.7

  // 拇指两段联动：curl 按 55/45，从掌桡侧根部斜出
  const tCurl = thumb[0]
  const tSpread = thumb[1]
  const thumbLen = length * 0.4
  const tSeg = [thumbLen * 0.55, thumbLen * 0.45]
  const tCurlSeg = [tCurl * 0.55, tCurl * 0.45]
  const thumbW = palmThick * 0.9
  const thumbT = palmThick * 0.9

  // 掌背隆起：主掌盒 + 一枚略窄的圆角块叠在掌背（+Z 侧）。
  const palmGeo = useMemo(
    () => boxGeometry(palmWidth, palmLen, palmThick),
    [palmWidth, palmLen, palmThick],
  )
  const knuckleGeo = useMemo(
    () => boxGeometry(palmWidth * 0.88, palmLen * 0.66, palmThick * 0.5),
    [palmWidth, palmLen, palmThick],
  )

  return (
    <group>
      {/* 掌主体 */}
      <mesh geometry={palmGeo} material={material} position={[0, -palmLen / 2, 0]} castShadow />
      {/* 掌背隆起（掌指关节侧的鼓包） */}
      <mesh
        geometry={knuckleGeo}
        material={material}
        position={[0, -palmLen * 0.62, palmThick * 0.32]}
        castShadow
      />

      {/* 四指：掌端下垂三段联动（整体绕掌端张开 fSpread 略外摆） */}
      <group position={[0, -palmLen, 0]}>
        <group rotation={[0, 0, fSpread * 0.5]}>
          <Phalanx length={seg[0]!} width={fingerW} thickness={fingerT} material={material} curl={fCurlSeg[0]!}>
            <Phalanx length={seg[1]!} width={fingerW * 0.9} thickness={fingerT * 0.9} material={material} curl={fCurlSeg[1]!}>
              <Phalanx length={seg[2]!} width={fingerW * 0.8} thickness={fingerT * 0.8} material={material} curl={fCurlSeg[2]!} />
            </Phalanx>
          </Phalanx>
        </group>
      </group>

      {/* 拇指：掌桡侧根部斜出两节（+X 为拇指侧，spread 控制张开角） */}
      <group position={[palmWidth * 0.5, -palmLen * 0.35, 0]} rotation={[0, 0, d(35) + tSpread]}>
        <Phalanx length={tSeg[0]!} width={thumbW} thickness={thumbT} material={material} curl={tCurlSeg[0]!}>
          <Phalanx length={tSeg[1]!} width={thumbW * 0.85} thickness={thumbT * 0.85} material={material} curl={tCurlSeg[1]!} />
        </Phalanx>
      </group>
    </group>
  )
}

/**
 * 脚：靴状——脚踝球关节壳（由上层 JointBall 提供）+ 脚背斜面 + 前脚掌略上翘 + 方正脚跟。
 * 沿 +Z 朝前。
 */
function Foot({
  radius,
  footLen,
  material,
  joint,
}: {
  radius: number
  footLen: number
  material: THREE.MeshStandardMaterial
  joint: THREE.MeshStandardMaterial
}) {
  // 脚背斜面：一段前伸并略上翘的楔（用旋转的盒近似斜面）。
  const bridgeGeo = useMemo(
    () => boxGeometry(radius * 1.9, radius * 1.1, footLen * 0.6),
    [radius, footLen],
  )
  // 前脚掌：略上翘的扁块。
  const toeGeo = useMemo(
    () => boxGeometry(radius * 1.8, radius * 0.7, footLen * 0.42),
    [radius, footLen],
  )
  // 脚跟：方正块。
  const heelGeo = useMemo(
    () => boxGeometry(radius * 1.7, radius * 1.5, footLen * 0.3),
    [radius, footLen],
  )
  // 踝壳：一枚小球罩在脚踝口。
  const ankleGeo = useMemo(() => sphereGeometry(radius * 0.9, 14, 10), [radius])
  return (
    <group position={[0, -radius, 0]}>
      {/* 踝口壳 */}
      <mesh geometry={ankleGeo} material={joint} position={[0, radius * 0.35, 0]} castShadow />
      {/* 脚背斜面（略上翘：绕 X 负旋使前端抬高） */}
      <mesh
        geometry={bridgeGeo}
        material={material}
        position={[0, -radius * 0.05, footLen * 0.2]}
        rotation={[d(-8), 0, 0]}
        castShadow
      />
      {/* 前脚掌上翘 */}
      <mesh
        geometry={toeGeo}
        material={material}
        position={[0, radius * 0.02, footLen * 0.5]}
        rotation={[d(-16), 0, 0]}
        castShadow
      />
      {/* 方正脚跟 */}
      <mesh geometry={heelGeo} material={material} position={[0, -radius * 0.1, -footLen * 0.22]} castShadow />
    </group>
  )
}

/**
 * 人偶本体（不含名字标签 / 选择框，交由 Scene 层叠加）。
 * 以 hips 关节为原点，hips 关节位于地面之上 metrics.hipHeight。
 */
export function MannequinRig({
  actor,
  onJointRef,
}: {
  actor: Stage3DActor
  /** 可选：上报每个关节 group 的 ref（供 PoseGizmo 取世界变换）。不传时零开销。 */
  onJointRef?: JointRefCallback | undefined
}) {
  const metrics: BodyMetrics = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const pose = useMemo(() => getPose(actor.pose), [actor.pose])
  const overrides = actor.joints
  const color = actor.color
  const h = actor.heightScale

  // 每 actor 复用一份主色 / 头部 / 关节材质（同色跨 actor 也共享，见 materialCache）。
  const mat = useMemo(() => bodyMaterial(color), [color])
  const matHead = useMemo(() => headMaterial(color), [color])
  const matJoint = useMemo(() => jointMaterial(), [])

  const j = (id: JointId): Vec3 => eulerFor(id, pose, overrides)

  // 每个关节 group 的 callback ref：未传 onJointRef 时挂一个 no-op（不建立 map，近零开销）。
  // 返回 undefined 会被 exactOptionalPropertyTypes 拒绝，故始终返回函数。
  const jr = useCallback(
    (id: JointId) =>
      (g: THREE.Group | null): void => {
        onJointRef?.(id, g)
      },
    [onJointRef],
  )

  const {
    hipHeight,
    spineLen,
    chestLen,
    neckLen,
    headRadius,
    shoulderWidth,
    upperArmLen,
    lowerArmLen,
    handLen,
    hipWidth,
    upperLegLen,
    lowerLegLen,
    footLen,
    limbRadius,
    torsoRadius,
    jointRadius,
  } = metrics

  // 常用几何（躯干三段 / 头 / 肩球等）走缓存，随尺寸参数量化复用。
  const pelvisGeo = useMemo(
    () => cylGeometry(torsoRadius * 0.82, torsoRadius * 0.6, spineLen * 0.92, 16),
    [torsoRadius, spineLen],
  )
  const pelvisHipSocketGeo = useMemo(() => sphereGeometry(jointRadius * 1.1, 12, 10), [jointRadius])
  const waistGeo = useMemo(
    () => cylGeometry(torsoRadius * 0.84, torsoRadius * 0.72, spineLen * 0.7, 16),
    [torsoRadius, spineLen],
  )
  const waistRingGeo = useMemo(
    () => cylGeometry(torsoRadius * 0.74, torsoRadius * 0.74, spineLen * 0.08, 16),
    [torsoRadius, spineLen],
  )
  const chestGeo = useMemo(
    () => cylGeometry(torsoRadius * 1.08, torsoRadius * 0.82, chestLen, 18),
    [torsoRadius, chestLen],
  )
  const pecGeo = useMemo(() => sphereGeometry(torsoRadius * 0.42, 14, 10), [torsoRadius])
  const scapulaGeo = useMemo(
    () => boxGeometry(shoulderWidth * 1.5, chestLen * 0.5, torsoRadius * 0.3),
    [shoulderWidth, chestLen, torsoRadius],
  )
  const shoulderBarGeo = useMemo(() => sphereGeometry(shoulderWidth * 1.02, 16, 10), [shoulderWidth])
  const neckGeo = useMemo(
    () => cylGeometry(jointRadius * 0.82, jointRadius * 0.98, neckLen, 12),
    [jointRadius, neckLen],
  )
  const headGeo = useMemo(() => sphereGeometry(headRadius, 20, 16), [headRadius])
  const jawGeo = useMemo(
    () => cylGeometry(headRadius * 0.82, headRadius * 0.46, headRadius * 0.72, 14),
    [headRadius],
  )
  const browGeo = useMemo(
    () => boxGeometry(headRadius * 1.1, headRadius * 0.22, headRadius * 0.4),
    [headRadius],
  )
  const noseGeo = useMemo(() => boxGeometry(headRadius * 0.28, headRadius * 0.5, headRadius * 0.3), [headRadius])
  const shoulderBallGeo = useMemo(() => sphereGeometry(jointRadius * 0.95, 16, 12), [jointRadius])
  const elbowBallGeo = useMemo(() => sphereGeometry(jointRadius * 0.72, 14, 10), [jointRadius])
  const wristBallGeo = useMemo(() => sphereGeometry(jointRadius * 0.6, 12, 10), [jointRadius])
  const hipBallGeo = useMemo(() => sphereGeometry(jointRadius * 0.92, 16, 12), [jointRadius])
  const kneeBallGeo = useMemo(() => sphereGeometry(jointRadius * 0.8, 14, 10), [jointRadius])

  return (
    <group scale={[h, h, h]}>
      {/* hips 根关节 */}
      <group ref={jr('hips')} position={[0, hipHeight, 0]} rotation={j('hips')}>
        {/* 骨盆壳：短裤状锥台（略扁），髋两侧嵌球关节窝开口，裆部靠下窄收角。 */}
        <group position={[0, -0.02, 0]}>
          <mesh geometry={pelvisGeo} material={mat} scale={[1, 1, 0.72]} castShadow />
          {/* 髋窝开口壳（左右） */}
          <mesh geometry={pelvisHipSocketGeo} material={matJoint} position={[-hipWidth * 0.9, -spineLen * 0.12, 0]} castShadow />
          <mesh geometry={pelvisHipSocketGeo} material={matJoint} position={[hipWidth * 0.9, -spineLen * 0.12, 0]} castShadow />
        </group>

        {/* 脊柱 → 胸 → 颈 → 头（spine 起点保持在 hips 原点，头顶高度公式不变） */}
        <group ref={jr('spine')} position={[0, 0, 0]} rotation={j('spine')}>
          {/* 腰腹柔性段：较细锥台 + 一道横向分割线环 */}
          <mesh geometry={waistGeo} material={mat} position={[0, spineLen * 0.5, 0]} scale={[1, 1, 0.8]} castShadow />
          <mesh geometry={waistRingGeo} material={matJoint} position={[0, spineLen * 0.55, 0]} scale={[1, 1, 0.8]} castShadow />
          <group ref={jr('chest')} position={[0, spineLen, 0]} rotation={j('chest')}>
            {/* 胸甲块：上宽下窄、前后压扁锥台 */}
            <mesh geometry={chestGeo} material={mat} position={[0, chestLen / 2, 0]} scale={[1, 1, 0.66]} castShadow />
            {/* 胸大肌隆起（左右两枚扁球，前凸） */}
            <mesh geometry={pecGeo} material={mat} position={[-torsoRadius * 0.38, chestLen * 0.6, torsoRadius * 0.42]} scale={[1, 0.8, 0.7]} castShadow />
            <mesh geometry={pecGeo} material={mat} position={[torsoRadius * 0.38, chestLen * 0.6, torsoRadius * 0.42]} scale={[1, 0.8, 0.7]} castShadow />
            {/* 背面肩胛平面 */}
            <mesh geometry={scapulaGeo} material={mat} position={[0, chestLen * 0.7, -torsoRadius * 0.6]} castShadow />
            {/* 肩线横梁：连接两肩 */}
            <mesh geometry={shoulderBarGeo} material={mat} position={[0, chestLen * 0.86, 0]} scale={[1, 0.5, 0.55]} castShadow />

            {/* 颈 + 头（颈略前倾做喉部） */}
            <group ref={jr('neck')} position={[0, chestLen, 0]} rotation={j('neck')}>
              <mesh geometry={neckGeo} material={mat} position={[0, neckLen / 2, 0]} rotation={[d(-6), 0, 0]} castShadow />
              <group ref={jr('head')} position={[0, neckLen, 0]} rotation={j('head')}>
                {/* 颅顶饱满椭球 */}
                <mesh geometry={headGeo} material={matHead} position={[0, headRadius, 0]} scale={[0.92, 1.14, 0.98]} castShadow />
                {/* 下颌收窄锥台 */}
                <mesh geometry={jawGeo} material={matHead} position={[0, headRadius * 0.46, headRadius * 0.14]} scale={[0.84, 1, 0.86]} castShadow />
                {/* 眉弓暗示 */}
                <mesh geometry={browGeo} material={matHead} position={[0, headRadius * 1.02, headRadius * 0.78]} castShadow />
                {/* 鼻梁小楔 */}
                <mesh geometry={noseGeo} material={matHead} position={[0, headRadius * 0.86, headRadius * 0.9]} rotation={[d(10), 0, 0]} castShadow />
              </group>
            </group>

            {/* 左臂 */}
            <group ref={jr('shoulderL')} position={[-shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderL')}>
              {/* 肩球嵌进胸甲侧面 */}
              <mesh geometry={shoulderBallGeo} material={matJoint} castShadow />
              <group ref={jr('upperArmL')} rotation={j('upperArmL')}>
                <Limb profile="upperArm" length={upperArmLen} radius={limbRadius} material={mat} />
                <group ref={jr('lowerArmL')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmL')}>
                  {/* 肘：球 + 外侧圆护盖 */}
                  <mesh geometry={elbowBallGeo} material={matJoint} castShadow />
                  <mesh geometry={elbowBallGeo} material={matJoint} position={[-limbRadius * 0.9, 0, 0]} scale={[0.6, 1, 1]} castShadow />
                  <Limb profile="lowerArm" length={lowerArmLen} radius={limbRadius * 0.86} material={mat} />
                  <group ref={jr('handL')} position={[0, -lowerArmLen, 0]} rotation={j('handL')}>
                    {/* 腕壳 */}
                    <mesh geometry={wristBallGeo} material={matJoint} castShadow />
                    <group ref={jr('fingersL')} />
                    <group ref={jr('thumbL')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      material={mat}
                      thumb={j('thumbL')}
                      fingers={j('fingersL')}
                    />
                  </group>
                </group>
              </group>
            </group>

            {/* 右臂 */}
            <group ref={jr('shoulderR')} position={[shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderR')}>
              <mesh geometry={shoulderBallGeo} material={matJoint} castShadow />
              <group ref={jr('upperArmR')} rotation={j('upperArmR')}>
                <Limb profile="upperArm" length={upperArmLen} radius={limbRadius} material={mat} />
                <group ref={jr('lowerArmR')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmR')}>
                  <mesh geometry={elbowBallGeo} material={matJoint} castShadow />
                  <mesh geometry={elbowBallGeo} material={matJoint} position={[limbRadius * 0.9, 0, 0]} scale={[0.6, 1, 1]} castShadow />
                  <Limb profile="lowerArm" length={lowerArmLen} radius={limbRadius * 0.86} material={mat} />
                  <group ref={jr('handR')} position={[0, -lowerArmLen, 0]} rotation={j('handR')}>
                    <mesh geometry={wristBallGeo} material={matJoint} castShadow />
                    <group ref={jr('fingersR')} />
                    <group ref={jr('thumbR')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      material={mat}
                      thumb={j('thumbR')}
                      fingers={j('fingersR')}
                    />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* 左腿 */}
        <group ref={jr('upperLegL')} position={[-hipWidth, -0.02, 0]} rotation={j('upperLegL')}>
          {/* 髋球 */}
          <mesh geometry={hipBallGeo} material={matJoint} castShadow />
          <Limb profile="upperLeg" length={upperLegLen} radius={limbRadius * 1.35} material={mat} />
          <group ref={jr('lowerLegL')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegL')}>
            {/* 膝：球 + 外侧圆护盖（膝盖前凸靠 +Z 护盖） */}
            <mesh geometry={kneeBallGeo} material={matJoint} castShadow />
            <mesh geometry={kneeBallGeo} material={matJoint} position={[0, 0, limbRadius * 1.1]} scale={[1, 1, 0.55]} castShadow />
            <Limb profile="lowerLeg" length={lowerLegLen} radius={limbRadius * 1.02} material={mat} />
            <group ref={jr('footL')} position={[0, -lowerLegLen, 0]} rotation={j('footL')}>
              <Foot radius={limbRadius} footLen={footLen} material={mat} joint={matJoint} />
            </group>
          </group>
        </group>

        {/* 右腿 */}
        <group ref={jr('upperLegR')} position={[hipWidth, -0.02, 0]} rotation={j('upperLegR')}>
          <mesh geometry={hipBallGeo} material={matJoint} castShadow />
          <Limb profile="upperLeg" length={upperLegLen} radius={limbRadius * 1.35} material={mat} />
          <group ref={jr('lowerLegR')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegR')}>
            <mesh geometry={kneeBallGeo} material={matJoint} castShadow />
            <mesh geometry={kneeBallGeo} material={matJoint} position={[0, 0, limbRadius * 1.1]} scale={[1, 1, 0.55]} castShadow />
            <Limb profile="lowerLeg" length={lowerLegLen} radius={limbRadius * 1.02} material={mat} />
            <group ref={jr('footR')} position={[0, -lowerLegLen, 0]} rotation={j('footR')}>
              <Foot radius={limbRadius} footLen={footLen} material={mat} joint={matJoint} />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

function eulerFor(
  jointId: JointId,
  pose: ReturnType<typeof getPose>,
  overrides: Stage3DActor['joints'],
): Vec3 {
  const base = pose[jointId] ?? [0, 0, 0]
  const ov = overrides?.[jointId]
  if (!ov) return base
  return [base[0] + ov[0], base[1] + ov[1], base[2] + ov[2]]
}

/** 计算人偶用于选择框 / 名字标签的大致头顶高度（世界单位，未含 position）。 */
export function mannequinTopHeight(actor: Stage3DActor): number {
  const m = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const raw = m.hipHeight + m.spineLen + m.chestLen + m.neckLen + m.headRadius * 2
  return raw * actor.heightScale
}

/** 供选择时用的近似半径（做 XZ 命中/包围） */
export function mannequinRadius(actor: Stage3DActor): number {
  const m = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  return Math.max(m.shoulderWidth, m.torsoRadius) * actor.heightScale + 0.15
}

/** 测试 / 调试用：暴露肢段轮廓表做几何 sanity 自查。 */
export { LIMB_PROFILES, limbGeometry }

export { THREE }
