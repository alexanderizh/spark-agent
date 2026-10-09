import { describe, expect, it, vi } from 'vitest'

// The PIP service owns a BrowserWindow; only the pure command-URL lane is
// unit-tested here (window behaviour needs a live Electron session).
vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeImage: {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 0, height: 0 } }) },
}))

import { parseComputerUsePipCommandUrl, PIP_HTML } from './ComputerUsePipService.js'

// Window behaviour itself needs a live Electron session, but the drag affordance
// is pure inline CSS: assert the drag region and its button opt-out stay in place.
describe('PIP panel drag support (inline CSS contract)', () => {
  it('marks the card as a drag region and keeps buttons clickable', () => {
    expect(PIP_HTML).toContain('-webkit-app-region: drag')
    expect(PIP_HTML).toMatch(/#card\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(PIP_HTML).toMatch(/\.btn\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
  })
})

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
