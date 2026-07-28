import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { SnapshotImageProcessor } from './NativeApplicationSnapshotCaptureService.js'

const MAX_IMAGE_DIMENSION = 16_384
const MAX_PREVIEW_WIDTH = 1_200

export interface ElectronNativeImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; quality: 'best' }): ElectronNativeImageLike
  toPNG(): Buffer
  toBitmap(): Buffer
}

export class ElectronSnapshotImageProcessor implements SnapshotImageProcessor {
  private readonly createImage: (bytes: Buffer) => ElectronNativeImageLike
  private readonly createFromBitmap:
    | ((bitmap: Buffer, size: { width: number; height: number }) => ElectronNativeImageLike)
    | undefined

  constructor(
    createImage: (bytes: Buffer) => ElectronNativeImageLike,
    createFromBitmap?: (
      bitmap: Buffer,
      size: { width: number; height: number },
    ) => ElectronNativeImageLike,
  ) {
    this.createImage = createImage
    this.createFromBitmap = createFromBitmap
  }

  inspectAndCreatePreview(imageBytes: Buffer): {
    width: number
    height: number
    preview: Buffer
  } {
    const image = this.createImage(imageBytes)
    const size = image.getSize()
    if (
      image.isEmpty() ||
      !Number.isSafeInteger(size.width) ||
      !Number.isSafeInteger(size.height) ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > MAX_IMAGE_DIMENSION ||
      size.height > MAX_IMAGE_DIMENSION
    ) {
      throw invalidImage()
    }
    const previewImage =
      size.width > MAX_PREVIEW_WIDTH
        ? image.resize({ width: MAX_PREVIEW_WIDTH, quality: 'best' })
        : image
    if (previewImage.isEmpty()) throw invalidImage()
    const preview = previewImage.toPNG()
    if (preview.length < 1) throw invalidImage()
    return { width: size.width, height: size.height, preview }
  }

  createRedactedEvidence(
    imageBytes: Buffer,
    observation: {
      screenshot: { width: number; height: number }
      foreground: { window: { bounds: { x: number; y: number; width: number; height: number } } }
      sensitiveRegions: Array<{ x: number; y: number; width: number; height: number }>
    },
  ): { bytes: Buffer; perceptualHash: string } {
    if (this.createFromBitmap == null) throw invalidImage()
    const image = this.createImage(imageBytes)
    const originalSize = image.getSize()
    if (
      image.isEmpty() ||
      originalSize.width !== observation.screenshot.width ||
      originalSize.height !== observation.screenshot.height
    ) {
      throw invalidImage()
    }
    const preview =
      originalSize.width > MAX_PREVIEW_WIDTH
        ? image.resize({ width: MAX_PREVIEW_WIDTH, quality: 'best' })
        : image
    const size = preview.getSize()
    const bitmap = Buffer.from(preview.toBitmap())
    if (bitmap.length !== size.width * size.height * 4) throw invalidImage()
    const windowBounds = observation.foreground.window.bounds
    const scaleX = size.width / windowBounds.width
    const scaleY = size.height / windowBounds.height
    redactBitmapRegions(
      bitmap,
      size,
      observation.sensitiveRegions.map((region) => ({
        x: Math.floor((region.x - windowBounds.x) * scaleX),
        y: Math.floor((region.y - windowBounds.y) * scaleY),
        width: Math.ceil(region.width * scaleX),
        height: Math.ceil(region.height * scaleY),
      })),
    )
    const redacted = this.createFromBitmap(bitmap, size)
    if (redacted.isEmpty()) throw invalidImage()
    const bytes = redacted.toPNG()
    if (bytes.length < 1) throw invalidImage()
    return { bytes, perceptualHash: averageHash(bitmap, size) }
  }
}

function redactBitmapRegions(
  bitmap: Buffer,
  size: { width: number; height: number },
  regions: Array<{ x: number; y: number; width: number; height: number }>,
): void {
  const rowEvents = new Map<number, Array<{ x: number; delta: number }>>()
  const addEvent = (y: number, x: number, delta: number): void => {
    const events = rowEvents.get(y)
    if (events == null) rowEvents.set(y, [{ x, delta }])
    else events.push({ x, delta })
  }
  for (const region of regions) {
    const minX = Math.max(0, region.x)
    const minY = Math.max(0, region.y)
    const maxX = Math.min(size.width, region.x + region.width)
    const maxY = Math.min(size.height, region.y + region.height)
    if (minX >= maxX || minY >= maxY) continue
    addEvent(minY, minX, 1)
    addEvent(minY, maxX, -1)
    addEvent(maxY, minX, -1)
    addEvent(maxY, maxX, 1)
  }

  const coverageDelta = new Int32Array(size.width + 1)
  for (let y = 0; y < size.height; y += 1) {
    for (const event of rowEvents.get(y) ?? []) {
      coverageDelta[event.x] = (coverageDelta[event.x] ?? 0) + event.delta
    }
    let coverage = 0
    for (let x = 0; x < size.width; x += 1) {
      coverage += coverageDelta[x] ?? 0
      if (coverage <= 0) continue
      const offset = (y * size.width + x) * 4
      bitmap[offset] = 128
      bitmap[offset + 1] = 128
      bitmap[offset + 2] = 128
      bitmap[offset + 3] = 255
    }
  }
}

function averageHash(bitmap: Buffer, size: { width: number; height: number }): string {
  const values: number[] = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const sourceX = Math.min(size.width - 1, Math.floor(((x + 0.5) * size.width) / 8))
      const sourceY = Math.min(size.height - 1, Math.floor(((y + 0.5) * size.height) / 8))
      const offset = (sourceY * size.width + sourceX) * 4
      values.push(
        ((bitmap[offset] ?? 0) + (bitmap[offset + 1] ?? 0) + (bitmap[offset + 2] ?? 0)) / 3,
      )
    }
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  let hash = 0n
  values.forEach((value, index) => {
    if (value >= average) hash |= 1n << BigInt(63 - index)
  })
  return hash.toString(16).padStart(16, '0')
}

function invalidImage(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Native Host returned an undecodable application image',
  )
}
