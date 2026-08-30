import { useCallback, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import { BODY_METRICS, getPose, type BodyMetrics, type JointId, type Vec3 } from './mannequin'

const d = (deg: number): number => (deg * Math.PI) / 180

/** 关节 ref 上报回调：group 挂载时上报，卸载时传 null（供 PoseGizmo 取世界变换）。 */
export type JointRefCallback = (jointId: JointId, group: THREE.Group | null) => void

/**
 * 程序化关节人偶 R4（素体手办 / body-kun 风格，向「一体雕塑感」升级）。
 *
 * 关节层级、原点、旋转轴语义、j()/onJointRef 全部沿用旧版，仅重做视觉 mesh：
 *   - 曲面管线：自定义 loft 放样（椭圆截面 rx/rz + 前后偏移 zc 三通道，smoothstep 插值），
 *     躯干三段与四肢全部走该管线，肌肉隆起是真正的非回转体（小腿后鼓、股四头/胸肌前凸）。
 *   - 同色隐藏式关节：废弃黑色外露球，关节件用主体色加深的同色调；
 *     肩加三角肌甲片（随大臂动）、肘/膝为双碟铰链、膝盖骨甲片覆前方。
 *   - 头雕：颅骨 + 中脸块 + 下颌 + 眉弓 + 眼球 + 鼻 + 唇 + 耳（全部主体色，靠光影成型）。
 *   - 鞋型脚：鞋底 / 脚跟 / 脚背 / 鞋头分件，按 hipHeight-腿长 算出踝高，鞋底严格贴地。
 *
 * 性能：所有 geometry / material 走模块级缓存共享（key 带尺寸 / 颜色），同参数只构建一份；
 * loft 径向 20~24 段、纵向 ≤ 24 环；单人偶目标 < 2 万三角形。
 */

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
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.05 })
    materialCache.set(key, m)
  }
  return m
}

