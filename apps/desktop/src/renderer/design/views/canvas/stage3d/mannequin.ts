import type { Stage3DBodyType } from './stage3d.types'

/**
 * 程序化关节人偶（素体人偶风格）参数表 + 姿势预设。
 *
 * 关节层级（~17 关节）：
 *   root(hips) → spine → chest → neck → head
 *   chest → L/R shoulder → upperArm → lowerArm → hand
 *   hips  → L/R upperLeg → lowerLeg → foot
 *
 * 体型 = 各段长度 / 半径参数表；姿势 = 关节欧拉角集合；
 * 材质单色 + 深色关节球区隔肢段。
 */

export type Vec3 = [number, number, number]

/** 骨架各段尺寸（单位：米，标准成年 ≈ 1.8m） */
export type BodyMetrics = {
  hipHeight: number // hips 关节离地高度
  spineLen: number
  chestLen: number
  neckLen: number
  headRadius: number
  shoulderWidth: number // 单侧肩关节离中线的横向偏移
  upperArmLen: number
  lowerArmLen: number
  handLen: number
  hipWidth: number // 单侧髋关节横向偏移
  upperLegLen: number
  lowerLegLen: number
  footLen: number
  /** 肢段半径（capsule/圆柱粗细） */
  limbRadius: number
  torsoRadius: number
  /** 关节球半径 */
  jointRadius: number
}

const STANDARD: BodyMetrics = {
  hipHeight: 0.95,
  spineLen: 0.18,
  chestLen: 0.26,
  neckLen: 0.08,
  headRadius: 0.13,
  shoulderWidth: 0.2,
  upperArmLen: 0.29,
  lowerArmLen: 0.25,
  handLen: 0.09,
  hipWidth: 0.1,
  upperLegLen: 0.45,
  lowerLegLen: 0.42,
  footLen: 0.16,
  limbRadius: 0.05,
  torsoRadius: 0.13,
  jointRadius: 0.055,
}

/** 体型参数表：以标准体型为基准做比例调整 */
export const BODY_METRICS: Record<Stage3DBodyType, BodyMetrics> = {
  standard: STANDARD,
  child: {
    ...STANDARD,
    hipHeight: 0.62,
    spineLen: 0.13,
    chestLen: 0.18,
    neckLen: 0.06,
    headRadius: 0.12,
    shoulderWidth: 0.14,
    upperArmLen: 0.2,
    lowerArmLen: 0.17,
    handLen: 0.07,
    hipWidth: 0.075,
    upperLegLen: 0.3,
    lowerLegLen: 0.28,
    footLen: 0.12,
    limbRadius: 0.042,
    torsoRadius: 0.11,
    jointRadius: 0.045,
  },
  slim: {
    ...STANDARD,
    hipHeight: 1.02,
    upperLegLen: 0.49,
    lowerLegLen: 0.46,
    upperArmLen: 0.31,
    lowerArmLen: 0.27,
    limbRadius: 0.04,
    torsoRadius: 0.105,
    jointRadius: 0.045,
    shoulderWidth: 0.19,
  },
  muscular: {
    ...STANDARD,
    shoulderWidth: 0.25,
    torsoRadius: 0.16,
    limbRadius: 0.065,
    upperArmLen: 0.3,
    hipWidth: 0.11,
    jointRadius: 0.06,
  },
  heavy: {
    ...STANDARD,
    hipHeight: 0.9,
    shoulderWidth: 0.23,
    torsoRadius: 0.2,
    limbRadius: 0.08,
    hipWidth: 0.13,
    jointRadius: 0.07,
    upperArmLen: 0.27,
    upperLegLen: 0.42,
  },
  tall: {
    ...STANDARD,
    hipHeight: 1.08,
    spineLen: 0.2,
    chestLen: 0.29,
    upperArmLen: 0.33,
    lowerArmLen: 0.28,
    upperLegLen: 0.52,
    lowerLegLen: 0.48,
    torsoRadius: 0.12,
    limbRadius: 0.047,
  },
}

/** 全部关节 id（供属性面板分组滑杆枚举）
 *  handL/R 语义为「手腕」；thumbL/R、fingersL/R 为手指弯曲量（[curl, spread, 0]），非常规单轴旋转。 */
export const JOINT_IDS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'lowerArmL',
  'handL',
  'thumbL',
  'fingersL',
  'shoulderR',
  'upperArmR',
  'lowerArmR',
  'handR',
  'thumbR',
  'fingersR',
  'upperLegL',
  'lowerLegL',
  'footL',
  'upperLegR',
  'lowerLegR',
  'footR',
] as const

