/**
 * 无限画布 · 全局提示词库文件夹包导入导出 IPC。
 *
 * 包结构：
 *   <父目录>/<包名>-<时间戳>/
 *     prompt-library.json   — kind=spark.prompt-library 的清单（条目字段与全局库一致）
 *     covers/0001-<条目id>.<ext> — 封面二进制文件，清单内以 coverFile 相对路径引用
 *
 * 渲染进程只面向 data URL：导出请求的 items 把封面内联在 coverUrl，主进程落盘时
 * 拆成 covers/ 文件；导入读取时反向把文件重新内联成 coverUrl data URL 返回。
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('prompt-library-package-ipc')

const PACKAGE_KIND = 'spark.prompt-library'
const MANIFEST_FILE = 'prompt-library.json'
/** 与提示词编辑器一致：单张封面不超过 8MB */
const MAX_COVER_BYTES = 8 * 1024 * 1024

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

const EXTENSION_MIME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSION_MAP).map(([mime, ext]) => [ext, mime]),
)

const ALLOWED_COVER_EXTENSIONS = new Set(Object.keys(EXTENSION_MIME_MAP))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizePackageSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 60) : fallback
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim())
  if (match == null || !match[2]) throw new Error('封面 data URL 格式无效')
  const mimeType = (match[1] ?? 'application/octet-stream').toLowerCase()
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) throw new Error('封面 data URL 内容为空')
  return { buffer, mimeType }
}