/** 头部材质：略低粗糙度，做出头雕的柔和高光。 */
function headMaterial(color: string): THREE.MeshStandardMaterial {
  const key = `head:${color}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0.04 })
    materialCache.set(key, m)
  }
  return m
}

/**
 * 关节件材质：主体色加深的同色调（素体手办的关节与本体同色，仅靠明度区分分件），
 * 不再使用黑色外露球。
 */
function jointMaterial(color: string): THREE.MeshStandardMaterial {
  const key = `joint:${color}`
  let m = materialCache.get(key)
  if (!m) {
    const c = new THREE.Color(color)
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.02), Math.max(0.04, hsl.l * 0.58))
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.08 })
    materialCache.set(key, m)
  }
  return m
}

// ─────────────────────────── loft 放样曲面 ───────────────────────────

/** 采样通道：[t, value] 控制点序列，t ∈ [0,1] 单调递增。 */
type Channel = readonly (readonly [t: number, v: number])[]

/** 控制点间 smoothstep 插值（节点处斜率为 0，天然形成圆润的肌肉隆起过渡）。 */
function sampleChannel(ch: Channel, t: number): number {
  const first = ch[0]!
  const last = ch[ch.length - 1]!
  if (t <= first[0]) return first[1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < ch.length - 1; i++) {
    const [t0, v0] = ch[i]!
    const [t1, v1] = ch[i + 1]!
    if (t >= t0 && t <= t1) {
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0
      const s = u * u * (3 - 2 * u)
      return v0 + (v1 - v0) * s
    }
  }
  return last[1]
}

type LoftOpts = {
  /** 纵向总长：t=0 在 y=0（顶），t=1 在 y=-length（底）。 */
  length: number
  /** 横向半宽（X 半轴），米。 */
  rx: Channel
  /** 前后半深（Z 半轴），米。 */
  rz: Channel
  /** 截面中心的前后偏移（+Z 前），米。缺省为 0。 */
  zc?: Channel
  rings?: number
  seg?: number
}

/**
 * 多通道放样曲面：沿 -Y 逐环放样椭圆截面（宽 / 深 / 前后偏移三通道独立插值），
 * 首尾加中心扇面封口。索引共享顶点 + computeVertexNormals → 平滑着色。
 */
function buildLoft(opts: LoftOpts): THREE.BufferGeometry {
  const rings = opts.rings ?? 22
  const seg = opts.seg ?? 22
  const positions: number[] = []
  const indices: number[] = []

  for (let r = 0; r <= rings; r++) {
    const t = r / rings
    const y = -t * opts.length
    const rx = Math.max(0, sampleChannel(opts.rx, t))
    const rz = Math.max(0, sampleChannel(opts.rz, t))
    const zc = opts.zc ? sampleChannel(opts.zc, t) : 0
    for (let i = 0; i < seg; i++) {
      const theta = (i / seg) * Math.PI * 2
      positions.push(rx * Math.cos(theta), y, zc + rz * Math.sin(theta))
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * seg + i
      const b = r * seg + ((i + 1) % seg)
      const c = (r + 1) * seg + i
      const e = (r + 1) * seg + ((i + 1) % seg)
      indices.push(a, c, b, b, c, e)
    }
  }
  // 顶 / 底中心封口
  const topCenter = positions.length / 3
  {
    const zc = opts.zc ? sampleChannel(opts.zc, 0) : 0
    positions.push(0, 0, zc)
  }
  const bottomCenter = positions.length / 3
  {
    const zc = opts.zc ? sampleChannel(opts.zc, 1) : 0
    positions.push(0, -opts.length, zc)
  }
  for (let i = 0; i < seg; i++) {
    indices.push(topCenter, i, (i + 1) % seg)
    const base = rings * seg
    indices.push(bottomCenter, base + ((i + 1) % seg), base + i)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** 缓存版 loft：key 由调用方给出（须编码全部尺寸参数）。 */
function loftGeometry(key: string, opts: LoftOpts): THREE.BufferGeometry {
  return getGeometry(`loft:${key}`, () => buildLoft(opts))
}

const q = (v: number): number => Math.round(v * 1000)

// ─────────────────────────── 肢段轮廓 ───────────────────────────

/**
 * 纵向轮廓点 = [半径比例, 位置比例]，位置比例 0=关节原点(顶) → 1=末端(底)。
 * 由 build 时映射到 (radius * rFactor, -length * yFactor)。半径比例须 ≥ 0。
 */
type LatheProfile = readonly (readonly [rFactor: number, yFactor: number])[]

/** 肢段轮廓预设（6~12 点，描述肌肉隆起 → 收窄的梭形）。 */
const LIMB_PROFILES = {
  // 大臂：三角肌甲片盖住顶端 → 肱二头鼓包 → 肘前收窄
  upperArm: [
    [0.72, 0.0],
    [1.04, 0.12],
    [1.0, 0.28],
    [1.08, 0.46],
    [0.92, 0.66],
    [0.76, 0.85],
    [0.6, 1.0],
  ],
  // 前臂：近肘粗（旋前圆肌群）→ 腕部明显收细
  lowerArm: [
    [0.6, 0.0],
    [0.98, 0.1],
    [1.06, 0.28],
    [0.9, 0.52],
    [0.72, 0.75],
    [0.55, 0.92],
    [0.48, 1.0],
  ],
  // 大腿：腿根粗 → 股四头鼓 → 膝上收窄（峰值 1.22 与穿模回归测试联动，勿轻改）
  upperLeg: [
    [0.72, 0.0],
    [1.1, 0.08],
    [1.22, 0.3],
    [1.1, 0.52],
    [0.94, 0.74],
    [0.8, 0.9],
    [0.68, 1.0],
  ],
  // 小腿：膝下 → 腓肠肌鼓（配合 zc 通道整体后移）→ 脚踝收细
  lowerLeg: [
    [0.74, 0.0],
    [0.96, 0.1],
    [1.14, 0.3],
    [0.98, 0.55],
    [0.7, 0.8],
    [0.52, 0.94],
    [0.44, 1.0],
  ],
} as const satisfies Record<string, LatheProfile>

/**
 * 肢段截面修形：ez = 深宽比通道（rz = rx * ez），zc = 前后偏移通道（× radius）。
 * 让四肢摆脱回转体：前臂向腕部压扁、小腿腓肠肌真正向后鼓、股四头向前。
 */
const LIMB_SHAPE: Record<
  keyof typeof LIMB_PROFILES,
  { ez: Channel; zc?: Channel }
> = {
  upperArm: { ez: [[0, 1.0], [1, 0.86]], zc: [[0, 0], [0.45, 0.06], [1, 0]] },
  lowerArm: { ez: [[0, 1.05], [1, 0.74]] },
  upperLeg: { ez: [[0, 1.06], [0.4, 1.1], [1, 0.9]], zc: [[0, 0.02], [0.35, 0.07], [1, 0]] },
  lowerLeg: { ez: [[0, 1.0], [0.3, 1.22], [1, 0.76]], zc: [[0, 0], [0.3, -0.34], [0.72, -0.1], [1, 0]] },
}

/**
 * 由纵向轮廓 + 截面修形 + 长度 + 基准半径构建一段肢体的 loft 曲面。
 * geometry 按 (profileKey, length, radius) 量化缓存，多 actor 复用。
 */
function limbGeometry(
  profileKey: keyof typeof LIMB_PROFILES,
  length: number,
  radius: number,
): THREE.BufferGeometry {
  return getGeometry(`limb:${profileKey}:${q(length)}:${q(radius)}`, () => {
    const profile = LIMB_PROFILES[profileKey]
    const shape = LIMB_SHAPE[profileKey]
    const rx: [number, number][] = profile.map(([rf, yf]) => [yf, rf * radius])
    const rz: [number, number][] = rx.map(([t, r]) => [t, r * sampleChannel(shape.ez, t)])
    const zc: [number, number][] | undefined = shape.zc
      ? shape.zc.map(([t, v]) => [t, v * radius])
      : undefined
    return buildLoft({ length, rx, rz, ...(zc ? { zc } : {}), rings: 24, seg: 20 })
  })
}

/** 缓存版球体（关节球 / 头雕体块等）。 */
function sphereGeometry(radius: number, wSeg = 14, hSeg = 10): THREE.BufferGeometry {
  return getGeometry(`sphere:${q(radius)}:${wSeg}:${hSeg}`, () => new THREE.SphereGeometry(radius, wSeg, hSeg))
}

/** 缓存版盒体。 */
function boxGeometry(w: number, h: number, dep: number): THREE.BufferGeometry {
  return getGeometry(`box:${q(w)}:${q(h)}:${q(dep)}`, () => new THREE.BoxGeometry(w, h, dep))
}

/** 缓存版圆柱 / 锥台。 */
function cylGeometry(rTop: number, rBot: number, h: number, seg = 16): THREE.BufferGeometry {
  return getGeometry(
    `cyl:${q(rTop)}:${q(rBot)}:${q(h)}:${seg}`,
    () => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1),
  )
}

/** 缓存版圆环：用于关节缝、衣甲边线、踝口等细节。 */
function torusGeometry(radius: number, tube: number, radialSeg = 8, tubularSeg = 24): THREE.BufferGeometry {
  return getGeometry(
    `torus:${q(radius)}:${q(tube)}:${radialSeg}:${tubularSeg}`,
    () => new THREE.TorusGeometry(radius, tube, radialSeg, tubularSeg),
  )
}

// ─────────────────────────── 视觉子组件 ───────────────────────────

/** 梭形肢段：从关节原点沿 -Y 延伸 length（loft 曲面 + 共享主体材质）。 */
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

/**
 * 铰链关节（肘 / 膝）：横向圆柱轴 + 两侧圆碟护盖，同色深调。
 * 素体手办的双碟铰链外观，替代旧版黑色球关节。
 */
function HingeJoint({
  radius,
  width,
  material,
}: {
  radius: number
  width: number
  material: THREE.MeshStandardMaterial
}) {
  const axleGeo = cylGeometry(radius, radius, width, 14)
  const discGeo = sphereGeometry(radius * 1.02, 14, 10)
  return (
    <group>
      <mesh geometry={axleGeo} material={material} rotation={[0, 0, Math.PI / 2]} castShadow />
      <mesh geometry={discGeo} material={material} position={[-width / 2, 0, 0]} scale={[0.38, 1, 1]} castShadow />
      <mesh geometry={discGeo} material={material} position={[width / 2, 0, 0]} scale={[0.38, 1, 1]} castShadow />
    </group>
  )
}

/** 一节指节：从当前原点沿 -Y 延伸 length 的圆角扁段，绕关节顶端弯曲。 */
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
  const geo = boxGeometry(width, length, thickness)
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
 * 掌背加指节脊（横向圆柱），末节指尖加圆头，摆脱纯方块感。
 */
function Hand({
  length,
  radius,
  material,
  joint,
  side,
  thumb,
  fingers,
}: {
  length: number
  radius: number
  material: THREE.MeshStandardMaterial
  joint: THREE.MeshStandardMaterial
  side: 'L' | 'R'
  /** [curl, spread, _] 拇指弯曲/张开 */
  thumb: Vec3
  /** [curl, spread, _] 四指弯曲/张开 */
  fingers: Vec3
}) {
  const palmLen = length * 0.62
  const palmWidth = radius * 1.7
  const palmThick = radius * 0.82

  // 四指三段联动：总弯曲 fingersCurl 按 40/35/25 分配
  const fCurl = fingers[0]
  const fSpread = fingers[1]
  const fingerLen = length * 0.42
  const seg = [fingerLen * 0.4, fingerLen * 0.36, fingerLen * 0.24]
  const fCurlSeg = [fCurl * 0.4, fCurl * 0.35, fCurl * 0.25]
  const fingerW = palmWidth * 0.18
  const fingerT = palmThick * 0.58

  // 拇指两段联动：curl 按 55/45，从掌桡侧根部斜出
  const tCurl = thumb[0]
  const tSpread = thumb[1]
  const thumbLen = length * 0.4
  const tSeg = [thumbLen * 0.55, thumbLen * 0.45]
  const tCurlSeg = [tCurl * 0.55, tCurl * 0.45]
  const thumbW = palmThick * 0.85
  const thumbT = palmThick * 0.85

  const palmGeo = boxGeometry(palmWidth, palmLen, palmThick)
  const palmPlateGeo = sphereGeometry(radius * 0.72, 14, 10)
  const knuckleGeo = sphereGeometry(fingerW * 0.55, 10, 8)
  const tipGeo = sphereGeometry(fingerT * 0.52, 10, 8)
  const thumbTipGeo = sphereGeometry(thumbT * 0.5, 10, 8)
  const wristCuffGeo = torusGeometry(radius * 0.58, radius * 0.08, 8, 22)
  const fingerXs = [-0.36, -0.12, 0.12, 0.36]
  const fingerLengthFactors = [0.9, 1.04, 1, 0.82]
  const thumbSide = side === 'L' ? -1 : 1

  return (
    <group>
      {/* 腕口深色环 + 掌主体 */}
      <mesh geometry={wristCuffGeo} material={joint} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 0.82, 1]} castShadow />
      <mesh geometry={palmGeo} material={material} position={[0, -palmLen / 2, 0]} castShadow />
      <mesh geometry={palmPlateGeo} material={material} position={[0, -palmLen * 0.48, palmThick * 0.18]} scale={[1.05, 0.55, 0.36]} castShadow />
      {/* 掌指关节脊：四个独立鼓点，手型可读性比整排方块更高。 */}
      <mesh
        geometry={palmPlateGeo}
        material={material}
        position={[0, -palmLen * 0.92, palmThick * 0.18]}
        scale={[1.18, 0.2, 0.18]}
        castShadow
      />

      {/* 四指：仍由一个 fingers curl 驱动，但拆成四根三段指节，兼顾操作简单和视觉层次。 */}
      {fingerXs.map((xf, index) => {
        const x = xf * palmWidth
        const lenFactor = fingerLengthFactors[index]!
        const spreadSign = xf < 0 ? -1 : 1
        return (
          <group
            key={xf}
            position={[x, -palmLen * 0.96, 0]}
            rotation={[0, 0, spreadSign * fSpread * (0.25 + Math.abs(xf))]}
          >
            <mesh geometry={knuckleGeo} material={joint} position={[0, 0.004, palmThick * 0.16]} scale={[1.05, 0.55, 0.7]} castShadow />
            <Phalanx length={seg[0]! * lenFactor} width={fingerW} thickness={fingerT} material={material} curl={fCurlSeg[0]!}>
              <Phalanx length={seg[1]! * lenFactor} width={fingerW * 0.88} thickness={fingerT * 0.9} material={material} curl={fCurlSeg[1]!}>
                <Phalanx length={seg[2]! * lenFactor} width={fingerW * 0.72} thickness={fingerT * 0.78} material={material} curl={fCurlSeg[2]!}>
                  <mesh geometry={tipGeo} material={material} scale={[fingerW * 0.7 / (fingerT * 0.52), 1, 1]} castShadow />
                </Phalanx>
              </Phalanx>
            </Phalanx>
          </group>
        )
      })}

      {/* 拇指：掌桡侧根部斜出两节，side 决定左右手外侧方向。 */}
      <group
        position={[thumbSide * palmWidth * 0.5, -palmLen * 0.35, 0]}
        rotation={[0, 0, thumbSide * (d(35) + tSpread)]}
      >
        <mesh geometry={knuckleGeo} material={joint} position={[0, 0.004, 0]} scale={[1.25, 0.72, 0.8]} castShadow />
        <Phalanx length={tSeg[0]!} width={thumbW} thickness={thumbT} material={material} curl={tCurlSeg[0]!}>
          <Phalanx length={tSeg[1]!} width={thumbW * 0.85} thickness={thumbT * 0.85} material={material} curl={tCurlSeg[1]!}>
            <mesh geometry={thumbTipGeo} material={material} castShadow />
          </Phalanx>
        </Phalanx>
      </group>
    </group>
  )
}

/**
 * 鞋型脚：鞋底 / 脚跟 / 脚背 / 鞋头分件 + 深色踝口，沿 +Z 朝前。
 * ankleHeight = 踝关节原点到地面的距离（hipHeight - 大腿 - 小腿），鞋底严格贴地。
 */
function Foot({
  radius,
  footLen,
  ankleHeight,
  material,
  joint,
}: {
  radius: number
  footLen: number
  ankleHeight: number
  material: THREE.MeshStandardMaterial
  joint: THREE.MeshStandardMaterial
}) {
  const ah = Math.max(ankleHeight, radius * 1.1)
  const soleH = ah * 0.24
  const soleGeo = boxGeometry(radius * 2.05, soleH, footLen * 1.18)
  const heelGeo = sphereGeometry(radius * 1.02, 14, 10)
  const bridgeGeo = boxGeometry(radius * 1.85, ah * 0.62, footLen * 0.62)
  const toeGeo = sphereGeometry(radius * 0.95, 14, 10)
  const cuffGeo = cylGeometry(radius * 0.72, radius * 0.85, ah * 0.5, 12)
  const ankleRingGeo = torusGeometry(radius * 0.72, radius * 0.08, 8, 22)
  const toeSeamGeo = torusGeometry(radius * 0.72, radius * 0.045, 8, 20)
  return (
    <group>
      {/* 踝口（深调收口 + 圆环边线） */}
      <mesh geometry={cuffGeo} material={joint} position={[0, -ah * 0.2, 0]} castShadow />
      <mesh geometry={ankleRingGeo} material={joint} position={[0, -ah * 0.44, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.82, 1]} castShadow />
      {/* 鞋底：贴地平板，覆盖全脚长 */}
      <mesh geometry={soleGeo} material={joint} position={[0, -ah + soleH / 2, footLen * 0.26]} castShadow />
      {/* 脚跟圆包 */}
      <mesh geometry={heelGeo} material={material} position={[0, -ah * 0.58, -footLen * 0.08]} scale={[1, 0.85, 1.05]} castShadow />
      {/* 脚背斜面（略前倾的楔） */}
      <mesh
        geometry={bridgeGeo}
        material={material}
        position={[0, -ah * 0.48, footLen * 0.18]}
        rotation={[d(-12), 0, 0]}
        castShadow
      />
      {/* 鞋头圆包（扁宽） */}
      <mesh geometry={toeGeo} material={material} position={[0, -ah * 0.68, footLen * 0.56]} scale={[1.08, 0.62, 1.3]} castShadow />
      <mesh geometry={toeSeamGeo} material={joint} position={[0, -ah * 0.66, footLen * 0.38]} rotation={[d(82), 0, 0]} scale={[1.2, 0.55, 1]} castShadow />
    </group>
  )
}

/**
 * 头雕：整头一条纵向 loft（颅顶 → 颞线 → 颧骨 → 下颌尖连续曲面，避免球体穿插缝），
 * 叠加眉弓 / 眼 / 鼻 / 唇 / 耳小体块，全部主体色靠光影成型。face 朝 +Z。
 */
function HeadSculpt({
  R,
  material,
  detail,
}: {
  R: number
  material: THREE.MeshStandardMaterial
  detail: THREE.MeshStandardMaterial
}) {
  // 头总高 ~2R：loft 顶在颅顶（t=0），底在下颌尖（t=1）。
  const headGeo = loftGeometry(`head:${q(R)}`, {
    length: R * 1.9,
    rx: [[0, R * 0.16], [0.14, R * 0.6], [0.34, R * 0.8], [0.52, R * 0.78], [0.72, R * 0.62], [0.9, R * 0.4], [1, R * 0.14]],
    rz: [[0, R * 0.2], [0.14, R * 0.68], [0.34, R * 0.9], [0.55, R * 0.84], [0.75, R * 0.62], [0.92, R * 0.38], [1, R * 0.14]],
    zc: [[0, 0], [0.35, R * 0.02], [0.7, R * 0.08], [0.9, R * 0.14], [1, R * 0.18]],
    rings: 22,
    seg: 22,
  })
  const browGeo = sphereGeometry(R * 0.38, 12, 8)
  const eyeSocketGeo = sphereGeometry(R * 0.035, 10, 8)
  const eyelidGeo = sphereGeometry(R * 0.07, 10, 8)
  const noseGeo = sphereGeometry(R * 0.13, 10, 8)
  const lipGeo = sphereGeometry(R * 0.13, 10, 8)
  const earGeo = sphereGeometry(R * 0.18, 10, 8)
  const cheekGeo = sphereGeometry(R * 0.3, 12, 8)
  const jawGeo = sphereGeometry(R * 0.26, 12, 8)
  const neckLineGeo = cylGeometry(R * 0.025, R * 0.02, R * 0.48, 8)
  return (
    <group>
      {/* 整头曲面（loft 顶对齐颅顶 y=2R） */}
      <mesh geometry={headGeo} material={material} position={[0, R * 2.0, 0]} castShadow />
      {/* 眉弓与眼窝：眼睛改成浅凹槽，避免旧版凸眼泡。 */}
      <mesh geometry={browGeo} material={material} position={[0, R * 1.18, R * 0.6]} scale={[1.05, 0.18, 0.28]} castShadow />
      <mesh geometry={eyeSocketGeo} material={detail} position={[-R * 0.25, R * 1.05, R * 0.7]} scale={[2.0, 0.26, 0.08]} castShadow />
      <mesh geometry={eyeSocketGeo} material={detail} position={[R * 0.25, R * 1.05, R * 0.7]} scale={[2.0, 0.26, 0.08]} castShadow />
      <mesh geometry={eyelidGeo} material={material} position={[-R * 0.26, R * 1.08, R * 0.7]} scale={[1.8, 0.16, 0.08]} castShadow />
      <mesh geometry={eyelidGeo} material={material} position={[R * 0.26, R * 1.08, R * 0.7]} scale={[1.8, 0.16, 0.08]} castShadow />
      {/* 颧骨（贴面） */}
      <mesh geometry={cheekGeo} material={material} position={[-R * 0.4, R * 0.82, R * 0.42]} scale={[0.8, 0.6, 0.5]} castShadow />
      <mesh geometry={cheekGeo} material={material} position={[R * 0.4, R * 0.82, R * 0.42]} scale={[0.8, 0.6, 0.5]} castShadow />
      {/* 鼻梁 → 鼻尖 */}
      <mesh geometry={noseGeo} material={material} position={[0, R * 0.88, R * 0.68]} scale={[0.42, 1.1, 0.55]} rotation={[d(8), 0, 0]} castShadow />
      {/* 唇与下颌：细小的阴影缝 + 下巴体块，正面更像参考图的素体头雕。 */}
      <mesh geometry={lipGeo} material={detail} position={[0, R * 0.55, R * 0.67]} scale={[1.0, 0.16, 0.12]} castShadow />
      <mesh geometry={jawGeo} material={material} position={[0, R * 0.3, R * 0.34]} scale={[1.18, 0.44, 0.46]} castShadow />
      {/* 耳 */}
      <mesh geometry={earGeo} material={material} position={[-R * 0.72, R * 1.02, -R * 0.02]} scale={[0.28, 0.95, 0.6]} castShadow />
      <mesh geometry={earGeo} material={material} position={[R * 0.72, R * 1.02, -R * 0.02]} scale={[0.28, 0.95, 0.6]} castShadow />
      {/* 颈部两条浅浮雕肌线。 */}
      <mesh geometry={neckLineGeo} material={detail} position={[-R * 0.2, R * 0.05, R * 0.28]} rotation={[d(-10), 0, d(-10)]} castShadow />
      <mesh geometry={neckLineGeo} material={detail} position={[R * 0.2, R * 0.05, R * 0.28]} rotation={[d(-10), 0, d(10)]} castShadow />
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
  const matJoint = useMemo(() => jointMaterial(color), [color])

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

  const tr = torsoRadius
  const ankleHeight = hipHeight - upperLegLen - lowerLegLen

  // ── 躯干三段 loft（缓存 key 编码尺寸） ──
  // 胸甲：锁骨线略窄 → 胸大肌线最宽最厚（前凸）→ 肋弓收窄，V 型倒三角。
  const chestGeo = loftGeometry(`chest:${q(tr)}:${q(chestLen)}`, {
    length: chestLen * 1.08,
    rx: [[0, tr * 0.88], [0.18, tr * 1.2], [0.42, tr * 1.22], [0.78, tr * 0.92], [1, tr * 0.82]],
    rz: [[0, tr * 0.54], [0.32, tr * 0.72], [0.6, tr * 0.66], [1, tr * 0.52]],
    zc: [[0, tr * 0.02], [0.32, tr * 0.12], [0.6, tr * 0.08], [1, tr * 0.0]],
    rings: 22,
    seg: 24,
  })
  // 腰腹柔性段：束腰曲线，腹部微前凸。
  const waistGeo = loftGeometry(`waist:${q(tr)}:${q(spineLen)}`, {
    length: spineLen * 1.18,
    rx: [[0, tr * 0.84], [0.5, tr * 0.74], [1, tr * 0.86]],
    rz: [[0, tr * 0.56], [0.5, tr * 0.5], [1, tr * 0.58]],
    zc: [[0, tr * 0.04], [0.5, tr * 0.08], [1, tr * 0.02]],
    rings: 14,
    seg: 22,
  })
  // 骨盆壳：髂骨外扩 → 臀部后凸 → 裆部收角（短裤分型）。宽度盖过大腿根，裆部压低。
  const pelvisGeo = loftGeometry(`pelvis:${q(tr)}:${q(spineLen)}`, {
    length: spineLen * 1.2,
    rx: [[0, tr * 0.88], [0.3, tr * 1.1], [0.6, tr * 1.12], [0.85, tr * 0.8], [1, tr * 0.4]],
    rz: [[0, tr * 0.6], [0.4, tr * 0.72], [0.75, tr * 0.64], [1, tr * 0.38]],
    zc: [[0, tr * 0.03], [0.55, -tr * 0.06], [1, tr * 0.0]],
    rings: 18,
    seg: 24,
  })

  const pecGeo = sphereGeometry(tr * 0.5, 14, 10)
  const trapGeo = sphereGeometry(tr * 0.36, 12, 8)
  const hipSocketGeo = sphereGeometry(jointRadius * 0.95, 14, 10)
  const neckGeo = cylGeometry(jointRadius * 0.68, jointRadius * 0.92, neckLen * 1.4, 12)
  const shoulderBallGeo = sphereGeometry(jointRadius * 0.95, 14, 10)
  const deltoidGeo = sphereGeometry(limbRadius * 1.5, 16, 12)
  const wristBallGeo = sphereGeometry(jointRadius * 0.55, 12, 8)
  const hipBallGeo = sphereGeometry(jointRadius * 0.92, 14, 10)
  const kneeCapGeo = sphereGeometry(limbRadius * 0.78, 12, 10)
  const collarRingGeo = torusGeometry(tr * 0.62, tr * 0.035, 8, 30)
  const chestRimGeo = torusGeometry(tr * 0.92, tr * 0.026, 8, 30)
  const abdomenPlateGeo = loftGeometry(`abdomenPlate:${q(tr)}:${q(spineLen)}`, {
    length: spineLen * 0.72,
    rx: [[0, tr * 0.5], [0.48, tr * 0.44], [1, tr * 0.31]],
    rz: [[0, tr * 0.09], [1, tr * 0.06]],
    zc: [[0, tr * 0.45], [1, tr * 0.39]],
    rings: 10,
    seg: 18,
  })
  const pelvisFrontGeo = loftGeometry(`pelvisFront:${q(tr)}:${q(spineLen)}`, {
    length: spineLen * 0.62,
    rx: [[0, tr * 0.38], [0.5, tr * 0.34], [1, tr * 0.18]],
    rz: [[0, tr * 0.08], [1, tr * 0.05]],
    zc: [[0, tr * 0.44], [1, tr * 0.38]],
    rings: 10,
    seg: 16,
  })
  const pelvisCrestGeo = sphereGeometry(tr * 0.36, 12, 8)
  const shoulderSeamGeo = torusGeometry(limbRadius * 1.12, limbRadius * 0.085, 8, 22)
  const forearmCuffGeo = torusGeometry(limbRadius * 0.72, limbRadius * 0.07, 8, 22)
  const thighSocketRimGeo = torusGeometry(limbRadius * 1.15, limbRadius * 0.08, 8, 24)
  const kneeRimGeo = torusGeometry(limbRadius * 0.82, limbRadius * 0.07, 8, 22)

  return (
    <group scale={[h, h, h]}>
      {/* hips 根关节 */}
      <group ref={jr('hips')} position={[0, hipHeight, 0]} rotation={j('hips')}>
        {/* 骨盆壳 */}
        <group position={[0, -0.02, 0]}>
          <mesh geometry={pelvisGeo} material={mat} position={[0, spineLen * 0.34, 0]} castShadow />
          <mesh geometry={pelvisFrontGeo} material={mat} position={[0, spineLen * 0.1, 0]} castShadow />
          <mesh geometry={pelvisCrestGeo} material={mat} position={[-hipWidth * 0.74, spineLen * 0.06, tr * 0.18]} scale={[0.9, 0.42, 0.38]} rotation={[0, 0, d(-10)]} castShadow />
          <mesh geometry={pelvisCrestGeo} material={mat} position={[hipWidth * 0.74, spineLen * 0.06, tr * 0.18]} scale={[0.9, 0.42, 0.38]} rotation={[0, 0, d(10)]} castShadow />
          {/* 髋关节窝（深调窄环，大部分藏进骨盆壳内） */}
          <mesh geometry={hipSocketGeo} material={matJoint} position={[-hipWidth, 0.005, 0]} scale={[0.85, 0.9, 0.9]} castShadow />
          <mesh geometry={hipSocketGeo} material={matJoint} position={[hipWidth, 0.005, 0]} scale={[0.85, 0.9, 0.9]} castShadow />
        </group>

        {/* 脊柱 → 胸 → 颈 → 头（spine 起点保持在 hips 原点，头顶高度公式不变） */}
        <group ref={jr('spine')} position={[0, 0, 0]} rotation={j('spine')}>
          {/* 腰腹柔性段 */}
          <mesh geometry={waistGeo} material={mat} position={[0, spineLen * 1.06, 0]} castShadow />
          <mesh geometry={abdomenPlateGeo} material={mat} position={[0, spineLen * 0.86, 0]} castShadow />
          <mesh geometry={chestRimGeo} material={matJoint} position={[0, spineLen * 0.96, tr * 0.02]} rotation={[Math.PI / 2, 0, 0]} scale={[0.86, 0.58, 1]} castShadow />
          <group ref={jr('chest')} position={[0, spineLen, 0]} rotation={j('chest')}>
            {/* 胸甲（loft 顶对齐锁骨线） */}
            <mesh geometry={chestGeo} material={mat} position={[0, chestLen * 1.02, 0]} castShadow />
            <mesh geometry={collarRingGeo} material={matJoint} position={[0, chestLen * 0.98, tr * 0.02]} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 0.72, 1]} castShadow />
            <mesh geometry={chestRimGeo} material={matJoint} position={[0, chestLen * 0.18, tr * 0.04]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.58, 1]} castShadow />
            {/* 胸大肌隆起（宽扁贴面，与胸甲曲面融为一体） */}
            <mesh geometry={pecGeo} material={mat} position={[-tr * 0.4, chestLen * 0.66, tr * 0.38]} scale={[1.12, 0.44, 0.22]} castShadow />
            <mesh geometry={pecGeo} material={mat} position={[tr * 0.4, chestLen * 0.66, tr * 0.38]} scale={[1.12, 0.44, 0.22]} castShadow />
            {/* 斜方肌（颈根到肩的坡） */}
            <mesh geometry={trapGeo} material={mat} position={[-shoulderWidth * 0.5, chestLen * 0.98, -tr * 0.08]} scale={[1.7, 0.5, 0.8]} castShadow />
            <mesh geometry={trapGeo} material={mat} position={[shoulderWidth * 0.5, chestLen * 0.98, -tr * 0.08]} scale={[1.7, 0.5, 0.8]} castShadow />

            {/* 颈 + 头 */}
            <group ref={jr('neck')} position={[0, chestLen, 0]} rotation={j('neck')}>
              <mesh geometry={neckGeo} material={mat} position={[0, neckLen * 0.45, 0]} rotation={[d(-4), 0, 0]} castShadow />
              <group ref={jr('head')} position={[0, neckLen, 0]} rotation={j('head')}>
                <HeadSculpt R={headRadius} material={matHead} detail={matJoint} />
              </group>
            </group>

            {/* 左臂 */}
            <group ref={jr('shoulderL')} position={[-shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderL')}>
              {/* 肩球（深调）嵌进胸甲侧面 */}
              <mesh geometry={shoulderBallGeo} material={matJoint} castShadow />
              <group ref={jr('upperArmL')} rotation={j('upperArmL')}>
                {/* 三角肌甲片：随大臂动，覆住肩球（素体手办肩甲） */}
                <mesh geometry={deltoidGeo} material={mat} position={[0, -limbRadius * 0.3, 0]} scale={[1, 1.14, 1]} castShadow />
                <mesh geometry={shoulderSeamGeo} material={matJoint} position={[0, -limbRadius * 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.85, 1]} castShadow />
                <Limb profile="upperArm" length={upperArmLen} radius={limbRadius} material={mat} />
                <group ref={jr('lowerArmL')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmL')}>
                  {/* 肘：双碟铰链 */}
                  <HingeJoint radius={limbRadius * 0.62} width={limbRadius * 1.5} material={matJoint} />
                  <mesh geometry={forearmCuffGeo} material={matJoint} position={[0, -limbRadius * 1.0, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.8, 1]} castShadow />
                  <Limb profile="lowerArm" length={lowerArmLen} radius={limbRadius * 0.9} material={mat} />
                  <group ref={jr('handL')} position={[0, -lowerArmLen, 0]} rotation={j('handL')}>
                    {/* 腕球（深调小球） */}
                    <mesh geometry={wristBallGeo} material={matJoint} castShadow />
                    <group ref={jr('fingersL')} />
                    <group ref={jr('thumbL')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      material={mat}
                      joint={matJoint}
                      side="L"
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
                <mesh geometry={deltoidGeo} material={mat} position={[0, -limbRadius * 0.3, 0]} scale={[1, 1.14, 1]} castShadow />
                <mesh geometry={shoulderSeamGeo} material={matJoint} position={[0, -limbRadius * 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.85, 1]} castShadow />
                <Limb profile="upperArm" length={upperArmLen} radius={limbRadius} material={mat} />
                <group ref={jr('lowerArmR')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmR')}>
                  <HingeJoint radius={limbRadius * 0.62} width={limbRadius * 1.5} material={matJoint} />
                  <mesh geometry={forearmCuffGeo} material={matJoint} position={[0, -limbRadius * 1.0, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.8, 1]} castShadow />
                  <Limb profile="lowerArm" length={lowerArmLen} radius={limbRadius * 0.9} material={mat} />
                  <group ref={jr('handR')} position={[0, -lowerArmLen, 0]} rotation={j('handR')}>
                    <mesh geometry={wristBallGeo} material={matJoint} castShadow />
                    <group ref={jr('fingersR')} />
                    <group ref={jr('thumbR')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      material={mat}
                      joint={matJoint}
                      side="R"
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
          {/* 髋球（深调） */}
          <mesh geometry={hipBallGeo} material={matJoint} castShadow />
          <mesh geometry={thighSocketRimGeo} material={matJoint} position={[0, -limbRadius * 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.08, 0.86, 1]} castShadow />
          <Limb profile="upperLeg" length={upperLegLen} radius={limbRadius * 1.35} material={mat} />
          <group ref={jr('lowerLegL')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegL')}>
            {/* 膝：双碟铰链 + 膝盖骨甲片 */}
            <HingeJoint radius={limbRadius * 0.7} width={limbRadius * 1.6} material={matJoint} />
            <mesh geometry={kneeCapGeo} material={mat} position={[0, limbRadius * 0.05, limbRadius * 0.8]} scale={[0.95, 1.15, 0.6]} castShadow />
            <mesh geometry={kneeRimGeo} material={matJoint} position={[0, -limbRadius * 0.78, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.84, 1]} castShadow />
            <Limb profile="lowerLeg" length={lowerLegLen} radius={limbRadius * 1.02} material={mat} />
            <group ref={jr('footL')} position={[0, -lowerLegLen, 0]} rotation={j('footL')}>
              <Foot radius={limbRadius} footLen={footLen} ankleHeight={ankleHeight} material={mat} joint={matJoint} />
            </group>
          </group>
        </group>

        {/* 右腿 */}
        <group ref={jr('upperLegR')} position={[hipWidth, -0.02, 0]} rotation={j('upperLegR')}>
          <mesh geometry={hipBallGeo} material={matJoint} castShadow />
          <mesh geometry={thighSocketRimGeo} material={matJoint} position={[0, -limbRadius * 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.08, 0.86, 1]} castShadow />
          <Limb profile="upperLeg" length={upperLegLen} radius={limbRadius * 1.35} material={mat} />
          <group ref={jr('lowerLegR')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegR')}>
            <HingeJoint radius={limbRadius * 0.7} width={limbRadius * 1.6} material={matJoint} />
            <mesh geometry={kneeCapGeo} material={mat} position={[0, limbRadius * 0.05, limbRadius * 0.8]} scale={[0.95, 1.15, 0.6]} castShadow />
            <mesh geometry={kneeRimGeo} material={matJoint} position={[0, -limbRadius * 0.78, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.84, 1]} castShadow />
            <Limb profile="lowerLeg" length={lowerLegLen} radius={limbRadius * 1.02} material={mat} />
            <group ref={jr('footR')} position={[0, -lowerLegLen, 0]} rotation={j('footR')}>
              <Foot radius={limbRadius} footLen={footLen} ankleHeight={ankleHeight} material={mat} joint={matJoint} />
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
