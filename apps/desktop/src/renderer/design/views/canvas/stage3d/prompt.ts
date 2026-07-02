import type { Stage3DActor, Stage3DCamera, Stage3DData } from './stage3d.types'
import { STAGE3D_BODY_TYPE_LABEL, STAGE3D_LIGHTING_LABEL } from './stage3d.types'
import { POSE_LABEL } from './mannequin'

/**
 * 遍历 3D 场景生成结构化中文提示词：
 * 角色姿势 / 站位 / 朝向 / 相对关系、道具、背景、相机机位 / 焦段 / 画幅。
 * 风格参考 2D 版 buildDirectorPrompt。
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

function backdropWord(data: Stage3DData): string | null {
  const { backdrop } = data
  if (backdrop.mode === 'panorama') return '360° 全景环境包裹，真实空间光照'
  if (backdrop.mode === 'backdrop') return '远景背板作为场景背景'
  return null
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
    for (const actor of data.actors) {
      const dx = actor.position[0] - camera.position[0]
      const dz = actor.position[2] - camera.position[2]
      const dist = Math.hypot(dx, dz)
      const bodyType = STAGE3D_BODY_TYPE_LABEL[actor.bodyType]
      const pose = POSE_LABEL[actor.pose] ?? actor.pose
      const facing = facingWord(actor, camera)
      const place = `位于${lateralWord(actor.position[0])}${depthWord(dist)}`
      const note = actor.note?.trim() ? `，${actor.note.trim()}` : ''
      lines.push(`- ${actor.name}（${bodyType}体型）${place}，${pose}姿势，${facing}${note}`)
    }
  }

  if (data.props.length > 0) {
    const propWords = data.props.map((p) => p.name).join('、')
    lines.push(`道具陈设：${propWords}。`)
  }

  const focal = fovToFocal(camera.fov)
  lines.push(
    `镜头：${focal}mm 等效焦段（垂直视角约 ${Math.round(camera.fov)}°），${camera.aspect} 画幅。`,
  )

  // 机位高度描述
  const camHeight = camera.position[1]
  const targetHeight = camera.target[1]
  let angleWord = '平视'
  if (camHeight - targetHeight > 0.6) angleWord = '俯视'
  else if (targetHeight - camHeight > 0.6) angleWord = '仰视'
  lines.push(`机位：${angleWord}角度，相机高度约 ${camHeight.toFixed(1)}m。`)

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
