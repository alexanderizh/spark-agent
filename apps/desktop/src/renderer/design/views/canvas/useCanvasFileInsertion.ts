import { useCallback, useEffect, useRef, type ChangeEvent, type RefObject } from 'react'
import { message } from 'antd'
import {
  encodeToSafeFileUrl,
  readFileAsDataUrl,
  readImageDimensions,
  readVideoDimensions,
} from './canvas-safe-file'
import { classifyDroppedFile, layoutDroppedFiles, textFormatFromFileName } from './canvasFileDrop'
import {
  getImageGridMetrics,
  fitImageNodeSize,
  GROUP_IMAGE_HEADER_HEIGHT,
  GROUP_IMAGE_PADDING_BOTTOM,
  GROUP_IMAGE_PADDING_X,
  layoutGroupedImages,
  positionNodeInViewport,
  type CanvasWorkspacePoint,
  type PreparedImageUpload,
} from './canvasWorkspacePlacement'
import {
  AUDIO_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  VIDEO_NODE_DEFAULT_SIZE,
  fitCanvasGroupedImageNodeSize,
} from './canvasNodeSize'
import type { CanvasStageViewport } from './CanvasStage'
import type { PendingCanvasConnection } from './canvasPendingConnection'
import type { CanvasNode, CanvasProject } from './canvas.types'

type CanvasSnapshotLike = {
  project: Pick<CanvasProject, 'rootPath'>
}

type CreateImageNode = (input: {
  file: File
  filePath: string
  x: number
  y: number
  width?: number
  height?: number
  imageWidth?: number
  imageHeight?: number
}) => Promise<CanvasNode | undefined>

type CreateTextNode = (input: {
  text: string
  x: number
  y: number
  format?: 'plain' | 'markdown'
}) => Promise<CanvasNode | undefined>

type CreateMediaNode = (input: {
  kind: 'video' | 'audio'
  fileName: string
  fileMimeType?: string
  fileSize: number
  filePath: string
  x: number
  y: number
  mediaWidth?: number
  mediaHeight?: number
  durationMs?: number
}) => Promise<CanvasNode | undefined>

type UseCanvasFileInsertionOptions = {
  projectId: string
  snapshotRef: RefObject<CanvasSnapshotLike | null>
  canvasViewportRef: RefObject<CanvasStageViewport | null>
  pendingImageConnectionRef: RefObject<PendingCanvasConnection | null>
  pendingImagePositionRef: RefObject<CanvasWorkspacePoint | null>
  createImageNode: CreateImageNode
  createTextNode: CreateTextNode
  createMediaNode: CreateMediaNode
  createGroupNode: (nodeIds: string[]) => Promise<{ nodes: CanvasNode[] }>
  connectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => Promise<unknown>
  closeCanvasFloatPanels: () => void
  setSelectedNodeIds: (nodeIds: string[]) => void
}

type InsertPreparedImagesResult = {
  createdNodeCount: number
  grouped: boolean
  createdNodeIds: string[]
  groupNodeId?: string
}

