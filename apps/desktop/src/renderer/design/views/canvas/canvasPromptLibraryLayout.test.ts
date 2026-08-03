import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  fileURLToPath(new URL('./canvas-prompt-library.less', import.meta.url)),
  'utf8',
)

describe('canvas prompt library layout', () => {
  it('keeps quick-use cards measurable before the modal settles its height', () => {
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-prompt-quick-use-panel \.canvas-prompt-library-entry\s*\{[\s\S]*?min-height:\s*(?:clamp\([^;]+\)|\d+px)\s*;/,
    )
  })
})
