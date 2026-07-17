import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { CanvasNode } from '../canvas.types'
import {
  createDefaultStage3DData,
  defaultStage3DLighting,
  getStage3DSceneControlFields,
  makeStage3DCrowdActors,
  makeStage3DActor,
  makeStage3DShot,
  readStage3DData,
  serializeStage3DData,
  STAGE3D_BODY_TYPES,
  type Stage3DCamera,
  type Stage3DData,
} from './stage3d.types'
import {
  BUILTIN_STAGE3D_ACTOR_MODELS,
  DEFAULT_STAGE3D_ACTOR_MODEL_ID,
  getStage3DActorModel,
  normalizeStage3DActorModelId,
} from './actorModelRegistry'
import {
  BODY_METRICS,
  JOINT_GROUPS,
  JOINT_IDS,
  JOINT_LABEL,
  JOINT_LIMITS,
  POSE_PRESETS,
  clampJointEuler,
  composePose,
  copySidePose,
  getPose,
  mirrorPose,
  type Vec3,
} from './mannequin'
import { getMixamoRootTransform } from './MixamoActorRig'
import { buildStage3DPrompt } from './prompt'
import { createStage3DLocalModelRuntimeUrl, inferStage3DLocalModelFormat } from './localModelImport'
import {
  poseEditorOverrideFromFinalEuler,
  poseEditorOverridesFromFinalPose,
} from './poseEditorMath'
import {
  alignUE4RigToLocalGround,
  getUE4Stage3DBodyScale,
  getUE4Stage3DBoneScales,
  stage3DBodyTypeToUE4BodyType,
} from './UE4ActorRig'
import { ikEndEffectorLocal, solveTwoBoneIK, type IkChain } from './poseIk'
import { rotationYFromQuaternion } from './rotationY'
import {
  GLB_ASSETS,
  GLB_CATEGORY_LABEL,
  GLB_CATEGORY_ORDER,
  findGlbAsset,
  makeGlbProp,
  makePrimitiveProp,
} from './propRegistry'
import {
  SAVED_POSES_KEY,
  SAVED_POSES_LIMIT,
  deleteSavedPose,
  loadSavedPoses,
  renameSavedPose,
  savePose,
  type PoseStorage,
  type SavedPose,
} from './poseLibrary'
import { LIMB_PROFILES, limbGeometry } from './MannequinRig'

function fakeNode(stage3d: unknown): CanvasNode {
  return { data: { stage3d } } as unknown as CanvasNode
}

// ─────────────────────────── stage3d.types 序列化 / 宽容解析 ───────────────────────────

