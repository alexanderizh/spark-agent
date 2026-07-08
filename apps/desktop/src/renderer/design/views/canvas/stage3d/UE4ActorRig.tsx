import { useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import ue4MannequinUrl from '../../../../assets/stage3d-actors/ue4-mannequin-retopology.glb?url'
import type { Stage3DActor, Stage3DBodyType } from './stage3d.types'
import { getPose, type JointId, type Vec3 } from './mannequin'

export type UE4JointRefCallback = (jointId: JointId, group: THREE.Group | null) => void

export type UE4Stage3DBodyType = 'mannequin' | 'slim' | 'muscular' | 'broad' | 'child' | 'tall'

export type UE4BoneScaleMap = Record<string, Vec3>

type UE4RestBoneTransform = {
  position: Vec3
  quaternion: [number, number, number, number]
  scale: Vec3
}

type RigInstance = {
  scene: THREE.Group
  bones: Map<string, THREE.Bone>
  restPose: Record<string, UE4RestBoneTransform>
}

const UE4_BONE_BY_JOINT: Partial<Record<JointId, string>> = {
  hips: 'Bip001_Pelvis_03',
  spine: 'Bip001_Spine_04',
  chest: 'Bip001_Spine1_05',
  neck: 'Bip001_Neck_06',
  head: 'Bip001_Head_055',
  upperArmL: 'Bip001_L_UpperArm_08',
  lowerArmL: 'Bip001_L_Forearm_09',
  handL: 'Bip001_L_Hand_010',
  upperArmR: 'Bip001_R_UpperArm_032',
  lowerArmR: 'Bip001_R_Forearm_033',
  handR: 'Bip001_R_Hand_034',
  upperLegL: 'Bip001_L_Thigh_057',
  lowerLegL: 'Bip001_L_Calf_058',
  footL: 'Bip001_L_Foot_059',
  upperLegR: 'Bip001_R_Thigh_061',
  lowerLegR: 'Bip001_R_Calf_062',
  footR: 'Bip001_R_Foot_063',
}

function d(deg: number): number {
  return (deg * Math.PI) / 180
}

function cloneMaterialInstance(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map((item) => item.clone()) : material.clone()
}

function tintMaterial(material: THREE.Material | THREE.Material[], color: string): void {
  const materials = Array.isArray(material) ? material : [material]
  const nextColor = new THREE.Color(color)
  for (const item of materials) {
    if (item instanceof THREE.MeshStandardMaterial && item.name !== 'SK_Mannequin_M_UE4Man_ChestLogo') {
      item.color.copy(nextColor)
      item.roughness = 0.68
      item.metalness = 0.04
      item.needsUpdate = true
    }
  }
}

function collectBones(scene: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>()
  scene.traverse((object) => {
    if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone)
  })
  return bones
}

function captureRestPose(bones: Map<string, THREE.Bone>): Record<string, UE4RestBoneTransform> {
  const restPose: Record<string, UE4RestBoneTransform> = {}
  for (const [name, bone] of bones) {
    restPose[name] = {
      position: [bone.position.x, bone.position.y, bone.position.z],
      quaternion: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
      scale: [bone.scale.x, bone.scale.y, bone.scale.z],
    }
  }
  return restPose
}

function makeRigInstance(source: THREE.Group, color: string): RigInstance {
  const scene = cloneSkeleton(source) as THREE.Group
  scene.traverse((object) => {
    object.frustumCulled = false
    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.material = cloneMaterialInstance(mesh.material)
      tintMaterial(mesh.material, color)
    }
  })
  const bones = collectBones(scene)
  return { scene, bones, restPose: captureRestPose(bones) }
}

export function stage3DBodyTypeToUE4BodyType(bodyType: Stage3DBodyType): UE4Stage3DBodyType {
  switch (bodyType) {
    case 'slim':
      return 'slim'
    case 'muscular':
      return 'muscular'
    case 'heavy':
      return 'broad'
    case 'child':
      return 'child'
    case 'tall':
      return 'tall'
    case 'standard':
    default:
      return 'mannequin'
  }
}

