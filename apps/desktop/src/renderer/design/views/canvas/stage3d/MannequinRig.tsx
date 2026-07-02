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

/** 一段肢体：从关节原点沿 -Y 方向延伸 length，capsule 表现。 */
function Limb({
  length,
  radius,
  color,
}: {
  length: number
  radius: number
  color: string
}) {
  const capsuleLen = Math.max(0.01, length - radius * 2)
  return (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, capsuleLen, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.05} />
    </mesh>
  )
}

function Joint({ radius }: { radius: number }) {
  return (
    <mesh castShadow>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial color={JOINT_COLOR} roughness={0.55} metalness={0.1} />
    </mesh>
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
        <Joint radius={jointRadius * 1.2} />
        {/* 骨盆 */}
        <mesh position={[0, -0.02, 0]}>
          <sphereGeometry args={[torsoRadius * 0.9, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>

        {/* 脊柱 → 胸 → 颈 → 头 */}
        <group position={[0, 0, 0]} rotation={j('spine')}>
          <mesh position={[0, spineLen / 2, 0]}>
            <capsuleGeometry args={[torsoRadius * 0.72, spineLen, 6, 12]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <group position={[0, spineLen, 0]} rotation={j('chest')}>
            <mesh position={[0, chestLen / 2, 0]}>
              <capsuleGeometry args={[torsoRadius, chestLen, 6, 12]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>

            {/* 颈 + 头 */}
            <group position={[0, chestLen, 0]} rotation={j('neck')}>
              <mesh position={[0, neckLen / 2, 0]}>
                <capsuleGeometry args={[jointRadius * 0.9, neckLen, 4, 8]} />
                <meshStandardMaterial color={color} roughness={0.7} />
              </mesh>
              <group position={[0, neckLen, 0]} rotation={j('head')}>
                <mesh position={[0, headRadius, 0]} castShadow>
                  <sphereGeometry args={[headRadius, 20, 20]} />
                  <meshStandardMaterial color={color} roughness={0.65} />
                </mesh>
              </group>
            </group>

            {/* 左臂 */}
            <group position={[-shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderL')}>
              <Joint radius={jointRadius} />
              <group rotation={j('upperArmL')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group position={[0, -upperArmLen, 0]} rotation={j('lowerArmL')}>
                  <Joint radius={jointRadius * 0.85} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.9} color={color} />
                  <group position={[0, -lowerArmLen, 0]} rotation={j('handL')}>
                    <Limb length={handLen} radius={limbRadius * 0.85} color={color} />
                  </group>
                </group>
              </group>
            </group>

            {/* 右臂 */}
            <group position={[shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderR')}>
              <Joint radius={jointRadius} />
              <group rotation={j('upperArmR')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group position={[0, -upperArmLen, 0]} rotation={j('lowerArmR')}>
                  <Joint radius={jointRadius * 0.85} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.9} color={color} />
                  <group position={[0, -lowerArmLen, 0]} rotation={j('handR')}>
                    <Limb length={handLen} radius={limbRadius * 0.85} color={color} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* 左腿 */}
        <group position={[-hipWidth, -0.02, 0]} rotation={j('upperLegL')}>
          <Joint radius={jointRadius} />
          <Limb length={upperLegLen} radius={limbRadius * 1.15} color={color} />
          <group position={[0, -upperLegLen, 0]} rotation={j('lowerLegL')}>
            <Joint radius={jointRadius * 0.9} />
            <Limb length={lowerLegLen} radius={limbRadius} color={color} />
            <group position={[0, -lowerLegLen, 0]} rotation={j('footL')}>
              <mesh position={[0, -limbRadius, footLen * 0.3]} castShadow>
                <boxGeometry args={[limbRadius * 2.2, limbRadius * 1.4, footLen]} />
                <meshStandardMaterial color={color} roughness={0.7} />
              </mesh>
            </group>
          </group>
        </group>

        {/* 右腿 */}
        <group position={[hipWidth, -0.02, 0]} rotation={j('upperLegR')}>
          <Joint radius={jointRadius} />
          <Limb length={upperLegLen} radius={limbRadius * 1.15} color={color} />
          <group position={[0, -upperLegLen, 0]} rotation={j('lowerLegR')}>
            <Joint radius={jointRadius * 0.9} />
            <Limb length={lowerLegLen} radius={limbRadius} color={color} />
            <group position={[0, -lowerLegLen, 0]} rotation={j('footR')}>
              <mesh position={[0, -limbRadius, footLen * 0.3]} castShadow>
                <boxGeometry args={[limbRadius * 2.2, limbRadius * 1.4, footLen]} />
                <meshStandardMaterial color={color} roughness={0.7} />
              </mesh>
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
