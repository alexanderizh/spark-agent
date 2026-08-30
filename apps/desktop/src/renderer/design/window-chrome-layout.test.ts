import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('window chrome layout contract', () => {
  it('uses Window Controls Overlay geometry as the macOS source of truth', () => {
    const styles = readSource('./styles/styles.css')

    expect(styles).toContain('--window-titlebar-height: env(titlebar-area-height, 52px)')
    expect(styles).toContain('--window-titlebar-safe-left: env(titlebar-area-x, 90px)')
    expect(styles).toMatch(
      /\.platform-darwin \.floating-sidebar-header\s*\{[^}]*height:\s*var\(--window-titlebar-height\)[^}]*margin-top:\s*calc\(0px - var\(--sidebar-frame-inset\)\)/s,
    )
    expect(styles).toMatch(
      /\.sidebar-style-flat \.floating-sidebar\s*\{[^}]*--sidebar-frame-inset:\s*0px/s,
    )
  })

  it('keeps page-owned headers separate while sharing only safe-area geometry', () => {
    const app = readSource('../App.tsx')
    const workspaceStyles = readSource('./views/canvas/CanvasWorkspaceView.less')
    const cinematicStyles = readSource('./views/canvas/cinematic/shell.less')

    expect(app).toMatch(
      /t\.view === 'canvas'\s*\|\|\s*t\.view === 'canvas-workflows'\s*\|\|\s*t\.view === 'canvas-prompts'/,
    )
    expect(workspaceStyles).toContain('padding-left: var(--window-titlebar-safe-left)')
    expect(cinematicStyles).toContain('height: var(--window-titlebar-height)')
    expect(cinematicStyles).toContain('padding-left: var(--window-titlebar-safe-left)')
  })

  it('keeps the settings titlebar surface aligned with the settings navigation', () => {
    const styles = readSource('./styles/styles.css')
    const viewStyles = readSource('./styles/views.css')
    const settingsStyles = readSource('./views/SettingsView.less')

    expect(styles).toContain('--settings-nav-width: 240px')
    expect(styles).toMatch(
      /\.app\.titlebar-surface-settings \.shell-titlebar,[\s\S]*?var\(--settings-nav-width\)[\s\S]*?\}/,
    )
    expect(styles).toMatch(
      /\.app\.titlebar-surface-settings \.main-content-area\s*\{[^}]*transition:\s*none;/s,
    )
    expect(styles).toMatch(
      /@media \(max-width: 980px\)\s*\{[\s\S]*?\.app\.titlebar-surface-settings \.shell-titlebar,[\s\S]*?background:\s*var\(--bg-sunken\);/,
    )
    expect(settingsStyles).toMatch(/\.settings-nav\s*\{[^}]*width:\s*var\(--settings-nav-width\);/s)
    expect(viewStyles).not.toMatch(/(^|\n)\.settings-nav\s*\{/)
  })

  it('keeps every toast hit target outside the window drag region', () => {
    const styles = readSource('./styles/styles.css')

    expect(styles).toMatch(
      /\.spark-lobe-toast-host,\s*\.spark-lobe-toast-host \*\s*\{[^}]*-webkit-app-region:\s*no-drag;/s,
    )
  })
})