export function getUE4Stage3DBodyScale(bodyType: Stage3DBodyType): Vec3 {
  switch (stage3DBodyTypeToUE4BodyType(bodyType)) {
    case 'child':
      return [0.72, 0.72, 0.72]
    case 'tall':
      return [0.9, 1.14, 0.9]
    default:
      return [1, 1, 1]
  }
}

function baseBoneScales(): UE4BoneScaleMap {
  return {
    Bip001_Head_055: [1, 1, 1],
    Bip001_Neck_06: [1, 1, 1],
    Bip001_Pelvis_03: [1, 1.02, 1.02],
    Bip001_Spine_04: [1, 1, 1],
    Bip001_Spine1_05: [1, 1.02, 1.02],
    Bip001_L_Clavicle_07: [1, 1, 1],
    Bip001_R_Clavicle_031: [1, 1, 1],
    Bip001_L_UpperArm_08: [1, 1, 1],
    Bip001_R_UpperArm_032: [1, 1, 1],
    Bip001_L_Forearm_09: [1, 1, 1],
    Bip001_R_Forearm_033: [1, 1, 1],
    Bip001_L_Hand_010: [1, 1, 1],
    Bip001_R_Hand_034: [1, 1, 1],
    Bip001_L_Thigh_057: [1, 1, 1],
    Bip001_R_Thigh_061: [1, 1, 1],
    Bip001_L_Calf_058: [1, 1, 1],
    Bip001_R_Calf_062: [1, 1, 1],
    Bip001_L_Foot_059: [1, 1, 1],
    Bip001_R_Foot_063: [1, 1, 1],
  }
}

export function getUE4Stage3DBoneScales(bodyType: Stage3DBodyType): UE4BoneScaleMap {
  const scales = baseBoneScales()
  switch (stage3DBodyTypeToUE4BodyType(bodyType)) {
    case 'slim':
      scales.Bip001_Pelvis_03 = [0.98, 0.75, 0.9]
      scales.Bip001_Spine1_05 = [0.98, 1, 1]
      scales.Bip001_L_Clavicle_07 = [0.9, 1, 0.9]
      scales.Bip001_R_Clavicle_031 = [0.9, 1, 0.9]
      scales.Bip001_L_UpperArm_08 = [0.96, 0.96, 0.96]
      scales.Bip001_R_UpperArm_032 = [0.96, 0.96, 0.96]
      scales.Bip001_L_Forearm_09 = [1, 1, 0.78]
      scales.Bip001_R_Forearm_033 = [1, 1, 0.78]
      scales.Bip001_L_Thigh_057 = [1, 0.84, 0.84]
      scales.Bip001_R_Thigh_061 = [1, 0.84, 0.84]
      break
    case 'muscular':
      scales.Bip001_Pelvis_03 = [1, 1.04, 1.04]
      scales.Bip001_Spine_04 = [1.02, 1.1, 1.06]
      scales.Bip001_Spine1_05 = [1.02, 1.26, 1.1]
      scales.Bip001_L_Clavicle_07 = [1.16, 1, 1]
      scales.Bip001_R_Clavicle_031 = [1.16, 1, 1]
      scales.Bip001_L_UpperArm_08 = [1, 1.18, 1.18]
      scales.Bip001_R_UpperArm_032 = [1, 1.18, 1.18]
      scales.Bip001_L_Forearm_09 = [1, 1.12, 1.12]
      scales.Bip001_R_Forearm_033 = [1, 1.12, 1.12]
      scales.Bip001_L_Thigh_057 = [1, 1.12, 1.12]
      scales.Bip001_R_Thigh_061 = [1, 1.12, 1.12]
      break
    case 'broad':
      scales.Bip001_Pelvis_03 = [1.02, 1.12, 1.08]
      scales.Bip001_Spine1_05 = [1.02, 1.22, 1.1]
      scales.Bip001_L_Clavicle_07 = [1.12, 1, 1]
      scales.Bip001_R_Clavicle_031 = [1.12, 1, 1]
      scales.Bip001_L_UpperArm_08 = [1, 1.12, 1.12]
      scales.Bip001_R_UpperArm_032 = [1, 1.12, 1.12]
      scales.Bip001_L_Forearm_09 = [1, 1.08, 1.08]
      scales.Bip001_R_Forearm_033 = [1, 1.08, 1.08]
      scales.Bip001_L_Thigh_057 = [1.02, 1.1, 1.08]
      scales.Bip001_R_Thigh_061 = [1.02, 1.1, 1.08]
      break
    case 'child':
      scales.Bip001_Head_055 = [1.34, 1.34, 1.34]
      scales.Bip001_Pelvis_03 = [0.88, 0.9, 0.9]
      scales.Bip001_Spine_04 = [1.2, 1.2, 1.2]
      scales.Bip001_Spine1_05 = [0.84, 0.86, 0.86]
      scales.Bip001_L_UpperArm_08 = [0.84, 1.1, 1.1]
      scales.Bip001_R_UpperArm_032 = [0.84, 1.1, 1.1]
      scales.Bip001_L_Forearm_09 = [1, 0.8, 0.8]
      scales.Bip001_R_Forearm_033 = [1, 0.8, 0.8]
      scales.Bip001_L_Thigh_057 = [0.7, 0.9, 0.9]
      scales.Bip001_R_Thigh_061 = [0.7, 0.9, 0.9]
      scales.Bip001_L_Calf_058 = [0.82, 0.9, 0.9]
      scales.Bip001_R_Calf_062 = [0.82, 0.9, 0.9]
      break
    case 'tall':
      scales.Bip001_Head_055 = [0.96, 0.96, 0.96]
      scales.Bip001_Pelvis_03 = [0.96, 0.98, 0.98]
      scales.Bip001_Spine1_05 = [0.96, 1.04, 1.02]
      scales.Bip001_L_UpperArm_08 = [1, 0.94, 0.94]
      scales.Bip001_R_UpperArm_032 = [1, 0.94, 0.94]
      scales.Bip001_L_Thigh_057 = [1.08, 0.92, 0.92]
      scales.Bip001_R_Thigh_061 = [1.08, 0.92, 0.92]
      break
  }
  return scales
}

