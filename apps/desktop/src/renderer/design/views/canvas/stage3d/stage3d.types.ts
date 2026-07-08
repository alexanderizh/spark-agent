import type { CanvasNode } from '../canvas.types'
import { DEFAULT_STAGE3D_ACTOR_MODEL_ID, getStage3DActorModel, normalizeStage3DActorModelId } from './actorModelRegistry'

/**
 * 真·3D 导演台数据模型（节点 data.stage3d，version 1）。
 *
 * 与 2D 版（data.directorStage）并列、互不影响。所有解析都尽量宽容：
 * 旧/脏数据缺字段时用默认值补齐，坐标/角度做范围钳制。
 */

export type Stage3DBackdropMode = 'grid' | 'panorama' | 'backdrop'

export type Stage3DBackdrop = {
  mode: Stage3DBackdropMode
  /** 背板平面贴图 URL（兼容旧 panorama 数据时也会原样保留） */
  imageUrl?: string | undefined
  /** 背板绕 Y 轴旋转（弧度） */
  rotationY?: number | undefined
  /** backdrop 模式下背板离原点的距离 */
  backdropDistance?: number | undefined
  /** 记录来源图片节点 id（便于回显选择器高亮） */
  sourceNodeId?: string | undefined
}

export type Stage3DBodyType = 'standard' | 'child' | 'slim' | 'muscular' | 'heavy' | 'tall'

export type Stage3DActorModelSource = 'builtin' | 'local'
export type Stage3DActorRigType = 'mixamo' | 'ue4-mannequin' | 'static'
export type Stage3DActorModelId = 'ue4-mannequin' | 'mixamo-mannequin' | (string & {})

export type Stage3DActor = {
  id: string
  name: string
  /** 人偶通体颜色 */
  color: string
  /** 绑定的画布角色板节点 id（无则为路人） */
  boundNodeId?: string | undefined
  /** 群众阵列 id；同一 crowdId 的 actor 可被整组选中与变换 */
  crowdId?: string | undefined
  crowdLabel?: string | undefined
  /** 角色模型选择：默认 Mixamo，本地模型先以 static 呈现 */
  modelId?: Stage3DActorModelId | undefined
  modelSource?: Stage3DActorModelSource | undefined
  rigType?: Stage3DActorRigType | undefined
  bodyType: Stage3DBodyType
  /** 整体身高缩放 0.5–1.5 */
  heightScale: number
  /** 世界坐标 [x,y,z]，y 通常为 0（站地面） */
  position: [number, number, number]
  /** 朝向（绕 Y 轴弧度） */
  rotationY: number
  /** 姿势预设 id：stand/walk/run/sit/point/arms-crossed/lying/kneel */
  pose: string
  /** 逐关节欧拉角覆盖（叠加在姿势预设之上） */
  joints?: Record<string, [number, number, number]> | undefined
  note?: string | undefined
}

export type Stage3DPropKind = 'glb' | 'primitive' | 'local-model'

export type Stage3DProp = {
  id: string
  kind: Stage3DPropKind
  /** glb: 资产注册表 id；primitive: box/cylinder/sphere/plane */
  assetId: string
  name: string
  position: [number, number, number]
  rotationY: number
  scale: number
  /** primitive 用：颜色 */
  color?: string | undefined
  /** local-model 用：data URL / safe-file URL 与格式信息 */
  url?: string | undefined
  fileName?: string | undefined
  format?: 'fbx' | 'obj' | 'glb' | 'gltf' | undefined
}

export type Stage3DAspect = '16:9' | '9:16' | '1:1' | '4:3'

export type Stage3DCamera = {
  position: [number, number, number]
  target: [number, number, number]
  /** 垂直视角（度） */
  fov: number
  aspect: Stage3DAspect
}

/** 三点布光预设，与 2D 版 LIGHTING_LABEL（顺光/侧光/逆光/顶光/轮廓光）语义对齐 */
export type Stage3DLightingPreset = 'studio' | 'front' | 'side' | 'back' | 'rim' | 'top' | 'none'

