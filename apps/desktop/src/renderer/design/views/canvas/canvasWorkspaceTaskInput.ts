import type { CanvasInputBinding, CanvasMediaTaskInputFile } from '@spark/protocol'
import {
  buildTaskInputFiles,
  normalizeCanvasTaskInputRoleSelection,
  type CanvasTaskInputRole,
  type CanvasTaskInputRoleSelection,
} from './canvasTaskInputFiles'
import { createCanvasInputBinding } from './canvasInputBindings'
import type {
  CanvasAsset,
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
} from './canvas.types'
import { readBuiltinCanvasOperationPreset } from './canvasOperationPresets'
import { isOperationNode } from './canvas.capabilities'
import { resolveCanvasOperationInputNodes } from './canvasOperationOutputModel'
import {
  formatCanvasTextInputContext,
  presentCanvasTextForModel,
} from './canvasTextInputPresentation'
import type { CanvasSnapshot } from './canvas.types'

export function buildStoryboardReferenceInputRoles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = { ...(inputRoles ?? {}) }
  for (const node of nodes) {
    if (node.type === 'image' && node.data.url) roles[node.id] = 'reference'
  }
  return roles
}

/** Persist explicit media roles on a newly created operation node. */
export function buildCanvasInputBindingsForRoles(
  nodes: readonly CanvasNode[],
  inputRoles: Record<string, CanvasTaskInputRoleSelection>,
): CanvasInputBinding[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const bindings: CanvasInputBinding[] = []
  for (const [nodeId, selection] of Object.entries(inputRoles)) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    for (const role of normalizeCanvasTaskInputRoleSelection(selection)) {
      bindings.push(
        createCanvasInputBinding({
          sourceNodeId: nodeId,
          origin: 'connection',
          kind: canvasInputKind(node),
          relation: canvasRelationForInputRole(role),
          role,
          order: bindings.length,
        }),
      )
    }
  }
  return bindings
}

function canvasInputKind(node: CanvasNode): CanvasInputBinding['kind'] {
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') return node.type
  if (node.type === 'text' || node.type === 'prompt') return 'text'
  return 'file'
}

function canvasRelationForInputRole(role: CanvasTaskInputRole): CanvasInputBinding['relation'] {
  if (role === 'first_frame') return 'first_frame'
  if (role === 'last_frame') return 'last_frame'
  if (role === 'reference') return 'reference_image'
  return 'generic'
}

export async function buildCloudTaskInputFiles(
  nodes: CanvasNode[],
  inputTransport: CanvasInputTransport | undefined,
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): Promise<CanvasMediaTaskInputFile[]> {
  const files = buildTaskInputFiles(nodes, inputRoles)
  return materializeCanvasTaskInputFiles(files, inputTransport)
}

export async function materializeCanvasTaskInputFiles(
  files: CanvasMediaTaskInputFile[],
  inputTransport: CanvasInputTransport | undefined,
): Promise<CanvasMediaTaskInputFile[]> {
  if (files.length === 0) return files
  if (inputTransport === 'base64') {
    return Promise.all(files.map(materializeBase64Input))
  }
  if (inputTransport !== 'cloud_url') {
    return Promise.all(
      files.map(async (file) => {
        if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://')) {
          return file
        }
        try {
          return await materializeBase64Input(file)
        } catch {
          return file
        }
      }),
    )
  }
  return Promise.all(
    files.map(async (file, index) => {
      // provider 文件（已有 provider 侧 fileId）不经 auth:upload-file 物质化：
      // adapter 直接用 provider 引用（如 MiniMax H3 的 mm_file://{id}），短路返回。
      if (file.fileId) return file
      // 已是公网 URL 的直接用（图片/视频/音频统一）。
      if (file.url && /^https?:\/\//i.test(file.url)) return file
      // 非媒体类型（如 file）不在此处理。
      if (file.type !== 'image' && file.type !== 'video' && file.type !== 'audio') return file
      const filePath = file.url ? decodeSafeFileUrl(file.url) : null
      // 既无可上传的本地路径、也无 dataUrl 时，原样交下游处理。
      if (!filePath && !file.dataUrl) return file
      // 视频保留原始扩展名（避免 mime 缺失导致后端落盘文件名无扩展）。
      const fileName = filePath
        ? (filePath.split(/[\\/]/).pop() ??
          `canvas-input-${index + 1}.${extensionFromMime(file.mimeType)}`)
        : `canvas-input-${index + 1}.${extensionFromMime(file.mimeType)}`
      try {
        const uploaded = await window.spark.invoke('auth:upload-file', {
          ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
          ...(filePath ? { filePath } : {}),
          fileName,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        })
        return {
          type: file.type,
          ...(file.role ? { role: file.role } : {}),
          url: uploaded.aiUrl,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        }
      } catch (uploadError) {
        // 仅图片在平台上传失败时回退 base64；视频/音频过大不走 base64，直接抛错。
        if (file.type === 'image') {
          try {
            const fallback = await materializeBase64Input(file)
            if (fallback !== file) {
              console.warn(
                '[CanvasTaskInput] auth:upload-file failed; falling back to base64 input',
                {
                  index,
                  role: file.role,
                  mimeType: file.mimeType,
                  uploadError,
                },
              )
              return fallback
            }
          } catch (fallbackError) {
            console.error(
              '[CanvasTaskInput] Failed to materialize local input after upload failure',
              {
                index,
                role: file.role,
                mimeType: file.mimeType,
                uploadError,
                fallbackError,
              },
            )
          }
        } else {
          console.error(
            '[CanvasTaskInput] Failed to upload media input file for cloud_url transport',
            {
              index,
              role: file.role,
              mimeType: file.mimeType,
              uploadError,
            },
          )
        }
        throw uploadError
      }
    }),
  )
}

