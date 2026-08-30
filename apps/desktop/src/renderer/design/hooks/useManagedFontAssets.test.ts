// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FontAssetsStatusResponse } from '@spark/protocol'

describe('loadManagedFontFaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-managed-fonts')
  })

  it('preloads every verified local font before adding it to the document', async () => {
    const add = vi.fn()
    const remove = vi.fn()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add, delete: remove },
    })

    const load = vi.fn(async function (this: unknown) { return this })
    const constructor = vi.fn(function (
      this: { family: string; source: string; descriptors: FontFaceDescriptors; load: typeof load },
      family: string,
      source: string,
      descriptors: FontFaceDescriptors,
    ) {
      this.family = family
      this.source = source
      this.descriptors = descriptors
      this.load = load
    })
    vi.stubGlobal('FontFace', constructor)
    vi.resetModules()
    const { loadManagedFontFaces } = await import('./useManagedFontAssets')
    const status: FontAssetsStatusResponse = {
      state: 'ready',
      version: '1.0.0',
      percent: 100,
      message: 'ready',
      lastError: null,
      fonts: [
        { family: 'Geist', url: 'safe-file://geist', format: 'woff2', weight: '400', style: 'normal' },
        { family: 'Geist Mono', url: 'safe-file://mono', format: 'opentype', weight: '400', style: 'normal' },
      ],
    }

    await loadManagedFontFaces(status)

    expect(constructor).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenCalledTimes(2)
    expect(document.documentElement.dataset.managedFonts).toBe('ready')
  })
})
