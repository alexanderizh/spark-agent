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
    expect(settings).toMatch(/\.settings-layout\s*\{/)
    expect(settings).toMatch(/\.remote-settings\s*\{/)
    expect(settings).toMatch(/\.mcp-server-list\s*\{/)
    expect(settings).toMatch(/\.usage-heatmap-card\s*\{/)
    expect(settings).toMatch(/\.about-header\s*\{/)
    expect(settings).toMatch(/\.update-card\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.alert-banner\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.slide-panel\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.settings-layout\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.remote-settings\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.mcp-server-list\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.usage-heatmap-card\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.about-header\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.update-card\s*\{/)
    expect(interactions).not.toMatch(/(^|\n)\.slide-panel\s*\{/)
  })

  it('keeps workflow, skill store, and avatar picker styles page-owned', () => {
    const components = readSource('./styles/components.css')
    const views = readSource('./styles/views.css')
    const workflow = readSource('./views/WorkflowView.less')
    const skillStore = readSource('./views/SkillStoreView.less')
    const agents = readSource('./views/AgentsView.less')
    const avatarPicker = readSource('./components/AvatarPicker.less')
    const board = readSource('./views/BoardView.less')
    const project = readSource('./views/ProjectView.less')
    const overlays = readSource('./views/Overlays.less')
    const inspector = readSource('./views/chat/ChatInspectorPanel.less')

    expect(components).toMatch(/\.spark-avatar-fallback\s*\{/)
    expect(components).toMatch(/\.composer-model-menu \.composer-model-item\s*,/)
    expect(avatarPicker).toMatch(/\.avatar-picker\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.avatar-picker\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.composer-model-menu \.composer-model-item\s*,/)

    expect(workflow).toMatch(/\.workflow-layout\s*\{/)
    expect(workflow).toMatch(/\.workflow-builder-v2\s*\.wf-palette\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.workflow-layout\s*\{/)

    expect(skillStore).toMatch(/\.create-skill-layout\s*\{/)
    expect(skillStore).toMatch(/\.local-skill-panel\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.store-tabbar\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.create-skill-layout\s*\{/)

    expect(agents).toMatch(/\.agents-detail\s*\{/)
    expect(agents).toMatch(/\.agent-prompt-editor\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.agents-detail\s*\{/)

    expect(board).toMatch(/\.board-view\s*\{/)
    expect(project).toMatch(/\.project-split\s*\{/)
    expect(overlays).toMatch(/\.palette-backdrop\s*\{/)
    expect(inspector).toMatch(/\.runtime-skill-list\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.board-view\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.palette-backdrop\s*\{/)
    expect(views).not.toMatch(/(^|\n)\.runtime-skill-list\s*\{/)
  })
})
