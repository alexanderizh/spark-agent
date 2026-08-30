import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Outcome Room inspector responsive layout', () => {
  it('shares the narrow viewport width budget between chat and inspector siblings', () => {
    const styles = readFileSync(
      fileURLToPath(new URL('../styles/views.css', import.meta.url)),
      'utf8',
    )
    const narrowViewport = styles.match(/@media \(max-width: 900px\)\s*\{[\s\S]*?\.chat-main-empty/)?.[0] ?? ''
    const inspector = styles.match(/\.inspector-frame\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(narrowViewport).toMatch(/\.chat-layout\s*\{[^}]*--chat-main-min-width:\s*0px;[^}]*overflow-x:\s*hidden;/s)
    expect(inspector).toContain('calc(100% - max(24px, var(--chat-main-min-width, 566px)))')
  })
})
