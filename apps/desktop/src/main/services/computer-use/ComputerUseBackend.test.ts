import { describe, expect, it } from 'vitest'
import { UnavailableComputerUseBackend } from './ComputerUseBackend.js'

describe('UnavailableComputerUseBackend', () => {
  it('reports an honest unavailable capability instead of emulating a native host', async () => {
    const backend = new UnavailableComputerUseBackend()

    await expect(backend.getCapabilities()).resolves.toMatchObject({
      available: false,
      nativeHost: null,
      permissions: { screen: 'unsupported', accessibility: 'unsupported', input: 'unsupported' },
      unavailableReason: 'trusted_native_host_missing',
    })
    await expect(backend.listWindows()).rejects.toMatchObject({ code: 'native_host_missing' })
  })
})
