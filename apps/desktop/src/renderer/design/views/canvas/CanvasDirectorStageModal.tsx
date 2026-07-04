import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, Modal, Segmented, Slider, message } from 'antd'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'

/**
 * 节点级「画面编排导演台」（单帧）。
 * 用一张干净的俯视平面图编排角色/道具/相机的站位与朝向，
 * 实时给出相机取景预览，并产出可直接喂图像模型的中文提示词。
 */

type StageItemKind = 'character' | 'prop'
type CameraShotSize = 'wide' | 'full' | 'medium' | 'closeup'
type CameraAngle = 'eye' | 'high' | 'low'
type CameraAspect = '16:9' | '9:16' | '1:1' | '4:3'
type CameraLighting = 'none' | 'front' | 'side' | 'back' | 'top' | 'rim'

type StageItem = {
  id: string
  kind: StageItemKind
  name: string
  color: string
  /** 舞台横向 -1(左) .. 1(右) */
  x: number
  /** 舞台纵深 -1(远) .. 1(近，靠近相机) */
  z: number
  /** 朝向角(度)：0=朝向画面远端(上)，顺时针增加；180=面向相机 */
  facing: number
  note?: string
}

type StageCamera = {
  x: number
  z: number
  /** 相机视线方向角(度)，约定同 facing：0=看向远端(上) */
  facing: number
  shotSize: CameraShotSize
  angle: CameraAngle
  /** 等效全画幅焦段 mm */
  focalLength: number
  aspect: CameraAspect
  lighting: CameraLighting
}

export type DirectorStageData = {
  version: 2
  items: StageItem[]
  camera: StageCamera
  activeId: string
  sceneBrief?: string
  prompt?: string
}

const CHARACTER_COLOR = '#5b9dff'
const PROP_COLOR = '#cbd5e1'
const CAMERA_COLOR = '#f5a623'
const SENSOR_WIDTH = 36 // 35mm 全画幅水平传感器宽度

const SHOT_SIZE_LABEL: Record<CameraShotSize, string> = {
  wide: '远景',
  full: '全景',
  medium: '中景',
  closeup: '特写',
}

const SHOT_SIZE_FILL: Record<CameraShotSize, number> = {
  wide: 0.46,
  full: 0.82,
  medium: 1.25,
  closeup: 2.4,
}

const ANGLE_LABEL: Record<CameraAngle, string> = {
  eye: '平视',
  high: '俯视',
  low: '仰视',
}

const ASPECT_RATIO: Record<CameraAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
}

