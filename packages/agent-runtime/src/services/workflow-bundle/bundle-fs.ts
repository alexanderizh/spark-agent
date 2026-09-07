/**
 * 工作流包文件工具 — 目录收集、sha256、zip 打包/解包(fflate,与 tool-package-import 同源)
 */

import { createHash } from 'crypto'
import { readFile, readdir, lstat, realpath } from 'fs/promises'
import { join, relative, sep } from 'path'
import { zipSync, unzipSync } from 'fflate'

/** 打包防呆上限(与 tool-package-import 的限额口径一致) */
export const BUNDLE_PACK_LIMITS = {
  maxFiles: 5000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
} as const

export class BundleLimitError extends Error {}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 对「相对路径 → 内容」映射计算目录整体指纹:路径排序后逐文件哈希再总哈希。 */
export function hashDirectoryEntries(entries: Map<string, Uint8Array>): string {
  const paths = Array.from(entries.keys()).sort()
  const hash = createHash('sha256')
  for (const p of paths) {
    const content = entries.get(p)
    if (content == null) continue
    hash.update(p)
    hash.update('\0')
    hash.update(sha256Hex(content))
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** zip 内路径统一 POSIX 分隔符,并拒绝越界片段。 */
function toZipPath(relativePath: string): string {
  const normalized = relativePath.split(sep).join('/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new BundleLimitError(`非法包内路径: ${relativePath}`)
  }
  return normalized
}

/**
 * 递归收集目录下全部文件(内容读入内存)。跳过符号链接,超限抛 BundleLimitError。
 */
export async function collectDirectory(absDir: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  let total = 0
  // 顶层先解析真实路径:兼容宿主技能 junction 链接(_links),内部符号链接仍跳过以防循环。
  const resolvedRoot = await realpath(absDir).catch(() => absDir)
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (out.size >= BUNDLE_PACK_LIMITS.maxFiles) {
        throw new BundleLimitError(`技能文件数超过上限 ${BUNDLE_PACK_LIMITS.maxFiles}`)
      }
      const stat = await lstat(full)
      if (stat.size > BUNDLE_PACK_LIMITS.maxFileBytes) {
        throw new BundleLimitError(
          `单文件超过上限 ${BUNDLE_PACK_LIMITS.maxFileBytes} 字节: ${entry.name}`,
        )
      }
      total += stat.size
      if (total > BUNDLE_PACK_LIMITS.maxTotalBytes) {
        throw new BundleLimitError(`目录总大小超过上限 ${BUNDLE_PACK_LIMITS.maxTotalBytes} 字节`)
      }
      out.set(toZipPath(relative(resolvedRoot, full)), await readFile(full))
    }
  }
  await walk(absDir)
  return out
}

/** 把目录条目写入 zip 容器的指定前缀下,返回 zip 键 → 内容 映射。 */
export function directoryEntriesToZip(
  entries: Map<string, Uint8Array>,
  prefix: string,
): Record<string, Uint8Array> {
  const zipped: Record<string, Uint8Array> = {}
  const cleanPrefix = prefix.replace(/\/+$/, '')
  for (const [rel, content] of entries) {
    zipped[`${cleanPrefix}/${rel}`] = content
  }
  return zipped
}

/** 解压限制,防 zip 炸弹。 */
const UNZIP_LIMITS = {
  maxEntries: 50_000,
  maxOutputBytes: 2 * 1024 * 1024 * 1024,
} as const

/**
 * 同步解包 .sparkflow(zip)。拒绝绝对路径/反斜杠/`..` 片段与超限。
 */
export function unzipBundle(data: Uint8Array): Map<string, Uint8Array> {
  let decoded: Record<string, Uint8Array>
  try {
    decoded = unzipSync(data, {
      filter: (file) => {
        const name = file.name
        if (name.startsWith('/') || name.includes('\\')) return false
        if (name.split('/').includes('..')) return false
        return true
      },
    })
  } catch (err) {
    throw new Error(
      `无法解析 .sparkflow 压缩包: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    )
  }
  const names = Object.keys(decoded)
  if (names.length > UNZIP_LIMITS.maxEntries) {
    throw new BundleLimitError(`压缩包条目数超过上限 ${UNZIP_LIMITS.maxEntries}`)
  }
  let total = 0
  const out = new Map<string, Uint8Array>()
  for (const name of names) {
    const content = decoded[name]
    if (content == null) continue
    total += content.byteLength
    if (total > UNZIP_LIMITS.maxOutputBytes) {
      throw new BundleLimitError('解压后总大小超过上限')
    }
    out.set(name, content)
  }
  return out
}

/** 用条目映射构建 zip 字节流。 */
export function zipEntries(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6 })
}
