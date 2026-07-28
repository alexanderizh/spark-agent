import { describe, expect, it, vi } from 'vitest'
import { ElectronSnapshotImageProcessor } from './ElectronSnapshotImageProcessor.js'

describe('ElectronSnapshotImageProcessor', () => {
  it('validates the decoded dimensions and creates a bounded PNG preview', () => {
    const preview = {
      isEmpty: () => false,
      getSize: () => ({ width: 1_200, height: 600 }),
      resize: vi.fn(),
      toPNG: () => Buffer.from('preview-png'),
      toBitmap: () => Buffer.alloc(1_200 * 600 * 4),
    }
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 2_000, height: 1_000 }),
      resize: vi.fn(() => preview),
      toPNG: vi.fn(() => Buffer.from('full-png')),
      toBitmap: () => Buffer.alloc(2_000 * 1_000 * 4),
    }
    const processor = new ElectronSnapshotImageProcessor(() => image)

    expect(processor.inspectAndCreatePreview(Buffer.from('input-png'))).toEqual({
      width: 2_000,
      height: 1_000,
      preview: Buffer.from('preview-png'),
    })
    expect(image.resize).toHaveBeenCalledWith({ width: 1_200, quality: 'best' })
    expect(image.toPNG).not.toHaveBeenCalled()
  })

  it('rejects undecodable or invalidly sized images', () => {
    const processor = new ElectronSnapshotImageProcessor(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: vi.fn(),
      toPNG: () => Buffer.alloc(0),
      toBitmap: () => Buffer.alloc(0),
    }))

    expect(() => processor.inspectAndCreatePreview(Buffer.from('invalid'))).toThrowError(
      'Native Host returned an undecodable application image',
    )
  })

  it('redacts sensitive regions before producing a bounded perceptual preview', () => {
    const bitmap = Buffer.alloc(4 * 4 * 4, 255)
    const output = {
      isEmpty: () => false,
      getSize: () => ({ width: 4, height: 4 }),
      resize: vi.fn(),
      toPNG: () => Buffer.from('redacted-png'),
      toBitmap: () => bitmap,
    }
    const image = {
      ...output,
      toPNG: () => Buffer.from('input-png'),
    }
    const createFromBitmap = vi.fn(
      (_bitmap: Buffer, _size: { width: number; height: number }) => output,
    )
    const processor = new ElectronSnapshotImageProcessor(() => image, createFromBitmap)

    const result = processor.createRedactedEvidence(Buffer.from('input'), {
      screenshot: { width: 4, height: 4 },
      foreground: { window: { bounds: { x: 10, y: 20, width: 4, height: 4 } } },
      sensitiveRegions: [{ x: 11, y: 21, width: 2, height: 2 }],
    })

    expect(result.bytes).toEqual(Buffer.from('redacted-png'))
    expect(result.perceptualHash).toMatch(/^[a-f0-9]{16}$/u)
    const redactedBitmap = createFromBitmap.mock.calls[0]?.[0]
    expect(redactedBitmap).toBeDefined()
    if (redactedBitmap == null) throw new Error('redacted bitmap was not created')
    expect([...redactedBitmap.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)]).toEqual([
      128, 128, 128, 255,
    ])
  })
})
