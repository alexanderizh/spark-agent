import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('./videoWorkbench.less', import.meta.url)),
  'utf8',
)
const timelineStyles = readFileSync(
  fileURLToPath(new URL('./timeline/videoWorkbench.timeline-v2.less', import.meta.url)),
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

  it('keeps the inspector proportional at supported desktop window widths', () => {
    expect(styles).toMatch(/\.vwb-side-pane\s*{[^}]*width:\s*clamp\(300px,\s*30vw,\s*360px\);/s)
  })

  it('compacts labeled clip actions without wrapping them in a narrow preview pane', () => {
    expect(styles).toMatch(
      /\.vwb-preview-pane\s*{[^}]*container-name:\s*video-workbench-preview;[^}]*container-type:\s*inline-size;/s,
    )
    expect(styles).toMatch(
      /@container video-workbench-preview \(max-width:\s*560px\)\s*{[\s\S]*?\.vwb-player-clip-actions\s*{[\s\S]*?\.vwb-player-btn\s*{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*padding:\s*0;/s,
    )
  })

  it('wraps multitrack controls by container width instead of overlapping them', () => {
    expect(timelineStyles).toMatch(
      /\.vwb-mt\s*{[^}]*container-name:\s*video-workbench-timeline;[^}]*container-type:\s*inline-size;/s,
    )
    expect(timelineStyles).toMatch(
      /@container video-workbench-timeline \(max-width:\s*760px\)\s*{[\s\S]*?\.vwb-mt-toolbar\s*{[^}]*flex-wrap:\s*wrap;/s,
    )
    expect(timelineStyles).toMatch(
      /@container video-workbench-timeline \(max-width:\s*760px\)\s*{[\s\S]*?\.vwb-mt-toolbar-group\s*{[^}]*width:\s*100%;[^}]*overflow-x:\s*auto;/s,
    )
    expect(timelineStyles).toMatch(
      /@container video-workbench-timeline \(min-width:\s*761px\) and \(max-width:\s*1040px\)\s*{[\s\S]*?\.vwb-mt-toolbar-group:not\(\.is-secondary\)\s*{[\s\S]*?\.ant-btn\s*{[^}]*width:\s*30px;[^}]*min-width:\s*30px;/s,
    )
    expect(timelineStyles).toMatch(
      /@container video-workbench-timeline \(max-width:\s*520px\)\s*{[\s\S]*?\.vwb-mt-toolbar-group\.is-secondary \.ant-btn\s*{[^}]*padding-inline:\s*6px;[^}]*font-size:\s*11px;/s,
    )
    expect(timelineStyles).not.toMatch(
      /\.vwb-mt-toolbar-group\.is-secondary \.ant-btn span:not\(\.ant-btn-icon\)\s*{[^}]*display:\s*none;/s,
    )
    expect(timelineStyles).toMatch(
      /@container video-workbench-timeline \(max-width:\s*520px\)\s*{[\s\S]*?\.vwb-mt-switch-label\s*{[^}]*display:\s*none;/s,
    )
  })

  it('preserves visible keyboard focus and reduced-motion behavior', () => {
    expect(timelineStyles).toMatch(/\.vwb-mt\s*{[\s\S]*?&:focus-visible\s*{/s)
    expect(timelineStyles).toMatch(/\.vwb-mt-clip\s*{[\s\S]*?&:focus-visible\s*{/s)
    expect(styles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/s)
    expect(timelineStyles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/s)
  })
})