describe('stage3d.types', () => {
  it.each([
    ['panorama', ['panoramaZoom', 'sceneScale', 'fov']],
    ['backdrop', ['backdropDistance', 'sceneScale', 'fov']],
    ['grid', ['sceneScale', 'fov']],
  ] as const)('%s 模式返回对应的场景控制字段', (mode, expectedFields) => {
    expect(getStage3DSceneControlFields(mode)).toEqual(expectedFields)
  })

  it('空节点给出默认场景：1 个角色、grid 背景、16:9 相机', () => {
    const data = readStage3DData(undefined)
    expect(data.version).toBe(1)
    expect(data.actors).toHaveLength(1)
    expect(data.backdrop.mode).toBe('grid')
    expect(data.backdrop.panoramaZoom).toBe(1)
    expect(data.sceneScale).toBe(1)
    expect(data.camera.aspect).toBe('16:9')
    expect(data.activeId).toBe(data.actors[0]?.id)
  })

  it('序列化 → 反序列化 round-trip 保持一致（panorama 保持可读）', () => {
    const original: Stage3DData = {
      ...createDefaultStage3DData(),
      sceneScale: 1.35,
      backdrop: {
        mode: 'backdrop',
        imageUrl: 'https://x/pano.jpg',
        rotationY: 1.2,
        backdropDistance: 10,
      },
      props: [makeGlbProp(GLB_ASSETS[0]!, 0), makePrimitiveProp('box', 1)],
      sceneBrief: '黄昏的咖啡馆',
      prompt: '旧提示词',
    }
    const legacySerialized = serializeStage3DData(original)
    ;(legacySerialized.backdrop as Record<string, unknown>).mode = 'panorama'
    ;(legacySerialized.backdrop as Record<string, unknown>).panoramaZoom = 1.35
    const restored = readStage3DData(fakeNode(legacySerialized))
    expect(restored.backdrop.mode).toBe('panorama')
    expect(restored.backdrop.imageUrl).toBe('https://x/pano.jpg')
    expect(restored.backdrop.panoramaZoom).toBe(1.35)
    expect(restored.sceneScale).toBe(1.35)
    expect(restored.actors.map((a) => a.id)).toEqual(original.actors.map((a) => a.id))
    expect(restored.props.map((p) => [p.id, p.kind, p.assetId])).toEqual(
      original.props.map((p) => [p.id, p.kind, p.assetId]),
    )
    expect(restored.sceneBrief).toBe('黄昏的咖啡馆')
    expect(restored.prompt).toBe('旧提示词')
  })

  it('脏数据宽容解析：非法枚举回退默认、数值钳制范围', () => {
    const data = readStage3DData(
      fakeNode({
        version: 1,
        sceneScale: 99,
        backdrop: { mode: 'wormhole', backdropDistance: 999, panoramaZoom: 99 },
        actors: [
          {
            id: 'a1',
            bodyType: 'alien',
            heightScale: 99,
            position: 'not-an-array',
            rotationY: 'NaN',
            joints: { head: [1, 2, 3], garbage: 'x' },
          },
          null,
          42,
        ],
        props: [{ id: 'p1', kind: 'weird', scale: 999 }, 'junk'],
        camera: { fov: 999, aspect: '21:9', position: [1, 2] },
        activeId: 'ghost',
      }),
    )
    expect(data.backdrop.mode).toBe('grid')
    expect(data.backdrop.backdropDistance).toBe(40)
    expect(data.backdrop.panoramaZoom).toBe(2)
    expect(data.sceneScale).toBe(2)
    expect(data.actors).toHaveLength(1)
    const actor = data.actors[0]!
    expect(actor.bodyType).toBe('standard')
    expect(actor.heightScale).toBe(1.5)
    expect(actor.position).toEqual([0, 0, 0])
    expect(actor.rotationY).toBe(0)
    expect(actor.joints).toEqual({ head: [1, 2, 3] })
    expect(data.props).toHaveLength(1)
    expect(data.props[0]?.kind).toBe('primitive')
    expect(data.props[0]?.scale).toBe(10)
    expect(data.camera.fov).toBe(100)
    expect(data.camera.aspect).toBe('16:9')
    // activeId 指向不存在的对象时回退到第一个角色
    expect(data.activeId).toBe(actor.id)
  })

  it('actors 为空时兜底生成 1 个默认角色', () => {
    const data = readStage3DData(fakeNode({ version: 1, actors: [], props: [] }))
    expect(data.actors).toHaveLength(1)
    expect(data.actors[0]?.pose).toBe('stand')
  })

  it('actor 模型与群众阵列元数据 round-trip 保持一致', () => {
    const original: Stage3DData = {
      ...createDefaultStage3DData(),
      actors: [
        makeStage3DActor(0, {
          crowdId: 'crowd_1',
          crowdLabel: '群众（2x3）',
          modelId: 'ue4-mannequin',
          modelSource: 'builtin',
          rigType: 'ue4-mannequin',
        }),
      ],
    }
    const restored = readStage3DData(fakeNode(serializeStage3DData(original)))
    expect(restored.actors[0]).toMatchObject({
      crowdId: 'crowd_1',
      crowdLabel: '群众（2x3）',
      modelId: 'ue4-mannequin',
      modelSource: 'builtin',
      rigType: 'ue4-mannequin',
    })
  })

  it('legacy procedural actor 读取时归一为默认内置实体人偶', () => {
    const raw = serializeStage3DData({
      ...createDefaultStage3DData(),
      actors: [makeStage3DActor(0)],
    })
    Object.assign((raw.actors as Array<Record<string, unknown>>)[0]!, {
      modelId: 'procedural',
      modelSource: 'builtin',
      rigType: 'procedural',
    })
    const restored = readStage3DData(fakeNode(raw))
    expect(restored.actors[0]).toMatchObject({
      modelId: DEFAULT_STAGE3D_ACTOR_MODEL_ID,
      modelSource: 'builtin',
      rigType: 'mixamo',
    })
  })

  it('makeStage3DCrowdActors 生成居中的默认人物模型矩阵队列并共享 crowdId', () => {
    const actors = makeStage3DCrowdActors(3, {
      rows: 2,
      columns: 3,
      spacing: 1.5,
      bodyType: 'child',
      modelId: DEFAULT_STAGE3D_ACTOR_MODEL_ID,
      modelSource: 'builtin',
      rigType: 'mixamo',
    })
    expect(actors).toHaveLength(6)
    expect(new Set(actors.map((actor) => actor.crowdId)).size).toBe(1)
    expect(actors[0]).toMatchObject({
      name: '群演04',
      bodyType: 'child',
      modelId: DEFAULT_STAGE3D_ACTOR_MODEL_ID,
      modelSource: 'builtin',
      rigType: 'mixamo',
      crowdLabel: '群众（2x3）',
      position: [-1.5, 0, -0.75],
    })
    expect(actors[5]?.position).toEqual([1.5, 0, 0.75])
  })

  // ─────────── Phase C 新增字段：宽容解析 ───────────

  it('旧场景数据（无 shots/lighting/slate）打开不报错、字段留空', () => {
    const data = readStage3DData(fakeNode({ version: 1, actors: [], props: [] }))
    expect(data.shots).toBeUndefined()
    expect(data.lighting).toBeUndefined()
    expect(data.slate).toBeUndefined()
  })

  it('shots 宽容解析：脏项过滤、镜号非字符串留空、相机参数钳制', () => {
    const data = readStage3DData(
      fakeNode({
        version: 1,
        shots: [
          {
            id: 's1',
            name: '开场',
            shotNumber: '3A',
            position: [1, 2, 3],
            target: [0, 1, 0],
            fov: 40,
            aspect: '9:16',
          },
          { fov: 999, aspect: '21:9', shotNumber: 12 },
          null,
          'junk',
        ],
      }),
    )
    expect(data.shots).toHaveLength(2)
    expect(data.shots?.[0]?.shotNumber).toBe('3A')
    expect(data.shots?.[0]?.aspect).toBe('9:16')
    // 第二个：非法枚举回退、fov 钳制、非字符串镜号留空
    expect(data.shots?.[1]?.fov).toBe(100)
    expect(data.shots?.[1]?.aspect).toBe('16:9')
    expect(data.shots?.[1]?.shotNumber).toBe('')
  })

  it('lighting 宽容解析：非法预设回退 studio、强度钳制 0.5-2', () => {
    expect(
      readStage3DData(fakeNode({ version: 1, lighting: { preset: 'x', intensity: 99 } })).lighting,
    ).toEqual({
      preset: 'studio',
      intensity: 2,
    })
    expect(
      readStage3DData(fakeNode({ version: 1, lighting: { preset: 'rim', intensity: 0.1 } }))
        .lighting,
    ).toEqual({
      preset: 'rim',
      intensity: 0.5,
    })
  })

  it('slate 全空视作未设置；有值时保留', () => {
    expect(
      readStage3DData(fakeNode({ version: 1, slate: { scene: '', shotNumber: '', take: '' } }))
        .slate,
    ).toBeUndefined()
    const withSlate = readStage3DData(
      fakeNode({ version: 1, slate: { scene: '3', shotNumber: '3A', take: '2', note: 'ok' } }),
    )
    expect(withSlate.slate).toEqual({ scene: '3', shotNumber: '3A', take: '2', note: 'ok' })
  })

  it('shots/lighting/slate round-trip 一致', () => {
    const original: Stage3DData = {
      ...createDefaultStage3DData(),
      shots: [
        makeStage3DShot(createDefaultStage3DData().camera, 0, { name: '主镜', shotNumber: '1A' }),
      ],
      lighting: { preset: 'side', intensity: 1.3 },
      slate: { scene: '5', shotNumber: '5C', take: '3' },
    }
    const restored = readStage3DData(fakeNode(serializeStage3DData(original)))
    expect(restored.shots?.[0]?.shotNumber).toBe('1A')
    expect(restored.lighting).toEqual({ preset: 'side', intensity: 1.3 })
    expect(restored.slate).toEqual({ scene: '5', shotNumber: '5C', take: '3' })
  })

  it('makeStage3DShot 从相机快照，序号与镜号自增', () => {
    const cam = createDefaultStage3DData().camera
    const shot = makeStage3DShot(cam, 2)
    expect(shot.name).toBe('镜头3')
    expect(shot.shotNumber).toBe('3')
    expect(shot.position).toEqual(cam.position)
    expect(shot.position).not.toBe(cam.position) // 深拷贝
    expect(defaultStage3DLighting()).toEqual({ preset: 'studio', intensity: 1 })
  })
})

// ─────────────────────────── 内置人物模型目录 ───────────────────────────

describe('actorModelRegistry', () => {
  it('默认人物模型使用 Mixamo 素体，同时保留参考项目 UE4 作为可选模型', () => {
    expect(DEFAULT_STAGE3D_ACTOR_MODEL_ID).toBe('mixamo-mannequin')
    expect(BUILTIN_STAGE3D_ACTOR_MODELS.map((m) => m.id)).toEqual([
      'mixamo-mannequin',
      'ue4-mannequin',
    ])
    expect(getStage3DActorModel('mixamo-mannequin')).toMatchObject({
      label: 'Mixamo 素体',
      rigType: 'mixamo',
      source: 'builtin',
    })
    expect(getStage3DActorModel('ue4-mannequin')).toMatchObject({
      rigType: 'ue4-mannequin',
      source: 'builtin',
    })
  })

  it('非法和旧 procedural 模型 id 归一到默认 Mixamo 素体', () => {
    expect(normalizeStage3DActorModelId('procedural')).toBe(DEFAULT_STAGE3D_ACTOR_MODEL_ID)
    expect(normalizeStage3DActorModelId('unknown-model')).toBe(DEFAULT_STAGE3D_ACTOR_MODEL_ID)
    expect(normalizeStage3DActorModelId('ue4-mannequin')).toBe('ue4-mannequin')
  })
})

describe('UE4ActorRig body scaling', () => {
  it('在父级角色上下移动后仍按模型局部坐标落地，不抵消父级 Y 位移', () => {
    const parent = new THREE.Group()
    parent.position.y = 3
    const rig = new THREE.Group()
    rig.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)))
    parent.add(rig)
    parent.updateMatrixWorld(true)

    alignUE4RigToLocalGround(rig)
    parent.updateMatrixWorld(true)

    const worldBounds = new THREE.Box3().setFromObject(rig)
    expect(worldBounds.min.y).toBeCloseTo(parent.position.y)
  })

  it('把原始厘米制 UE4 模型换算为画布米制尺寸', () => {
    expect(getUE4Stage3DBodyScale('standard')).toEqual([0.0254, 0.0254, 0.0254])
    expect(getUE4Stage3DBodyScale('tall')).toEqual([0.02286, 0.028956, 0.02286])
  })

  it('把现有体型映射到参考项目 UE4 局部骨骼体型，而不是只缩放根节点', () => {
    expect(stage3DBodyTypeToUE4BodyType('standard')).toBe('mannequin')
    expect(stage3DBodyTypeToUE4BodyType('heavy')).toBe('broad')
    expect(stage3DBodyTypeToUE4BodyType('child')).toBe('child')
    expect(getUE4Stage3DBodyScale('child')[0]).toBeLessThan(1)

    const standard = getUE4Stage3DBoneScales('standard')
    const heavy = getUE4Stage3DBoneScales('heavy')
    const child = getUE4Stage3DBoneScales('child')
    expect(heavy.Bip001_Spine1_05![1]).toBeGreaterThan(standard.Bip001_Spine1_05![1])
    expect(child.Bip001_Head_055![0]).toBeGreaterThan(standard.Bip001_Head_055![0])
  })

})