export type Stage3DLighting = {
  preset: Stage3DLightingPreset
  /** 整体强度倍率 0.5–2 */
  intensity: number
}

/**
 * 已保存的正式镜头（区别于 data.camera 这个「工作/草稿机位」）。
 * 保存当前机位为镜头时快照相机参数，供切换回显与批量导出。
 */
export type Stage3DShot = {
  id: string
  name: string
  /** 镜号，如 "3A" */
  shotNumber: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  aspect: Stage3DAspect
  note?: string | undefined
}

/** 场记板信息：场次 / 镜号 / take，写入提示词开头、批量导出命名 */
export type Stage3DSlate = {
  scene: string
  shotNumber: string
  take: string
  note?: string | undefined
}

export type Stage3DData = {
  version: 1
  backdrop: Stage3DBackdrop
  actors: Stage3DActor[]
  props: Stage3DProp[]
  camera: Stage3DCamera
  /** 已保存的正式镜头列表（C1 分镜） */
  shots?: Stage3DShot[] | undefined
  /** 场景级三点布光（C2） */
  lighting?: Stage3DLighting | undefined
  /** 场记板信息（C4） */
  slate?: Stage3DSlate | undefined
  /** 当前选中对象 id（actor / prop / 'camera'） */
  activeId?: string | undefined
  sceneBrief?: string | undefined
  prompt?: string | undefined
}

export type Stage3DCrowdInput = {
  rows: number
  columns: number
  spacing: number
  bodyType?: Stage3DBodyType | undefined
  modelId?: Stage3DActorModelId | undefined
  modelSource?: Stage3DActorModelSource | undefined
  rigType?: Stage3DActorRigType | undefined
}

// ─────────────────────────── 常量 ───────────────────────────

export const STAGE3D_ASPECTS: Stage3DAspect[] = ['16:9', '9:16', '1:1', '4:3']

export const STAGE3D_ASPECT_RATIO: Record<Stage3DAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
}

export const STAGE3D_LIGHTING_PRESETS: Stage3DLightingPreset[] = [
  'studio',
  'front',
  'side',
  'back',
  'rim',
  'top',
  'none',
]

/** 与 2D 版 LIGHTING_LABEL 措辞对齐，另加影视语义「三点/无」 */
export const STAGE3D_LIGHTING_LABEL: Record<Stage3DLightingPreset, string> = {
  studio: '三点布光',
  front: '顺光',
  side: '侧光',
  back: '逆光',
  rim: '轮廓光',
  top: '顶光',
  none: '默认',
}

export const STAGE3D_BODY_TYPES: Stage3DBodyType[] = [
  'standard',
  'child',
  'slim',
  'muscular',
  'heavy',
  'tall',
]

export const STAGE3D_BODY_TYPE_LABEL: Record<Stage3DBodyType, string> = {
  standard: '标准',
  child: '儿童',
  slim: '瘦高',
  muscular: '健壮',
  heavy: '肥胖',
  tall: '高挑',
}

/** 素体人偶默认配色（参考图彩色人偶） */
export const STAGE3D_ACTOR_COLORS = [
  '#5b9dff',
  '#f97316',
  '#22c55e',
  '#e879f9',
  '#eab308',
  '#f43f5e',
  '#14b8a6',
  '#a78bfa',
]

export const STAGE3D_PRIMITIVE_COLOR = '#cbd5e1'

// ─────────────────────────── 工具 ───────────────────────────

export function makeStage3DId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function vec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
  }
  return [...fallback]
}

