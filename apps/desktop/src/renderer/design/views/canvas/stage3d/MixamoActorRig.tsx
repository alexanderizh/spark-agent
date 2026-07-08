import { useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import mixamoMannequinUrl from '../../../../assets/stage3d-actors/mixamo-mannequin.fbx?url'
import type { Stage3DActor, Stage3DBodyType } from './stage3d.types'
import { getPose, type JointId, type Vec3 } from './mannequin'

export type MixamoJointRefCallback = (jointId: JointId, group: THREE.Group | null) => void

type BoneMap = Partial<Record<JointId, string>>

const MIXAMO_BONE_BY_JOINT: BoneMap = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  chest: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  shoulderL: 'mixamorigLeftShoulder',
  upperArmL: 'mixamorigLeftArm',
  lowerArmL: 'mixamorigLeftForeArm',
  handL: 'mixamorigLeftHand',
  thumbL: 'mixamorigLeftHandThumb1',
  fingersL: 'mixamorigLeftHandIndex1',
  shoulderR: 'mixamorigRightShoulder',
  upperArmR: 'mixamorigRightArm',
  lowerArmR: 'mixamorigRightForeArm',
  handR: 'mixamorigRightHand',
  thumbR: 'mixamorigRightHandThumb1',
  fingersR: 'mixamorigRightHandIndex1',
  upperLegL: 'mixamorigLeftUpLeg',
  lowerLegL: 'mixamorigLeftLeg',
  footL: 'mixamorigLeftFoot',
  upperLegR: 'mixamorigRightUpLeg',
  lowerLegR: 'mixamorigRightLeg',
  footR: 'mixamorigRightFoot',
}

const FINGER_CHAINS = {
  L: ['Index', 'Middle', 'Ring', 'Pinky'].map((name) => `mixamorigLeftHand${name}`),
  R: ['Index', 'Middle', 'Ring', 'Pinky'].map((name) => `mixamorigRightHand${name}`),
} as const

const THUMB_CHAINS = {
  L: ['mixamorigLeftHandThumb'],
  R: ['mixamorigRightHandThumb'],
} as const

type RigInstance = {
  scene: THREE.Group
  bones: Map<string, THREE.Bone[]>
  baseRotations: Map<THREE.Bone, THREE.Euler>
}

export type MixamoRootTransform = {
  scale: Vec3
  rotationY: number
}

function bodyShape(bodyType: Stage3DBodyType): {
  root: Vec3
} {
  switch (bodyType) {
    case 'child':
      return {
        root: [0.64, 0.66, 0.64],
      }
    case 'slim':
      return {
        root: [0.76, 1.08, 0.72],
      }
    case 'muscular':
      return {
        root: [1.22, 1.02, 1.12],
      }
    case 'heavy':
      return {
        root: [1.38, 0.93, 1.3],
      }
    case 'tall':
      return {
        root: [0.88, 1.28, 0.84],
      }
    case 'standard':
    default:
      return {
        root: [1, 1, 1],
      }
  }
}

function darker(color: string): THREE.Color {
  const c = new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.02), Math.max(0.05, hsl.l * 0.48))
  return c
}

function collectBones(scene: THREE.Group): Map<string, THREE.Bone[]> {
  const bones = new Map<string, THREE.Bone[]>()
  scene.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      const bone = obj as THREE.Bone
      const list = bones.get(bone.name) ?? []
      list.push(bone)
      bones.set(bone.name, list)
    }
  })
  return bones
}

function firstBone(bones: Map<string, THREE.Bone[]>, name: string | undefined): THREE.Bone | null {
  if (!name) return null
  return bones.get(name)?.[0] ?? null
}

function makeRigInstance(source: THREE.Group, color: string): RigInstance {
  const scene = cloneSkeleton(source) as THREE.Group
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.04 })
  const jointMat = new THREE.MeshStandardMaterial({ color: darker(color), roughness: 0.62, metalness: 0.06 })

  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.material = mesh.name.toLowerCase().includes('joint') ? jointMat : bodyMat
    }
  })

  const bones = collectBones(scene)
  const baseRotations = new Map<THREE.Bone, THREE.Euler>()
  for (const list of bones.values()) {
    for (const bone of list) {
      baseRotations.set(bone, bone.rotation.clone())
    }
  }
  return { scene, bones, baseRotations }
}

