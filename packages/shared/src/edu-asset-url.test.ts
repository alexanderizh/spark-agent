import { describe, expect, it } from 'vitest'
import { normalizeEduAssetUrl } from './edu-asset-url.js'

describe('normalizeEduAssetUrl', () => {
  it('adds /edu-prod for production upload assets', () => {
    expect(
      normalizeEduAssetUrl('https://www.yiqibyte.com/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps already-correct production URLs unchanged', () => {
    expect(
      normalizeEduAssetUrl('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps non-upload URLs unchanged', () => {
    expect(normalizeEduAssetUrl('https://www.yiqibyte.com/upload')).toBe('https://www.yiqibyte.com/upload')
    expect(normalizeEduAssetUrl('https://example.com/uploads/raw/a.png')).toBe('https://example.com/uploads/raw/a.png')
  })

  it('normalizes root-relative upload paths', () => {
    expect(normalizeEduAssetUrl('/uploads/raw/a.png')).toBe('/edu-prod/uploads/raw/a.png')
  })
})