export function useCanvasFileInsertion({
  projectId,
  snapshotRef,
  canvasViewportRef,
  pendingImageConnectionRef,
  pendingImagePositionRef,
  createImageNode,
  createTextNode,
  createMediaNode,
  createGroupNode,
  connectNodes,
  closeCanvasFloatPanels,
  setSelectedNodeIds,
}: UseCanvasFileInsertionOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const prepareCanvasImageUpload = useCallback(
    async (file: File, options?: { grouped?: boolean }): Promise<PreparedImageUpload> => {
      const snapshot = snapshotRef.current
      if (!snapshot) throw new Error('画布尚未加载')
      const dataUrl = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(dataUrl)
      const savedImage = await window.spark.invoke('file:save-pasted-image', {
        dataUrl,
        mimeType: file.type,
        suggestedBaseName: file.name.replace(/\.[^.]+$/, '') || 'canvas-image',
        storageScope: 'canvas',
        ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      })
      const nodeSize = options?.grouped
        ? fitCanvasGroupedImageNodeSize(dimensions.width, dimensions.height)
        : fitImageNodeSize(dimensions.width, dimensions.height)
      return {
        file,
        filePath: savedImage.filePath,
        width: nodeSize.width,
        height: nodeSize.height,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      }
    },
    [snapshotRef],
  )

  const insertPreparedImages = useCallback(
    async (
      preparedImages: PreparedImageUpload[],
      preferredPosition?: CanvasWorkspacePoint | null,
    ): Promise<InsertPreparedImagesResult> => {
      if (preparedImages.length === 0) {
        return { createdNodeCount: 0, grouped: false, createdNodeIds: [] }
      }
      if (preparedImages.length === 1) {
        const [image] = preparedImages
        if (!image) return { createdNodeCount: 0, grouped: false, createdNodeIds: [] }
        const position = preferredPosition
          ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
          : positionNodeInViewport(
              canvasViewportRef.current,
              { width: image.width, height: image.height },
              { x: 220, y: 180 },
            )
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: position.x,
          y: position.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) setSelectedNodeIds([node.id])
        return {
          createdNodeCount: node ? 1 : 0,
          grouped: false,
          createdNodeIds: node ? [node.id] : [],
        }
      }

      const gridMetrics = getImageGridMetrics(preparedImages)
      const groupSize = {
        width: Math.max(360, gridMetrics.width + GROUP_IMAGE_PADDING_X * 2),
        height: Math.max(
          220,
          GROUP_IMAGE_HEADER_HEIGHT + gridMetrics.height + GROUP_IMAGE_PADDING_BOTTOM,
        ),
      }
      const groupPosition = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(canvasViewportRef.current, groupSize, { x: 220, y: 180 })
      const placedImages = layoutGroupedImages(preparedImages, groupPosition)
      const createdNodeIds: string[] = []
      let groupNodeId: string | undefined
      for (const image of placedImages) {
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) createdNodeIds.push(node.id)
      }
      if (createdNodeIds.length > 1) {
        const nextSnapshot = await createGroupNode(createdNodeIds)
        const createdIdSet = new Set(createdNodeIds)
        const groupNode = nextSnapshot?.nodes.find((node) => {
          if (node.type !== 'group') return false
          const childIds = nextSnapshot.nodes
            .filter((child) => child.parentNodeId === node.id)
            .map((child) => child.id)
          return (
            createdNodeIds.every((id) => childIds.includes(id)) &&
            childIds.every((id) => createdIdSet.has(id))
          )
        })
        groupNodeId = groupNode?.id
        setSelectedNodeIds(groupNode ? [groupNode.id] : createdNodeIds)
      } else if (createdNodeIds.length === 1) {
        setSelectedNodeIds(createdNodeIds)
      }
      return {
        createdNodeCount: createdNodeIds.length,
        grouped: createdNodeIds.length > 1,
        createdNodeIds,
        ...(groupNodeId ? { groupNodeId } : {}),
      }
    },
    [canvasViewportRef, createGroupNode, createImageNode, setSelectedNodeIds],
  )

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? [])
      const preferredPosition = pendingImagePositionRef.current
      const pendingConnection = pendingImageConnectionRef.current
      pendingImagePositionRef.current = null
      pendingImageConnectionRef.current = null
      event.target.value = ''
      if (selectedFiles.length === 0) return
      const snapshot = snapshotRef.current
      if (!snapshot) return

      const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        message.warning('请选择图片文件')
        return
      }
      if (imageFiles.length < selectedFiles.length) {
        message.warning('已跳过非图片文件')
      }

      try {
        const preparedImages = await Promise.all(
          imageFiles.map((file) =>
            prepareCanvasImageUpload(file, { grouped: imageFiles.length > 1 }),
          ),
        )
        const result = await insertPreparedImages(preparedImages, preferredPosition)
        const targetNodeId = result.groupNodeId ?? result.createdNodeIds[0]
        if (pendingConnection && targetNodeId) {
          await connectNodes({ sourceNodeId: pendingConnection.sourceNodeId, targetNodeId })
        }
        if (result.createdNodeCount > 1 && result.grouped) {
          message.success(`已添加 ${result.createdNodeCount} 张图片并成组`)
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '添加图片失败')
      }
    },
    [
      connectNodes,
      insertPreparedImages,
      pendingImageConnectionRef,
      pendingImagePositionRef,
      prepareCanvasImageUpload,
      snapshotRef,
    ],
  )

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      const snapshot = snapshotRef.current
      if (!snapshot || !event.clipboardData) return

      const imageFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const text = event.clipboardData.getData('text/plain').trim()
      if (imageFiles.length === 0 && !text) return

      event.preventDefault()
      event.stopPropagation()

      const preferredPosition = positionNodeInViewport(
        canvasViewportRef.current,
        imageFiles.length > 0 ? IMAGE_NODE_DEFAULT_SIZE : TEXT_NODE_DEFAULT_SIZE,
        { x: 200, y: 150 },
      )

      void (async () => {
        try {
          if (imageFiles.length > 0) {
            const preparedImages = await Promise.all(
              imageFiles.map((file) =>
                prepareCanvasImageUpload(file, { grouped: imageFiles.length > 1 }),
              ),
            )
            const result = await insertPreparedImages(preparedImages, preferredPosition)
            if (result.createdNodeCount > 0) {
              message.success(
                result.createdNodeCount === 1
                  ? '已粘贴图片到画布'
                  : `已粘贴 ${result.createdNodeCount} 张图片到画布`,
              )
            }
            return
          }

          const node = await createTextNode({
            text,
            x: preferredPosition.x,
            y: preferredPosition.y,
          })
          if (node) {
            setSelectedNodeIds([node.id])
            message.success('已粘贴文本到画布')
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '粘贴到画布失败')
        }
      })()
    }

    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [
    canvasViewportRef,
    createTextNode,
    insertPreparedImages,
    prepareCanvasImageUpload,
    setSelectedNodeIds,
    snapshotRef,
  ])

  const handleDropFiles = useCallback(
    async (position: CanvasWorkspacePoint, files: File[]) => {
      const current = snapshotRef.current
      if (!current || files.length === 0) return
      closeCanvasFloatPanels()
      const origin = { x: Math.round(position.x), y: Math.round(position.y) }
      const projectRootPath = current.project.rootPath || undefined

      const images: File[] = []
      const texts: File[] = []
      const media: Array<{ file: File; kind: 'video' | 'audio' }> = []
      let unsupportedCount = 0
      for (const file of files) {
        const kind = classifyDroppedFile(file)
        if (kind === 'image') images.push(file)
        else if (kind === 'text') texts.push(file)
        else if (kind === 'video') media.push({ file, kind: 'video' })
        else if (kind === 'audio') media.push({ file, kind: 'audio' })
        else unsupportedCount += 1
      }

      const createdNodeIds: string[] = []

      try {
        if (images.length > 0) {
          const prepared = await Promise.all(
            images.map((file) =>
              prepareCanvasImageUpload(file, { grouped: images.length > 1 }),
            ),
          )
          const result = await insertPreparedImages(prepared, origin)
          for (const id of result.createdNodeIds) createdNodeIds.push(id)
        }

        if (texts.length > 0) {
          const positions = layoutDroppedFiles(texts.length, origin, TEXT_NODE_DEFAULT_SIZE)
          await Promise.all(
            texts.map(async (file, index) => {
              const text = await file.text()
              const format = textFormatFromFileName(file.name)
              const node = await createTextNode({
                text,
                x: positions[index]!.x,
                y: positions[index]!.y,
                ...(format === 'markdown' ? { format: 'markdown' } : {}),
              })
              if (node) createdNodeIds.push(node.id)
            }),
          )
        }

        if (media.length > 0) {
          await Promise.all(
            media.map(async (entry, index) => {
              const electronPath = (entry.file as File & { path?: string }).path
              if (!electronPath) return
              const copyResult = await window.spark.invoke('canvas:asset:copy-to-project', {
                projectId,
                ...(projectRootPath ? { projectRootPath } : {}),
                sourcePath: electronPath,
                type: entry.kind,
              })
              if (copyResult.error || !copyResult.filePath) return
              const filePath = copyResult.filePath as string
              const fileUrl = encodeToSafeFileUrl(filePath)
              let mediaWidth: number | undefined
              let mediaHeight: number | undefined
              let durationMs: number | undefined
              if (entry.kind === 'video') {
                const dims = await readVideoDimensions(fileUrl)
                mediaWidth = dims.width || undefined
                mediaHeight = dims.height || undefined
                durationMs = dims.durationMs
              }
              const defaultSize =
                entry.kind === 'video' ? VIDEO_NODE_DEFAULT_SIZE : AUDIO_NODE_DEFAULT_SIZE
              const positions = layoutDroppedFiles(1, origin, defaultSize)
              const basePos = positions[index] ?? origin
              const node = await createMediaNode({
                kind: entry.kind,
                fileName: entry.file.name,
                ...(entry.file.type ? { fileMimeType: entry.file.type } : {}),
                fileSize: entry.file.size,
                filePath,
                x: basePos.x,
                y: basePos.y,
                ...(mediaWidth ? { mediaWidth } : {}),
                ...(mediaHeight ? { mediaHeight } : {}),
                ...(durationMs ? { durationMs } : {}),
              })
              if (node) createdNodeIds.push(node.id)
            }),
          )
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '拖入文件到画布失败')
      }

      const totalSupported = images.length + texts.length + media.length
      if (totalSupported > 0) {
        if (createdNodeIds.length > 0) setSelectedNodeIds(createdNodeIds.slice(-1))
        message.success(
          totalSupported === 1
            ? '已添加文件到画布'
            : `已添加 ${totalSupported} 个文件到画布`,
        )
      }
      if (unsupportedCount > 0) {
        message.warning(`已跳过 ${unsupportedCount} 个不支持的文件`)
      }
    },
    [
      closeCanvasFloatPanels,
      createMediaNode,
      createTextNode,
      insertPreparedImages,
      prepareCanvasImageUpload,
      projectId,
      setSelectedNodeIds,
      snapshotRef,
    ],
  )

  return {
    fileInputRef,
    handleFileChange,
    handleDropFiles,
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    Boolean(
      target.closest('[contenteditable="true"], .canvas-inline-ai-composer, .ant-modal, .ant-drawer'),
    )
  )
}