const LIGHTING_LABEL: Record<CameraLighting, string> = {
  none: '默认',
  front: '顺光',
  side: '侧光',
  back: '逆光',
  top: '顶光',
  rim: '轮廓光',
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toNum(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 归一化到 (-180, 180] */
function normDeg(value: number): number {
  let v = value % 360
  if (v > 180) v -= 360
  if (v <= -180) v += 360
  return v
}

function deg2rad(value: number): number {
  return (value * Math.PI) / 180
}

/** 与 facing 同约定：0 指向 -z(远/上)，顺时针为正。返回度。 */
function headingDeg(vx: number, vz: number): number {
  return (Math.atan2(vx, -vz) * 180) / Math.PI
}

function fovFromFocal(focal: number): number {
  const f = clamp(focal, 8, 300)
  return (2 * Math.atan(SENSOR_WIDTH / (2 * f)) * 180) / Math.PI
}

function defaultCamera(): StageCamera {
  return {
    x: 0,
    z: 0.92,
    facing: 0,
    shotSize: 'medium',
    angle: 'eye',
    focalLength: 35,
    aspect: '16:9',
    lighting: 'none',
  }
}

function defaultCharacterItem(): StageItem {
  return {
    id: 'char-1',
    kind: 'character',
    name: '角色A',
    color: CHARACTER_COLOR,
    x: 0,
    z: -0.1,
    facing: 180,
    note: '站立，面向镜头',
  }
}

function defaultItems(): StageItem[] {
  return [defaultCharacterItem()]
}

function createDefaultDirectorStageDataInternal(): DirectorStageData {
  const character = defaultCharacterItem()
  return { version: 2, items: [character], camera: defaultCamera(), activeId: character.id }
}

export const createDefaultDirectorStageData = createDefaultDirectorStageDataInternal

function isStageItem(value: unknown): value is StageItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StageItem>
  return (
    typeof item.id === 'string' &&
    typeof item.x === 'number' &&
    typeof item.z === 'number' &&
    (item.kind === 'character' || item.kind === 'prop')
  )
}

const ASPECT_VALUES: CameraAspect[] = ['16:9', '9:16', '1:1', '4:3']
const LIGHTING_VALUES: CameraLighting[] = ['none', 'front', 'side', 'back', 'top', 'rim']

/** 读取节点数据，兼容旧版 v1（objects/Vec3/rotation.yaw）。 */
function readDirectorStageData(node: CanvasNode | null | undefined): DirectorStageData {
  const raw = node?.data.directorStage
  if (!raw || typeof raw !== 'object') return createDefaultDirectorStageDataInternal()
  const data = raw as Record<string, unknown>

  // 新版直接采用
  if (Array.isArray(data.items) && data.camera && typeof data.camera === 'object') {
    const items = (data.items as unknown[]).filter(isStageItem).map((item) => ({
      ...item,
      facing: normDeg(Number(item.facing) || 0),
      x: clamp(Number(item.x) || 0, -1, 1),
      z: clamp(Number(item.z) || 0, -1, 1),
      color: item.color || (item.kind === 'prop' ? PROP_COLOR : CHARACTER_COLOR),
    }))
    const cam = data.camera as Partial<StageCamera>
    const aspect = ASPECT_VALUES.includes(cam.aspect as CameraAspect)
      ? (cam.aspect as CameraAspect)
      : '16:9'
    const lighting = LIGHTING_VALUES.includes(cam.lighting as CameraLighting)
      ? (cam.lighting as CameraLighting)
      : 'none'
    const camera: StageCamera = {
      ...defaultCamera(),
      ...cam,
      x: clamp(toNum(cam.x, 0), -1, 1),
      z: clamp(toNum(cam.z, 0.92), -1, 1),
      facing: normDeg(Number(cam.facing) || 0),
      focalLength: clamp(Number(cam.focalLength) || 35, 8, 300),
      aspect,
      lighting,
    }
    const safeItems = items.length > 0 ? items : defaultItems()
    const fallbackId = safeItems[0]?.id ?? 'char-1'
    return {
      version: 2,
      items: safeItems,
      camera,
      activeId: typeof data.activeId === 'string' && data.activeId ? data.activeId : fallbackId,
      ...(typeof data.sceneBrief === 'string' ? { sceneBrief: data.sceneBrief } : {}),
      ...(typeof data.prompt === 'string' ? { prompt: data.prompt } : {}),
    }
  }

  // 旧版 v1 迁移
  if (Array.isArray(data.objects)) {
    const legacy = data.objects as Array<Record<string, unknown>>
    const cameraObj = legacy.find((o) => o.kind === 'camera')
    const items: StageItem[] = legacy
      .filter((o) => o.kind !== 'camera')
      .map((o, index) => {
        const pos = (o.position as { x?: number; z?: number } | undefined) ?? {}
        const rot = (o.rotation as { yaw?: number } | undefined) ?? {}
        const kind: StageItemKind = o.kind === 'prop' ? 'prop' : 'character'
        return {
          id: typeof o.id === 'string' ? o.id : makeId(kind),
          kind,
          name: typeof o.name === 'string' ? o.name : `对象${index + 1}`,
          color: kind === 'prop' ? PROP_COLOR : CHARACTER_COLOR,
          x: clamp((Number(pos.x) || 0) / 5, -1, 1),
          z: clamp((Number(pos.z) || 0) / 5, -1, 1),
          facing: normDeg(Number(rot.yaw) || 180),
          ...(typeof o.pose === 'string' ? { note: o.pose } : {}),
        }
      })
    const camPos = (cameraObj?.position as { x?: number; z?: number } | undefined) ?? {}
    const camRot = (cameraObj?.rotation as { yaw?: number } | undefined) ?? {}
    const camera: StageCamera = {
      ...defaultCamera(),
      x: clamp((Number(camPos.x) || 0) / 5, -1, 1),
      z: clamp((Number(camPos.z) || 2) / 5, -1, 1),
      facing: normDeg(Number(camRot.yaw) || 0),
    }
    const safeItems = items.length > 0 ? items : defaultItems()
    return { version: 2, items: safeItems, camera, activeId: safeItems[0]?.id ?? 'char-1' }
  }

  return createDefaultDirectorStageDataInternal()
}

// ---------- 取景投影 ----------

type ProjectedItem = {
  id: string
  name: string
  color: string
  kind: StageItemKind
  /** 画面横向 0..1（越界可能 <0 或 >1） */
  u: number
  /** 与相机距离 */
  dist: number
  /** 0(近) .. 1(远) */
  depth: number
  /** 近大远小尺度 0..1 */
  scale: number
  inFrame: boolean
}

function projectFraming(data: DirectorStageData): ProjectedItem[] {
  const { camera, items } = data
  const fov = fovFromFocal(camera.focalLength)
  const half = fov / 2
  return items
    .map((item) => {
      const vx = item.x - camera.x
      const vz = item.z - camera.z
      const dist = Math.hypot(vx, vz)
      const rel = normDeg(headingDeg(vx, vz) - camera.facing)
      const u = 0.5 + rel / fov
      const depth = clamp(dist / 2.6, 0, 1)
      const scale = clamp(1 - depth * 0.72, 0.18, 1)
      const inFrame = Math.abs(rel) <= half + 0.5 && vz * Math.cos(deg2rad(camera.facing)) <= dist
      return {
        id: item.id,
        name: item.name,
        color: item.color,
        kind: item.kind,
        u,
        dist,
        depth,
        scale,
        inFrame,
      }
    })
    .sort((a, b) => b.dist - a.dist)
}

// ---------- 文案 ----------

function lateralWord(u: number): string {
  if (u < 0.4) return '画面左侧'
  if (u > 0.6) return '画面右侧'
  return '画面中央'
}

function depthWord(depth: number): string {
  if (depth < 0.34) return '前景'
  if (depth < 0.67) return '中景'
  return '背景'
}

function facingWord(item: StageItem, camera: StageCamera): string {
  const toCam = headingDeg(camera.x - item.x, camera.z - item.z)
  const diff = Math.abs(normDeg(item.facing - toCam))
  if (diff <= 45) return '面向镜头'
  if (diff >= 135) return '背对镜头'
  const side = normDeg(item.facing - toCam) > 0 ? '右' : '左'
  return `侧身朝${side}`
}

function buildDirectorPrompt(data: DirectorStageData): string {
  const { camera } = data
  const projected = new Map(projectFraming(data).map((p) => [p.id, p]))
  const lines: string[] = []
  if (data.sceneBrief?.trim()) lines.push(`场景：${data.sceneBrief.trim()}`)

  const subjectLines = data.items.map((item) => {
    const p = projected.get(item.id)
    const lateral = p ? lateralWord(p.u) : '画面中央'
    const depth = p ? depthWord(p.depth) : '中景'
    const inFrame = p?.inFrame ?? true
    const facing = item.kind === 'character' ? `，${facingWord(item, camera)}` : ''
    const note = item.note?.trim() ? `，${item.note.trim()}` : ''
    const kindWord = item.kind === 'character' ? '人物' : '道具'
    const place = inFrame ? `位于${lateral}${depth}` : '（位于取景框外，未入画）'
    return `- ${item.name}（${kindWord}）${place}${facing}${note}`
  })
  if (subjectLines.length > 0) {
    lines.push('画面主体：')
    lines.push(...subjectLines)
  }

  lines.push(
    `镜头：${SHOT_SIZE_LABEL[camera.shotSize]}，${ANGLE_LABEL[camera.angle]}角度，${Math.round(
      camera.focalLength,
    )}mm 镜头（水平视角约 ${Math.round(fovFromFocal(camera.focalLength))}°），${camera.aspect} 画幅。`,
  )
  if (camera.lighting !== 'none') lines.push(`灯光：${LIGHTING_LABEL[camera.lighting]}。`)

  // 构图提示
  const inFrameSubjects = data.items.filter((item) => projected.get(item.id)?.inFrame ?? true)
  const composition: string[] = []
  if (inFrameSubjects.length === 1 && inFrameSubjects[0]) {
    const only = projected.get(inFrameSubjects[0].id)
    if (only) {
      if (Math.abs(only.u - 0.5) < 0.08) composition.push('主体居中构图')
      else if (Math.abs(only.u - 1 / 3) < 0.1 || Math.abs(only.u - 2 / 3) < 0.1)
        composition.push('三分法构图')
    }
  } else if (inFrameSubjects.length >= 2) {
    composition.push('多主体分布，注意层次与平衡')
  }
  if (camera.angle === 'high') composition.push('俯拍带来压缩感与全局视野')
  if (camera.angle === 'low') composition.push('仰拍增强主体的高大与张力')
  if (composition.length > 0) lines.push(`构图：${composition.join('；')}。`)

  return lines.join('\n')
}

// ---------- 人物剪影几何（SVG + canvas 共用） ----------

function personBodyPath(cx: number, footY: number, H: number): string {
  return [
    `M ${cx - 0.085 * H} ${footY - 0.74 * H}`,
    `Q ${cx - 0.18 * H} ${footY - 0.4 * H} ${cx - 0.15 * H} ${footY}`,
    `L ${cx + 0.15 * H} ${footY}`,
    `Q ${cx + 0.18 * H} ${footY - 0.4 * H} ${cx + 0.085 * H} ${footY - 0.74 * H}`,
    'Z',
  ].join(' ')
}

function personHead(cx: number, footY: number, H: number): { cx: number; cy: number; r: number } {
  return { cx, cy: footY - 0.87 * H, r: 0.13 * H }
}

// ---------- 取景预览渲染（离屏 canvas → PNG） ----------

function horizonFor(angle: CameraAngle): number {
  return angle === 'high' ? 0.32 : angle === 'low' ? 0.62 : 0.48
}

function renderFramingToDataUrl(data: DirectorStageData): string {
  const ratio = ASPECT_RATIO[data.camera.aspect]
  const width = 1280
  const height = Math.round(width / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, width, height)

  const horizonY = horizonFor(data.camera.angle) * height
  ctx.fillStyle = 'rgba(30,41,59,0.4)'
  ctx.fillRect(0, horizonY, width, height - horizonY)
  ctx.strokeStyle = 'rgba(56,189,248,0.32)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, horizonY)
  ctx.lineTo(width, horizonY)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(148,163,184,0.16)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 2; i += 1) {
    ctx.beginPath()
    ctx.moveTo((width * i) / 3, 0)
    ctx.lineTo((width * i) / 3, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, (height * i) / 3)
    ctx.lineTo(width, (height * i) / 3)
    ctx.stroke()
  }

  const fill = SHOT_SIZE_FILL[data.camera.shotSize]
  projectFraming(data).forEach((p) => {
    if (!p.inFrame) return
    const cx = p.u * width
    const footY = horizonY + (height - horizonY) * (1 - p.depth)
    const figH = clamp(p.scale * fill, 0.12, 4) * (height * 0.62)
    ctx.save()
    ctx.globalAlpha = 0.94
    if (p.kind === 'character') {
      const head = personHead(cx, footY, figH)
      ctx.fillStyle = p.color
      ctx.fill(new Path2D(personBodyPath(cx, footY, figH)))
      ctx.beginPath()
      ctx.arc(head.cx, head.cy, head.r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const w = figH * 0.62
      ctx.fillStyle = p.color
      roundRect(ctx, cx - w / 2, footY - figH * 0.7, w, figH * 0.7, w * 0.16)
      ctx.fill()
    }
    ctx.restore()
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(p.name, cx, footY - figH - 10)
  })

  ctx.fillStyle = 'rgba(226,232,240,0.92)'
  ctx.font = '600 26px sans-serif'
  ctx.textAlign = 'left'
  const tail = data.camera.lighting === 'none' ? '' : ` · ${LIGHTING_LABEL[data.camera.lighting]}`
  ctx.fillText(
    `${SHOT_SIZE_LABEL[data.camera.shotSize]} · ${ANGLE_LABEL[data.camera.angle]} · ${Math.round(
      data.camera.focalLength,
    )}mm · ${data.camera.aspect}${tail}`,
    32,
    44,
  )
  return canvas.toDataURL('image/png')
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

// ---------- 平面图坐标换算 ----------

const PLAN = { cx: 50, cy: 50, halfW: 40, halfH: 40 }

function worldToPlan(x: number, z: number): { px: number; py: number } {
  return { px: PLAN.cx + x * PLAN.halfW, py: PLAN.cy + z * PLAN.halfH }
}

function planToWorld(px: number, py: number): { x: number; z: number } {
  return {
    x: clamp((px - PLAN.cx) / PLAN.halfW, -1, 1),
    z: clamp((py - PLAN.cy) / PLAN.halfH, -1, 1),
  }
}

/** facing 朝向在平面图里的单位方向（screen：上=-y） */
function headingVec(facing: number): { hx: number; hy: number } {
  const r = deg2rad(facing)
  return { hx: Math.sin(r), hy: -Math.cos(r) }
}

// ---------- 场景预设 ----------

type PresetKey = 'portrait' | 'dialogue' | 'ots' | 'group'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'portrait', label: '单人肖像' },
  { key: 'dialogue', label: '双人对话' },
  { key: 'ots', label: '过肩镜头' },
  { key: 'group', label: '三人群像' },
]

