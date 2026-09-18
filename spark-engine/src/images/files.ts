/**
 * Reading image attachments from the filesystem.
 *
 * Both `-i/--image` and a pasted image path funnel through here so a file is
 * validated exactly once: size, container, and dimensions come from the bytes,
 * never from the file extension.
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'

import type { RuntimeLogger } from '../observability/logger.js'
import {
  IMAGE_LIMITS,
  detectImageMediaType,
  formatImageBytes,
  readImageDimensions,
  validateImageAttachments,
  type ImageReadResult,
  type TurnImageAttachment,
} from './attachments.js'

/** Extensions that may name an image for the "pasted a path" fast path. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const

/** Guard against treating a pasted document as a path. */
const MAX_PATH_CHARACTERS = 4_096

export interface ReadImageFileOptions {
  readonly readBytes?: (path: string) => Promise<Uint8Array>
  readonly logger?: RuntimeLogger
}

export async function readImageFile(
  path: string,
  options: ReadImageFileOptions = {},
): Promise<ImageReadResult> {
  const absolute = resolve(expandHome(path))
  const readBytes = options.readBytes ?? defaultReadBytes
  let bytes: Uint8Array
  try {
    bytes = await readBytes(absolute)
  } catch (error) {
    return isNodeError(error, 'ENOENT')
      ? { ok: false, code: 'not-found', message: `找不到图片文件：${absolute}` }
      : {
          ok: false,
          code: 'unreadable',
          message: `无法读取图片文件 ${basename(absolute)}：${errorMessage(error)}`,
        }
  }
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'unreadable', message: `图片文件为空：${basename(absolute)}` }
  }
  if (bytes.byteLength > IMAGE_LIMITS.maxBytesPerImage) {
    return {
      ok: false,
      code: 'too-large',
      message: `图片文件超过 ${formatImageBytes(IMAGE_LIMITS.maxBytesPerImage)} 上限（当前 ${formatImageBytes(bytes.byteLength)}）：${basename(absolute)}`,
    }
  }
  const mediaType = detectImageMediaType(bytes)
  if (mediaType === undefined) {
    return {
      ok: false,
      code: 'decode-failed',
      message: `不支持的图片格式（仅支持 PNG/JPEG/WEBP/GIF）：${basename(absolute)}`,
    }
  }
  const dimensions = readImageDimensions(bytes, mediaType)
  return {
    ok: true,
    image: {
      bytes,
      mediaType,
      name: basename(absolute),
      ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
    },
  }
}

export type LoadImageFilesResult =
  | { readonly ok: true; readonly images: readonly TurnImageAttachment[] }
  | { readonly ok: false; readonly message: string }

/** Reads a whole `-i/--image` list, rejecting the batch on the first failure. */
export async function loadImageFiles(
  paths: readonly string[],
  options: ReadImageFileOptions = {},
): Promise<LoadImageFilesResult> {
  const images: TurnImageAttachment[] = []
  for (const path of paths) {
    const result = await readImageFile(path, options)
    if (!result.ok) return { ok: false, message: result.message }
    images.push(result.image)
  }
  const validation = validateImageAttachments(images)
  if (!validation.ok) return { ok: false, message: validation.message }
  return { ok: true, images }
}

/**
 * Resolves pasted text that names one existing image file.
 *
 * Terminal drag & drop arrives as text, so the shape is normalized first
 * (quotes, `file://` URLs, `~`, backslash-escaped spaces) and only then checked
 * against the filesystem. Anything else stays ordinary text.
 */
export async function resolveImageFilePath(
  text: string,
  options: { readonly fileExists?: (path: string) => Promise<boolean> } = {},
): Promise<string | undefined> {
  const candidate = normalizePastedPath(text)
  if (candidate === undefined) return undefined
  if (!hasImageExtension(candidate)) return undefined
  const exists = options.fileExists ?? isFile
  try {
    return (await exists(candidate)) ? candidate : undefined
  } catch {
    return undefined
  }
}

export function normalizePastedPath(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.includes('\n')) return undefined
  if (Array.from(trimmed).length > MAX_PATH_CHARACTERS) return undefined
  let value = trimmed
  // Quoting is common when a path contains spaces; unwrap it before parsing
  // so a quoted `file://` URL is still recognized.
  for (const quote of ['"', "'"] as const) {
    if (value.length > 1 && value.startsWith(quote) && value.endsWith(quote)) {
      value = value.slice(1, -1)
      break
    }
  }
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(value.slice('file://'.length))
    } catch {
      return undefined
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    // Some other URL scheme: never a local path.
    return undefined
  }
  // Terminals escape spaces and parentheses when a file is dropped in.
  value = value.replace(/\\([ ()])/g, '$1')
  value = value.trim()
  if (value === '') return undefined
  return isAbsolute(value) ? value : resolve(expandHome(value))
}

export function hasImageExtension(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return path
}

async function defaultReadBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path))
}

async function isFile(path: string): Promise<boolean> {
  const info = await stat(path)
  return info.isFile()
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
