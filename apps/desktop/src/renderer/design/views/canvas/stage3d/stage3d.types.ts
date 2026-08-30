import type { CanvasNode } from '../canvas.types'
import {
  DEFAULT_STAGE3D_ACTOR_MODEL_ID,
  getStage3DActorModel,
  normalizeStage3DActorModelId,
} from './actorModelRegistry'
import type {
  Stage3DCameraKeyframe,
  Stage3DCameraMotion,
  Stage3DMotionPresetId,
} from './cameraMotion'

/**
 * 3D 导演台数据模型（节点 data.stage3d，version 1）。
 *
 * 所有解析都尽量宽容：旧/脏数据缺字段时用默认值补齐，坐标/角度做范围钳制。
 */

export type Stage3DBackdropMode = 'grid' | 'panorama' | 'backdrop'

export type Stage3DBackdrop = {
  mode: Stage3DBackdropMode
  /** 背板平面贴图 URL（兼容旧 panorama 数据时也会原样保留） */
  imageUrl?: string | undefined
  /** 背景绕 Y 轴旋转（弧度） */
  rotationY?: number | undefined
  /** panorama 模式的独立视野缩放：小于 1 拉远，大于 1 拉近 */
  panoramaZoom?: number | undefined
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
  /** 机位名称（默认「导演相机」，机位预览下拉与提示词回显用） */
  name?: string | undefined
  /** 注视目标对象 id（actor / prop）；未设置时用 target 手动坐标 */
  lookTargetId?: string | undefined
  /** 跟随目标对象 id：运镜预设环绕/跟拍的主体；未设置时回退注视目标或注视点 */
  followTargetId?: string | undefined
  /** 机位运动轨迹（预设运镜或关键帧轨迹） */
  motion?: Stage3DCameraMotion | undefined
}

/** 三点布光预设 */
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
  /** 镜头携带的运动轨迹：切到该镜头时载入工作机位，可播放预览与录制运镜视频 */
  motion?: Stage3DCameraMotion | undefined
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
  /** 布景倍率：仅放大/缩小角色和道具的视觉存在感，不改背景图本身 */
  sceneScale?: number | undefined
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

/** 布光预设的界面文案 */
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
export const STAGE3D_PANORAMA_ZOOM_MIN = 0.5
export const STAGE3D_PANORAMA_ZOOM_MAX = 2
export const STAGE3D_SCENE_SCALE_MIN = 0.5
export const STAGE3D_SCENE_SCALE_MAX = 2

export type Stage3DSceneControlField = 'panoramaZoom' | 'backdropDistance' | 'sceneScale' | 'fov'

const COMMON_STAGE3D_SCENE_CONTROL_FIELDS = ['sceneScale', 'fov'] as const

export function getStage3DSceneControlFields(
  mode: Stage3DBackdropMode,
): readonly Stage3DSceneControlField[] {
  if (mode === 'panorama') return ['panoramaZoom', ...COMMON_STAGE3D_SCENE_CONTROL_FIELDS]
  if (mode === 'backdrop') return ['backdropDistance', ...COMMON_STAGE3D_SCENE_CONTROL_FIELDS]
  return COMMON_STAGE3D_SCENE_CONTROL_FIELDS
}

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
  return { mode: 'grid', rotationY: 0, panoramaZoom: 1, backdropDistance: 8 }
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

/** 从相机参数快照一个新镜头（携带当前机位的运动轨迹） */
export function makeStage3DShot(
  camera: Stage3DCamera,
  index: number,
  patch?: Partial<Stage3DShot>,
): Stage3DShot {
  return {
    id: makeStage3DId('shot'),
    name: `镜头${index + 1}`,
    shotNumber: `${index + 1}`,
    position: [...camera.position],
    target: [...camera.target],
    fov: camera.fov,
    aspect: camera.aspect,
    ...(camera.motion ? { motion: camera.motion } : {}),
    ...patch,
  }
}