function readJoints(value: unknown): Record<string, [number, number, number]> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, [number, number, number]> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(raw) && raw.length >= 3) {
      out[key] = [num(raw[0], 0), num(raw[1], 0), num(raw[2], 0)]
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ─────────────────────────── 默认值 ───────────────────────────

export function defaultStage3DCamera(): Stage3DCamera {
  return {
    position: [0, 1.6, 4.5],
    target: [0, 1, 0],
    fov: 40,
    aspect: '16:9',
  }
}

export function defaultStage3DBackdrop(): Stage3DBackdrop {
  return { mode: 'grid', rotationY: 0, backdropDistance: 8 }
}

export function defaultStage3DLighting(): Stage3DLighting {
  return { preset: 'studio', intensity: 1 }
}

export function makeStage3DActor(index: number, patch?: Partial<Stage3DActor>): Stage3DActor {
  const color = STAGE3D_ACTOR_COLORS[index % STAGE3D_ACTOR_COLORS.length] ?? '#5b9dff'
  const model = getStage3DActorModel(patch?.modelId ?? DEFAULT_STAGE3D_ACTOR_MODEL_ID)
  return {
    id: makeStage3DId('actor'),
    name: `角色${String.fromCharCode(65 + index)}`,
    color,
    modelId: model.id,
    modelSource: model.source,
    rigType: model.rigType,
    bodyType: 'standard',
    heightScale: 1,
    position: [clamp(-1.2 + index * 0.9, -6, 6), 0, 0],
    rotationY: 0,
    pose: 'stand',
    ...patch,
  }
}

export function makeStage3DCrowdActors(
  startIndex: number,
  input: Stage3DCrowdInput,
  offset: [number, number, number] = [0, 0, 0],
): Stage3DActor[] {
  const rows = Math.max(1, Math.floor(num(input.rows, 1)))
  const columns = Math.max(1, Math.floor(num(input.columns, 1)))
  const spacing = Math.max(0.1, num(input.spacing, 1.2))
  const xOffset = ((columns - 1) * spacing) / 2
  const zOffset = ((rows - 1) * spacing) / 2
  const crowdId = makeStage3DId('crowd')
  const crowdLabel = `群众（${rows}x${columns}）`
  const actors: Stage3DActor[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = startIndex + actors.length
      const position: [number, number, number] = [
        Number((offset[0] + column * spacing - xOffset).toFixed(4)),
        offset[1],
        Number((offset[2] + row * spacing - zOffset).toFixed(4)),
      ]
      actors.push(
        makeStage3DActor(index, {
          name: `群演${String(index + 1).padStart(2, '0')}`,
          crowdId,
          crowdLabel,
          bodyType: input.bodyType ?? 'standard',
          position,
          ...(input.modelId ? { modelId: input.modelId } : {}),
          ...(input.modelSource ? { modelSource: input.modelSource } : {}),
          ...(input.rigType ? { rigType: input.rigType } : {}),
        }),
      )
    }
  }

  return actors
}

/** 从相机参数快照一个新镜头 */
export function makeStage3DShot(camera: Stage3DCamera, index: number, patch?: Partial<Stage3DShot>): Stage3DShot {
  return {
    id: makeStage3DId('shot'),
    name: `镜头${index + 1}`,
    shotNumber: `${index + 1}`,
    position: [...camera.position],
    target: [...camera.target],
    fov: camera.fov,
    aspect: camera.aspect,
    ...patch,
  }
}

export function createDefaultStage3DData(): Stage3DData {
  const actor = makeStage3DActor(0)
  return {
    version: 1,
    backdrop: defaultStage3DBackdrop(),
    actors: [actor],
    props: [],
    camera: defaultStage3DCamera(),
    activeId: actor.id,
  }
}

// ─────────────────────────── 序列化 / 反序列化 ───────────────────────────

const BODY_TYPE_SET = new Set<string>(STAGE3D_BODY_TYPES)
const ASPECT_SET = new Set<string>(STAGE3D_ASPECTS)
const BACKDROP_MODES = new Set<string>(['grid', 'panorama', 'backdrop'])
const LIGHTING_PRESET_SET = new Set<string>(STAGE3D_LIGHTING_PRESETS)

