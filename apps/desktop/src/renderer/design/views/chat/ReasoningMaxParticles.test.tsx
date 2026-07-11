import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasoningMaxParticles } from './ReasoningMaxParticles'

describe('ReasoningMaxParticles', () => {
  it('renders short comet particles with more activity on the stronger side', () => {
    const html = renderToStaticMarkup(<ReasoningMaxParticles />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('composer-reasoning-comet')
    expect(html.match(/data-reasoning-particle=/g)).toHaveLength(8)
    expect(html.match(/data-particle-zone="left"/g)).toHaveLength(3)
    expect(html.match(/data-particle-zone="right"/g)).toHaveLength(5)
  })
})
