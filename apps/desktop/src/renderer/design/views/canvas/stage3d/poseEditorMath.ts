import { getPose, type JointId, type Vec3 } from './mannequin'

const EPSILON = 1e-9

export function poseEditorOverrideFromFinalEuler(jointId: JointId, euler: Vec3): Vec3 {
  const base = getPose('stand')[jointId] ?? [0, 0, 0]
  return [euler[0] - base[0], euler[1] - base[1], euler[2] - base[2]]
}

export function poseEditorOverridesFromFinalPose(finalPose: Record<string, Vec3>): Record<string, Vec3> {
  const stand = getPose('stand')
  const jointIds = new Set([...Object.keys(stand), ...Object.keys(finalPose)])
  const overrides: Record<string, Vec3> = {}

  for (const jointId of jointIds) {
    const finalEuler = finalPose[jointId] ?? [0, 0, 0]
    const baseEuler = stand[jointId as JointId] ?? [0, 0, 0]
    const next: Vec3 = [
      finalEuler[0] - baseEuler[0],
      finalEuler[1] - baseEuler[1],
      finalEuler[2] - baseEuler[2],
    ]
    if (next.some((value) => Math.abs(value) > EPSILON)) overrides[jointId] = next
  }

  return overrides
}