function makeCharacter(
  name: string,
  x: number,
  z: number,
  facing: number,
  note: string,
): StageItem {
  return { id: makeId('char'), kind: 'character', name, color: CHARACTER_COLOR, x, z, facing, note }
}

function applyPreset(key: PresetKey, base: DirectorStageData): DirectorStageData {
  const camera = { ...base.camera }
  let items: StageItem[]
  if (key === 'portrait') {
    items = [makeCharacter('角色A', 0, -0.05, 180, '站立，面向镜头')]
    Object.assign(camera, { shotSize: 'medium', focalLength: 50, angle: 'eye' })
  } else if (key === 'dialogue') {
    items = [
      makeCharacter('角色A', -0.24, 0.05, 110, '面向右侧交谈'),
      makeCharacter('角色B', 0.24, 0.05, 250, '面向左侧交谈'),
    ]
    Object.assign(camera, { shotSize: 'full', focalLength: 35, angle: 'eye' })
  } else if (key === 'ots') {
    items = [
      makeCharacter('前景角色', 0.16, 0.4, 0, '背对镜头，过肩'),
      makeCharacter('主角', -0.12, -0.2, 190, '面向镜头说话'),
    ]
    Object.assign(camera, { shotSize: 'medium', focalLength: 50, angle: 'eye' })
  } else {
    items = [
      makeCharacter('角色A', -0.45, -0.05, 175, '站立'),
      makeCharacter('角色B', 0, -0.2, 180, '站立'),
      makeCharacter('角色C', 0.45, -0.05, 185, '站立'),
    ]
    Object.assign(camera, { shotSize: 'wide', focalLength: 28, angle: 'eye' })
  }
  const first = items[0]
  return { ...base, items, camera, activeId: first ? first.id : 'camera' }
}

