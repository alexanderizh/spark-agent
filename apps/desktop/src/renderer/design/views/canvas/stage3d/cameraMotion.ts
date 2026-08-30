/**
 * 3D 导演台·机位运动轨迹（运镜）纯数学模块。
 *
 * 预设运镜 / 关键帧轨迹都归结为一个「时间 → 机位（position + target）」的求值函数，
 * 供播放预览、机位预览画中画与视频录制三条链路共用，保证三条链路看到的轨迹完全一致。
 *
 * 本模块不依赖 React / three / stage3d.types，只做数据运算，便于单测、避免循环引用。
 */

export type Vec3 = [number, number, number]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function makeMotionId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ─────────────────────────── 预设运镜库 ───────────────────────────

export type Stage3DMotionPresetId =
  | 'push-in'
  | 'pull-out'
  | 'follow-forward'
  | 'follow-back'
  | 'orbit'
  | 'arc-left'
  | 'arc-right'
  | 'truck-left'
  | 'truck-right'
  | 'crane-up'
  | 'crane-down'
  | 'spiral-up'
  | 'spiral-down'

export type Stage3DMotionCategory = 'push-pull' | 'follow' | 'orbit' | 'truck' | 'crane'

export type Stage3DMotionPresetDef = {
  id: Stage3DMotionPresetId
  label: string
  /** 默认时长（秒），与竞品运镜库一致 */
  durationSec: number
  category: Stage3DMotionCategory
  /** 提示词用的英文运镜描述（补视频生成模型） */
  en: string
}

export const STAGE3D_MOTION_PRESETS: Stage3DMotionPresetDef[] = [
  { id: 'push-in', label: '推近特写', durationSec: 2, category: 'push-pull', en: 'slow dolly push-in toward the subject, ending in a close-up' },
  { id: 'pull-out', label: '拉远交代', durationSec: 2.4, category: 'push-pull', en: 'slow dolly pull-back revealing the wider scene' },
  { id: 'follow-forward', label: '跟拍前移', durationSec: 2.4, category: 'follow', en: 'tracking shot moving forward alongside the subject' },
  { id: 'follow-back', label: '跟拍后退', durationSec: 2.4, category: 'follow', en: 'tracking shot moving backward away from the subject' },
  { id: 'orbit', label: '环绕', durationSec: 4.5, category: 'orbit', en: 'full 360° orbit around the subject' },
  { id: 'arc-left', label: '左向半弧', durationSec: 3, category: 'orbit', en: 'half-arc move curving to the left around the subject' },
  { id: 'arc-right', label: '右向半弧', durationSec: 3, category: 'orbit', en: 'half-arc move curving to the right around the subject' },
  { id: 'truck-left', label: '横移左', durationSec: 2, category: 'truck', en: 'truck left, sliding sideways while keeping the subject framed' },
  { id: 'truck-right', label: '横移右', durationSec: 2, category: 'truck', en: 'truck right, sliding sideways while keeping the subject framed' },
  { id: 'crane-up', label: '上升', durationSec: 2.6, category: 'crane', en: 'crane up, rising while keeping the subject in frame' },
  { id: 'crane-down', label: '下降', durationSec: 2.6, category: 'crane', en: 'crane down, descending while keeping the subject in frame' },
  { id: 'spiral-up', label: '螺旋上升', durationSec: 4.5, category: 'crane', en: 'spiral crane up, orbiting while rising' },
  { id: 'spiral-down', label: '螺旋下降', durationSec: 4.5, category: 'crane', en: 'spiral crane down, orbiting while descending' },
]

export const STAGE3D_MOTION_CATEGORY_LABEL: Record<Stage3DMotionCategory, string> = {
  'push-pull': '推拉',
  follow: '跟拍',
  orbit: '环绕',
  truck: '横移',
  crane: '升降',
}

