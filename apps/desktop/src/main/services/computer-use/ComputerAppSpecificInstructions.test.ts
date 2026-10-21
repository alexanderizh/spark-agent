import { describe, expect, it } from 'vitest'

import { matchAppSpecificInstructions } from './ComputerAppSpecificInstructions.js'

describe('matchAppSpecificInstructions', () => {
  it('matches a registered app by exact bundle id', () => {
    expect(matchAppSpecificInstructions({ name: 'Finder', bundleId: 'com.apple.finder' })).toContain(
      'Cmd+Shift+G',
    )
    expect(
      matchAppSpecificInstructions({ name: 'Google Chrome', bundleId: 'com.google.chrome' }),
    ).toContain('Cmd+L')
  })

  it('matches bundle ids case-insensitively', () => {
    expect(
      matchAppSpecificInstructions({ name: 'Calculator', bundleId: 'COM.APPLE.CALCULATOR' }),
    ).toContain('invoke_element')
  })

  it('falls back to case-insensitive name matching when no bundle id is present', () => {
    expect(matchAppSpecificInstructions({ name: '微信', bundleId: 'unknown.bundle.id' })).toContain(
      'search field',
    )
    expect(matchAppSpecificInstructions({ name: 'safari 浏览器' })).toContain('Cmd+L')
    expect(matchAppSpecificInstructions({ name: 'My Terminal.app' })).toContain('type_text')
  })

  it('returns null for unregistered apps, empty names, and missing input fields', () => {
    expect(matchAppSpecificInstructions({ name: 'Random App', bundleId: 'com.random.app' })).toBeNull()
    expect(matchAppSpecificInstructions({ name: '' })).toBeNull()
    expect(matchAppSpecificInstructions({ name: '   ' })).toBeNull()
  })
})
