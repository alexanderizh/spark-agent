import * as THREE from 'three'
import { clampJointEuler, type JointId, type Vec3 } from './mannequin'

/**
 * 两骨解析式 IK（余弦定理闭式解），纯函数、无副作用、可单测。
 *
 * 几何约定（与 MannequinRig 的骨架搭建一致）：
 * - 链在「上段关节的父空间」里求解。静止姿态下上段、下段都沿 -Y 方向延伸。
 * - 上段关节 group 应用 `upperEuler`（3 轴），下段关节 group 只应用绕 X 的弯曲角
 *   （`lowerEuler = [bend, 0, 0]`），因为肘/膝都是铰链。
 * - 手臂链：shoulder→elbow(lowerArm)→wrist，肘弯曲轴 X **负向**（lowerArm.x ∈ [-145°,0]）。
 * - 腿链：hip→knee(lowerLeg)→ankle，膝弯曲轴 X **正向**（lowerLeg.x ∈ [0,150]）。
 *   与 POSE_PRESETS 中 lowerArm/lowerLeg 的符号约定一致。
 *
 * FK 复算（正向验证用，见 ikEndEffectorLocal）：
 *   elbow = R(upperEuler) · (0,-l1,0)
 *   wrist = R(upperEuler) · [ (0,-l1,0) + R_x(bend) · (0,-l2,0) ]
 * 其中 target/end 都在上段关节父空间的本地坐标系。
 */

/** IK 链输入参数（长度 + 弯曲方向符号）。 */
export type IkChain = {
  /** 上段长度（upperArm / upperLeg） */
  upperLen: number
  /** 下段长度（lowerArm / lowerLeg） */
  lowerLen: number
  /** 下段关节 id（用于软限位钳制，如 'lowerArmL' / 'lowerLegR'） */
  lowerJointId: JointId
  /** 上段关节 id（用于软限位钳制，如 'upperArmL' / 'upperLegR'） */
  upperJointId: JointId
  /**
   * 铰链弯曲符号：手臂 -1（肘向后下弯，lowerArm.x 取负），腿 +1（膝向后弯，lowerLeg.x 取正）。
   */
  bendSign: 1 | -1
}

export type IkResult = {
  /** 上段关节本地欧拉角（钳制后） */
  upperEuler: Vec3
  /** 下段关节本地欧拉角（仅 X 弯曲，钳制后） */
  lowerEuler: Vec3
  /** 目标是否可达（false = 已伸直指向目标） */
  reachable: boolean
}

const REST = new THREE.Vector3(0, -1, 0) // 静止段方向（-Y）

/**
 * 正向运动学：给定上/下段欧拉角，返回末端（wrist/ankle）在上段父空间的本地坐标。
 * 单测用它复算 solveTwoBoneIK 的结果误差。
 */
export function ikEndEffectorLocal(
  chain: Pick<IkChain, 'upperLen' | 'lowerLen'>,
  upperEuler: Vec3,
  lowerEuler: Vec3,
): THREE.Vector3 {
  const { upperLen, lowerLen } = chain
  const upperQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(upperEuler[0], upperEuler[1], upperEuler[2], 'XYZ'),
  )
  const lowerQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(lowerEuler[0], lowerEuler[1], lowerEuler[2], 'XYZ'),
  )
  // 下段相对上段的末端向量（先在上段坐标系里，再叠加下段旋转）
  const elbow = REST.clone().multiplyScalar(upperLen)
  const lowerVec = REST.clone().multiplyScalar(lowerLen).applyQuaternion(lowerQ)
  const wristRel = elbow.clone().add(lowerVec)
  return wristRel.applyQuaternion(upperQ)
}

/**
 * 解两骨 IK。
 * @param chain   链长度与弯曲符号。
 * @param target  目标末端点（上段关节父空间的本地坐标）。
 * @param poleHint 上一帧的弯曲角（下段 X），用于保持弯曲方向连续；缺省用 bendSign 默认方向。
 * @param opts.clamp === false 时不钳制软限位（Alt 突破），仍保留铰链方向。
 */
export function solveTwoBoneIK(
  chain: IkChain,
  target: readonly [number, number, number] | THREE.Vector3,
  poleHint?: number,
  opts?: { clamp?: boolean },
): IkResult {
  const { upperLen, lowerLen, bendSign } = chain
  const tgt =
    target instanceof THREE.Vector3
      ? target.clone()
      : new THREE.Vector3(target[0], target[1], target[2])

  const dist = tgt.length()
  const eps = 1e-6

  // ── 1. 求肘/膝弯曲角（余弦定理） ──
  const maxReach = upperLen + lowerLen
  const minReach = Math.abs(upperLen - lowerLen)
  let reachable = true
  let bendMag: number // 下段相对上段偏离伸直态的角度（0 = 伸直）
  if (dist >= maxReach - eps) {
    // 不可达（太远）：伸直指向目标
    reachable = false
    bendMag = 0
  } else if (dist <= minReach + eps) {
    // 不可达（太近）：折到最大
    reachable = false
    bendMag = Math.PI
  } else {
    // 下段轴与上段轴夹角的补角：cos = (l1²+l2²-d²)/(2 l1 l2)
    const cosBend = (upperLen * upperLen + lowerLen * lowerLen - dist * dist) / (2 * upperLen * lowerLen)
    const interior = Math.acos(Math.min(1, Math.max(-1, cosBend)))
    bendMag = Math.PI - interior // 0=伸直，越大越弯
  }

  // 弯曲方向：优先沿 poleHint 符号保持连续，否则用 bendSign
  const dir = poleHint !== undefined && Math.abs(poleHint) > eps ? Math.sign(poleHint) : bendSign
  const bend = bendMag * dir // 下段绕 X 的旋转角

  // ── 2. 求上段朝向：让末端落到目标 ──
  // 先算「伸直态下上段需绕关节顶点转多少」——用两步：
  //   a) 把 REST(-Y) 转到指向目标方向（swing）
  //   b) 再补偿肘弯曲带来的末端相对上段轴的偏移角（在弯曲平面内绕 X 反向修正）
  const dirToTarget = tgt.clone()
  if (dist < eps) dirToTarget.set(0, -1, 0)
  else dirToTarget.normalize()

  // a) swing：把 -Y 旋到 dirToTarget
  const swing = new THREE.Quaternion().setFromUnitVectors(REST, dirToTarget)

  // b) 弯曲修正角：末端(l1沿轴 + l2偏 bend)相对上段轴(-Y)的夹角，需把上段轴反向抬 alpha。
  //    alpha = atan2( l2·sin(bendMag), l1 + l2·cos(bendMag) )
  let alpha = 0
  if (reachable) {
    alpha = Math.atan2(lowerLen * Math.sin(bendMag), upperLen + lowerLen * Math.cos(bendMag))
  }
  // 修正绕 X（弯曲平面法向），方向与 bend 相反，使末端而非上段轴对准目标
  const correct = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -alpha * dir,
  )
  const upperQ = swing.clone().multiply(correct)
  const upperEulerRaw = new THREE.Euler().setFromQuaternion(upperQ, 'XYZ')

  const doClamp = opts?.clamp !== false
  const upperEuler = clampJointEuler(
    chain.upperJointId,
    [upperEulerRaw.x, upperEulerRaw.y, upperEulerRaw.z],
    { clamp: doClamp },
  )
  const lowerEuler = clampJointEuler(chain.lowerJointId, [bend, 0, 0], { clamp: doClamp })

  return { upperEuler, lowerEuler, reachable }
}
