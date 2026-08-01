import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('./videoWorkbench.less', import.meta.url)),
  'utf8',
)

describe('video workbench layout', () => {
  it('fills the application viewport without modal margins', () => {
    expect(styles).toMatch(/\.vwb-shell\s*{[^}]*width:\s*100%;/s)
    expect(styles).toMatch(/\.vwb-shell\s*{[^}]*height:\s*100%;/s)
    expect(styles).toMatch(/\.vwb-shell\s*{[^}]*margin:\s*0;/s)
    expect(styles).toMatch(/\.vwb-shell\s*{[^}]*border-radius:\s*0;/s)
  })

  it('keeps timeline chrome height fixed while zoom changes content width', () => {
    expect(styles).toMatch(/\.vwb-timeline-viewport\s*{[^}]*height:\s*164px;/s)
    expect(styles).toMatch(/\.vwb-timeline-content\s*{[^}]*height:\s*100%;/s)
    expect(styles).toMatch(/\.vwb-track-strip\s*{[^}]*height:\s*calc\(100% - 28px\);/s)
    expect(styles).toMatch(/\.vwb-track-clip\s*{[^}]*height:\s*100%;/s)
  })
})