export type JointId = (typeof JOINT_IDS)[number]

export const JOINT_LABEL: Record<JointId, string> = {
  hips: '髋部',
  spine: '腰',
  chest: '胸',
  neck: '颈',
  head: '头',
  shoulderL: '左肩',
  upperArmL: '左大臂',
  lowerArmL: '左小臂',
  handL: '左腕',
  thumbL: '左拇指',
  fingersL: '左四指',
  shoulderR: '右肩',
  upperArmR: '右大臂',
  lowerArmR: '右小臂',
  handR: '右腕',
  thumbR: '右拇指',
  fingersR: '右四指',
  upperLegL: '左大腿',
  lowerLegL: '左小腿',
  footL: '左脚',
  upperLegR: '右大腿',
  lowerLegR: '右小腿',
  footR: '右脚',
}

/** 属性面板分组 */
export const JOINT_GROUPS: { label: string; joints: JointId[] }[] = [
  { label: '躯干 / 头', joints: ['hips', 'spine', 'chest', 'neck', 'head'] },
  { label: '左臂', joints: ['shoulderL', 'upperArmL', 'lowerArmL', 'handL', 'thumbL', 'fingersL'] },
  { label: '右臂', joints: ['shoulderR', 'upperArmR', 'lowerArmR', 'handR', 'thumbR', 'fingersR'] },
  { label: '左腿', joints: ['upperLegL', 'lowerLegL', 'footL'] },
  { label: '右腿', joints: ['upperLegR', 'lowerLegR', 'footR'] },
]

/** 姿势预设：每个关节相对基准的欧拉角（弧度）。缺省关节视为 [0,0,0]。 */
export type Pose = Partial<Record<JointId, Vec3>>

const d = (deg: number) => (deg * Math.PI) / 180

// ─────────────────────────── 关节软限位 ───────────────────────────

/** 单轴限位区间 [min, max]（弧度）；null = 该轴锁定（不出环、不出滑杆、强制归 0）。 */
export type AxisLimit = [min: number, max: number] | null

const lim = (minDeg: number, maxDeg: number): AxisLimit => [d(minDeg), d(maxDeg)]

/**
 * 每关节 [X, Y, Z] 三轴的软限位（解剖学近似，度数写死转弧度）。
 * thumb/fingers 复用该表：[curl, spread, null]（curl→X 槽、spread→Y 槽存储）。
 * 限位是「软」的：环拖拽/IK/滑杆默认钳制，按住 Alt 时可突破（见 clampJointEuler 的 clamp 选项）。
 */
export const JOINT_LIMITS: Record<JointId, [AxisLimit, AxisLimit, AxisLimit]> = {
  // 根关节全自由（用于躺 / 翻滚等整体姿态）
  hips: [lim(-180, 180), lim(-180, 180), lim(-180, 180)],
  spine: [lim(-35, 35), lim(-40, 40), lim(-25, 25)],
  chest: [lim(-30, 30), lim(-35, 35), lim(-20, 20)],
  neck: [lim(-25, 25), lim(-40, 40), lim(-15, 15)],
  head: [lim(-35, 25), lim(-50, 50), lim(-20, 20)],
  // 锁骨耸肩：Y 锁定，Z 左右镜像
  shoulderL: [lim(-15, 15), null, lim(-20, 20)],
  upperArmL: [lim(-170, 40), lim(-90, 90), lim(-20, 170)],
  lowerArmL: [lim(-145, 0), lim(-80, 80), null],
  handL: [lim(-70, 70), null, lim(-25, 25)],
  thumbL: [lim(0, 92), lim(-17, 52), null],
  fingersL: [lim(0, 137), lim(0, 20), null],
  shoulderR: [lim(-15, 15), null, lim(-20, 20)],
  upperArmR: [lim(-170, 40), lim(-90, 90), lim(-170, 20)],
  lowerArmR: [lim(-145, 0), lim(-80, 80), null],
  handR: [lim(-70, 70), null, lim(-25, 25)],
  thumbR: [lim(0, 92), lim(-17, 52), null],
  fingersR: [lim(0, 137), lim(0, 20), null],
  upperLegL: [lim(-120, 30), lim(-45, 45), lim(-10, 80)],
  lowerLegL: [lim(0, 150), null, null],
  footL: [lim(-45, 70), lim(-20, 20), lim(-20, 20)],
  upperLegR: [lim(-120, 30), lim(-45, 45), lim(-80, 10)],
  lowerLegR: [lim(0, 150), null, null],
  footR: [lim(-45, 70), lim(-20, 20), lim(-20, 20)],
}

