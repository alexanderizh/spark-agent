const FRAME_HEADER_BYTES = 5
const JSON_FRAME_KIND = 1
const BINARY_FRAME_KIND = 2
export const MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES = 67_108_864

export type NativeHostFrameKind = 'json' | 'binary'

export interface NativeHostFrame {
  kind: NativeHostFrameKind
  payload: Buffer
}

export class NativeHostFrameCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeHostFrameCodecError'
  }
}

export class NativeHostFrameDecoder {
  private readonly maxPayloadBytes: number
  private readonly buffered = new SegmentedByteQueue()

  constructor(options: { maxPayloadBytes?: number } = {}) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES
    if (!Number.isSafeInteger(this.maxPayloadBytes) || this.maxPayloadBytes < 1) {
      throw new NativeHostFrameCodecError('Native Host frame limit must be a positive integer')
    }
  }

  push(chunk: Uint8Array): NativeHostFrame[] {
    this.buffered.push(chunk)
    const frames: NativeHostFrame[] = []
    while (this.buffered.byteLength >= FRAME_HEADER_BYTES) {
      const payloadLength = this.buffered.peekUInt32BE()
      if (payloadLength < 1) {
        throw new NativeHostFrameCodecError('Native Host frames cannot be empty')
      }
      if (payloadLength > this.maxPayloadBytes) {
        throw new NativeHostFrameCodecError('Native Host frame exceeds the configured limit')
      }
      const kind = decodeFrameKind(this.buffered.peekByte(4))
      const frameLength = FRAME_HEADER_BYTES + payloadLength
      if (this.buffered.byteLength < frameLength) break
      this.buffered.discard(FRAME_HEADER_BYTES)
      frames.push({ kind, payload: this.buffered.read(payloadLength) })
    }
    return frames
  }

  end(): void {
    if (this.buffered.byteLength !== 0) {
      throw new NativeHostFrameCodecError('Native Host stream ended inside a frame')
    }
  }
}

const QUEUE_BLOCK_BYTES = 64 * 1_024

interface QueueBlock {
  bytes: Buffer
  start: number
  end: number
}

class SegmentedByteQueue {
  private blocks: QueueBlock[] = []
  private length = 0

  get byteLength(): number {
    return this.length
  }

  push(input: Uint8Array): void {
    let inputOffset = 0
    while (inputOffset < input.byteLength) {
      let tail = this.blocks[this.blocks.length - 1]
      if (tail == null || tail.end === tail.bytes.length) {
        tail = { bytes: Buffer.allocUnsafe(QUEUE_BLOCK_BYTES), start: 0, end: 0 }
        this.blocks.push(tail)
      }
      const copyLength = Math.min(tail.bytes.length - tail.end, input.byteLength - inputOffset)
      tail.bytes.set(input.subarray(inputOffset, inputOffset + copyLength), tail.end)
      tail.end += copyLength
      inputOffset += copyLength
      this.length += copyLength
    }
  }

  peekUInt32BE(): number {
    return (
      this.peekByte(0) * 0x1_00_00_00 +
      this.peekByte(1) * 0x1_00_00 +
      this.peekByte(2) * 0x1_00 +
      this.peekByte(3)
    )
  }

  peekByte(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      throw new NativeHostFrameCodecError('Native Host frame header is truncated')
    }
    let remaining = index
    for (const block of this.blocks) {
      const available = block.end - block.start
      if (remaining < available) return block.bytes[block.start + remaining] as number
      remaining -= available
    }
    throw new NativeHostFrameCodecError('Native Host frame header is truncated')
  }

  read(byteLength: number): Buffer {
    if (byteLength > this.length) {
      throw new NativeHostFrameCodecError('Native Host stream ended inside a frame')
    }
    const output = Buffer.allocUnsafe(byteLength)
    let outputOffset = 0
    while (outputOffset < byteLength) {
      const block = this.blocks[0]
      if (block == null) {
        throw new NativeHostFrameCodecError('Native Host stream ended inside a frame')
      }
      const copyLength = Math.min(block.end - block.start, byteLength - outputOffset)
      block.bytes.copy(output, outputOffset, block.start, block.start + copyLength)
      block.start += copyLength
      outputOffset += copyLength
      this.length -= copyLength
      if (block.start === block.end) this.blocks.shift()
    }
    return output
  }

  discard(byteLength: number): void {
    if (byteLength > this.length) {
      throw new NativeHostFrameCodecError('Native Host stream ended inside a frame')
    }
    let remaining = byteLength
    while (remaining > 0) {
      const block = this.blocks[0]
      if (block == null) {
        throw new NativeHostFrameCodecError('Native Host stream ended inside a frame')
      }
      const discarded = Math.min(block.end - block.start, remaining)
      block.start += discarded
      remaining -= discarded
      this.length -= discarded
      if (block.start === block.end) this.blocks.shift()
    }
  }
}

export function encodeNativeHostJsonFrame(
  value: unknown,
  maxPayloadBytes = MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES,
): Buffer {
  return encodeNativeHostFrame('json', Buffer.from(JSON.stringify(value), 'utf8'), maxPayloadBytes)
}

export function encodeNativeHostFrame(
  kind: NativeHostFrameKind,
  payloadInput: Uint8Array,
  maxPayloadBytes = MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES,
): Buffer {
  const payload = Buffer.from(payloadInput)
  if (payload.length < 1) {
    throw new NativeHostFrameCodecError('Native Host frames cannot be empty')
  }
  if (payload.length > maxPayloadBytes) {
    throw new NativeHostFrameCodecError('Native Host frame exceeds the configured limit')
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  frame[4] = kind === 'json' ? JSON_FRAME_KIND : BINARY_FRAME_KIND
  payload.copy(frame, FRAME_HEADER_BYTES)
  return frame
}

function decodeFrameKind(value: number | undefined): NativeHostFrameKind {
  if (value === JSON_FRAME_KIND) return 'json'
  if (value === BINARY_FRAME_KIND) return 'binary'
  throw new NativeHostFrameCodecError('Native Host frame has an unknown kind')
}
