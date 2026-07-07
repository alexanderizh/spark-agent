import { useCallback, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Stage3DActor } from './stage3d.types'
import { BODY_METRICS, getPose, type BodyMetrics, type JointId, type Vec3 } from './mannequin'

const d = (deg: number): number => (deg * Math.PI) / 180

/** 关节 ref 上报回调：group 挂载时上报，卸载时传 null（供 PoseGizmo 取世界变换）。 */
export type JointRefCallback = (jointId: JointId, group: THREE.Group | null) => void

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

/** 一节指节：从当前原点沿 -Y 延伸 length 的扁盒，绕关节顶端弯曲。 */
function Phalanx({
  length,
  width,
  thickness,
  color,
  curl,
  children,
}: {
  length: number
  width: number
  thickness: number
  color: string
  /** 本节弯曲角（绕 X 轴，正值向掌心内屈） */
  curl: number
  children?: ReactNode
}) {
  return (
    <group rotation={[curl, 0, 0]}>
      <mesh position={[0, -length / 2, 0]} castShadow>
        <boxGeometry args={[width, length, thickness]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>
      {/* 子节挂到本节末端 */}
      <group position={[0, -length, 0]}>{children}</group>
    </group>
  )
}

/**
 * 手掌 + 拇指（两节）+ 四指（三段）联动几何。
 * 掌沿腕关节 -Y 延伸；四指从掌端继续下垂三段联动；拇指从掌桡侧根部斜出两节。
 * curl 按 40%/35%/25% 分配到三段（四指）/两节（拇指）指节；spread 控制张开。
 * 尺寸从 handLen / limbRadius 派生，不新增体型字段。
 */
function Hand({
  length,
  radius,
  color,
  thumb,
  fingers,
}: {
  length: number
  radius: number
  color: string
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

  // 拇指两段联动：curl 按 40/35（余 25 并入指端弯曲近似），从掌桡侧根部斜出
  const tCurl = thumb[0]
  const tSpread = thumb[1]
  const thumbLen = length * 0.4
  const tSeg = [thumbLen * 0.55, thumbLen * 0.45]
  const tCurlSeg = [tCurl * 0.55, tCurl * 0.45]
  const thumbW = palmThick * 0.9
  const thumbT = palmThick * 0.9

  return (
    <group>
      {/* 掌 */}
      <mesh position={[0, -palmLen / 2, 0]} castShadow>
        <boxGeometry args={[palmWidth, palmLen, palmThick]} />
        <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
      </mesh>

      {/* 四指：掌端下垂三段联动（整体绕掌端张开 fSpread 略外摆） */}
      <group position={[0, -palmLen, 0]} rotation={[0, 0, 0]}>
        <group rotation={[0, 0, fSpread * 0.5]}>
          <Phalanx length={seg[0]!} width={fingerW} thickness={fingerT} color={color} curl={fCurlSeg[0]!}>
            <Phalanx length={seg[1]!} width={fingerW * 0.9} thickness={fingerT * 0.9} color={color} curl={fCurlSeg[1]!}>
              <Phalanx length={seg[2]!} width={fingerW * 0.8} thickness={fingerT * 0.8} color={color} curl={fCurlSeg[2]!} />
            </Phalanx>
          </Phalanx>
        </group>
      </group>

      {/* 拇指：掌桡侧根部斜出两节（+X 为拇指侧，spread 控制张开角） */}
      <group position={[palmWidth * 0.5, -palmLen * 0.35, 0]} rotation={[0, 0, d(35) + tSpread]}>
        <Phalanx length={tSeg[0]!} width={thumbW} thickness={thumbT} color={color} curl={tCurlSeg[0]!}>
          <Phalanx length={tSeg[1]!} width={thumbW * 0.85} thickness={thumbT * 0.85} color={color} curl={tCurlSeg[1]!} />
        </Phalanx>
      </group>
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

  return (
    <group scale={[h, h, h]}>
      {/* hips 根关节 */}
      <group ref={jr('hips')} position={[0, hipHeight, 0]} rotation={j('hips')}>
        {/* 骨盆体块：上宽下窄的锥台 + 略扁（Z 向压薄），做出体块而非单一球。
            仍以 hips 原点为中心，不改变 spine 起点，保持 mannequinTopHeight 语义。 */}
        <mesh position={[0, -0.02, 0]} scale={[1, 1, 0.72]} castShadow>
          <cylinderGeometry args={[torsoRadius * 0.78, torsoRadius * 0.62, spineLen * 0.9, 16, 1]} />
          <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
        </mesh>

        {/* 脊柱 → 胸 → 颈 → 头（spine 起点保持在 hips 原点，头顶高度公式不变） */}
        <group ref={jr('spine')} position={[0, 0, 0]} rotation={j('spine')}>
          {/* 腰段：细一点的锥台，连接骨盆与胸腔 */}
          <mesh position={[0, spineLen / 2, 0]} scale={[1, 1, 0.78]} castShadow>
            <cylinderGeometry args={[torsoRadius * 0.86, torsoRadius * 0.7, spineLen, 16, 1]} />
            <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
          </mesh>
          <group ref={jr('chest')} position={[0, spineLen, 0]} rotation={j('chest')}>
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
            <group ref={jr('neck')} position={[0, chestLen, 0]} rotation={j('neck')}>
              <mesh position={[0, neckLen / 2, 0]} castShadow>
                <cylinderGeometry args={[jointRadius * 0.82, jointRadius * 0.95, neckLen, 12, 1]} />
                <meshStandardMaterial color={color} roughness={0.68} metalness={0.06} />
              </mesh>
              <group ref={jr('head')} position={[0, neckLen, 0]} rotation={j('head')}>
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
            <group ref={jr('shoulderL')} position={[-shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderL')}>
              <Joint radius={jointRadius * 0.85} />
              <group ref={jr('upperArmL')} rotation={j('upperArmL')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group ref={jr('lowerArmL')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmL')}>
                  <Joint radius={jointRadius * 0.7} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.86} color={color} />
                  <group ref={jr('handL')} position={[0, -lowerArmLen, 0]} rotation={j('handL')}>
                    <group ref={jr('fingersL')} />
                    <group ref={jr('thumbL')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      color={color}
                      thumb={j('thumbL')}
                      fingers={j('fingersL')}
                    />
                  </group>
                </group>
              </group>
            </group>

            {/* 右臂 */}
            <group ref={jr('shoulderR')} position={[shoulderWidth, chestLen * 0.82, 0]} rotation={j('shoulderR')}>
              <Joint radius={jointRadius * 0.85} />
              <group ref={jr('upperArmR')} rotation={j('upperArmR')}>
                <Limb length={upperArmLen} radius={limbRadius} color={color} />
                <group ref={jr('lowerArmR')} position={[0, -upperArmLen, 0]} rotation={j('lowerArmR')}>
                  <Joint radius={jointRadius * 0.7} />
                  <Limb length={lowerArmLen} radius={limbRadius * 0.86} color={color} />
                  <group ref={jr('handR')} position={[0, -lowerArmLen, 0]} rotation={j('handR')}>
                    <group ref={jr('fingersR')} />
                    <group ref={jr('thumbR')} />
                    <Hand
                      length={handLen}
                      radius={limbRadius * 0.85}
                      color={color}
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
          <Joint radius={jointRadius * 0.9} />
          <Limb length={upperLegLen} radius={limbRadius * 1.35} color={color} bottomScale={0.72} />
          <group ref={jr('lowerLegL')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegL')}>
            <Joint radius={jointRadius * 0.75} />
            <Limb length={lowerLegLen} radius={limbRadius * 1.02} color={color} bottomScale={0.62} />
            <group ref={jr('footL')} position={[0, -lowerLegLen, 0]} rotation={j('footL')}>
              <Foot radius={limbRadius} footLen={footLen} color={color} />
            </group>
          </group>
        </group>

        {/* 右腿 */}
        <group ref={jr('upperLegR')} position={[hipWidth, -0.02, 0]} rotation={j('upperLegR')}>
          <Joint radius={jointRadius * 0.9} />
          <Limb length={upperLegLen} radius={limbRadius * 1.35} color={color} bottomScale={0.72} />
          <group ref={jr('lowerLegR')} position={[0, -upperLegLen, 0]} rotation={j('lowerLegR')}>
            <Joint radius={jointRadius * 0.75} />
            <Limb length={lowerLegLen} radius={limbRadius * 1.02} color={color} bottomScale={0.62} />
            <group ref={jr('footR')} position={[0, -lowerLegLen, 0]} rotation={j('footR')}>
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
