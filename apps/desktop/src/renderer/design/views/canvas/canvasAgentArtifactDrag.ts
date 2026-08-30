import type { SessionAttachment } from '@spark/protocol'
import { decodeSafeFileUrl } from '../../components/filePreviewSource'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasAsset } from './canvas.types'

export const CANVAS_AGENT_ARTIFACT_DRAG_TYPE = 'application/x-spark-canvas-agent-artifact+json'

export type CanvasAgentArtifactDragPayload = {
  version: 1
  kind: 'canvas-artifact'
  id: string
  title: string
  artifactType: CanvasAsset['type']
  filePath?: string
  url?: string
  nodeId?: string
  assetId?: string
  taskId?: string
}

type CanvasArtifactSource = Pick<
  CanvasOperationOutputView,
  'id' | 'title' | 'type' | 'filePath' | 'url' | 'nodeId' | 'assetId' | 'taskId'
>

export function createCanvasAgentArtifactPayload(
  source: CanvasArtifactSource,
): CanvasAgentArtifactDragPayload {
  return {
    version: 1,
    kind: 'canvas-artifact',
    id: source.id,
    title: source.title,
    artifactType: source.type,
    ...(source.filePath ? { filePath: source.filePath } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.nodeId ? { nodeId: source.nodeId } : {}),
    ...(source.assetId ? { assetId: source.assetId } : {}),
    ...(source.taskId ? { taskId: source.taskId } : {}),
  }
}

export function createCanvasAgentAssetPayload(asset: CanvasAsset): CanvasAgentArtifactDragPayload {
  const metadataFilePath =
    typeof asset.metadata.filePath === 'string' ? asset.metadata.filePath : undefined
  return {
    version: 1,
    kind: 'canvas-artifact',
    id: asset.id,
    title: asset.title?.trim() || asset.type,
    artifactType: asset.type,
    ...(asset.storageKey ? { filePath: asset.storageKey } : {}),
    ...(!asset.storageKey && metadataFilePath ? { filePath: metadataFilePath } : {}),
    ...(asset.url ? { url: asset.url } : {}),
    assetId: asset.id,
  }
}

export function canDragCanvasAgentArtifact(payload: CanvasAgentArtifactDragPayload): boolean {
  return Boolean(payload.filePath?.trim() || payload.url?.trim())
}

export function writeCanvasAgentArtifactDrag(
  dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>,
  payload: CanvasAgentArtifactDragPayload,
): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(CANVAS_AGENT_ARTIFACT_DRAG_TYPE, JSON.stringify(payload))
  dataTransfer.setData('text/plain', payload.title)
}

export function hasCanvasAgentArtifactDrag(
  dataTransfer: Pick<DataTransfer, 'types'> | null | undefined,
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(CANVAS_AGENT_ARTIFACT_DRAG_TYPE)
}

export function readCanvasAgentArtifactDrag(
  dataTransfer: Pick<DataTransfer, 'getData'> | null | undefined,
): CanvasAgentArtifactDragPayload | null {
  if (dataTransfer == null) return null
  try {
    const raw = dataTransfer.getData(CANVAS_AGENT_ARTIFACT_DRAG_TYPE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CanvasAgentArtifactDragPayload>
    if (
      parsed.version !== 1 ||
      parsed.kind !== 'canvas-artifact' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.title !== 'string' ||
      !isCanvasAssetType(parsed.artifactType) ||
      !hasValidOptionalStringFields(parsed)
    ) {
      return null
    }
    return parsed as CanvasAgentArtifactDragPayload
  } catch {
    return null
  }
}

function hasValidOptionalStringFields(payload: Partial<CanvasAgentArtifactDragPayload>): boolean {
  return (['filePath', 'url', 'nodeId', 'assetId', 'taskId'] as const).every(
    (field) => payload[field] === undefined || typeof payload[field] === 'string',
  )
}

export function resolveCanvasAgentArtifactAttachment(
  payload: CanvasAgentArtifactDragPayload,
  projectRootPath?: string | null,
): SessionAttachment | null {
  const explicitPath = payload.filePath?.trim()
  const decodedUrlPath = decodeSafeFileUrl(payload.url ?? '')
  const rawPath = explicitPath || decodedUrlPath
  if (!rawPath) return null
  const path = isAbsolutePathLike(rawPath)
    ? rawPath
    : projectRootPath
      ? joinProjectPath(projectRootPath, rawPath)
      : null
  if (!path) return null
  return {
    type: payload.artifactType === 'image' ? 'image' : 'file',
    path,
  }
}

function joinProjectPath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/^[\\/]+/, '')}`
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isCanvasAssetType(value: unknown): value is CanvasAsset['type'] {
  return (
    value === 'image' ||
    value === 'audio' ||
    value === 'video' ||
    value === 'text' ||
    value === 'prompt' ||
    value === 'file'
  )
}
