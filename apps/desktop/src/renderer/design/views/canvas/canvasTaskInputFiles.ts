import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasNode } from './canvas.types'
import { decodeCanvasSafeFileUrl } from './canvas-safe-file'

export type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
export type CanvasTaskInputRoleSelection = CanvasTaskInputRole | CanvasTaskInputRole[]

export function buildTaskInputFiles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): CanvasMediaTaskInputFile[] {
  let imageIndex = 0
  return nodes.flatMap((node) => {
    const url = node.data.url
    const fileId = node.data.fileId
    // provider 文件节点（来自「素材中心 → Files」）只有 fileId、没有本地 url；
    // 命中 fileId 即透传，由 adapter 上传短路（MiniMax H3 用 mm_file://{id}）。
    if (!url && !fileId) return []
    const type =
      node.type === 'image'
        ? ('image' as const)
        : node.type === 'audio'
          ? ('audio' as const)
          : node.type === 'video'
            ? ('video' as const)
            : ('file' as const)
    const currentImageIndex = node.type === 'image' ? imageIndex++ : -1
    const explicitRoles = normalizeCanvasTaskInputRoleSelection(inputRoles?.[node.id])
    const roles =
      explicitRoles.length > 0
        ? explicitRoles
        : [
            currentImageIndex >= 0
              ? currentImageIndex === 0
                ? ('first_frame' as const)
                : currentImageIndex === 1
                  ? ('last_frame' as const)
                  : ('reference' as const)
              : ('input' as const),
          ]
    return roles.map((role) => ({
      type,
      role,
      // 本地媒体任务（local_media 通道，如分离音频）需要真实磁盘路径。
      // 节点 data.filePath 优先直传；无本地路径时退回 url（safe-file:// / https:// / data:）。
      ...(node.data.filePath ? { path: node.data.filePath } : {}),
      ...(fileId
        ? { fileId }
        : url
          ? url.startsWith('data:')
            ? { dataUrl: url }
            : { url }
          : {}),
      ...(node.data.mimeType ? { mimeType: node.data.mimeType } : {}),
    }))
  })
}

export function normalizeCanvasTaskInputRoleSelection(
  selection: CanvasTaskInputRoleSelection | undefined,
): CanvasTaskInputRole[] {
  if (!selection) return []
  const values = Array.isArray(selection) ? selection : [selection]
  return Array.from(new Set(values.filter(Boolean)))
}

export function buildReferenceImageInputRoles(
  imageNodeIds: readonly string[],
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = {}
  for (const nodeId of imageNodeIds) {
    if (nodeId) roles[nodeId] = 'reference'
  }
  return roles
}

/**
 * 从任务输入（本地绝对路径 / safe-file:// / http(s) URL）提取源文件名（去扩展名）。
 *
 * 用于分离音频等本地 ffmpeg 任务的产物命名：让产物名基于源视频文件名
 * （如 `宣传片_audio.mp3`），而不是 uuid 乱码；取不到时返回 undefined 由调用方兜底。
 */
export function canvasInputSourceBaseName(
  input: Pick<CanvasMediaTaskInputFile, 'path' | 'url'> | undefined,
): string | undefined {
  const raw = input?.path ?? input?.url ?? ''
  if (!raw) return undefined
  const decoded = raw.startsWith('safe-file://') ? decodeCanvasSafeFileUrl(raw) : raw
  const withoutQuery = (decoded ?? raw).split('?')[0] ?? ''
  const base = withoutQuery.split(/[\\/]/).pop() ?? ''
  const name = base.replace(/\.[^.]+$/, '')
  return name || undefined
}