/**
 * 把关节欧拉角钳到软限位。锁定轴（limit=null）恒归 0。
 * @param opts.clamp === false 时非锁定轴直通（Alt 突破），但锁定轴仍归 0。
 */
export function clampJointEuler(
  jointId: JointId,
  euler: Vec3,
  opts?: { clamp?: boolean },
): Vec3 {
  const limits = JOINT_LIMITS[jointId]
  const doClamp = opts?.clamp !== false
  const out: Vec3 = [euler[0], euler[1], euler[2]]
  for (let i = 0; i < 3; i++) {
    const axis = limits[i] ?? null
    if (axis === null) {
      out[i] = 0
      continue
    }
    if (doClamp) {
      const [min, max] = axis
      out[i] = Math.min(max, Math.max(min, out[i]!))
    }
  }
  return out
}

// ─────────────────────────── 姿势合成 / 镜像 ───────────────────────────

/** L/R 关节 id 互换（中线关节返回自身）。 */
function swapSideId(jointId: string): string {
  if (jointId.endsWith('L')) return `${jointId.slice(0, -1)}R`
  if (jointId.endsWith('R')) return `${jointId.slice(0, -1)}L`
  return jointId
}

/** curl 类关节（thumb/fingers）：镜像时互换但 Vec3 不做 y/z 取反。 */
function isCurlJoint(jointId: string): boolean {
  return jointId.startsWith('thumb') || jointId.startsWith('fingers')
}

/**
 * 合成完整姿势 = 预设（getPose）+ 逐关节覆盖，返回所有出现过的关节的最终欧拉角。
 * 缺省关节不写入（视为 [0,0,0]）。
 */
export function composePose(
  poseId: string,
  overrides?: Record<string, Vec3> | undefined,
): Record<string, Vec3> {
  const base = getPose(poseId)
  const out: Record<string, Vec3> = {}
  for (const [jointId, euler] of Object.entries(base)) {
    if (euler) out[jointId] = [euler[0], euler[1], euler[2]]
  }
  if (overrides) {
    for (const [jointId, ov] of Object.entries(overrides)) {
      const b = out[jointId] ?? [0, 0, 0]
      out[jointId] = [b[0] + ov[0], b[1] + ov[1], b[2] + ov[2]]
    }
  }
  return out
}

/**
 * 左右镜像一份「合成后的完整姿势」。
 * 规则：L/R 关节互换；普通关节 Vec3 做 [x, -y, -z]；中线关节仅 [x, -y, -z] 不互换；
 * curl 类（thumb/fingers）互换但不翻转（curl/spread 是标量弯曲量）。
 */
export function mirrorPose(joints: Record<string, Vec3>): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [jointId, euler] of Object.entries(joints)) {
    const target = swapSideId(jointId)
    if (isCurlJoint(jointId)) {
      out[target] = [euler[0], euler[1], euler[2]]
    } else {
      out[target] = [euler[0], -euler[1], -euler[2]]
    }
  }
  return out
}

/**
 * 把一侧（from）的臂+腿+手指姿势拷到另一侧（镜像）。
 * 中线关节保持不变；只处理带 L/R 后缀的关节。
 */
export function copySidePose(
  joints: Record<string, Vec3>,
  from: 'L' | 'R',
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [jointId, euler] of Object.entries(joints)) {
    out[jointId] = [euler[0], euler[1], euler[2]]
  }
  for (const [jointId, euler] of Object.entries(joints)) {
    if (!jointId.endsWith(from)) continue
    const target = swapSideId(jointId)
    if (isCurlJoint(jointId)) {
      out[target] = [euler[0], euler[1], euler[2]]
    } else {
      out[target] = [euler[0], -euler[1], -euler[2]]
    }
  }
  return out
}

export type PoseGroup = '基础' | '武打'

