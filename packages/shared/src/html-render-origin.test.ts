import { describe, expect, it } from 'vitest'
import { buildHtmlRenderOriginHost } from './html-render-origin'

describe('buildHtmlRenderOriginHost', () => {
  it('creates stable distinct hosts for distinct case-sensitive document tokens', () => {
    expect(buildHtmlRenderOriginHost('doc-Token-01')).toBe(
      buildHtmlRenderOriginHost('doc-Token-01'),
    )
    expect(buildHtmlRenderOriginHost('doc-Token-01')).not.toBe(
      buildHtmlRenderOriginHost('doc-token-01'),
    )
  })

  it('keeps each DNS label within the 63-character limit for maximum-length tokens', () => {
    const host = buildHtmlRenderOriginHost(`hr-${'A'.repeat(77)}`)
    const labels = host.split('.')

    expect(host.length).toBeLessThanOrEqual(253)
    expect(labels.every((label) => label.length <= 63)).toBe(true)
  })

  it('rejects tokens outside the runtime registry format', () => {
    expect(() => buildHtmlRenderOriginHost('short')).toThrow('token')
    expect(() => buildHtmlRenderOriginHost('invalid/token-01')).toThrow('token')
  })
})
