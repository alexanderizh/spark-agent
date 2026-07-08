import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, Select, message } from 'antd'
import { Icons } from '../../Icons'

type ShotSubjectKind = 'character' | 'prop'
type ShotLayer = 'foreground' | 'midground' | 'background'
type CameraShotSize = 'wide' | 'full' | 'medium' | 'close-up'
type CameraAngle = 'eye-level' | 'high-angle' | 'low-angle' | 'top-down'
type CameraMove = 'static' | 'dolly-in' | 'dolly-out' | 'tracking' | 'orbit' | 'crane-up'
type PromptMode = 'image' | 'video'
type ShotPreviewMode = 'top' | 'camera3d'

export type ShotSubject = {
  id: string
  kind: ShotSubjectKind
  name: string
  description: string
  x: number
  y: number
  z: number
  facing: number
  layer: ShotLayer
}

export type ShotCameraState = {
  x: number
  y: number
  z: number
  target: string
  shotSize: CameraShotSize
  angle: CameraAngle
  focalLength: number
  composition: string
  movement: CameraMove
}

export type ShotCameraKeyframe = {
  id: string
  time: number
  x: number
  y: number
  z: number
  target: string
  movement: CameraMove
}

export type CanvasShotDirectorShot = {
  id: string
  title: string
  durationSec: number
  sceneBrief: string
  subjects: ShotSubject[]
  camera: ShotCameraState
  keyframes: ShotCameraKeyframe[]
  promptMode: PromptMode
  updatedAt?: string
}

export type CanvasShotDirectorDraft = {
  version: 1
  activeShotId: string
  shots: CanvasShotDirectorShot[]
  sceneBrief: string
  subjects: ShotSubject[]
  camera: ShotCameraState
  keyframes: ShotCameraKeyframe[]
  promptMode: PromptMode
  updatedAt?: string
}

export type CanvasShotDirectorScreenshotInput = {
  dataUrl: string
  prompt: string
  draft: CanvasShotDirectorDraft
}

type DragTarget =
  | { type: 'subject'; id: string }
  | { type: 'camera' }
  | { type: 'keyframe'; id: string }

type ShotPreset = 'standoff' | 'over-shoulder' | 'dolly-reveal' | 'orbit-group'
type CompositionTone = 'green' | 'blue' | 'orange' | 'red'
type CompositionIssue = {
  id: string
  level: 'warn' | 'danger'
  label: string
}
type CompositionAnalysis = {
  score: number
  label: string
  tone: CompositionTone
  issues: CompositionIssue[]
}
type PercentPoint = { x: number; y: number }

const SHOT_SIZE_LABEL: Record<CameraShotSize, string> = {
  wide: '远景',
  full: '全身',
  medium: '中景',
  'close-up': '特写',
}

const ANGLE_LABEL: Record<CameraAngle, string> = {
  'eye-level': '平视',
  'high-angle': '俯拍',
  'low-angle': '仰拍',
  'top-down': '顶拍',
}

const MOVE_LABEL: Record<CameraMove, string> = {
  static: '固定',
  'dolly-in': '推进',
  'dolly-out': '拉远',
  tracking: '跟拍',
  orbit: '环绕',
  'crane-up': '升降',
}

const LAYER_LABEL: Record<ShotLayer, string> = {
  foreground: '前景',
  midground: '中景',
  background: '背景',
}

const initialSubjects: ShotSubject[] = [
  {
    id: 'subject-a',
    kind: 'character',
    name: '主角',
    description: '站在画面左前方，面向对手，情绪克制',
    x: 34,
    y: 58,
    z: 0,
    facing: 20,
    layer: 'foreground',
  },
  {
    id: 'subject-b',
    kind: 'character',
    name: '对手',
    description: '站在画面右后方，回望主角',
    x: 68,
    y: 36,
    z: 0,
    facing: 205,
    layer: 'midground',
  },
]

const initialCamera: ShotCameraState = {
  x: 50,
  y: 88,
  z: 1.6,
  target: 'subject-a',
  shotSize: 'medium',
  angle: 'eye-level',
  focalLength: 35,
  composition: '三角构图，主体落在三分线交点，保留运动方向空间',
  movement: 'dolly-in',
}

const initialKeyframes: ShotCameraKeyframe[] = [
  { id: 'kf-0', time: 0, x: 50, y: 88, z: 1.6, target: '主角', movement: 'dolly-in' },
  { id: 'kf-1', time: 4, x: 46, y: 62, z: 1.5, target: '主角与对手之间', movement: 'dolly-in' },
]

const defaultDraft: CanvasShotDirectorDraft = {
  version: 1,
  activeShotId: 'shot-1',
  shots: [],
  sceneBrief: '夜晚室内对峙场景，空气紧张，电影感布光',
  subjects: initialSubjects,
  camera: initialCamera,
  keyframes: initialKeyframes,
  promptMode: 'video',
}

const defaultShot: CanvasShotDirectorShot = {
  id: 'shot-1',
  title: '镜头 1',
  durationSec: 4,
  sceneBrief: defaultDraft.sceneBrief,
  subjects: initialSubjects,
  camera: initialCamera,
  keyframes: initialKeyframes,
  promptMode: 'video',
}

function cloneDraft(draft: CanvasShotDirectorDraft): CanvasShotDirectorDraft {
  return {
    ...draft,
    camera: { ...draft.camera },
    subjects: draft.subjects.map((subject) => ({ ...subject })),
    keyframes: draft.keyframes.map((keyframe) => ({ ...keyframe })),
    shots: draft.shots.map(cloneShot),
  }
}

function cloneShot(shot: CanvasShotDirectorShot): CanvasShotDirectorShot {
  return {
    ...shot,
    camera: { ...shot.camera },
    subjects: shot.subjects.map((subject) => ({ ...subject })),
    keyframes: shot.keyframes.map((keyframe) => ({ ...keyframe })),
  }
}

function shotToDraftFields(shot: CanvasShotDirectorShot): Pick<
  CanvasShotDirectorDraft,
  'sceneBrief' | 'subjects' | 'camera' | 'keyframes' | 'promptMode'
> {
  return {
    sceneBrief: shot.sceneBrief,
    subjects: shot.subjects.map((subject) => ({ ...subject })),
    camera: { ...shot.camera },
    keyframes: shot.keyframes.map((keyframe) => ({ ...keyframe })),
    promptMode: shot.promptMode,
  }
}

function draftToShot(draft: CanvasShotDirectorDraft, shot?: CanvasShotDirectorShot): CanvasShotDirectorShot {
  return {
    id: shot?.id ?? draft.activeShotId,
    title: shot?.title ?? `镜头 ${draft.shots.length + 1}`,
    durationSec: shot?.durationSec ?? estimateShotDuration(draft.keyframes),
    sceneBrief: draft.sceneBrief,
    subjects: draft.subjects.map((subject) => ({ ...subject })),
    camera: { ...draft.camera },
    keyframes: draft.keyframes.map((keyframe) => ({ ...keyframe })),
    promptMode: draft.promptMode,
    ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
  }
}

function syncActiveShot(draft: CanvasShotDirectorDraft): CanvasShotDirectorDraft {
  const activeShot = draft.shots.find((shot) => shot.id === draft.activeShotId)
  const nextShot = draftToShot(draft, activeShot)
  const nextShots = draft.shots.some((shot) => shot.id === nextShot.id)
    ? draft.shots.map((shot) => (shot.id === nextShot.id ? nextShot : shot))
    : [...draft.shots, nextShot]
  return { ...draft, shots: nextShots }
}

