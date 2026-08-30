import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./HistoryImportModal.less', import.meta.url), 'utf8')

describe('HistoryImportModal theme contract', () => {
  it('inherits the app surface, text, border, and primary tokens', () => {
    expect(stylesheet).toContain('var(--panel')
    expect(stylesheet).toContain('var(--panel-elev')
    expect(stylesheet).toContain('var(--text')
    expect(stylesheet).toContain('var(--border')
    expect(stylesheet).toContain('var(--primary)')
    expect(stylesheet).toContain('var(--primary-soft)')
  })

  it('does not fork light and dark styles inside the feature stylesheet', () => {
    expect(stylesheet).not.toContain('.theme-light')
    expect(stylesheet).not.toContain('.theme-dark')
    expect(stylesheet).not.toContain('[data-theme=')
  })

  it('uses the content surface token for the modal header', () => {
    expect(stylesheet).toMatch(
      /\.ant-modal-header\s*\{[\s\S]*?background:\s*var\(--bg-soft,\s*#fff\);/,
    )
  })

  it('provides a reduced-motion mode for continuous scan animations', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesheet).toContain('animation: none !important')
  })
})
