import * as fs from 'node:fs/promises'
import path from 'node:path'

export type GitFileLineStats = {
  additions: number
  deletions: number
}

const EMPTY_STATS: GitFileLineStats = { additions: 0, deletions: 0 }
const READ_BUFFER_SIZE = 64 * 1024
const DEFAULT_CONCURRENCY = 16

/**
 * Git does not include untracked files in `git diff --numstat HEAD`. Count text
 * lines directly so the review UI can still show useful addition statistics.
 * Binary files match Git's numstat behaviour and contribute zero text lines.
 */
export async function getUntrackedFileLineStats(
  rootPath: string,
  filePath: string,
): Promise<GitFileLineStats> {
  const absoluteRoot = path.resolve(rootPath)
  const absolutePath = path.resolve(absoluteRoot, filePath)
  const relativePath = path.relative(absoluteRoot, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return EMPTY_STATS

  try {
    const stat = await fs.lstat(absolutePath)
    // Git represents a newly added symlink as one line containing its target.
    if (stat.isSymbolicLink()) return { additions: 1, deletions: 0 }
    if (!stat.isFile() || stat.size === 0) return EMPTY_STATS

    const handle = await fs.open(absolutePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE)
      let additions = 0
      let bytesReadTotal = 0
      let lastByte = -1

      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        bytesReadTotal += bytesRead
        lastByte = buffer[bytesRead - 1] ?? -1
        for (let index = 0; index < bytesRead; index += 1) {
          const byte = buffer[index]
          if (byte === 0) return EMPTY_STATS
          if (byte === 10) additions += 1
        }
      }

      if (bytesReadTotal > 0 && lastByte !== 10) additions += 1
      return { additions, deletions: 0 }
    } finally {
      await handle.close()
    }
  } catch {
    // A file may disappear between `git status` and this read. The next refresh
    // will reconcile the list, so keep this refresh usable instead of failing it.
    return EMPTY_STATS
  }
}

export async function getUntrackedFilesLineStats(
  rootPath: string,
  filePaths: string[],
  concurrency = DEFAULT_CONCURRENCY,
): Promise<Map<string, GitFileLineStats>> {
  const result = new Map<string, GitFileLineStats>()
  if (filePaths.length === 0) return result

  let cursor = 0
  const workerCount = Math.min(Math.max(1, concurrency), filePaths.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < filePaths.length) {
        const filePath = filePaths[cursor]
        cursor += 1
        if (filePath == null) continue
        result.set(filePath, await getUntrackedFileLineStats(rootPath, filePath))
      }
    }),
  )
  return result
}