function neutralBoneRotations(): Partial<Record<string, Vec3>> {
  return {
    Bip001_L_UpperArm_08: [0, d(25), 0],
    Bip001_R_UpperArm_032: [0, d(-25), 0],
    Bip001_L_Forearm_09: [0, 0, d(25)],
    Bip001_R_Forearm_033: [0, 0, d(25)],
  }
}

function addPose(a: Vec3, b: Vec3 | undefined): Vec3 {
  if (!b) return a
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function eulerFor(actor: Stage3DActor, jointId: JointId): Vec3 {
  const base = getPose(actor.pose)[jointId] ?? [0, 0, 0]
  return addPose(base, actor.joints?.[jointId])
}

function spineRotation(euler: Vec3): Vec3 {
  return [euler[1], euler[2], -euler[0]]
}

function headRotation(euler: Vec3): Vec3 {
  return [euler[1], euler[2], euler[0]]
}

function shoulderRotation(euler: Vec3): Vec3 {
  return [euler[1], euler[2], -euler[0]]
}

function hipRotation(euler: Vec3): Vec3 {
  return [euler[1], -euler[2], euler[0]]
}

function limbBendRotation(euler: Vec3): Vec3 {
  return [0, 0, -euler[0]]
}

function handFootRotation(euler: Vec3): Vec3 {
  return [euler[1], euler[2], euler[0]]
}

function poseBoneRotations(actor: Stage3DActor): Partial<Record<string, Vec3>> {
  return {
    Bip001_Pelvis_03: spineRotation(eulerFor(actor, 'hips')),
    Bip001_Spine_04: spineRotation(eulerFor(actor, 'spine')),
    Bip001_Spine1_05: spineRotation(eulerFor(actor, 'chest')),
    Bip001_Neck_06: headRotation(eulerFor(actor, 'neck')),
    Bip001_Head_055: headRotation(eulerFor(actor, 'head')),
    Bip001_L_UpperArm_08: shoulderRotation(eulerFor(actor, 'upperArmL')),
    Bip001_R_UpperArm_032: shoulderRotation(eulerFor(actor, 'upperArmR')),
    Bip001_L_Forearm_09: limbBendRotation(eulerFor(actor, 'lowerArmL')),
    Bip001_R_Forearm_033: limbBendRotation(eulerFor(actor, 'lowerArmR')),
    Bip001_L_Hand_010: handFootRotation(eulerFor(actor, 'handL')),
    Bip001_R_Hand_034: handFootRotation(eulerFor(actor, 'handR')),
    Bip001_L_Thigh_057: hipRotation(eulerFor(actor, 'upperLegL')),
    Bip001_R_Thigh_061: hipRotation(eulerFor(actor, 'upperLegR')),
    Bip001_L_Calf_058: limbBendRotation(eulerFor(actor, 'lowerLegL')),
    Bip001_R_Calf_062: limbBendRotation(eulerFor(actor, 'lowerLegR')),
    Bip001_L_Foot_059: handFootRotation(eulerFor(actor, 'footL')),
    Bip001_R_Foot_063: handFootRotation(eulerFor(actor, 'footR')),
  }
}

function applyRotationOffset(bone: THREE.Bone, rotation: Vec3): void {
  bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))
}

