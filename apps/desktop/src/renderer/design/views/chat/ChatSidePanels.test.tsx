import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { UnifiedSessionSidePanel, type UnifiedSidePanelKind } from './ChatSidePanels'

describe('UnifiedSessionSidePanel', () => {
  it('renders every opened panel as a distinct tab while keeping one active tab', () => {
    const tabs: UnifiedSidePanelKind[] = ['terminal', 'side-chat', 'review', 'plan', 'html']
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={tabs}
        activeTab="plan"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup.match(/class="unified-side-panel-tab(?: active)?"/g)).toHaveLength(5)
    expect(markup.match(/role="tab"/g)).toHaveLength(5)
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(markup).toContain('data-tab-kind="terminal"')
    expect(markup).toContain('data-tab-kind="side-chat"')
    expect(markup).toContain('data-tab-kind="review"')
    expect(markup).toContain('data-tab-kind="plan"')
    expect(markup).toContain('data-tab-kind="html"')
  })

  it('does not render duplicate tabs when an opened-tab list contains duplicates', () => {
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['terminal', 'terminal', 'review']}
        activeTab="review"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup.match(/class="unified-side-panel-tab(?: active)?"/g)).toHaveLength(2)
    expect(markup.match(/data-tab-kind="terminal"/g)).toHaveLength(1)
  })

  it('offers HTML as a flat panel choice without creating a second side panel', () => {
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['html']}
        activeTab="html"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>html panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup).toContain('HTML')
    expect(markup).toContain('html panel content')
    expect(markup).toContain('class="unified-side-panel"')
  })
})
