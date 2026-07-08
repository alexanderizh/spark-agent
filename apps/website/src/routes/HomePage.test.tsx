import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../components/HeroAppMockup', () => ({
  HeroAppMockup: () => <div data-testid="hero-app-mockup" />,
}))

vi.mock('../components/ProviderMarquee', () => ({
  ProviderMarquee: () => <div data-testid="provider-marquee" />,
}))

import { HomePage } from './HomePage'

describe('HomePage', () => {
  it('renders screenshot feature cards without removing the execution flow section', () => {
    const html = renderToStaticMarkup(<HomePage />)

    expect(html).toContain('功能展示')
    expect(html).toContain('/showcase/workflow-orchestration.png')
    expect(html).toContain('/showcase/code-review.png')
    expect(html).toContain('/showcase/remote-connection.png')
    expect(html).toContain('从目标到交付的执行链路')
    expect(html).toContain('提出目标')
  })
})
