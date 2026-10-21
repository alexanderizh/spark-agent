import { describe, expect, it, vi } from 'vitest'

// The PIP service owns a BrowserWindow; only the pure command-URL lane is
// unit-tested here (window behaviour needs a live Electron session).
vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeImage: {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 0, height: 0 } }) },
}))

import {
  fingerprintPipFrame,
  parseComputerUsePipCommandUrl,
  PIP_HTML,
} from './ComputerUsePipService.js'

// Window behaviour itself needs a live Electron session, but the drag affordance
// is pure inline CSS: assert the drag region and its button opt-out stay in place.
describe('PIP panel drag support (inline CSS contract)', () => {
  it('marks the card as a drag region and keeps buttons clickable', () => {
    expect(PIP_HTML).toContain('-webkit-app-region: drag')
    expect(PIP_HTML).toMatch(/#card\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(PIP_HTML).toMatch(/\.btn\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
  })
})

// The preview must never crop the captured frame (user-reported bug): the
// container height tracks the frame aspect ratio via --preview-h and the
// image uses object-fit: contain as the never-crop backstop.
describe('PIP preview aspect contract (inline CSS contract)', () => {
  it('sizes the preview from the aspect variable and never crops frames', () => {
    expect(PIP_HTML).toMatch(/\.preview\s*\{[^}]*height:\s*var\(--preview-h/s)
    expect(PIP_HTML).toMatch(/\.preview img\s*\{[^}]*object-fit:\s*contain;/s)
    expect(PIP_HTML).not.toMatch(/\.preview img\s*\{[^}]*object-fit:\s*cover/)
  })
})

// Control buttons use inline stroke SVGs; emoji glyphs rendered inconsistently
// across systems and mixed styles inside one toolbar.
describe('PIP control icons (inline markup contract)', () => {
  it('renders control buttons with inline SVG icons instead of emoji', () => {
    expect(PIP_HTML).toMatch(/\.btn svg\s*\{[^}]*stroke:\s*currentColor/s)
    expect(PIP_HTML).toMatch(/id="btn-pause"[^>]*><svg/)
    expect(PIP_HTML).toMatch(/id="btn-approve"[^>]*><svg/)
    expect(PIP_HTML).not.toMatch(/⏸|✋|⏹|✕|✓/)
  })
})

// Film-strip slots stay rendered as dashed ghosts so the window height budget
// never jumps when the first frames arrive.
describe('PIP film strip placeholders (inline markup contract)', () => {
  it('keeps ghost slots for the thumb history', () => {
    expect(PIP_HTML).toMatch(/class="thumb ghost"/)
    expect(PIP_HTML).toMatch(/__sparkPipThumbs/)
  })
})

describe('PIP frame deduplication', () => {
  it('distinguishes changed image bytes even when the encoded lengths match', () => {
    const first = Buffer.from('frame-a')
    const second = Buffer.from('frame-b')

    expect(first).toHaveLength(second.length)
    expect(fingerprintPipFrame(first)).not.toBe(fingerprintPipFrame(second))
    expect(fingerprintPipFrame(first)).toBe(fingerprintPipFrame(Buffer.from(first)))
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
