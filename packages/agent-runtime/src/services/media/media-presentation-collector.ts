import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'

const MAX_PRESENTED_MEDIA_PER_TURN = 20
const MAX_RESULT_NODES = 1_000
const MAX_RESULT_DEPTH = 12

const MEDIA_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.webm',
])

const USER_MEDIA_TOOL_MARKERS = [
  'spark_image',
  'spark_media',
  'generate_image',
  'edit_image',
  'imagegen',
  'screenshot',
  'capture_app_snapshot',
] as const

export interface PresentedMediaFile {
  path: string
  title?: string
}

/**
 * Collects user-facing media artifacts during one turn. It never treats ordinary
 * Computer Use observation/evidence frames as deliverables and never exposes a
 * path outside the active workspace.
 */
export class MediaPresentationCollector {
  private readonly workspaceRoot: string | null
  private readonly candidates = new Map<string, PresentedMediaFile>()
  private readonly presented = new Set<string>()
  private readonly emitted = new Set<string>()
  private drained = false
  // 新观察到的、尚未即时发出的候选。session 层在每个 event 流过后调 drainPending()
  // 把它们就地发出，使媒体紧跟生图/截图等工具调用展示，而不是攒到 turn 末尾。
  private readonly pendingEmit: PresentedMediaFile[] = []

  constructor(workspaceRootPath: string) {
    this.workspaceRoot = trustedWorkspaceRoot(workspaceRootPath)
  }

  observe(event: AgentEvent): void {
    if (this.workspaceRoot == null) return
    if (event.type === 'file_change' && event.changeType !== 'delete') {
      if (isMediaPath(event.path)) this.addCandidate(event.path)
      return
    }
    if (event.type !== 'tool_result' || event.status !== 'success') return

    const toolName = event.toolName.toLowerCase()
    if (toolName.endsWith('present_files')) {
      for (const candidate of collectResultPaths(event.output)) {
        const resolved = this.resolveFile(candidate.path)
        if (resolved != null) this.presented.add(resolved)
      }
      return
    }
    if (!USER_MEDIA_TOOL_MARKERS.some((marker) => toolName.includes(marker))) return
    if (toolName.includes('computer') && !toolName.includes('capture_app_snapshot')) return

    for (const candidate of collectResultPaths(event.output)) {
      if (isMediaPath(candidate.path)) this.addCandidate(candidate.path, candidate.title)
    }
  }

  takeUnpresented(): PresentedMediaFile[] {
    if (this.drained) return []
    this.drained = true
    const files: PresentedMediaFile[] = []
    for (const [resolved, candidate] of this.candidates) {
      if (this.presented.has(resolved) || this.emitted.has(resolved)) continue
      files.push(candidate)
      this.emitted.add(resolved)
      if (files.length >= MAX_PRESENTED_MEDIA_PER_TURN) break
    }
    return files
  }

  /**
   * 即时取出本轮新观察到、且未被主动展示/已发出的媒体候选。由 session 层在每个
   * event 流过后调用，使媒体产物紧跟生图/截图等工具调用就地展示。已发出的路径
   * 记入 emitted，避免与 agent 主动 present_files 或 turn 末兜底重复。单 turn
   * 总量受 MAX_PRESENTED_MEDIA_PER_TURN 约束（以 emitted 已计入的数量为准）。
   */
  drainPending(): PresentedMediaFile[] {
    if (this.pendingEmit.length === 0) return []
    const files: PresentedMediaFile[] = []
    for (const file of this.pendingEmit) {
      if (this.emitted.size >= MAX_PRESENTED_MEDIA_PER_TURN) break
      if (this.presented.has(file.path) || this.emitted.has(file.path)) continue
      files.push(file)
      this.emitted.add(file.path)
    }
    this.pendingEmit.length = 0
    return files
  }

  /**
   * agent 主动调用 present_files 时的去重入口：丢弃已被即时发出（auto-inline）的路径，
   * 保留下来的记入 emitted（供后续 drainPending / takeUnpresented 跳过，也避免 agent
   * 重复 present_files 同一文件时二次出卡）。注意：不能检查 presented 集合——observe()
   * 在处理同一个 present_files tool_result 时已把路径预填进 presented，若这里再用 presented
   * 去重会把 agent 主动展示的文件全部误杀。入参 path 应为已解析（realpathSync）的绝对路径，
   * 与 extractPresentedFiles 的返回格式一致。
   */
  markAgentPresented(files: PresentedMediaFile[]): PresentedMediaFile[] {
    const deduped: PresentedMediaFile[] = []
    for (const file of files) {
      if (this.emitted.has(file.path)) continue
      this.emitted.add(file.path)
      deduped.push(file)
    }
    return deduped
  }

  private addCandidate(candidatePath: string, title?: string): void {
    const resolved = this.resolveFile(candidatePath)
    if (resolved == null || this.candidates.has(resolved)) return
    const file: PresentedMediaFile = {
      path: resolved,
      ...(title != null && title.trim() !== '' ? { title: title.trim().slice(0, 120) } : {}),
    }
    this.candidates.set(resolved, file)
    this.pendingEmit.push(file)
  }

  private resolveFile(candidatePath: string): string | null {
    if (this.workspaceRoot == null || candidatePath.trim() === '') return null
    try {
      const resolved = realpathSync(
        path.isAbsolute(candidatePath)
          ? candidatePath
          : path.resolve(this.workspaceRoot, candidatePath),
      )
      if (!isPathInside(this.workspaceRoot, resolved) || !statSync(resolved).isFile()) return null
      return resolved
    } catch {
      return null
    }
  }
}

function trustedWorkspaceRoot(workspaceRootPath: string): string | null {
  try {
    const resolved = realpathSync(workspaceRootPath)
    return statSync(resolved).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function isMediaPath(candidatePath: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(candidatePath).toLowerCase())
}

function collectResultPaths(output: unknown): PresentedMediaFile[] {
  const results: PresentedMediaFile[] = []
  const seenObjects = new Set<object>()
  let visited = 0

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_RESULT_DEPTH || visited >= MAX_RESULT_NODES || value == null) return
    visited += 1
    if (typeof value === 'string') {
      const parsed = parseJson(value)
      if (parsed !== null) {
        visit(parsed, depth + 1)
      } else if (isMediaPath(value)) {
        results.push({ path: value.trim() })
      }
      return
    }
    if (typeof value !== 'object') return
    if (seenObjects.has(value)) return
    seenObjects.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    const record = value as Record<string, unknown>
    const rawPath = firstString(record.filePath, record.outputPath, record.path)
    if (rawPath != null) {
      const title = firstString(record.title, record.name)
      results.push({ path: rawPath, ...(title != null ? { title } : {}) })
    }
    for (const nested of Object.values(record)) visit(nested, depth + 1)
  }

  visit(output, 0)
  return results
}

function parseJson(value: string): unknown | null {
  const trimmed = value.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}
