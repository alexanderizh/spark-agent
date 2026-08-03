import type { Vec3 } from './mannequin'

export type MixamoPose = {
  /** Local Euler deltas, applied after each FBX bone's original bind rotation. */
  bones: Readonly<Partial<Record<string, Vec3>>>
}

const degrees = (value: number): number => (value * Math.PI) / 180

const EMPTY_POSE: MixamoPose = { bones: {} }

// Solved against Beta_Surface's actual arm endpoints. The shoulder first moves
// the clavicle out of the chest, then the upper arm and forearm lower the hand.
const STANDING_ARMS = {
  mixamorigLeftShoulder: [0.313965, 0.036339, 0.228605],
  mixamorigLeftArm: [0.780269, -0.067046, -0.162747],
  mixamorigLeftForeArm: [0.357569, -0.00094, -0.005202],
  mixamorigRightShoulder: [0.313949, -0.036336, -0.228597],
  mixamorigRightArm: [0.780285, 0.067044, 0.162737],
  mixamorigRightForeArm: [0.35757, 0.00094, 0.005204],
} satisfies Partial<Record<string, Vec3>>

function withStandingArms(
  bones: Partial<Record<string, Vec3>> = {},
): Partial<Record<string, Vec3>> {
  return { ...STANDING_ARMS, ...bones }
}