export const POSE_PRESETS: { id: string; label: string; group: PoseGroup; pose: Pose }[] = [
  {
    id: 'stand',
    label: '站立',
    group: '基础',
    // 方向约定（three.js FK 实测）：肢体沿 -Y 伸，绕 Z 正旋把末端推向 +X；
    // 左臂在 -X 侧 → 外展（远离大腿）为负 Z，右臂为正 Z。
    // 旧值 ±6° 符号相反（实为内收），粗肢体下手掌与大腿穿模，故改为 ∓12° 外展；
    // 小臂微前屈 + 腕微外偏 + 手指自然微曲，呈素体手办自然下垂微张形态。
    pose: {
      upperArmL: [0, 0, d(-12)],
      upperArmR: [0, 0, d(12)],
      lowerArmL: [d(-8), 0, 0],
      lowerArmR: [d(-8), 0, 0],
      handL: [0, 0, d(-4)],
      handR: [0, 0, d(4)],
      thumbL: [d(10), d(12), 0],
      thumbR: [d(10), d(12), 0],
      fingersL: [d(15), 0, 0],
      fingersR: [d(15), 0, 0],
    },
  },
  {
    id: 'walk',
    label: '行走',
    group: '基础',
    pose: {
      upperLegL: [d(22), 0, 0],
      lowerLegL: [d(-15), 0, 0],
      upperLegR: [d(-22), 0, 0],
      lowerLegR: [d(-25), 0, 0],
      upperArmL: [d(-24), 0, d(6)],
      upperArmR: [d(24), 0, d(-6)],
      lowerArmL: [d(-18), 0, 0],
      lowerArmR: [d(-18), 0, 0],
    },
  },
  {
    id: 'run',
    label: '奔跑',
    group: '基础',
    pose: {
      spine: [d(14), 0, 0],
      chest: [d(6), 0, 0],
      upperLegL: [d(42), 0, 0],
      lowerLegL: [d(-55), 0, 0],
      upperLegR: [d(-38), 0, 0],
      lowerLegR: [d(-70), 0, 0],
      upperArmL: [d(-58), 0, d(8)],
      upperArmR: [d(58), 0, d(-8)],
      lowerArmL: [d(-75), 0, 0],
      lowerArmR: [d(-75), 0, 0],
    },
  },
  {
    id: 'sit',
    label: '坐',
    group: '基础',
    pose: {
      upperLegL: [d(-85), 0, d(4)],
      lowerLegL: [d(85), 0, 0],
      upperLegR: [d(-85), 0, d(-4)],
      lowerLegR: [d(85), 0, 0],
      upperArmL: [d(-15), 0, d(8)],
      upperArmR: [d(-15), 0, d(-8)],
      lowerArmL: [d(-40), 0, 0],
      lowerArmR: [d(-40), 0, 0],
    },
  },
  {
    id: 'point',
    label: '指向',
    group: '基础',
    pose: {
      chest: [0, d(-12), 0],
      shoulderR: [0, 0, 0],
      upperArmR: [d(-88), d(-6), d(-10)],
      lowerArmR: [d(-6), 0, 0],
      upperArmL: [0, 0, d(8)],
    },
  },
  {
    id: 'arms-crossed',
    label: '抱臂',
    group: '基础',
    pose: {
      upperArmL: [d(-58), d(-32), d(30)],
      lowerArmL: [d(-88), 0, 0],
      upperArmR: [d(-58), d(32), d(-30)],
      lowerArmR: [d(-88), 0, 0],
    },
  },
  {
    id: 'lying',
    label: '躺',
    group: '基础',
    pose: {
      hips: [d(-90), 0, 0],
      upperArmL: [0, 0, d(30)],
      upperArmR: [0, 0, d(-30)],
    },
  },
  {
    id: 'kneel',
    label: '跪',
    group: '基础',
    pose: {
      upperLegL: [d(-90), 0, d(4)],
      lowerLegL: [d(120), 0, 0],
      upperLegR: [d(-30), 0, d(-4)],
      lowerLegR: [d(90), 0, 0],
      upperArmL: [0, 0, d(8)],
      upperArmR: [0, 0, d(-8)],
    },
  },
  // ─────────────── 武打组 ───────────────
  {
    // 弓步冲拳：左弓步、右手握拳前冲、左拳收腰
    id: 'punch',
    label: '出拳',
    group: '武打',
    pose: {
      chest: [0, d(18), 0],
      upperLegL: [d(-40), 0, d(6)],
      lowerLegL: [d(30), 0, 0],
      footL: [d(10), 0, 0],
      upperLegR: [d(15), 0, d(-6)],
      // 右臂前冲
      upperArmR: [d(-92), d(-8), d(-8)],
      lowerArmR: [d(-8), 0, 0],
      handR: [0, 0, 0],
      thumbR: [d(70), d(10), 0],
      fingersR: [d(137), 0, 0],
      // 左拳收腰
      upperArmL: [d(-30), d(30), d(24)],
      lowerArmL: [d(-120), 0, 0],
      thumbL: [d(70), d(10), 0],
      fingersL: [d(137), 0, 0],
    },
  },
  {
    // 正踢：右腿高抬前踢，双臂平衡
    id: 'kick',
    label: '踢腿',
    group: '武打',
    pose: {
      hips: [0, 0, 0],
      spine: [d(-10), 0, 0],
      upperLegR: [d(-110), 0, d(-4)],
      lowerLegR: [d(10), 0, 0],
      footR: [d(-30), 0, 0],
      upperLegL: [d(10), 0, d(4)],
      upperArmL: [d(-20), 0, d(48)],
      upperArmR: [d(-20), 0, d(-48)],
      lowerArmL: [d(-30), 0, 0],
      lowerArmR: [d(-30), 0, 0],
    },
  },
  {
    // 格挡：双臂交叉抬起护头护身，微下蹲
    id: 'block',
    label: '格挡',
    group: '武打',
    pose: {
      spine: [d(8), 0, 0],
      upperLegL: [d(-18), 0, d(8)],
      lowerLegL: [d(24), 0, 0],
      upperLegR: [d(-18), 0, d(-8)],
      lowerLegR: [d(24), 0, 0],
      upperArmL: [d(-88), d(-20), d(28)],
      lowerArmL: [d(-100), 0, 0],
      upperArmR: [d(-88), d(20), d(-28)],
      lowerArmR: [d(-100), 0, 0],
      thumbL: [d(50), 0, 0],
      fingersL: [d(90), 0, 0],
      thumbR: [d(50), 0, 0],
      fingersR: [d(90), 0, 0],
    },
  },
  {
    // 马步：双腿大幅外展下蹲，双拳收腰
    id: 'horse-stance',
    label: '马步',
    group: '武打',
    pose: {
      upperLegL: [d(-30), 0, d(45)],
      lowerLegL: [d(60), 0, 0],
      footL: [d(20), 0, 0],
      upperLegR: [d(-30), 0, d(-45)],
      lowerLegR: [d(60), 0, 0],
      footR: [d(20), 0, 0],
      upperArmL: [d(-20), d(35), d(28)],
      lowerArmL: [d(-115), 0, 0],
      upperArmR: [d(-20), d(-35), d(-28)],
      lowerArmR: [d(-115), 0, 0],
      thumbL: [d(70), d(10), 0],
      fingersL: [d(137), 0, 0],
      thumbR: [d(70), d(10), 0],
      fingersR: [d(137), 0, 0],
    },
  },
  {
    // 飞踢：腾空侧踢，hips 抬高（poseGroundOffset 返回正值）、双腿前后分展
    id: 'flying-kick',
    label: '飞踢',
    group: '武打',
    pose: {
      hips: [0, 0, d(-14)],
      spine: [d(-12), 0, 0],
      upperLegR: [d(-100), 0, d(-8)],
      lowerLegR: [d(12), 0, 0],
      footR: [d(-30), 0, 0],
      upperLegL: [d(28), 0, d(6)],
      lowerLegL: [d(70), 0, 0],
      upperArmL: [d(-30), 0, d(52)],
      lowerArmL: [d(-20), 0, 0],
      upperArmR: [d(-80), d(-10), d(-20)],
      lowerArmR: [d(-30), 0, 0],
      thumbR: [d(50), 0, 0],
      fingersR: [d(90), 0, 0],
    },
  },
]

export const POSE_LABEL: Record<string, string> = Object.fromEntries(
  POSE_PRESETS.map((p) => [p.id, p.label]),
)

export function getPose(poseId: string): Pose {
  return POSE_PRESETS.find((p) => p.id === poseId)?.pose ?? {}
}

/**
 * 人偶整体在 Y 方向的额外偏移（世界单位，未含 heightScale，供 Scene 层叠加到 actor.position[1]）。
 * - 返回 0：站立/坐/跪/躺等着地姿势，以 hips 高度直接放置。
 * - 返回正值：腾空姿势（如飞踢），把整体抬离地面。
 */
export function poseGroundOffset(poseId: string, metrics: BodyMetrics): number {
  if (poseId === 'lying') return 0
  if (poseId === 'sit') return 0
  if (poseId === 'kneel') return 0
  // 飞踢：腾空侧踢，把 hips 抬高约半个大腿长，营造离地感
  if (poseId === 'flying-kick') return metrics.upperLegLen * 0.9
  return 0 // 站立类以 hips 高度直接放置，无需额外偏移
}
