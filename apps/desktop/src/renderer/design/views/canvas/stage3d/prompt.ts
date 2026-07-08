import type { Stage3DActor, Stage3DCamera, Stage3DData, Stage3DProp } from './stage3d.types'
import { STAGE3D_BODY_TYPE_LABEL, STAGE3D_LIGHTING_LABEL } from './stage3d.types'
import { POSE_LABEL } from './mannequin'

/** 姿势英文描述词（补生图模型），未收录的预设回退中文标签。 */
const POSE_EN: Record<string, string> = {
  stand: 'standing',
  walk: 'walking',
  run: 'running',
  sit: 'sitting',
  point: 'pointing',
  'arms-crossed': 'arms crossed',
  lying: 'lying down',
  kneel: 'kneeling',
  punch: 'throwing a punch, bow stance',
  kick: 'front kick',
  block: 'blocking guard',
  'horse-stance': 'horse stance',
  'flying-kick': 'flying side kick, airborne',
}

/**
 * 姿势描述：有逐关节覆盖时输出「自定义姿势（基于 X 预设微调）」，避免写死预设标签误导生图；
 * 否则输出「X姿势」。两者都尾附英文描述词（若有）。
 * @param actor 角色
 */
function poseDescription(actor: Stage3DActor): string {
  const label = POSE_LABEL[actor.pose] ?? actor.pose
  const en = POSE_EN[actor.pose]
  const enPart = en ? `（${en}）` : ''
  const hasOverrides = !!actor.joints && Object.keys(actor.joints).length > 0
  if (hasOverrides) return `自定义姿势（基于${label}预设微调）${enPart}`
  return `${label}姿势${enPart}`
}

/**
 * 遍历 3D 场景生成结构化中文提示词：
 * 角色姿势 / 站位 / 朝向 / 相对关系、道具（相对最近角色的方位+距离）、背景、
 * 相机机位 / 焦段 / 画幅 / 到主体距离。
 * 全部用"固定基准（镜头 or 场景原点）+ 相对位置"描述，单位统一米、保留一位小数，
 * 便于视频生成模型理解空间关系。风格参考 2D 版 buildDirectorPrompt。
 */

function sub(a: number, b: number): number {
  return a - b
}

/** 垂直 FOV → 等效全画幅焦段（按 24mm 竖向传感器高估算） */
function fovToFocal(fovDeg: number): number {
  const fovRad = (fovDeg * Math.PI) / 180
  const sensorH = 24
  return Math.round(sensorH / (2 * Math.tan(fovRad / 2)))
}

function lateralWord(x: number): string {
  if (x < -0.5) return '画面左侧'
  if (x > 0.5) return '画面右侧'
  return '画面中央'
}

function depthWord(distToCam: number): string {
  if (distToCam < 2.2) return '前景'
  if (distToCam < 4.5) return '中景'
  return '背景'
}

/** 角色朝向相对相机的描述 */
function facingWord(actor: Stage3DActor, camera: Stage3DCamera): string {
  const toCam = Math.atan2(
    sub(camera.position[0], actor.position[0]),
    sub(camera.position[2], actor.position[2]),
  )
  let diff = actor.rotationY - toCam
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const abs = Math.abs(diff)
  if (abs <= Math.PI / 4) return '面向镜头'
  if (abs >= (Math.PI * 3) / 4) return '背对镜头'
  return diff > 0 ? '侧身朝右' : '侧身朝左'
}

/**
 * 8 方位词：以「from 指向 to」的水平向量算方位角。
 * 约定镜头默认朝 -Z 看向 +Z（与 lateralWord 的左右判断一致：x<0 为左），
 * 故取 atan2(dx, dz) 后按 8 等分区间映射方位词。
 */
function compassWord(dx: number, dz: number): string {
  const angle = Math.atan2(dx, dz) // -PI..PI，0=正前方(+Z)，正值偏右，负值偏左
  const deg = (angle * 180) / Math.PI
  if (deg >= -22.5 && deg < 22.5) return '正前方'
  if (deg >= 22.5 && deg < 67.5) return '右前方'
  if (deg >= 67.5 && deg < 112.5) return '右侧'
  if (deg >= 112.5 && deg < 157.5) return '右后方'
  if (deg >= 157.5 || deg < -157.5) return '正后方'
  if (deg >= -157.5 && deg < -112.5) return '左后方'
  if (deg >= -112.5 && deg < -67.5) return '左侧'
  return '左前方'
}

/** "to 相对 from" 的方位 + 距离描述，如「右前方约 1.3 米」 */
function relativeWord(from: readonly [number, number, number], to: readonly [number, number, number]): string {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const dist = Math.hypot(dx, dz)
  return `${compassWord(dx, dz)}约 ${dist.toFixed(1)} 米`
}

function backdropWord(data: Stage3DData): string | null {
  const { backdrop } = data
  if (backdrop.mode === 'panorama') return '360° 全景图作为沉浸式环境背景'
  if (backdrop.mode === 'backdrop') return '远景背板作为场景背景'
  return null
}

/** 最近的角色（用于道具定位基准），无角色时返回 null */
function nearestActor(prop: Stage3DProp, actors: Stage3DActor[]): Stage3DActor | null {
  let best: Stage3DActor | null = null
  let bestDist = Infinity
  for (const actor of actors) {
    const dist = Math.hypot(prop.position[0] - actor.position[0], prop.position[2] - actor.position[2])
    if (dist < bestDist) {
      bestDist = dist
      best = actor
    }
  }
  return best
}

const ORIGIN: [number, number, number] = [0, 0, 0]

