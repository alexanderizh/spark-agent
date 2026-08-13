import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('renderer style architecture', () => {
  it('keeps shared primitives in the component layer', () => {
    const base = readSource('./styles/styles.css')
    const components = readSource('./styles/components.css')
    const views = readSource('./styles/views.css')
    const interactions = readSource('./styles/interactions.css')

    expect(base).toContain("@import './components.css'")
    expect(components).toMatch(/\.btn\s*\{/)
    expect(components).toMatch(/\.form-grid\s*\{/)
    expect(components).toMatch(/\.settings-card\s*\{/)
    expect(components).toMatch(/\.provider-logo\s*\{/)
    expect(components).toMatch(/\.chip-list\s*\{/)

    expect(base).not.toMatch(/(^|\n)\.btn\s*\{/)
    expect(base).not.toMatch(/(^|\n)\.form-grid\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.empty-state(?:,|\s*\{)/)
    expect(views).not.toContain('PROVIDER LOGO')
    expect(interactions).not.toMatch(/(^|\n)\.form-grid\s*\{/)
  })

  it('keeps page-owned settings feedback and detail surfaces local', () => {
    const settings = readSource('./views/SettingsView.less')
    const views = readSource('./styles/views.css')
    const interactions = readSource('./styles/interactions.css')

    expect(settings).toMatch(/\.alert-banner\s*\{/)
    expect(settings).toMatch(/\.slide-panel\s*\{/)
    expect(settings).toMatch(/\.keymap\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.alert-banner\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.slide-panel\s*\{/)
    expect(interactions).not.toMatch(/(^|\n)\.slide-panel\s*\{/)
  })
})
