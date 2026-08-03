import type { Vec3 } from './mannequin'

export type MixamoPose = {
  /** Local Euler deltas, applied after each FBX bone's original bind rotation. */
  bones: Readonly<Partial<Record<string, Vec3>>>
}

const degrees = (value: number): number => (value * Math.PI) / 180

const EMPTY_POSE: MixamoPose = { bones: {} }

const MIXAMO_POSES: Readonly<Record<string, MixamoPose>> = {
  // Keep the FBX authored T-pose until arm poses are fully retargeted. Rotating
  // only the shoulders moves the upper arms through this model's chest volume.
  stand: EMPTY_POSE,
  walk: {
    bones: {
      mixamorigLeftUpLeg: [degrees(-20), 0, 0],
      mixamorigRightUpLeg: [degrees(20), 0, 0],
      mixamorigLeftLeg: [degrees(12), 0, 0],
      mixamorigRightLeg: [degrees(4), 0, 0],
    },
  },
  sit: {
    bones: {
      mixamorigLeftUpLeg: [degrees(72), 0, 0],
      mixamorigRightUpLeg: [degrees(72), 0, 0],
      mixamorigLeftLeg: [degrees(-78), 0, 0],
      mixamorigRightLeg: [degrees(-78), 0, 0],
      mixamorigSpine: [degrees(-8), 0, 0],
    },
  },
  point: EMPTY_POSE,
  wave: EMPTY_POSE,
}

function copyBones(bones: MixamoPose['bones']): MixamoPose['bones'] {
  return Object.fromEntries(
    Object.entries(bones).flatMap(([boneName, delta]) =>
      delta ? [[boneName, [...delta] as Vec3]] : [],
    ),
  )
}

/**
 * Returns a Mixamo-specific pose. Unsupported legacy pose ids deliberately use
 * the tested neutral stand pose until they are individually authored for this rig.
 */
export function getMixamoPose(poseId: string): MixamoPose {
  const pose = MIXAMO_POSES[poseId] ?? MIXAMO_POSES.stand!
  return { bones: copyBones(pose.bones) }
}