function addEuler(a: THREE.Euler, b: Vec3): THREE.Euler {
  return new THREE.Euler(a.x + b[0], a.y + b[1], a.z + b[2], a.order)
}

export function getMixamoRootTransform(actor: Stage3DActor): MixamoRootTransform {
  const shape = bodyShape(actor.bodyType)
  return {
    scale: [
      0.01 * actor.heightScale * shape.root[0],
      0.01 * actor.heightScale * shape.root[1],
      0.01 * actor.heightScale * shape.root[2],
    ],
    rotationY: 0,
  }
}

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

function applyBodyShape(instance: RigInstance, actor: Stage3DActor): void {
  const transform = getMixamoRootTransform(actor)
  instance.scene.scale.set(transform.scale[0], transform.scale[1], transform.scale[2])
  instance.scene.rotation.set(0, transform.rotationY, 0)
}

function applyPose(instance: RigInstance, actor: Stage3DActor): void {
  const pose = getPose(actor.pose)
  for (const [jointId, boneName] of Object.entries(MIXAMO_BONE_BY_JOINT) as [JointId, string][]) {
    for (const bone of instance.bones.get(boneName) ?? []) {
      const base = instance.baseRotations.get(bone)
      if (base) bone.rotation.copy(addEuler(base, eulerFor(jointId, pose, actor.joints)))
    }
  }

  for (const side of ['L', 'R'] as const) {
    const thumb = eulerFor(`thumb${side}` as JointId, pose, actor.joints)
    const fingers = eulerFor(`fingers${side}` as JointId, pose, actor.joints)
    for (const prefix of THUMB_CHAINS[side]) {
      for (let i = 1; i <= 3; i++) {
        const bone = firstBone(instance.bones, `${prefix}${i}`)
        const base = bone ? instance.baseRotations.get(bone) : null
        if (bone && base) bone.rotation.copy(addEuler(base, [thumb[0] * 0.34, thumb[1] * 0.34, 0]))
      }
    }
    for (const prefix of FINGER_CHAINS[side]) {
      for (let i = 1; i <= 3; i++) {
        const bone = firstBone(instance.bones, `${prefix}${i}`)
        const base = bone ? instance.baseRotations.get(bone) : null
        const weight = i === 1 ? 0.42 : i === 2 ? 0.34 : 0.24
        if (bone && base) bone.rotation.copy(addEuler(base, [fingers[0] * weight, fingers[1] * weight, 0]))
      }
    }
  }
}

export function MixamoActorRig({
  actor,
  onJointRef,
}: {
  actor: Stage3DActor
  onJointRef?: MixamoJointRefCallback | undefined
}) {
  const source = useLoader(FBXLoader, mixamoMannequinUrl) as THREE.Group
  const instance = useMemo(() => makeRigInstance(source, actor.color), [source, actor.color])

  useLayoutEffect(() => {
    applyBodyShape(instance, actor)
    applyPose(instance, actor)
    instance.scene.updateMatrixWorld(true)
  }, [actor.bodyType, actor.heightScale, actor.joints, actor.pose, instance, actor])

  useLayoutEffect(() => {
    if (!onJointRef) return
    for (const [jointId, boneName] of Object.entries(MIXAMO_BONE_BY_JOINT) as [JointId, string][]) {
      const bone = firstBone(instance.bones, boneName)
      onJointRef(jointId, bone ? (bone as unknown as THREE.Group) : null)
    }
    return () => {
      for (const jointId of Object.keys(MIXAMO_BONE_BY_JOINT) as JointId[]) onJointRef(jointId, null)
    }
  }, [instance, onJointRef])

  return <primitive object={instance.scene} />
}
