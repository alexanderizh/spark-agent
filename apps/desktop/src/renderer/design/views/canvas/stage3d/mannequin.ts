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

/** 全部关节 id（供属性面板分组滑杆枚举） */
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
  'shoulderR',
  'upperArmR',
  'lowerArmR',
  'handR',
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
  handL: '左手',
  shoulderR: '右肩',
  upperArmR: '右大臂',
  lowerArmR: '右小臂',
  handR: '右手',
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
  { label: '左臂', joints: ['shoulderL', 'upperArmL', 'lowerArmL', 'handL'] },
  { label: '右臂', joints: ['shoulderR', 'upperArmR', 'lowerArmR', 'handR'] },
  { label: '左腿', joints: ['upperLegL', 'lowerLegL', 'footL'] },
  { label: '右腿', joints: ['upperLegR', 'lowerLegR', 'footR'] },
]

/** 姿势预设：每个关节相对基准的欧拉角（弧度）。缺省关节视为 [0,0,0]。 */
export type Pose = Partial<Record<JointId, Vec3>>

const d = (deg: number) => (deg * Math.PI) / 180

export const POSE_PRESETS: { id: string; label: string; pose: Pose }[] = [
  {
    id: 'stand',
    label: '站立',
    pose: {
      upperArmL: [0, 0, d(6)],
      upperArmR: [0, 0, d(-6)],
    },
  },
  {
    id: 'walk',
    label: '行走',
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
    pose: {
      hips: [d(-90), 0, 0],
      upperArmL: [0, 0, d(30)],
      upperArmR: [0, 0, d(-30)],
    },
  },
  {
    id: 'kneel',
    label: '跪',
    pose: {
      upperLegL: [d(-90), 0, d(4)],
      lowerLegL: [d(120), 0, 0],
      upperLegR: [d(-30), 0, d(-4)],
      lowerLegR: [d(90), 0, 0],
      upperArmL: [0, 0, d(8)],
      upperArmR: [0, 0, d(-8)],
    },
  },
]

export const POSE_LABEL: Record<string, string> = Object.fromEntries(
  POSE_PRESETS.map((p) => [p.id, p.label]),
)

export function getPose(poseId: string): Pose {
  return POSE_PRESETS.find((p) => p.id === poseId)?.pose ?? {}
}

/** 躺姿会让 hips 平躺，人偶整体沉到地面附近，供 Scene 层做 y 偏移兜底。 */
export function poseGroundOffset(poseId: string, metrics: BodyMetrics): number {
  if (poseId === 'lying') return 0
  if (poseId === 'sit') return 0
  if (poseId === 'kneel') return 0
  return metrics.hipHeight * 0 // 站立类以 hips 高度直接放置，无需额外偏移
}