/** 导出：把内联 coverUrl(data URL) 拆成 covers/ 文件并写清单。返回实际写入的条目数。 */
export async function writePromptLibraryPackageToDirectory(input: {
  targetParentDirectory: string
  packageName?: string
  packageJson: string
}): Promise<{ directoryPath: string; exportedCount: number }> {
  let payload: unknown
  try {
    payload = JSON.parse(input.packageJson)
  } catch {
    throw new Error('提示词库包数据无法解析')
  }
  if (!isRecord(payload) || payload.kind !== PACKAGE_KIND || !Array.isArray(payload.items)) {
    throw new Error('提示词库包数据格式不正确')
  }

  const parent = path.resolve(input.targetParentDirectory)
  await mkdir(parent, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const packageDir = path.join(
    parent,
    `${sanitizePackageSegment(input.packageName, 'spark-prompt-library')}-${stamp}`,
  )
  await mkdir(path.join(packageDir, 'covers'), { recursive: true })

  let exportedCount = 0
  const items: Record<string, unknown>[] = []
  let coverIndex = 0
  for (const rawItem of payload.items) {
    if (!isRecord(rawItem) || typeof rawItem.id !== 'string' || typeof rawItem.text !== 'string') {
      continue
    }
    const item: Record<string, unknown> = { ...rawItem }
    const itemId = typeof rawItem.id === 'string' ? rawItem.id : ''
    const coverUrl = typeof item.coverUrl === 'string' && item.coverUrl ? item.coverUrl : null
    delete item.coverDataUrl
    if (coverUrl) {
      coverIndex += 1
      const parsed = parseDataUrl(coverUrl)
      const extension = MIME_EXTENSION_MAP[parsed.mimeType] ?? 'png'
      const fileName = `${String(coverIndex).padStart(4, '0')}-${sanitizePackageSegment(itemId, 'prompt')}.${extension}`
      await writeFile(path.join(packageDir, 'covers', fileName), parsed.buffer)
      item.coverFile = `covers/${fileName}`
      item.coverMimeType = parsed.mimeType
    } else {
      item.coverFile = null
      if (item.coverMimeType !== undefined) item.coverMimeType = null
    }
    delete item.coverUrl
    items.push(item)
    exportedCount += 1
  }

  const manifest = { ...payload, items }
  await writeFile(path.join(packageDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8')
  return { directoryPath: packageDir, exportedCount }
}

/**
 * 导入：读取目录下的清单，把 coverFile 指向的封面文件重新内联成 coverUrl(data URL)。
 * 单个封面不合法（越界路径 / 超限 / 读取失败）时丢弃该封面但保留条目。
 */
export async function readPromptLibraryPackageFromDirectory(directory: string): Promise<string> {
  const root = path.resolve(directory)
  const manifestPath = path.join(root, MANIFEST_FILE)
  const manifestRaw = await readFile(manifestPath, 'utf-8')
  let payload: unknown
  try {
    payload = JSON.parse(manifestRaw)
  } catch {
    throw new Error('prompt-library.json 无法解析')
  }
  if (!isRecord(payload) || payload.kind !== PACKAGE_KIND || !Array.isArray(payload.items)) {
    throw new Error('所选文件夹不是有效的提示词库导出包')
  }

  const items = await Promise.all(
    payload.items.map(async (rawItem): Promise<unknown> => {
      if (!isRecord(rawItem)) return rawItem
      const item: Record<string, unknown> = { ...rawItem }
      const coverFile = typeof item.coverFile === 'string' ? item.coverFile.trim() : ''
      delete item.coverFile
      if (!coverFile) {
        item.coverUrl = null
        return item
      }
      const dataUrl = await readCoverFileAsDataUrl(root, coverFile, item)
      item.coverUrl = dataUrl
      if (dataUrl == null && item.coverMimeType !== undefined) item.coverMimeType = null
      return item
    }),
  )

  return JSON.stringify({ ...payload, items })
}

async function readCoverFileAsDataUrl(
  root: string,
  coverFile: string,
  item: Record<string, unknown>,
): Promise<string | null> {
  const invalid = (reason: string): null => {
    const id = typeof item.id === 'string' ? item.id : '(unknown)'
    log.warn(`prompt-library cover skipped, item=${id}, reason=${reason}, file=${coverFile}`)
    return null
  }
  if (path.isAbsolute(coverFile) || coverFile.includes('..')) {
    return invalid('path outside package')
  }
  const resolved = path.resolve(root, coverFile)
  if (!resolved.startsWith(root + path.sep)) return invalid('path outside package')
  if (!ALLOWED_COVER_EXTENSIONS.has(path.extname(resolved).slice(1).toLowerCase())) {
    return invalid('extension not allowed')
  }
  let size: number
  try {
    size = (await stat(resolved)).size
  } catch {
    return invalid('file missing')
  }
  if (size <= 0 || size > MAX_COVER_BYTES) return invalid('file size out of range')

  const declaredMime =
    typeof item.coverMimeType === 'string' && /^image\//i.test(item.coverMimeType)
      ? item.coverMimeType.toLowerCase()
      : null
  const mimeType =
    declaredMime ?? EXTENSION_MIME_MAP[path.extname(resolved).slice(1).toLowerCase()] ?? null
  if (!mimeType) return invalid('mime type unknown')

  try {
    const buffer = await readFile(resolved)
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  } catch {
    return invalid('read failed')
  }
}

export function registerPromptLibraryPackageIpc(): void {
  typedIpcHandle('prompt-library:export-package', async (req) => {
    try {
      const result = await writePromptLibraryPackageToDirectory({
        targetParentDirectory: req.targetParentDirectory,
        ...(req.packageName !== undefined ? { packageName: req.packageName } : {}),
        packageJson: req.packageJson,
      })
      return {
        exported: true,
        directoryPath: result.directoryPath,
        exportedCount: result.exportedCount,
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      log.warn(`prompt-library:export-package failed: ${errorText}`)
      return { exported: false, error: errorText }
    }
  })

  typedIpcHandle('prompt-library:read-package', async (req) => {
    try {
      const packageJson = await readPromptLibraryPackageFromDirectory(req.directory)
      return { found: true, packageJson }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      log.warn(`prompt-library:read-package failed: ${errorText}`)
      return { found: false, error: errorText }
    }
  })
}
