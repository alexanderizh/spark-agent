import { useCallback, useMemo } from 'react'
import { message } from 'antd'
import { encodeToSafeFileUrl } from '../canvas-safe-file'
import { isVideoWorkbenchUpstreamEdge } from '../canvasConnectionSemantics'
import type { CanvasNode, CanvasSnapshot } from '../canvas.types'
import type { CanvasResourceOption, LocalResourceFile } from './CanvasVideoWorkbenchModal'

export function useCanvasVideoWorkbenchResources({
  snapshot,
  projectId,
  workbenchNodeId,
  selectedNodes,
}: {
  snapshot: CanvasSnapshot | null
  projectId: string | null
  workbenchNodeId: string | null
  selectedNodes: readonly CanvasNode[]
}) {
  const allCanvasResources = useMemo<CanvasResourceOption[]>(
    () =>
      (snapshot?.nodes ?? []).flatMap((node) => {
        if (
          (node.type !== 'image' && node.type !== 'video') ||
          typeof node.data.url !== 'string' ||
          !node.data.url ||
          node.id === workbenchNodeId
        ) {
          return []
        }
        return [
          {
            id: node.id,
            title: node.title?.trim() || (node.type === 'video' ? '视频' : '图片'),
            url: node.data.url,
            kind: node.type,
            ...(typeof node.data.thumbnailUrl === 'string'
              ? { thumbnailUrl: node.data.thumbnailUrl }
              : {}),
          },
        ]
      }),
    [snapshot?.nodes, workbenchNodeId],
  )

  const addLocalResources = useCallback(async (): Promise<LocalResourceFile[]> => {
    if (!projectId) return []
    const picked = await window.spark.invoke('dialog:open-file', {
      title: '添加图片或视频资源',
      multiple: true,
      filters: [
        {
          name: '图片与视频',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'm4v',
            'avi',
            'mkv',
          ],
        },
      ],
    })
    const sourcePaths = picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])
    if (picked.canceled || sourcePaths.length === 0) return []
    const projectRootPath = snapshot?.project.rootPath
    const imported = await Promise.all(
      sourcePaths.map(async (sourcePath): Promise<LocalResourceFile | null> => {
        const extension = sourcePath.split('.').pop()?.toLowerCase() ?? ''
        const kind = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? 'image' : 'video'
        const copied = await window.spark.invoke('canvas:asset:copy-to-project', {
          projectId,
          ...(projectRootPath ? { projectRootPath } : {}),
          sourcePath,
          type: kind,
        })
        if (copied.error || !copied.filePath) return null
        return {
          path: copied.filePath,
          name: sourcePath.split(/[\\/]/).pop() || `${kind}-resource`,
          kind,
          url: encodeToSafeFileUrl(copied.filePath),
        }
      }),
    )
    const resources = imported.filter((resource): resource is LocalResourceFile => resource != null)
    if (resources.length < sourcePaths.length) {
      message.warning(`已导入 ${resources.length}/${sourcePaths.length} 个资源`)
    }
    return resources
  }, [projectId, snapshot?.project.rootPath])

  const pickCanvasResources = useCallback(async (): Promise<CanvasResourceOption[]> => {
    // 语义：返回"当前画布上可选的资源候选"，由工作台 Modal 内的 VideoWorkbenchResourcePicker
    // 提供缩略图多选 + 类型过滤 + 搜索 UI（旧的 Modal.confirm + 纯文字 Select 已废弃）。
    // 候选基于 allCanvasResources：同时包含用户手建节点与任务产物(task_output)节点——
    // 后者 url 经 materialize 已固化为持久 safe-file 路径，可安全纳入。
    if (allCanvasResources.length === 0) {
      message.info('当前画布没有可加入工作台的图片或视频节点')
    }
    // 用户当前在画布上选中的节点排前面，方便快速定位
    if (selectedNodes.length === 0) return allCanvasResources
    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    return [
      ...allCanvasResources.filter((r) => selectedIds.has(r.id)),
      ...allCanvasResources.filter((r) => !selectedIds.has(r.id)),
    ]
  }, [allCanvasResources, selectedNodes])

  const collectUpstreamResources = useCallback(async (): Promise<CanvasResourceOption[]> => {
    if (!snapshot || !workbenchNodeId) return []
    const upstreamNodeIds = new Set(
      snapshot.edges
        .filter((edge) => isVideoWorkbenchUpstreamEdge(edge, workbenchNodeId))
        .map((edge) => edge.sourceNodeId),
    )
    const resources: CanvasResourceOption[] = []
    for (const upstreamNodeId of upstreamNodeIds) {
      const candidateNodeIds = new Set([upstreamNodeId])
      for (const edge of snapshot.edges) {
        if (
          edge.sourceNodeId === upstreamNodeId &&
          (edge.type === 'generated' || edge.type === 'derived_from')
        ) {
          candidateNodeIds.add(edge.targetNodeId)
        }
      }
      const candidates = allCanvasResources.filter((resource) => candidateNodeIds.has(resource.id))
      const primary = candidates.find((resource) => resource.kind === 'video') ?? candidates[0]
      if (primary) resources.push(primary)
    }
    return Array.from(new Map(resources.map((resource) => [resource.id, resource])).values())
  }, [allCanvasResources, snapshot, workbenchNodeId])

  return { addLocalResources, pickCanvasResources, collectUpstreamResources }
}
