import { describe, expect, it } from 'vitest'
import { COMMON_LANGUAGES, isSvgCodeLanguage, normalizeCodeLanguage } from './codeLanguages'

describe('codeLanguages', () => {
  it('normalizes the xml family onto shiki xml', () => {
    // shiki 只收录 xml 且不带别名：svg/xsl/xsd/plist 等不归一会直接抛
    // `Language not found`，代码块整段回落无色纯文本。
    for (const lang of [
      'svg',
      ' SVG ',
      'svgz',
      'xsl',
      'xslt',
      'xsd',
      'xhtml',
      'rss',
      'atom',
      'plist',
      'wsdl',
    ]) {
      expect(normalizeCodeLanguage(lang)).toBe('xml')
    }
  })

  it('keeps the original aliases working', () => {
    expect(normalizeCodeLanguage('TS')).toBe('typescript')
    expect(normalizeCodeLanguage('js')).toBe('javascript')
    expect(normalizeCodeLanguage('sh')).toBe('bash')
    expect(normalizeCodeLanguage('yml')).toBe('yaml')
  })

  it('passes unknown languages through untouched', () => {
    expect(normalizeCodeLanguage('brainfuck')).toBe('brainfuck')
    expect(normalizeCodeLanguage('   ')).toBe('')
  })

  it('preloads xml, the alias target of the xml family', () => {
    expect(COMMON_LANGUAGES).toContain('xml')
  })

  it('only marks plain svg fences as directly renderable graphics', () => {
    expect(isSvgCodeLanguage('svg')).toBe(true)
    expect(isSvgCodeLanguage(' SVG ')).toBe(true)
    expect(isSvgCodeLanguage('xml')).toBe(false)
    expect(isSvgCodeLanguage('svgz')).toBe(false)
  })
})
