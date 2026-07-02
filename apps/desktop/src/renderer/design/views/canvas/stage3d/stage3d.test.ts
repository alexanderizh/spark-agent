import { describe, expect, it } from 'vitest'
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
  POSE_PRESETS,
  getPose,
} from './mannequin'
import { buildStage3DPrompt } from './prompt'
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
    expect(prompt).toContain('道具陈设：单人床1')
    expect(prompt).toContain('mm 等效焦段')
    expect(prompt).toContain('16:9 画幅')
    // 相机高 3.2 > 目标高 1 → 俯视
    expect(prompt).toContain('俯视')
    expect(prompt).toContain('单主体')
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
