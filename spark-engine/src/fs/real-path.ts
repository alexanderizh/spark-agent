import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Canonical absolute form of an existing directory. On Windows the same
 * directory is frequently reached through an 8.3 short name (`ADMINI~1`) in
 * one path and a long name in the other; the native realpath
 * (GetFinalPathNameByHandle) expands short names, string `resolve` does not.
 */
export function canonicalDirectory(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }
}

/**
 * Equality of two paths on the real filesystem, tolerant of 8.3 short names
 * and case differences that string comparison of resolved paths misses.
 */
export function isSameDirectory(left: string, right: string): boolean {
  return canonicalDirectory(left) === canonicalDirectory(right)
}
