import { SparkDatabase } from '@spark/storage'
import { describe, expect, it, vi } from 'vitest'
import type { TrustedComputerUseBackend } from './ComputerUseServices.js'
import { createComputerUseServices } from './ComputerUseServices.js'

describe('ComputerUseServices', () => {
  it('disposes a connected Native Host backend after stopping active sessions', async () => {
    const database = {
      raw: {
        prepare: () => ({ all: () => [] }),
      },
    } as unknown as SparkDatabase
    const dispose = vi.fn(async () => undefined)
    const backend: TrustedComputerUseBackend & { dispose(): Promise<void> } = {
      getCapabilities: async () => ({
        available: false,
        platform: 'macos',
        nativeHost: null,
        permissions: { screen: 'unsupported', accessibility: 'unsupported', input: 'unsupported' },
      }),
      listWindows: async () => [],
      observe: async () => {
        throw new Error('not used')
      },
      execute: async () => {
        throw new Error('not used')
      },
      cancelSession: async () => undefined,
      dispose,
    }
    const services = createComputerUseServices(database, { backend })

    await services.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('passes the durable observation evidence sink into the default backend factory', async () => {
    const database = {
      raw: {
        prepare: () => ({ all: () => [] }),
      },
    } as unknown as SparkDatabase
    const backend: TrustedComputerUseBackend = {
      getCapabilities: async () => ({
        available: false,
        platform: 'windows',
        nativeHost: null,
        permissions: { screen: 'unsupported', accessibility: 'unsupported', input: 'unsupported' },
      }),
      listWindows: async () => [],
      observe: async () => {
        throw new Error('not used')
      },
      execute: async () => {
        throw new Error('not used')
      },
      cancelSession: async () => undefined,
    }
    const evidenceSink = { persist: vi.fn(async () => undefined) }
    const createBackend = vi.fn(() => backend)

    const services = createComputerUseServices(database, { evidenceSink, createBackend })

    expect(createBackend).toHaveBeenCalledWith(evidenceSink)
    await services.dispose()
  })
})
