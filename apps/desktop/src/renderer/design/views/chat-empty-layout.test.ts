import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readViewSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('empty chat layout', () => {
  it('keeps the hero in a flexible content region and places tips above the bottom composer', () => {
    const source = readViewSource('./ChatView.tsx')
    const emptyContentIndex = source.indexOf('className="chat-empty-content"')
    const dockIndex = source.indexOf('className="chat-empty-composer-dock"')
    const tipsIndex = source.indexOf('<HeroTipsTicker />', dockIndex)
    const composerIndex = source.indexOf('{composerNode}', dockIndex)

    expect(emptyContentIndex).toBeGreaterThan(-1)
    expect(dockIndex).toBeGreaterThan(emptyContentIndex)
    expect(tipsIndex).toBeGreaterThan(dockIndex)
    expect(composerIndex).toBeGreaterThan(tipsIndex)
  })

  it('allocates remaining height to the empty content instead of the composer dock', () => {
    const styles = readViewSource('../styles/views.css')

    expect(styles).toMatch(
      /\.chat-empty-content\s*\{[^}]*flex:\s*1 1 auto;[^}]*align-items:\s*center;/s,
    )
    expect(styles).toMatch(
      /\.chat-empty-composer-dock\s*\{[^}]*flex:\s*0 0 auto;[^}]*flex-direction:\s*column;/s,
    )
  })
})
