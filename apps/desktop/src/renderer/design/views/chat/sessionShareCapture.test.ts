import { describe, expect, it } from 'vitest'
import { neutralizeExternalUrls, rewriteCssUrls } from './sessionShareCapture'

describe('session share capture css', () => {
  it('turns relative stylesheet urls into absolute urls', () => {
    expect(rewriteCssUrls('background: url(./a.png)', 'https://app.local/assets/main.css')).toBe(
      'background: url(https://app.local/assets/a.png)',
    )
  })

  it('keeps embedded data urls', () => {
    const source = 'background: url("data:image/png;base64,aaaa")'
    expect(rewriteCssUrls(source, 'https://app.local/')).toBe(source)
    expect(neutralizeExternalUrls(source)).toBe(source)
  })

  it('replaces external urls so the exported canvas stays readable', () => {
    const css = neutralizeExternalUrls('background: url("https://cdn.example/a.png")')
    expect(css.startsWith('background: url("data:image/gif')).toBe(true)
  })
})
