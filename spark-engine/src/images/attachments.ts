/**
 * Shared image-attachment vocabulary for the engine, the CLI, and the TUI.
 *
 * The same media types, size limits, and display helpers must hold on every
 * entry path (clipboard paste, `-i/--image`, a pasted file path, or the SDK),
 * so they live in one dependency-free module instead of being re-derived at
 * each call site.
 */

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/**
 * One image handed to a turn. Bytes are the source of truth; the artifact
 * store — not the caller — decides the durable identity.
 */
export interface TurnImageAttachment {
  readonly bytes: Uint8Array
  readonly mediaType: ImageMediaType
  /** Display/source hint (clipboard, a file basename); never used for identity. */
  readonly name?: string
  readonly width?: number
  readonly height?: number
}

/**
 * Hard limits protecting the request body, the context window, and the TUI's
 * in-memory draft from a runaway paste.
 */
export const IMAGE_LIMITS = {
  maxImagesPerTurn: 20,
  maxBytesPerImage: 20 * 1024 * 1024,
  maxTotalBytesPerTurn: 50 * 1024 * 1024,
} as const

/**
 * Uniform result for every way an image can enter a turn (clipboard, file, or
 * a pasted path). Callers render the message instead of mapping error codes.
 */
export type ImageReadFailureCode =
  | 'unsupported-platform'
  | 'clipboard-unavailable'
  | 'no-image'
  | 'decode-failed'
  | 'too-large'
  | 'not-found'
  | 'unreadable'

export type ImageReadResult =
  | { readonly ok: true; readonly image: TurnImageAttachment }
  | { readonly ok: false; readonly code: ImageReadFailureCode; readonly message: string }

export interface ImageDimensions {
  readonly width: number
  readonly height: number
}

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/** Sniffs the container format from magic bytes; extensions are never trusted. */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8 && matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (bytes.length >= 3 && matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6)
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return undefined
}

/**
 * Best-effort pixel dimensions used for display and token estimation. A
 * missing result is not an error: the request only carries bytes.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mediaType: ImageMediaType,
): ImageDimensions | undefined {
  switch (mediaType) {
    case 'image/png':
      return pngDimensions(bytes)
    case 'image/jpeg':
      return jpegDimensions(bytes)
    case 'image/gif':
      return gifDimensions(bytes)
    case 'image/webp':
      return webpDimensions(bytes)
  }
}

export type ImageValidationResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Validates one submitted batch in the same order for every entry point. */
export function validateImageAttachments(
  attachments: readonly TurnImageAttachment[],
): ImageValidationResult {
  if (attachments.length === 0) return { ok: true }
  if (attachments.length > IMAGE_LIMITS.maxImagesPerTurn) {
    return {
      ok: false,
      message: `单次任务最多附加 ${IMAGE_LIMITS.maxImagesPerTurn} 张图片，当前为 ${attachments.length} 张。`,
    }
  }
  let total = 0
  for (const attachment of attachments) {
    if (attachment.bytes.byteLength === 0) {
      return { ok: false, message: '图片内容为空，无法附加。' }
    }
    if (attachment.bytes.byteLength > IMAGE_LIMITS.maxBytesPerImage) {
      return {
        ok: false,
        message: `单张图片不得超过 ${formatImageBytes(IMAGE_LIMITS.maxBytesPerImage)}，当前为 ${formatImageBytes(attachment.bytes.byteLength)}。`,
      }
    }
    total += attachment.bytes.byteLength
  }
  if (total > IMAGE_LIMITS.maxTotalBytesPerTurn) {
    return {
      ok: false,
      message: `单次任务图片合计不得超过 ${formatImageBytes(IMAGE_LIMITS.maxTotalBytesPerTurn)}，当前为 ${formatImageBytes(total)}。`,
    }
  }
  return { ok: true }
}

/** The literal token kept in the draft text so the model can reference a picture. */
export function imagePlaceholderText(index: number): string {
  return `[Image #${index}]`
}

export function formatImageBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes}B`
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)}KB`
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

/** Collapsed-block label, e.g. `[Image #2 · 1920×1080 · 240KB]`. */
export function formatImageLabel(attachment: TurnImageAttachment, index: number): string {
  const dimensions =
    attachment.width !== undefined && attachment.height !== undefined
      ? ` · ${attachment.width}×${attachment.height}`
      : ''
  return `[Image #${index}${dimensions} · ${formatImageBytes(attachment.bytes.byteLength)}]`
}

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return Buffer.from(bytes.subarray(start, end)).toString('latin1')
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return undefined
  return positiveDimensions(readUint32(bytes, 16), readUint32(bytes, 20))
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10) return undefined
  return positiveDimensions(readUint16(bytes, 6, 'le'), readUint16(bytes, 8, 'le'))
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1] ?? 0
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = readUint16(bytes, offset + 2, 'be')
    if (length < 2) return undefined
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return positiveDimensions(
        readUint16(bytes, offset + 7, 'be'),
        readUint16(bytes, offset + 5, 'be'),
      )
    }
    offset += 2 + length
  }
  return undefined
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined
  const chunk = ascii(bytes, 12, 16)
  if (chunk === 'VP8X') {
    return positiveDimensions(readUint24(bytes, 24) + 1, readUint24(bytes, 27) + 1)
  }
  if (chunk === 'VP8 ') {
    return positiveDimensions(
      readUint16(bytes, 26, 'le') & 0x3fff,
      readUint16(bytes, 28, 'le') & 0x3fff,
    )
  }
  if (chunk === 'VP8L') {
    const first = bytes[21] ?? 0
    const second = bytes[22] ?? 0
    const third = bytes[23] ?? 0
    const fourth = bytes[24] ?? 0
    return positiveDimensions(
      1 + (((second & 0x3f) << 8) | first),
      1 + (((fourth & 0x0f) << 10) | (third << 2) | ((second & 0xc0) >> 6)),
    )
  }
  return undefined
}

function positiveDimensions(width: number, height: number): ImageDimensions | undefined {
  if (width <= 0 || height <= 0) return undefined
  return { width, height }
}

function readUint16(bytes: Uint8Array, offset: number, endianness: 'le' | 'be'): number {
  const first = bytes[offset] ?? 0
  const second = bytes[offset + 1] ?? 0
  return endianness === 'le' ? first | (second << 8) : (first << 8) | second
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)) >>> 0
}
