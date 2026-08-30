import type { MediaInputRolePolicy } from '@spark/protocol'
import type {
  CanvasMediaInputRole,
  CanvasMediaInputUsageStatus,
} from './CanvasMediaInputThumb'

export type MediaInputRoleEntry = {
  role?: CanvasMediaInputRole
  usageStatus: CanvasMediaInputUsageStatus
}

export type ComputeMediaInputRoleMapArgs = {
  /** 上游 image|video 输入节点（已过滤） */
  mediaInputs: ReadonlyArray<{ id: string; type: string }>
  /** 用户勾选的输入节点 id（参考图路径的判定基础） */
  selectedInputNodeIds: ReadonlyArray<string>
  /** 是否走首尾帧路径（capabilitySupportsFrameRoles） */
  supportsFrameRoles: boolean
  /** 是否支持任何图片角色（capabilitySupportsImageRoles，比 frame roles 更宽） */
  supportsImageRoles: boolean
  /** inferRolePolicy(selectedCapability) 的结果 */
  policy: MediaInputRolePolicy
  /** selectedCapability.input.maxImages */
  maxImages: number
  firstFrameNodeId: string
  lastFrameNodeId: string
  referenceFrameNodeIds: ReadonlyArray<string>
  /** normalize 后的有效帧节点 id 列表 */
  explicitFrameNodeIds: ReadonlyArray<string>
}

/**
 * 为媒体输入缩略图计算角色（首帧/尾帧/参考图/输入视频/参考视频）和使用状态（已用/未用/超额）。
 *
 * 两条路径：
 *  - 帧角色路径（supportsFrameRoles，即 image_to_video / video_edit）：按显式选择的
 *    firstFrame/lastFrame/referenceFrame 映射 role；未分配到角色的 image 标 unused/overflow。
 *  - 纯参考图路径（supportsImageRoles 但非帧角色，即 video.generate 多模态参考 /
 *    image.edit / image.variations / image.compose）：所有 selectedInputNodeIds 里的 image
 *    标 reference_image/used；maxImages 仅作为 UI 风险提示，不在这里截断或标记丢弃。
 *
 * 之前 mediaInputRoleMap 在 !supportsVideoFrameRoles 时直接返回空 map，导致纯参考图场景
 * （文生视频拉了一堆参考图）缩略图无徽章、无用量判定——用户"不知道哪些图被用到"的根因。
 */
export function computeMediaInputRoleMap(
  args: ComputeMediaInputRoleMapArgs,
): Map<string, MediaInputRoleEntry> {
  const {
    mediaInputs,
    selectedInputNodeIds,
    supportsFrameRoles,
    supportsImageRoles,
    policy,
    firstFrameNodeId,
    lastFrameNodeId,
    referenceFrameNodeIds,
  } = args
  const map = new Map<string, MediaInputRoleEntry>()

  if (!supportsImageRoles) {
    for (const node of mediaInputs) map.set(node.id, { usageStatus: 'used' })
    return map
  }

  const videoRole = policy.videoRoles?.[0]
  const audioRole = policy.audioRoles?.[0]

  if (supportsFrameRoles) {
    for (const node of mediaInputs) {
      if (node.type !== 'image') {
        const role = node.type === 'audio' ? audioRole : videoRole
        map.set(node.id, role ? { role, usageStatus: 'used' } : { usageStatus: 'used' })
        continue
      }
      if (node.id === firstFrameNodeId) {
        map.set(node.id, { role: 'first_frame', usageStatus: 'used' })
      } else if (node.id === lastFrameNodeId) {
        map.set(node.id, { role: 'last_frame', usageStatus: 'used' })
      } else if (referenceFrameNodeIds.includes(node.id)) {
        map.set(node.id, { role: 'reference_image', usageStatus: 'used' })
      } else {
        map.set(node.id, { usageStatus: 'unused' })
      }
    }
    return map
  }

  // 纯参考图路径
  const selectedSet = new Set(selectedInputNodeIds)
  for (const node of mediaInputs) {
    if (node.type === 'image') {
      if (selectedSet.has(node.id)) {
        map.set(node.id, { role: 'reference_image', usageStatus: 'used' })
      } else {
        map.set(node.id, { usageStatus: 'unused' })
      }
    } else if (node.type === 'video') {
      map.set(node.id, videoRole ? { role: videoRole, usageStatus: 'used' } : { usageStatus: 'used' })
    } else {
      map.set(node.id, audioRole ? { role: audioRole, usageStatus: 'used' } : { usageStatus: 'used' })
    }
  }
  return map
}
