import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  MobileBridgeEvent,
  RemoteAgentArtifactFile,
  RemoteAgentArtifactSummary,
  RemoteAgentTaskEvent,
} from '@spark/protocol'
import { REMOTE_AGENT_MAX_ATTACHMENT_BYTES } from '@spark/protocol'
import { createLogger } from '@spark/shared'

const log = createLogger('remote-agent:artifacts')

interface ArtifactReference {
  remotePath: string
  summary: RemoteAgentArtifactSummary
}

export class RemoteAgentArtifactStore {
  private readonly referencesByTask = new Map<string, Map<string, ArtifactReference>>()
  private readonly fullyIndexedTasks = new Set<string>()

  constructor(private readonly getArtifactRoot: () => string) {}

  indexEvent(taskId: string, event: MobileBridgeEvent): void {
    if (event.type === 'presented_files') {
      for (const file of event.files ?? []) {
        if (typeof file.path === 'string' && file.path.trim()) {
          this.addReference(taskId, file.path, 'presented', file.title)
        }
      }
    }
    if (event.type === 'user_message') {
      for (const attachment of event.attachments ?? []) {
        if (typeof attachment.path === 'string' && attachment.path.trim()) {
          this.addReference(taskId, attachment.path, 'attachment', attachment.name)
        }
      }
    }
  }

  list(taskId: string): RemoteAgentArtifactSummary[] {
    return [...(this.referencesByTask.get(taskId)?.values() ?? [])].map(
      (reference) => reference.summary,
    )
  }

  isFullyIndexed(taskId: string): boolean {
    return this.fullyIndexedTasks.has(taskId)
  }

  markFullyIndexed(taskId: string): void {
    this.fullyIndexedTasks.add(taskId)
  }

  invalidateIndex(taskId: string): void {
    this.fullyIndexedTasks.delete(taskId)
  }

  getRemotePath(taskId: string, artifactId: string): string | null {
    return this.referencesByTask.get(taskId)?.get(artifactId)?.remotePath ?? null
  }

  toSafeEvent(taskId: string, event: MobileBridgeEvent): RemoteAgentTaskEvent {
    const safeEvent: Omit<MobileBridgeEvent, 'files' | 'attachments'> = {
      id: event.id,
      seq: event.seq,
      turnId: event.turnId,
      type: event.type,
      timestamp: event.timestamp,
    }
    if (event.content != null) safeEvent.content = event.content
    if (event.mode != null) safeEvent.mode = event.mode
    if (event.isFinal != null) safeEvent.isFinal = event.isFinal
    if (event.segmentId != null) safeEvent.segmentId = event.segmentId
    if (event.toolName != null) safeEvent.toolName = event.toolName
    if (event.toolCallId != null) safeEvent.toolCallId = event.toolCallId
    if (event.toolStatus != null) safeEvent.toolStatus = event.toolStatus
    if (event.status != null) safeEvent.status = event.status
    if (event.statusMessage != null) safeEvent.statusMessage = event.statusMessage
    return {
      ...safeEvent,
      taskId,
      ...(event.files != null
        ? {
            files: event.files.flatMap((file) => {
              const artifactId = this.artifactIdFor(taskId, file.path, 'presented')
              return artifactId == null
                ? []
                : [
                    {
                      artifactId,
                      ...(file.title != null ? { title: truncate(file.title, 200) } : {}),
                    },
                  ]
            }),
          }
        : {}),
      ...(event.attachments != null
        ? {
            attachments: event.attachments.flatMap((attachment) => {
              const artifactId = this.artifactIdFor(taskId, attachment.path, 'attachment')
              return artifactId == null
                ? []
                : [
                    {
                      type: attachment.type,
                      artifactId,
                      ...(attachment.name != null ? { name: truncate(attachment.name, 200) } : {}),
                    },
                  ]
            }),
          }
        : {}),
    }
  }