const MOTION_PRESET_MAP = new Map<string, Stage3DMotionPresetDef>(
  STAGE3D_MOTION_PRESETS.map((p) => [p.id, p]),
)

export function getStage3DMotionPreset(id: string | undefined): Stage3DMotionPresetDef | null {
  if (!id) return null
  return MOTION_PRESET_MAP.get(id) ?? null
}

// ─────────────────────────── 数据模型 ───────────────────────────

export type Stage3DCameraKeyframe = {
  id: string
  /** 关键帧时间（秒，相对轨迹起点），列表按 t 升序 */
  t: number
  position: Vec3
  target: Vec3
}

/**
 * 机位运动轨迹：挂在工作机位（data.camera.motion）或镜头（shot.motion）上。
 * start 是轨迹起始机位快照——应用预设 / 保存镜头时拍下，保证回放与录制可复现。
 */
export type Stage3DCameraMotion = {
  kind: 'preset' | 'keyframes'
  presetId?: Stage3DMotionPresetId | undefined
  durationSec: number
  start?:
    | {
        position: Vec3
        target: Vec3
        /** 仅预设轨迹从相机快照；关键帧轨迹不带，录制时用工作机位当前 fov */
        fov?: number | undefined
      }
    | undefined
  keyframes?: Stage3DCameraKeyframe[] | undefined
}

/** 运镜主体（跟随/注视的对象），预设轨迹围绕它展开 */
export type Stage3DMotionSubject = {
  /** 主体脚底世界坐标 */
  position: Vec3
  /** 主体朝向（弧度，跟拍方向用） */
  rotationY: number
}

function makeKeyframeId(): string {
  return makeMotionId('kf')
}

/** 从当前机位快照一条预设运镜（start 记录当前 pose，保证可复现） */
export function makePresetMotion(
  presetId: Stage3DMotionPresetId,
  camera: { position: Vec3; target: Vec3; fov: number },
  durationSec?: number,
): Stage3DCameraMotion {
  const preset = getStage3DMotionPreset(presetId)
  return {
    kind: 'preset',
    presetId: preset?.id ?? 'push-in',
    durationSec: clamp(durationSec ?? preset?.durationSec ?? 3, 0.5, 30),
    start: { position: [...camera.position], target: [...camera.target], fov: camera.fov },
  }
}

/** 从关键帧列表构建关键帧轨迹（自动按时间排序、补 id） */
export function makeKeyframeMotion(
  keyframes: Stage3DCameraKeyframe[],
  durationSec: number,
): Stage3DCameraMotion {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const duration = clamp(durationSec, 0.5, 30)
  // start 取首帧 pose：轨迹未挂 start 时（旧数据）也能从首帧评估。
  // 关键帧轨迹不带 fov——录制用工作机位当前 fov，避免快照时硬编码错误值。
  const start = first
    ? { position: [...first.position] as Vec3, target: [...first.target] as Vec3 }
    : undefined
  // 首末帧时间归一到 [0, duration]，中间帧按比例缩放
  const t0 = first?.t ?? 0
  const t1 = last && last.t > t0 ? last.t : t0 + duration
  const scale = t1 > t0 ? duration / (t1 - t0) : 1
  return {
    kind: 'keyframes',
    durationSec: duration,
    start,
    keyframes: sorted.map((kf) => ({
      id: kf.id || makeKeyframeId(),
      t: clamp((kf.t - t0) * scale, 0, duration),
      position: [...kf.position] as Vec3,
      target: [...kf.target] as Vec3,
    })),
  }
}

export function makeKeyframe(t: number, position: Vec3, target: Vec3): Stage3DCameraKeyframe {
  return { id: makeKeyframeId(), t, position: [...position], target: [...target] }
}

// ─────────────────────────── 求值 ───────────────────────────

const DEFAULT_START = { position: [0, 1.6, 4.5] as Vec3, target: [0, 1, 0] as Vec3 }

