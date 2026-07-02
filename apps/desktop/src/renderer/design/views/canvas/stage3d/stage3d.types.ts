import type { CanvasNode } from '../canvas.types'

/**
 * 真·3D 导演台数据模型（节点 data.stage3d，version 1）。
 *
 * 与 2D 版（data.directorStage）并列、互不影响。所有解析都尽量宽容：
 * 旧/脏数据缺字段时用默认值补齐，坐标/角度做范围钳制。
 */

export type Stage3DBackdropMode = 'grid' | 'panorama' | 'backdrop'

export type Stage3DBackdrop = {
  mode: Stage3DBackdropMode
  /** 全景球 / 背板平面贴图 URL（可指向画布中的图片节点） */
  imageUrl?: string | undefined
  /** 全景球或背板绕 Y 轴旋转（弧度） */
  rotationY?: number | undefined
  /** backdrop 模式下背板离原点的距离 */
  backdropDistance?: number | undefined
  /** 记录来源图片节点 id（便于回显选择器高亮） */
  sourceNodeId?: string | undefined
}

export type Stage3DBodyType = 'standard' | 'child' | 'slim' | 'muscular' | 'heavy' | 'tall'

export type Stage3DActor = {
  id: string
  name: string
  /** 人偶通体颜色 */
  color: string
  /** 绑定的画布角色板节点 id（无则为路人） */
  boundNodeId?: string | undefined
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

export type Stage3DPropKind = 'glb' | 'primitive'

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
}

export type Stage3DAspect = '16:9' | '9:16' | '1:1' | '4:3'

export type Stage3DCamera = {
  position: [number, number, number]
  target: [number, number, number]
  /** 垂直视角（度） */
  fov: number
  aspect: Stage3DAspect
}

export type Stage3DData = {
  version: 1
  backdrop: Stage3DBackdrop
  actors: Stage3DActor[]
  props: Stage3DProp[]
  camera: Stage3DCamera
  /** 当前选中对象 id（actor / prop / 'camera'） */
  activeId?: string | undefined
  sceneBrief?: string | undefined
  prompt?: string | undefined
}

// ─────────────────────────── 常量 ───────────────────────────

export const STAGE3D_ASPECTS: Stage3DAspect[] = ['16:9', '9:16', '1:1', '4:3']

export const STAGE3D_ASPECT_RATIO: Record<Stage3DAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
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

export function makeStage3DActor(index: number, patch?: Partial<Stage3DActor>): Stage3DActor {
  const color = STAGE3D_ACTOR_COLORS[index % STAGE3D_ACTOR_COLORS.length] ?? '#5b9dff'
  return {
    id: makeStage3DId('actor'),
    name: `角色${String.fromCharCode(65 + index)}`,
    color,
    bodyType: 'standard',
    heightScale: 1,
    position: [clamp(-1.2 + index * 0.9, -6, 6), 0, 0],
    rotationY: 0,
    pose: 'stand',
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

function readActor(raw: unknown, index: number): Stage3DActor | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const id = typeof a.id === 'string' && a.id ? a.id : makeStage3DId('actor')
  const bodyType = (BODY_TYPE_SET.has(String(a.bodyType)) ? a.bodyType : 'standard') as Stage3DBodyType
  return {
    id,
    name: typeof a.name === 'string' && a.name ? a.name : `角色${String.fromCharCode(65 + index)}`,
    color:
      typeof a.color === 'string' && a.color
        ? a.color
        : (STAGE3D_ACTOR_COLORS[index % STAGE3D_ACTOR_COLORS.length] ?? '#5b9dff'),
    ...(typeof a.boundNodeId === 'string' && a.boundNodeId ? { boundNodeId: a.boundNodeId } : {}),
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
  const kind: Stage3DPropKind = p.kind === 'glb' ? 'glb' : 'primitive'
  const assetId =
    typeof p.assetId === 'string' && p.assetId ? p.assetId : kind === 'glb' ? 'unknown' : 'box'
  return {
    id: typeof p.id === 'string' && p.id ? p.id : makeStage3DId('prop'),
    kind,
    assetId,
    name: typeof p.name === 'string' && p.name ? p.name : `道具${index + 1}`,
    position: vec3(p.position, [0, 0, 0]),
    rotationY: num(p.rotationY, 0),
    scale: clamp(num(p.scale, 1), 0.1, 10),
    ...(typeof p.color === 'string' && p.color ? { color: p.color } : {}),
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
  const backdrop: Stage3DBackdrop = {
    mode: (BACKDROP_MODES.has(String(rawBackdrop.mode)) ? rawBackdrop.mode : 'grid') as Stage3DBackdropMode,
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
    activeId: activeValid ? activeCandidate : fallbackId,
    ...(typeof data.sceneBrief === 'string' ? { sceneBrief: data.sceneBrief } : {}),
    ...(typeof data.prompt === 'string' ? { prompt: data.prompt } : {}),
  }
}

/** 序列化为可写回 node.data.stage3d 的普通对象。 */
export function serializeStage3DData(data: Stage3DData): Record<string, unknown> {
  return data as unknown as Record<string, unknown>
}
