import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasoningMaxParticles } from './ReasoningMaxParticles'

describe('ReasoningMaxParticles', () => {
  it('renders a denser particle field on the stronger side', () => {
    const html = renderToStaticMarkup(<ReasoningMaxParticles />)

    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/data-reasoning-particle=/g)).toHaveLength(20)
    expect(html.match(/data-particle-zone="left"/g)).toHaveLength(5)
    expect(html.match(/data-particle-zone="right"/g)).toHaveLength(15)
  })
})