function readShot(raw: unknown, index: number): Stage3DShot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  return {
    id: typeof s.id === 'string' && s.id ? s.id : makeStage3DId('shot'),
    name: typeof s.name === 'string' && s.name ? s.name : `镜头${index + 1}`,
    shotNumber: typeof s.shotNumber === 'string' ? s.shotNumber : '',
    position: vec3(s.position, [0, 1.6, 4.5]),
    target: vec3(s.target, [0, 1, 0]),
    fov: clamp(num(s.fov, 40), 10, 100),
    aspect: (ASPECT_SET.has(String(s.aspect)) ? s.aspect : '16:9') as Stage3DAspect,
    ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
  }
}

function readLighting(raw: unknown): Stage3DLighting | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const l = raw as Record<string, unknown>
  return {
    preset: (LIGHTING_PRESET_SET.has(String(l.preset)) ? l.preset : 'studio') as Stage3DLightingPreset,
    intensity: clamp(num(l.intensity, 1), 0.5, 2),
  }
}

function readSlate(raw: unknown): Stage3DSlate | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  const scene = typeof s.scene === 'string' ? s.scene : ''
  const shotNumber = typeof s.shotNumber === 'string' ? s.shotNumber : ''
  const take = typeof s.take === 'string' ? s.take : ''
  const note = typeof s.note === 'string' ? s.note : ''
  // 全为空时视作未设置
  if (!scene && !shotNumber && !take && !note) return undefined
  return { scene, shotNumber, take, ...(note ? { note } : {}) }
}

function readActor(raw: unknown, index: number): Stage3DActor | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const id = typeof a.id === 'string' && a.id ? a.id : makeStage3DId('actor')
  const bodyType = (BODY_TYPE_SET.has(String(a.bodyType)) ? a.bodyType : 'standard') as Stage3DBodyType
  const modelId = normalizeStage3DActorModelId(typeof a.modelId === 'string' ? a.modelId : undefined)
  const model = getStage3DActorModel(modelId)
  const modelSource: Stage3DActorModelSource = model.source
  const rigType: Stage3DActorRigType = model.rigType
  return {
    id,
    name: typeof a.name === 'string' && a.name ? a.name : `角色${String.fromCharCode(65 + index)}`,
    color:
      typeof a.color === 'string' && a.color
        ? a.color
        : (STAGE3D_ACTOR_COLORS[index % STAGE3D_ACTOR_COLORS.length] ?? '#5b9dff'),
    ...(typeof a.boundNodeId === 'string' && a.boundNodeId ? { boundNodeId: a.boundNodeId } : {}),
    ...(typeof a.crowdId === 'string' && a.crowdId ? { crowdId: a.crowdId } : {}),
    ...(typeof a.crowdLabel === 'string' && a.crowdLabel ? { crowdLabel: a.crowdLabel } : {}),
    modelId,
    modelSource,
    rigType,
    bodyType,
    heightScale: clamp(num(a.heightScale, 1), 0.5, 1.5),
    position: vec3(a.position, [0, 0, 0]),
    rotationY: num(a.rotationY, 0),
    pose: typeof a.pose === 'string' && a.pose ? a.pose : 'stand',
    ...(readJoints(a.joints) ? { joints: readJoints(a.joints) } : {}),
    ...(typeof a.note === 'string' ? { note: a.note } : {}),
  }
}

function readProp(raw: unknown, index: number): Stage3DProp | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const kind: Stage3DPropKind =
    p.kind === 'glb' ? 'glb' : p.kind === 'local-model' ? 'local-model' : 'primitive'
  const assetId =
    typeof p.assetId === 'string' && p.assetId ? p.assetId : kind === 'glb' ? 'unknown' : kind === 'local-model' ? 'local-model' : 'box'
  const format =
    p.format === 'fbx' || p.format === 'obj' || p.format === 'glb' || p.format === 'gltf'
      ? p.format
      : undefined
  return {
    id: typeof p.id === 'string' && p.id ? p.id : makeStage3DId('prop'),
    kind,
    assetId,
    name: typeof p.name === 'string' && p.name ? p.name : `道具${index + 1}`,
    position: vec3(p.position, [0, 0, 0]),
    rotationY: num(p.rotationY, 0),
    scale: clamp(num(p.scale, 1), 0.1, 10),
    ...(typeof p.color === 'string' && p.color ? { color: p.color } : {}),
    ...(typeof p.url === 'string' && p.url ? { url: p.url } : {}),
    ...(typeof p.fileName === 'string' && p.fileName ? { fileName: p.fileName } : {}),
    ...(format ? { format } : {}),
  }
}

