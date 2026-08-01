import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged,
  },
}))

import { registerPrivilegedProtocolSchemes } from '../PrivilegedProtocolSchemes.js'

describe('registerPrivilegedProtocolSchemes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers every application protocol in one Electron call with fetch support', () => {
    registerPrivilegedProtocolSchemes()

    expect(electronMocks.registerSchemesAsPrivileged).toHaveBeenCalledOnce()
    expect(electronMocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'safe-file',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
        },
      },
      {
        scheme: 'spark-snapshot',
        privileges: {
          standard: true,
          secure: true,
          corsEnabled: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
      {
        scheme: 'capability-asset',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
        },
      },
    ])
  })
})