/** 单个道具的定位描述：相对最近角色，无角色时相对场景原点 */
function propPlacementLine(prop: Stage3DProp, actors: Stage3DActor[]): string {
  const anchor = nearestActor(prop, actors)
  if (anchor) {
    return `${prop.name}：位于${anchor.name}${relativeWord(anchor.position, prop.position)}`
  }
  return `${prop.name}：位于场景原点${relativeWord(ORIGIN, prop.position)}`
}

/** 道具较多（>6）时按锚点归纳：同一角色附近的道具合并为一行，避免提示词过长 */
function propSummaryLines(props: Stage3DProp[], actors: Stage3DActor[]): string[] {
  const groups = new Map<string, { label: string; names: string[] }>()
  for (const prop of props) {
    const anchor = nearestActor(prop, actors)
    const key = anchor ? anchor.id : '__origin__'
    const label = anchor ? `${anchor.name}附近` : '场景原点附近'
    const group = groups.get(key)
    if (group) group.names.push(prop.name)
    else groups.set(key, { label, names: [prop.name] })
  }
  return Array.from(groups.values()).map((g) => `${g.label}：${g.names.join('、')}`)
}

function crowdSummaryLines(actors: Stage3DActor[]): string[] {
  const groups = new Map<string, { label: string; count: number }>()
  for (const actor of actors) {
    if (!actor.crowdId) continue
    const group = groups.get(actor.crowdId)
    if (group) {
      group.count += 1
      continue
    }
    groups.set(actor.crowdId, {
      label: actor.crowdLabel?.trim() || actor.crowdId,
      count: 1,
    })
  }
  return Array.from(groups.values()).map((group) => `群众阵列：${group.label}，共 ${group.count} 人`)
}

/**
 * 生成结构化中文提示词。
 * @param cameraOverride 指定机位（批量导出各镜头用）；不传用 data.camera。
 */
export function buildStage3DPrompt(data: Stage3DData, cameraOverride?: Stage3DCamera): string {
  const camera = cameraOverride ?? data.camera
  const lines: string[] = []

  // 场记板信息置顶（场次 · 镜号 · Take），帮助批量生成时保持场次可追踪
  const slate = data.slate
  if (slate && (slate.scene || slate.shotNumber || slate.take)) {
    const parts: string[] = []
    if (slate.scene) parts.push(`场次 ${slate.scene}`)
    if (slate.shotNumber) parts.push(`镜号 ${slate.shotNumber}`)
    if (slate.take) parts.push(`Take ${slate.take}`)
    if (parts.length > 0) lines.push(parts.join(' · '))
    if (slate.note?.trim()) lines.push(`场记备注：${slate.note.trim()}`)
  }

  if (data.sceneBrief?.trim()) lines.push(`场景：${data.sceneBrief.trim()}`)

  const backdrop = backdropWord(data)
  if (backdrop) lines.push(`环境：${backdrop}。`)

  if (data.actors.length > 0) {
    lines.push('画面主体：')
    for (const line of crowdSummaryLines(data.actors)) lines.push(`- ${line}`)
    const first = data.actors[0]!
    for (const actor of data.actors) {
      const dx = actor.position[0] - camera.position[0]
      const dz = actor.position[2] - camera.position[2]
      const dist = Math.hypot(dx, dz)
      const bodyType = STAGE3D_BODY_TYPE_LABEL[actor.bodyType]
      const pose = poseDescription(actor)
      const facing = facingWord(actor, camera)
      const place = `位于${lateralWord(actor.position[0])}${depthWord(dist)}`
      const note = actor.note?.trim() ? `，${actor.note.trim()}` : ''
      lines.push(`- ${actor.name}（${bodyType}体型）${place}，${pose}，${facing}${note}`)
      // 角色数 ≥2 时，为除第一个角色外的每个角色追加一句相对第一个角色的方位关系
      if (data.actors.length >= 2 && actor.id !== first.id) {
        lines.push(`  · ${actor.name}位于${first.name}${relativeWord(first.position, actor.position)}`)
      }
    }
  }

  if (data.props.length > 0) {
    lines.push('道具陈设：')
    if (data.props.length > 6) {
      for (const line of propSummaryLines(data.props, data.actors)) lines.push(`- ${line}`)
    } else {
      for (const prop of data.props) lines.push(`- ${propPlacementLine(prop, data.actors)}`)
    }
  }

  const focal = fovToFocal(camera.fov)
  lines.push(
    `镜头：${focal}mm 等效焦段（垂直视角约 ${Math.round(camera.fov)}°），${camera.aspect} 画幅。`,
  )

  // 机位高度描述 + 到主体（第一个角色，无角色则场景原点）的水平距离
  const camHeight = camera.position[1]
  const targetHeight = camera.target[1]
  let angleWord = '平视'
  if (camHeight - targetHeight > 0.6) angleWord = '俯视'
  else if (targetHeight - camHeight > 0.6) angleWord = '仰视'
  const subjectPos = data.actors[0]?.position ?? ORIGIN
  const camToSubjectDist = Math.hypot(camera.position[0] - subjectPos[0], camera.position[2] - subjectPos[2])
  lines.push(
    `机位：${angleWord}角度，相机高度约 ${camHeight.toFixed(1)}m，到主体水平距离约 ${camToSubjectDist.toFixed(1)}m。`,
  )

  // 灯光（三点布光预设 + 强度）
  const lighting = data.lighting
  if (lighting && lighting.preset !== 'none') {
    lines.push(`灯光：${STAGE3D_LIGHTING_LABEL[lighting.preset]}（强度 ${lighting.intensity.toFixed(1)}）。`)
  }

  // 构图
  const inFront = data.actors.length
  if (inFront === 1) lines.push('构图：单主体，注意留白与三分法。')
  else if (inFront >= 2) lines.push('构图：多主体分布，注意前后层次与平衡。')

  return lines.join('\n')
}
