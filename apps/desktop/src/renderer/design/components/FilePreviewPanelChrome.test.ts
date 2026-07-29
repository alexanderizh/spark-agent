import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./FilePreviewPanel.less', import.meta.url), 'utf8')
const component = readFileSync(new URL('./FilePreviewPanel.tsx', import.meta.url), 'utf8')

describe('FilePreviewPanel window chrome', () => {
  it('uses the header as a native drag region while keeping actions interactive', () => {
    expect(styles).toMatch(/\.file-preview-header\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(styles).toMatch(/\.file-preview-title\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(styles).toMatch(/\.file-preview-title \*\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(styles).toMatch(/\.file-preview-actions\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.file-preview-resize-handle\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(component).toMatch(
      /className="file-preview-header"[\s\S]*?onDoubleClick=\{\(event\) => \{[\s\S]*?closest\('\.file-preview-actions'\)[\s\S]*?window\.spark\?\.invoke\('window:maximize', \{\}\)/,
    )
  })

  it('constrains the viewer host to the preview viewport', () => {
    expect(styles).toContain('calc(100% - max(24px, var(--chat-main-min-width, 566px)))')
    expect(styles).toMatch(
      /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.file-preview-panel\s*\{[^}]*calc\(100% - 24px\)/s,
    )
    expect(styles).toMatch(
      /\.file-preview-flyfish\s*\{[\s\S]*?> \*\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    )
    expect(styles).toMatch(
      /\.file-preview-flyfish\s*\{[^}]*container-name:\s*file-preview-viewer;[^}]*container-type:\s*inline-size;/s,
    )
    expect(styles).toMatch(
      /> \*::part\(toolbar\)\s*\{[^}]*max-width:\s*calc\(100% - 20px\);[^}]*flex-wrap:\s*nowrap;/s,
    )
    expect(styles).toMatch(
      /@container file-preview-viewer \(max-width:\s*680px\)\s*\{[\s\S]*?\.file-preview-flyfish > \*::part\(toolbar\)\s*\{[^}]*display:\s*none;/s,
    )
  })
})