export function createDefaultStage3DData(): Stage3DData {
  const actor = makeStage3DActor(0)
  return {
    version: 1,
    backdrop: defaultStage3DBackdrop(),
    sceneScale: 1,
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

/** 宽容读取运动轨迹：脏数据直接丢弃，不给渲染层埋雷 */
function readMotion(raw: unknown): Stage3DCameraMotion | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Record<string, unknown>
  const kind = m.kind === 'keyframes' ? 'keyframes' : m.kind === 'preset' ? 'preset' : null
  if (!kind) return undefined
  const durationSec = clamp(Number(m.durationSec) || 0, 0.5, 30)
  let start: Stage3DCameraMotion['start'] = undefined
  if (m.start && typeof m.start === 'object') {
    const s = m.start as Record<string, unknown>
    const fov = s.fov == null ? undefined : clamp(num(s.fov, 40), 10, 100)
    start = {
      position: vec3(s.position, [0, 1.6, 4.5]),
      target: vec3(s.target, [0, 1, 0]),
      ...(fov != null ? { fov } : {}),
    }
  }
  let keyframes: Stage3DCameraKeyframe[] | undefined
  if (kind === 'keyframes') {
    keyframes = Array.isArray(m.keyframes)
      ? (m.keyframes
          .map((kf) => {
            if (!kf || typeof kf !== 'object') return null
            const k = kf as Record<string, unknown>
            return {
              id: typeof k.id === 'string' && k.id ? k.id : makeStage3DId('kf'),
              t: clamp(num(k.t, 0), 0, durationSec),
              position: vec3(k.position, [0, 1.6, 4.5]),
              target: vec3(k.target, [0, 1, 0]),
            }
          })
          .filter(Boolean) as Stage3DCameraKeyframe[])
      : []
    if (keyframes.length === 0) return undefined
  }
  return {
    kind,
    ...(kind === 'preset' && typeof m.presetId === 'string'
      ? { presetId: m.presetId as Stage3DMotionPresetId }
      : {}),
    durationSec,
    ...(start ? { start } : {}),
    ...(keyframes ? { keyframes } : {}),
  }
}

function readShot(raw: unknown, index: number): Stage3DShot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const motion = readMotion(s.motion)
  return {
    id: typeof s.id === 'string' && s.id ? s.id : makeStage3DId('shot'),
    name: typeof s.name === 'string' && s.name ? s.name : `镜头${index + 1}`,
    shotNumber: typeof s.shotNumber === 'string' ? s.shotNumber : '',
    position: vec3(s.position, [0, 1.6, 4.5]),
    target: vec3(s.target, [0, 1, 0]),
    fov: clamp(num(s.fov, 40), 10, 100),
    aspect: (ASPECT_SET.has(String(s.aspect)) ? s.aspect : '16:9') as Stage3DAspect,
    ...(motion ? { motion } : {}),
    ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
  }
}

function readLighting(raw: unknown): Stage3DLighting | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const l = raw as Record<string, unknown>
  return {
    preset: (LIGHTING_PRESET_SET.has(String(l.preset))
      ? l.preset
      : 'studio') as Stage3DLightingPreset,
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
  const bodyType = (
    BODY_TYPE_SET.has(String(a.bodyType)) ? a.bodyType : 'standard'
  ) as Stage3DBodyType
  const modelId = normalizeStage3DActorModelId(
    typeof a.modelId === 'string' ? a.modelId : undefined,
  )
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
    typeof p.assetId === 'string' && p.assetId
      ? p.assetId
      : kind === 'glb'
        ? 'unknown'
        : kind === 'local-model'
          ? 'local-model'
          : 'box'
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
    panoramaZoom: clamp(
      num(rawBackdrop.panoramaZoom, 1),
      STAGE3D_PANORAMA_ZOOM_MIN,
      STAGE3D_PANORAMA_ZOOM_MAX,
    ),
    backdropDistance: clamp(num(rawBackdrop.backdropDistance, 8), 2, 40),
    ...(typeof rawBackdrop.sourceNodeId === 'string' && rawBackdrop.sourceNodeId
      ? { sourceNodeId: rawBackdrop.sourceNodeId }
      : {}),
  }

  const sceneScale = clamp(
    num(data.sceneScale, 1),
    STAGE3D_SCENE_SCALE_MIN,
    STAGE3D_SCENE_SCALE_MAX,
  )

  const rawCamera = (data.camera ?? {}) as Record<string, unknown>
  const cameraMotion = readMotion(rawCamera.motion)
  const camera: Stage3DCamera = {
    position: vec3(rawCamera.position, [0, 1.6, 4.5]),
    target: vec3(rawCamera.target, [0, 1, 0]),
    fov: clamp(num(rawCamera.fov, 40), 10, 100),
    aspect: (ASPECT_SET.has(String(rawCamera.aspect)) ? rawCamera.aspect : '16:9') as Stage3DAspect,
    ...(typeof rawCamera.name === 'string' && rawCamera.name
      ? { name: rawCamera.name }
      : {}),
    ...(typeof rawCamera.lookTargetId === 'string' && rawCamera.lookTargetId
      ? { lookTargetId: rawCamera.lookTargetId }
      : {}),
    ...(typeof rawCamera.followTargetId === 'string' && rawCamera.followTargetId
      ? { followTargetId: rawCamera.followTargetId }
      : {}),
    ...(cameraMotion ? { motion: cameraMotion } : {}),
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
    sceneScale,
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

/**
 * 按对象 id 解析注视点：角色取胸口高度（≈1m×身高缩放×场景倍率），
 * 道具取重心近似（0.4m×缩放×倍率）。找不到对象时返回 null。
 */
export function resolveStage3DLookAtPoint(
  data: Stage3DData,
  objectId: string | undefined,
): [number, number, number] | null {
  if (!objectId) return null
  const actor = data.actors.find((a) => a.id === objectId)
  if (actor) {
    const chest = 1 * actor.heightScale * (data.sceneScale ?? 1)
    return [actor.position[0], actor.position[1] + chest, actor.position[2]]
  }
  const prop = data.props.find((p) => p.id === objectId)
  if (prop) {
    const center = 0.4 * prop.scale * (data.sceneScale ?? 1)
    return [prop.position[0], prop.position[1] + center, prop.position[2]]
  }
  return null
}