  async save(
    taskId: string,
    deviceId: string,
    artifactId: string,
    mimeType: string,
    base64: string,
  ): Promise<RemoteAgentArtifactFile> {
    const startedAt = Date.now()
    const reference = this.referencesByTask.get(taskId)?.get(artifactId)
    if (reference == null) throw new Error('远程产物不存在或已不可用')
    if (base64.length > Math.ceil((REMOTE_AGENT_MAX_ATTACHMENT_BYTES * 4) / 3) + 8) {
      throw new Error('远程产物超过 20 MiB 回传上限')
    }
    const data = decodeBase64(base64)
    if (data.length > REMOTE_AGENT_MAX_ATTACHMENT_BYTES) {
      throw new Error('远程产物超过 20 MiB 回传上限')
    }

    const root = path.resolve(this.getArtifactRoot())
    const taskDirectory = path.resolve(root, taskId)
    if (!isPathWithin(taskDirectory, root)) throw new Error('远程产物保存目录无效')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const rootStats = await lstat(root)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new Error('远程产物保存目录无效')
    }
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 })
    const taskDirectoryStats = await lstat(taskDirectory)
    if (taskDirectoryStats.isSymbolicLink() || !taskDirectoryStats.isDirectory()) {
      throw new Error('远程产物任务目录无效')
    }
    const fileName = sanitizeFileName(reference.summary.name)
    const outputPath = path.resolve(taskDirectory, `${artifactId}-${fileName}`)
    if (!isPathWithin(outputPath, taskDirectory)) throw new Error('远程产物文件名无效')
    try {
      const existing = await lstat(outputPath)
      if (existing.isSymbolicLink()) throw new Error('远程产物目标不能是符号链接')
      if (existing.isFile()) {
        return this.toFile(reference.summary, artifactId, mimeType, outputPath, existing.size)
      }
    } catch (error) {
      if (isNodeError(error) && error.code !== 'ENOENT') throw error
    }
    try {
      await writeFile(outputPath, data, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error
      const existing = await lstat(outputPath)
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error('远程产物目标已被占用', { cause: error })
      }
      return this.toFile(reference.summary, artifactId, mimeType, outputPath, existing.size)
    }
    log.info('remote artifact fetched', {
      taskId,
      deviceId,
      phase: 'artifact-fetch',
      durationMs: Date.now() - startedAt,
      sizeBytes: data.length,
    })
    return this.toFile(reference.summary, artifactId, mimeType, outputPath, data.length)
  }

  private addReference(
    taskId: string,
    remotePath: string,
    kind: 'attachment' | 'presented',
    title?: string,
  ): void {
    const artifactId = makeArtifactId(taskId, remotePath, kind)
    let references = this.referencesByTask.get(taskId)
    if (references == null) {
      references = new Map()
      this.referencesByTask.set(taskId, references)
    }
    references.set(artifactId, {
      remotePath,
      summary: {
        artifactId,
        name: title?.trim() || fileNameFromRemotePath(remotePath),
        ...(title?.trim() ? { title: truncate(title.trim(), 200) } : {}),
        kind,
      },
    })
  }

  private artifactIdFor(
    taskId: string,
    remotePath: string,
    kind: 'attachment' | 'presented',
  ): string | null {
    const artifactId = makeArtifactId(taskId, remotePath, kind)
    return this.referencesByTask.get(taskId)?.has(artifactId) ? artifactId : null
  }

  private toFile(
    summary: RemoteAgentArtifactSummary,
    artifactId: string,
    mimeType: string,
    localPath: string,
    sizeBytes: number,
  ): RemoteAgentArtifactFile {
    return { artifactId, name: summary.name, mimeType, localPath, sizeBytes }
  }
}

function makeArtifactId(
  taskId: string,
  remotePath: string,
  kind: 'attachment' | 'presented',
): string {
  return createHash('sha256')
    .update(`${taskId}\u0000${kind}\u0000${remotePath}`)
    .digest('hex')
    .slice(0, 32)
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('远程产物数据格式无效')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new Error('远程产物数据为空或不完整')
  }
  return decoded
}

function fileNameFromRemotePath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || 'remote-artifact'
}

function sanitizeFileName(value: string): string {
  const safe = value
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  return safe || 'remote-artifact'
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

function isPathWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error != null && typeof error === 'object' && 'code' in error
}