function normalizeDraft(
  draft: Partial<CanvasShotDirectorDraft> | null | undefined,
): CanvasShotDirectorDraft {
  if (!draft) {
    const shot = cloneShot(defaultShot)
    return { ...cloneDraft(defaultDraft), ...shotToDraftFields(shot), activeShotId: shot.id, shots: [shot] }
  }
  const legacyShot = normalizeShot({
    id: typeof draft.activeShotId === 'string' ? draft.activeShotId : 'shot-1',
    title: '镜头 1',
    durationSec: estimateShotDuration(draft.keyframes),
    sceneBrief: draft.sceneBrief ?? defaultDraft.sceneBrief,
    subjects: draft.subjects ?? defaultDraft.subjects,
    camera: draft.camera ?? defaultDraft.camera,
    keyframes: draft.keyframes ?? defaultDraft.keyframes,
    promptMode: draft.promptMode ?? defaultDraft.promptMode,
    ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
  })
  const shots =
    Array.isArray(draft.shots) && draft.shots.length > 0
      ? draft.shots.map(normalizeShot)
      : [legacyShot]
  const activeShotId =
    typeof draft.activeShotId === 'string' && shots.some((shot) => shot.id === draft.activeShotId)
      ? draft.activeShotId
      : (shots[0]?.id ?? legacyShot.id)
  const activeShot = shots.find((shot) => shot.id === activeShotId) ?? shots[0] ?? legacyShot
  return {
    version: 1,
    activeShotId,
    shots,
    ...shotToDraftFields(activeShot),
    ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
  }
}

function normalizeShot(shot: Partial<CanvasShotDirectorShot>): CanvasShotDirectorShot {
  return {
    id: typeof shot.id === 'string' ? shot.id : makeId('shot'),
    title: typeof shot.title === 'string' && shot.title.trim() ? shot.title : '镜头',
    durationSec: Number.isFinite(shot.durationSec)
      ? Math.max(1, Number(shot.durationSec))
      : estimateShotDuration(shot.keyframes),
    sceneBrief: typeof shot.sceneBrief === 'string' ? shot.sceneBrief : defaultDraft.sceneBrief,
    subjects:
      Array.isArray(shot.subjects) && shot.subjects.length > 0
        ? shot.subjects.map(normalizeSubject)
        : defaultDraft.subjects.map((subject) => ({ ...subject })),
    camera: normalizeCamera(shot.camera),
    keyframes:
      Array.isArray(shot.keyframes) && shot.keyframes.length > 0
        ? shot.keyframes.map(normalizeKeyframe)
        : defaultDraft.keyframes.map((keyframe) => ({ ...keyframe })),
    promptMode: shot.promptMode === 'image' ? 'image' : 'video',
    ...(shot.updatedAt ? { updatedAt: shot.updatedAt } : {}),
  }
}

function normalizeSubject(subject: Partial<ShotSubject>): ShotSubject {
  return {
    id: typeof subject.id === 'string' ? subject.id : makeId('subject'),
    kind: subject.kind === 'prop' ? 'prop' : 'character',
    name: typeof subject.name === 'string' ? subject.name : '人物',
    description: typeof subject.description === 'string' ? subject.description : '',
    x: clampPercent(Number(subject.x ?? 50)),
    y: clampPercent(Number(subject.y ?? 50)),
    z: Number.isFinite(subject.z) ? Number(subject.z) : 0,
    facing: Number.isFinite(subject.facing) ? Number(subject.facing) : 0,
    layer:
      subject.layer === 'foreground' || subject.layer === 'background'
        ? subject.layer
        : 'midground',
  }
}

function normalizeCamera(camera: Partial<ShotCameraState> | undefined): ShotCameraState {
  return {
    ...defaultDraft.camera,
    ...(camera ?? {}),
    x: clampPercent(Number(camera?.x ?? defaultDraft.camera.x)),
    y: clampPercent(Number(camera?.y ?? defaultDraft.camera.y)),
    z: Number.isFinite(camera?.z) ? Number(camera?.z) : defaultDraft.camera.z,
    focalLength: Number.isFinite(camera?.focalLength)
      ? Number(camera?.focalLength)
      : defaultDraft.camera.focalLength,
  }
}

function normalizeKeyframe(keyframe: Partial<ShotCameraKeyframe>): ShotCameraKeyframe {
  return {
    id: typeof keyframe.id === 'string' ? keyframe.id : makeId('kf'),
    time: Number.isFinite(keyframe.time) ? Number(keyframe.time) : 0,
    x: clampPercent(Number(keyframe.x ?? 50)),
    y: clampPercent(Number(keyframe.y ?? 50)),
    z: Number.isFinite(keyframe.z) ? Number(keyframe.z) : 1.6,
    target: typeof keyframe.target === 'string' ? keyframe.target : '主体',
    movement: normalizeMove(keyframe.movement),
  }
}

function normalizeMove(value: unknown): CameraMove {
  if (
    value === 'static' ||
    value === 'dolly-in' ||
    value === 'dolly-out' ||
    value === 'tracking' ||
    value === 'orbit' ||
    value === 'crane-up'
  ) {
    return value
  }
  return 'static'
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.round(value), 0), 100)
}