type DragState = { targetId: string; mode: 'move' | 'rotate' }

export function CanvasDirectorStageModal({
  node,
  open,
  onClose,
  onSave,
  onInsertPrompt,
  onExportFraming,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: DirectorStageData, prompt: string) => Promise<void>
  onInsertPrompt?: (prompt: string) => Promise<void> | void
  onExportFraming?: (input: { dataUrl: string; prompt: string }) => Promise<void> | void
}) {
  const initial = useMemo(() => readDirectorStageData(node), [node])
  const [draft, setDraft] = useState<DirectorStageData>(initial)
  const [drag, setDrag] = useState<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // 父组件以 key={node.id} 渲染本弹窗，切换节点时重新挂载并用 initial 初始化。

  const prompt = useMemo(() => buildDirectorPrompt(draft), [draft])
  const projected = useMemo(() => projectFraming(draft), [draft])
  const fov = fovFromFocal(draft.camera.focalLength)

  const activeIsCamera = draft.activeId === 'camera'
  const activeItem = draft.items.find((item) => item.id === draft.activeId) ?? null

  const setActive = (id: string) => setDraft((d) => ({ ...d, activeId: id }))

  const updateItem = (id: string, patch: Partial<StageItem>) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))

  const updateCamera = (patch: Partial<StageCamera>) =>
    setDraft((d) => ({ ...d, camera: { ...d.camera, ...patch } }))

  const addItem = (kind: StageItemKind) => {
    const count = draft.items.filter((item) => item.kind === kind).length
    const item: StageItem = {
      id: makeId(kind),
      kind,
      name: kind === 'character' ? `角色${String.fromCharCode(65 + count)}` : `道具${count + 1}`,
      color: kind === 'character' ? CHARACTER_COLOR : PROP_COLOR,
      x: clamp(-0.4 + count * 0.3, -1, 1),
      z: kind === 'character' ? -0.1 : 0.25,
      facing: kind === 'character' ? 180 : 0,
      ...(kind === 'character' ? { note: '站立' } : {}),
    }
    setDraft((d) => ({ ...d, items: [...d.items, item], activeId: item.id }))
  }

  const duplicateActive = () => {
    if (!activeItem) return
    const copy: StageItem = {
      ...activeItem,
      id: makeId(activeItem.kind),
      name: `${activeItem.name} 副本`,
      x: clamp(activeItem.x + 0.2, -1, 1),
    }
    setDraft((d) => ({ ...d, items: [...d.items, copy], activeId: copy.id }))
  }

  const removeActive = () => {
    if (activeIsCamera || !activeItem) {
      message.warning('相机不可删除，请选中角色或道具')
      return
    }
    if (draft.items.length <= 1) {
      message.warning('至少保留一个画面主体')
      return
    }
    setDraft((d) => {
      const items = d.items.filter((item) => item.id !== activeItem.id)
      return { ...d, items, activeId: items[0]?.id ?? d.activeId }
    })
  }

  /** 朝向快捷：相对相机 */
  const setFacingRelToCamera = (mode: 'to' | 'away' | 'left' | 'right') => {
    if (!activeItem) return
    const toCam = headingDeg(draft.camera.x - activeItem.x, draft.camera.z - activeItem.z)
    const delta = mode === 'to' ? 0 : mode === 'away' ? 180 : mode === 'left' ? -90 : 90
    updateItem(activeItem.id, { facing: Math.round(normDeg(toCam + delta)) })
  }

  /** 相机对准选中对象 */
  const aimCameraAtActive = () => {
    if (!activeItem) return
    const facing = headingDeg(activeItem.x - draft.camera.x, activeItem.z - draft.camera.z)
    updateCamera({ facing: Math.round(facing) })
  }

  const pointerToPlan = (event: ReactPointerEvent): { px: number; py: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    return {
      px: ((event.clientX - rect.left) / rect.width) * 100,
      py: ((event.clientY - rect.top) / rect.height) * 100,
    }
  }

  const beginDrag = (targetId: string, mode: DragState['mode']) => (event: ReactPointerEvent) => {
    event.stopPropagation()
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    setActive(targetId)
    setDrag({ targetId, mode })
  }

  const handlePlanMove = (event: ReactPointerEvent) => {
    if (!drag) return
    const pt = pointerToPlan(event)
    if (!pt) return
    if (drag.mode === 'move') {
      const { x, z } = planToWorld(pt.px, pt.py)
      if (drag.targetId === 'camera') updateCamera({ x: round(x), z: round(z) })
      else updateItem(drag.targetId, { x: round(x), z: round(z) })
    } else {
      const center =
        drag.targetId === 'camera'
          ? worldToPlan(draft.camera.x, draft.camera.z)
          : (() => {
              const it = draft.items.find((i) => i.id === drag.targetId)
              return it ? worldToPlan(it.x, it.z) : null
            })()
      if (!center) return
      const facing = normDeg(headingDeg(pt.px - center.px, pt.py - center.py))
      if (drag.targetId === 'camera') updateCamera({ facing: Math.round(facing) })
      else updateItem(drag.targetId, { facing: Math.round(facing) })
    }
  }

  const endDrag = () => setDrag(null)

  const save = async () => {
    const next = { ...draft, prompt }
    await onSave(next, prompt)
    setDraft(next)
    message.success('画面编排已保存')
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt)
    message.success('已复制画面提示词')
  }

  const insertPrompt = async () => {
    if (!onInsertPrompt) return
    await onInsertPrompt(prompt)
  }

  const exportFraming = async () => {
    const dataUrl = renderFramingToDataUrl(draft)
    if (!dataUrl) {
      message.error('取景图渲染失败')
      return
    }
    if (onExportFraming) await onExportFraming({ dataUrl, prompt })
    else {
      const link = document.createElement('a')
      link.download = `${node?.title ?? 'framing'}.png`
      link.href = dataUrl
      link.click()
    }
  }

  // 相机视锥多边形点
  const camPlan = worldToPlan(draft.camera.x, draft.camera.z)
  const coneLen = 170
  const coneLeft = (() => {
    const v = headingVec(draft.camera.facing - fov / 2)
    return { px: camPlan.px + v.hx * coneLen, py: camPlan.py + v.hy * coneLen }
  })()
  const coneRight = (() => {
    const v = headingVec(draft.camera.facing + fov / 2)
    return { px: camPlan.px + v.hx * coneLen, py: camPlan.py + v.hy * coneLen }
  })()
  const rotateHandleFor = (px: number, py: number, facing: number) => {
    const v = headingVec(facing)
    return { hx: px + v.hx * 9, hy: py + v.hy * 9 }
  }

  // 预览画框比例
  const ratio = ASPECT_RATIO[draft.camera.aspect]
  const VW = 160
  const VH = Math.round(VW / ratio)
  const horizonFrac = horizonFor(draft.camera.angle)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width="94vw"
      className="canvas-director-stage-modal"
      title={
        <span className="canvas-director-stage-modal-title">
          <Icons.Play size={16} /> 2D 导演台
        </span>
      }
    >
      <div className="canvas-director-stage-shell">
        {/* 左：对象库 + 预设 */}
        <aside className="canvas-director-stage-tools">
          <div className="canvas-director-stage-section-title">快速预设</div>
          <div className="canvas-director-stage-presets">
            {PRESETS.map((preset) => (
              <button key={preset.key} onClick={() => setDraft((d) => applyPreset(preset.key, d))}>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="canvas-director-stage-section-title">添加对象</div>
          <div className="canvas-director-stage-add-row">
            <Button
              block
              size="middle"
              onClick={() => addItem('character')}
              icon={<Icons.User size={14} />}
            >
              角色
            </Button>
            <Button
              block
              size="middle"
              onClick={() => addItem('prop')}
              icon={<Icons.Box size={14} />}
            >
              道具
            </Button>
          </div>

          <div className="canvas-director-stage-section-title">对象列表</div>
          <div className="canvas-director-stage-object-list">
            <button className={activeIsCamera ? 'active' : ''} onClick={() => setActive('camera')}>
              <span className="sd-swatch sd-swatch-cam" style={{ color: CAMERA_COLOR }}>
                <Icons.Play size={11} />
              </span>
              相机
              <Tag>机位</Tag>
            </button>
            {draft.items.map((item) => (
              <button
                key={item.id}
                className={item.id === draft.activeId ? 'active' : ''}
                onClick={() => setActive(item.id)}
              >
                <span className="sd-swatch" style={{ background: item.color }}>
                  {item.kind === 'character' ? <Icons.User size={11} /> : <Icons.Box size={11} />}
                </span>
                {item.name}
                <Tag>{item.kind === 'character' ? '角色' : '道具'}</Tag>
              </button>
            ))}
          </div>
          <div className="canvas-director-stage-add-row">
            <Button
              block
              size="middle"
              onClick={duplicateActive}
              disabled={activeIsCamera || !activeItem}
              icon={<Icons.Copy size={13} />}
            >
              复制
            </Button>
            <Button
              block
              size="middle"
              danger
              onClick={removeActive}
              disabled={activeIsCamera}
              icon={<Icons.Trash size={13} />}
            >
              删除
            </Button>
          </div>
          <div className="canvas-director-stage-tip">
            拖动图标改站位，拖动小圆点改朝向；橙色锥形即相机取景范围。
          </div>
        </aside>

        {/* 中：俯视编排 + 取景预览 */}
        <div className="canvas-director-stage-center">
          <div className="canvas-director-stage-viewport">
            <div className="canvas-director-stage-view-label">俯视编排 · 舞台调度</div>
            <svg
              ref={svgRef}
              className="canvas-director-stage-plan"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              onPointerMove={handlePlanMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            >
              <defs>
                <clipPath id="stage-clip">
                  <rect x="10" y="10" width="80" height="80" rx="3" />
                </clipPath>
              </defs>

              <rect
                x="10"
                y="10"
                width="80"
                height="80"
                rx="3"
                className="canvas-director-stage-floor"
              />
              <g clipPath="url(#stage-clip)" className="canvas-director-stage-gridlines">
                {[20, 30, 40, 50, 60, 70, 80].map((v) => (
                  <line key={`gx-${v}`} x1={v} y1="10" x2={v} y2="90" />
                ))}
                {[20, 30, 40, 50, 60, 70, 80].map((v) => (
                  <line key={`gy-${v}`} x1="10" y1={v} x2="90" y2={v} />
                ))}
              </g>
              <line x1="50" y1="47" x2="50" y2="53" className="canvas-director-stage-axis" />
              <line x1="47" y1="50" x2="53" y2="50" className="canvas-director-stage-axis" />

              <text x="50" y="8" className="canvas-director-stage-dir">
                远
              </text>
              <text x="50" y="97" className="canvas-director-stage-dir">
                近（相机侧）
              </text>
              <text x="6" y="51" className="canvas-director-stage-dir" transform="rotate(-90 6 51)">
                左
              </text>
              <text
                x="94"
                y="51"
                className="canvas-director-stage-dir"
                transform="rotate(90 94 51)"
              >
                右
              </text>

              {/* 相机视锥 */}
              <polygon
                clipPath="url(#stage-clip)"
                points={`${camPlan.px},${camPlan.py} ${coneLeft.px},${coneLeft.py} ${coneRight.px},${coneRight.py}`}
                className="canvas-director-stage-cone"
              />

              {/* 对象（人形 / 道具图标） */}
              {draft.items.map((item) => {
                const pos = worldToPlan(item.x, item.z)
                const active = item.id === draft.activeId
                const handle = rotateHandleFor(pos.px, pos.py, item.facing)
                return (
                  <g key={item.id} className={active ? 'sd-obj active' : 'sd-obj'}>
                    {active && (
                      <>
                        <line
                          x1={pos.px}
                          y1={pos.py}
                          x2={handle.hx}
                          y2={handle.hy}
                          className="canvas-director-stage-handle-stem"
                        />
                        <circle
                          cx={handle.hx}
                          cy={handle.hy}
                          r={1.5}
                          className="canvas-director-stage-rotate-handle"
                          onPointerDown={beginDrag(item.id, 'rotate')}
                        />
                      </>
                    )}
                    <g
                      transform={`translate(${pos.px} ${pos.py}) rotate(${item.facing})`}
                      className="canvas-director-stage-glyph"
                      style={{ color: item.color }}
                      onPointerDown={beginDrag(item.id, 'move')}
                    >
                      {active && <circle r={6.2} className="canvas-director-stage-sel-ring" />}
                      {item.kind === 'character' ? (
                        <>
                          <ellipse
                            cx={0}
                            cy={1.4}
                            rx={3.1}
                            ry={2.2}
                            fill="currentColor"
                            opacity={0.92}
                          />
                          <circle cx={0} cy={-1.7} r={2.2} fill="currentColor" />
                          <path
                            d="M0,-4.4 L1.3,-2.4 L-1.3,-2.4 Z"
                            className="canvas-director-stage-nose"
                          />
                        </>
                      ) : (
                        <rect
                          x={-2.7}
                          y={-2.7}
                          width={5.4}
                          height={5.4}
                          rx={1.2}
                          fill="currentColor"
                        />
                      )}
                    </g>
                    <text x={pos.px} y={pos.py + 9} className="canvas-director-stage-obj-label">
                      {item.name}
                    </text>
                  </g>
                )
              })}

              {/* 相机（摄像机图标） */}
              <g className={activeIsCamera ? 'sd-obj active' : 'sd-obj'}>
                {activeIsCamera &&
                  (() => {
                    const handle = rotateHandleFor(camPlan.px, camPlan.py, draft.camera.facing)
                    return (
                      <>
                        <line
                          x1={camPlan.px}
                          y1={camPlan.py}
                          x2={handle.hx}
                          y2={handle.hy}
                          className="canvas-director-stage-handle-stem"
                        />
                        <circle
                          cx={handle.hx}
                          cy={handle.hy}
                          r={1.5}
                          className="canvas-director-stage-rotate-handle"
                          onPointerDown={beginDrag('camera', 'rotate')}
                        />
                      </>
                    )
                  })()}
                <g
                  transform={`translate(${camPlan.px} ${camPlan.py}) rotate(${draft.camera.facing})`}
                  className="canvas-director-stage-glyph"
                  style={{ color: CAMERA_COLOR }}
                  onPointerDown={beginDrag('camera', 'move')}
                >
                  {activeIsCamera && <circle r={6.4} className="canvas-director-stage-sel-ring" />}
                  <rect x={-3} y={-1.2} width={6} height={4} rx={1} fill="currentColor" />
                  <rect x={-1.6} y={-4.4} width={3.2} height={3.2} rx={0.7} fill="currentColor" />
                  <path d="M0,-5.6 L1.1,-4.2 L-1.1,-4.2 Z" className="canvas-director-stage-nose" />
                </g>
                <text x={camPlan.px} y={camPlan.py + 9} className="canvas-director-stage-obj-label">
                  相机
                </text>
              </g>
            </svg>
          </div>

          {/* 取景预览 */}
          <div className="canvas-director-stage-preview">
            <div className="canvas-director-stage-view-label">
              相机取景预览 · {SHOT_SIZE_LABEL[draft.camera.shotSize]} /{' '}
              {ANGLE_LABEL[draft.camera.angle]} / {Math.round(draft.camera.focalLength)}mm /{' '}
              {draft.camera.aspect}
            </div>
            <div className="canvas-director-stage-frame-wrap">
              <svg
                className="canvas-director-stage-frame"
                viewBox={`0 0 ${VW} ${VH}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ aspectRatio: `${ratio}` }}
              >
                <rect x={0} y={0} width={VW} height={VH} className="sd-frame-bg" />
                <rect
                  x={0}
                  y={horizonFrac * VH}
                  width={VW}
                  height={VH - horizonFrac * VH}
                  className="sd-frame-ground"
                />
                <line
                  x1={0}
                  y1={horizonFrac * VH}
                  x2={VW}
                  y2={horizonFrac * VH}
                  className="sd-frame-horizon"
                />
                {[1, 2].map((i) => (
                  <line
                    key={`tv-${i}`}
                    x1={(VW * i) / 3}
                    y1={0}
                    x2={(VW * i) / 3}
                    y2={VH}
                    className="sd-frame-third"
                  />
                ))}
                {[1, 2].map((i) => (
                  <line
                    key={`th-${i}`}
                    x1={0}
                    y1={(VH * i) / 3}
                    x2={VW}
                    y2={(VH * i) / 3}
                    className="sd-frame-third"
                  />
                ))}
                {projected.map((p) => {
                  if (!p.inFrame) return null
                  const cx = p.u * VW
                  const footY = horizonFrac * VH + (VH - horizonFrac * VH) * (1 - p.depth)
                  const figH =
                    clamp(p.scale * SHOT_SIZE_FILL[draft.camera.shotSize], 0.12, 4) * VH * 0.62
                  return (
                    <g key={p.id}>
                      {p.kind === 'character' ? (
                        <>
                          <path d={personBodyPath(cx, footY, figH)} fill={p.color} opacity={0.95} />
                          <circle {...personHead(cx, footY, figH)} fill={p.color} />
                        </>
                      ) : (
                        <rect
                          x={cx - figH * 0.31}
                          y={footY - figH * 0.7}
                          width={figH * 0.62}
                          height={figH * 0.7}
                          rx={figH * 0.1}
                          fill={p.color}
                        />
                      )}
                      <text x={cx} y={footY - figH - 3} className="sd-frame-label">
                        {p.name}
                      </text>
                    </g>
                  )
                })}
              </svg>
              {projected
                .filter((p) => !p.inFrame)
                .map((p) => (
                  <div
                    key={p.id}
                    className={`canvas-director-stage-offscreen ${p.u < 0.5 ? 'left' : 'right'}`}
                  >
                    {p.u < 0.5 ? '◂ ' : ''}
                    {p.name} 出画
                    {p.u >= 0.5 ? ' ▸' : ''}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* 右：检视器 + 输出 */}
        <aside className="canvas-director-stage-inspector">
          {activeIsCamera ? (
            <>
              <div className="canvas-director-stage-section-title">相机参数</div>
              <label className="sd-field">
                <span>景别</span>
                <Segmented
                  size="middle"
                  block
                  value={draft.camera.shotSize}
                  onChange={(value) => updateCamera({ shotSize: value as CameraShotSize })}
                  options={[
                    { label: '远景', value: 'wide' },
                    { label: '全景', value: 'full' },
                    { label: '中景', value: 'medium' },
                    { label: '特写', value: 'closeup' },
                  ]}
                />
              </label>
              <label className="sd-field">
                <span>机位角度</span>
                <Segmented
                  size="middle"
                  block
                  value={draft.camera.angle}
                  onChange={(value) => updateCamera({ angle: value as CameraAngle })}
                  options={[
                    { label: '平视', value: 'eye' },
                    { label: '俯视', value: 'high' },
                    { label: '仰视', value: 'low' },
                  ]}
                />
              </label>
              <label className="sd-field">
                <span>画幅</span>
                <Segmented
                  size="middle"
                  block
                  value={draft.camera.aspect}
                  onChange={(value) => updateCamera({ aspect: value as CameraAspect })}
                  options={ASPECT_VALUES.map((v) => ({ label: v, value: v }))}
                />
              </label>
              <label className="sd-field">
                <span>灯光</span>
                <Segmented
                  size="middle"
                  block
                  value={draft.camera.lighting}
                  onChange={(value) => updateCamera({ lighting: value as CameraLighting })}
                  options={LIGHTING_VALUES.map((v) => ({ label: LIGHTING_LABEL[v], value: v }))}
                />
              </label>
              <label className="sd-field">
                <span>
                  焦段 {Math.round(draft.camera.focalLength)}mm · 视角 {Math.round(fov)}°
                </span>
                <Slider
                  min={14}
                  max={135}
                  value={draft.camera.focalLength}
                  onChange={(value) => updateCamera({ focalLength: value })}
                  tooltip={{ formatter: (v) => `${v}mm` }}
                />
              </label>
              <div className="canvas-director-stage-hint-row">
                焦段越长视角越窄、压缩感越强；越短视野越广。
              </div>
            </>
          ) : activeItem ? (
            <>
              <div className="canvas-director-stage-section-title">对象参数</div>
              <label className="sd-field">
                <span>名称</span>
                <Input
                  size="middle"
                  value={activeItem.name}
                  onChange={(e) => updateItem(activeItem.id, { name: e.target.value })}
                />
              </label>
              {activeItem.kind === 'character' && (
                <label className="sd-field">
                  <span>朝向快捷</span>
                  <div className="canvas-director-stage-chip-row">
                    <button onClick={() => setFacingRelToCamera('to')}>面向镜头</button>
                    <button onClick={() => setFacingRelToCamera('away')}>背对镜头</button>
                    <button onClick={() => setFacingRelToCamera('left')}>侧身左</button>
                    <button onClick={() => setFacingRelToCamera('right')}>侧身右</button>
                  </div>
                </label>
              )}
              <label className="sd-field">
                <span>朝向 {Math.round(activeItem.facing)}°</span>
                <Slider
                  min={-180}
                  max={180}
                  value={activeItem.facing}
                  onChange={(value) => updateItem(activeItem.id, { facing: value })}
                  tooltip={{ formatter: (v) => `${v}°` }}
                />
              </label>
              <div className="sd-coord-row">
                <label className="sd-field">
                  <span>左右</span>
                  <Slider
                    min={-1}
                    max={1}
                    step={0.05}
                    value={activeItem.x}
                    onChange={(value) => updateItem(activeItem.id, { x: value })}
                  />
                </label>
                <label className="sd-field">
                  <span>远近</span>
                  <Slider
                    min={-1}
                    max={1}
                    step={0.05}
                    value={activeItem.z}
                    onChange={(value) => updateItem(activeItem.id, { z: value })}
                  />
                </label>
              </div>
              <Button size="middle" block onClick={aimCameraAtActive} icon={<Icons.Eye size={13} />}>
                相机对准此对象
              </Button>
              {activeItem.kind === 'character' && (
                <label className="sd-field">
                  <span>姿势 / 动作</span>
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={activeItem.note}
                    onChange={(e) => updateItem(activeItem.id, { note: e.target.value })}
                    placeholder="例如：双手抱胸，侧头看向左方"
                  />
                </label>
              )}
            </>
          ) : null}

          <div className="canvas-director-stage-section-title">画面与输出</div>
          <label className="sd-field">
            <span>场景一句话</span>
            <Input
              size="middle"
              value={draft.sceneBrief ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, sceneBrief: e.target.value }))}
              placeholder="例如：黄昏的咖啡馆窗边"
            />
          </label>
          <Input.TextArea
            className="canvas-director-stage-prompt"
            value={prompt}
            autoSize={{ minRows: 4, maxRows: 8 }}
            readOnly
          />
          <div className="canvas-director-stage-actions">
            <Tooltip title="复制提示词到剪贴板">
              <Button size="middle" onClick={copyPrompt} icon={<Icons.Copy size={13} />}>
                复制
              </Button>
            </Tooltip>
            {onInsertPrompt && (
              <Tooltip title="在画布插入文本提示词节点">
                <Button size="middle" onClick={insertPrompt} icon={<Icons.File size={13} />}>
                  提示词节点
                </Button>
              </Tooltip>
            )}
            <Tooltip title="把取景预览作为图像节点插入画布">
              <Button size="middle" onClick={exportFraming} icon={<Icons.Image size={13} />}>
                图像节点
              </Button>
            </Tooltip>
            <Button size="middle" type="primary" onClick={save} icon={<Icons.Check size={13} />}>
              保存
            </Button>
          </div>
        </aside>
      </div>
    </Modal>
  )
}
