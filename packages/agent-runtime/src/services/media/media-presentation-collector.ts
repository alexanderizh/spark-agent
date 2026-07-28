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

  private addCandidate(candidatePath: string, title?: string): void {
    const resolved = this.resolveFile(candidatePath)
    if (resolved == null || this.candidates.has(resolved)) return
    this.candidates.set(resolved, {
      path: resolved,
      ...(title != null && title.trim() !== '' ? { title: title.trim().slice(0, 120) } : {}),
    })
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
