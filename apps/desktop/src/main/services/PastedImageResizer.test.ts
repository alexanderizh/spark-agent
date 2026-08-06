import { randomFillSync } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  PASTED_IMAGE_MAX_EDGE,
  resizePastedImageBuffer,
} from './PastedImageResizer.js'

async function encodePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.allocUnsafe(width * height * 3)
  randomFillSync(pixels)
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toBuffer()
}

describe('resizePastedImageBuffer', () => {
  it('小于上限的图直接返回原 buffer，不重编码', async () => {
    const small = await encodePng(64, 48)

    const result = await resizePastedImageBuffer(small)

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(small) // 同一引用，未发生重编码
    expect(result.originalWidth).toBe(64)
    expect(result.originalHeight).toBe(48)
    expect(result.outputWidth).toBe(64)
    expect(result.outputHeight).toBe(48)
  })

  it('默认上限为 PASTED_IMAGE_MAX_EDGE (2000)', async () => {
    // 2001 > 2000，应触发 resize
    const oversized = await encodePng(2001, 1000)

    const result = await resizePastedImageBuffer(oversized)

    expect(result.resized).toBe(true)
    expect(result.outputWidth).toBeLessThanOrEqual(PASTED_IMAGE_MAX_EDGE)
    expect(result.outputHeight).toBeLessThanOrEqual(PASTED_IMAGE_MAX_EDGE)
    expect(result.originalWidth).toBe(2001)
    expect(result.originalHeight).toBe(1000)
  })

  it('超宽图等比缩小到最长边 <= maxEdge 且保持宽高比', async () => {
    // 3000x1500 -> 最长边收敛到 2000，等比得 2000x1000
    const oversized = await encodePng(3000, 1500)

    const result = await resizePastedImageBuffer(oversized, { maxEdge: 2000 })

    expect(result.resized).toBe(true)
    expect(result.buffer.length).toBeGreaterThan(0)
    expect(result.buffer).not.toBe(oversized)
    expect(result.outputWidth).toBeLessThanOrEqual(2000)
    expect(result.outputHeight).toBeLessThanOrEqual(2000)
    // 等比缩小：3000:1500 = 2:1，收敛后应为 2000:1000
    expect(result.outputWidth).toBe(2000)
    expect(result.outputHeight).toBe(1000)
  })

  it('正好等于上限的图不 resize（边界含等号）', async () => {
    const exact = await encodePng(2000, 2000)

    const result = await resizePastedImageBuffer(exact)

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(exact)
    expect(result.outputWidth).toBe(2000)
    expect(result.outputHeight).toBe(2000)
  })

  it('无法解码的坏 buffer 降级返回原 buffer，不抛错', async () => {
    const garbage = Buffer.alloc(256)
    randomFillSync(garbage)

    const result = await resizePastedImageBuffer(garbage)

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(garbage) // 降级：返回原 buffer
    expect(result.originalWidth).toBe(0)
    expect(result.originalHeight).toBe(0)
  })

  it('空 buffer 直接返回，不触发 sharp', async () => {
    const result = await resizePastedImageBuffer(Buffer.alloc(0))

    expect(result.resized).toBe(false)
    expect(result.buffer.length).toBe(0)
    expect(result.originalWidth).toBe(0)
    expect(result.originalHeight).toBe(0)
  })
})
