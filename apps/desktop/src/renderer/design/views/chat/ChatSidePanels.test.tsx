import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SubAppSummary } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  UnifiedSessionSidePanel,
  subAppPanelKind,
  type UnifiedSidePanelKind,
} from './ChatSidePanels'

function makePanelApp(over: Partial<SubAppSummary>): SubAppSummary {
  return {
    id: 'p1',
    name: '待办清单',
    description: '',
    icon: 'list-todo',
    surface: 'panel',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...over,
  }
}

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

  it('panel 子应用以应用名渲染 tab，并出现在空状态快捷卡片中', () => {
    const app = makePanelApp({ id: 'p_todo', name: '待办清单' })
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['terminal', subAppPanelKind('p_todo')]}
        activeTab={subAppPanelKind('p_todo')}
        width={560}
        panelApps={[app]}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>app runner</div>
      </UnifiedSessionSidePanel>,
    )
    expect(markup).toContain('data-tab-kind="subapp:p_todo"')
    expect(markup).toContain('待办清单')

    // 空状态（无任何 tab）时快捷卡片也应列出 panel 应用
    const emptyMarkup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={[]}
        activeTab={null}
        width={560}
        panelApps={[app]}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>ignored</div>
      </UnifiedSessionSidePanel>,
    )
    expect(emptyMarkup).toContain('快捷打开')
    expect(emptyMarkup).toContain('待办清单')
  })
})