export function hydrateTextInputNodes(nodes: CanvasNode[], assets: CanvasAsset[]): CanvasNode[] {
  const assetTextById = new Map(
    assets
      .filter((asset) => asset.type === 'text' || asset.type === 'prompt')
      .map((asset) => [asset.id, asset.contentText?.trim() ?? '']),
  )
  return nodes.map((node) => {
    if (node.type !== 'text' && node.type !== 'prompt') return node
    const text = node.data.text?.trim() || (node.assetId ? assetTextById.get(node.assetId) : '')
    if (!text || text === node.data.text) return node
    return { ...node, data: { ...node.data, text } }
  })
}

export function mergePromptWithNodeContext(
  prompt: string,
  nodes: CanvasNode[],
  assets: CanvasAsset[] = [],
): string {
  const trimmedPrompt = prompt.trim()
  const context = buildPromptContext(nodes, assets)
  if (!context) return trimmedPrompt
  if (!trimmedPrompt) return context
  if (trimmedPrompt.includes(context)) return trimmedPrompt
  return `${trimmedPrompt}\n\n画布节点内容：\n${context}`
}

export function buildPipelineSourceText(nodes: CanvasNode[], assets: CanvasAsset[]): string {
  const byAssetId = new Map(assets.map((asset) => [asset.id, asset]))
  return nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => {
      const assetText = node.assetId ? byAssetId.get(node.assetId)?.contentText : undefined
      return presentCanvasTextForModel((assetText ?? node.data.text ?? '').trim())
    })
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
}

/**
 * 流水线菜单展示能力时会把操作节点视为其主产物；执行动作时也必须解析到同一份文本。
 * 有持久化产物节点时让下游直接连接产物，否则保留操作节点作为可展开的血缘入口。
 */
export function resolveCanvasPipelineTextSource(
  sourceNode: CanvasNode,
  snapshot: CanvasSnapshot,
): { sourceNode: CanvasNode; sourceText: string } {
  const inputNodes = expandCanvasInputNodes([sourceNode], snapshot)
  const sourceText = buildPipelineSourceText(inputNodes, snapshot.assets)
  if (!isOperationNode(sourceNode) || inputNodes.length !== 1) {
    return { sourceNode, sourceText }
  }

  const resolvedNode = inputNodes[0]
  if (!resolvedNode) return { sourceNode, sourceText }
  const persistedNode = snapshot.nodes.find((node) => node.id === resolvedNode.id)
  return {
    sourceNode: persistedNode ?? sourceNode,
    sourceText,
  }
}

