import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('./ChatHeaderOverflowMenu.less', import.meta.url)),
  'utf8',
)

describe('chat header responsive layout', () => {
  it('keeps the title visible and anchors the action group to the right', () => {
    expect(styles).toMatch(
      /\.chat-tabbar \.tabbar-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin-left:\s*auto;/s,
    )
    expect(styles).toMatch(
      /@container chat-header \(max-width: 620px\)[\s\S]*?\.chat-tabbar \.chat-title-block\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/,
    )
    expect(styles).not.toMatch(/\.chat-tabbar \.chat-title-block\s*\{[^}]*display:\s*none;/)
  })
})
