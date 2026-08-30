import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { message } from 'antd'
import { isCanvasImageContentNode, isOperationNode } from '../canvas.capabilities'
import { canvasApi } from '../canvas.api'
import { resolveCanvasOperationResourceNode } from '../canvasOperationOutputModel'
import type { CanvasStageViewportControls } from '../CanvasStage'
import type { CanvasSnapshot } from '../canvas.types'
import type {
  CanvasImageScaleCompressSource,
  ImageScaleCompressConfirmInput,
} from './CanvasImageScaleCompressModal'

type UseCanvasImageScaleCompressOptions = {
  projectId: string
  snapshotRef: RefObject<CanvasSnapshot | null | undefined>
  viewportControlsRef: RefObject<CanvasStageViewportControls | null>
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>
  closeCanvasFloatPanels: (except?: 'node-edit') => void
  refreshTaskSnapshot: () => Promise<void>
}

/**
 * 图片尺寸压缩在画布工作区的控制器。
 *
 * 逻辑独立于超大的 CanvasWorkspaceView：统一解析普通图片/图片任务当前主产物，
 * 物化成功后刷新、选中并聚焦新节点。
 */
export function useCanvasImageScaleCompress({
  projectId,
  snapshotRef,
  viewportControlsRef,
  setSelectedNodeIds,
  closeCanvasFloatPanels,
  refreshTaskSnapshot,
}: UseCanvasImageScaleCompressOptions) {
  const [source, setSource] = useState<CanvasImageScaleCompressSource | null>(null)

  const open = useCallback(
    (nodeId: string) => {
      const snapshot = snapshotRef.current
      if (!snapshot) return
      const node = snapshot.nodes.find((item) => item.id === nodeId)
      if (!node) return

      const resolved = isOperationNode(node)
        ? resolveCanvasOperationResourceNode(node, snapshot)
        : node
      const target = resolved ?? node
      if (!isCanvasImageContentNode(target)) {
        message.warning('当前节点没有可处理的图片产物')
        return
      }
      const filePath = canvasApi.readMediaNodeLocalFilePath(target)
      if (!filePath) {
        message.warning('该图片没有可用的本地文件，暂不支持尺寸压缩')
        return
      }

      const anchorNodeId = snapshot.nodes.some((item) => item.id === target.id)
        ? target.id
        : node.id
      closeCanvasFloatPanels('node-edit')
      setSelectedNodeIds([anchorNodeId])
      setSource({
        nodeId: target.id,
        anchorNodeId,
        filePath,
        fileName: target.title ?? 'image',
        ...(typeof target.data.mimeType === 'string' && target.data.mimeType
          ? { mimeType: target.data.mimeType }
          : {}),
      })
    },
    [closeCanvasFloatPanels, setSelectedNodeIds, snapshotRef],
  )

  const confirm = useCallback(
    async (input: ImageScaleCompressConfirmInput) => {
      if (!source) throw new Error('缺少源图片')
      const boardId = snapshotRef.current?.board.id
      if (!boardId) throw new Error('画布尚未就绪')
      const created = await canvasApi.materializeImageScaleCompress({
        projectId,
        boardId,
        parentNodeId: source.nodeId,
        ...(source.anchorNodeId ? { anchorNodeId: source.anchorNodeId } : {}),
        filePath: source.filePath,
        fileName: source.fileName,
        ...(source.mimeType ? { mimeType: source.mimeType } : {}),
        scalePercent: input.scalePercent,
        compressPercent: input.compressPercent,
        onProgress: input.onProgress,
      })
      if (!created) throw new Error('压缩副本物化失败，请重试')
      await refreshTaskSnapshot()
      setSelectedNodeIds([created.id])
      window.requestAnimationFrame(() => viewportControlsRef.current?.focusNodes([created.id]))
      message.success(
        `已生成尺寸压缩副本（${input.scalePercent}% 尺寸 / 压缩到原大小 ${input.compressPercent}%）`,
      )
    },
    [projectId, refreshTaskSnapshot, setSelectedNodeIds, snapshotRef, source, viewportControlsRef],
  )

  const close = useCallback(() => setSource(null), [])

  return { source, open, close, confirm }
}
