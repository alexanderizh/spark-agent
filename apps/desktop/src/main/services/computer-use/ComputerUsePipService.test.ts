import { describe, expect, it, vi } from 'vitest'

// The PIP service owns a BrowserWindow; only the pure command-URL lane is
// unit-tested here (window behaviour needs a live Electron session).
vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeImage: {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 0, height: 0 } }) },
}))

import { parseComputerUsePipCommandUrl } from './ComputerUsePipService.js'

describe('parseComputerUsePipCommandUrl', () => {
  it('parses a well-formed control command', () => {
    expect(parseComputerUsePipCommandUrl('spark-pip://control/pause?sid=cs-1')).toEqual({
      verb: 'pause',
      computerSessionId: 'cs-1',
    })
    expect(parseComputerUsePipCommandUrl('spark-pip://control/approve?sid=wp_%20id')).toEqual({
      verb: 'approve',
      computerSessionId: 'wp_ id',
    })
  })

  it('accepts every whitelisted verb and rejects unknown ones', () => {
    for (const verb of ['pause', 'takeover', 'stop', 'approve', 'deny'] as const) {
      expect(parseComputerUsePipCommandUrl(`spark-pip://control/${verb}?sid=cs-1`)).toMatchObject({
        verb,
      })
    }
    expect(parseComputerUsePipCommandUrl('spark-pip://control/reboot?sid=cs-1')).toBeNull()
  })

  it('rejects other schemes, hosts and malformed URLs', () => {
    expect(parseComputerUsePipCommandUrl('https://control/pause?sid=cs-1')).toBeNull()
    expect(parseComputerUsePipCommandUrl('spark-pip://settings/pause?sid=cs-1')).toBeNull()
    expect(parseComputerUsePipCommandUrl('spark-pip://control/pause')).toBeNull()
    expect(parseComputerUsePipCommandUrl('spark-pip://control/pause?sid=')).toBeNull()
    expect(parseComputerUsePipCommandUrl('not a url')).toBeNull()
  })
})