// ─────────────────────────── mannequin 姿势与体型表完整性 ───────────────────────────

describe('mannequin', () => {
  it('姿势预设 id 唯一，且覆盖设计文档要求的基础姿势', () => {
    const ids = POSE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const required of [
      'stand',
      'walk',
      'run',
      'sit',
      'point',
      'arms-crossed',
      'lying',
      'kneel',
    ]) {
      expect(ids).toContain(required)
    }
  })

  it('每个姿势引用的关节 id 都在关节层级里，欧拉角为三元组有限数', () => {
    const jointSet = new Set<string>(JOINT_IDS)
    for (const preset of POSE_PRESETS) {
      for (const [jointId, euler] of Object.entries(preset.pose)) {
        expect(jointSet.has(jointId), `${preset.id} 引用了未知关节 ${jointId}`).toBe(true)
        expect(euler).toHaveLength(3)
        for (const v of euler) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })

  it('getPose 未知 id 回退空姿势', () => {
    expect(getPose('no-such-pose')).toEqual({})
  })

  it('体型表覆盖全部 6 种体型，各段尺寸均为正数', () => {
    expect(STAGE3D_BODY_TYPES).toHaveLength(6)
    for (const bodyType of STAGE3D_BODY_TYPES) {
      const metrics = BODY_METRICS[bodyType]
      expect(metrics, `缺少体型 ${bodyType}`).toBeTruthy()
      for (const [key, value] of Object.entries(metrics)) {
        expect(typeof value, `${bodyType}.${key} 应为数字`).toBe('number')
        expect(value, `${bodyType}.${key} 应为正数`).toBeGreaterThan(0)
      }
    }
  })

  it('关节分组恰好覆盖全部关节各一次，且都有中文标签', () => {
    const grouped = JOINT_GROUPS.flatMap((g) => g.joints)
    expect(grouped.slice().sort()).toEqual([...JOINT_IDS].sort())
    expect(new Set(grouped).size).toBe(JOINT_IDS.length)
    for (const jointId of JOINT_IDS) {
      expect(JOINT_LABEL[jointId]?.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────── 关节加密 / 限位 / 镜像 / 合成 ───────────────────────────

describe('mannequin 关节加密', () => {
  it('新增手指关节 thumb/fingers 并入左右臂分组，且腕标签为「左腕/右腕」', () => {
    for (const id of ['thumbL', 'fingersL', 'thumbR', 'fingersR'] as const) {
      expect(JOINT_IDS).toContain(id)
      expect(JOINT_LABEL[id]?.length).toBeGreaterThan(0)
    }
    expect(JOINT_LABEL.handL).toBe('左腕')
    expect(JOINT_LABEL.handR).toBe('右腕')
    const leftArm = JOINT_GROUPS.find((g) => g.label === '左臂')!
    expect(leftArm.joints).toContain('thumbL')
    expect(leftArm.joints).toContain('fingersL')
  })
})

describe('clampJointEuler', () => {
  it('范围内不改动', () => {
    // hips 全自由 ±180
    expect(clampJointEuler('hips', [0.1, -0.2, 0.3])).toEqual([0.1, -0.2, 0.3])
  })

  it('超限钳制到边界', () => {
    // lowerLegL 膝纯铰链 X 0~150°，Y/Z 锁定
    const [minX] = JOINT_LIMITS.lowerLegL[0]!
    const [, maxX] = JOINT_LIMITS.lowerLegL[0]!
    expect(clampJointEuler('lowerLegL', [-1, 0, 0])[0]).toBeCloseTo(minX, 6)
    expect(clampJointEuler('lowerLegL', [999, 0, 0])[0]).toBeCloseTo(maxX, 6)
  })

  it('锁定轴恒归 0（含 clamp=false）', () => {
    // lowerLegL 的 Y/Z 为 null
    expect(clampJointEuler('lowerLegL', [1, 5, 9])).toEqual([
      clampJointEuler('lowerLegL', [1, 5, 9])[0],
      0,
      0,
    ])
    // Alt 突破仍归零锁定轴
    const alt = clampJointEuler('lowerLegL', [999, 5, 9], { clamp: false })
    expect(alt[0]).toBe(999)
    expect(alt[1]).toBe(0)
    expect(alt[2]).toBe(0)
  })

  it('clamp=false 时非锁定轴直通（Alt 突破）', () => {
    const out = clampJointEuler('hips', [10, -10, 10], { clamp: false })
    expect(out).toEqual([10, -10, 10])
  })
})

describe('mirrorPose', () => {
  it('L/R 互换 + y/z 取反；中线关节不换只翻转；curl 不翻转', () => {
    const joints: Record<string, Vec3> = {
      upperArmL: [0.1, 0.2, 0.3],
      chest: [0.1, 0.2, 0.3],
      fingersL: [1.2, 0.1, 0],
    }
    const m = mirrorPose(joints)
    expect(m.upperArmR).toEqual([0.1, -0.2, -0.3])
    expect(m.upperArmL).toBeUndefined()
    // 中线关节保持自身、只翻转
    expect(m.chest).toEqual([0.1, -0.2, -0.3])
    // curl 类互换不翻转
    expect(m.fingersR).toEqual([1.2, 0.1, 0])
  })

  it('镜像两次 = 原姿势', () => {
    const joints: Record<string, Vec3> = {
      upperArmL: [0.1, 0.2, 0.3],
      upperLegR: [-0.4, 0.5, -0.6],
      head: [0.1, 0.2, 0.3],
      thumbL: [0.9, 0.2, 0],
    }
    const twice = mirrorPose(mirrorPose(joints))
    for (const [k, v] of Object.entries(joints)) {
      expect(twice[k]).toEqual(v)
    }
  })
})

describe('copySidePose', () => {
  it('把 L 侧镜像拷到 R 侧，中线关节不动', () => {
    const joints: Record<string, Vec3> = {
      upperArmL: [0.1, 0.2, 0.3],
      upperArmR: [9, 9, 9],
      chest: [0.5, 0, 0],
    }
    const out = copySidePose(joints, 'L')
    expect(out.upperArmL).toEqual([0.1, 0.2, 0.3])
    expect(out.upperArmR).toEqual([0.1, -0.2, -0.3])
    expect(out.chest).toEqual([0.5, 0, 0])
  })
})

describe('composePose', () => {
  it('合成 = 预设 + 覆盖逐关节相加', () => {
    // stand 预设：upperArmL=[0,0,d(-12)], upperArmR=[0,0,d(12)]（∓12° 外展，见 mannequin.ts）
    const base = getPose('stand')
    const composed = composePose('stand', { upperArmL: [0.1, 0, 0], head: [0.2, 0, 0] })
    expect(composed.upperArmL).toEqual([
      0.1 + base.upperArmL![0],
      base.upperArmL![1],
      base.upperArmL![2],
    ])
    // 预设未含的关节直接取覆盖值
    expect(composed.head).toEqual([0.2, 0, 0])
    // 无覆盖时等于预设本身
    const noOv = composePose('stand')
    expect(noOv.upperArmR).toEqual(base.upperArmR)
  })

  it('未知预设 + 覆盖 = 纯覆盖', () => {
    expect(composePose('no-such', { head: [1, 2, 3] })).toEqual({ head: [1, 2, 3] })
  })
})

describe('poseEditorMath', () => {
  it('全屏姿势编辑从 mannequin stand 预设反推覆盖量，避免重复常量漂移', () => {
    const base = getPose('stand').upperArmL!
    expect(poseEditorOverrideFromFinalEuler('upperArmL', base)).toEqual([0, 0, 0])
    expect(poseEditorOverrideFromFinalEuler('head', [0.2, 0.1, -0.1])).toEqual([0.2, 0.1, -0.1])
  })

  it('把最终姿势快照转换为 stand 覆盖，渲染后不重复叠加站姿基准', () => {
    const finalPose = composePose('walk')
    const overrides = poseEditorOverridesFromFinalPose(finalPose)
    const rendered = composePose('stand', overrides)
    const jointIds = new Set([...Object.keys(getPose('stand')), ...Object.keys(finalPose)])

    for (const jointId of jointIds) {
      expect(rendered[jointId] ?? [0, 0, 0]).toEqual(finalPose[jointId] ?? [0, 0, 0])
    }
    const standElbow = getPose('stand').lowerArmL!
    expect(overrides.lowerArmL?.[0]).toBeCloseTo(-standElbow[0], 6)
    expect(overrides.lowerArmL?.[1]).toBeCloseTo(-standElbow[1], 6)
    expect(overrides.lowerArmL?.[2]).toBeCloseTo(-standElbow[2], 6)
  })
})

describe('mannequin 武打预设', () => {
  it('新增 5 个武打预设并带 group 字段', () => {
    for (const p of POSE_PRESETS) {
      expect(p.group === '基础' || p.group === '武打', `${p.id} 缺少合法 group`).toBe(true)
    }
    const martial = POSE_PRESETS.filter((p) => p.group === '武打').map((p) => p.id)
    for (const id of ['punch', 'kick', 'block', 'horse-stance', 'flying-kick']) {
      expect(martial).toContain(id)
    }
    // 出拳应利用四指握拳
    const punch = POSE_PRESETS.find((p) => p.id === 'punch')!
    expect(punch.pose.fingersR).toBeTruthy()
  })
})

// ─────────────────────────── 两骨解析 IK（poseIk） ───────────────────────────

describe('solveTwoBoneIK', () => {
  // 手臂链：上段 0.29 / 下段 0.25，肘弯曲轴 X 负向
  const armChain: IkChain = {
    upperLen: 0.29,
    lowerLen: 0.25,
    upperJointId: 'upperArmL',
    lowerJointId: 'lowerArmL',
    bendSign: -1,
  }
  // 腿链：上段 0.45 / 下段 0.42，膝弯曲轴 X 正向
  const legChain: IkChain = {
    upperLen: 0.45,
    lowerLen: 0.42,
    upperJointId: 'upperLegL',
    lowerJointId: 'lowerLegL',
    bendSign: 1,
  }

  it('可达目标：正向 FK 复算末端位置误差 < 1e-3', () => {
    const targets: [number, number, number][] = [
      [0.1, -0.3, 0.15],
      [0.0, -0.5, 0.0],
      [0.2, -0.1, 0.3],
      [-0.15, -0.35, 0.05],
    ]
    for (const t of targets) {
      // 精度校验用未钳制解（clampJointEuler 逐轴钳制是独立的解剖限位关注点，
      // 会破坏几何解的整体旋转，故几何精度以 clamp:false 校验）。
      const res = solveTwoBoneIK(armChain, t, undefined, { clamp: false })
      expect(res.reachable).toBe(true)
      const end = ikEndEffectorLocal(armChain, res.upperEuler, res.lowerEuler)
      const err = end.distanceTo(new THREE.Vector3(t[0], t[1], t[2]))
      expect(err).toBeLessThan(1e-3)
    }
  })

  it('手臂肘弯曲为负、腿膝弯曲为正（与预设符号约定一致）', () => {
    const arm = solveTwoBoneIK(armChain, [0.1, -0.3, 0.1])
    expect(arm.lowerEuler[0]).toBeLessThan(0)
    const leg = solveTwoBoneIK(legChain, [0.1, -0.6, 0.2], undefined, { clamp: false })
    expect(leg.lowerEuler[0]).toBeGreaterThan(0)
    // 腿链可达同样满足 FK 复算误差
    const end = ikEndEffectorLocal(legChain, leg.upperEuler, leg.lowerEuler)
    expect(end.distanceTo(new THREE.Vector3(0.1, -0.6, 0.2))).toBeLessThan(1e-3)
  })

  it('不可达（过远）：伸直、末端到达最大伸展并指向目标方向', () => {
    const far: [number, number, number] = [0, -1, 0] // 距离 1 > 0.54 最大伸展
    const res = solveTwoBoneIK(armChain, far)
    expect(res.reachable).toBe(false)
    const end = ikEndEffectorLocal(armChain, res.upperEuler, res.lowerEuler)
    // 伸直：末端长度 ≈ 上段+下段
    expect(end.length()).toBeCloseTo(armChain.upperLen + armChain.lowerLen, 4)
    // 方向对准目标
    const dot = end
      .clone()
      .normalize()
      .dot(new THREE.Vector3(0, -1, 0))
    expect(dot).toBeGreaterThan(0.999)
  })

  it('限位钳制：默认 clamp 后下段角落在软限位内，Alt(clamp=false) 可越界', () => {
    // lowerArmL 软限位 X ∈ [-145°, 0]。构造一个折得很紧的近目标使原始弯曲角超限。
    const near: [number, number, number] = [0, -0.06, 0] // 距离 < |0.29-0.25|=0.04? 否，取略折
    const clamped = solveTwoBoneIK(armChain, near)
    const [minX, maxX] = JOINT_LIMITS.lowerArmL[0]!
    expect(clamped.lowerEuler[0]).toBeGreaterThanOrEqual(minX - 1e-9)
    expect(clamped.lowerEuler[0]).toBeLessThanOrEqual(maxX + 1e-9)
    // Alt 突破：不钳制时可超过下限（更折）
    const free = solveTwoBoneIK(armChain, near, undefined, { clamp: false })
    expect(free.lowerEuler[0]).toBeLessThanOrEqual(clamped.lowerEuler[0] + 1e-9)
  })

  it('poleHint 决定弯曲方向的连续性', () => {
    // 正 hint → 弯曲取正号（即便 bendSign 为 -1）
    const res = solveTwoBoneIK(armChain, [0.1, -0.3, 0.1], 0.5, { clamp: false })
    expect(res.lowerEuler[0]).toBeGreaterThan(0)
  })
})

// ─────────────────────────── prompt 生成 ───────────────────────────

describe('buildStage3DPrompt', () => {
  function sampleData(): Stage3DData {
    const actor = {
      ...makeStage3DActor(0),
      name: '林小满',
      bodyType: 'slim' as const,
      pose: 'sit',
      position: [2, 0, 0] as [number, number, number],
      rotationY: 0,
      note: '手捧咖啡',
    }
    return {
      version: 1,
      backdrop: { mode: 'backdrop', imageUrl: 'https://x/p.jpg' },
      sceneScale: 1.35,
      actors: [actor],
      props: [{ ...makeGlbProp(GLB_ASSETS[0]!, 0), name: '单人床1' }],
      camera: { position: [0, 3.2, 4.5], target: [0, 1, 0], fov: 40, aspect: '16:9' },
      sceneBrief: '清晨的卧室',
    }
  }

  it('包含场景 / 角色（体型、姿势、朝向、站位）/ 道具 / 背景 / 相机要素', () => {
    const prompt = buildStage3DPrompt(sampleData())
    expect(prompt).toContain('场景：清晨的卧室')
    expect(prompt).toContain('远景背板')
    expect(prompt).toContain('布景：整体布景缩放 1.35x')
    expect(prompt).toContain('林小满')
    expect(prompt).toContain('瘦高体型')
    expect(prompt).toContain('坐姿势')
    expect(prompt).toContain('画面右侧')
    expect(prompt).toContain('面向镜头')
    expect(prompt).toContain('手捧咖啡')
    expect(prompt).toContain('道具陈设：')
    expect(prompt).toContain('单人床1：位于林小满')
    expect(prompt).toContain('mm 等效焦段')
    expect(prompt).toContain('16:9 画幅')
    // 相机高 3.2 > 目标高 1 → 俯视
    expect(prompt).toContain('俯视')
    expect(prompt).toContain('到主体水平距离约')
    expect(prompt).toContain('单主体')
  })

  it('全景背景与群众阵列写入提示词', () => {
    const data = sampleData()
    data.backdrop = { mode: 'panorama', imageUrl: 'safe-file://pano.jpg', rotationY: 0.4 }
    data.actors = [
      { ...data.actors[0]!, crowdId: 'crowd_1', crowdLabel: '群众（2x2）' },
      { ...makeStage3DActor(1), name: '群演02', crowdId: 'crowd_1', crowdLabel: '群众（2x2）' },
    ]
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toContain('360° 全景图作为沉浸式环境背景')
    expect(prompt).toContain('群众阵列：群众（2x2），共 2 人')
  })

  it('有逐关节覆盖时输出「自定义姿势（基于 X 预设微调）」', () => {
    const data = sampleData()
    data.actors = [{ ...data.actors[0]!, pose: 'punch', joints: { upperArmR: [0.1, 0, 0] } }]
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toContain('自定义姿势（基于出拳预设微调）')
    // 无覆盖时仍是常规「X姿势」
    const plain = sampleData()
    plain.actors = [{ ...plain.actors[0]!, pose: 'punch', joints: undefined }]
    expect(buildStage3DPrompt(plain)).toContain('出拳姿势')
  })

  it('写入场记板抬头（场次·镜号·Take）与灯光行', () => {
    const data: Stage3DData = {
      ...sampleData(),
      slate: { scene: '3', shotNumber: '3A', take: '2', note: '情绪高点' },
      lighting: { preset: 'rim', intensity: 1.5 },
    }
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toContain('场次 3 · 镜号 3A · Take 2')
    expect(prompt).toContain('场记备注：情绪高点')
    expect(prompt).toContain('灯光：轮廓光（强度 1.5）')
  })

  it('lighting=none 不输出灯光行', () => {
    const data: Stage3DData = { ...sampleData(), lighting: { preset: 'none', intensity: 1 } }
    expect(buildStage3DPrompt(data)).not.toContain('灯光：')
  })

  it('cameraOverride 覆盖机位：仰视 vs 默认俯视', () => {
    const data = sampleData() // 默认相机高 3.2 > 目标 1 → 俯视
    expect(buildStage3DPrompt(data)).toContain('俯视')
    const lowCam: Stage3DCamera = {
      position: [0, 0.3, 4.5],
      target: [0, 1.5, 0],
      fov: 40,
      aspect: '16:9',
    }
    expect(buildStage3DPrompt(data, lowCam)).toContain('仰视')
  })

  it('背对镜头与多主体构图描述', () => {
    const data = sampleData()
    data.actors = [
      { ...data.actors[0]!, rotationY: Math.PI },
      { ...makeStage3DActor(1), position: [-2, 0, -3] },
    ]
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toContain('背对镜头')
    expect(prompt).toContain('多主体')
  })

  it('多角色时追加相对第一个角色的方位关系', () => {
    const data = sampleData()
    const first = data.actors[0]!
    data.actors = [first, { ...makeStage3DActor(1), name: '角色B', position: [4, 0, -2] }]
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toMatch(
      /角色B位于林小满(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/,
    )
  })

  it('道具定位：相对最近角色的方位 + 距离', () => {
    const data = sampleData() // 角色在 [2,0,0]，道具用默认 makeGlbProp 位置
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toMatch(
      /单人床1：位于林小满(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/,
    )
  })

  it('道具超过 6 个时按锚点归纳分组，避免逐条列举', () => {
    const data = sampleData()
    data.props = Array.from({ length: 8 }, (_, i) => ({
      ...makeGlbProp(GLB_ASSETS[0]!, i),
      name: `道具${i + 1}`,
      position: [2 + i * 0.1, 0, 0] as [number, number, number],
    }))
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toContain('道具陈设：')
    expect(prompt).toContain('林小满附近')
    expect(prompt).toContain('道具1')
    expect(prompt).toContain('道具8')
    // 归纳后不应逐条出现「道具N：位于...」这种单条格式
    expect(prompt).not.toContain('道具1：位于')
  })

  it('无角色时道具相对场景原点定位', () => {
    const data = sampleData()
    data.actors = []
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toMatch(
      /单人床1：位于场景原点(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/,
    )
  })
})

// ─────────────────────────── GLB 资产注册表 ───────────────────────────

describe('MixamoActorRig', () => {
  it('默认根节点朝向不额外反转，保持与 rotationY 和提示词语义一致', () => {
    const actor = makeStage3DActor(0, { rotationY: 0, heightScale: 1.2, bodyType: 'standard' })
    const transform = getMixamoRootTransform(actor)
    expect(transform.rotationY).toBe(0)
    expect(transform.scale).toEqual([0.012, 0.012, 0.012])
  })

  it('不同体型在 Mixamo 实体人偶上有明显可见的宽高差异', () => {
    const slim = getMixamoRootTransform(makeStage3DActor(0, { bodyType: 'slim' })).scale
    const muscular = getMixamoRootTransform(makeStage3DActor(0, { bodyType: 'muscular' })).scale
    const heavy = getMixamoRootTransform(makeStage3DActor(0, { bodyType: 'heavy' })).scale
    const tall = getMixamoRootTransform(makeStage3DActor(0, { bodyType: 'tall' })).scale
    const child = getMixamoRootTransform(makeStage3DActor(0, { bodyType: 'child' })).scale

    expect(slim[0]).toBeLessThanOrEqual(0.0078)
    expect(muscular[0]).toBeGreaterThanOrEqual(0.0118)
    expect(heavy[0]).toBeGreaterThanOrEqual(0.013)
    expect(tall[1]).toBeGreaterThanOrEqual(0.0125)
    expect(child[1]).toBeLessThanOrEqual(0.0068)
  })
})

describe('rotationYFromQuaternion', () => {
  it('跨过 90° 时仍返回真实 yaw，而不是欧拉角重排后的 45°', () => {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, (3 * Math.PI) / 4, 0, 'XYZ'),
    )
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
    expect(euler.y).toBeCloseTo(Math.PI / 4, 6)
    expect(rotationYFromQuaternion(quaternion)).toBeCloseTo((3 * Math.PI) / 4, 6)
  })
})

describe('propRegistry GLB_ASSETS', () => {
  it('注册了 Kenney 家具精选子集且条目 id 唯一', () => {
    expect(GLB_ASSETS.length).toBeGreaterThanOrEqual(30)
    const ids = GLB_ASSETS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个条目 url 非空、label 非空、类别合法', () => {
    const categories = new Set(Object.keys(GLB_CATEGORY_LABEL))
    for (const asset of GLB_ASSETS) {
      expect(asset.url, `${asset.id} 缺少可加载 url（资产文件可能未拷入）`).toBeTruthy()
      expect(asset.url.endsWith('.glb'), `${asset.id} url 应指向 .glb`).toBe(true)
      expect(asset.label.length).toBeGreaterThan(0)
      expect(categories.has(asset.category)).toBe(true)
      expect(asset.defaultScale ?? 1).toBeGreaterThan(0)
    }
  })

  it('覆盖床/桌/椅/柜/沙发/浴室/杂项全部类别，展示顺序完整', () => {
    const used = new Set(GLB_ASSETS.map((a) => a.category))
    for (const category of GLB_CATEGORY_ORDER) {
      expect(used.has(category), `类别 ${category} 没有任何家具`).toBe(true)
    }
    expect(new Set(GLB_CATEGORY_ORDER).size).toBe(Object.keys(GLB_CATEGORY_LABEL).length)
  })

  it('findGlbAsset / makeGlbProp / makePrimitiveProp 行为正确', () => {
    const first = GLB_ASSETS[0]!
    expect(findGlbAsset(first.id)).toBe(first)
    expect(findGlbAsset('no-such-asset')).toBeUndefined()

    const glbProp = makeGlbProp(first, 2)
    expect(glbProp.kind).toBe('glb')
    expect(glbProp.assetId).toBe(first.id)
    expect(glbProp.name).toBe(`${first.label}3`)
    expect(glbProp.scale).toBe(first.defaultScale ?? 1)
    expect(glbProp.position[1]).toBe(0) // 家具贴地

    const primitive = makePrimitiveProp('cylinder', 0)
    expect(primitive.kind).toBe('primitive')
    expect(primitive.assetId).toBe('cylinder')
    expect(primitive.color).toBeTruthy()
  })

  it('基础几何体支持 cone / torus / pyramid', () => {
    expect(makePrimitiveProp('cone', 0).assetId).toBe('cone')
    expect(makePrimitiveProp('torus', 1).assetId).toBe('torus')
    expect(makePrimitiveProp('pyramid', 2).assetId).toBe('pyramid')
  })
})

describe('localModelImport', () => {
  it('按扩展名识别 FBX / OBJ / GLB，其他文件返回 null', () => {
    expect(inferStage3DLocalModelFormat('actor.FBX')).toBe('fbx')
    expect(inferStage3DLocalModelFormat('prop.obj')).toBe('obj')
    expect(inferStage3DLocalModelFormat('scene.glb')).toBe('glb')
    expect(inferStage3DLocalModelFormat('scene.gltf')).toBeNull()
    expect(inferStage3DLocalModelFormat('texture.png')).toBeNull()
  })

  it('把 data URL 转为 runtime object URL 供 three loaders 读取，且不依赖 fetch(data:)', async () => {
    const originalCreateObjectUrl = URL.createObjectURL
    const originalRevokeObjectUrl = URL.revokeObjectURL
    const originalFetch = globalThis.fetch
    const created: Blob[] = []
    const revoked: string[] = []
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob)
      return `blob:stage3d-${created.length}`
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url)
    }) as typeof URL.revokeObjectURL
    globalThis.fetch = (() => {
      throw new Error('fetch(data:) should not be used')
    }) as typeof fetch

    try {
      const runtime = await createStage3DLocalModelRuntimeUrl(
        'data:model/gltf-binary;base64,AAECAw==',
      )
      expect(runtime.url).toBe('blob:stage3d-1')
      expect(created[0]?.size).toBe(4)
      runtime.revoke?.()
      expect(revoked).toEqual(['blob:stage3d-1'])
    } finally {
      URL.createObjectURL = originalCreateObjectUrl
      URL.revokeObjectURL = originalRevokeObjectUrl
      globalThis.fetch = originalFetch
    }
  })

  it('非 data URL 保持原样，不创建 runtime object URL', async () => {
    const runtime = await createStage3DLocalModelRuntimeUrl('safe-file://model.glb')
    expect(runtime).toEqual({ url: 'safe-file://model.glb' })
  })
})

// ─────────────────────────── 自定义姿势库（poseLibrary） ───────────────────────────

/** 内存版 localStorage，等价 window.localStorage 形状，供 poseLibrary 注入。 */
function makeMemoryStorage(initial: Record<string, string> = {}): PoseStorage {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
  }
}

describe('poseLibrary', () => {
  it('空仓：loadSavedPoses 返回空数组（storage=空 / storage=null 均安全）', () => {
    expect(loadSavedPoses(makeMemoryStorage())).toEqual([])
    expect(loadSavedPoses(null)).toEqual([])
    // undefined 走 defaultStorage() 路径：测试环境无 window.localStorage，应返回空数组
    expect(loadSavedPoses(undefined)).toEqual([])
  })

  it('正常 round-trip：savePose 后能 loadSavedPoses 取回', () => {
    const s = makeMemoryStorage()
    const r = savePose('挥手', 'stand', { head: [0.1, 0, 0] }, s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pose.name).toBe('挥手')
    expect(r.pose.joints.head).toEqual([0.1, 0, 0])
    const list = loadSavedPoses(s)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(r.pose.id)
    expect(list[0]?.name).toBe('挥手')
  })

  it('脏数据容错：非法项被 sanitizeOne 丢弃，合法项保留', () => {
    const raw = JSON.stringify([
      { id: 'p1', name: '站', joints: { head: [0, 0, 0] }, createdAt: 1 },
      null,
      'junk',
      { id: '', name: '坏id', joints: {} }, // id 空
      { id: 'p2', name: '坏joints', joints: 'not-object' }, // joints 非对象
      { id: 'p3', name: '好joints', joints: { ok: [1, 2, 3], bad: [1, 2] } }, // 部分 euler 非法被丢
      { id: 'p4', name: '坏createdAt', joints: {}, createdAt: 'not-a-number' }, // createdAt 兜底
    ])
    const s = makeMemoryStorage({ [SAVED_POSES_KEY]: raw })
    const list = loadSavedPoses(s)
    expect(list.map((p) => p.id)).toEqual(['p1', 'p3', 'p4'])
    expect(list.find((p) => p.id === 'p3')?.joints).toEqual({ ok: [1, 2, 3] })
    expect(Number.isFinite(list.find((p) => p.id === 'p4')!.createdAt)).toBe(true)
  })

  it('savePose 上限保护：达到 SAVED_POSES_LIMIT 时拒绝新增', () => {
    const s = makeMemoryStorage()
    // 先填满到上限
    for (let i = 0; i < SAVED_POSES_LIMIT; i++) {
      const r = savePose(`姿势${i}`, 'stand', undefined, s)
      expect(r.ok).toBe(true)
    }
    expect(loadSavedPoses(s)).toHaveLength(SAVED_POSES_LIMIT)
    // 再存一个：必须失败
    const r = savePose('超限', 'stand', undefined, s)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('上限')
    // 数量未增长
    expect(loadSavedPoses(s)).toHaveLength(SAVED_POSES_LIMIT)
  })

  it('savePose 空名拒绝', () => {
    const s = makeMemoryStorage()
    const r = savePose('   ', 'stand', undefined, s)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('空')
  })

  it('savePose 把预设+覆盖合成为完整快照（composePose 语义）', () => {
    const s = makeMemoryStorage()
    const base = getPose('stand')
    const r = savePose('挥手', 'stand', { upperArmL: [0.1, 0, 0] }, s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 上臂L = 预设值 + 0.1
    const expected = (base.upperArmL ?? [0, 0, 0])[0] + 0.1
    expect(r.pose.joints.upperArmL![0]).toBeCloseTo(expected, 6)
  })

  it('deleteSavedPose 命中删除、未命中返回 false', () => {
    const s = makeMemoryStorage()
    const r = savePose('挥手', 'stand', undefined, s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const id = r.pose.id
    expect(loadSavedPoses(s)).toHaveLength(1)
    expect(deleteSavedPose(id, s)).toBe(true)
    expect(loadSavedPoses(s)).toHaveLength(0)
    // 再删一次：id 不存在，返回 false（不抛）
    expect(deleteSavedPose(id, s)).toBe(false)
  })

  it('renameSavedPose 命中改名、未命中返回 false、空名返回 false', () => {
    const s = makeMemoryStorage()
    const r = savePose('老名字', 'stand', undefined, s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const id = r.pose.id
    // 空名拒绝
    expect(renameSavedPose(id, '   ', s)).toBe(false)
    // 未命中
    expect(renameSavedPose('no-such', '新名字', s)).toBe(false)
    // 命中改名
    expect(renameSavedPose(id, '新名字', s)).toBe(true)
    const list = loadSavedPoses(s)
    expect(list.find((p) => p.id === id)?.name).toBe('新名字')
    // 其它字段不变
    expect(list.find((p) => p.id === id)?.joints).toEqual(r.pose.joints)
  })

  // ─────────── R2b 接入不变量：保存的快照套用回去 ≡ 合成姿势 ───────────
  // PoseEditorModal 套用路径：SavedPose.joints 是合成后的完整快照（savePose 内部调
  // composePose），套用时整体替换 undo.joints，pose 保持 stand。这里锁住「套用后等于
  // 当初保存时的合成姿势」这一不变量，防止有人改 savePose 把覆盖语义混进快照。
  it('R2b 套用不变量：保存后再套用，joints ≡ composePose 结果', () => {
    const s = makeMemoryStorage()
    const overrides: Record<string, Vec3> = {
      head: [0.1, 0, 0],
      upperArmL: [0, 0, 0.2],
    }
    const composed = composePose('stand', overrides)
    const r = savePose('挥手', 'stand', overrides, s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 快照里就是合成姿势
    expect(r.pose.joints).toEqual(composed)
    // 套用到全屏编辑：SavedPose.joints 是最终快照，需转换为 stand 覆盖后再渲染。
    const applied = poseEditorOverridesFromFinalPose(r.pose.joints)
    const rendered = composePose('stand', applied)
    const jointIds = new Set([...Object.keys(getPose('stand')), ...Object.keys(composed)])
    for (const jointId of jointIds) {
      expect(rendered[jointId] ?? [0, 0, 0]).toEqual(composed[jointId] ?? [0, 0, 0])
    }
  })
})

// ─────────────────────────── 姿势编辑 undo/redo 栈契约 ───────────────────────────
//
// 说明：CanvasDirectorStage3DModal 内的 pushPoseUndo/undoPose/redoPose 是
// useCallback，依赖 React state/ref（undoStackRef/redoStackRef），无法直接单测。
// 这里用普通 JS 数组复刻这套栈逻辑，按其公开契约（pushPoseUndo：入 undo + 清空 redo +
// 上限 50 截断；undoPose/redoPose 互逆）写等价断言。若 Modal 内实现偏离这些契约，
// 对应的 UI 行为（按钮 disabled、Cmd+Z 还原）会出错——这套断言锁定语义不变量。

type PoseSnapshotLite = { pose: string; joints: Record<string, Vec3> | undefined }
type PoseUndoEntryLite = { actorId: string; before: PoseSnapshotLite; after: PoseSnapshotLite }
const UNDO_LIMIT = 50

/** 复刻 pushPoseUndo 契约：push undo + 清空 redo + 超限截断最早一条。 */
function pushUndoLike(
  undo: PoseUndoEntryLite[],
  redo: PoseUndoEntryLite[],
  entry: PoseUndoEntryLite,
): { undo: PoseUndoEntryLite[]; redo: PoseUndoEntryLite[] } {
  const next = [...undo, entry]
  if (next.length > UNDO_LIMIT) next.shift()
  return { undo: next, redo: [] }
}

/** 复刻 undoPose 契约：undo 出栈、redo 入栈；返回新栈 + 还原到的快照。 */
function undoLike(
  undo: PoseUndoEntryLite[],
  redo: PoseUndoEntryLite[],
): { undo: PoseUndoEntryLite[]; redo: PoseUndoEntryLite[]; restored?: PoseSnapshotLite } {
  if (undo.length === 0) return { undo, redo }
  const entry = undo[undo.length - 1]!
  return {
    undo: undo.slice(0, -1),
    redo: [...redo, entry],
    restored: entry.before,
  }
}

/** 复刻 redoPose 契约：redo 出栈、undo 入栈；返回新栈 + 推进到的快照。 */
function redoLike(
  undo: PoseUndoEntryLite[],
  redo: PoseUndoEntryLite[],
): { undo: PoseUndoEntryLite[]; redo: PoseUndoEntryLite[]; advanced?: PoseSnapshotLite } {
  if (redo.length === 0) return { undo, redo }
  const entry = redo[redo.length - 1]!
  return {
    undo: [...undo, entry],
    redo: redo.slice(0, -1),
    advanced: entry.after,
  }
}

describe('姿势编辑 undo/redo 栈契约（等价复刻验证）', () => {
  it('pushPoseUndo：新动作入 undo 栈并清空 redo 栈', () => {
    const undo: PoseUndoEntryLite[] = []
    const redo: PoseUndoEntryLite[] = [
      /* 模拟之前 undo 过 */
    ]
    const entry: PoseUndoEntryLite = {
      actorId: 'a1',
      before: { pose: 'stand', joints: undefined },
      after: { pose: 'stand', joints: { head: [0.1, 0, 0] } },
    }
    const next = pushUndoLike(undo, redo, entry)
    expect(next.undo).toHaveLength(1)
    expect(next.redo).toHaveLength(0) // redo 被清空
  })

  it('pushPoseUndo：超过上限 50 时丢弃最早一条（FIFO 截断）', () => {
    let undo: PoseUndoEntryLite[] = []
    let redo: PoseUndoEntryLite[] = []
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      const r = pushUndoLike(undo, redo, {
        actorId: `a${i}`,
        before: { pose: 'stand', joints: undefined },
        after: { pose: 'stand', joints: { head: [i, 0, 0] } },
      })
      undo = r.undo
      redo = r.redo
    }
    expect(undo).toHaveLength(UNDO_LIMIT)
    // 最早 5 条已被丢弃，最新保留：最后一条 after.head[0] === UNDO_LIMIT+4
    expect(undo[undo.length - 1]!.after.joints!.head![0]).toBe(UNDO_LIMIT + 4)
    // 最早保留的是 i=5 那条
    expect(undo[0]!.actorId).toBe('a5')
  })

  it('undoPose/redoPose 互逆：undo 后立即 redo 回到原状态', () => {
    const beforeSnap: PoseSnapshotLite = { pose: 'stand', joints: undefined }
    const afterSnap: PoseSnapshotLite = { pose: 'walk', joints: { head: [0.1, 0, 0] } }
    const entry: PoseUndoEntryLite = { actorId: 'a1', before: beforeSnap, after: afterSnap }
    let undo: PoseUndoEntryLite[] = [entry]
    let redo: PoseUndoEntryLite[] = []
    // undo：还原到 before
    const u = undoLike(undo, redo)
    undo = u.undo
    redo = u.redo
    expect(u.restored).toEqual(beforeSnap)
    expect(undo).toHaveLength(0)
    expect(redo).toHaveLength(1)
    // redo：推进到 after
    const r = redoLike(undo, redo)
    undo = r.undo
    redo = r.redo
    expect(r.advanced).toEqual(afterSnap)
    expect(undo).toHaveLength(1)
    expect(redo).toHaveLength(0)
  })

  it('多次 undo 全程可还原：栈清空后 undo 不抛', () => {
    const e1: PoseUndoEntryLite = {
      actorId: 'a1',
      before: { pose: 'stand', joints: undefined },
      after: { pose: 'walk', joints: undefined },
    }
    const e2: PoseUndoEntryLite = {
      actorId: 'a1',
      before: { pose: 'walk', joints: undefined },
      after: { pose: 'run', joints: undefined },
    }
    let undo: PoseUndoEntryLite[] = [e1, e2]
    let redo: PoseUndoEntryLite[] = []
    const u1 = undoLike(undo, redo)
    undo = u1.undo
    redo = u1.redo
    expect(u1.restored?.pose).toBe('walk')
    const u2 = undoLike(undo, redo)
    undo = u2.undo
    redo = u2.redo
    expect(u2.restored?.pose).toBe('stand')
    // 栈空再 undo：no-op，不抛
    const u3 = undoLike(undo, redo)
    expect(u3.restored).toBeUndefined()
    expect(u3.undo).toHaveLength(0)
  })

  it('新动作截断 redo 分支：undo 后再编辑，原 redo 不再可达', () => {
    const e1: PoseUndoEntryLite = {
      actorId: 'a1',
      before: { pose: 'stand', joints: undefined },
      after: { pose: 'walk', joints: undefined },
    }
    let undo: PoseUndoEntryLite[] = [e1]
    let redo: PoseUndoEntryLite[] = []
    // undo 一次：redo 入栈一条
    const u = undoLike(undo, redo)
    undo = u.undo
    redo = u.redo
    expect(redo).toHaveLength(1)
    // 编辑新动作：redo 必须被清空
    const e2: PoseUndoEntryLite = {
      actorId: 'a1',
      before: { pose: 'walk', joints: undefined },
      after: { pose: 'run', joints: undefined },
    }
    const next = pushUndoLike(undo, redo, e2)
    expect(next.redo).toHaveLength(0)
    expect(next.undo).toHaveLength(1)
  })
})

// ─────────────────────────── MannequinRig 肢段几何 sanity ───────────────────────────

describe('MannequinRig 肢段 LatheGeometry 几何 sanity', () => {
  it('所有肢段轮廓点半径非负、位置比例递增、数值有限', () => {
    for (const [key, profile] of Object.entries(LIMB_PROFILES)) {
      expect(profile.length).toBeGreaterThanOrEqual(6)
      expect(profile.length).toBeLessThanOrEqual(12)
      let prevY = -Infinity
      for (const [rf, yf] of profile) {
        expect(Number.isFinite(rf)).toBe(true)
        expect(Number.isFinite(yf)).toBe(true)
        expect(rf).toBeGreaterThanOrEqual(0)
        expect(yf).toBeGreaterThanOrEqual(0)
        expect(yf).toBeLessThanOrEqual(1)
        // 位置比例单调不减，保证 Lathe 轮廓沿轴不回折
        expect(yf).toBeGreaterThanOrEqual(prevY)
        prevY = yf
      }
      expect(key.length).toBeGreaterThan(0)
    }
  })

  it('limbGeometry 生成的顶点全为有限值、半径非负，且同参数缓存复用同一实例', () => {
    for (const key of Object.keys(LIMB_PROFILES) as (keyof typeof LIMB_PROFILES)[]) {
      const g1 = limbGeometry(key, 0.3, 0.05)
      const pos = g1.getAttribute('position') as THREE.BufferAttribute
      expect(pos.count).toBeGreaterThan(0)
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const y = pos.getY(i)
        const z = pos.getZ(i)
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
        expect(Number.isFinite(z)).toBe(true)
        // Lathe 绕 Y 轴，径向距离即半径，必非负（浮点容差）
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(-1e-6)
      }
      // 同尺寸参数命中缓存，返回同一 geometry 实例
      const g2 = limbGeometry(key, 0.3, 0.05)
      expect(g2).toBe(g1)
    }
  })
})

// ─────────────────────────── stand 姿势手-大腿净距（FK 粗算） ───────────────────────────

describe('stand 姿势下手与大腿不相交（全体型 FK 粗算）', () => {
  /** 用 THREE.Object3D 复刻 MannequinRig 臂链层级，返回给定局部点的世界坐标。 */
  function armPointWorld(
    m: (typeof BODY_METRICS)['standard'],
    pose: Record<string, Vec3>,
    side: 'L' | 'R',
    localInHand: THREE.Vector3,
  ): THREE.Vector3 {
    const sgn = side === 'L' ? -1 : 1
    const rot = (id: string): Vec3 => (pose[id] ?? [0, 0, 0]) as Vec3
    const mk = (pos: [number, number, number], r: Vec3): THREE.Group => {
      const g = new THREE.Group()
      g.position.set(pos[0], pos[1], pos[2])
      g.rotation.set(r[0], r[1], r[2])
      return g
    }
    const hips = mk([0, m.hipHeight, 0], rot('hips'))
    const spine = mk([0, 0, 0], rot('spine'))
    const chest = mk([0, m.spineLen, 0], rot('chest'))
    const shoulder = mk([sgn * m.shoulderWidth, m.chestLen * 0.82, 0], rot(`shoulder${side}`))
    const upperArm = mk([0, 0, 0], rot(`upperArm${side}`))
    const lowerArm = mk([0, -m.upperArmLen, 0], rot(`lowerArm${side}`))
    const hand = mk([0, -m.lowerArmLen, 0], rot(`hand${side}`))
    hips.add(spine)
    spine.add(chest)
    chest.add(shoulder)
    shoulder.add(upperArm)
    upperArm.add(lowerArm)
    lowerArm.add(hand)
    hips.updateMatrixWorld(true)
    return hand.localToWorld(localInHand.clone())
  }

  /** 点到竖直大腿轴线段（髋关节→膝）的最短距离。 */
  function distToThighAxis(
    p: THREE.Vector3,
    m: (typeof BODY_METRICS)['standard'],
    side: 'L' | 'R',
  ): number {
    const sgn = side === 'L' ? -1 : 1
    const top = new THREE.Vector3(sgn * m.hipWidth, m.hipHeight - 0.02, 0)
    const bottom = top.clone().setY(top.y - m.upperLegLen) // stand 无腿部旋转，大腿竖直向下
    const seg = new THREE.Line3(top, bottom)
    const closest = new THREE.Vector3()
    seg.closestPointToPoint(p, true, closest)
    return p.distanceTo(closest)
  }

  it('六种体型：腕与掌心到大腿轴距离 ≥ 大腿最大半径 + 手半宽 + 5mm', () => {
    const pose = composePose('stand')
    for (const [bodyType, m] of Object.entries(BODY_METRICS)) {
      // 与 MannequinRig 视觉参数一致：大腿 lathe 最大半径系数 1.35*1.22；掌半宽 = limbRadius*0.85*1.7/2
      const thighMaxR = m.limbRadius * 1.35 * 1.22
      const palmHalfW = (m.limbRadius * 0.85 * 1.7) / 2
      const required = thighMaxR + palmHalfW + 0.005
      for (const side of ['L', 'R'] as const) {
        const palmLen = m.handLen * 0.62
        const wrist = armPointWorld(m, pose, side, new THREE.Vector3(0, 0, 0))
        const palmCenter = armPointWorld(m, pose, side, new THREE.Vector3(0, -palmLen / 2, 0))
        const palmTip = armPointWorld(m, pose, side, new THREE.Vector3(0, -m.handLen, 0))
        for (const p of [wrist, palmCenter, palmTip]) {
          const dist = distToThighAxis(p, m, side)
          expect(
            dist,
            `${bodyType}/${side}: dist=${dist.toFixed(3)} < required=${required.toFixed(3)}`,
          ).toBeGreaterThanOrEqual(required)
        }
      }
    }
  })
})
