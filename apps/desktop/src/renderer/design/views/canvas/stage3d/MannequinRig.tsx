import { useMemo } from 'react'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import { BODY_METRICS, getPose, type BodyMetrics, type JointId, type Vec3 } from './mannequin'

/**
 * 程序化关节人偶（素体人偶风格）。
 *
 * 用嵌套 <group> 表达关节层级，每个关节应用「姿势预设角度 + 逐关节覆盖」。
 * 肢段用 capsule（长条）表现，关节用深色 sphere 区隔；单色 MeshStandardMaterial。
 */

const JOINT_COLOR = '#1f2937'

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

/**
 * 一段肢体：从关节原点沿 -Y 方向延伸 length，带锥度（上粗下细）。
 * 用 CylinderGeometry 顶/底不同半径做锥形，两端各盖一个半球收口，接近素体人偶的干净感。
 * radiusTop/radiusBottom 相对 radius 的比例，默认 1.15 / 0.85（上粗下细）。
 */
function Limb({
  length,
  radius,
  color,
  topScale = 1.15,
  bottomScale = 0.82,
}: {
  length: number
  radius: number
  color: string
  topScale?: number
  bottomScale?: number
}) {
  const rTop = radius * topScale
  const rBottom = radius * bottomScale
  const shaftLen = Math.max(0.01, length)
  return (
    <group position={[0, -length / 2, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[rTop, rBottom, shaftLen, 14, 1]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
      {/* 顶端收口半球 */}
      <mesh position={[0, shaftLen / 2, 0]} castShadow>
        <sphereGeometry args={[rTop, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
      {/* 底端收口半球 */}
      <mesh position={[0, -shaftLen / 2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <sphereGeometry args={[rBottom, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
    </group>
  )
}

/** 关节球：缩小弱化，深色区隔肢段。 */
function Joint({ radius }: { radius: number }) {
  return (
    <mesh castShadow>
      <sphereGeometry args={[radius, 14, 14]} />
      <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} metalness={0.15} />
    </mesh>
  )
}

/** 手掌：从腕关节沿 -Y 延伸的小扁盒（掌）+ 微收的指端，简化几何。 */
function Hand({ length, radius, color }: { length: number; radius: number; color: string }) {
  return (
    <group position={[0, -length / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[radius * 1.7, length, radius * 0.9]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
    </group>
  )
}

/** 脚掌：楔形（前端薄、脚跟略厚），沿 +Z 朝前。 */
function Foot({
  radius,
  footLen,
  color,
}: {
  radius: number
  footLen: number
  color: string
}) {
  return (
    <group position={[0, -radius, 0]}>
      {/* 脚掌主体：略扁的盒，前伸 */}
      <mesh position={[0, 0, footLen * 0.28]} castShadow>
        <boxGeometry args={[radius * 2, radius * 1.25, footLen]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
      {/* 脚跟收口 */}
      <mesh position={[0, 0, -footLen * 0.22]} castShadow>
        <boxGeometry args={[radius * 1.8, radius * 1.5, footLen * 0.3]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
    </group>
  )
}

/**
 * 人偶本体（不含名字标签 / 选择框，交由 Scene 层叠加）。
 * 以 hips 关节为原点，hips 关节位于地面之上 metrics.hipHeight。
 */
export function MannequinRig({ actor }: { actor: Stage3DActor }) {
  const metrics: BodyMetrics = BODY_METRICS[actor.bodyType] ?? BODY_METRICS.standard
  const pose = useMemo(() => getPose(actor.pose), [actor.pose])
  const overrides = actor.joints
  const color = actor.color
  const h = actor.heightScale

  const j = (id: JointId): Vec3 => eulerFor(id, pose, overrides)

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

  return (
    <group scale={[h, h, h]}>
      {/* hips 根关节 */}
      <group position={[0, hipHeight, 0]} rotation={j('hips')}>
        {/* 骨盆体块：上宽下窄的锥台 + 略扁（Z 向压薄），做出体块而非单一球。
            仍以 hips 原点为中心，不改变 spine 起点，保持 mannequinTopHeight 语义。 */}
        <mesh position={[0, -0.02, 0]} scale={[1, 1, 0.72]} castShadow>
          <cylinderGeometry args={[torsoRadius * 0.78, torsoRadius * 0.62, spineLen * 0.9, 16, 1]} />
          <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
        </mesh>

        {/* 脊柱 → 胸 → 颈 → 头（spine 起点保持在 hips 原点，头顶高度公式不变） */}
        <group position={[0, 0, 0]} rotation={j('spine')}>
          {/* 腰段：细一点的锥台，连接骨盆与胸腔 */}
          <mesh position={[0, spineLen / 2, 0]} scale={[1, 1, 0.78]} castShadow>
            <cylinderGeometry args={[torsoRadius * 0.86, torsoRadius * 0.7, spineLen, 16, 1]} />
            <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
          </mesh>
          <group position={[0, spineLen, 0]} rotation={j('chest')}>
            {/* 胸腔体块：上宽下窄、前后压扁的锥台，做出胸腔感 */}
            <mesh position={[0, chestLen / 2, 0]} scale={[1, 1, 0.66]} castShadow>
              <cylinderGeometry args={[torsoRadius * 1.06, torsoRadius * 0.82, chestLen, 18, 1]} />
              <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
            </mesh>
            {/* 肩线横梁：让两肩相连，避免手臂从胸腔孤立伸出 */}
            <mesh position={[0, chestLen * 0.86, 0]} scale={[1, 0.55, 0.6]} castShadow>
              <sphereGeometry args={[shoulderWidth * 1.02, 16, 12]} />
              <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
            </mesh>

            {/* 颈 + 头 */}
            <group position={[0, chestLen, 0]} rotation={j('neck')}>
              <mesh position={[0, neckLen / 2, 0]} castShadow>
                <cylinderGeometry args={[jointRadius * 0.82, jointRadius * 0.95, neckLen, 12, 1]} />
                <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
              </mesh>
              <group position={[0, neckLen, 0]} rotation={j('head')}>
                {/* 头：纵向拉长的椭球（颅顶饱满），下方叠一枚小锥台收出下巴 */}
                <mesh position={[0, headRadius, 0]} scale={[0.92, 1.12, 0.96]} castShadow>
                  <sphereGeometry args={[headRadius, 22, 20]} />
                  <meshStandardMaterial color={color} roughness={0.62} metalness={0.06} />
                </mesh>
                <mesh position={[0, headRadius * 0.5, headRadius * 0.12]} scale={[0.82, 1, 0.82]} castShadow>
                  <cylinderGeometry args={[headRadius * 0.86, headRadius * 0.5, headRadius * 0.7, 16, 1]} />
                  <meshStandardMaterial color={color} roughness={0.62} metalness={0.06} />
                </mesh>
              </group>
            </group>

            {/* 左臂 */}
            <group position={[-shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderL')}>
              <Joint radius={jointRadius * 0.85} />
              <group rotation={j('upperArmL')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group position={[0, -upperArmLen, 0]} rotation={j('lowerArmL')}>
                  <Joint radius={jointRadius * 0.7} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.86} color={color} />
                  <group position={[0, -lowerArmLen, 0]} rotation={j('handL')}>
                    <Hand length={handLen} radius={limbRadius * 0.85} color={color} />
                  </group>
                </group>
              </group>
            </group>

            {/* 右臂 */}
            <group position={[shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderR')}>
              <Joint radius={jointRadius * 0.85} />
              <group rotation={j('upperArmR')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group position={[0, -upperArmLen, 0]} rotation={j('lowerArmR')}>
                  <Joint radius={jointRadius * 0.7} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.86} color={color} />
                  <group position={[0, -lowerArmLen, 0]} rotation={j('handR')}>
                    <Hand length={handLen} radius={limbRadius * 0.85} color={color} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* 左腿 */}
        <group position={[-hipWidth, -0.02, 0]} rotation={j('upperLegL')}>
          <Joint radius={jointRadius * 0.9} />
          <Limb length={upperLegLen} radius={limbRadius * 1.35} color={color} bottomScale={0.72} />
          <group position={[0, -upperLegLen, 0]} rotation={j('lowerLegL')}>
            <Joint radius={jointRadius * 0.75} />
            <Limb length={lowerLegLen} radius={limbRadius * 1.02} color={color} bottomScale={0.62} />
            <group position={[0, -lowerLegLen, 0]} rotation={j('footL')}>
              <Foot radius={limbRadius} footLen={footLen} color={color} />
            </group>
          </group>
        </group>

        {/* 右腿 */}
        <group position={[hipWidth, -0.02, 0]} rotation={j('upperLegR')}>
          <Joint radius={jointRadius * 0.9} />
          <Limb length={upperLegLen} radius={limbRadius * 1.35} color={color} bottomScale={0.72} />
          <group position={[0, -upperLegLen, 0]} rotation={j('lowerLegR')}>
            <Joint radius={jointRadius * 0.75} />
            <Limb length={lowerLegLen} radius={limbRadius * 1.02} color={color} bottomScale={0.62} />
            <group position={[0, -lowerLegLen, 0]} rotation={j('footR')}>
              <Foot radius={limbRadius} footLen={footLen} color={color} />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
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

export { THREE }
