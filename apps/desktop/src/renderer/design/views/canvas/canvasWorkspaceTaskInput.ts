import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import { buildTaskInputFiles, type CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
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
      if (file.type !== 'image') return file
      if (file.url && /^https?:\/\//i.test(file.url)) return file
      const filePath = file.url ? decodeSafeFileUrl(file.url) : null
      try {
        const uploaded = await window.spark.invoke('auth:upload-file', {
          ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
          ...(filePath ? { filePath } : {}),
          fileName: `canvas-input-${index + 1}.${extensionFromMime(file.mimeType)}`,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        })
        return {
          type: file.type,
          ...(file.role ? { role: file.role } : {}),
          url: uploaded.aiUrl,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        }
      } catch (uploadError) {
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
        console.error('[CanvasTaskInput] Failed to upload input file for cloud_url transport', {
          index,
          role: file.role,
          mimeType: file.mimeType,
          uploadError,
        })
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
  return 'png'
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
