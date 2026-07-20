import { useCallback, useMemo } from 'react'
import { Modal, Select, message } from 'antd'
import { encodeToSafeFileUrl } from '../canvas-safe-file'
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
  const taskOutputNodeIds = useMemo(
    () =>
      new Set(
        (snapshot?.nodes ?? [])
          .filter((node) => node.data.origin === 'task_output')
          .map((node) => node.id),
      ),
    [snapshot?.nodes],
  )
  const selectableCanvasResources = useMemo(
    () => allCanvasResources.filter((resource) => !taskOutputNodeIds.has(resource.id)),
    [allCanvasResources, taskOutputNodeIds],
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
    if (selectableCanvasResources.length === 0) {
      message.info('当前画布没有可加入工作台的图片或视频节点')
      return []
    }
    return new Promise<CanvasResourceOption[]>((resolve) => {
      let selectedIds = selectableCanvasResources
        .filter((resource) => selectedNodes.some((node) => node.id === resource.id))
        .map((resource) => resource.id)
      Modal.confirm({
        title: '从画布选择资源',
        content: (
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 12 }}
            placeholder="选择图片或视频节点"
            defaultValue={selectedIds}
            options={selectableCanvasResources.map((resource) => ({
              value: resource.id,
              label: `${resource.kind === 'video' ? '视频' : '图片'} · ${resource.title}`,
            }))}
            onChange={(values) => {
              selectedIds = values.map(String)
            }}
          />
        ),
        okText: '加入资源面板',
        cancelText: '取消',
        onOk: () => {
          const selected = new Set(selectedIds)
          resolve(selectableCanvasResources.filter((resource) => selected.has(resource.id)))
        },
        onCancel: () => resolve([]),
      })
    })
  }, [selectableCanvasResources, selectedNodes])

  const collectUpstreamResources = useCallback(async (): Promise<CanvasResourceOption[]> => {
    if (!snapshot || !workbenchNodeId) return []
    const upstreamNodeIds = new Set(
      snapshot.edges
        .filter((edge) => edge.targetNodeId === workbenchNodeId && edge.type === 'used_as_input')
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
