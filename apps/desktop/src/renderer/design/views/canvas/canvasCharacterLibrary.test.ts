import { afterEach, describe, expect, it, vi } from 'vitest'
import { cropCharacterSubviewToDataUrl } from './canvasCharacterLibrary'

describe('cropCharacterSubviewToDataUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads remote images anonymously before drawing so the canvas remains exportable', async () => {
    const createdImages: MockImage[] = []
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => 'data:image/png;base64,cropped'),
    }

    class MockImage {
      crossOrigin: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor() {
        createdImages.push(this)
      }

      set src(_value: string) {
        this.onload?.()
      }
    }

    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    await expect(
      cropCharacterSubviewToDataUrl('https://cdn.example.com/character.png', {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      }),
    ).resolves.toBe('data:image/png;base64,cropped')

    expect(createdImages).toHaveLength(1)
    expect(createdImages[0]?.crossOrigin).toBe('anonymous')
    expect(drawImage).toHaveBeenCalledOnce()
  })
})