const MIXAMO_POSES: Readonly<Record<string, MixamoPose>> = {
  stand: { bones: STANDING_ARMS },
  't-pose': EMPTY_POSE,
  walk: {
    bones: withStandingArms({
      // Left arm swings with the forward right leg; right arm mirrors it.
      mixamorigLeftArm: [0.780269, -0.067046, 0.151412],
      mixamorigRightArm: [0.780285, 0.067044, -0.151422],
      mixamorigLeftUpLeg: [degrees(-20), 0, 0],
      mixamorigRightUpLeg: [degrees(20), 0, 0],
      mixamorigLeftLeg: [degrees(12), 0, 0],
      mixamorigRightLeg: [degrees(4), 0, 0],
    }),
  },
  run: {
    bones: withStandingArms({
      mixamorigLeftArm: [0.780269, -0.067046, 0.448118],
      mixamorigRightArm: [0.780285, 0.067044, -0.448128],
      mixamorigLeftUpLeg: [degrees(-35), 0, 0],
      mixamorigRightUpLeg: [degrees(35), 0, 0],
      mixamorigLeftLeg: [degrees(28), 0, 0],
      mixamorigRightLeg: [degrees(18), 0, 0],
    }),
  },
  sit: {
    bones: withStandingArms({
      mixamorigLeftUpLeg: [degrees(72), 0, 0],
      mixamorigRightUpLeg: [degrees(72), 0, 0],
      mixamorigLeftLeg: [degrees(-78), 0, 0],
      mixamorigRightLeg: [degrees(-78), 0, 0],
      mixamorigSpine: [degrees(-8), 0, 0],
    }),
  },
  crouch: {
    bones: withStandingArms({
      mixamorigLeftUpLeg: [degrees(80), 0, 0],
      mixamorigRightUpLeg: [degrees(80), 0, 0],
      mixamorigLeftLeg: [degrees(-95), 0, 0],
      mixamorigRightLeg: [degrees(-95), 0, 0],
      mixamorigSpine: [degrees(-16), 0, 0],
      mixamorigLeftArm: [0.92, -0.067046, 0.12],
      mixamorigRightArm: [0.92, 0.067044, -0.12],
      mixamorigLeftForeArm: [0.92, -0.00094, -0.005202],
      mixamorigRightForeArm: [0.92, 0.00094, 0.005204],
    }),
  },
  point: {
    bones: withStandingArms({
      // The right hand projects forward while the resting arm remains clear of
      // the torso; the forearm stays almost straight for a readable direction.
      mixamorigRightArm: [0.64, 0.067044, -0.92],
      mixamorigRightForeArm: [0.12, 0.00094, 0.005204],
      mixamorigRightHand: [0, degrees(-18), 0],
      mixamorigLeftArm: [0.82, -0.067046, -0.06],
      mixamorigLeftForeArm: [0.58, -0.00094, -0.005202],
    }),
  },
  'arms-crossed': {
    bones: withStandingArms({
      // Bring both elbows in front of the rib cage before folding the forearms;
      // this avoids cutting straight through the torso from the bind T-pose.
      mixamorigLeftArm: [0.82, -0.067046, 0.72],
      mixamorigRightArm: [0.82, 0.067044, -0.72],
      mixamorigLeftForeArm: [1.54, -0.00094, degrees(-18)],
      mixamorigRightForeArm: [1.54, 0.00094, degrees(18)],
      mixamorigLeftHand: [0, 0, degrees(18)],
      mixamorigRightHand: [0, 0, degrees(-18)],
    }),
  },
  lying: {
    bones: withStandingArms({
      mixamorigHips: [degrees(-90), 0, 0],
      mixamorigLeftShoulder: [0.1, 0.036339, 0.16],
      mixamorigRightShoulder: [0.1, -0.036336, -0.16],
      mixamorigLeftArm: [0.42, -0.067046, -0.08],
      mixamorigRightArm: [0.42, 0.067044, 0.08],
      mixamorigLeftForeArm: [0.48, -0.00094, -0.005202],
      mixamorigRightForeArm: [0.48, 0.00094, 0.005204],
    }),
  },
  kneel: {
    bones: withStandingArms({
      mixamorigHips: [degrees(-16), 0, 0],
      mixamorigSpine: [degrees(-10), 0, 0],
      mixamorigLeftUpLeg: [degrees(68), 0, 0],
      mixamorigLeftLeg: [degrees(-86), 0, 0],
      mixamorigLeftFoot: [degrees(20), 0, 0],
      mixamorigRightUpLeg: [degrees(-15), 0, 0],
      mixamorigRightLeg: [degrees(-80), 0, 0],
      mixamorigRightFoot: [degrees(60), 0, 0],
      mixamorigLeftArm: [0.88, -0.067046, -0.08],
      mixamorigRightArm: [0.8, 0.067044, 0.12],
      mixamorigLeftForeArm: [0.78, -0.00094, -0.005202],
      mixamorigRightForeArm: [0.6, 0.00094, 0.005204],
    }),
  },
  'hands-on-hips': {
    bones: withStandingArms({
      mixamorigLeftArm: [1.02, -0.067046, -0.46],
      mixamorigRightArm: [1.02, 0.067044, 0.46],
      mixamorigLeftForeArm: [1.76, -0.00094, degrees(14)],
      mixamorigRightForeArm: [1.76, 0.00094, degrees(-14)],
      mixamorigLeftHand: [0, 0, degrees(-24)],
      mixamorigRightHand: [0, 0, degrees(24)],
    }),
  },
  bow: {
    bones: withStandingArms({
      mixamorigHips: [degrees(-42), 0, 0],
      mixamorigSpine: [degrees(-12), 0, 0],
      mixamorigNeck: [degrees(20), 0, 0],
      mixamorigLeftUpLeg: [degrees(38), 0, 0],
      mixamorigRightUpLeg: [degrees(38), 0, 0],
      mixamorigLeftArm: [0.68, -0.067046, -0.1],
      mixamorigRightArm: [0.68, 0.067044, 0.1],
      mixamorigLeftForeArm: [0.52, -0.00094, -0.005202],
      mixamorigRightForeArm: [0.52, 0.00094, 0.005204],
    }),
  },
  think: {
    bones: withStandingArms({
      mixamorigLeftArm: [0.92, -0.067046, 0.2],
      mixamorigLeftForeArm: [1.46, -0.00094, degrees(-12)],
      mixamorigLeftHand: [degrees(16), 0, degrees(-22)],
      mixamorigRightArm: [0.5, 0.067044, -0.52],
      mixamorigRightForeArm: [1.64, 0.00094, degrees(28)],
      mixamorigRightHand: [degrees(20), 0, degrees(-36)],
      mixamorigNeck: [degrees(8), degrees(10), 0],
    }),
  },
  wave: {
    bones: withStandingArms({
      mixamorigRightShoulder: [0.62, -0.036336, -0.36],
      mixamorigRightArm: [0.34, 0.067044, -1.08],
      mixamorigRightForeArm: [1.48, 0.00094, degrees(12)],
      mixamorigRightHand: [degrees(12), 0, degrees(-22)],
      mixamorigLeftArm: [0.82, -0.067046, -0.08],
      mixamorigLeftForeArm: [0.56, -0.00094, -0.005202],
    }),
  },
  phone: {
    bones: withStandingArms({
      mixamorigRightArm: [0.52, 0.067044, -0.52],
      mixamorigRightForeArm: [1.66, 0.00094, degrees(26)],
      mixamorigRightHand: [degrees(20), degrees(24), degrees(-38)],
      mixamorigLeftArm: [0.82, -0.067046, -0.08],
      mixamorigLeftForeArm: [0.56, -0.00094, -0.005202],
      mixamorigNeck: [degrees(12), degrees(8), 0],
    }),
  },
  punch: {
    bones: withStandingArms({
      mixamorigHips: [0, degrees(-8), 0],
      mixamorigSpine: [0, degrees(14), 0],
      mixamorigLeftUpLeg: [degrees(24), 0, degrees(-12)],
      mixamorigLeftLeg: [degrees(30), 0, 0],
      mixamorigRightUpLeg: [degrees(-10), 0, degrees(18)],
      mixamorigRightLeg: [degrees(14), 0, 0],
      mixamorigRightArm: [0.5, 0.067044, degrees(-58)],
      mixamorigRightForeArm: [0.12, 0.00094, 0],
      mixamorigRightHand: [degrees(32), 0, 0],
      mixamorigLeftArm: [0.84, -0.067046, degrees(18)],
      mixamorigLeftForeArm: [1.58, -0.00094, degrees(-18)],
      mixamorigLeftHand: [degrees(32), 0, 0],
    }),
  },
  kick: {
    bones: withStandingArms({
      mixamorigLeftUpLeg: [degrees(-8), 0, 0],
      mixamorigLeftLeg: [degrees(12), 0, 0],
      mixamorigRightUpLeg: [degrees(58), 0, 0],
      mixamorigRightLeg: [degrees(-35), 0, 0],
      mixamorigRightFoot: [degrees(-18), 0, 0],
      mixamorigLeftArm: [0.78, -0.067046, degrees(18)],
      mixamorigRightArm: [0.8, 0.067044, degrees(-24)],
      mixamorigLeftForeArm: [0.76, -0.00094, -0.005202],
      mixamorigRightForeArm: [0.84, 0.00094, 0.005204],
    }),
  },
  block: {
    bones: withStandingArms({
      mixamorigHips: [degrees(5), 0, 0],
      mixamorigSpine: [0, degrees(8), 0],
      mixamorigNeck: [0, degrees(8), 0],
      mixamorigLeftUpLeg: [degrees(4), 0, degrees(-18)],
      mixamorigLeftLeg: [degrees(12), 0, 0],
      mixamorigRightUpLeg: [degrees(-6), 0, degrees(22)],
      mixamorigRightLeg: [degrees(18), 0, 0],
      mixamorigLeftArm: [0.62, -0.067046, degrees(34)],
      mixamorigRightArm: [0.58, 0.067044, degrees(-34)],
      mixamorigLeftForeArm: [1.54, -0.00094, degrees(-12)],
      mixamorigRightForeArm: [1.5, 0.00094, degrees(12)],
      mixamorigLeftHand: [degrees(14), 0, 0],
      mixamorigRightHand: [degrees(14), 0, 0],
    }),
  },
  'horse-stance': {
    bones: withStandingArms({
      mixamorigLeftUpLeg: [degrees(38), 0, degrees(-26)],
      mixamorigLeftLeg: [degrees(-60), 0, 0],
      mixamorigRightUpLeg: [degrees(38), 0, degrees(26)],
      mixamorigRightLeg: [degrees(-60), 0, 0],
      mixamorigLeftFoot: [degrees(16), 0, 0],
      mixamorigRightFoot: [degrees(16), 0, 0],
      mixamorigLeftArm: [0.9, -0.067046, degrees(20)],
      mixamorigRightArm: [0.9, 0.067044, degrees(-20)],
      mixamorigLeftForeArm: [1.75, -0.00094, degrees(-18)],
      mixamorigRightForeArm: [1.75, 0.00094, degrees(18)],
      mixamorigLeftHand: [degrees(34), 0, 0],
      mixamorigRightHand: [degrees(34), 0, 0],
    }),
  },
  throw: {
    bones: withStandingArms({
      mixamorigHips: [degrees(5), degrees(14), 0],
      mixamorigSpine: [0, degrees(-10), 0],
      mixamorigNeck: [0, degrees(8), 0],
      mixamorigLeftUpLeg: [degrees(24), 0, degrees(-12)],
      mixamorigLeftLeg: [degrees(30), 0, 0],
      mixamorigRightUpLeg: [degrees(-10), 0, degrees(18)],
      mixamorigRightLeg: [degrees(14), 0, 0],
      mixamorigRightArm: [0.42, 0.067044, degrees(-46)],
      mixamorigRightForeArm: [1.52, 0.00094, degrees(20)],
      mixamorigRightHand: [degrees(-12), 0, degrees(18)],
      mixamorigLeftArm: [0.64, -0.067046, degrees(28)],
      mixamorigLeftForeArm: [1.22, -0.00094, degrees(-12)],
    }),
  },
  push: {
    bones: withStandingArms({
      mixamorigHips: [degrees(5), degrees(20), 0],
      mixamorigSpine: [degrees(-4), degrees(12), 0],
      mixamorigNeck: [degrees(6), 0, 0],
      mixamorigLeftUpLeg: [degrees(38), 0, degrees(-12)],
      mixamorigLeftLeg: [degrees(-42), 0, 0],
      mixamorigRightUpLeg: [degrees(-20), 0, degrees(14)],
      mixamorigRightLeg: [degrees(-20), 0, 0],
      mixamorigLeftArm: [0.54, -0.067046, degrees(46)],
      mixamorigRightArm: [0.54, 0.067044, degrees(-46)],
      mixamorigLeftForeArm: [0.16, -0.00094, 0],
      mixamorigRightForeArm: [0.16, 0.00094, 0],
      mixamorigLeftHand: [degrees(-14), 0, 0],
      mixamorigRightHand: [degrees(-14), 0, 0],
    }),
  },
  'flying-kick': {
    bones: withStandingArms({
      mixamorigHips: [0, 0, degrees(-14)],
      mixamorigSpine: [degrees(-12), 0, 0],
      mixamorigRightUpLeg: [degrees(92), 0, degrees(-8)],
      mixamorigRightLeg: [degrees(-12), 0, 0],
      mixamorigRightFoot: [degrees(-30), 0, 0],
      mixamorigLeftUpLeg: [degrees(-28), 0, degrees(6)],
      mixamorigLeftLeg: [degrees(-70), 0, 0],
      mixamorigLeftFoot: [degrees(16), 0, 0],
      mixamorigLeftArm: [0.9, -0.067046, degrees(42)],
      mixamorigRightArm: [0.56, 0.067044, degrees(-48)],
      mixamorigLeftForeArm: [0.72, -0.00094, -0.005202],
      mixamorigRightForeArm: [1.0, 0.00094, 0.005204],
    }),
  },
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
