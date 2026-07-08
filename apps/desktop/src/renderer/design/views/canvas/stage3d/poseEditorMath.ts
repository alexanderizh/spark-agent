import { getPose, type JointId, type Vec3 } from './mannequin'

export function poseEditorOverrideFromFinalEuler(jointId: JointId, euler: Vec3): Vec3 {
  const base = getPose('stand')[jointId] ?? [0, 0, 0]
  return [euler[0] - base[0], euler[1] - base[1], euler[2] - base[2]]
}