/** 从节点读取 3D 导演台数据；缺失/脏数据时给出默认场景。 */
export function readStage3DData(node: CanvasNode | null | undefined): Stage3DData {
  const raw = node?.data.stage3d
  if (!raw || typeof raw !== 'object') return createDefaultStage3DData()
  const data = raw as Record<string, unknown>

  const actors = Array.isArray(data.actors)
    ? (data.actors.map((a, i) => readActor(a, i)).filter(Boolean) as Stage3DActor[])
    : []
  const props = Array.isArray(data.props)
    ? (data.props.map((p, i) => readProp(p, i)).filter(Boolean) as Stage3DProp[])
    : []

  const rawBackdrop = (data.backdrop ?? {}) as Record<string, unknown>
  const rawMode = String(rawBackdrop.mode)
  const backdrop: Stage3DBackdrop = {
    mode: (BACKDROP_MODES.has(rawMode) ? rawMode : 'grid') as Stage3DBackdropMode,
    ...(typeof rawBackdrop.imageUrl === 'string' && rawBackdrop.imageUrl
      ? { imageUrl: rawBackdrop.imageUrl }
      : {}),
    rotationY: num(rawBackdrop.rotationY, 0),
    backdropDistance: clamp(num(rawBackdrop.backdropDistance, 8), 2, 40),
    ...(typeof rawBackdrop.sourceNodeId === 'string' && rawBackdrop.sourceNodeId
      ? { sourceNodeId: rawBackdrop.sourceNodeId }
      : {}),
  }

  const rawCamera = (data.camera ?? {}) as Record<string, unknown>
  const camera: Stage3DCamera = {
    position: vec3(rawCamera.position, [0, 1.6, 4.5]),
    target: vec3(rawCamera.target, [0, 1, 0]),
    fov: clamp(num(rawCamera.fov, 40), 10, 100),
    aspect: (ASPECT_SET.has(String(rawCamera.aspect)) ? rawCamera.aspect : '16:9') as Stage3DAspect,
  }

  const shots = Array.isArray(data.shots)
    ? (data.shots.map((s, i) => readShot(s, i)).filter(Boolean) as Stage3DShot[])
    : []
  const lighting = readLighting(data.lighting)
  const slate = readSlate(data.slate)

  const safeActors = actors.length > 0 ? actors : [makeStage3DActor(0)]
  const fallbackId = safeActors[0]?.id
  const activeCandidate = typeof data.activeId === 'string' ? data.activeId : undefined
  const activeValid =
    activeCandidate === 'camera' ||
    safeActors.some((a) => a.id === activeCandidate) ||
    props.some((p) => p.id === activeCandidate)

  return {
    version: 1,
    backdrop,
    actors: safeActors,
    props,
    camera,
    ...(shots.length > 0 ? { shots } : {}),
    ...(lighting ? { lighting } : {}),
    ...(slate ? { slate } : {}),
    activeId: activeValid ? activeCandidate : fallbackId,
    ...(typeof data.sceneBrief === 'string' ? { sceneBrief: data.sceneBrief } : {}),
    ...(typeof data.prompt === 'string' ? { prompt: data.prompt } : {}),
  }
}

/** 序列化为可写回 node.data.stage3d 的普通对象。 */
export function serializeStage3DData(data: Stage3DData): Record<string, unknown> {
  return data as unknown as Record<string, unknown>
}