function alignToGround(scene: THREE.Object3D): void {
  scene.position.y = 0
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  if (bounds.isEmpty() || !Number.isFinite(bounds.min.y)) return
  scene.position.y += -bounds.min.y
}

function applyRig(instance: RigInstance, actor: Stage3DActor): void {
  const bodyScale = getUE4Stage3DBodyScale(actor.bodyType)
  instance.scene.scale.set(
    bodyScale[0] * actor.heightScale,
    bodyScale[1] * actor.heightScale,
    bodyScale[2] * actor.heightScale,
  )

  const bodyScales = getUE4Stage3DBoneScales(actor.bodyType)
  const neutral = neutralBoneRotations()
  const pose = poseBoneRotations(actor)

  for (const [name, bone] of instance.bones) {
    const rest = instance.restPose[name]
    if (!rest) continue
    bone.position.set(rest.position[0], rest.position[1], rest.position[2])
    bone.quaternion.set(rest.quaternion[0], rest.quaternion[1], rest.quaternion[2], rest.quaternion[3])
    const scale = bodyScales[name] ?? [1, 1, 1]
    bone.scale.set(rest.scale[0] * scale[0], rest.scale[1] * scale[1], rest.scale[2] * scale[2])
    const neutralRotation = neutral[name]
    if (neutralRotation) applyRotationOffset(bone, neutralRotation)
    const poseRotation = pose[name]
    if (poseRotation) applyRotationOffset(bone, poseRotation)
  }

  alignToGround(instance.scene)
  instance.scene.updateMatrixWorld(true)
}

export function UE4ActorRig({
  actor,
  onJointRef,
}: {
  actor: Stage3DActor
  onJointRef?: UE4JointRefCallback | undefined
}) {
  const gltf = useLoader(GLTFLoader, ue4MannequinUrl) as { scene: THREE.Group }
  const instance = useMemo(() => makeRigInstance(gltf.scene, actor.color), [gltf.scene, actor.color])

  useLayoutEffect(() => {
    applyRig(instance, actor)
  }, [actor, instance])

  useLayoutEffect(() => {
    if (!onJointRef) return
    for (const [jointId, boneName] of Object.entries(UE4_BONE_BY_JOINT) as [JointId, string][]) {
      const bone = instance.bones.get(boneName)
      onJointRef(jointId, bone ? (bone as unknown as THREE.Group) : null)
    }
    return () => {
      for (const jointId of Object.keys(UE4_BONE_BY_JOINT) as JointId[]) onJointRef(jointId, null)
    }
  }, [instance, onJointRef])

  return <primitive object={instance.scene} />
}