function parseNumericInput(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function subjectKindLabel(kind: ShotSubjectKind): string {
  return kind === 'character' ? '人物' : '物件'
}

function activeTargetId(target: DragTarget | null): string {
  if (!target) return ''
  return target.type === 'camera' ? 'camera' : `${target.type}:${target.id}`
}

function getCameraTargetPoint(draft: CanvasShotDirectorDraft): { x: number; y: number } {
  const target = draft.subjects.find((subject) => subject.id === draft.camera.target)
  if (target) return { x: target.x, y: target.y }
  const firstKeyframe = draft.keyframes[0]
  if (firstKeyframe) return { x: firstKeyframe.x, y: firstKeyframe.y }
  return { x: 50, y: 50 }
}

function getCameraConeAngle(draft: CanvasShotDirectorDraft): number {
  const target = getCameraTargetPoint(draft)
  const angle = (Math.atan2(target.y - draft.camera.y, target.x - draft.camera.x) * 180) / Math.PI
  return angle - 90
}

function distancePercent(left: PercentPoint, right: PercentPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function nearestThirdPoint(point: PercentPoint): PercentPoint {
  const thirds = [
    { x: 33, y: 33 },
    { x: 67, y: 33 },
    { x: 33, y: 67 },
    { x: 67, y: 67 },
  ]
  return thirds.reduce((best, item) =>
    distancePercent(point, item) < distancePercent(point, best) ? item : best,
  )
}

function facingAngle(from: PercentPoint, to: PercentPoint): number {
  const radians = Math.atan2(to.x - from.x, from.y - to.y)
  return Math.round(((radians * 180) / Math.PI + 360) % 360)
}

function getTargetPoint(draft: CanvasShotDirectorDraft, target: DragTarget | null): PercentPoint {
  if (!target) return { x: draft.camera.x, y: draft.camera.y }
  if (target.type === 'camera') return { x: draft.camera.x, y: draft.camera.y }
  if (target.type === 'subject') {
    const subject = draft.subjects.find((item) => item.id === target.id)
    return subject ? { x: subject.x, y: subject.y } : { x: draft.camera.x, y: draft.camera.y }
  }
  const keyframe = draft.keyframes.find((item) => item.id === target.id)
  return keyframe ? { x: keyframe.x, y: keyframe.y } : { x: draft.camera.x, y: draft.camera.y }
}

function getActiveTargetLabel(draft: CanvasShotDirectorDraft, target: DragTarget | null): string {
  if (!target) return '镜头'
  if (target.type === 'camera') return '镜头'
  if (target.type === 'subject') {
    const subject = draft.subjects.find((item) => item.id === target.id)
    return subject ? subject.name : '占位'
  }
  const sorted = sortedKeyframes(draft.keyframes)
  const index = sorted.findIndex((item) => item.id === target.id)
  return index >= 0 ? `关键帧 ${index + 1}` : '关键帧'
}

function sortedKeyframes(keyframes: ShotCameraKeyframe[]): ShotCameraKeyframe[] {
  return keyframes.slice().sort((a, b) => a.time - b.time)
}

function estimateShotDuration(keyframes: Partial<ShotCameraKeyframe>[] | undefined): number {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return 4
  const maxTime = Math.max(
    1,
    ...keyframes.map((keyframe) => (Number.isFinite(keyframe.time) ? Number(keyframe.time) : 0)),
  )
  return Math.max(1, Math.ceil(maxTime))
}

function project3dY(y: number): number {
  return Math.round(20 + clampPercent(y) * 0.62)
}

function unproject3dY(y: number): number {
  return clampPercent((y - 20) / 0.62)
}

function getDepthScale(y: number): number {
  return Number((0.72 + clampPercent(y) * 0.006).toFixed(2))
}

function getLayerHeight(layer: ShotLayer): number {
  if (layer === 'foreground') return 74
  if (layer === 'background') return 38
  return 56
}

function buildCompositionAnalysis(draft: CanvasShotDirectorDraft): CompositionAnalysis {
  const issues: CompositionIssue[] = []
  let score = 100
  const addIssue = (issue: CompositionIssue, penalty: number) => {
    issues.push(issue)
    score -= penalty
  }

  if (!draft.sceneBrief.trim()) {
    addIssue({ id: 'scene-empty', level: 'warn', label: '场景意图偏弱' }, 8)
  }
  if (draft.subjects.length === 0) {
    addIssue({ id: 'subjects-empty', level: 'danger', label: '画面缺少人物或物件' }, 34)
  }

  const targetSubject = draft.subjects.find((subject) => subject.id === draft.camera.target)
  if (!targetSubject) {
    addIssue({ id: 'target-missing', level: 'warn', label: '镜头目标未锁定占位' }, 16)
  }

  if (draft.camera.movement !== 'static' && draft.keyframes.length < 2) {
    addIssue({ id: 'keyframes-short', level: 'warn', label: '运镜缺少起止关键帧' }, 12)
  }

  const layerSet = new Set(draft.subjects.map((subject) => subject.layer))
  if (draft.subjects.length >= 2 && (!layerSet.has('foreground') || !layerSet.has('background'))) {
    addIssue({ id: 'depth-flat', level: 'warn', label: '前中后景层次不够明显' }, 9)
  }

  for (let i = 0; i < draft.subjects.length; i += 1) {
    for (let j = i + 1; j < draft.subjects.length; j += 1) {
      const left = draft.subjects[i]
      const right = draft.subjects[j]
      if (!left || !right) continue
      if (distancePercent(left, right) < 9) {
        addIssue({ id: `overlap-${left.id}-${right.id}`, level: 'warn', label: '占位距离过近' }, 8)
        i = draft.subjects.length
        break
      }
    }
  }

  const primarySubject = targetSubject ?? draft.subjects[0]
  if (primarySubject && distancePercent(primarySubject, nearestThirdPoint(primarySubject)) > 25) {
    addIssue({ id: 'thirds-off', level: 'warn', label: '主体远离三分构图点' }, 6)
  }

  if (draft.camera.focalLength >= 70 && draft.camera.shotSize === 'wide') {
    addIssue({ id: 'lens-shot-mismatch', level: 'warn', label: '长焦远景空间感可能偏压缩' }, 5)
  }

  const normalizedScore = Math.max(24, Math.min(100, score))
  if (normalizedScore >= 88) return { score: normalizedScore, label: '稳', tone: 'green', issues }
  if (normalizedScore >= 74) return { score: normalizedScore, label: '可用', tone: 'blue', issues }
  if (normalizedScore >= 58) return { score: normalizedScore, label: '待调', tone: 'orange', issues }
  return { score: normalizedScore, label: '需重构', tone: 'red', issues }
}

function buildPrompt(input: CanvasShotDirectorDraft): { imagePrompt: string; videoPrompt: string } {
  const { sceneBrief, subjects, camera, keyframes } = input
  const subjectLines = subjects.map((subject) => {
    const layer = LAYER_LABEL[subject.layer]
    return `${subject.name}（${subjectKindLabel(subject.kind)}）位于${layer}，画面坐标约 x=${subject.x}, y=${subject.y}, 朝向 ${subject.facing} 度；${subject.description}`
  })
  const target =
    subjects.find((subject) => subject.id === camera.target)?.name || camera.target || '主体'
  const cameraLine = `镜头位于 x=${camera.x}, y=${camera.y}, 高度 ${camera.z}m，拍摄目标为${target}；${SHOT_SIZE_LABEL[camera.shotSize]}，${ANGLE_LABEL[camera.angle]}，${camera.focalLength}mm 焦段。`
  const compositionLine = `构图要求：${camera.composition}`
  const keyframeLines = sortedKeyframes(keyframes).map(
    (keyframe) =>
      `${keyframe.time}s: 相机到 x=${keyframe.x}, y=${keyframe.y}, 高度 ${keyframe.z}m，看向${keyframe.target}，${MOVE_LABEL[keyframe.movement]}。`,
  )

  return {
    imagePrompt: [
      sceneBrief || '电影感画面',
      ...subjectLines,
      cameraLine,
      compositionLine,
      '强调人物空间关系、镜头透视、清晰站位和可读的画面层次。',
    ].join('\n'),
    videoPrompt: [
      sceneBrief || '电影感视频镜头',
      ...subjectLines,
      cameraLine,
      compositionLine,
      `运镜类型：${MOVE_LABEL[camera.movement]}。`,
      keyframeLines.length > 0 ? `关键帧：\n${keyframeLines.join('\n')}` : '',
      '保持角色位置连续、镜头运动平稳、主体始终可读。',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

function applyPresetToDraft(
  draft: CanvasShotDirectorDraft,
  preset: ShotPreset,
): CanvasShotDirectorDraft {
  const base = cloneDraft(draft)
  const [first, second] = base.subjects
  if (preset === 'standoff') {
    return {
      ...base,
      subjects: base.subjects.map((subject, index) =>
        index === 0
          ? { ...subject, x: 32, y: 58, facing: 28, layer: 'foreground' }
          : index === 1
            ? { ...subject, x: 68, y: 38, facing: 210, layer: 'midground' }
            : subject,
      ),
      camera: {
        ...base.camera,
        x: 50,
        y: 88,
        target: first?.id ?? base.camera.target,
        shotSize: 'medium',
        angle: 'eye-level',
        focalLength: 35,
        movement: 'dolly-in',
        composition: '对峙三角构图，双方在画面两侧形成张力，镜头向主角缓慢推进',
      },
      keyframes: [
        { id: makeId('kf'), time: 0, x: 50, y: 90, z: 1.6, target: '主角', movement: 'dolly-in' },
        { id: makeId('kf'), time: 4, x: 48, y: 64, z: 1.5, target: '两人之间', movement: 'dolly-in' },
      ],
    }
  }
  if (preset === 'over-shoulder') {
    return {
      ...base,
      subjects: base.subjects.map((subject, index) =>
        index === 0
          ? { ...subject, x: 36, y: 72, facing: 20, layer: 'foreground' }
          : index === 1
            ? { ...subject, x: 64, y: 34, facing: 205, layer: 'midground' }
            : subject,
      ),
      camera: {
        ...base.camera,
        x: 30,
        y: 86,
        target: second?.id ?? first?.id ?? base.camera.target,
        shotSize: 'medium',
        angle: 'eye-level',
        focalLength: 50,
        movement: 'static',
        composition: '过肩构图，前景人物肩部形成遮挡，焦点落在对话对象表情',
      },
      keyframes: [
        { id: makeId('kf'), time: 0, x: 30, y: 86, z: 1.65, target: '对话对象', movement: 'static' },
      ],
    }
  }
  if (preset === 'dolly-reveal') {
    return {
      ...base,
      camera: {
        ...base.camera,
        x: 52,
        y: 96,
        target: first?.id ?? base.camera.target,
        shotSize: 'wide',
        angle: 'low-angle',
        focalLength: 28,
        movement: 'dolly-in',
        composition: '从前景遮挡推进揭示主体，保留背景环境信息',
      },
      keyframes: [
        { id: makeId('kf'), time: 0, x: 52, y: 96, z: 1.2, target: '前景遮挡', movement: 'dolly-in' },
        { id: makeId('kf'), time: 3, x: 50, y: 66, z: 1.4, target: '主体', movement: 'dolly-in' },
        { id: makeId('kf'), time: 5, x: 48, y: 52, z: 1.55, target: '主体表情', movement: 'dolly-in' },
      ],
    }
  }
  return {
    ...base,
    subjects: base.subjects.map((subject, index) =>
      index === 0
        ? { ...subject, x: 48, y: 50, facing: 0, layer: 'midground' }
        : index === 1
          ? { ...subject, x: 62, y: 44, facing: 180, layer: 'midground' }
          : subject,
    ),
    camera: {
      ...base.camera,
      x: 50,
      y: 82,
      target: first?.id ?? base.camera.target,
      shotSize: 'wide',
      angle: 'high-angle',
      focalLength: 24,
      movement: 'orbit',
      composition: '群像环绕构图，人物围绕画面中心形成关系网络',
    },
    keyframes: [
      { id: makeId('kf'), time: 0, x: 50, y: 82, z: 2.2, target: '群像中心', movement: 'orbit' },
      { id: makeId('kf'), time: 2, x: 76, y: 56, z: 2.1, target: '群像中心', movement: 'orbit' },
      { id: makeId('kf'), time: 4, x: 50, y: 24, z: 2.0, target: '群像中心', movement: 'orbit' },
    ],
  }
}

function rebalanceSubjectsInDraft(draft: CanvasShotDirectorDraft): CanvasShotDirectorDraft {
  const placements: Array<PercentPoint & { layer: ShotLayer }> =
    draft.subjects.length <= 1
      ? [{ x: 50, y: 50, layer: 'midground' }]
      : draft.subjects.length === 2
        ? [
            { x: 34, y: 60, layer: 'foreground' },
            { x: 66, y: 40, layer: 'background' },
          ]
        : draft.subjects.length === 3
          ? [
              { x: 34, y: 62, layer: 'foreground' },
              { x: 66, y: 58, layer: 'midground' },
              { x: 50, y: 34, layer: 'background' },
            ]
          : draft.subjects.map((_, index) => {
              const angle = -Math.PI / 2 + (index / draft.subjects.length) * Math.PI * 2
              const radiusX = 26
              const radiusY = 22
              return {
                x: Math.round(50 + Math.cos(angle) * radiusX),
                y: Math.round(52 + Math.sin(angle) * radiusY),
                layer: index % 3 === 0 ? 'foreground' : index % 3 === 1 ? 'midground' : 'background',
              }
            })

  const center: PercentPoint & { layer: ShotLayer } = { x: 50, y: 50, layer: 'midground' }
  const subjects = draft.subjects.map((subject, index) => {
    const placement = placements[index] ?? placements[placements.length - 1] ?? center
    return {
      ...subject,
      x: placement.x,
      y: placement.y,
      layer: placement.layer,
      facing: facingAngle(placement, center),
    }
  })

  const first = subjects[0]
  return {
    ...draft,
    subjects,
    camera: {
      ...draft.camera,
      x: 50,
      y: 88,
      target: first?.id ?? draft.camera.target,
      composition: '主体关系重新整理为清晰的前中后景构图，保留画面纵深和运动方向空间',
    },
    keyframes:
      draft.camera.movement === 'static'
        ? draft.keyframes
        : [
            { id: makeId('kf'), time: 0, x: 50, y: 90, z: draft.camera.z, target: first?.name ?? '主体', movement: draft.camera.movement },
            { id: makeId('kf'), time: 4, x: 50, y: 62, z: draft.camera.z, target: '主体关系中心', movement: draft.camera.movement },
          ],
  }
}

function stagePointFromPointer(
  event: { clientX: number; clientY: number },
  element: HTMLDivElement | null,
  mode: ShotPreviewMode,
): { x: number; y: number } | null {
  const rect = element?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const rawY = ((event.clientY - rect.top) / rect.height) * 100
  return {
    x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
    y: mode === 'camera3d' ? unproject3dY(rawY) : clampPercent(rawY),
  }
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const chars = Array.from(text)
  let line = ''
  let lineCount = 0
  let currentY = y
  for (const char of chars) {
    const next = `${line}${char}`
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, currentY)
      currentY += lineHeight
      line = char
      lineCount += 1
      if (lineCount >= maxLines) return currentY
    } else {
      line = next
    }
  }
  if (line && lineCount < maxLines) {
    ctx.fillText(line, x, currentY)
    currentY += lineHeight
  }
  return currentY
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  opts: { x: number; y: number; radius: number; fill: string; label: string },
) {
  ctx.beginPath()
  ctx.arc(opts.x, opts.y, opts.radius, 0, Math.PI * 2)
  ctx.fillStyle = opts.fill
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.82)'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(opts.label.slice(0, 2), opts.x, opts.y)
}

function renderShotDirectorPreviewToDataUrl(draft: CanvasShotDirectorDraft): string {
  const width = 1280
  const height = 720
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
  ctx.lineWidth = 1
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)'
  ctx.lineWidth = 2
  for (const x of [width / 3, (width / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (const y of [height / 3, (height / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  const cameraX = (draft.camera.x / 100) * width
  const cameraY = (draft.camera.y / 100) * height
  const target = getCameraTargetPoint(draft)
  const targetX = (target.x / 100) * width
  const targetY = (target.y / 100) * height
  const angle = Math.atan2(targetY - cameraY, targetX - cameraX)
  const length = 280
  const halfWidth = 150
  const endX = cameraX + Math.cos(angle) * length
  const endY = cameraY + Math.sin(angle) * length
  const perpX = Math.cos(angle + Math.PI / 2) * halfWidth
  const perpY = Math.sin(angle + Math.PI / 2) * halfWidth

  ctx.beginPath()
  ctx.moveTo(cameraX, cameraY)
  ctx.lineTo(endX + perpX, endY + perpY)
  ctx.lineTo(endX - perpX, endY - perpY)
  ctx.closePath()
  ctx.fillStyle = 'rgba(34, 211, 238, 0.18)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.58)'
  ctx.stroke()

  const keyframes = sortedKeyframes(draft.keyframes)
  if (keyframes.length > 0) {
    ctx.beginPath()
    keyframes.forEach((keyframe, index) => {
      const x = (keyframe.x / 100) * width
      const y = (keyframe.y / 100) * height
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.86)'
    ctx.lineWidth = 5
    ctx.stroke()
  }

  draft.subjects.forEach((subject) => {
    drawMarker(ctx, {
      x: (subject.x / 100) * width,
      y: (subject.y / 100) * height,
      radius: 24,
      fill: subject.kind === 'character' ? '#16a34a' : '#ea580c',
      label: subject.name,
    })
  })

  keyframes.forEach((keyframe, index) => {
    drawMarker(ctx, {
      x: (keyframe.x / 100) * width,
      y: (keyframe.y / 100) * height,
      radius: 15,
      fill: '#fb7185',
      label: String(index + 1),
    })
  })

  drawMarker(ctx, { x: cameraX, y: cameraY, radius: 22, fill: '#0891b2', label: '机' })

  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
  ctx.fillRect(24, 24, 560, 122)
  ctx.fillStyle = '#f8fafc'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('分镜导演台构图', 48, 64)
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '18px sans-serif'
  wrapCanvasText(ctx, draft.sceneBrief, 48, 96, 500, 24, 2)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '16px sans-serif'
  ctx.fillText(
    `${SHOT_SIZE_LABEL[draft.camera.shotSize]} / ${ANGLE_LABEL[draft.camera.angle]} / ${MOVE_LABEL[draft.camera.movement]} / ${draft.camera.focalLength}mm`,
    48,
    132,
  )

  return canvas.toDataURL('image/png')
}

export function CanvasShotDirectorPanel({
  open,
  initialDraft,
  onClose,
  onSaveDraft,
  onInsertPrompt,
  onInsertScreenshot,
}: {
  open: boolean
  initialDraft?: Partial<CanvasShotDirectorDraft> | null
  onClose: () => void
  onSaveDraft: (draft: CanvasShotDirectorDraft) => Promise<void> | void
  onInsertPrompt: (prompt: string) => Promise<void> | void
  onInsertScreenshot: (input: CanvasShotDirectorScreenshotInput) => Promise<void> | void
}) {
  const [draft, setDraft] = useState<CanvasShotDirectorDraft>(() => normalizeDraft(initialDraft))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTarget, setActiveTarget] = useState<DragTarget | null>({ type: 'camera' })
  const [previewMode, setPreviewMode] = useState<ShotPreviewMode>('camera3d')
  const stageRef = useRef<HTMLDivElement>(null)
  const dragTargetRef = useRef<DragTarget | null>(null)

  const prompt = useMemo(() => buildPrompt(draft), [draft])
  const activePrompt = draft.promptMode === 'image' ? prompt.imagePrompt : prompt.videoPrompt
  const cameraTargetOptions = draft.subjects.map((subject) => ({
    label: subject.name,
    value: subject.id,
  }))
  const activeId = activeTargetId(activeTarget)
  const activeShot = draft.shots.find((shot) => shot.id === draft.activeShotId) ?? draft.shots[0]
  const activeShotIndex = Math.max(
    0,
    draft.shots.findIndex((shot) => shot.id === draft.activeShotId),
  )
  const pathPoints = sortedKeyframes(draft.keyframes)
    .map((keyframe) => `${keyframe.x},${keyframe.y}`)
    .join(' ')
  const projectedPathPoints = sortedKeyframes(draft.keyframes)
    .map((keyframe) => `${keyframe.x},${project3dY(keyframe.y)}`)
    .join(' ')
  const targetPoint = getCameraTargetPoint(draft)
  const projectedTargetPoint = { x: targetPoint.x, y: project3dY(targetPoint.y) }
  const cameraConeAngle = getCameraConeAngle(draft)
  const composition = useMemo(() => buildCompositionAnalysis(draft), [draft])
  const activePoint = getTargetPoint(draft, activeTarget)
  const activeTargetLabel = getActiveTargetLabel(draft, activeTarget)
  const depthSortedSubjects = useMemo(
    () => draft.subjects.slice().sort((left, right) => left.y - right.y),
    [draft.subjects],
  )

  if (!open) return null

  const updateDraft = (updater: (current: CanvasShotDirectorDraft) => CanvasShotDirectorDraft) => {
    setDirty(true)
    setDraft((current) => syncActiveShot(updater(current)))
  }

  const switchShot = (shotId: string) => {
    setDirty(true)
    setActiveTarget({ type: 'camera' })
    setDraft((current) => {
      const synced = syncActiveShot(current)
      const nextShot = synced.shots.find((shot) => shot.id === shotId)
      if (!nextShot) return synced
      return {
        ...synced,
        activeShotId: nextShot.id,
        ...shotToDraftFields(nextShot),
      }
    })
  }

  const createShot = () => {
    setDirty(true)
    setActiveTarget({ type: 'camera' })
    setDraft((current) => {
      const synced = syncActiveShot(current)
      const index = synced.shots.length + 1
      const shot = normalizeShot({
        ...defaultShot,
        id: makeId('shot'),
        title: `镜头 ${index}`,
        sceneBrief: synced.sceneBrief,
        subjects: synced.subjects,
        camera: {
          ...synced.camera,
          x: 50,
          y: 88,
          movement: 'static',
        },
        keyframes: [
          {
            id: makeId('kf'),
            time: 0,
            x: 50,
            y: 88,
            z: synced.camera.z,
            target: synced.subjects[0]?.name ?? '主体',
            movement: 'static',
          },
        ],
      })
      return {
        ...synced,
        activeShotId: shot.id,
        shots: [...synced.shots, shot],
        ...shotToDraftFields(shot),
      }
    })
  }

  const duplicateActiveShot = () => {
    if (!activeShot) return
    setDirty(true)
    setActiveTarget({ type: 'camera' })
    setDraft((current) => {
      const synced = syncActiveShot(current)
      const source = synced.shots.find((shot) => shot.id === synced.activeShotId) ?? activeShot
      const copy = cloneShot({
        ...source,
        id: makeId('shot'),
        title: `${source.title} 副本`,
        updatedAt: new Date().toISOString(),
      })
      return {
        ...synced,
        activeShotId: copy.id,
        shots: [...synced.shots, copy],
        ...shotToDraftFields(copy),
      }
    })
  }

  const deleteActiveShot = () => {
    if (draft.shots.length <= 1 || !activeShot) return
    setDirty(true)
    setActiveTarget({ type: 'camera' })
    setDraft((current) => {
      const synced = syncActiveShot(current)
      const currentIndex = Math.max(
        0,
        synced.shots.findIndex((shot) => shot.id === synced.activeShotId),
      )
      const remaining = synced.shots.filter((shot) => shot.id !== synced.activeShotId)
      const nextShot = remaining[Math.min(currentIndex, remaining.length - 1)] ?? remaining[0]
      if (!nextShot) return synced
      return {
        ...synced,
        activeShotId: nextShot.id,
        shots: remaining,
        ...shotToDraftFields(nextShot),
      }
    })
  }

  const updateActiveShotMeta = (patch: Partial<Pick<CanvasShotDirectorShot, 'title' | 'durationSec'>>) => {
    updateDraft((current) => ({
      ...current,
      shots: current.shots.map((shot) =>
        shot.id === current.activeShotId ? { ...shot, ...patch } : shot,
      ),
    }))
  }

  const moveTargetToPoint = (target: DragTarget, point: PercentPoint) => {
    updateDraft((current) => {
      if (target.type === 'camera') {
        return { ...current, camera: { ...current.camera, x: point.x, y: point.y } }
      }
      if (target.type === 'subject') {
        return {
          ...current,
          subjects: current.subjects.map((subject) =>
            subject.id === target.id ? { ...subject, x: point.x, y: point.y } : subject,
          ),
        }
      }
      return {
        ...current,
        keyframes: current.keyframes.map((keyframe) =>
          keyframe.id === target.id ? { ...keyframe, x: point.x, y: point.y } : keyframe,
        ),
      }
    })
  }

  const updateDraftTarget = (
    target: DragTarget,
    event: { clientX: number; clientY: number },
  ) => {
    const point = stagePointFromPointer(event, stageRef.current, previewMode)
    if (!point) return
    moveTargetToPoint(target, point)
  }

  const beginDrag = (target: DragTarget, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setActiveTarget(target)
    dragTargetRef.current = target
    updateDraftTarget(target, event)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const currentTarget = dragTargetRef.current
      if (currentTarget) updateDraftTarget(currentTarget, moveEvent)
    }

    const handlePointerUp = () => {
      dragTargetRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  const updateSubject = (id: string, patch: Partial<ShotSubject>) => {
    updateDraft((current) => ({
      ...current,
      subjects: current.subjects.map((subject) =>
        subject.id === id ? { ...subject, ...patch } : subject,
      ),
    }))
  }

  const removeSubject = (id: string) => {
    updateDraft((current) => ({
      ...current,
      subjects: current.subjects.filter((subject) => subject.id !== id),
      camera: current.camera.target === id ? { ...current.camera, target: '' } : current.camera,
    }))
    if (activeId === `subject:${id}`) setActiveTarget({ type: 'camera' })
  }

  const addSubject = (kind: ShotSubjectKind) => {
    updateDraft((current) => ({
      ...current,
      subjects: [
        ...current.subjects,
        {
          id: makeId(kind),
          kind,
          name:
            kind === 'character'
              ? `人物 ${current.subjects.length + 1}`
              : `物件 ${current.subjects.length + 1}`,
          description: kind === 'character' ? '描述人物身份、动作和情绪' : '描述物件外观和用途',
          x: kind === 'character' ? 42 : 58,
          y: kind === 'character' ? 52 : 44,
          z: 0,
          facing: 0,
          layer: 'midground',
        },
      ],
    }))
  }

  const addKeyframe = () => {
    updateDraft((current) => {
      const last = current.keyframes[current.keyframes.length - 1]
      return {
        ...current,
        keyframes: [
          ...current.keyframes,
          {
            id: makeId('kf'),
            time: (last?.time ?? 0) + 2,
            x: current.camera.x,
            y: current.camera.y,
            z: current.camera.z,
            target:
              current.subjects.find((subject) => subject.id === current.camera.target)?.name ||
              current.camera.target ||
              '主体',
            movement: current.camera.movement,
          },
        ],
      }
    })
  }

  const updateKeyframe = (id: string, patch: Partial<ShotCameraKeyframe>) => {
    updateDraft((current) => ({
      ...current,
      keyframes: current.keyframes.map((keyframe) =>
        keyframe.id === id ? { ...keyframe, ...patch } : keyframe,
      ),
    }))
  }

  const removeKeyframe = (id: string) => {
    updateDraft((current) => ({
      ...current,
      keyframes: current.keyframes.filter((keyframe) => keyframe.id !== id),
    }))
    if (activeId === `keyframe:${id}`) setActiveTarget({ type: 'camera' })
  }

  const saveDraft = async () => {
    setSaving(true)
    try {
      const nextDraft = syncActiveShot({ ...draft, updatedAt: new Date().toISOString() })
      await onSaveDraft(nextDraft)
      setDraft(nextDraft)
      setDirty(false)
      message.success('导演台编排已保存')
    } finally {
      setSaving(false)
    }
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(activePrompt)
      message.success('提示词已复制')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const insertPrompt = async () => {
    await onInsertPrompt(activePrompt)
  }

  const insertScreenshot = async () => {
    const dataUrl = renderShotDirectorPreviewToDataUrl(draft)
    if (!dataUrl) {
      message.error('生成导演台截图失败')
      return
    }
    await onInsertScreenshot({ dataUrl, prompt: activePrompt, draft })
  }

  const applyPreset = (preset: ShotPreset) => {
    updateDraft((current) => applyPresetToDraft(current, preset))
  }

  const rebalanceSubjects = () => {
    updateDraft((current) => rebalanceSubjectsInDraft(current))
  }

  const moveActiveToThird = () => {
    if (!activeTarget) return
    moveTargetToPoint(activeTarget, nearestThirdPoint(activePoint))
  }

  const autoLayerSubjects = () => {
    updateDraft((current) => ({
      ...current,
      subjects: current.subjects.map((subject) => ({
        ...subject,
        layer: subject.y >= 64 ? 'foreground' : subject.y <= 38 ? 'background' : 'midground',
      })),
    }))
  }

  const focusCameraOnActiveSubject = () => {
    if (!activeTarget || activeTarget.type !== 'subject') return
    updateDraft((current) => ({
      ...current,
      camera: { ...current.camera, target: activeTarget.id },
    }))
  }

  return (
    <section className="canvas-shot-director-panel" aria-label="分镜导演台">
      <header className="canvas-shot-director-head">
        <div>
          <strong>分镜导演台</strong>
          <span>编排站位、镜头与运镜，生成 AI 画面提示词</span>
        </div>
        <div className="canvas-shot-director-head-actions">
          <Tag color={dirty ? 'orange' : 'green'}>{dirty ? '未保存' : '已保存'}</Tag>
          <Button
            size="middle"
            icon={<Icons.Check size={14} />}
            loading={saving}
            disabled={!dirty && Boolean(draft.updatedAt)}
            onClick={() => void saveDraft()}
          >
            保存编排
          </Button>
          <Tooltip title="关闭">
            <Button size="middle" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
          </Tooltip>
        </div>
      </header>

      <div className="canvas-shot-timeline">
        <div className="canvas-shot-timeline-list" role="tablist" aria-label="导演台镜头列表">
          {draft.shots.map((shot, index) => (
            <button
              key={shot.id}
              type="button"
              className={shot.id === draft.activeShotId ? 'active' : ''}
              onClick={() => switchShot(shot.id)}
            >
              <span>镜{index + 1}</span>
              <strong>{shot.title}</strong>
              <em>{shot.durationSec}s</em>
            </button>
          ))}
        </div>
        <div className="canvas-shot-timeline-actions">
          <Button size="middle" icon={<Icons.Plus size={14} />} onClick={createShot}>
            新镜头
          </Button>
          <Button size="middle" icon={<Icons.Copy size={14} />} onClick={duplicateActiveShot}>
            复制
          </Button>
          <Button
            size="middle"
            icon={<Icons.Trash size={14} />}
            disabled={draft.shots.length <= 1}
            onClick={deleteActiveShot}
          >
            删除
          </Button>
        </div>
      </div>

      <div className="canvas-shot-director-body">
        <div className="canvas-shot-director-left">
          <div className="canvas-shot-current-meta">
            <Tag color="blue">镜{activeShotIndex + 1}</Tag>
            <label className="canvas-shot-field">
              <span>镜头名</span>
              <Input
                value={activeShot?.title ?? ''}
                onChange={(event) => updateActiveShotMeta({ title: event.target.value })}
              />
            </label>
            <label className="canvas-shot-field">
              <span>时长 s</span>
              <input
                type="number"
                min={1}
                max={60}
                value={activeShot?.durationSec ?? estimateShotDuration(draft.keyframes)}
                onChange={(event) =>
                  updateActiveShotMeta({
                    durationSec: Math.max(
                      1,
                      parseNumericInput(
                        event.target.value,
                        activeShot?.durationSec ?? estimateShotDuration(draft.keyframes),
                      ),
                    ),
                  })
                }
              />
            </label>
          </div>

          <label className="canvas-shot-field canvas-shot-field-wide">
            <span>场景描述</span>
            <Input.TextArea
              value={draft.sceneBrief}
              autoSize={{ minRows: 2, maxRows: 3 }}
              onChange={(event) =>
                updateDraft((current) => ({ ...current, sceneBrief: event.target.value }))
              }
            />
          </label>

          <div className="canvas-shot-section-head">
            <strong>人物与物件</strong>
            <div>
              <Button
                size="middle"
                icon={<Icons.User size={14} />}
                onClick={() => addSubject('character')}
              >
                人物
              </Button>
              <Button size="middle" icon={<Icons.Box size={14} />} onClick={() => addSubject('prop')}>
                物件
              </Button>
            </div>
          </div>

          <div className="canvas-shot-subject-list">
            {draft.subjects.map((subject) => (
              <article
                key={subject.id}
                className={`canvas-shot-subject-card${activeId === `subject:${subject.id}` ? ' selected' : ''}`}
                onClick={() => setActiveTarget({ type: 'subject', id: subject.id })}
              >
                <div className="canvas-shot-subject-card-head">
                  <Tag color={subject.kind === 'character' ? 'green' : 'orange'}>
                    {subjectKindLabel(subject.kind)}
                  </Tag>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Trash size={14} />}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeSubject(subject.id)
                    }}
                  />
                </div>
                <div className="canvas-shot-grid-form">
                  <label className="canvas-shot-field">
                    <span>名称</span>
                    <Input
                      value={subject.name}
                      onChange={(event) => updateSubject(subject.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>层次</span>
                    <Select
                      value={subject.layer}
                      options={[
                        { label: '前景', value: 'foreground' },
                        { label: '中景', value: 'midground' },
                        { label: '背景', value: 'background' },
                      ]}
                      onChange={(value) => updateSubject(subject.id, { layer: value })}
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>X</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={subject.x}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          x: clampPercent(parseNumericInput(event.target.value, subject.x)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>Y</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={subject.y}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          y: clampPercent(parseNumericInput(event.target.value, subject.y)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>朝向</span>
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={subject.facing}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          facing: parseNumericInput(event.target.value, subject.facing),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field canvas-shot-field-wide">
                    <span>描述</span>
                    <Input
                      value={subject.description}
                      onChange={(event) =>
                        updateSubject(subject.id, { description: event.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="canvas-shot-director-preview">
          <div className="canvas-shot-preview-toolbar">
            <div className="canvas-shot-view-switch" role="tablist" aria-label="导演台视图">
              <button
                type="button"
                className={previewMode === 'camera3d' ? 'active' : ''}
                onClick={() => setPreviewMode('camera3d')}
              >
                3D 预演
              </button>
              <button
                type="button"
                className={previewMode === 'top' ? 'active' : ''}
                onClick={() => setPreviewMode('top')}
              >
                俯视编排
              </button>
            </div>
            <div className="canvas-shot-template-row">
              <Button size="middle" onClick={() => applyPreset('standoff')}>
                对峙
              </Button>
              <Button size="middle" onClick={() => applyPreset('over-shoulder')}>
                过肩
              </Button>
              <Button size="middle" onClick={() => applyPreset('dolly-reveal')}>
                推进揭示
              </Button>
              <Button size="middle" onClick={() => applyPreset('orbit-group')}>
                环绕群像
              </Button>
            </div>
          </div>

          <div className="canvas-shot-smart-row">
            <Button size="middle" icon={<Icons.Grid size={14} />} onClick={rebalanceSubjects}>
              重排站位
            </Button>
            <Button
              size="middle"
              icon={<Icons.Pin size={14} />}
              disabled={!activeTarget}
              onClick={moveActiveToThird}
            >
              贴三分点
            </Button>
            <Button size="middle" icon={<Icons.Layers size={14} />} onClick={autoLayerSubjects}>
              自动层次
            </Button>
            <Button
              size="middle"
              icon={<Icons.Film size={14} />}
              disabled={activeTarget?.type !== 'subject'}
              onClick={focusCameraOnActiveSubject}
            >
              镜头看向
            </Button>
          </div>

          <div className="canvas-shot-active-strip">
            <Tag color="blue">当前</Tag>
            <strong>{activeTargetLabel}</strong>
            <span>
              x {activePoint.x} / y {activePoint.y}
            </span>
          </div>

          {previewMode === 'top' ? (
            <div ref={stageRef} className="canvas-shot-preview-stage">
              <svg className="canvas-shot-preview-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                <line
                  x1={draft.camera.x}
                  y1={draft.camera.y}
                  x2={targetPoint.x}
                  y2={targetPoint.y}
                  className="canvas-shot-target-line"
                />
                {pathPoints && <polyline points={pathPoints} className="canvas-shot-path-line" />}
              </svg>
              <div
                className={`canvas-shot-camera${activeId === 'camera' ? ' selected' : ''}`}
                style={{ left: `${draft.camera.x}%`, top: `${draft.camera.y}%` }}
                onPointerDown={(event) => beginDrag({ type: 'camera' }, event)}
              >
                <Icons.Film size={16} />
              </div>
              <div
                className="canvas-shot-camera-cone"
                style={{
                  left: `${draft.camera.x}%`,
                  top: `${draft.camera.y}%`,
                  ['--shot-camera-angle' as string]: `${cameraConeAngle}deg`,
                }}
              />
              {sortedKeyframes(draft.keyframes).map((keyframe, index) => (
                <div
                  key={keyframe.id}
                  className={`canvas-shot-keyframe-dot${activeId === `keyframe:${keyframe.id}` ? ' selected' : ''}`}
                  style={{ left: `${keyframe.x}%`, top: `${keyframe.y}%` }}
                  onPointerDown={(event) => beginDrag({ type: 'keyframe', id: keyframe.id }, event)}
                >
                  {index + 1}
                </div>
              ))}
              {draft.subjects.map((subject) => (
                <div
                  key={subject.id}
                  className={`canvas-shot-subject-marker canvas-shot-subject-${subject.kind}${activeId === `subject:${subject.id}` ? ' selected' : ''}`}
                  style={{ left: `${subject.x}%`, top: `${subject.y}%` }}
                  title={subject.name}
                  onPointerDown={(event) => beginDrag({ type: 'subject', id: subject.id }, event)}
                >
                  <span
                    className="canvas-shot-facing"
                    style={{ transform: `rotate(${subject.facing}deg)` }}
                  />
                  <strong>{subject.name.slice(0, 2)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div ref={stageRef} className="canvas-shot-3d-stage">
              <div className="canvas-shot-3d-horizon" />
              <div className="canvas-shot-3d-frame">
                <span>{SHOT_SIZE_LABEL[draft.camera.shotSize]}</span>
                <strong>{draft.camera.focalLength}mm</strong>
                <em>{ANGLE_LABEL[draft.camera.angle]}</em>
              </div>
              <svg className="canvas-shot-3d-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                <line
                  x1={draft.camera.x}
                  y1={project3dY(draft.camera.y)}
                  x2={projectedTargetPoint.x}
                  y2={projectedTargetPoint.y}
                  className="canvas-shot-target-line"
                />
                {projectedPathPoints && (
                  <polyline points={projectedPathPoints} className="canvas-shot-path-line" />
                )}
              </svg>
              {sortedKeyframes(draft.keyframes).map((keyframe, index) => (
                <div
                  key={keyframe.id}
                  className={`canvas-shot-3d-keyframe${activeId === `keyframe:${keyframe.id}` ? ' selected' : ''}`}
                  style={{
                    left: `${keyframe.x}%`,
                    top: `${project3dY(keyframe.y)}%`,
                    transform: `translate(-50%, -50%) scale(${getDepthScale(keyframe.y)})`,
                    zIndex: 20 + Math.round(keyframe.y),
                  }}
                  onPointerDown={(event) => beginDrag({ type: 'keyframe', id: keyframe.id }, event)}
                >
                  {index + 1}
                </div>
              ))}
              {depthSortedSubjects.map((subject) => (
                <div
                  key={subject.id}
                  className={`canvas-shot-3d-subject canvas-shot-3d-${subject.kind}${activeId === `subject:${subject.id}` ? ' selected' : ''}`}
                  style={{
                    left: `${subject.x}%`,
                    top: `${project3dY(subject.y)}%`,
                    height: getLayerHeight(subject.layer),
                    transform: `translate(-50%, -100%) scale(${getDepthScale(subject.y)})`,
                    zIndex: 30 + Math.round(subject.y),
                  }}
                  title={subject.name}
                  onPointerDown={(event) => beginDrag({ type: 'subject', id: subject.id }, event)}
                >
                  <span
                    className="canvas-shot-3d-facing"
                    style={{ transform: `translateX(-50%) rotate(${subject.facing}deg)` }}
                  />
                  <strong>{subject.name.slice(0, 2)}</strong>
                  <em>{LAYER_LABEL[subject.layer]}</em>
                </div>
              ))}
              <div
                className={`canvas-shot-3d-camera${activeId === 'camera' ? ' selected' : ''}`}
                style={{
                  left: `${draft.camera.x}%`,
                  top: `${project3dY(draft.camera.y)}%`,
                  transform: `translate(-50%, -50%) scale(${getDepthScale(draft.camera.y)})`,
                  zIndex: 40 + Math.round(draft.camera.y),
                }}
                onPointerDown={(event) => beginDrag({ type: 'camera' }, event)}
              >
                <Icons.Film size={16} />
              </div>
            </div>
          )}

          <div className={`canvas-shot-camera-panel${activeId === 'camera' ? ' selected' : ''}`}>
            <div className="canvas-shot-section-head">
              <strong>镜头</strong>
              <Tag color="purple">{MOVE_LABEL[draft.camera.movement]}</Tag>
            </div>
            <div className="canvas-shot-grid-form">
              <label className="canvas-shot-field">
                <span>景别</span>
                <Select
                  value={draft.camera.shotSize}
                  options={[
                    { label: '远景', value: 'wide' },
                    { label: '全身', value: 'full' },
                    { label: '中景', value: 'medium' },
                    { label: '特写', value: 'close-up' },
                  ]}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: { ...current.camera, shotSize: value },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>角度</span>
                <Select
                  value={draft.camera.angle}
                  options={[
                    { label: '平视', value: 'eye-level' },
                    { label: '俯拍', value: 'high-angle' },
                    { label: '仰拍', value: 'low-angle' },
                    { label: '顶拍', value: 'top-down' },
                  ]}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: { ...current.camera, angle: value },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>目标</span>
                <Select
                  value={draft.camera.target}
                  options={cameraTargetOptions}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: { ...current.camera, target: value },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>运镜</span>
                <Select
                  value={draft.camera.movement}
                  options={[
                    { label: '固定', value: 'static' },
                    { label: '推进', value: 'dolly-in' },
                    { label: '拉远', value: 'dolly-out' },
                    { label: '跟拍', value: 'tracking' },
                    { label: '环绕', value: 'orbit' },
                    { label: '升降', value: 'crane-up' },
                  ]}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: { ...current.camera, movement: value },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>镜头 X</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.camera.x}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: {
                        ...current.camera,
                        x: clampPercent(parseNumericInput(event.target.value, current.camera.x)),
                      },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>镜头 Y</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.camera.y}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: {
                        ...current.camera,
                        y: clampPercent(parseNumericInput(event.target.value, current.camera.y)),
                      },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>高度 m</span>
                <input
                  type="number"
                  step="0.1"
                  min={0.2}
                  max={12}
                  value={draft.camera.z}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: {
                        ...current.camera,
                        z: parseNumericInput(event.target.value, current.camera.z),
                      },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>焦段 mm</span>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={draft.camera.focalLength}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: {
                        ...current.camera,
                        focalLength: parseNumericInput(
                          event.target.value,
                          current.camera.focalLength,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field canvas-shot-field-wide">
                <span>构图</span>
                <Input
                  value={draft.camera.composition}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      camera: { ...current.camera, composition: event.target.value },
                    }))
                  }
                />
              </label>
            </div>
          </div>
        </div>

        <div className="canvas-shot-director-right">
          <div className={`canvas-shot-composition-card tone-${composition.tone}`}>
            <div className="canvas-shot-composition-head">
              <strong>构图健康度</strong>
              <Tag color={composition.tone}>{composition.score} · {composition.label}</Tag>
            </div>
            <div className="canvas-shot-scorebar">
              <span style={{ width: `${composition.score}%` }} />
            </div>
            <div className="canvas-shot-issue-list">
              {composition.issues.length === 0 ? (
                <span className="canvas-shot-issue-good">空间关系、镜头目标和运镜信息完整</span>
              ) : (
                composition.issues.slice(0, 4).map((issue) => (
                  <span key={issue.id} className={`canvas-shot-issue-${issue.level}`}>
                    {issue.label}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="canvas-shot-section-head">
            <strong>运镜关键帧</strong>
            <Button size="middle" icon={<Icons.Plus size={14} />} onClick={addKeyframe}>
              关键帧
            </Button>
          </div>
          <div className="canvas-shot-keyframes">
            {draft.keyframes.map((keyframe) => (
              <article
                key={keyframe.id}
                className={`canvas-shot-keyframe-card${activeId === `keyframe:${keyframe.id}` ? ' selected' : ''}`}
                onClick={() => setActiveTarget({ type: 'keyframe', id: keyframe.id })}
              >
                <div className="canvas-shot-subject-card-head">
                  <Tag color="red">{keyframe.time}s</Tag>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Trash size={14} />}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeKeyframe(keyframe.id)
                    }}
                  />
                </div>
                <div className="canvas-shot-grid-form">
                  <label className="canvas-shot-field">
                    <span>秒</span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={keyframe.time}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          time: parseNumericInput(event.target.value, keyframe.time),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>X</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={keyframe.x}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          x: clampPercent(parseNumericInput(event.target.value, keyframe.x)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>Y</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={keyframe.y}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          y: clampPercent(parseNumericInput(event.target.value, keyframe.y)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field canvas-shot-field-wide">
                    <span>看向</span>
                    <Input
                      value={keyframe.target}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, { target: event.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>

          <div className="canvas-shot-prompt-box">
            <div className="canvas-shot-prompt-tabs">
              <button
                type="button"
                className={draft.promptMode === 'image' ? 'active' : ''}
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    promptMode: 'image',
                  }))
                }
              >
                生图
              </button>
              <button
                type="button"
                className={draft.promptMode === 'video' ? 'active' : ''}
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    promptMode: 'video',
                  }))
                }
              >
                视频
              </button>
            </div>
            <textarea value={activePrompt} readOnly />
            <div className="canvas-shot-prompt-actions">
              <Button size="middle" icon={<Icons.Copy size={14} />} onClick={() => void copyPrompt()}>
                复制
              </Button>
              <Button
                size="middle"
                icon={<Icons.ImagePlus size={14} />}
                onClick={() => void insertScreenshot()}
              >
                截图+提示词
              </Button>
              <Button
                size="middle"
                type="primary"
                icon={<Icons.FilePlus size={14} />}
                onClick={() => void insertPrompt()}
              >
                插入提示词
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
