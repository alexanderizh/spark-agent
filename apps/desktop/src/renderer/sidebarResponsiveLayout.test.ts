import { describe, expect, it } from 'vitest'
import { shouldOverlaySidebar } from './sidebarResponsiveLayout'

describe('responsive sidebar layout', () => {
  it('uses an overlay when the inline sidebar would leave too little chat space', () => {
    expect(shouldOverlaySidebar({ viewportWidth: 760, sidebarWidth: 288, sidebarGutter: 16 })).toBe(
      true,
    )
  })

  it('keeps the existing inline layout when enough chat space remains', () => {
    expect(
      shouldOverlaySidebar({ viewportWidth: 1000, sidebarWidth: 288, sidebarGutter: 16 }),
    ).toBe(false)
  })

  it('accounts for a user-resized sidebar', () => {
    expect(shouldOverlaySidebar({ viewportWidth: 900, sidebarWidth: 420, sidebarGutter: 16 })).toBe(
      true,
    )
  })
})
