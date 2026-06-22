import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('workspace-snapshot')

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  'Thumbs.db',
  'dist',
  'build',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.eslintcache',
  '*.pyc',
  '__pycache__',
  '.venv',
  'venv',
  '.env.local',
  '.env.*.local',
  'coverage',
  '.coverage',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '*.swp',
  '*.swo',
  '*~',
  '.spark-cache',
  '.spark-artifacts',
]

const MAX_FILES = 50_000

export interface FileEntry {
  mtimeMs: number
  size: number
}

export type FileSnapshot = Map<string, FileEntry>

export interface SnapshotDiffResult {
  added: string[]
  modified: string[]
  deleted: string[]
  truncated: boolean
}

function matchPattern(name: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    return name.endsWith(pattern.slice(1))
  }
  if (pattern.endsWith('.*')) {
    return name.startsWith(pattern.slice(0, -2))
  }
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    )
    return regex.test(name)
  }
  return name === pattern
}

function shouldIgnore(name: string): boolean {
  return DEFAULT_IGNORE_PATTERNS.some((p) => matchPattern(name, p))
}

export class WorkspaceSnapshotService {
  async snapshot(rootPath: string): Promise<FileSnapshot> {
    const result: FileSnapshot = new Map()
    let truncated = false
    let count = 0

    const walk = async (dir: string): Promise<void> => {
      if (truncated) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (truncated) return
        if (shouldIgnore(entry.name)) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile()) {
          if (count >= MAX_FILES) {
            truncated = true
            log.warn('workspace snapshot truncated', { rootPath, count })
            return
          }
          try {
            const st = await stat(fullPath)
            const rel = relative(rootPath, fullPath)
            result.set(rel, { mtimeMs: st.mtimeMs, size: st.size })
            count++
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    await walk(rootPath)
    if (truncated) log.warn('snapshot truncated', { rootPath, count: result.size })
    return result
  }

  diff(before: FileSnapshot, after: FileSnapshot): SnapshotDiffResult {
    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const [path, afterEntry] of after) {
      const beforeEntry = before.get(path)
      if (beforeEntry == null) {
        added.push(path)
      } else if (
        beforeEntry.mtimeMs !== afterEntry.mtimeMs ||
        beforeEntry.size !== afterEntry.size
      ) {
        modified.push(path)
      }
    }
    for (const path of before.keys()) {
      if (!after.has(path)) deleted.push(path)
    }

    return { added, modified, deleted, truncated: false }
  }
}