/** ease-in-out（smoothstep）：起停柔和，接近真实运镜的加减速 */
export function motionEase(u: number): number {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** 水平面（XZ）距离 */
function horizontalDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

/** 绕主体极坐标定位：yaw 为相机在主体周围的方位角，radius 水平半径，height 相机高度 */
function polarAroundSubject(
  subject: Vec3,
  yaw: number,
  radius: number,
  height: number,
): Vec3 {
  return [subject[0] + Math.sin(yaw) * radius, height, subject[2] + Math.cos(yaw) * radius]
}

export type Stage3DMotionFrame = { position: Vec3; target: Vec3 }

/**
 * 求值运镜轨迹在 timeSec 时刻的机位。
 *
 * @param motion 轨迹数据
 * @param timeSec 轨迹时间（秒），超出时长时钳制到终点
 * @param subject 跟随/注视主体；不传时预设围绕「起始注视点」这一虚拟主体展开
 */
export function evaluateStage3DCameraMotion(
  motion: Stage3DCameraMotion,
  timeSec: number,
  subject?: Stage3DMotionSubject | undefined,
): Stage3DMotionFrame {
  const duration = clamp(motion.durationSec, 0.5, 30)
  // fov 不参与轨迹求值，start 缺失时无需伪造
  const start = motion.start ?? {
    position: [...DEFAULT_START.position] as Vec3,
    target: [...DEFAULT_START.target] as Vec3,
  }

  if (motion.kind === 'keyframes') {
    const kfs = motion.keyframes ?? []
    if (kfs.length === 0) return { position: [...start.position], target: [...start.target] }
    if (kfs.length === 1) {
      return { position: [...kfs[0]!.position], target: [...kfs[0]!.target] }
    }
    const t = clamp(timeSec, 0, duration)
    // 找所在片段：kfs[i].t <= t <= kfs[i+1].t
    let seg = 0
    for (let i = 0; i < kfs.length - 1; i += 1) {
      if (t >= kfs[i]!.t) seg = i
    }
    const a = kfs[seg]!
    const b = kfs[Math.min(seg + 1, kfs.length - 1)]!
    if (a === b || b.t <= a.t) return { position: [...b.position], target: [...b.target] }
    const u = motionEase((t - a.t) / (b.t - a.t))
    return { position: lerp3(a.position, b.position, u), target: lerp3(a.target, b.target, u) }
  }

  // ── 预设运镜 ──
  const u = motionEase(clamp(timeSec / duration, 0, 1))
  const camPos = start.position
  const camTarget = start.target

  // 主体：外部传入的跟随对象，否则用「起始注视点」做虚拟主体（y 取地面近似 0.9m 处不必要，
  // 直接用注视点，保持用户已取好的构图中心）
  const subjectPos: Vec3 = subject ? [...subject.position] : [...camTarget]
  const subjectYaw = subject?.rotationY ?? 0
  const radius = Math.max(0.8, horizontalDist(camPos, subjectPos))
  const baseYaw = Math.atan2(camPos[0] - subjectPos[0], camPos[2] - subjectPos[2])
  const camHeight = camPos[1]
  // 注视点：有主体时保持用户取景的垂直偏移（胸口/头顶），无主体时钉在原注视点
  const lookPoint: Vec3 = subject
    ? [subjectPos[0], subjectPos[1] + (camTarget[1] - subjectPos[1]), subjectPos[2]]
    : [...camTarget]
  // 相机水平朝向的单位向量（主体 → 相机方向）
  // 主体朝向的单位向量（跟拍移动方向）；无主体时退化为相机视线方向
  const lookDir: Vec3 = subject
    ? [Math.sin(subjectYaw), 0, Math.cos(subjectYaw)]
    : [-(camPos[0] - lookPoint[0]) / Math.max(0.001, radius), 0, -(camPos[2] - lookPoint[2]) / Math.max(0.001, radius)]
  // 屏幕右方向（相机朝向 lookPoint 时）
  const rightDir: Vec3 = [-lookDir[2], 0, lookDir[0]]

  const presetId = motion.presetId ?? 'push-in'
  let position: Vec3
  let target: Vec3

  switch (presetId) {
    case 'push-in': {
      // 沿视线推进到约 0.5× 距离（不低于 0.9m），特写收尾
      const endRadius = Math.max(0.9, radius * 0.5)
      const r = lerp(radius, endRadius, u)
      position = polarAroundSubject(subjectPos, baseYaw, r, camHeight)
      target = [...lookPoint]
      break
    }
    case 'pull-out': {
      const endRadius = Math.min(14, radius * 1.9)
      const r = lerp(radius, endRadius, u)
      const h = lerp(camHeight, camHeight + 0.5, u)
      position = polarAroundSubject(subjectPos, baseYaw, r, h)
      target = [...lookPoint]
      break
    }
    case 'follow-forward':
    case 'follow-back': {
      const dist = 1.8 * (presetId === 'follow-forward' ? 1 : -1)
      const d = dist * u
      position = [camPos[0] + lookDir[0] * d, camPos[1], camPos[2] + lookDir[2] * d]
      target = [...lookPoint]
      break
    }
    case 'orbit': {
      const yaw = baseYaw + u * Math.PI * 2
      position = polarAroundSubject(subjectPos, yaw, radius, camHeight)
      target = [...lookPoint]
      break
    }
    case 'arc-left':
    case 'arc-right': {
      const sweep = Math.PI * (presetId === 'arc-left' ? -1 : 1)
      const yaw = baseYaw + u * sweep
      position = polarAroundSubject(subjectPos, yaw, radius, camHeight)
      target = [...lookPoint]
      break
    }
    case 'truck-left':
    case 'truck-right': {
      const dist = 1.5 * (presetId === 'truck-left' ? -1 : 1)
      const d = dist * u
      position = [camPos[0] + rightDir[0] * d, camPos[1], camPos[2] + rightDir[2] * d]
      target = [...lookPoint]
      break
    }
    case 'crane-up':
    case 'crane-down': {
      // 升降同时略拉远，保持主体不顶出画面
      const r = radius + 0.9 * u
      const rawH = camHeight + 2.2 * u * (presetId === 'crane-up' ? 1 : -1)
      const h = Math.max(0.25, rawH)
      position = polarAroundSubject(subjectPos, baseYaw, r, h)
      target = [...lookPoint]
      break
    }
    case 'spiral-up':
    case 'spiral-down': {
      const yaw = baseYaw + u * Math.PI * 2
      const r = radius + 0.4 * u
      const rawH = camHeight + 2.4 * u * (presetId === 'spiral-up' ? 1 : -1)
      const h = Math.max(0.3, rawH)
      position = polarAroundSubject(subjectPos, yaw, r, h)
      target = [...lookPoint]
      break
    }
    default: {
      position = [...camPos]
      target = [...camTarget]
    }
  }

  return { position, target }
}

/** 轨迹的中文一句话描述（提示词 / 面板回显用） */
export function describeStage3DMotion(motion: Stage3DCameraMotion): string {
  const duration = motion.durationSec.toFixed(1)
  if (motion.kind === 'keyframes') {
    const count = motion.keyframes?.length ?? 0
    return `自定义运动轨迹（${count} 个关键帧，约 ${duration} 秒）`
  }
  const preset = getStage3DMotionPreset(motion.presetId)
  if (!preset) return `预设运镜（约 ${duration} 秒）`
  return `${preset.label}运镜（约 ${duration} 秒）`
}

/** 轨迹的英文运镜描述（补视频生成模型），无轨迹时返回 null */
export function describeStage3DMotionEn(motion: Stage3DCameraMotion): string | null {
  if (motion.kind === 'keyframes') {
    return 'camera moves along a custom keyframed path'
  }
  return getStage3DMotionPreset(motion.presetId)?.en ?? null
}
