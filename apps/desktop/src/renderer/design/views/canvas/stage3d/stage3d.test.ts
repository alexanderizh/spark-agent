import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { CanvasNode } from '../canvas.types'
import {
  createDefaultStage3DData,
  defaultStage3DLighting,
  makeStage3DActor,
  makeStage3DShot,
  readStage3DData,
  serializeStage3DData,
  STAGE3D_BODY_TYPES,
  type Stage3DCamera,
  type Stage3DData,
} from './stage3d.types'
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
import { buildStage3DPrompt } from './prompt'
import { ikEndEffectorLocal, solveTwoBoneIK, type IkChain } from './poseIk'
import {
  GLB_ASSETS,
  GLB_CATEGORY_LABEL,
  GLB_CATEGORY_ORDER,
  findGlbAsset,
  makeGlbProp,
  makePrimitiveProp,
} from './propRegistry'

function fakeNode(stage3d: unknown): CanvasNode {
  return { data: { stage3d } } as unknown as CanvasNode
}

// ─────────────────────────── stage3d.types 序列化 / 宽容解析 ───────────────────────────

describe('stage3d.types', () => {
  it('空节点给出默认场景：1 个角色、grid 背景、16:9 相机', () => {
    const data = readStage3DData(undefined)
    expect(data.version).toBe(1)
    expect(data.actors).toHaveLength(1)
    expect(data.backdrop.mode).toBe('grid')
    expect(data.camera.aspect).toBe('16:9')
    expect(data.activeId).toBe(data.actors[0]?.id)
  })

  it('序列化 → 反序列化 round-trip 保持一致（panorama 暂降级为 grid）', () => {
    const original: Stage3DData = {
      ...createDefaultStage3DData(),
      backdrop: { mode: 'backdrop', imageUrl: 'https://x/pano.jpg', rotationY: 1.2, backdropDistance: 10 },
      props: [makeGlbProp(GLB_ASSETS[0]!, 0), makePrimitiveProp('box', 1)],
      sceneBrief: '黄昏的咖啡馆',
      prompt: '旧提示词',
    }
    const legacySerialized = serializeStage3DData(original)
    ;(legacySerialized.backdrop as Record<string, unknown>).mode = 'panorama'
    const restored = readStage3DData(fakeNode(legacySerialized))
    // 全景入口已暂时隐藏：存过 panorama 的旧数据读取时降级为 grid（imageUrl 保留）
    expect(restored.backdrop.mode).toBe('grid')
    expect(restored.backdrop.imageUrl).toBe('https://x/pano.jpg')
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
        backdrop: { mode: 'wormhole', backdropDistance: 999 },
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
          { id: 's1', name: '开场', shotNumber: '3A', position: [1, 2, 3], target: [0, 1, 0], fov: 40, aspect: '9:16' },
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
    expect(readStage3DData(fakeNode({ version: 1, lighting: { preset: 'x', intensity: 99 } })).lighting).toEqual({
      preset: 'studio',
      intensity: 2,
    })
    expect(readStage3DData(fakeNode({ version: 1, lighting: { preset: 'rim', intensity: 0.1 } })).lighting).toEqual({
      preset: 'rim',
      intensity: 0.5,
    })
  })

  it('slate 全空视作未设置；有值时保留', () => {
    expect(readStage3DData(fakeNode({ version: 1, slate: { scene: '', shotNumber: '', take: '' } })).slate).toBeUndefined()
    const withSlate = readStage3DData(fakeNode({ version: 1, slate: { scene: '3', shotNumber: '3A', take: '2', note: 'ok' } }))
    expect(withSlate.slate).toEqual({ scene: '3', shotNumber: '3A', take: '2', note: 'ok' })
  })

  it('shots/lighting/slate round-trip 一致', () => {
    const original: Stage3DData = {
      ...createDefaultStage3DData(),
      shots: [makeStage3DShot(createDefaultStage3DData().camera, 0, { name: '主镜', shotNumber: '1A' })],
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

// ─────────────────────────── mannequin 姿势与体型表完整性 ───────────────────────────

describe('mannequin', () => {
  it('姿势预设 id 唯一，且覆盖设计文档要求的基础姿势', () => {
    const ids = POSE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const required of ['stand', 'walk', 'run', 'sit', 'point', 'arms-crossed', 'lying', 'kneel']) {
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
    expect(clampJointEuler('lowerLegL', [1, 5, 9])).toEqual([clampJointEuler('lowerLegL', [1, 5, 9])[0], 0, 0])
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
    // stand 预设：upperArmL=[0,0,d(6)], upperArmR=[0,0,d(-6)]
    const base = getPose('stand')
    const composed = composePose('stand', { upperArmL: [0.1, 0, 0], head: [0.2, 0, 0] })
    expect(composed.upperArmL).toEqual([0.1 + base.upperArmL![0], base.upperArmL![1], base.upperArmL![2]])
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
    const dot = end.clone().normalize().dot(new THREE.Vector3(0, -1, 0))
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
    const lowCam: Stage3DCamera = { position: [0, 0.3, 4.5], target: [0, 1.5, 0], fov: 40, aspect: '16:9' }
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
    data.actors = [
      first,
      { ...makeStage3DActor(1), name: '角色B', position: [4, 0, -2] },
    ]
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toMatch(/角色B位于林小满(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/)
  })

  it('道具定位：相对最近角色的方位 + 距离', () => {
    const data = sampleData() // 角色在 [2,0,0]，道具用默认 makeGlbProp 位置
    const prompt = buildStage3DPrompt(data)
    expect(prompt).toMatch(/单人床1：位于林小满(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/)
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
    expect(prompt).toMatch(/单人床1：位于场景原点(正前方|右前方|右侧|右后方|正后方|左后方|左侧|左前方)约 \d+\.\d 米/)
  })
})

// ─────────────────────────── GLB 资产注册表 ───────────────────────────

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
})