export function expandCanvasInputNodes(
  selectedNodes: CanvasNode[],
  snapshot: CanvasSnapshot,
): CanvasNode[] {
  const allNodes = snapshot.nodes
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const result: CanvasNode[] = []
  const seen = new Set<string>()
  const pushNode = (node: CanvasNode, allowHidden = false) => {
    if ((!allowHidden && node.hidden) || seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
  }

  const expandNode = (node: CanvasNode) => {
    if (isOperationNode(node)) {
      const outputs = resolveCanvasOperationInputNodes(node, snapshot)
      if (outputs.length > 0) {
        for (const output of outputs) pushNode(output, true)
        return
      }
    }
    if (node.type !== 'group') {
      pushNode(node)
      return
    }
    const members = allNodes
      .filter((item) => item.parentNodeId === node.id && !item.hidden)
      .sort((left, right) => {
        const leftX = node.x + left.x
        const rightX = node.x + right.x
        const leftY = node.y + left.y
        const rightY = node.y + right.y
        return leftX - rightX || leftY - rightY || left.zIndex - right.zIndex
      })
    if (members.length === 0) {
      pushNode(node)
      return
    }
    for (const member of members) expandNode(byId.get(member.id) ?? member)
  }

  for (const node of selectedNodes) {
    expandNode(node)
  }

  return result
}

export function resolveCanvasInputNodes(
  nodeIds: string[] | undefined,
  snapshot: CanvasSnapshot,
): CanvasNode[] {
  if (!nodeIds || nodeIds.length === 0) return []
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const orderedNodes = nodeIds
    .map((id) => byId.get(id))
    .filter((node): node is CanvasNode => Boolean(node))
  return expandCanvasInputNodes(orderedNodes, snapshot)
}

/**
 * 把提交用输入节点 id 归一为「可持久化」的物理节点 id。
 *
 * 上游任务节点的产物未物化为画布节点时，输入展开链路（expandCanvasInputNodes）
 * 产出 `operation-output:*` 虚拟视图 id。这类 id 只用于编译执行输入；若原样写进
 * task.inputNodeIds / used_as_input 边，重建连线会因 source 节点不存在成为悬空边，
 * 画布上表现为「连线丢失」。这里把虚拟视图 id 回退映射到产生它的物理 owner 节点
 * （sourceNodes 的成员）；执行输入编译仍按产物视图（bindings / prompt 文档引用）进行。
 */
export function resolveCanvasPersistableInputNodeIds(
  nodeIds: readonly string[],
  sourceNodes: readonly CanvasNode[],
  snapshot: CanvasSnapshot,
): string[] {
  const physicalNodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const ownerNodeIdsByViewId = new Map<string, string>()
  for (const sourceNode of sourceNodes) {
    for (const viewNode of expandCanvasInputNodes([sourceNode], snapshot)) {
      if (viewNode.id === sourceNode.id || physicalNodeIds.has(viewNode.id)) continue
      ownerNodeIdsByViewId.set(viewNode.id, sourceNode.id)
    }
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const nodeId of nodeIds) {
    const targetNodeId = physicalNodeIds.has(nodeId)
      ? nodeId
      : (ownerNodeIdsByViewId.get(nodeId) ?? nodeId)
    if (seen.has(targetNodeId)) continue
    seen.add(targetNodeId)
    result.push(targetNodeId)
  }
  return result
}

/**
 * 过滤掉项目内不存在的 source 节点 id，避免重建 used_as_input 边时产生悬空边。
 * 与 createOperationNode 建边前的存在性校验同口径（仅校验 projectId，不限 board）。
 */
export function filterExistingCanvasInputNodeIds(
  nodeIds: readonly string[],
  nodes: readonly CanvasNode[],
  projectId: string,
): string[] {
  if (nodeIds.length === 0) return []
  const existingNodeIds = new Set(
    nodes.filter((node) => node.projectId === projectId).map((node) => node.id),
  )
  return nodeIds.filter((nodeId) => existingNodeIds.has(nodeId))
}

export function fallbackPromptForOperation(operation: CanvasOperationType): string {
  return readBuiltinCanvasOperationPreset(operation).prompt
}

async function materializeBase64Input(
  file: CanvasMediaTaskInputFile,
): Promise<CanvasMediaTaskInputFile> {
  if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://')) return file
  const dataUrl = await readUrlAsDataUrl(file.url)
  return {
    type: file.type,
    ...(file.role ? { role: file.role } : {}),
    dataUrl,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
  }
}

function readUrlAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.readAsDataURL(blob)
        }),
    )
}

function extensionFromMime(mimeType: string | undefined): string {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('png')) return 'png'
  // 其它图片格式（gif/bmp/tiff 等或缺失具体 mime）兜底 png，保留历史行为，避免落 .bin。
  if (mime.startsWith('image/')) return 'png'
  // 视频
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('matroska') || mime.includes('mkv')) return 'mkv'
  if (mime.includes('x-msvideo')) return 'avi'
  // 音频
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('aac')) return 'aac'
  if (mime.includes('flac')) return 'flac'
  return 'bin'
}

function decodeSafeFileUrl(safeFileUrl: string): string | null {
  try {
    if (!safeFileUrl.startsWith('safe-file://')) return null
    const rest = safeFileUrl.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return null
  }
}

function buildPromptContext(nodes: CanvasNode[], assets: CanvasAsset[] = []): string {
  const hydratedNodes = assets.length > 0 ? hydrateTextInputNodes(nodes, assets) : nodes
  return hydratedNodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => formatCanvasTextInputContext(node))
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
}
