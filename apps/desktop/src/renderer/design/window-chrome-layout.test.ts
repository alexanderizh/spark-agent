import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('window chrome layout contract', () => {
  it('uses Window Controls Overlay geometry as the macOS source of truth', () => {
    const styles = readSource('./styles/styles.css')

    expect(styles).toContain(
      '--window-titlebar-height: env(titlebar-area-height, 52px)',
    )
    expect(styles).toContain(
      '--window-titlebar-safe-left: env(titlebar-area-x, 90px)',
    )
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

    expect(app).toContain("const canvasOwnHeader = t.view === 'canvas' || t.view === 'canvas-workflows'")
    expect(workspaceStyles).toContain(
      'padding-left: var(--window-titlebar-safe-left)',
    )
    expect(cinematicStyles).toContain(
      'height: var(--window-titlebar-height)',
    )
    expect(cinematicStyles).toContain(
      'padding-left: var(--window-titlebar-safe-left)',
    )
  })
})
