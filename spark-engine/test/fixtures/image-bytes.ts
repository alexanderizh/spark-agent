/**
 * Header-only image payloads.
 *
 * The engine never decodes pixels: it sniffs the container and reads the
 * header dimensions, so these fixtures only need a valid magic number plus the
 * size fields each format exposes.
 */

export function pngBytes(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'latin1')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return new Uint8Array(header)
}

export function jpegBytes(width = 800, height = 600): Uint8Array {
  const bytes = Buffer.alloc(21)
  bytes.writeUInt16BE(0xffd8, 0)
  bytes.writeUInt16BE(0xffe0, 2)
  bytes.writeUInt16BE(4, 4)
  bytes.writeUInt16BE(0xffc0, 8)
  bytes.writeUInt16BE(11, 10)
  bytes.writeUInt8(8, 12)
  bytes.writeUInt16BE(height, 13)
  bytes.writeUInt16BE(width, 15)
  return new Uint8Array(bytes)
}

export function gifBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(13)
  bytes.write('GIF89a', 0, 'latin1')
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return new Uint8Array(bytes)
}

/** VP8X (extended) container: canvas size is stored as a 24-bit value minus one. */
export function webpBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'latin1')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'latin1')
  bytes.write('VP8X', 12, 'latin1')
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return new Uint8Array(bytes)
}
